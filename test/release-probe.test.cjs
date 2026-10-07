const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { compareVersions, probePublishedRelease } = require("../electron/release-probe.cjs");
const { createUpdateController } = require("../electron/updater.cjs");

test("published release probe recognizes a newer release with update metadata", async () => {
  assert.equal(compareVersions("0.4.1", "0.4.0"), 1);
  assert.equal(compareVersions("0.4.0", "0.4.0-beta.1"), 1);
  const request = async (_url, options) => {
    assert.equal(options.headers["Cache-Control"], "no-cache");
    return { ok: true, json: async () => [
      { tag_name: "v0.4.2", draft: true, assets: [{ name: "latest-mac.yml" }] },
      { tag_name: "v0.4.1", prerelease: false, assets: [{ name: "latest-mac.yml" }] },
      { tag_name: "v0.4.0", prerelease: false, assets: [{ name: "latest-mac.yml" }] },
    ] };
  };
  assert.equal(await probePublishedRelease("0.4.0", request), "0.4.1");
  assert.equal(await probePublishedRelease("0.4.1", request), null);
});

test("stale updater feed reports pending instead of up to date", async () => {
  const source = new EventEmitter();
  source.currentVersion = { version: "0.4.0" };
  source.checkForUpdates = async () => source.emit("update-not-available", { version: "0.4.0" });
  const controller = createUpdateController(source, () => {}, async () => "0.4.1");
  assert.deepEqual(await controller.check(), { status: "pending", version: "0.4.1" });
});
