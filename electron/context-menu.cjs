function contextMenuTemplate(params, webContents) {
  const items = [];
  if (params.isEditable && params.misspelledWord && params.spellcheckEnabled) {
    for (const suggestion of params.dictionarySuggestions || []) {
      items.push({ label: suggestion, click: () => webContents.replaceMisspelling(suggestion) });
    }
    if (!items.length) items.push({ label: "No spelling suggestions", enabled: false });
    items.push({ label: "Add to Dictionary", click: () =>
      webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
    items.push({ type: "separator" });
  }
  if (params.isEditable) {
    items.push(
      { role: "undo", enabled: Boolean(params.editFlags?.canUndo) },
      { role: "redo", enabled: Boolean(params.editFlags?.canRedo) },
      { type: "separator" },
      { role: "cut", enabled: Boolean(params.editFlags?.canCut) },
      { role: "copy", enabled: Boolean(params.editFlags?.canCopy) },
      { role: "paste", enabled: Boolean(params.editFlags?.canPaste) },
      { role: "pasteAndMatchStyle", enabled: Boolean(params.editFlags?.canPaste) },
      { role: "selectAll", enabled: Boolean(params.editFlags?.canSelectAll) },
    );
  } else if (params.selectionText) {
    items.push({ role: "copy" });
  }
  return items;
}

module.exports = { contextMenuTemplate };
