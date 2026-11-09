const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld("writer", {
  webStatus: () => invoke("web:status"),
  webStart: (host) => invoke("web:start", host),
  webStop: () => invoke("web:stop"),
  webRenewCode: () => invoke("web:renew-code"),
  webDisconnect: () => invoke("web:disconnect"),
  recent: () => invoke("book:recent"),
  createBook: (title, author) => invoke("book:create", title, author),
  openBook: () => invoke("book:open"),
  loadBook: (root) => invoke("book:load", root),
  closeBook: () => invoke("book:unwatch"),
  addChapter: (root) => invoke("chapter:add", root),
  saveChapter: (root, id, body, title, expectedRevision, expectedManifestRevision) =>
    invoke("chapter:save", root, id, body, title, expectedRevision, expectedManifestRevision),
  reorderChapter: (root, id, direction) =>
    invoke("chapter:reorder", root, id, direction),
  deleteChapter: (root, id) => invoke("chapter:delete", root, id),
  saveNotes: (root, id, content, expectedRevision) =>
    invoke("notes:save", root, id, content, expectedRevision),
  appendNote: (root, target, chapterId, note) =>
    invoke("notes:append", root, target, chapterId, note),
  saveReference: (root, kind, chapterId, content, expectedRevision) =>
    invoke("reference:save", root, kind, chapterId, content, expectedRevision),
  saveMetadata: (root, values, expectedRevision) =>
    invoke("book:metadata", root, values, expectedRevision),
  onBookChanged: (callback) => {
    const listener = (_event, change) => callback(change);
    ipcRenderer.on("book:changed", listener);
    return () => ipcRenderer.removeListener("book:changed", listener);
  },
  keyStatus: () => invoke("settings:key-status"),
  setKey: (key) => invoke("settings:set-key", key),
  checkForUpdates: () => invoke("update:check"),
  updateStatus: () => invoke("update:status"),
  downloadUpdate: () => invoke("update:download"),
  installUpdate: () => invoke("update:install"),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
  review: (root, options) => invoke("ai:review", root, options),
  generateCommitMessage: (root, files) => invoke("ai:commit-message", root, files),
  approve: (root, chapterId, quote, replacement, hash) =>
    invoke("ai:approve", root, chapterId, quote, replacement, hash),
  export: (root, format) => invoke("book:export", root, format),
  gitStatus: (root) => invoke("git:status", root),
  gitInit: (root) => invoke("git:init", root),
  gitDiff: (root, file) => invoke("git:diff", root, file),
  gitCommit: (root, message, files) =>
    invoke("git:commit", root, message, files),
  gitSwitch: (root, branch) => invoke("git:switch", root, branch),
  gitCreateBranch: (root, branch) => invoke("git:create-branch", root, branch),
  gitRemote: (root, url) => invoke("git:remote", root, url),
  gitSync: (root, action) => invoke("git:sync", root, action),
});
