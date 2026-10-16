const { DatabaseSync } = require("node:sqlite");

// Same SQLite file format and synchronous interface, without a native npm build.
class Database {
  constructor(filename, options = {}) {
    this.raw = new DatabaseSync(filename, { readOnly: !!options.readonly });
    this.depth = 0;
  }
  prepare(sql) {
    return this.raw.prepare(sql);
  }
  exec(sql) {
    return this.raw.exec(sql);
  }
  pragma(sql) {
    return this.raw.exec("PRAGMA " + sql);
  }
  close() {
    this.raw.close();
  }
  transaction(fn) {
    return (...args) => {
      if (fn.constructor.name === "AsyncFunction")
        throw new Error(
          "SQLite transactions must not contain asynchronous work.",
        );
      const level = this.depth;
      const savepoint = "nested_" + level;
      this.exec(level ? "SAVEPOINT " + savepoint : "BEGIN IMMEDIATE");
      this.depth++;
      try {
        const result = fn(...args);
        if (result && typeof result.then === "function")
          throw new Error(
            "SQLite transactions must not contain asynchronous work.",
          );
        this.exec(level ? "RELEASE " + savepoint : "COMMIT");
        return result;
      } catch (error) {
        this.exec(level ? "ROLLBACK TO " + savepoint : "ROLLBACK");
        if (level) this.exec("RELEASE " + savepoint);
        throw error;
      } finally {
        this.depth--;
      }
    };
  }
}
module.exports = Database;
