const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const { createUpdateController } = require("./updater.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const book = require("./book.cjs");
const { review } = require("./ai.cjs");
const { exportBook } = require("./export.cjs");
const git = require("./git.cjs");

let mainWindow;
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
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

const updater = createUpdateController(autoUpdater, (status) =>
  mainWindow?.webContents.send("update:status", status));

app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) {
    setTimeout(() => updater.check().catch(() => {}), 2500);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

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
  return book.readBook(root);
});
ipcMain.handle("book:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open an Assisted Writer book folder",
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;
  const root = result.filePaths[0];
  const data = await book.readBook(root);
  await remember(root);
  return data;
});
ipcMain.handle("book:load", async (_event, root) => {
  const data = await book.readBook(root);
  await remember(root);
  return data;
});
ipcMain.handle("chapter:add", (_event, root) => book.addChapter(root));
ipcMain.handle("chapter:save", (_event, root, id, body, title) =>
  book.saveChapter(root, id, body, title),
);
ipcMain.handle("chapter:reorder", (_event, root, id, direction) =>
  book.reorderChapter(root, id, direction),
);
ipcMain.handle("chapter:delete", (_event, root, id) =>
  book.deleteChapter(root, id),
);
ipcMain.handle("notes:save", (_event, root, id, content) =>
  book.saveNotes(root, id, content),
);
ipcMain.handle("reference:save", (_event, root, kind, chapterId, content) =>
  book.saveReference(root, kind, chapterId, content),
);
ipcMain.handle("book:metadata", (_event, root, values) =>
  book.saveMetadata(root, values),
);
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
ipcMain.handle(
  "ai:approve",
  (_event, root, chapterId, quote, replacement, hash) =>
    book.approveSuggestion(root, chapterId, quote, replacement, hash),
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
ipcMain.handle("git:switch", (_event, root, branch) =>
  git.switchBranch(root, branch),
);
ipcMain.handle("git:create-branch", (_event, root, branch) =>
  git.createBranch(root, branch),
);
ipcMain.handle("git:remote", (_event, root, url) => git.setRemote(root, url));
ipcMain.handle("git:sync", (_event, root, action) => git.sync(root, action));
