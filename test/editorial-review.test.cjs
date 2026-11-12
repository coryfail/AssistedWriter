const assert = require("node:assert/strict");
const test = require("node:test");

test("review quotes map to rendered manuscript positions across formatting and paragraphs", async () => {
  const { getSchema } = await import("@tiptap/core");
  const { default: StarterKit } = await import("@tiptap/starter-kit");
  const { MarkdownManager } = await import("@tiptap/markdown");
  const { locateQuote, manuscriptText } = await import("../src/editorial-review.mjs");
  const editor = {
    schema: getSchema([StarterKit]),
    markdown: new MarkdownManager({ extensions: [StarterKit] }),
  };
  const doc = editor.schema.nodeFromJSON(editor.markdown.parse(
    "She *walked* home.\n\nThe dog waited.\n\nHe waited.",
  ));
  const manuscript = manuscriptText(doc);
  const quote = "She *walked* home.\n\nThe dog";
  const range = locateQuote(editor, manuscript, quote);
  assert.equal(doc.textBetween(range.from, range.to, "\n"), "She walked home.\nThe dog");
  assert.equal(locateQuote(editor, manuscript, "waited"), null);
  assert.equal(locateQuote(editor, manuscript, "absent"), null);
});
