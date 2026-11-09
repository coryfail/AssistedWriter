const key = (kind, book, chapter) => "assisted-writer:draft:" + JSON.stringify([kind, book, chapter]);
export function readDraft(kind, book, chapter) {
  try {
    const draft = JSON.parse(localStorage.getItem(key(kind, book, chapter)));
    return draft && typeof draft.body === "string" && typeof draft.revision === "string" &&
      typeof draft.manifestRevision === "string" && typeof draft.title === "string" ? draft : null;
  } catch { return null; }
}
export function storeDraft(kind, book, chapter, draft) {
  try { localStorage.setItem(key(kind, book, chapter), JSON.stringify(draft)); return true; }
  catch { return false; }
}
export function clearDraft(kind, book, chapter) {
  try { localStorage.removeItem(key(kind, book, chapter)); } catch { /* Storage may be disabled. */ }
}
export function downloadDraft(title, body, { includeHeading = true } = {}) {
  const content = includeHeading ? "# " + title + "\n\n" + body + "\n" : body;
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = (title.replace(/[^\p{L}\p{N} _-]/gu, "-").trim().slice(0, 100) || "chapter") + "-draft.md";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
