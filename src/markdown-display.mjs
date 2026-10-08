import React from "react";
import { marked } from "marked";

const element = React.createElement;

function inline(tokens = []) {
  return tokens.map((token, index) => {
    const key = index;
    switch (token.type) {
      case "strong": return element("strong", { key }, inline(token.tokens));
      case "em": return element("em", { key }, inline(token.tokens));
      case "del": return element("del", { key }, inline(token.tokens));
      case "codespan": return element("code", { key }, token.text);
      case "br": return element("br", { key });
      case "link": return element("span", { key, className: "markdown-link", title: token.href }, inline(token.tokens));
      case "image": return element("span", { key }, token.text || "Image");
      case "text": return element(React.Fragment, { key }, token.tokens ? inline(token.tokens) : token.text);
      default: return element(React.Fragment, { key }, token.text || token.raw || "");
    }
  });
}

function blocks(tokens = []) {
  return tokens.map((token, index) => {
    const key = index;
    switch (token.type) {
      case "space": return null;
      case "paragraph": return element("p", { key }, inline(token.tokens));
      case "heading": return element(`h${Math.min(token.depth, 6)}`, { key }, inline(token.tokens));
      case "blockquote": return element("blockquote", { key }, blocks(token.tokens));
      case "code": return element("pre", { key }, element("code", null, token.text));
      case "hr": return element("hr", { key });
      case "list": {
        const tag = token.ordered ? "ol" : "ul";
        const props = token.ordered && Number(token.start) > 1 ? { key, start: Number(token.start) } : { key };
        return element(tag, props, token.items.map((item, itemIndex) =>
          element("li", { key: itemIndex }, item.task ? `${item.checked ? "☑" : "☐"} ` : null,
            blocks(item.tokens))));
      }
      case "text": return element(React.Fragment, { key }, token.tokens ? inline(token.tokens) : token.text);
      default: return element("p", { key }, token.text || token.raw || "");
    }
  });
}

export function MarkdownDisplay({ text, className = "" }) {
  return element("div", { className: `markdown-display ${className}`.trim() },
    blocks(marked.lexer(String(text || ""))));
}
