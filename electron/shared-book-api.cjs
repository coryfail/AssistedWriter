const book = require("./book.cjs");

const hash = /^[a-f0-9]{64}$/;
const httpError = (status, message) => Object.assign(new Error(message), { status });

// Pairing and relay authentication are handled by the transports. Keep the
// readable and writable files, revision checks, and validation identical.
async function sharedBookRequest(path, method, readDraft, withBook, onSave) {
  if (method === "GET" && path === "/api/book") return withBook(book.sharedBook);
  if (!["GET", "PUT"].includes(method)) throw httpError(404, "Page not found.");
  const bookNotes = path === "/api/notes/book";
  const match = path.match(/^\/api\/(notes\/)?chapters\/([^/]+)$/);
  if (!bookNotes && !match) throw httpError(404, "Page not found.");

  const notes = bookNotes || Boolean(match[1]);
  const label = notes ? "note" : "chapter";
  let id = null;
  if (!bookNotes) {
    try { id = decodeURIComponent(match[2]); }
    catch { throw httpError(400, "Invalid chapter."); }
    if (!id || id.length > 256) throw httpError(400, "Invalid chapter.");
  }
  let draft;
  if (method === "PUT") {
    const { body, revision, manifestRevision } = (await readDraft()) || {};
    if (typeof body !== "string" || typeof revision !== "string" || typeof manifestRevision !== "string" ||
        !hash.test(revision) || !hash.test(manifestRevision))
      throw httpError(400, `A ${label} and its original revision are required.`);
    if (!notes && Buffer.byteLength(body) > 2 * 1024 * 1024)
      throw httpError(413, "This chapter is too large to save from the browser.");
    draft = { body, revision, manifestRevision };
  }
  const access = notes ? book.sharedNotes : book.sharedChapter;
  let data;
  try { data = await withBook((root) => access(root, id, draft)); }
  catch (error) {
    if (error.code === "BOOK_CONFLICT")
      throw httpError(409, `The saved ${label} changed. Your browser draft has not been overwritten.`);
    if (error.code === "CHAPTER_MISSING") throw httpError(404, "This chapter is no longer in the book.");
    if (error.code === "CHAPTER_TOO_LARGE") throw httpError(413, error.message);
    throw error;
  }
  if (draft) onSave();
  return data;
}

module.exports = { sharedBookRequest };
