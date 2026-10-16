const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { loadEnvironment } = require("./config");
const { acquireInstanceLock } = require("./instance-lock");
const { readJson, writeJson, isAlive, RotatingLog } = require("./operations");
async function supervise({
  config = loadEnvironment(),
  entry = path.join(config.root, "server/index.js"),
  env = process.env,
  delays = [30000, 60000, 120000, 300000, 600000],
  failureLimit = 6,
  stableMs = 300000,
  pollMs = 500,
  readyTimeoutMs = 45000,
  staleMs = 120000,
  stopTimeoutMs = 40000,
} = {}) {
  fs.mkdirSync(config.runtimeDir, { recursive: true, mode: 0o700 });
  const release = acquireInstanceLock(
    path.join(config.runtimeDir, "supervisor.instance-lock"),
  );
  const log = new RotatingLog(path.join(config.logsDir, "supervisor.log"));
  const output = new RotatingLog(path.join(config.logsDir, "backend.log"));
  const previous = readJson(config.stateFile) || {},
    requestId = readJson(config.startFile)?.id;
  const reset = requestId && requestId !== previous.startRequestId;
  let failures = reset ? 0 : previous.failures || 0,
    child = null,
    stopping = false;
  let state = {
    pid: process.pid,
    childPid: null,
    state: "STARTING",
    failures,
    startRequestId: requestId || previous.startRequestId || null,
    startedAt: new Date().toISOString(),
    reason: null,
  };
  const publish = (patch = {}) => {
    state = {
      ...state,
      ...patch,
      failures,
      heartbeatAt: new Date().toISOString(),
    };
    writeJson(config.stateFile, state);
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const blocked = (reason) => {
    publish({ state: "BLOCKED", reason, childPid: null });
    log.write("error", reason);
  };
  const onStop = () => {
    stopping = true;
  };
  process.on("SIGINT", onStop);
  process.on("SIGTERM", onStop);
  const shouldStop = () => stopping || fs.existsSync(config.stopFile);
  try {
    if (shouldStop()) {
      publish({ state: "STOPPED", reason: "Parada administrativa persistida" });
      return;
    }
    if ((!reset && previous.state === "BLOCKED") || failures >= failureLimit) {
      blocked(
        previous.reason || "Limite de falhas atingido; corrija e use start.",
      );
      return;
    }
    const existing = readJson(config.filename + ".instance-lock");
    if (existing && isAlive(existing.pid)) {
      if (existing.pid !== previous.childPid || isAlive(previous.pid)) {
        blocked(
          "Backend já ativo (PID " +
            existing.pid +
            "). Nenhuma segunda instância criada.",
        );
        return;
      }
      const deadline = Date.now() + stopTimeoutMs + 5000;
      while (isAlive(existing.pid) && Date.now() < deadline && !shouldStop()) {
        publish({
          state: "WAITING_PREVIOUS",
          reason: "Aguardando encerramento do backend anterior",
        });
        await sleep(pollMs);
      }
      if (isAlive(existing.pid) && !shouldStop()) {
        blocked(
          "Backend anterior ainda ativo; revisão operacional necessária.",
        );
        return;
      }
    }
    let nextRestartAt = reset
      ? 0
      : Date.parse(previous.nextRestartAt || "") || 0;
    while (!shouldStop()) {
      while (Date.now() < nextRestartAt && !shouldStop()) {
        publish({
          state: "BACKOFF",
          nextRestartAt: new Date(nextRestartAt).toISOString(),
        });
        await sleep(Math.min(pollMs, nextRestartAt - Date.now()));
      }
      if (shouldStop()) break;
      const live = readJson(config.filename + ".instance-lock");
      if (live && isAlive(live.pid)) {
        blocked("Outra instância assumiu o banco; execução recusada.");
        return;
      }
      publish({ state: "STARTING", reason: null, nextRestartAt: null });
      log.write("info", "Iniciando backend; falhas consecutivas: " + failures);
      const began = Date.now();
      let ready = false,
        exited = false,
        exitCode,
        exitSignal,
        spawnError,
        stopSentAt = 0,
        forcedReason;
      child = spawn(process.execPath, [entry], {
        cwd: config.root,
        env: {
          ...env,
          NODE_ENV: "production",
          WAPPGR_RUNTIME_DIR: config.runtimeDir,
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      child.once("error", (error) => {
        spawnError = error.message;
        exited = true;
      });
      child.once("exit", (code, signal) => {
        exitCode = code;
        exitSignal = signal;
        exited = true;
      });
      child.on("message", (msg) => {
        if (msg?.type === "ready") ready = true;
      });
      output.capture(child.stdout, "stdout");
      output.capture(child.stderr, "stderr");
      publish({ childPid: child.pid || null });
      while (!exited) {
        const health = readJson(config.healthFile);
        const heartbeatAge =
          health?.pid === child.pid
            ? Date.now() - Date.parse(health.heartbeatAt)
            : Date.now() - began;
        const dispatcherAge =
          health?.dispatcher?.busy && health.dispatcher.startedAt
            ? Date.now() - Date.parse(health.dispatcher.startedAt)
            : 0;
        const stalled =
          (!ready && Date.now() - began > readyTimeoutMs) ||
          (ready && (heartbeatAge > staleMs || dispatcherAge > staleMs));
        if ((shouldStop() || stalled) && !stopSentAt) {
          forcedReason = shouldStop()
            ? "Parada administrativa"
            : "Backend sem atividade de saúde ou despachante bloqueado";
          stopSentAt = Date.now();
          publish({ state: "STOPPING", reason: forcedReason });
          if (child.connected) child.send({ type: "shutdown" }, () => {});
        }
        if (stopSentAt && Date.now() - stopSentAt > stopTimeoutMs)
          child.kill("SIGKILL");
        publish({
          state: stopSentAt ? "STOPPING" : ready ? "RUNNING" : "STARTING",
        });
        await sleep(pollMs);
      }
      child = null;
      log.write(
        "info",
        "Backend encerrou: " +
          JSON.stringify({ exitCode, exitSignal, spawnError, forcedReason }),
      );
      if (shouldStop()) break;
      if (exitCode === 78 || spawnError) {
        blocked(
          "Configuração, permissão ou instância inválida. Consulte backend.log e use start após corrigir.",
        );
        return;
      }
      if (exitCode === 0 && !forcedReason) {
        writeJson(config.stopFile, {
          at: new Date().toISOString(),
          reason: "Backend encerrou deliberadamente",
        });
        break;
      }
      if (Date.now() - began >= stableMs) failures = 0;
      failures++;
      if (failures >= failureLimit) {
        blocked(
          "Limite de " +
            failureLimit +
            " falhas consecutivas atingido. Corrija e use start.",
        );
        return;
      }
      nextRestartAt =
        Date.now() + delays[Math.min(failures - 1, delays.length - 1)];
      publish({
        state: "BACKOFF",
        childPid: null,
        reason: forcedReason || "Falha inesperada do processo",
        nextRestartAt: new Date(nextRestartAt).toISOString(),
        lastExit: { code: exitCode, signal: exitSignal },
      });
      log.write(
        "warn",
        "Recuperação agendada para " + new Date(nextRestartAt).toISOString(),
      );
    }
    publish({
      state: "STOPPED",
      childPid: null,
      reason:
        "Parada administrativa; use start para reativar, inclusive após reiniciar Windows",
    });
  } catch (error) {
    try {
      log.write("error", "Falha do supervisor: " + error.stack);
    } catch {}
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, stopTimeoutMs);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        if (child.connected) child.send({ type: "shutdown" }, () => {});
        else child.kill("SIGKILL");
      });
    }
    failures++;
    try {
      publish({
        state: failures >= failureLimit ? "BLOCKED" : "FAILED",
        reason: error.message,
        childPid: null,
        nextRestartAt: new Date(
          Date.now() + delays[Math.min(failures - 1, delays.length - 1)],
        ).toISOString(),
      });
    } catch {}
    throw error;
  } finally {
    process.removeListener("SIGINT", onStop);
    process.removeListener("SIGTERM", onStop);
    release();
  }
}
if (require.main === module)
  supervise().catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
module.exports = { supervise };
