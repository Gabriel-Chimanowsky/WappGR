require("./config").loadEnvironment();
const readline = require("node:readline/promises");
const { Writable } = require("node:stream");
const { createAdmin } = require("./auth");
const { getDb } = require("./db");
const { acquireInstanceLock } = require("./instance-lock");
const path = require("node:path");
(async () => {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output,
    terminal: !!process.stdin.isTTY,
  });
  const username = await rl.question("Nome do administrador: ");
  process.stdout.write("Senha (mínimo 12 caracteres; oculta): ");
  muted = true;
  const password = await rl.question("");
  muted = false;
  process.stdout.write("\n");
  rl.close();
  const filename =
    process.env.WAPPGR_DB_PATH || path.join(__dirname, "wappgr.db");
  const release = acquireInstanceLock(filename + ".instance-lock");
  try {
    createAdmin(getDb(), username, password);
    console.log(
      "Administrador configurado. Sessões anteriores desse usuário foram revogadas.",
    );
  } finally {
    release();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
