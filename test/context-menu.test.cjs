const test = require("node:test");
const assert = require("node:assert/strict");
const { contextMenuTemplate } = require("../electron/context-menu.cjs");

test("editable context menu offers copy, paste, and native spelling suggestions", () => {
  const calls = [];
  const webContents = {
    replaceMisspelling: (word) => calls.push(word),
    session: { addWordToSpellCheckerDictionary: (word) => calls.push(`dictionary:${word}`) },
  };
  const menu = contextMenuTemplate({ isEditable: true, spellcheckEnabled: true,
    misspelledWord: "teh", dictionarySuggestions: ["the"],
    editFlags: { canCopy: true, canPaste: true, canSelectAll: true } }, webContents);
  assert.deepEqual(menu.filter((item) => item.role).map((item) => item.role),
    ["undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "selectAll"]);
  assert.equal(menu.find((item) => item.role === "copy").enabled, true);
  menu[0].click();
  menu[1].click();
  assert.deepEqual(calls, ["the", "dictionary:teh"]);
  assert.deepEqual(contextMenuTemplate({ selectionText: "sample" }, webContents), [{ role: "copy" }]);
  assert.deepEqual(contextMenuTemplate({}, webContents), []);
});
