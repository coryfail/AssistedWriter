const fs = require("node:fs/promises");
const path = require("node:path");
const { readBook } = require("./book.cjs");

const escapeXml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const textOf = (tokens) =>
  (tokens || []).map((t) => t.text || textOf(t.tokens)).join("");
const parseBlocks = async (markdown) =>
  (await import("marked")).marked.lexer(markdown);

function inlineRuns(tokens, marks = {}) {
  const runs = [];
  for (const token of tokens || []) {
    if (
      token.type === "text" ||
      token.type === "escape" ||
      token.type === "codespan"
    )
      runs.push({ text: token.text || "", ...marks });
    else if (token.type === "strong")
      runs.push(...inlineRuns(token.tokens, { ...marks, bold: true }));
    else if (token.type === "em")
      runs.push(...inlineRuns(token.tokens, { ...marks, italics: true }));
    else if (token.type === "del")
      runs.push(...inlineRuns(token.tokens, { ...marks, strike: true }));
    else if (token.type === "link")
      runs.push(...inlineRuns(token.tokens, marks));
    else if (token.type === "br") runs.push({ text: "\n", ...marks });
    else if (token.tokens) runs.push(...inlineRuns(token.tokens, marks));
  }
  return runs;
}

function blockList(tokens) {
  const output = [];
  for (const token of tokens) {
    if (token.type === "paragraph" || token.type === "text")
      output.push({
        type: "paragraph",
        runs: inlineRuns(token.tokens || [{ type: "text", text: token.text }]),
      });
    else if (token.type === "heading")
      output.push({
        type: "heading",
        text: textOf(token.tokens) || token.text,
      });
    else if (token.type === "hr") output.push({ type: "scene" });
    else if (token.type === "space") continue;
    else if (token.type === "blockquote")
      output.push(...blockList(token.tokens || []).map((block) => ({ ...block, quote: true })));
    else if (token.type === "list")
      for (const [index, item] of (token.items || []).entries())
        output.push({
          type: "paragraph",
          runs: [
            { text: token.ordered ? `${Number(token.start || 1) + index}. ` : "• " },
            ...inlineRuns(
              item.tokens?.[0]?.tokens || [{ type: "text", text: item.text }],
            ),
          ],
        });
    else if (token.type === "code")
      output.push({ type: "paragraph", runs: [{ text: token.text }] });
  }
  return output;
}

async function content(book) {
  return Promise.all(
    book.chapters.map(async (chapter) => ({
      title: chapter.title,
      blocks: blockList(await parseBlocks(chapter.body)),
    })),
  );
}

async function exportDocx(book, chapters, destination) {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
  } = require("docx");
  const paragraphs = [
    new Paragraph({
      text: book.manifest.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 3500, after: 600 },
    }),
    new Paragraph({
      text: book.manifest.author || "",
      alignment: AlignmentType.CENTER,
      spacing: { after: 2400 },
    }),
  ];
  for (const chapter of chapters) {
    paragraphs.push(
      new Paragraph({
        text: chapter.title,
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
        spacing: { before: 1600, after: 600 },
      }),
    );
    for (const block of chapter.blocks) {
      if (block.type === "scene")
        paragraphs.push(
          new Paragraph({
            text: "* * *",
            alignment: AlignmentType.CENTER,
            spacing: { before: 400, after: 400 },
          }),
        );
      else if (block.type === "heading")
        paragraphs.push(
          new Paragraph({
            text: block.text,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 200 },
          }),
        );
      else
        paragraphs.push(
          new Paragraph({
            children: block.runs.map(
              (r) =>
                new TextRun({ text: r.text, bold: r.bold, italics: r.italics, strike: r.strike }),
            ),
            indent: { firstLine: block.quote ? 0 : 280, left: block.quote ? 450 : 0 },
            spacing: { line: 300, after: 0 },
          }),
        );
    }
  }
  const doc = new Document({
    creator: book.manifest.author || "Assisted Writer",
    title: book.manifest.title,
    sections: [{ properties: {}, children: paragraphs }],
  });
  await fs.writeFile(destination, await Packer.toBuffer(doc));
}

function renderInline(runs) {
  return runs
    .map((run) => {
      let value = escapeXml(run.text).replace(/\n/g, "<br />");
      if (run.italics) value = `<em>${value}</em>`;
      if (run.bold) value = `<strong>${value}</strong>`;
      if (run.strike) value = `<del>${value}</del>`;
      return value;
    })
    .join("");
}

async function exportEpub(book, chapters, destination) {
  const JSZip = require("jszip");
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  const css =
    "body{font-family:serif;line-height:1.45}h1{text-align:center;margin:2em 0 1.5em}h2{text-align:left;margin:2em 0 1em}p{text-indent:1.2em;margin:0}.quote{margin:1em 2em;text-indent:0}.scene{text-align:center;text-indent:0;margin:1.4em 0}";
  zip.file("OEBPS/style.css", css);
  const nav = chapters
    .map(
      (c, i) =>
        `<li><a href="chapter-${i + 1}.xhtml">${escapeXml(c.title)}</a></li>`,
    )
    .join("");
  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${nav}</ol></nav></body></html>`,
  );
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="style" href="style.css" media-type="text/css"/>',
  ];
  const spine = [];
  chapters.forEach((chapter, i) => {
    const id = `chapter-${i + 1}`;
    manifest.push(
      `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`,
    );
    spine.push(`<itemref idref="${id}"/>`);
    const body = chapter.blocks
      .map((block) =>
        block.type === "scene"
          ? '<p class="scene">* * *</p>'
          : block.type === "heading"
            ? `<h2>${escapeXml(block.text)}</h2>`
            : `<p${block.quote ? ' class="quote"' : ""}>${renderInline(block.runs)}</p>`,
      )
      .join("\n");
    zip.file(
      `OEBPS/${id}.xhtml`,
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(chapter.title)}</title><link rel="stylesheet" href="style.css" type="text/css"/></head><body><h1>${escapeXml(chapter.title)}</h1>${body}</body></html>`,
    );
  });
  const identifier = `urn:uuid:${require("node:crypto").randomUUID()}`;
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${identifier}</dc:identifier><dc:title>${escapeXml(book.manifest.title)}</dc:title><dc:creator>${escapeXml(book.manifest.author)}</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta></metadata><manifest>${manifest.join("")}</manifest><spine>${spine.join("")}</spine></package>`,
  );
  await fs.writeFile(
    destination,
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
  );
}

async function exportPdf(book, chapters, destination) {
  const PDFDocument = require("pdfkit");
  const fonts = path.join(__dirname, "..", "assets", "fonts");
  const doc = new PDFDocument({
    size: [432, 648],
    margins: { top: 64, bottom: 60, left: 62, right: 54 },
    autoFirstPage: true,
    info: { Title: book.manifest.title, Author: book.manifest.author },
  });
  doc.registerFont("Book", path.join(fonts, "regular.woff2"));
  doc.registerFont("BookBold", path.join(fonts, "bold.woff2"));
  doc.registerFont("BookItalic", path.join(fonts, "italic.woff2"));
  doc.registerFont("BookBoldItalic", path.join(fonts, "bold-italic.woff2"));
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });
  doc
    .font("BookBold")
    .fontSize(22)
    .text(book.manifest.title, 62, 220, { align: "center", width: 316 });
  doc
    .moveDown(2)
    .font("Book")
    .fontSize(13)
    .text(book.manifest.author || "", { align: "center" });
  for (const chapter of chapters) {
    doc.addPage();
    doc.font("BookBold").fontSize(18).text(chapter.title, { align: "center" });
    doc.moveDown(2);
    for (const block of chapter.blocks) {
      if (block.type === "scene") {
        doc
          .moveDown()
          .font("Book")
          .fontSize(11)
          .text("* * *", { align: "center" })
          .moveDown();
        continue;
      }
      if (block.type === "heading") {
        doc
          .moveDown()
          .font("BookBold")
          .fontSize(12)
          .text(block.text)
          .moveDown(0.5);
        continue;
      }
      doc.font("Book").fontSize(11);
      const runs = block.runs.length ? block.runs : [{ text: "" }];
      runs.forEach((run, i) => {
        const font =
          run.bold && run.italics
            ? "BookBoldItalic"
            : run.bold
              ? "BookBold"
              : run.italics
                ? "BookItalic"
                : "Book";
        doc.font(font).text((i === 0 ? "    " : "") + run.text, {
          continued: i < runs.length - 1,
          lineGap: 2,
          strike: run.strike,
        });
      });
    }
  }
  doc.end();
  await done;
  await fs.writeFile(destination, Buffer.concat(chunks));
}

async function exportBook(root, format, destination) {
  const book = await readBook(root);
  const chapters = await content(book);
  if (format === "docx") return exportDocx(book, chapters, destination);
  if (format === "epub") return exportEpub(book, chapters, destination);
  if (format === "pdf") return exportPdf(book, chapters, destination);
  throw new Error("Unsupported export format.");
}

module.exports = { exportBook };
