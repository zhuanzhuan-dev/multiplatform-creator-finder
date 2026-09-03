(() => {
  const WORKBENCH_ORIGIN = "http://127.0.0.1:4173";
  const PLUGIN = "douyin-feed";

  function postReady() {
    window.postMessage({
      source: "zhuanzhuan-workbench-plugin",
      type: "PLUGIN_READY",
      plugin: PLUGIN,
      version: chrome.runtime.getManifest().version
    }, WORKBENCH_ORIGIN);
  }

  async function startRound() {
    const current = await chrome.runtime.sendMessage({ type: "DRA_GET_STATUS" });
    if (["starting", "running"].includes(current?.state?.status)) {
      return { ok: true, alreadyRunning: true, state: current.state };
    }
    return chrome.runtime.sendMessage({ type: "DRA_START" });
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== WORKBENCH_ORIGIN) return;
    const message = event.data;
    if (message?.source !== "zhuanzhuan-workbench") return;
    if (message.type === "PLUGIN_PING") {
      postReady();
      return;
    }
    if (message.type !== "PLUGIN_COMMAND" || message.plugin !== PLUGIN || message.command !== "start") return;

    try {
      const response = await startRound();
      window.postMessage({
        source: "zhuanzhuan-workbench-plugin",
        type: "PLUGIN_RESPONSE",
        plugin: PLUGIN,
        requestId: message.requestId,
        ok: response?.ok === true,
        response,
        error: response?.error || ""
      }, WORKBENCH_ORIGIN);
    } catch (error) {
      window.postMessage({
        source: "zhuanzhuan-workbench-plugin",
        type: "PLUGIN_RESPONSE",
        plugin: PLUGIN,
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }, WORKBENCH_ORIGIN);
    }
  });

  postReady();
})();
