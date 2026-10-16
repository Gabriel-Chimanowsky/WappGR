const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const Database = require("../server/sqlite");
const { fixture } = require("./helpers.cjs");
const { snapshot } = require("../server/backup");
const { acquireInstanceLock } = require("../server/instance-lock");
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wappgr-runtime-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test(
  "execução real: setup-admin, servidor Node, sessão HTTP e pareamento isolado preservado",
  { timeout: 20000 },
  async (t) => {
    const dir = temporary(t),
      filename = path.join(dir, "runtime.db"),
      authDir = path.join(dir, "auth");
    fs.mkdirSync(authDir);
    const sentinel = '{"sentinel":"synthetic-only"}';
    fs.writeFileSync(path.join(authDir, "creds.json"), sentinel);
    const env = {
      ...process.env,
      WAPPGR_DB_PATH: filename,
      WAPPGR_AUTH_DIR: authDir,
      WAPPGR_DISABLE_WHATSAPP: "1",
      HOST: "127.0.0.1",
      PORT: "0",
    };
    const setup = spawn(
      process.execPath,
      [path.resolve("server/setup-admin.js")],
      { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "",
      stage = 0,
      error = "";
    setup.stderr.on("data", (d) => (error += d));
    setup.stdout.on("data", (d) => {
      output += d;
      if (stage === 0 && output.includes("Nome do administrador:")) {
        stage = 1;
        setup.stdin.write("runtime-test\n");
      }
      if (stage === 1 && output.includes("Senha (mínimo")) {
        stage = 2;
        setup.stdin.write("senha-isolada-runtime\n");
      }
    });
    const [code] = await once(setup, "exit");
    assert.equal(code, 0, error);
    assert.ok(output.includes("Administrador configurado"));
    assert.ok(!output.includes("senha-isolada-runtime"));
    const server = spawn(process.execPath, [path.resolve("server/index.js")], {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let serverError = "";
    server.stderr.on("data", (d) => (serverError += d));
    t.after(async () => {
      if (server.exitCode === null && !server.killed) {
        const exited = once(server, "exit");
        server.kill("SIGKILL");
        await exited;
      }
    });
    const root = await new Promise((resolve, reject) => {
      let log = "";
      server.stdout.on("data", (d) => {
        log += d;
        const match = log.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
      server.once("exit", () => reject(Error(serverError)));
    });
    assert.equal((await fetch(root + "/api/v1/leads")).status, 401);
    const login = await fetch(root + "/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "runtime-test",
        password: "senha-isolada-runtime",
      }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (await fetch(root + "/api/v1/leads", { headers: { Cookie: cookie } }))
        .status,
      200,
    );
    const duplicate = spawnSync(
      process.execPath,
      [path.resolve("server/index.js")],
      {
        env: { ...env, WAPPGR_DB_PATH: path.join(dir, "other.db") },
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
      },
    );
    assert.equal(duplicate.status, 78, duplicate.stderr);
    assert.match(duplicate.stderr, /instância ativa/);
    const exited = once(server, "exit");
    server.kill("SIGKILL");
    await exited;
    assert.equal(
      fs.readFileSync(path.join(authDir, "creds.json"), "utf8"),
      sentinel,
    );
    const db = new Database(filename, { readonly: true });
    assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_users").get().n, 1);
    db.close();
  },
);
test("CLI de restauração conserva evidência, bloqueia filas e exige reconciliação de trabalhos posteriores ao backup", async (t) => {
  const dir = temporary(t),
    filename = path.join(dir, "restore.db"),
    f = fixture({ filename, count: 2 }),
    campaign = f.create();
  await f.step();
  const backup = snapshot(filename);
  await f.step();
  assert.equal(f.campaigns.get(campaign.id).sent, 2);
  f.db.close();
  const env = {
    ...process.env,
    WAPPGR_DB_PATH: filename,
    WAPPGR_DISABLE_WHATSAPP: "1",
  };
  const release = acquireInstanceLock(filename + ".instance-lock");
  const refused = spawnSync(process.execPath, ["server/backup.js"], {
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  release();
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /instância ativa/);
  const restored = spawnSync(
    process.execPath,
    ["server/backup.js", "restore", backup],
    { env, encoding: "utf8", windowsHide: true },
  );
  assert.equal(restored.status, 0, restored.stderr);
  const db = new Database(filename, { readonly: true });
  assert.equal(
    db.prepare("SELECT status FROM campaign_recipients WHERE position=1").get()
      .status,
    "SENT",
  );
  assert.equal(
    db.prepare("SELECT status FROM campaign_recipients WHERE position=2").get()
      .status,
    "UNCERTAIN",
  );
  assert.equal(
    db.prepare("SELECT restricted FROM account_control").get().restricted,
    1,
  );
  assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  db.close();
});
