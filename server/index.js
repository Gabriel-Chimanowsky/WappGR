const { loadEnvironment } = require("./config");
let backend,
  exiting = false;
async function shutdown(reason, code = 0) {
  if (exiting) return;
  exiting = true;
  try {
    const result = await backend?.shutdown(reason);
    if (result?.interrupted)
      console.error(
        "Chamada interrompida; resultado será incerto, sem reenvio automático.",
      );
    process.exit(code);
  } catch (error) {
    console.error(error.message);
    process.exit(70);
  }
}
(async () => {
  const config = loadEnvironment();
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw Error("Use Node 24 ou superior.");
  if (process.env.NODE_ENV === "production" && config.port === 0)
    throw Error("Defina uma porta fixa de produção entre 1 e 65535.");
  process.chdir(config.root);
  backend = await require("./backend").startBackend({
    config,
    onFatal: (reason) => shutdown(reason, 70),
  });
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("message", (msg) => {
    if (msg?.type === "shutdown") shutdown("Comando do supervisor");
  });
  if (process.send) {
    process.on("disconnect", () => shutdown("Supervisor desconectado", 70));
    process.send({ type: "ready", pid: process.pid });
  }
  process.on("uncaughtException", (error) => {
    console.error(error.stack);
    shutdown("Exceção fatal", 70);
  });
  process.on("unhandledRejection", (error) => {
    console.error(String(error));
    shutdown("Promise rejeitada", 70);
  });
})().catch((error) => {
  console.error("Inicialização recusada: " + error.message);
  process.exitCode = 78; // configuration, lock or bind failure: require operational correction
});
