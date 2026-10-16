const { spawn } = require("node:child_process");
const path = require("node:path");
if (process.argv.includes("--detach")) {
  const child = spawn(process.execPath, [__filename], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  console.log(JSON.stringify({ pid: child.pid }));
} else {
  const { loadEnvironment } = require("../server/config");
  require("../server/supervisor")
    .supervise({
      config: loadEnvironment(),
      entry: path.join(
        __dirname,
        process.env.TEST_FAILURE_CODE
          ? "supervisor-failure.cjs"
          : "autonomy-worker.cjs",
      ),
      delays: [80, 160, 300],
      failureLimit: 3,
      stableMs: 60000,
      pollMs: 20,
      readyTimeoutMs: 5000,
      staleMs: 5000,
      stopTimeoutMs: 1500,
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
