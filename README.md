# Assisted Writer

A Mac desktop writing studio for author-led fiction. It provides a Word-like editor while keeping the manuscript and notes in ordinary Markdown files that Codex and other tools can read.

## Run

Requires Node.js 20 or later and macOS.

```sh
npm install
npm start
```

To make a local Mac application build:

```sh
npm run package:mac
```

The app build is placed under `dist/`. Signing and notarization are not configured; a build intended for distribution needs both.

Each push to `main` runs the Mac build workflow and publishes its DMG and ZIP as a commit-tagged prerelease on GitHub. The release builds are Apple Silicon only and remain unsigned until signing and notarization are configured.

## Book folder

Every book is a folder you choose. A new book contains:

```text
book-name/
  AGENTS.md                 Codex guidance for author-led work
  book.json                 Book metadata and explicit chapter order
  chapters/
    chapter-01.md           Manuscript, with a heading and Markdown body
    chapter-01.notes.md     Chapter notes, excluded from exports
  notes/
    book.md                 Whole-book notes, excluded from exports
  editorial/                Readable AI review reports
  exports/                  Suggested location for export files
```

You can edit these files outside the app. The app reads the chapter order from `book.json`. Keep each chapter filename and notes filename unique and within `chapters/`.

## Writing and AI

The editor supports bold, italics, subheadings, scene breaks, and undo/redo. Changes save automatically. The assistant can review a chapter, check continuity, answer questions, and run a final editor pass. An OpenAI API key is entered in Settings; the encrypted value is kept in the app's data directory using Electron's macOS Keychain-backed safe storage. The key is never stored in a book folder.

AI requests are made only when you ask. The current chapter, chapter notes, book notes, and `AGENTS.md` are included. Continuity checks also include other chapters. Review reports are written to `editorial/` as JSON. Suggestions do not change the manuscript until you approve each one. Approval requires an exact unique text match against the same chapter version that was reviewed.

## Exports

- **DOCX** for Word editing.
- **EPUB** for a reflowable Kindle ebook interior.
- **PDF** for a 6 × 9 inch print interior draft.

Notes and editorial reports are never included. The export system preserves chapter order, headings, scene breaks, bold, and italics. Covers and KDP metadata are separate. Preview ebook output in Kindle Previewer and print output in KDP's print preview before publishing; the app does not upload books to KDP.

## Verify

```sh
npm test
npm run build
```
