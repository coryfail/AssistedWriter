const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const book = require("../electron/book.cjs");
const git = require("../electron/git.cjs");

const exec = promisify(execFile);
const run = (cwd, ...args) => exec("git", args, { cwd });

test("book Git workflow commits selected files and syncs branches", async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "writer-git-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = await book.createBook(parent, "Git Story", "Author");
  assert.equal((await git.status(root)).initialized, false);
  await git.initialize(root);
  await run(root, "config", "user.name", "Test Author");
  await run(root, "config", "user.email", "test@example.com");
  const initial = await git.status(root);
  assert.equal(initial.branch, "main");
  assert.ok(initial.files.some((file) => file.path === "book.json"));
  assert.match(await git.diff(root, "book.json"), /Git Story/);
  const selected = initial.files
    .filter((file) => file.path !== "notes/book.md")
    .map((file) => file.path);
  await git.commit(root, "Start book", selected);
  assert.deepEqual(
    (await git.status(root)).files.map((file) => file.path),
    ["notes/book.md"],
  );
  await assert.rejects(
    git.switchBranch(root, "main"),
    /Commit or otherwise resolve changes/,
  );
  await git.commit(root, "Add book notes", ["notes/book.md"]);
  await git.createBranch(root, "revision");
  const chapter = (await book.readBook(root)).chapters[0];
  await book.saveChapter(root, chapter.id, "A changed scene.", chapter.title);
  assert.match(
    await git.diff(root, `chapters/${chapter.file}`),
    /A changed scene/,
  );
  await git.commit(root, "Revise opening", [`chapters/${chapter.file}`]);
  await git.switchBranch(root, "main");
  assert.equal((await book.readBook(root)).chapters[0].body, "");
  const remote = path.join(parent, "remote.git");
  await run(parent, "init", "--bare", remote);
  await git.setRemote(root, remote);
  await git.sync(root, "push");
  assert.equal((await git.status(root)).upstream, "origin/main");
  await git.sync(root, "fetch");
  await git.sync(root, "pull");
});
