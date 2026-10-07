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

Each push to `main` runs the Mac release workflow. It turns the source version (currently `0.4.0`) into a unique prerelease such as `v0.4.0-beta.22`. Pushing a matching version tag such as `v0.4.0` publishes that exact stable release. Both paths build one universal app for Intel and Apple Silicon Macs and publish a DMG, ZIP, update metadata, and SHA-256 checksum file. The workflow keeps each release in draft until all assets are uploaded, so the updater cannot see an incomplete release. A release is published only after code-signature, Gatekeeper, notarization, architecture, DMG, and ZIP checks pass.

Installed apps can check for the latest signed GitHub release from Settings → App updates. Downloading an update replaces only the app bundle. Book folders stay where the author created them, while recent books and the encrypted API key stay in macOS Application Support and Keychain-backed app data.

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
    chapter-01.context.md   Chapter-specific AI context
  notes/
    book.md                 Whole-book notes, excluded from exports
    ai-context.md           Book-wide AI context
    characters.md           Character tracker
    locations.md            Location tracker
    timeline.md             Timeline tracker
    terminology.md          Terminology tracker
  editorial/                Readable AI review reports
  exports/                  Suggested location for export files
```

You can edit these files outside the app. The app reads the chapter order from `book.json`. Keep each chapter filename and notes filename unique and within `chapters/`.
The generated `AGENTS.md` documents the manifest schema, chapter and notes paths, Markdown conventions, and the steps an agent must follow to add app-visible chapters.
When an older book is opened, Assisted Writer creates any missing AI context and story tracker Markdown files and adds current file guidance to its `AGENTS.md`. Existing notes, custom agent instructions, chapter content, and `book.json` entries are preserved.

The Characters and Locations views support any number of named entries. Each entry has a name and a visually formatted Markdown description. Entries remain in their existing tracker Markdown files as clearly marked sections with stable IDs. Older freeform tracker text stays available under **Other notes** so it can be consulted or edited without a forced conversion. The book's `AGENTS.md` explains the entry format to Codex and other agents; existing books receive this guidance when opened.

## Git for each book

Open the **Git** tab in the side panel to set up a repository in the current book folder, inspect changed files and diffs, commit selected files, create or switch local branches, and fetch, pull, or push. Existing book repositories also work. New repositories ignore `exports/` and `.DS_Store` by default. Add an `origin` remote in the panel to sync; Git uses the credentials configured on your Mac. Git identity (`user.name` and `user.email`) must be configured to commit. **Generate commit message with AI** drafts an editable message from the selected file changes using your saved API key; it never creates the commit automatically.

The app saves pending writing before Git actions. Branch switching and pulling require a clean working tree. Pull uses fast-forward only, so diverged branches need to be resolved with Git or Codex outside the app. The panel never auto-commits or auto-pushes.

## Writing and AI

The manuscript, book notes, chapter notes, story trackers, and AI context editors show formatted text while saving readable Markdown. They share controls for bold, italics, strikethrough, two subheading sizes, block quotes, lists, scene breaks, and undo/redo. Changes save automatically. Settings lists keyboard shortcuts for saving, switching to the chapter or book notes, opening chapter context, and toggling the AI panel. The assistant can discuss ideas back and forth, review a chapter, check continuity, answer questions, and run a final editor pass. An OpenAI API key is entered in Settings; the encrypted value is kept in the app's data directory using Electron's macOS Keychain-backed safe storage. The key is never stored in a book folder.

AI requests are made only when you ask. The current chapter and `AGENTS.md` are included. Controls in the AI panel choose whether the request also reads book notes, chapter notes, book context, chapter context, story trackers, and other chapters. Trackers are used for brainstorming and continuity checks; other chapters are used for continuity checks. Use **AI Brainstorm** to discuss your ideas over multiple turns. **Propose a note** asks the assistant to draft one note from that discussion for the selected destination; you can then add or dismiss it. Conversation alone saves no notes or manuscript text. Added notes append to the chosen readable Markdown file. Continuity reports include evidence-backed warnings for names, dates, ages, locations, terms, and plot details. Review reports are written to `editorial/` as JSON. Suggestions do not change the manuscript until you approve each one. Approval requires an exact unique text match against the same chapter version that was reviewed.

App updates show download progress in Settings and the writing toolbar. When the download completes, Settings offers **Restart to update**. The release workflow runs updater state-flow tests on Apple Silicon and Intel GitHub macOS runners, then verifies that the signed package contains both CPU architectures.
If a release's update metadata is briefly unavailable, the app shows a short retry message; when the missing metadata belongs to the installed version, it reports that the app is up to date.

## Exports

- **DOCX** for Word editing.
- **EPUB** for a reflowable Kindle ebook interior.
- **PDF** for a 6 × 9 inch print interior draft.

Notes and editorial reports are never included. The export system preserves chapter order, headings, scene breaks, bold, italics, strikethrough, block quotes, and list text. Covers and KDP metadata are separate. Preview ebook output in Kindle Previewer and print output in KDP's print preview before publishing; the app does not upload books to KDP.

## Verify

```sh
npm test
npm run build
```
