<!-- assisted-writer-context-v1 -->
## Current AI context and story tracker files

Assisted Writer shows these UTF-8 Markdown files in its Reference sidebar:

```text
notes/ai-context.md       Book-wide guidance for the in-app AI
notes/characters.md       Character facts, names, ages, and relationships
notes/locations.md        Setting and location facts
notes/timeline.md         Dates and event order
notes/terminology.md      Preferred terms and spellings
chapters/<stem>.context.md  AI context for the chapter whose manuscript is <stem>.md
```

The chapter context filename comes from the `file` value in the relevant `book.json` chapter entry: remove the final `.md` and add `.context.md`. `book.json` remains the authoritative chapter list and order. When adding a chapter, create its manuscript, notes file, context file, and manifest entry together. Keep all chapter IDs and existing filenames stable when editing an existing chapter.

The in-app AI reads book notes, chapter notes, book context, chapter context, story trackers, and other chapters only when the author enables those sources for a request. Story trackers and other chapters are used for continuity checks. Agents should consult the relevant files directly when the author asks for planning or continuity work. Keep facts separate from uncertainty and cite the source of any suspected contradiction.

These context and tracker files are app-visible reference material. They are excluded from manuscript exports. Preserve the author's existing text in them and in this `AGENTS.md`; propose manuscript changes for the author to approve.
