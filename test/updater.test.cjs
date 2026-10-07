const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createUpdateController } = require("../electron/updater.cjs");

test("update check, download progress, and restart follow the packaged app flow", async () => {
  const source = new EventEmitter();
  source.currentVersion = { version: "0.2.0-beta.19", prerelease: ["beta", 19] };
  const seen = [];
  let installed = false;
  source.checkForUpdates = async () => {
    source.emit("checking-for-update");
    source.emit("update-available", { version: "0.2.0-beta.20" });
  };
  source.downloadUpdate = async () => {
    source.emit("download-progress", { percent: 42.6, transferred: 426, total: 1000 });
    source.emit("update-downloaded", { version: "0.2.0-beta.20" });
  };
  source.quitAndInstall = () => { installed = true; };
  const controller = createUpdateController(source, (state) => seen.push(state));
  assert.equal(source.autoDownload, false);
  assert.equal(source.allowPrerelease, true);
  assert.throws(() => controller.install(), /Download the update/);
  await controller.check();
  assert.equal(controller.status().status, "available");
  await controller.download();
  assert.deepEqual(seen.map((state) => state.status),
    ["checking", "available", "downloading", "downloading", "downloaded"]);
  assert.equal(seen[3].percent, 43);
  assert.equal(controller.status().version, "0.2.0-beta.20");
  controller.install();
  assert.equal(controller.status().status, "installing");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(installed, true);
});

test("a missing metadata file for the installed release reports up to date", async () => {
  const source = new EventEmitter();
  source.currentVersion = { version: "0.3.1" };
  source.checkForUpdates = async () => {
    source.emit("checking-for-update");
    const error = new Error("Cannot find latest-mac.yml in the latest release artifacts (https://github.com/coryfail/AssistedWriter/releases/download/v0.3.1/latest-mac.yml): HttpError: 404");
    error.code = "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND";
    source.emit("error", error);
    throw error;
  };
  const controller = createUpdateController(source);
  assert.equal(source.allowPrerelease, false);
  assert.deepEqual(await controller.check(), { status: "not-available", version: "0.3.1" });
});

test("a newer release still uploading metadata gives a short retry message", async () => {
  const source = new EventEmitter();
  source.currentVersion = { version: "0.3.1" };
  source.checkForUpdates = async () => {
    const error = new Error("Cannot find latest-mac.yml in the latest release artifacts (https://github.com/coryfail/AssistedWriter/releases/download/v0.3.2/latest-mac.yml): HttpError: 404");
    error.code = "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND";
    throw error;
  };
  const controller = createUpdateController(source);
  assert.deepEqual(await controller.check(), {
    status: "error",
    message: "The latest release is still being published. Try again shortly.",
  });
});
