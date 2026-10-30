// Apply only to WappGR. Keep a single process and the persistent SQLite/auth locks.
module.exports = {
  apps: [
    {
      name: "wappgr-backend",
      cwd: "/var/www/WappGR",
      script: "server/index.js",
      interpreter: process.env.WAPPGR_NODE_BIN || "node",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      restart_delay: 30000,
      max_restarts: 6,
      min_uptime: "5m",
      kill_timeout: 40000,
      stop_exit_codes: [0, 78],
      env: { NODE_ENV: "production", WAPPGR_ENV_FILE: "/var/www/WappGR/.env" },
    },
  ],
};
