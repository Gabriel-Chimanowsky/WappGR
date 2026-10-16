require("./config").loadEnvironment();
const path = require("node:path");
const { acquireInstanceLock } = require("./instance-lock");
const { openDatabase } = require("./db");
const filename = path.resolve(
  process.env.WAPPGR_DB_PATH || path.join(__dirname, "wappgr.db"),
);
let release, db;
try {
  release = acquireInstanceLock(filename + ".instance-lock");
  db = openDatabase(filename);
  console.log(
    JSON.stringify(
      {
        database: filename,
        versions: db
          .prepare(
            "SELECT version,applied_at FROM schema_migrations ORDER BY version",
          )
          .all(),
        integrity: db.prepare("PRAGMA quick_check").get().quick_check,
        foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all()
          .length,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db?.close();
  release?.();
}
