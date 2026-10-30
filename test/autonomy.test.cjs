const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fork, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { RotatingLog, writeJson } = require("../server/operations");
async function until(fn, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Condição não atingida no prazo");
}
test(
  "backend real: campanha continua sem conexões HTTP e após expirar login; cron, entrada e fluxo são autônomos",
  { timeout: 20000 },
  async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wappgr-autonomy-"));
    const child = fork(path.join(__dirname, "autonomy-worker.cjs"), [], {
      windowsHide: true,
      env: {
        ...process.env,
        WAPPGR_DB_PATH: path.join(dir, "test.db"),
        WAPPGR_AUTH_DIR: path.join(dir, "auth"),
        WAPPGR_RUNTIME_DIR: path.join(dir, "runtime"),
        WAPPGR_ENV_FILE: path.join(dir, "absent.env"),
        WAPPGR_DISABLE_WHATSAPP: "1",
        TEST_HOLD_FIRST: "1",
        HOST: "127.0.0.1",
        PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let seq = 0,
      stderr = "";
    const pending = new Map();
    child.stderr.on("data", (d) => (stderr += d));
    child.on("message", (msg) => {
      if (msg.reply) {
        const p = pending.get(msg.reply);
        pending.delete(msg.reply);
        if (msg.error) p.reject(Error(msg.error));
        else p.resolve(msg.result);
      }
    });
    const request = (cmd, args = {}) =>
      new Promise((resolve, reject) => {
        const requestId = String(++seq);
        pending.set(requestId, { resolve, reject });
        child.send({ cmd, requestId, ...args });
      });
    child.on("exit", () => {
      for (const p of pending.values())
        p.reject(Error(stderr || "Worker encerrou"));
    });
    t.after(async () => {
      if (child.exitCode === null && !child.killed) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const ready = await new Promise((resolve, reject) => {
      child.on("message", (msg) => {
        if (msg.type === "ready") resolve(msg);
      });
      child.once("exit", () => reject(Error(stderr)));
    });
    const api = async (route, method = "GET", body, headers = {}) =>
      fetch(ready.root + "/api/v1" + route, {
        method,
        headers: {
          "Content-Type": "application/json",
          Connection: "close",
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const login = await api("/auth/login", "POST", {
      username: "autonomy-test",
      password: "senha-sintetica-autonomia",
    });
    const session = await login.json(),
      headers = {
        Cookie: login.headers.get("set-cookie").split(";")[0],
        "X-CSRF-Token": session.csrf,
        "Idempotency-Key": "autonomy-create",
      };
    assert.equal((await api("/health")).status, 401);
    assert.equal((await api("/health", "GET", undefined, headers)).status, 200);
    const created = await api(
      "/campaigns",
      "POST",
      {
        messageCategory: "SERVICE",
        title: "Sem navegador",
        message: "Campanha autônoma",
        pacingSeconds: 1,
        selection: {
          type: "ids",
          ids: ["lead000000", "lead000001", "lead000002"],
        },
      },
      headers,
    );
    assert.equal(created.status, 201);
    const campaign = (await created.json()).campaign;
    assert.equal(
      (
        await api(
          "/schedules",
          "POST",
          {
            messageCategory: "SERVICE",
            title: "Cron sem navegador",
            message: "Ocorrência autônoma",
            recurrence: "ONCE",
            timeOfDay: "09:01",
            startDate: "2026-10-16",
            timezone: "UTC",
            pacingSeconds: 1,
            selection: { type: "ids", ids: ["lead000003"] },
          },
          headers,
        )
      ).status,
      201,
    );
    const flow = await api(
      "/flows",
      "POST",
      {
        name: "Fluxo autônomo",
        messageCategory: "SERVICE",
        trigger_type: "KEYWORD",
        trigger_keywords: "AUTONOMO",
        active: 1,
        steps: [
          {
            id: "a",
            type: "TEXT",
            content: "Etapa autônoma A",
            delaySeconds: 3,
            options: [],
            nextStepId: "b",
          },
          {
            id: "b",
            type: "TEXT",
            content: "Etapa autônoma B",
            delaySeconds: 5,
            options: [{ label: "Fim", keyword: "1", nextStepId: "" }],
          },
        ],
      },
      headers,
    );
    assert.equal(flow.status, 201);
    const flowData = await flow.json();
    await until(async () => (await request("state")).calls.length > 0);
    await request("expire");
    assert.equal((await api("/leads", "GET", undefined, headers)).status, 401);
    await request("close-http");
    await request("receive", { text: "AUTONOMO" });
    await request("resolve");
    // No more frontend or HTTP requests while these jobs complete: only inspect through test IPC.
    const done = await until(async () => {
      const s = await request("state");
      return s.campaigns.find((c) => c.id === campaign.id)?.sent === 3 &&
        s.calls.some((c) => c.text === "Ocorrência autônoma") &&
        s.campaigns.every((c) =>
          ["COMPLETED", "COMPLETED_WITH_FAILURES"].includes(c.execution_status),
        ) &&
        s.sessions[0]?.status === "WAITING_REPLY"
        ? s
        : null;
    });
    assert.equal(
      done.calls.filter((c) => c.text === "Etapa autônoma A").length,
      1,
    );
    assert.equal(
      done.calls.filter((c) => c.text === "Etapa autônoma B").length,
      1,
    );
    assert.equal(done.schedules[0].active, 0);
    const before = done.calls.length;
    await request("advance", { ms: 120000 });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await request("state")).calls.length, before); // no campaign replay or repeated WAITING_REPLY
    const again = await api("/auth/login", "POST", {
      username: "autonomy-test",
      password: "senha-sintetica-autonomia",
    });
    const s = await again.json(),
      h = {
        Cookie: again.headers.get("set-cookie").split(";")[0],
        "X-CSRF-Token": s.csrf,
      };
    await request("defer-dispatch");
    await request("receive", { text: "AUTONOMO" });
    await until(async () =>
      (await request("state")).jobs.some(
        (j) => j.source_id === flowData.id && j.status === "PENDING",
      ),
    );
    assert.equal(
      (await api("/flows/" + flowData.id + "/toggle", "PATCH", {}, h)).status,
      200,
    );
    await request("advance", { ms: 3600001 });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await request("state")).calls.length, before);
    assert.ok(
      (await request("state")).jobs.some(
        (j) => j.source_id === flowData.id && j.status === "CANCELLED",
      ),
    );
    const exited = once(child, "exit");
    await request("stop").catch(() => {});
    await exited;
    assert.equal(child.exitCode, 0);
  },
);
test("operação: rotação mantém quantidade limitada de logs e conteúdo JSON", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wappgr-logs-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = new RotatingLog(path.join(dir, "backend.log"), {
    maxBytes: 220,
    keep: 2,
  });
  for (let i = 0; i < 30; i++) log.write("info", "Registro " + i);
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 3);
  for (const file of files)
    for (const line of fs
      .readFileSync(path.join(dir, file), "utf8")
      .trim()
      .split("\n"))
      assert.equal(JSON.parse(line).level, "info");
  const original = fs.renameSync;
  let replacements = 0;
  fs.renameSync = (...args) => {
    if (++replacements <= 2)
      throw Object.assign(Error("Sharing violation sintética"), {
        code: "EPERM",
      });
    return original(...args);
  };
  try {
    writeJson(path.join(dir, "state.json"), { state: "RUNNING" });
  } finally {
    fs.renameSync = original;
  }
  assert.equal(replacements, 3);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")).state,
    "RUNNING",
  );
});
test(
  "operação Windows: PowerShell possui sintaxe válida e preparação não registra tarefa",
  { skip: process.platform !== "win32" },
  (t) => {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "$Errors=$null; $Tokens=$null; [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/windows.ps1'),[ref]$Tokens,[ref]$Errors) | Out-Null; if($Errors.Count){$Errors | Out-String | Write-Error; exit 1}",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wappgr-task-plan-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, "task.env");
    fs.writeFileSync(
      file,
      "PORT=3197\nWAPPGR_DB_PATH=" +
        path.join(dir, "test.db") +
        "\nWAPPGR_AUTH_DIR=" +
        path.join(dir, "auth") +
        "\nWAPPGR_RUNTIME_DIR=" +
        path.join(dir, "runtime") +
        "\nWAPPGR_DISABLE_WHATSAPP=1\n",
    );
    const plan = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.resolve("scripts/windows.ps1"),
        "install",
        "-PrepareOnly",
        "-EnvFile",
        file,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(plan.status, 0, plan.stdout + plan.stderr);
    const prepared = JSON.parse(plan.stdout.replace(/^\uFEFF/, ""));
    assert.equal(prepared.registered, false);
    assert.equal(prepared.prepared, true);
    const xml = fs.readFileSync(prepared.xml, "utf16le");
    assert.ok(xml.includes("<BootTrigger>"));
    assert.ok(xml.includes("<UserId>S-1-5-18</UserId>"));
    assert.ok(
      xml.includes(
        "<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
      ),
    );
  },
);
