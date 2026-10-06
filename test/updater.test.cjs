const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createUpdateController } = require("../electron/updater.cjs");

test("update check, download progress, and restart follow the packaged app flow", async () => {
  const source = new EventEmitter();
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
