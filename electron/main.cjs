const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const { createUpdateController } = require("./updater.cjs");
const { contextMenuTemplate } = require("./context-menu.cjs");
const { probePublishedRelease } = require("./release-probe.cjs");
const fs = require("node:fs/promises");
const nativeFs = require("node:fs");
const path = require("node:path");
const book = require("./book.cjs");
const { review, generateCommitMessage } = require("./ai.cjs");
const { exportBook } = require("./export.cjs");
const git = require("./git.cjs");
const { networkAddresses, startWebAccess, TAILSCALE_COMMAND } = require("./web-access.cjs");

let mainWindow;
let activeBookWatch = null;
let webAccess = null;
let webStarting = null;
app.setName("Assisted Writer");
const recentFile = () => path.join(app.getPath("userData"), "recent.json");
const keyFile = () => path.join(app.getPath("userData"), "api-key.enc");

async function recent() {
  try {
    const paths = JSON.parse(await fs.readFile(recentFile(), "utf8"));
    const existing = await Promise.all(
      paths.map(async (root) => {
        try {
          await fs.access(path.join(root, "book.json"));
          return root;
        } catch {
          return null;
        }
      }),
    );
    return existing.filter(Boolean);
  } catch {
    return [];
  }
}
async function remember(root) {
  const items = (await recent()).filter((item) => item !== root);
  await fs.writeFile(
    recentFile(),
    JSON.stringify([root, ...items].slice(0, 8)),
  );
}
async function getKey() {
  try {
    const encrypted = await fs.readFile(keyFile());
    return safeStorage.decryptString(encrypted).trim();
  } catch {
    return "";
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 680,
    title: "Assisted Writer",
    backgroundColor: "#f6f2ea",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const template = contextMenuTemplate(params, mainWindow.webContents);
    if (template.length) Menu.buildFromTemplate(template).popup({
      window: mainWindow,
      frame: params.frame || undefined,
    });
  });
  mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

function revisionSnapshot(data) {
  const revisions = data.revisions || {};
  const snapshot = {
    "book.json": revisions.manifest,
    "notes/book.md": revisions.bookNotes,
    "notes/ai-context.md": revisions.aiContext,
    "AGENTS.md": revisions.agentGuide,
  };
  for (const chapter of data.chapters || []) {
    snapshot[`chapters/${chapter.file}`] = revisions.chapters?.[chapter.id];
    snapshot[`chapters/${chapter.notesFile}`] = revisions.notes?.[chapter.id];
    snapshot[`chapters/${chapter.file.slice(0, -3)}.context.md`] = revisions.contexts?.[chapter.id];
  }
  for (const [kind, hash] of Object.entries(revisions.references || {}))
    snapshot[`notes/${kind}.md`] = hash;
  return snapshot;
}

function setBookWatchSnapshot(root, data) {
  if (activeBookWatch?.root === root)
    activeBookWatch.snapshot = revisionSnapshot(data);
}

function recordBookRevision(root, relativePath, hash) {
  if (activeBookWatch?.root === root && hash)
    activeBookWatch.snapshot[relativePath] = hash;
}

function closeBookWatch() {
  if (!activeBookWatch) return;
  clearTimeout(activeBookWatch.timer);
  for (const watcher of activeBookWatch.watchers) watcher.close();
  activeBookWatch = null;
}

function watchRelevantFile(filename) {
  if (!filename) return true;
  const file = String(filename);
  return [".md", ".json", ".yaml", ".yml", ".toml"].includes(path.extname(file).toLowerCase());
}

async function installBookWatchers(state) {
  const directories = [];
  async function visit(directory) {
    directories.push(directory);
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "exports")
        await visit(path.join(directory, entry.name));
    }
  }
  await visit(state.root);
  if (activeBookWatch !== state) return;
  for (const directory of directories) {
    try {
      const watcher = nativeFs.watch(directory, { persistent: false }, (_event, filename) => {
        if (!watchRelevantFile(filename)) return;
        scheduleBookRefresh(state, directory === state.root || !filename
          ? ""
          : path.relative(state.root, path.join(directory, String(filename))));
      });
      watcher.on("error", () => {});
      state.watchers.push(watcher);
    } catch { /* A removed directory will be picked up on the next refresh. */ }
  }
  // Catch changes made while the directory watches were being installed.
  scheduleBookRefresh(state, "");
}

function scheduleBookRefresh(state, changedPath) {
  if (activeBookWatch !== state) return;
  if (changedPath && /(^|\/)\.[^/]+\.tmp$/.test(changedPath)) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    if (activeBookWatch !== state) return;
    try {
      const data = await book.withBookOperation(state.root, () => book.readBook(state.root));
      const next = revisionSnapshot(data);
      const paths = new Set([...Object.keys(state.snapshot), ...Object.keys(next)]);
      const changed = [...paths].filter((file) => state.snapshot[file] !== next[file]);
      state.snapshot = next;
      if (changed.length)
        mainWindow?.webContents.send("book:changed", { root: state.root, book: data, changed });
      // Refresh directory watches after a manifest change creates/removes chapter files.
      if (changed.includes("book.json")) {
        for (const watcher of state.watchers) watcher.close();
        state.watchers = [];
        await installBookWatchers(state);
      }
    } catch (error) {
      mainWindow?.webContents.send("book:changed", {
        root: state.root,
        error: error.message,
      });
    }
  }, 180);
}

function watchBook(root, data) {
  if (activeBookWatch?.root === root) {
    activeBookWatch.snapshot = revisionSnapshot(data);
    return;
  }
  if (activeBookWatch) stopWebAccess();
  closeBookWatch();
  const state = {
    root,
    snapshot: revisionSnapshot(data),
    watchers: [],
    timer: null,
  };
  activeBookWatch = state;
  installBookWatchers(state).catch(() => {});
}

const updater = createUpdateController(autoUpdater, (status) =>
  mainWindow?.webContents.send("update:status", status), probePublishedRelease);

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]));
  createWindow();
  if (app.isPackaged) {
    setTimeout(() => updater.check().catch(() => {}), 2500);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  closeBookWatch();
  stopWebAccess();
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", stopWebAccess);

function webAccessStatus() {
  return { ...(webAccess?.status() || { enabled: false }), addresses: networkAddresses(), remoteCommand: TAILSCALE_COMMAND };
}

function stopWebAccess() {
  const active = webAccess;
  webAccess = null;
  webStarting = null;
  return active?.stop();
}

ipcMain.handle("web:status", webAccessStatus);
ipcMain.handle("web:start", async (_event, options) => {
  if (webAccess || webStarting) throw new Error("Web Access is already on or starting.");
  const root = activeBookWatch?.root;
  if (!root) throw new Error("Open a book before enabling Web Access.");
  const { mode, host, remoteUrl } = options || {};
  if (mode !== "lan" && mode !== "remote") throw new Error("Choose a Web Access connection mode.");
  if (mode === "lan" && !networkAddresses().some((item) => item.address === host))
    throw new Error("Choose an available home network address.");
  if (mode === "remote" && typeof remoteUrl !== "string")
    throw new Error("Enter the HTTPS address shown by Tailscale Serve.");
  const starting = startWebAccess({
    root, host, dist: path.join(__dirname, "..", "dist"),
    ...(mode === "remote" ? { remoteUrl } : {}),
    onSave() { if (activeBookWatch) scheduleBookRefresh(activeBookWatch, ""); },
  });
  webStarting = starting;
  try {
    const access = await starting;
    if (webStarting !== starting) await access.stop();
    else webAccess = access;
    return webAccessStatus();
  } finally {
    if (webStarting === starting) webStarting = null;
  }
});
ipcMain.handle("web:stop", async () => { await stopWebAccess(); return webAccessStatus(); });
ipcMain.handle("web:renew-code", () => { webAccess?.renewCode(); return webAccessStatus(); });
ipcMain.handle("web:disconnect", () => { webAccess?.disconnect(); return webAccessStatus(); });

function handleBook(channel, handler) {
  ipcMain.handle(channel, (event, root, ...args) =>
    book.withBookOperation(root, () => handler(event, root, ...args)));
}

ipcMain.handle("book:recent", recent);
ipcMain.handle("book:create", async (_event, title, author) => {
  if (!String(title || "").trim()) throw new Error("Enter a book title.");
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose where to create the book folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled) return null;
  const root = await book.createBook(
    result.filePaths[0],
    String(title),
    String(author || ""),
  );
  await remember(root);
  const data = await book.withBookOperation(root, () => book.readBook(root));
  watchBook(root, data);
  return data;
});
ipcMain.handle("book:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open an Assisted Writer book folder",
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;
  const root = result.filePaths[0];
  const data = await book.withBookOperation(root, () => book.readBook(root));
  await remember(root);
  watchBook(root, data);
  return data;
});
handleBook("book:load", async (_event, root) => {
  const data = await book.readBook(root);
  await remember(root);
  watchBook(root, data);
  return data;
});
ipcMain.handle("book:unwatch", async () => {
  closeBookWatch();
  await stopWebAccess();
});
handleBook("chapter:add", async (_event, root) => {
  const data = await book.addChapter(root);
  setBookWatchSnapshot(root, data);
  return data;
});
handleBook("chapter:save", async (_event, root, id, body, title, expectedRevision, expectedManifestRevision) => {
  const saved = await book.saveChapter(root, id, body, title, expectedRevision, expectedManifestRevision);
  recordBookRevision(root, `chapters/${saved.file}`, saved.revisions.chapter);
  recordBookRevision(root, "book.json", saved.revisions.manifest);
  return saved;
});
handleBook("chapter:reorder", async (_event, root, id, direction) => {
  const data = await book.reorderChapter(root, id, direction);
  setBookWatchSnapshot(root, data);
  return data;
});
handleBook("chapter:delete", async (_event, root, id) => {
  const data = await book.deleteChapter(root, id);
  setBookWatchSnapshot(root, data);
  return data;
});
handleBook("notes:save", async (_event, root, id, content, expectedRevision) => {
  const hash = await book.saveNotes(root, id, content, expectedRevision);
  const manifest = await book.loadManifest(root);
  const chapter = manifest.chapters.find((item) => item.id === id);
  const file = id === "book" ? "notes/book.md" : `chapters/${chapter.notesFile}`;
  recordBookRevision(root, file, hash);
  return hash;
});
handleBook("notes:append", async (_event, root, target, chapterId, note) => {
  const data = await book.appendNote(root, target, chapterId, note);
  setBookWatchSnapshot(root, data);
  return data;
});
handleBook("reference:save", async (_event, root, kind, chapterId, content, expectedRevision) => {
  const hash = await book.saveReference(root, kind, chapterId, content, expectedRevision);
  const manifest = await book.loadManifest(root);
  const chapter = manifest.chapters.find((item) => item.id === chapterId);
  const file = kind === "book-context" ? "notes/ai-context.md"
    : ["characters", "locations", "timeline", "terminology"].includes(kind)
      ? `notes/${kind}.md`
      : `chapters/${chapter.file.slice(0, -3)}.context.md`;
  recordBookRevision(root, file, hash);
  return hash;
});
handleBook("book:metadata", async (_event, root, values, expectedRevision) => {
  const data = await book.saveMetadata(root, values, expectedRevision);
  setBookWatchSnapshot(root, data);
  return data;
});
ipcMain.handle("settings:key-status", async () => Boolean(await getKey()));
ipcMain.handle("settings:set-key", async (_event, value) => {
  const key = String(value || "").trim();
  if (!key) {
    await fs.rm(keyFile(), { force: true });
    return false;
  }
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("Mac Keychain encryption is unavailable.");
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(keyFile(), safeStorage.encryptString(key), {
    mode: 0o600,
  });
  return true;
});
ipcMain.handle("update:check", async () => {
  if (!app.isPackaged) return { status: "unavailable" };
  return updater.check();
});
ipcMain.handle("update:status", () => updater.status());
ipcMain.handle("update:download", async () => {
  if (!app.isPackaged) return { status: "unavailable" };
  return updater.download();
});
ipcMain.handle("update:install", () => {
  if (!app.isPackaged) return { status: "unavailable" };
  return updater.install();
});
ipcMain.handle("ai:review", async (_event, root, options) => {
  const key = await getKey();
  if (!key) throw new Error("Add your OpenAI API key in Settings first.");
  return review(root, options, key);
});
ipcMain.handle("ai:commit-message", async (_event, root, files) => {
  const key = await getKey();
  if (!key) throw new Error("Add your OpenAI API key in Settings first.");
  return generateCommitMessage(root, files, key);
});
handleBook(
  "ai:approve",
  async (_event, root, chapterId, quote, replacement, hash) => {
    const result = await book.approveSuggestion(root, chapterId, quote, replacement, hash);
    const manifest = await book.loadManifest(root);
    const chapter = manifest.chapters.find((item) => item.id === chapterId);
    recordBookRevision(root, `chapters/${chapter.file}`, result.revision);
    return result;
  },
);
ipcMain.handle("book:export", async (_event, root, format) => {
  if (!["docx", "epub", "pdf"].includes(format))
    throw new Error("Unsupported export format.");
  const result = await dialog.showSaveDialog(mainWindow, {
    title: `Export ${format.toUpperCase()}`,
    defaultPath: path.join(root, "exports", `${path.basename(root)}.${format}`),
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (result.canceled) return null;
  await exportBook(root, format, result.filePath);
  return result.filePath;
});
ipcMain.handle("git:status", (_event, root) => git.status(root));
ipcMain.handle("git:init", (_event, root) => git.initialize(root));
ipcMain.handle("git:diff", (_event, root, file) => git.diff(root, file));
ipcMain.handle("git:commit", (_event, root, message, files) =>
  git.commit(root, message, files),
);
handleBook("git:switch", (_event, root, branch) =>
  git.switchBranch(root, branch),
);
handleBook("git:create-branch", (_event, root, branch) =>
  git.createBranch(root, branch),
);
ipcMain.handle("git:remote", (_event, root, url) => git.setRemote(root, url));
handleBook("git:sync", (_event, root, action) => git.sync(root, action));
