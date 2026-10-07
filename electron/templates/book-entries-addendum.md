<!-- assisted-writer-entries-v1 -->
## Named character and location entries

Assisted Writer displays named entries from `notes/characters.md` and `notes/locations.md`. Each entry is a Markdown block delimited by `<!-- assisted-writer-entry:<unique UUID> -->` and `<!-- /assisted-writer-entry -->`. Inside the block, start with `## <name>`, then a blank line and the Markdown description. Keep the UUID stable when editing a name or description; use a new UUID for each added entry. Text outside these blocks remains visible as other notes, so preserve existing freeform content unless the author asks to change it.
