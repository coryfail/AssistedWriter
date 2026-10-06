const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld("writer", {
  recent: () => invoke("book:recent"),
  createBook: (title, author) => invoke("book:create", title, author),
  openBook: () => invoke("book:open"),
  loadBook: (root) => invoke("book:load", root),
  addChapter: (root) => invoke("chapter:add", root),
  saveChapter: (root, id, body, title) =>
    invoke("chapter:save", root, id, body, title),
  reorderChapter: (root, id, direction) =>
    invoke("chapter:reorder", root, id, direction),
  deleteChapter: (root, id) => invoke("chapter:delete", root, id),
  saveNotes: (root, id, content) => invoke("notes:save", root, id, content),
  saveMetadata: (root, values) => invoke("book:metadata", root, values),
  keyStatus: () => invoke("settings:key-status"),
  setKey: (key) => invoke("settings:set-key", key),
  checkForUpdates: () => invoke("update:check"),
  downloadUpdate: () => invoke("update:download"),
  installUpdate: () => invoke("update:install"),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
  review: (root, options) => invoke("ai:review", root, options),
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
