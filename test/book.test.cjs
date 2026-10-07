const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const JSZip = require("jszip");
const book = require("../electron/book.cjs");
const { exportBook } = require("../electron/export.cjs");
const { buildReviewInput } = require("../electron/ai.cjs");

test("readable book files, approved edits, and publication exports", async (t) => {
  const parent = await fs.mkdtemp(
    path.join(os.tmpdir(), "assisted-writer-test-"),
  );
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = await book.createBook(parent, "The Lantern Room", "Test Author");
  const first = (await book.readBook(root)).chapters[0];
  const body =
    "The lamp *flickered* in the empty room. ~~Yesterday.~~\n\n1. First sign\n2. Second sign\n\n> Remember the door.\n\n---\n\nSomething moved.";
  await book.saveChapter(root, first.id, body, "The Opening");
  await book.saveNotes(
    root,
    first.id,
    "# Chapter notes\n\nThe lamp is an omen.\n",
  );
  await book.saveNotes(root, "book", "# Book Notes\n\nThe house is old.\n");
  const brainstorm = await book.appendNote(root, "book", first.id,
    { title: "A hidden room", content: "Maybe the house hides a room behind the library.\n\n- Why was it sealed?" });
  assert.match(brainstorm.bookNotes, /The house is old\.[\s\S]*## A hidden room/);
  assert.match(brainstorm.bookNotes, /Why was it sealed\?/);
  const chapterBrainstorm = await book.appendNote(root, "chapter", first.id,
    { title: "Lamp clue", content: "The flicker could signal someone nearby." });
  assert.match(chapterBrainstorm.chapters[0].notes, /The lamp is an omen\.[\s\S]*## Lamp clue/);
  assert.equal(chapterBrainstorm.chapters[0].body, body);
  await assert.rejects(book.appendNote(root, "invalid", first.id,
    { title: "No", content: "No" }), /Unknown notes destination/);
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
  assert.match(chapter, /<del>Yesterday\.<\/del>/);
  assert.match(chapter, /1\. First sign/);
  assert.ok(epub.file("OEBPS/nav.xhtml"));
  const docx = await JSZip.loadAsync(await fs.readFile(destinations[0]));
  const wordXml = await docx.file("word/document.xml").async("string");
  assert.match(wordXml, /A shadow moved/);
  assert.match(wordXml, /<w:strike\b/);
  assert.doesNotMatch(wordXml, /The lamp is an omen|The house is old/);
  assert.equal(
    (await fs.readFile(destinations[2])).subarray(0, 4).toString(),
    "%PDF",
  );
  const afterDelete = await book.deleteChapter(root, next.chapters[1].id);
  assert.deepEqual(afterDelete.chapters.map((c) => c.title), ["The Opening"]);
  await assert.rejects(
    fs.access(path.join(root, "chapters", next.chapters[1].file)),
  );
  await assert.rejects(
    book.deleteChapter(root, first.id),
    /at least one chapter/,
  );
});

test("AI context and story trackers stay readable and respect request scope", async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "assisted-writer-context-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = await book.createBook(parent, "Continuity Book", "Author");
  const first = (await book.readBook(root)).chapters[0];
  await book.saveReference(root, "book-context", null, "# Voice\n\nQuiet, close third.\n");
  await book.saveReference(root, "chapter-context", first.id, "# Scene\n\nAt dawn.\n");
  await book.saveReference(root, "characters", null, "# Characters\n\nMara is 31.\n");
  await book.saveReference(root, "timeline", null, "# Timeline\n\nJune 4: arrival.\n");
  const loaded = await book.readBook(root);
  assert.match(loaded.aiContext, /Quiet, close third/);
  assert.match(loaded.chapters[0].context, /At dawn/);
  assert.match(loaded.references.characters, /Mara is 31/);
  const full = buildReviewInput(loaded, { chapterId: first.id, action: "continuity" }, "instructions");
  assert.match(full.input, /Mara is 31/);
  assert.match(full.input, /At dawn/);
  const brainstormInput = buildReviewInput(loaded,
    { chapterId: first.id, action: "brainstorm", noteRequested: true,
      noteTarget: "characters", question: "What motivates Mara?",
      history: [{ role: "user", text: "Maybe Mara lied about the house." },
        { role: "assistant", text: "What would she gain?" }] }, "instructions");
  assert.match(brainstormInput.input, /Proposed note destination: characters/);
  assert.match(brainstormInput.input, /Mara is 31/);
  assert.match(brainstormInput.input, /Maybe Mara lied about the house/);
  assert.match(brainstormInput.input, /What motivates Mara\?/);
  const conversationInput = buildReviewInput(loaded,
    { chapterId: first.id, action: "brainstorm", noteRequested: false,
      question: "Could this be a family secret?" }, "instructions");
  assert.match(conversationInput.input, /Draft a note now: no/);
  assert.doesNotMatch(conversationInput.input, /Proposed note destination/);
  const proposed = await book.appendNote(root, "characters", first.id,
    { title: "Mara's worry", content: "Possible fear: the house remembers her." });
  assert.match(proposed.references.characters, /Mara is 31\.[\s\S]*## Mara's worry/);
  assert.match(await fs.readFile(path.join(root, "notes", "characters.md"), "utf8"), /the house remembers her/);
  const limited = buildReviewInput(loaded, { chapterId: first.id, action: "continuity",
    context: { bookNotes: false, chapterNotes: false, bookContext: false,
      chapterContext: false, trackers: false, otherChapters: false } }, "instructions");
  assert.doesNotMatch(limited.input, /Mara is 31|At dawn|Quiet, close third|Book notes:|Chapter notes:/);
  assert.match(limited.input, /Current chapter Markdown body:/);
  await assert.rejects(book.saveReference(root, "../outside", null, "bad"), /Unknown reference type/);
  await fs.rm(path.join(root, "notes", "locations.md"));
  assert.match((await book.readBook(root)).references.locations, /# Locations/);
});

test("opening an older book adds reference files and updates agent guidance once", async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "assisted-writer-migrate-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = await book.createBook(parent, "Older Book", "Author");
  const first = (await book.readBook(root)).chapters[0];
  const second = (await book.addChapter(root)).chapters[1];
  const guidePath = path.join(root, "AGENTS.md");
  const originalGuide = "# My book instructions\n\nKeep the author's custom rules.\n";
  await fs.writeFile(guidePath, originalGuide);
  await fs.writeFile(path.join(root, "notes", "characters.md"), "# Characters\n\nMara is 31.\n");
  await fs.writeFile(path.join(root, "notes", "ai-context.md"), "# Voice\n\nKeep the prose spare.\n");
  for (const file of ["locations.md", "timeline.md", "terminology.md"])
    await fs.rm(path.join(root, "notes", file));
  await fs.writeFile(path.join(root, "chapters", first.file.replace(/\.md$/, ".context.md")),
    "# First chapter context\n\nKeep the door locked.\n");
  await fs.rm(path.join(root, "chapters", second.file.replace(/\.md$/, ".context.md")));

  const beforeManifest = await fs.readFile(path.join(root, "book.json"), "utf8");
  const opened = await book.readBook(root);
  assert.equal(opened.chapters.length, 2);
  assert.match(opened.references.characters, /Mara is 31/);
  assert.match(opened.aiContext, /Keep the prose spare/);
  assert.match(opened.chapters[0].context, /Keep the door locked/);
  for (const file of ["locations.md", "timeline.md", "terminology.md"])
    assert.ok((await fs.readFile(path.join(root, "notes", file), "utf8")).startsWith("# "));
  assert.match(await fs.readFile(path.join(root, "chapters", second.file.replace(/\.md$/, ".context.md")), "utf8"), /AI Context/);
  const migratedGuide = await fs.readFile(guidePath, "utf8");
  assert.ok(migratedGuide.startsWith(originalGuide.trimEnd()));
  assert.match(migratedGuide, /notes\/characters\.md/);
  assert.match(migratedGuide, /chapters\/<stem>\.context\.md/);
  assert.match(migratedGuide, /assisted-writer-brainstorm-v1/);
  assert.match(migratedGuide, /author approves each note separately/);
  await book.readBook(root);
  assert.equal(await fs.readFile(guidePath, "utf8"), migratedGuide);
  assert.equal(await fs.readFile(path.join(root, "book.json"), "utf8"), beforeManifest);
});

test("new-book agent instructions describe app-compatible chapter creation", async (t) => {
  const parent = await fs.mkdtemp(
    path.join(os.tmpdir(), "assisted-writer-agent-test-"),
  );
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = await book.createBook(parent, "Agent Ready Book", "Author");
  const instructions = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
  for (const required of [
    "book.json",
    "notes/book.md",
    "notesFile",
    "assisted-writer-1",
    "UUID",
    "chapter-02.notes.md",
    "The app does **not** discover chapters by scanning",
    "Create **both** files",
    "first heading matches its manifest title",
    "author approves",
    "assisted-writer-brainstorm-v1",
  ]) {
    assert.ok(instructions.includes(required), `Missing guidance: ${required}`);
  }

  const manifestFile = path.join(root, "book.json");
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  const chapter = {
    id: crypto.randomUUID(),
    title: "The Second Door",
    file: "chapter-02.md",
    notesFile: "chapter-02.notes.md",
  };
  await fs.writeFile(
    path.join(root, "chapters", chapter.file),
    "# The Second Door\n\nA new scene.\n",
  );
  await fs.writeFile(
    path.join(root, "chapters", chapter.notesFile),
    "# Notes for The Second Door\n\nKeep the door locked.\n",
  );
  manifest.chapters.push(chapter);
  await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  const loaded = await book.readBook(root);
  assert.deepEqual(
    loaded.chapters.map((item) => item.title),
    ["Chapter One", "The Second Door"],
  );
  assert.equal(loaded.chapters[1].body, "A new scene.");
  assert.match(loaded.chapters[1].notes, /Keep the door locked/);
  assert.equal(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), instructions);
});
