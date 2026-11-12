import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const reviewMarks = new PluginKey("editorialReview");

export const EditorialReviewMarks = Extension.create({
  name: "editorialReview",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: reviewMarks,
      state: {
        init: () => DecorationSet.empty,
        apply(transaction, previous) {
          const marks = transaction.getMeta(reviewMarks);
          if (marks) return DecorationSet.create(transaction.doc, marks);
          return transaction.docChanged ? DecorationSet.empty : previous;
        },
      },
      props: { decorations: (state) => reviewMarks.getState(state) },
    })];
  },
});

export function uniqueQuoteIndex(text, quote) {
  if (!quote) return -1;
  const index = text.indexOf(quote);
  return index !== -1 && text.indexOf(quote, index + 1) === -1 ? index : -1;
}

export function manuscriptText(doc) {
  let text = "";
  const positions = [];
  doc.descendants((block, position) => {
    if (!block.isTextblock) return;
    if (positions.length) {
      text += "\n";
      positions.push(position);
    }
    block.forEach((node, offset) => {
      const value = node.isText ? node.text : node.type.name === "hardBreak" ? "\n" : "\ufffc";
      text += value;
      for (let index = 0; index < value.length; index++) positions.push(position + 1 + offset + index);
    });
    return false;
  });
  return { text, positions };
}

export function locateQuote(editor, manuscript, quote) {
  let passage = quote;
  let index = uniqueQuoteIndex(manuscript.text, passage);
  if (index === -1 && editor.markdown) {
    try {
      const parsed = editor.schema.nodeFromJSON(editor.markdown.parse(quote));
      passage = manuscriptText(parsed).text;
      index = uniqueQuoteIndex(manuscript.text, passage);
    } catch {
      return null;
    }
  }
  if (index === -1) return null;
  return { from: manuscript.positions[index], to: manuscript.positions[index + passage.length - 1] + 1 };
}

export function showReviewMarks(editor, ranges, active, renderActions) {
  const marks = [];
  for (const [index, { from, to }] of ranges) {
    marks.push(Decoration.inline(from, to, {
      class: index === active ? "manuscript-review-mark active" : "manuscript-review-mark",
      "data-review-edit": String(index),
    }));
    if (index === active && renderActions) {
      marks.push(Decoration.widget(to, renderActions, { side: -1, stopEvent: () => true }));
    }
  }
  editor.view.dispatch(editor.state.tr.setMeta(reviewMarks, marks).setMeta("addToHistory", false));
}

const reviewKey = (root, chapterId) => "assisted-writer:review:" + JSON.stringify([root, chapterId]);

export function readEditorReview(root, chapterId) {
  try {
    const report = JSON.parse(localStorage.getItem(reviewKey(root, chapterId)));
    return report?.root === root && report.chapterId === chapterId &&
      report.action === "editor" && Array.isArray(report.suggestions) ? report : null;
  } catch {
    return null;
  }
}

export function storeEditorReview(report) {
  try {
    localStorage.setItem(reviewKey(report.root, report.chapterId), JSON.stringify(report));
    return true;
  } catch {
    return false;
  }
}
