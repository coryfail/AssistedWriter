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
const heading = (title, body) => `# ${title}\n\n${body.trim()}\n`;
const withoutHeading = (content) =>
  content.replace(/^# [^\n]*\n(?:\n)?/, "").trim();
async function atomicWrite(file, content) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content);
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}
const writeJson = async (file, value) =>
  atomicWrite(file, JSON.stringify(value, null, 2) + "\n");

async function loadManifest(root) {
  const data = JSON.parse(await fs.readFile(manifestPath(root), "utf8"));
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
  return data;
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
    title: "Chapter One",
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
  const agentGuide = await fs.readFile(
    path.join(__dirname, "templates", "book-AGENTS.md"),
    "utf8",
  );
  await fs.writeFile(path.join(root, "AGENTS.md"), agentGuide);
  return root;
}

async function readBook(root) {
  const manifest = await loadManifest(root);
  const chapters = await Promise.all(
    manifest.chapters.map(async (c) => ({
      ...c,
      body: withoutHeading(await fs.readFile(chapterPath(root, c), "utf8")),
      notes: await fs.readFile(notePath(root, c), "utf8"),
    })),
  );
  return {
    root,
    manifest,
    chapters,
    bookNotes: await fs.readFile(path.join(root, "notes", "book.md"), "utf8"),
  };
}

async function addChapter(root) {
  const manifest = await loadManifest(root);
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
  await writeJson(manifestPath(root), manifest);
  return readBook(root);
}

async function saveChapter(root, id, body, title) {
  const manifest = await loadManifest(root);
  const chapter = manifest.chapters.find((c) => c.id === id);
  if (!chapter) throw new Error("Chapter not found.");
  if (typeof body !== "string" || typeof title !== "string" || !title.trim())
    throw new Error("Invalid chapter content.");
  chapter.title = title.trim().replace(/[\r\n]+/g, " ");
  await atomicWrite(chapterPath(root, chapter), heading(chapter.title, body));
  await writeJson(manifestPath(root), manifest);
  return chapter;
}

async function saveNotes(root, id, content) {
  if (typeof content !== "string") throw new Error("Invalid notes.");
  if (id === "book")
    return atomicWrite(path.join(root, "notes", "book.md"), content);
  const manifest = await loadManifest(root);
  const chapter = manifest.chapters.find((c) => c.id === id);
  if (!chapter) throw new Error("Chapter not found.");
  return atomicWrite(notePath(root, chapter), content);
}

async function reorderChapter(root, id, direction) {
  const manifest = await loadManifest(root);
  const index = manifest.chapters.findIndex((c) => c.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= manifest.chapters.length)
    return readBook(root);
  [manifest.chapters[index], manifest.chapters[next]] = [
    manifest.chapters[next],
    manifest.chapters[index],
  ];
  await writeJson(manifestPath(root), manifest);
  return readBook(root);
}

async function deleteChapter(root, id) {
  const manifest = await loadManifest(root);
  if (manifest.chapters.length <= 1)
    throw new Error("A book must contain at least one chapter.");
  const index = manifest.chapters.findIndex((c) => c.id === id);
  if (index < 0) throw new Error("Chapter not found.");
  const [chapter] = manifest.chapters.splice(index, 1);
  await fs.unlink(chapterPath(root, chapter));
  await fs.unlink(notePath(root, chapter));
  await writeJson(manifestPath(root), manifest);
  return readBook(root);
}

async function saveMetadata(root, values) {
  const manifest = await loadManifest(root);
  manifest.title = String(values.title || "").trim() || manifest.title;
  manifest.author = String(values.author || "").trim();
  await writeJson(manifestPath(root), manifest);
  return readBook(root);
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
  );
  return {
    body: updated,
    hash: crypto.createHash("sha256").update(updated).digest("hex"),
  };
}

module.exports = {
  createBook,
  readBook,
  addChapter,
  saveChapter,
  saveNotes,
  reorderChapter,
  deleteChapter,
  saveMetadata,
  approveSuggestion,
  loadManifest,
  withoutHeading,
  chapterPath,
};
