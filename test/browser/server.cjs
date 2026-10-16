const path = require("node:path");
const express = require("express");
const { fixture } = require("../helpers.cjs");
const { createApp } = require("../../server/app");
const { createAdmin } = require("../../server/auth");
const f = fixture({ count: 1000 });
createAdmin(f.db, "operador-teste", "senha-isolada-de-testes");
const app = createApp({ ...f, origins: ["http://127.0.0.1:3187"] });
app.post("/__test/step", async (req, res) => {
  await f.step(Number(req.body.n || 1));
  res.json(f.campaigns.list());
});
app.post("/__test/advance", (req, res) => {
  f.advance(Number(req.body.ms));
  res.json({ now: f.now() });
});
app.post("/__test/connect", (req, res) => {
  f.connect(!!req.body.value);
  res.json({ success: true });
});
app.use(express.static(path.resolve("dist")));
app.get("/{*path}", (req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
const server = app.listen(3187, "127.0.0.1", () =>
  console.log("Fixture isolada pronta"),
);

process.on("SIGTERM", () => server.close(() => process.exit(0)));
