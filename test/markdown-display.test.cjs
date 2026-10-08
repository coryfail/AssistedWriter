const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

test("brainstorm Markdown is formatted without interpreting raw HTML", async () => {
  const { MarkdownDisplay } = await import("../src/markdown-display.mjs");
  const html = renderToStaticMarkup(React.createElement(MarkdownDisplay, {
    text: "Not **necessarily** *so*.\n\n- First idea\n- Second idea\n\n<script>alert(1)</script>",
  }));
  assert.match(html, /<strong>necessarily<\/strong>/);
  assert.match(html, /<em>so<\/em>/);
  assert.match(html, /<ul><li>First idea<\/li><li>Second idea<\/li><\/ul>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
