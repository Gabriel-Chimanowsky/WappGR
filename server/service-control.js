const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { loadEnvironment } = require("./config");
const { readJson, writeJson, isAlive } = require("./operations");
function control(action, config = loadEnvironment()) {
  const state = readJson(config.stateFile),
    health = readJson(config.healthFile);
  const supervisor = readJson(
    path.join(config.runtimeDir, "supervisor.instance-lock"),
  );
  const backend = readJson(config.filename + ".instance-lock");
  const activeState = [
    "STARTING",
    "RUNNING",
    "STOPPING",
    "BACKOFF",
    "WAITING_PREVIOUS",
  ].includes(state?.state);
  const supervisorAlive =
    (!!supervisor && isAlive(supervisor.pid)) ||
    (activeState && isAlive(state?.pid));
  const backendAlive =
    (!!backend && isAlive(backend.pid)) ||
    (supervisorAlive && isAlive(state?.childPid));
  if (action === "config")
    return {
      ...config,
      nodePath: process.execPath,
      supervisorPath: path.join(config.root, "server/supervisor.js"),
      nodeVersion: process.version,
    };
  if (action === "preflight") {
    if (Number(process.versions.node.split(".")[0]) < 24)
      throw Error("Use Node 24 ou superior.");
    if (!fs.existsSync(path.join(config.root, "dist/index.html")))
      throw Error("Execute npm run build antes de instalar.");
    if (
      !Number.isInteger(config.port) ||
      config.port < 1 ||
      config.port > 65535
    )
      throw Error("PORT de produção deve estar entre 1 e 65535.");
    fs.accessSync(path.join(config.root, "server/index.js"), fs.constants.R_OK);
    if (fs.existsSync(config.authDir))
      fs.accessSync(config.authDir, fs.constants.R_OK | fs.constants.W_OK);
    fs.accessSync(
      path.dirname(config.filename),
      fs.constants.R_OK | fs.constants.W_OK,
    );
    return {
      ok: true,
      backendAlreadyRunning: !!backend && isAlive(backend.pid),
      backendPid: backend?.pid || null,
    };
  }
  if (action === "start") {
    if (supervisorAlive)
      return { alreadyRunning: true, pid: supervisor?.pid || state.pid };
    if (backendAlive)
      throw Error(
        "Backend já ativo fora do supervisor. Pare a instância existente antes de iniciar a tarefa.",
      );
    fs.rmSync(config.stopFile, { force: true });
    writeJson(config.startFile, {
      id: randomUUID(),
      at: new Date().toISOString(),
    });
    return { startRequested: true };
  }
  if (action === "stop") {
    writeJson(config.stopFile, {
      at: new Date().toISOString(),
      reason: "Parada administrativa",
    });
    return { stopRequested: true };
  }
  return {
    installedRuntime: !!state,
    supervisorAlive: !!supervisorAlive,
    backendAlive: !!backendAlive,
    administrativelyStopped: fs.existsSync(config.stopFile),
    healthFresh:
      !!health &&
      isAlive(health.pid) &&
      Date.now() - Date.parse(health.heartbeatAt) < 10000,
    supervisor: state,
    health,
    logsDirectory: config.logsDir,
  };
}
if (require.main === module)
  try {
    console.log(JSON.stringify(control(process.argv[2] || "status")));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
module.exports = { control };
