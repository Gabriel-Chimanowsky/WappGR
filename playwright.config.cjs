const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./test/browser",
  testMatch: "*.spec.cjs",
  workers: 1,
  globalTeardown: "./test/browser/global-teardown.cjs",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3187",
    channel: "msedge",
    headless: true,
    viewport: { width: 1440, height: 1100 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node test/browser/server.cjs",
    url: "http://127.0.0.1:3187",
    reuseExistingServer: false,
    timeout: 15000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
