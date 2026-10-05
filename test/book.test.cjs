const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const JSZip = require("jszip");
const book = require("../electron/book.cjs");
const { exportBook } = require("../electron/export.cjs");

test("readable book files, approved edits, and publication exports", async (t) => {
  const parent = await fs.mkdtemp(
    path.join(os.tmpdir(), "assisted-writer-test-"),
  );
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = await book.createBook(parent, "The Lantern Room", "Test Author");
  const first = (await book.readBook(root)).chapters[0];
  const body =
    "The lamp *flickered* in the empty room.\n\n---\n\nSomething moved.";
  await book.saveChapter(root, first.id, body, "The Opening");
  await book.saveNotes(
    root,
    first.id,
    "# Chapter notes\n\nThe lamp is an omen.\n",
  );
  await book.saveNotes(root, "book", "# Book Notes\n\nThe house is old.\n");
  const next = await book.addChapter(root);
  assert.deepEqual(
    next.chapters.map((c) => c.title),
    ["The Opening", "Chapter 2"],
  );
  const reordered = await book.reorderChapter(root, next.chapters[1].id, -1);
  assert.deepEqual(
    reordered.chapters.map((c) => c.title),
    ["Chapter 2", "The Opening"],
  );
  assert.match(
    await fs.readFile(path.join(root, "AGENTS.md"), "utf8"),
    /author writes the final manuscript/i,
  );
  assert.equal(
    await fs.readFile(path.join(root, "chapters", first.file), "utf8"),
    `# The Opening\n\n${body}\n`,
  );

  const hash = crypto.createHash("sha256").update(body).digest("hex");
  await assert.rejects(
    book.approveSuggestion(root, first.id, "The lamp", "A lamp", "stale"),
    /changed since this review/,
  );
  const applied = await book.approveSuggestion(
    root,
    first.id,
    "Something moved.",
    "A shadow moved.",
    hash,
  );
  assert.match(applied.body, /A shadow moved\./);
  assert.doesNotMatch(applied.body, /Something moved\./);

  const destinations = ["docx", "epub", "pdf"].map((ext) =>
    path.join(parent, `export.${ext}`),
  );
  await Promise.all(
    destinations.map((dest, i) =>
      exportBook(root, ["docx", "epub", "pdf"][i], dest),
    ),
  );
  for (const destination of destinations)
    assert.ok((await fs.stat(destination)).size > 1000);
  const epub = await JSZip.loadAsync(await fs.readFile(destinations[1]));
  const opf = await epub.file("OEBPS/content.opf").async("string");
  const chapter = await epub.file("OEBPS/chapter-2.xhtml").async("string");
  assert.match(opf, /The Lantern Room/);
  assert.match(chapter, /<em>flickered<\/em>/);
  assert.ok(epub.file("OEBPS/nav.xhtml"));
  const docx = await JSZip.loadAsync(await fs.readFile(destinations[0]));
  const wordXml = await docx.file("word/document.xml").async("string");
  assert.match(wordXml, /A shadow moved/);
  assert.doesNotMatch(wordXml, /The lamp is an omen|The house is old/);
  assert.equal(
    (await fs.readFile(destinations[2])).subarray(0, 4).toString(),
    "%PDF",
  );
});
