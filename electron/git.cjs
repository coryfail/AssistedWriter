const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const book = require("./book.cjs");

const exec = promisify(execFile);
const limit = 5 * 1024 * 1024;

async function rootForBook(root) {
  await book.loadManifest(root);
  return await fs.realpath(root);
}

async function git(root, args, options = {}) {
  try {
    const { stdout } = await exec("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: limit,
      timeout: 120000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      ...options,
    });
    return stdout;
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error("Git is not installed on this Mac.");
    const detail = String(error.stderr || error.message || "Git failed").trim();
    throw new Error(detail.replace(/^fatal: /, ""));
  }
}

async function repository(root) {
  try {
    const top = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
    return path.resolve(top) === root;
  } catch {
    return false;
  }
}

function parseStatus(output) {
  const entries = output.split("\0");
  const files = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const code = entry.slice(0, 2);
    const name = entry.slice(3);
    if (code.includes("R") || code.includes("C")) i++;
    files.push({ path: name, code });
  }
  return files;
}

async function status(inputRoot) {
  const root = await rootForBook(inputRoot);
  if (!(await repository(root))) return { initialized: false };
  const branch = (await git(root, ["branch", "--show-current"])).trim();
  const branches = (
    await git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const files = parseStatus(
    await git(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]),
  );
  const upstream = await git(root, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ])
    .then((value) => value.trim())
    .catch(() => "");
  let ahead = 0,
    behind = 0;
  if (upstream) {
    const counts = (
      await git(root, [
        "rev-list",
        "--left-right",
        "--count",
        `${upstream}...HEAD`,
      ])
    )
      .trim()
      .split(/\s+/);
    behind = Number(counts[0] || 0);
    ahead = Number(counts[1] || 0);
  }
  const remote = (
    await git(root, ["remote", "get-url", "origin"]).catch(() => "")
  ).trim();
  return {
    initialized: true,
    branch,
    branches,
    files,
    upstream,
    ahead,
    behind,
    remote,
  };
}

async function initialize(inputRoot) {
  const root = await rootForBook(inputRoot);
  if (await repository(root))
    throw new Error("This book already has a Git repository.");
  await git(root, ["init", "-b", "main"]);
  await fs
    .writeFile(path.join(root, ".gitignore"), "exports/\n.DS_Store\n", {
      flag: "wx",
    })
    .catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
  return status(root);
}

async function diff(inputRoot, filePath) {
  const root = await rootForBook(inputRoot);
  const state = await status(root);
  if (!state.initialized) throw new Error("Set up Git for this book first.");
  const file = state.files.find((item) => item.path === filePath);
  if (!file) throw new Error("This file has no changes to preview.");
  if (file.code === "??") {
    const full = path.resolve(root, file.path);
    if (!full.startsWith(root + path.sep))
      throw new Error("Invalid file path.");
    if ((await fs.lstat(full)).isSymbolicLink())
      return "Symlink preview unavailable.";
    const content = await fs.readFile(full);
    if (content.length > 200000 || content.includes(0))
      return "Binary or large file; preview unavailable.";
    return `New file: ${file.path}\n\n${content.toString("utf8")}`;
  }
  return await git(root, ["diff", "HEAD", "--", file.path]).catch(async () =>
    git(root, ["diff", "--cached", "--", file.path]),
  );
}

async function commit(inputRoot, message, selectedPaths) {
  const root = await rootForBook(inputRoot);
  const state = await status(root);
  if (!state.initialized) throw new Error("Set up Git for this book first.");
  if (!String(message || "").trim()) throw new Error("Enter a commit message.");
  if (!Array.isArray(selectedPaths) || !selectedPaths.length)
    throw new Error("Select at least one changed file.");
  const allowed = new Set(state.files.map((file) => file.path));
  if (selectedPaths.some((file) => !allowed.has(file)))
    throw new Error("Changed files have changed. Refresh Git status.");
  await git(root, ["add", "--", ...selectedPaths]);
  await git(root, [
    "commit",
    "--only",
    "-m",
    String(message).trim(),
    "--",
    ...selectedPaths,
  ]);
  return status(root);
}

async function switchBranch(inputRoot, branch) {
  const root = await rootForBook(inputRoot);
  const state = await status(root);
  if (!state.initialized) throw new Error("Set up Git for this book first.");
  if (state.files.length)
    throw new Error(
      "Commit or otherwise resolve changes before switching branches.",
    );
  if (!state.branches.includes(branch))
    throw new Error("Branch not found. Refresh Git status.");
  await git(root, ["switch", branch]);
  await book.readBook(root);
  return status(root);
}

async function createBranch(inputRoot, branch) {
  const root = await rootForBook(inputRoot);
  const state = await status(root);
  if (!state.initialized) throw new Error("Set up Git for this book first.");
  if (state.files.length)
    throw new Error(
      "Commit or otherwise resolve changes before creating a branch.",
    );
  const name = String(branch || "").trim();
  if (!name || name.startsWith("-"))
    throw new Error("Enter a valid branch name.");
  await git(root, ["check-ref-format", "--branch", name]);
  await git(root, ["switch", "-c", name]);
  return status(root);
}

async function setRemote(inputRoot, url) {
  const root = await rootForBook(inputRoot);
  const state = await status(root);
  if (!state.initialized) throw new Error("Set up Git for this book first.");
  if (state.remote)
    throw new Error(
      "This book already has an origin remote. Change it with Git or Codex.",
    );
  const value = String(url || "").trim();
  if (!value || value.startsWith("-"))
    throw new Error("Enter a valid remote URL.");
  await git(root, ["remote", "add", "origin", value]);
  return status(root);
}

async function sync(inputRoot, action) {
  const root = await rootForBook(inputRoot);
  const state = await status(root);
  if (!state.initialized) throw new Error("Set up Git for this book first.");
  if (!state.remote) throw new Error("Add an origin remote first.");
  if (!state.branch)
    throw new Error("Create a commit before syncing this book.");
  if (action === "fetch") await git(root, ["fetch", "origin"]);
  else if (action === "pull") {
    if (state.files.length)
      throw new Error("Commit or otherwise resolve changes before pulling.");
    if (!state.upstream)
      throw new Error(
        "This branch has no upstream yet. Push it first or set its upstream with Git.",
      );
    await git(root, ["pull", "--ff-only"]);
    await book.readBook(root);
  } else if (action === "push") {
    if (state.upstream) await git(root, ["push"]);
    else await git(root, ["push", "-u", "origin", state.branch]);
  } else throw new Error("Unsupported Git action.");
  return status(root);
}

module.exports = {
  status,
  initialize,
  diff,
  commit,
  switchBranch,
  createBranch,
  setRemote,
  sync,
};
