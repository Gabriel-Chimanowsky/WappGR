// End the isolated fixture explicitly. Avoid Windows process-tree cleanup depending on WMI.
module.exports = async () => {
  try {
    await fetch("http://127.0.0.1:3187/__test/shutdown", { method: "POST" });
  } catch {
    /* Already stopped. */
  }
};
