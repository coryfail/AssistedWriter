const missingChannelFile = (error) =>
  error?.code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND" ||
  /Cannot find latest-mac\.yml in the latest release artifacts/.test(error?.message || "");

function createUpdateController(updater, publish = () => {}) {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = Boolean(updater.currentVersion?.prerelease?.length);
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
  updater.on("error", (error) => set("error", {
    message: missingChannelFile(error)
      ? "The latest release is still being published. Try again shortly."
      : "Could not check for updates right now. Try again.",
  }));
  return {
    status: () => state,
    async check() {
      try {
        await updater.checkForUpdates();
        return state;
      } catch (error) {
        if (missingChannelFile(error)) {
          const version = /\/releases\/download\/v?([^/]+)\/latest-mac\.yml/.exec(error.message)?.[1];
          if (version && version === updater.currentVersion?.version)
            return set("not-available", { version });
        }
        return set("error", {
          message: missingChannelFile(error)
            ? "The latest release is still being published. Try again shortly."
            : "Could not check for updates right now. Try again.",
        });
      }
    },
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
