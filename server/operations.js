const fs = require("node:fs");
const path = require("node:path");
function retryFile(operation) {
  const waits = [5, 10, 20, 40, 80, 160];
  for (let attempt = 0; ; attempt++) {
    try {
      return operation();
    } catch (error) {
      if (
        !["EPERM", "EACCES", "EBUSY"].includes(error.code) ||
        attempt >= waits.length
      )
        throw error;
      // Windows readers/antivirus can briefly deny replacement of an open file.
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        waits[attempt],
      );
    }
  }
}
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + ".tmp-" + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
  });
  retryFile(() => fs.renameSync(temporary, file));
}
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
class RotatingLog {
  constructor(file, { maxBytes = 5 * 1024 * 1024, keep = 5 } = {}) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.keep = keep;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  }
  write(level, message) {
    const line =
      JSON.stringify({
        at: new Date().toISOString(),
        level,
        message: String(message).slice(0, 8192),
      }) + "\n";
    if (
      fs.existsSync(this.file) &&
      fs.statSync(this.file).size + Buffer.byteLength(line) > this.maxBytes
    ) {
      retryFile(() => fs.rmSync(this.file + "." + this.keep, { force: true }));
      for (let n = this.keep - 1; n >= 1; n--)
        if (fs.existsSync(this.file + "." + n))
          retryFile(() =>
            fs.renameSync(this.file + "." + n, this.file + "." + (n + 1)),
          );
      try {
        retryFile(() => fs.renameSync(this.file, this.file + ".1"));
      } catch (error) {
        if (!["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
        // A log viewer may hold a permanent read/write handle without delete sharing.
        fs.copyFileSync(this.file, this.file + ".1");
        fs.truncateSync(this.file, 0);
      }
    }
    fs.appendFileSync(this.file, line, { mode: 0o600 });
  }
  capture(stream, level) {
    let pending = "";
    stream.on("data", (chunk) => {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) if (line) this.write(level, line);
      if (pending.length > 8192) {
        this.write(level, pending);
        pending = "";
      }
    });
    stream.on("end", () => {
      if (pending) this.write(level, pending);
    });
  }
}
module.exports = { readJson, writeJson, isAlive, RotatingLog };
