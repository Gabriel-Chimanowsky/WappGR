const fs = require("node:fs");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
function acquireInstanceLock(filename) {
  const token = randomUUID();
  const data = { pid: process.pid, host: os.hostname(), token };
  try {
    const fd = fs.openSync(filename, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(data));
    fs.closeSync(fd);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let old;
    try {
      old = JSON.parse(fs.readFileSync(filename, "utf8"));
    } catch {
      throw new Error(
        "Lock incompleto. Verifique os processos antes de remover: " + filename,
      );
    }
    if (old.host !== os.hostname())
      throw new Error(
        "Banco pertence a outro host. Não é permitido compartilhar esta instalação entre servidores.",
      );
    let alive = true;
    try {
      process.kill(old.pid, 0);
    } catch (err) {
      if (err.code === "ESRCH") alive = false;
    }
    if (alive)
      throw new Error(
        "Já existe uma instância ativa do WappGR (PID " + old.pid + ").",
      );
    fs.unlinkSync(filename);
    return acquireInstanceLock(filename);
  }
  return () => {
    try {
      if (JSON.parse(fs.readFileSync(filename, "utf8")).token === token)
        fs.unlinkSync(filename);
    } catch {}
  };
}
module.exports = { acquireInstanceLock };
