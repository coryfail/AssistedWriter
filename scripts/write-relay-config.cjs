const fs = require("node:fs");
const path = require("node:path");
const { relayOrigin } = require("../electron/relay-origin.cjs");
const defaultRelay = "https://assisted-writer-relay.fly.dev";
const url = relayOrigin(process.env.ASSISTED_WRITER_RELAY_URL || defaultRelay, { allowLocal: true });
const file = path.resolve(__dirname, "../dist/relay-config.json");
if (url) fs.writeFileSync(file, JSON.stringify({ url }) + "\n");
else fs.rmSync(file, { force: true });
