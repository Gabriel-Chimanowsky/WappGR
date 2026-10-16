const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
function loadEnvironment() {
  const flag = process.argv.indexOf("--env-file-path");
  if (flag >= 0) {
    if (!process.argv[flag + 1])
      throw Error("Informe o caminho absoluto do arquivo de ambiente.");
    process.env.WAPPGR_ENV_FILE = path.resolve(ROOT, process.argv[flag + 1]);
  }
  const envFile = path.resolve(ROOT, process.env.WAPPGR_ENV_FILE || ".env");
  const loaded = require("dotenv").config({ path: envFile, quiet: true });
  if (loaded.error && loaded.error.code !== "ENOENT") throw loaded.error;
  for (const [key, fallback] of [
    ["WAPPGR_DB_PATH", "server/wappgr.db"],
    ["WAPPGR_AUTH_DIR", "server/baileys_auth"],
  ])
    process.env[key] = path.resolve(ROOT, process.env[key] || fallback);
  const runtimeDir = path.resolve(
    ROOT,
    process.env.WAPPGR_RUNTIME_DIR ||
      path.join(path.dirname(process.env.WAPPGR_DB_PATH), "runtime"),
  );
  process.env.WAPPGR_RUNTIME_DIR = runtimeDir;
  return {
    root: ROOT,
    envFile,
    filename: process.env.WAPPGR_DB_PATH,
    authDir: process.env.WAPPGR_AUTH_DIR,
    runtimeDir,
    logsDir: path.join(runtimeDir, "logs"),
    healthFile: path.join(runtimeDir, "health.json"),
    stateFile: path.join(runtimeDir, "supervisor.json"),
    stopFile: path.join(runtimeDir, "stop.json"),
    startFile: path.join(runtimeDir, "start.json"),
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT ?? 3001),
  };
}
module.exports = { ROOT, loadEnvironment };
