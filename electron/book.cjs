const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const slug = (value) =>
  String(value || "untitled")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "untitled";
const manifestPath = (root) => path.join(root, "book.json");
const chapterPath = (root, chapter) =>
  path.join(root, "chapters", chapter.file);
const notePath = (root, chapter) =>
  path.join(root, "chapters", chapter.notesFile);
const referenceNames = ["characters", "locations", "timeline", "terminology"];
const noteTargets = ["book", "chapter", ...referenceNames];
const referencePath = (root, name) =>
  path.join(root, "notes", `${name}.md`);
const contextPath = (root) => path.join(root, "notes", "ai-context.md");
const chapterContextPath = (root, chapter) =>
  path.join(root, "chapters", `${chapter.file.slice(0, -3)}.context.md`);
const revision = (content) =>
  crypto.createHash("sha256").update(content).digest("hex");
const externalChangeError = () =>
  new Error("This file changed outside Assisted Writer. The latest version was loaded.");
const readOptional = async (file) => {
  try { return await fs.readFile(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
};
async function writeIfMissing(file, content) {
  try { await fs.writeFile(file, content, { flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
}
async function migrateBookReferences(root, manifest) {
  await fs.mkdir(path.join(root, "notes"), { recursive: true });
  await writeIfMissing(contextPath(root), "# AI Context for This Book\n\n");
  for (const name of referenceNames)
    await writeIfMissing(referencePath(root, name),
      `# ${name[0].toUpperCase()}${name.slice(1)}\n\n`);
  for (const chapter of manifest.chapters)
    await writeIfMissing(chapterContextPath(root, chapter),
      `# AI Context for ${chapter.title}\n\n`);
  const guidePath = path.join(root, "AGENTS.md");
  const guide = await readOptional(guidePath);
  if (!guide.trim()) {
    const template = await fs.readFile(path.join(__dirname, "templates", "book-AGENTS.md"), "utf8");
    await atomicWrite(guidePath, template);
  } else if (!guide.includes("<!-- assisted-writer-context-v1 -->") &&
    !["ai-context.md", "characters.md", "locations.md",
      "timeline.md", "terminology.md", "<manuscript stem>.context.md"]
      .every((name) => guide.includes(name))) {
    const addendum = await fs.readFile(path.join(__dirname, "templates", "book-reference-addendum.md"), "utf8");
    await atomicWrite(guidePath, `${guide.trimEnd()}\n\n${addendum}`);
  }
  const currentGuide = await readOptional(guidePath);
  if (!currentGuide.includes("<!-- assisted-writer-brainstorm-v1 -->")) {
    const addendum = await fs.readFile(path.join(__dirname, "templates", "book-brainstorm-addendum.md"), "utf8");
    await atomicWrite(guidePath, `${currentGuide.trimEnd()}\n\n${addendum}`);
  }
  const latestGuide = await readOptional(guidePath);
  if (!latestGuide.includes("<!-- assisted-writer-entries-v1 -->")) {
    const addendum = await fs.readFile(path.join(__dirname, "templates", "book-entries-addendum.md"), "utf8");
    await atomicWrite(guidePath, `${latestGuide.trimEnd()}\n\n${addendum}`);
  }
  const assistantGuide = await readOptional(guidePath);
  if (!assistantGuide.includes("<!-- assisted-writer-assistant-v2 -->")) {
    const addendum = await fs.readFile(path.join(__dirname, "templates", "book-assistant-addendum.md"), "utf8");
    await atomicWrite(guidePath, `${assistantGuide.trimEnd()}\n\n${addendum}`);
  }
}
const heading = (title, body) => `# ${title}\n\n${body.trim()}\n`;
const withoutHeading = (content) =>
  content.replace(/^# [^\n]*\n(?:\n)?/, "").trim();
async function atomicWrite(file, content, expectedRevision) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content);
    await assertRevision(file, expectedRevision);
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}
const writeJson = async (file, value, expectedRevision) =>
  atomicWrite(file, JSON.stringify(value, null, 2) + "\n", expectedRevision);

async function readManifest(root) {
  const raw = await fs.readFile(manifestPath(root), "utf8");
  const data = JSON.parse(raw);
  if (data.format !== "assisted-writer-1" || !Array.isArray(data.chapters))
    throw new Error("This is not a supported Assisted Writer book.");
  for (const chapter of data.chapters) {
    if (
      !chapter.id ||
      !chapter.title ||
      ![chapter.file, chapter.notesFile].every(
        (name) =>
          typeof name === "string" &&
          name === path.basename(name) &&
          name.endsWith(".md") &&
          !name.startsWith("."),
      )
    )
      throw new Error("The book manifest contains an invalid chapter entry.");
  }
  return { data, raw };
}
async function loadManifest(root) {
  return (await readManifest(root)).data;
}

async function assertRevision(file, expected) {
  if (!expected) return;
  let current;
  try { current = await fs.readFile(file, "utf8"); }
  catch { throw externalChangeError(); }
  if (revision(current) !== expected) throw externalChangeError();
}

async function createBook(parent, title, author) {
  const root = path.join(parent, slug(title));
  await fs.mkdir(root, { recursive: false });
  await fs.mkdir(path.join(root, "chapters"));
  await fs.mkdir(path.join(root, "notes"));
  await fs.mkdir(path.join(root, "editorial"));
  await fs.mkdir(path.join(root, "exports"));
  const chapter = {
    id: crypto.randomUUID(),
    title: "Chapter 1",
    file: "chapter-01.md",
    notesFile: "chapter-01.notes.md",
  };
  const manifest = {
    format: "assisted-writer-1",
    title: title.trim(),
    author: author.trim(),
    genre: "Fiction",
    chapters: [chapter],
    createdAt: new Date().toISOString(),
  };
  await writeJson(manifestPath(root), manifest);
  await fs.writeFile(chapterPath(root, chapter), heading(chapter.title, ""));
  await fs.writeFile(
    notePath(root, chapter),
    `# Notes for ${chapter.title}\n\n`,
  );
  await fs.writeFile(path.join(root, "notes", "book.md"), "# Book Notes\n\n");
  await fs.writeFile(contextPath(root), "# AI Context for This Book\n\n");
  for (const name of referenceNames)
    await fs.writeFile(referencePath(root, name), `# ${name[0].toUpperCase()}${name.slice(1)}\n\n`);
  await fs.writeFile(chapterContextPath(root, chapter), "# AI Context for Chapter 1\n\n");
  const agentGuide = await fs.readFile(
    path.join(__dirname, "templates", "book-AGENTS.md"),
    "utf8",
  );
  await fs.writeFile(path.join(root, "AGENTS.md"), agentGuide);
  return root;
}

async function readBook(root) {
  const { data: manifest } = await readManifest(root);
  // Earlier versions called the first default chapter "Chapter One" but used
  // numerals for every chapter added afterward. Update only that default title.
  const legacyFirst = manifest.chapters.find((chapter) =>
    chapter.file === "chapter-01.md" && chapter.title === "Chapter One");
  if (legacyFirst &&
    (await fs.readFile(chapterPath(root, legacyFirst), "utf8")).startsWith("# Chapter One\n")) {
    const chapter = legacyFirst;
    for (const [file, oldHeading, newHeading] of [
      [chapterPath(root, chapter), "# Chapter One\n", "# Chapter 1\n"],
      [notePath(root, chapter), "# Notes for Chapter One\n", "# Notes for Chapter 1\n"],
      [chapterContextPath(root, chapter), "# AI Context for Chapter One\n", "# AI Context for Chapter 1\n"],
    ]) {
      const content = await readOptional(file);
      if (content.startsWith(oldHeading))
        await atomicWrite(file, newHeading + content.slice(oldHeading.length));
    }
    chapter.title = "Chapter 1";
    await writeJson(manifestPath(root), manifest);
  }
  await Promise.all([
    fs.access(path.join(root, "notes", "book.md")),
    ...manifest.chapters.flatMap((chapter) =>
      [fs.access(chapterPath(root, chapter)), fs.access(notePath(root, chapter))]),
  ]);
  await migrateBookReferences(root, manifest);
  const [chapters, bookNotes, aiContext, agentGuide, references] = await Promise.all([
    Promise.all(manifest.chapters.map(async (c) => {
      const [chapterFile, notes, context] = await Promise.all([
        fs.readFile(chapterPath(root, c), "utf8"),
        fs.readFile(notePath(root, c), "utf8"),
        readOptional(chapterContextPath(root, c)),
      ]);
      return {
        ...c,
        body: withoutHeading(chapterFile),
        notes,
        context,
        revisions: {
          chapter: revision(chapterFile),
          notes: revision(notes),
          context: revision(context),
        },
      };
    })),
    fs.readFile(path.join(root, "notes", "book.md"), "utf8"),
    readOptional(contextPath(root)),
    readOptional(path.join(root, "AGENTS.md")),
    Object.fromEntries(await Promise.all(referenceNames.map(async (name) => {
      const content = await readOptional(referencePath(root, name));
      return [name, { content, revision: revision(content) }];
    }))),
  ]);
  const referenceContents = Object.fromEntries(referenceNames.map((name) =>
    [name, references[name].content]));
  return {
    root,
    manifest,
    chapters,
    bookNotes,
    aiContext,
    agentGuide,
    references: referenceContents,
    revisions: {
      manifest: revision((await fs.readFile(manifestPath(root), "utf8"))),
      bookNotes: revision(bookNotes),
      aiContext: revision(aiContext),
      agentGuide: revision(agentGuide),
      chapters: Object.fromEntries(chapters.map((c) => [c.id, c.revisions.chapter])),
      notes: {
        book: revision(bookNotes),
        ...Object.fromEntries(chapters.map((c) => [c.id, c.revisions.notes])),
      },
      contexts: Object.fromEntries(chapters.map((c) => [c.id, c.revisions.context])),
      references: Object.fromEntries(referenceNames.map((name) =>
        [name, references[name].revision])),
    },
  };
}

async function addChapter(root) {
  const { data: manifest, raw } = await readManifest(root);
  const n = manifest.chapters.length + 1;
  const title = `Chapter ${n}`;
  const basename = `chapter-${String(Date.now())}`;
  const chapter = {
    id: crypto.randomUUID(),
    title,
    file: `${basename}.md`,
    notesFile: `${basename}.notes.md`,
  };
  manifest.chapters.push(chapter);
  await fs.writeFile(chapterPath(root, chapter), heading(title, ""));
  await fs.writeFile(notePath(root, chapter), `# Notes for ${title}\n\n`);
  await fs.writeFile(chapterContextPath(root, chapter), `# AI Context for ${title}\n\n`);
  await writeJson(manifestPath(root), manifest, revision(raw));
  return readBook(root);
}

async function saveChapter(root, id, body, title, expectedRevision, expectedManifestRevision) {
  const { data: manifest, raw: manifestRaw } = await readManifest(root);
  const chapter = manifest.chapters.find((c) => c.id === id);
  if (!chapter) throw new Error("Chapter not found.");
  if (typeof body !== "string" || typeof title !== "string" || !title.trim())
    throw new Error("Invalid chapter content.");
  await assertRevision(chapterPath(root, chapter), expectedRevision);
  const nextTitle = title.trim().replace(/[\r\n]+/g, " ");
  if (expectedManifestRevision && revision(manifestRaw) !== expectedManifestRevision &&
    chapter.title !== nextTitle)
    throw externalChangeError();
  chapter.title = nextTitle;
  const chapterContent = heading(chapter.title, body);
  await atomicWrite(chapterPath(root, chapter), chapterContent, expectedRevision);
  await writeJson(manifestPath(root), manifest, revision(manifestRaw));
  return {
    ...chapter,
    revisions: {
      chapter: revision(chapterContent),
      manifest: revision(JSON.stringify(manifest, null, 2) + "\n"),
    },
  };
}

async function saveNotes(root, id, content, expectedRevision) {
  if (typeof content !== "string") throw new Error("Invalid notes.");
  if (id === "book") {
    const file = path.join(root, "notes", "book.md");
    await assertRevision(file, expectedRevision);
    await atomicWrite(file, content, expectedRevision);
    return revision(content);
  }
  const manifest = await loadManifest(root);
  const chapter = manifest.chapters.find((c) => c.id === id);
  if (!chapter) throw new Error("Chapter not found.");
  await assertRevision(notePath(root, chapter), expectedRevision);
  await atomicWrite(notePath(root, chapter), content, expectedRevision);
  return revision(content);
}

async function appendNote(root, target, chapterId, note) {
  if (!noteTargets.includes(target)) throw new Error("Unknown notes destination.");
  const title = String(note?.title || "").trim().replace(/[\r\n]+/g, " ")
    .replace(/^#+\s*/, "").slice(0, 120);
  const content = String(note?.content || "").trim();
  if (!title || !content || content.length > 10000)
    throw new Error("The proposed note needs a title and content under 10,000 characters.");
  const manifest = await loadManifest(root);
  let file;
  if (target === "book") file = path.join(root, "notes", "book.md");
  else if (target === "chapter") {
    const chapter = manifest.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("Chapter not found.");
    file = notePath(root, chapter);
  } else file = referencePath(root, target);
  const previous = await fs.readFile(file, "utf8");
  if (note?.entryId) {
    if (!["characters", "locations"].includes(target) ||
      !/^[a-f0-9-]{36}$/.test(note.entryId))
      throw new Error("This note does not identify a valid tracker entry.");
    const marker = `<!-- assisted-writer-entry:${note.entryId} -->`;
    const start = previous.indexOf(marker);
    const closeMarker = "<!-- /assisted-writer-entry -->";
    const close = previous.indexOf(closeMarker, start + marker.length);
    const nextEntry = previous.indexOf("<!-- assisted-writer-entry:", start + marker.length);
    if (start < 0 || close < 0 || (nextEntry >= 0 && nextEntry < close))
      throw new Error("The tracker entry changed. Review the proposal before saving it.");
    await atomicWrite(file, `${previous.slice(0, close).trimEnd()}\n\n### ${title}\n\n${content}\n\n${previous.slice(close)}`, revision(previous));
    return readBook(root);
  }
  const addition = ["characters", "locations"].includes(target)
    ? `<!-- assisted-writer-entry:${crypto.randomUUID()} -->\n## ${title}\n\n${content}\n\n<!-- /assisted-writer-entry -->`
    : `## ${title}\n\n${content}`;
  await atomicWrite(file, `${previous.trimEnd()}\n\n${addition}\n`, revision(previous));
  return readBook(root);
}

async function reorderChapter(root, id, direction) {
  const { data: manifest, raw } = await readManifest(root);
  const index = manifest.chapters.findIndex((c) => c.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= manifest.chapters.length)
    return readBook(root);
  [manifest.chapters[index], manifest.chapters[next]] = [
    manifest.chapters[next],
    manifest.chapters[index],
  ];
  await writeJson(manifestPath(root), manifest, revision(raw));
  return readBook(root);
}

async function deleteChapter(root, id) {
  const { data: manifest, raw } = await readManifest(root);
  if (manifest.chapters.length <= 1)
    throw new Error("A book must contain at least one chapter.");
  const index = manifest.chapters.findIndex((c) => c.id === id);
  if (index < 0) throw new Error("Chapter not found.");
  const [chapter] = manifest.chapters.splice(index, 1);
  await writeJson(manifestPath(root), manifest, revision(raw));
  await fs.unlink(chapterPath(root, chapter));
  await fs.unlink(notePath(root, chapter));
  await fs.rm(chapterContextPath(root, chapter), { force: true });
  return readBook(root);
}

async function saveMetadata(root, values, expectedRevision) {
  const { data: manifest, raw } = await readManifest(root);
  if (expectedRevision && revision(raw) !== expectedRevision)
    throw externalChangeError();
  const title = String(values?.title || "").trim();
  if (!title) throw new Error("Book title is required.");
  manifest.title = title;
  manifest.author = String(values.author || "").trim();
  await writeJson(manifestPath(root), manifest, expectedRevision);
  return readBook(root);
}

async function saveReference(root, kind, chapterId, content, expectedRevision) {
  if (typeof content !== "string") throw new Error("Invalid reference content.");
  await loadManifest(root);
  let file;
  if (kind === "book-context") file = contextPath(root);
  else if (referenceNames.includes(kind)) file = referencePath(root, kind);
  if (kind === "chapter-context") {
    const manifest = await loadManifest(root);
    const chapter = manifest.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("Chapter not found.");
    file = chapterContextPath(root, chapter);
  }
  if (!file) throw new Error("Unknown reference type.");
  await assertRevision(file, expectedRevision);
  await atomicWrite(file, content, expectedRevision);
  return revision(content);
}

async function approveSuggestion(
  root,
  chapterId,
  quote,
  replacement,
  expectedHash,
) {
  const manifest = await loadManifest(root);
  const chapter = manifest.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new Error("Chapter not found.");
  if (!quote || typeof quote !== "string" || typeof replacement !== "string")
    throw new Error("Invalid suggestion.");
  const content = await fs.readFile(chapterPath(root, chapter), "utf8");
  const body = withoutHeading(content);
  const hash = crypto.createHash("sha256").update(body).digest("hex");
  if (hash !== expectedHash)
    throw new Error(
      "The chapter changed since this review. Run the review again before applying this suggestion.",
    );
  const first = body.indexOf(quote);
  if (first < 0 || body.indexOf(quote, first + quote.length) >= 0)
    throw new Error(
      "The quoted text could not be matched uniquely. Please make this edit manually.",
    );
  const updated =
    body.slice(0, first) + replacement + body.slice(first + quote.length);
  await atomicWrite(
    chapterPath(root, chapter),
    heading(chapter.title, updated),
    revision(content),
  );
  return {
    body: updated,
    hash: crypto.createHash("sha256").update(updated).digest("hex"),
    revision: revision(heading(chapter.title, updated)),
  };
}

module.exports = {
  createBook,
  readBook,
  addChapter,
  saveChapter,
  saveNotes,
  appendNote,
  noteTargets,
  reorderChapter,
  deleteChapter,
  saveMetadata,
  saveReference,
  migrateBookReferences,
  approveSuggestion,
  loadManifest,
  withoutHeading,
  chapterPath,
};
