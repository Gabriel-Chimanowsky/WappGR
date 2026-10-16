const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { readJson, isAlive } = require("../server/operations");
const { control } = require("../server/service-control");
const { DatabaseSync } = require("node:sqlite");
const runner = path.join(__dirname, "supervisor-runner.cjs");
async function until(fn, ms = 10000) {
  const limit = Date.now() + ms;
  while (Date.now() < limit) {
    const r = fn();
    if (r) return r;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw Error("Tempo esgotado aguardando estado operacional");
}
function isolated(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wappgr-supervisor-")),
    runtime = path.join(dir, "runtime");
  const config = {
    root: path.resolve(__dirname, ".."),
    filename: path.join(dir, "test.db"),
    authDir: path.join(dir, "auth"),
    runtimeDir: runtime,
    logsDir: path.join(runtime, "logs"),
    healthFile: path.join(runtime, "health.json"),
    stateFile: path.join(runtime, "supervisor.json"),
    stopFile: path.join(runtime, "stop.json"),
    startFile: path.join(runtime, "start.json"),
  };
  const env = {
    ...process.env,
    WAPPGR_DB_PATH: config.filename,
    WAPPGR_AUTH_DIR: config.authDir,
    WAPPGR_RUNTIME_DIR: runtime,
    WAPPGR_ENV_FILE: path.join(dir, "absent.env"),
    WAPPGR_DISABLE_WHATSAPP: "1",
    TEST_AUTORUN: "1",
    TEST_HOLD_FIRST: "0",
    HOST: "127.0.0.1",
    PORT: "0",
    ...extra,
  };
  fs.mkdirSync(config.authDir);
  fs.writeFileSync(
    path.join(config.authDir, "creds.json"),
    "synthetic-credential-sentinel",
  );
  const launch = () => {
    const p = spawnSync(process.execPath, [runner, "--detach"], {
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    assert.equal(p.status, 0, p.stderr);
    return JSON.parse(p.stdout).pid;
  };
  t.after(async () => {
    if (
      fs.existsSync(config.stopFile) &&
      readJson(config.stateFile)?.state !== "STOPPED"
    ) {
      const debug = path.join(
        path.resolve(__dirname, ".."),
        ".npm-cache",
        path.basename(dir) + "-diagnostic",
      );
      fs.cpSync(runtime, debug, { recursive: true });
    }
    control("stop", config);
    try {
      await until(() => !control("status", config).supervisorAlive, 5000);
    } catch {
      const state = readJson(config.stateFile);
      if (isAlive(state?.childPid)) process.kill(state.childPid, "SIGKILL");
      if (isAlive(state?.pid)) process.kill(state.pid, "SIGKILL");
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, config, env, launch };
}
test(
  "supervisor real: terminal iniciador encerra, backend segue; reinício sem replay, instância única e parada persistente",
  { timeout: 30000 },
  async (t) => {
    const e = isolated(t),
      pid = e.launch(); // launcher already exited, no terminal or HTTP session owns supervisor
    await until(() => {
      const s = control("status", e.config);
      return (
        s.supervisorAlive &&
        s.backendAlive &&
        s.healthFresh &&
        s.supervisor.state === "RUNNING"
      );
    });
    assert.equal(isAlive(pid), true);
    const same = spawnSync(process.execPath, [runner], {
      env: e.env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    assert.equal(same.status, 1);
    assert.match(same.stderr, /instância ativa/);
    await until(() => {
      const db = new DatabaseSync(e.config.filename, { readOnly: true });
      try {
        return db
          .prepare(
            "SELECT execution_status FROM campaigns WHERE execution_status='COMPLETED'",
          )
          .get();
      } finally {
        db.close();
      }
    });
    const state = readJson(e.config.stateFile),
      callsFile = path.join(e.config.runtimeDir, "synthetic-calls.jsonl");
    const accepted = fs.readFileSync(callsFile, "utf8").trim().split("\n");
    assert.equal(accepted.length, 8);
    process.kill(state.childPid, "SIGKILL");
    await until(() => {
      const s = readJson(e.config.stateFile);
      return s?.state === "RUNNING" && s.childPid !== state.childPid;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      fs.readFileSync(callsFile, "utf8").trim().split("\n").length,
      8,
    );
    control("stop", e.config);
    await until(() => {
      const s = control("status", e.config);
      return (
        !s.supervisorAlive &&
        !s.backendAlive &&
        s.supervisor?.state === "STOPPED"
      );
    });
    assert.equal(readJson(e.config.stateFile).state, "STOPPED");
    const stopped = spawnSync(process.execPath, [runner], {
      env: e.env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.equal(control("status", e.config).backendAlive, false);
    control("start", e.config);
    e.launch();
    await until(
      () =>
        control("status", e.config).healthFresh &&
        readJson(e.config.stateFile)?.state === "RUNNING",
    );
    assert.equal(
      fs.readFileSync(path.join(e.config.authDir, "creds.json"), "utf8"),
      "synthetic-credential-sentinel",
    );
  },
);
test(
  "supervisor: falhas usam espera progressiva e limite persistente; configuração inválida não reinicia em loop",
  { timeout: 20000 },
  async (t) => {
    const e = isolated(t, { TEST_FAILURE_CODE: "70" });
    e.launch();
    await until(() => readJson(e.config.stateFile)?.state === "BLOCKED");
    await until(() => !control("status", e.config).supervisorAlive);
    assert.equal(readJson(e.config.stateFile).failures, 3);
    const file = path.join(e.config.logsDir, "supervisor.log");
    const starts = fs
      .readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse)
      .filter((e) => e.message.startsWith("Iniciando backend"));
    assert.equal(starts.length, 3);
    assert.ok(Date.parse(starts[1].at) - Date.parse(starts[0].at) >= 80);
    assert.ok(Date.parse(starts[2].at) - Date.parse(starts[1].at) >= 160);
    e.launch();
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(
      fs.readFileSync(file, "utf8").split("Iniciando backend").length - 1,
      3,
    );
    control("start", e.config);
    e.env.TEST_FAILURE_CODE = "78";
    e.launch();
    await until(
      () =>
        readJson(e.config.stateFile)?.state === "BLOCKED" &&
        readJson(e.config.stateFile).failures === 0,
    );
    assert.equal(
      fs.readFileSync(file, "utf8").split("Iniciando backend").length - 1,
      4,
    );
  },
);
test(
  "supervisor: parada durante envio preserva resultado incerto e retomada não repete o destinatário",
  { timeout: 20000 },
  async (t) => {
    const e = isolated(t, { TEST_HOLD_FIRST: "1" });
    e.launch();
    await until(() => {
      const h = readJson(e.config.healthFile);
      return h?.dispatcher?.busy;
    });
    control("stop", e.config);
    await until(() => {
      const s = control("status", e.config);
      return (
        !s.supervisorAlive &&
        !s.backendAlive &&
        s.supervisor?.state === "STOPPED"
      );
    });
    assert.equal(readJson(e.config.stateFile).state, "STOPPED");
    e.env.TEST_HOLD_FIRST = "0";
    control("start", e.config);
    e.launch();
    await until(() => {
      const s = control("status", e.config);
      return (
        s.supervisor?.state === "RUNNING" &&
        s.healthFresh &&
        s.health?.pid === s.supervisor.childPid
      );
    });
    await until(() => {
      if (!fs.existsSync(e.config.filename)) return false;
      const db = new DatabaseSync(e.config.filename, { readOnly: true });
      db.exec("PRAGMA busy_timeout=5000");
      try {
        return db
          .prepare(
            "SELECT id FROM campaigns WHERE execution_status='COMPLETED_WITH_FAILURES'",
          )
          .get();
      } finally {
        db.close();
      }
    });
    const db = new DatabaseSync(e.config.filename, { readOnly: true });
    try {
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) n FROM campaign_recipients WHERE status='UNCERTAIN'",
          )
          .get().n,
        1,
      );
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) n FROM campaign_recipients WHERE status='SENT'",
          )
          .get().n,
        7,
      );
      assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
    } finally {
      db.close();
    }
    const calls = fs
      .readFileSync(
        path.join(e.config.runtimeDir, "synthetic-calls.jsonl"),
        "utf8",
      )
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(calls.length, 8);
    assert.equal(new Set(calls.map((c) => c.target)).size, 8);
  },
);
test("configuração: .env explícito e caminhos relativos são resolvidos pela raiz mesmo fora do projeto", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wappgr-env-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "isolated.env");
  fs.writeFileSync(
    file,
    "PORT=3199\nWAPPGR_DB_PATH=server/isolated-test.db\nWAPPGR_AUTH_DIR=server/isolated-auth\n",
  );
  const env = { ...process.env };
  for (const k of [
    "PORT",
    "WAPPGR_DB_PATH",
    "WAPPGR_AUTH_DIR",
    "WAPPGR_ENV_FILE",
    "WAPPGR_RUNTIME_DIR",
  ])
    delete env[k];
  const run = spawnSync(
    process.execPath,
    [
      path.resolve("server/service-control.js"),
      "config",
      "--env-file-path",
      file,
    ],
    { cwd: os.tmpdir(), env, encoding: "utf8", windowsHide: true },
  );
  assert.equal(run.status, 0, run.stderr);
  const config = JSON.parse(run.stdout);
  assert.equal(config.port, 3199);
  assert.equal(config.filename, path.resolve("server/isolated-test.db"));
  assert.equal(config.envFile, file);
});
