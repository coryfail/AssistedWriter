function createUpdateController(updater, publish = () => {}) {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = true;
  let state = { status: "idle" };
  const set = (status, details = {}) => {
    state = { status, ...details };
    publish(state);
    return state;
  };
  updater.on("checking-for-update", () => set("checking"));
  updater.on("update-available", (info) => set("available", { version: info.version }));
  updater.on("update-not-available", (info) => set("not-available", { version: info.version }));
  updater.on("download-progress", (progress) => set("downloading", {
    percent: Math.round(progress.percent),
    transferred: progress.transferred,
    total: progress.total,
  }));
  updater.on("update-downloaded", (info) => set("downloaded", { version: info.version }));
  updater.on("error", (error) => set("error", { message: error.message }));
  return {
    status: () => state,
    async check() { await updater.checkForUpdates(); return state; },
    async download() {
      if (state.status !== "available") throw new Error("Check for an available update first.");
      set("downloading", { percent: 0 });
      await updater.downloadUpdate();
      return state;
    },
    install() {
      if (state.status !== "downloaded") throw new Error("Download the update before restarting.");
      set("installing");
      setImmediate(() => updater.quitAndInstall());
      return state;
    },
  };
}

module.exports = { createUpdateController };
