# Working in this Assisted Writer book

This folder is an Assisted Writer fiction book. The author writes the final manuscript and controls the story. Help with planning, research, continuity, critique, and editing. Offer proposed changes for the author to approve. Do not silently rewrite manuscript text or produce publishable scenes unless the author explicitly asks you to write a specific passage or chapter.

## Read this first

1. Read `book.json` for the book title, author, and **authoritative chapter order**.
2. Read `notes/book.md` for book-wide context.
3. Read `notes/ai-context.md` and the story trackers in `notes/` when relevant.
4. For each relevant chapter, read the manuscript and its notes file named by that chapter's `file` and `notesFile` fields in `book.json`. Optional chapter AI context uses the manuscript filename stem plus `.context.md`.
5. Follow the author's current request. Keep story suggestions separate from manuscript text until the author approves them.

## Folder layout

```text
book-folder/
  AGENTS.md                 Instructions for agents working in this book
  book.json                 Metadata and ordered list of chapters
  chapters/
    chapter-01.md           Manuscript for the first chapter
    chapter-01.notes.md     App-visible notes for the first chapter
    chapter-01.context.md   App-visible AI context for the first chapter
    <other chapter>.md      Other manuscripts named in book.json
    <other chapter>.notes.md  Their app-visible notes
  notes/
    book.md                 App-visible notes for the whole book
    ai-context.md           Book-wide AI context
    characters.md           Character facts and relationships
    locations.md            Place and setting facts
    timeline.md             Chronology and dates
    terminology.md          Names, terms, and preferred spellings
  editorial/                Saved AI review reports; not manuscript
  exports/                  Generated DOCX, EPUB, and PDF files
  .git/                     Optional Git history, if enabled
```

The app does **not** discover chapters by scanning `chapters/`. It loads only the entries in `book.json`, in that order. Put book-wide notes in `notes/book.md`, chapter notes in the named `notesFile`, and AI context in the dedicated files above. The four tracker files are visible in the app. Additional research files may live in `notes/`, but link to them from `notes/book.md` if the author should find them in the app.

## `book.json` contract

Keep this as valid UTF-8 JSON with no comments or trailing commas. Preserve existing metadata and chapter IDs. Its shape is:

```json
{
  "format": "assisted-writer-1",
  "title": "Book title",
  "author": "Author name",
  "genre": "Fiction",
  "chapters": [
    {
      "id": "c614a0e4-9056-4d33-a7df-e4d3ad658f35",
      "title": "Chapter 1",
      "file": "chapter-01.md",
      "notesFile": "chapter-01.notes.md"
    }
  ],
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

`format` must stay `assisted-writer-1`. `chapters` is an ordered array; moving an entry changes chapter order. Each chapter needs a stable, unique UUID `id`, a nonempty one-line `title`, and unique `file` and `notesFile` values. Those filenames must be plain basenames ending in `.md`, without `/`, `..`, or a leading dot. Both files live directly in `chapters/`. Keep existing IDs and filenames stable when renaming or reordering chapters. Preserve `createdAt` and any other existing metadata.

## Manuscript and notes files

A chapter manuscript is UTF-8 Markdown. Its first line must be a level-one heading matching the entry's `title`, followed by a blank line and the chapter body:

```markdown
# Chapter 1

The story begins here.

## A section heading

The scene continues with *italics* and **bold**.

---

The next scene begins here.
```

The app removes that first heading when loading the editor and writes it back when saving. Do not add another `#` heading inside the body. For reliable editing and export, use ordinary paragraphs, `*italics*`, `**bold**`, `~~strikethrough~~`, `##` or `###` subheadings, block quotes, bullet or numbered lists, and `---` for scene breaks. Avoid relying on tables, embedded HTML, images, or complex Markdown for the manuscript; the app's editor and exports may not preserve them.

`notes/book.md` and each `chapters/<notesFile>` are separate Markdown documents. They can contain outlines, character facts, chronology, questions, and continuity notes. The chapter notes file may start with `# Notes for <chapter title>`. Notes and editorial reports are excluded from manuscript exports.

`notes/ai-context.md` and `chapters/<manuscript stem>.context.md` hold guidance the author wants the in-app AI to consider. The in-app assistant selects relevant sources automatically. Character, location, timeline, and terminology trackers are Markdown in `notes/`; the assistant can read them for brainstorming, review, and continuity checks. For existing books, missing context or tracker files are created when the book is opened. Keep factual assertions and uncertainties distinct, so a continuity warning can cite evidence rather than guess.

<!-- assisted-writer-brainstorm-v1 -->
The in-app assistant can propose up to eight notes for `notes/book.md`, the current chapter's `notesFile`, or the four tracker files. It chooses a destination for each note based on the discussion. These ideas are optional until the author approves each one; approval appends a `##` heading and Markdown content to the chosen file. When brainstorming outside the app, keep proposed ideas distinct from established story facts and let the author choose what becomes a durable note.

<!-- assisted-writer-assistant-v2 -->
The in-app assistant reads relevant book files without source checkboxes. It can suggest notes during a conversation or when the author asks explicitly, but conversation alone never changes book files. The author approves or dismisses each proposed note separately. For an existing marked character or location entry, approval can add a Markdown detail inside that entry while preserving its UUID.

## Adding or changing chapters

When the author asks you to create a chapter that should appear in Assisted Writer:

1. Read the current `book.json` immediately before editing it.
2. Choose an unused manuscript filename and an unused notes filename in `chapters/`. Use matching stems such as `chapter-02.md` and `chapter-02.notes.md`; the exact stem is not important.
3. Generate a new UUID for `id`. Never reuse or change an existing chapter ID.
4. Create **both** files. Put `# <chapter title>` and a blank line at the top of the manuscript. Create the chapter notes file even if it is empty apart from its heading. Also create `<manuscript stem>.context.md` for chapter AI guidance.
5. Add an entry with `id`, `title`, `file`, and `notesFile` to `book.json` at the intended position in `chapters`. Preserve all other entries and metadata.
6. Check that every listed manuscript and notes file exists, filenames and IDs are unique, and each manuscript's first heading matches its manifest title.

For a chapter title change, update both `book.json` and the manuscript's first heading. For a reorder, change only the array order. Do not rename files just to match a new title. If the app is open while you edit files externally, the author should reload or reopen the book to see the latest structure.

## Editorial work and exports

Keep proposed edits, critiques, and research out of chapter manuscript files until the author approves a specific change. Put durable editorial material in `editorial/` or the relevant notes file. The in-app AI saves its reports as JSON in `editorial/`; do not alter those reports to make a change appear approved. The app's exports contain only chapters listed in `book.json`, in order. `notes/`, chapter notes, `editorial/`, `AGENTS.md`, and `exports/` are not manuscript chapters.

Before finishing any file change, verify `book.json` parses, the book and chapter notes remain readable, all referenced files exist, and the chapter headings and order are correct. If the book uses Git, leave committing, branching, pushing, and pulling to the author unless requested.

<!-- assisted-writer-entries-v1 -->
## Named characters and locations

The app can display any number of named entries in `notes/characters.md` and `notes/locations.md`. Each entry uses this Markdown block, with a unique UUID that stays stable when the name changes:

```markdown
<!-- assisted-writer-entry:11111111-1111-4111-8111-111111111111 -->
## Ogee

Description and details about Ogee.

<!-- /assisted-writer-entry -->
```

Keep each name on one line after `##`. The description may contain ordinary Markdown, including smaller headings. Preserve the marker pair and UUID when updating an entry; add a fresh UUID for a new one. Existing freeform tracker text outside these blocks remains visible in the app as other notes. Do not delete or rewrite it during conversion unless the author asks.
