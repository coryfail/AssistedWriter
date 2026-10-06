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

The renderer build is placed under `dist/`; packaged Mac apps are placed under `release/`. Local builds without a Developer ID certificate and Apple notarization credentials are for development only and may be blocked by macOS.

Each push to `main` runs the Mac release workflow. It turns the source version (currently `0.2.0`) into a unique prerelease such as `v0.2.0-beta.4`, builds one universal app for Intel and Apple Silicon Macs, and publishes a DMG, ZIP, update metadata, and SHA-256 checksum file. The release is published only after code-signature, Gatekeeper, notarization, architecture, DMG, and ZIP checks pass.

Installed apps can check for the latest signed GitHub prerelease from Settings → App updates. Downloading an update replaces only the app bundle. Book folders stay where the author created them, while recent books and the encrypted API key stay in macOS Application Support and Keychain-backed app data.

Distribution requires an Apple Developer ID Application certificate and notarization credentials. Configure these GitHub Actions secrets before the workflow can publish: `MAC_CSC_LINK` (base64-encoded `.p12`), `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64` (base64-encoded App Store Connect `.p8` file), `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` (the API key's Issuer ID). Without them, the workflow fails before packaging and does not publish an unusable download. After adding the secrets, rerun the workflow from GitHub Actions or start it manually. Bump `package.json` and `package-lock.json` together when starting a new version line.

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
The generated `AGENTS.md` documents the manifest schema, chapter and notes paths, Markdown conventions, and the steps an agent must follow to add app-visible chapters.

## Git for each book

Open the **Git** tab in the side panel to set up a repository in the current book folder, inspect changed files and diffs, commit selected files, create or switch local branches, and fetch, pull, or push. Existing book repositories also work. New repositories ignore `exports/` and `.DS_Store` by default. Add an `origin` remote in the panel to sync; Git uses the credentials configured on your Mac. Git identity (`user.name` and `user.email`) must be configured to commit.

The app saves pending writing before Git actions. Branch switching and pulling require a clean working tree. Pull uses fast-forward only, so diverged branches need to be resolved with Git or Codex outside the app. The panel never auto-commits or auto-pushes.

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
