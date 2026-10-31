import 'package:flutter/services.dart';

import 'package:archive/archive.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:uuid/uuid.dart';

import '../book/store.dart';

String xmlEscape(String text) => text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

class ExportRun {
  const ExportRun(
    this.text, {
    this.bold = false,
    this.italic = false,
    this.strike = false,
  });
  final String text;
  final bool bold, italic, strike;
}

class ExportBlock {
  const ExportBlock(
    this.type, {
    this.runs = const [],
    this.level = 0,
    this.quote = false,
  });
  final String type;
  final List<ExportRun> runs;
  final int level;
  final bool quote;
  String get text => runs.map((r) => r.text).join();
}

class ExportChapter {
  const ExportChapter(this.title, this.blocks);
  final String title;
  final List<ExportBlock> blocks;
}

List<ExportRun> inlineRuns(
  List<md.Node> nodes, {
  bool bold = false,
  bool italic = false,
  bool strike = false,
}) {
  final result = <ExportRun>[];
  for (final node in nodes) {
    if (node is md.Text) {
      result.add(
        ExportRun(node.text, bold: bold, italic: italic, strike: strike),
      );
    } else if (node is md.Element) {
      if (node.tag == 'br') {
        result.add(const ExportRun('\n'));
      } else if (node.tag != 'img') {
        result.addAll(
          inlineRuns(
            node.children ?? [md.Text(node.textContent)],
            bold: bold || node.tag == 'strong',
            italic: italic || node.tag == 'em',
            strike: strike || node.tag == 'del',
          ),
        );
      }
    }
  }
  return result;
}

List<ExportBlock> parseBlocks(String markdown, {bool quote = false}) {
  final document = md.Document(
    extensionSet: md.ExtensionSet.gitHubWeb,
    encodeHtml: false,
  );
  return _blocks(document.parseLines(markdown.split('\n')), quote);
}

List<ExportBlock> _blocks(List<md.Node> nodes, bool quote) {
  final result = <ExportBlock>[];
  for (final node in nodes) {
    if (node is md.Text) {
      if (node.text.trim().isNotEmpty) {
        result.add(
          ExportBlock('paragraph', runs: [ExportRun(node.text)], quote: quote),
        );
      }
      continue;
    }
    if (node is! md.Element) continue;
    if (node.tag == 'hr') {
      result.add(const ExportBlock('scene'));
    } else if (node.tag == 'blockquote') {
      result.addAll(_blocks(node.children ?? [], true));
    } else if (node.tag == 'ul' || node.tag == 'ol') {
      var index = int.tryParse(node.attributes['start'] ?? '1') ?? 1;
      for (final item in node.children ?? <md.Node>[]) {
        if (item is! md.Element) continue;
        final children = item.children ?? [];
        final content = _blocks(children, quote);
        final prefix = node.tag == 'ol' ? '${index++}. ' : '• ';
        if (content.isEmpty) {
          result.add(
            ExportBlock(
              'paragraph',
              runs: [ExportRun(prefix), ...inlineRuns(children)],
              quote: quote,
            ),
          );
        } else {
          for (var i = 0; i < content.length; i++) {
            final block = content[i];
            result.add(
              ExportBlock(
                'paragraph',
                runs: [if (i == 0) ExportRun(prefix), ...block.runs],
                quote: quote,
              ),
            );
          }
        }
      }
    } else if (RegExp(r'^h[1-6]$').hasMatch(node.tag)) {
      result.add(
        ExportBlock(
          'heading',
          runs: [ExportRun(node.textContent)],
          level: int.parse(node.tag[1]),
          quote: quote,
        ),
      );
    } else if (node.tag == 'p' || node.tag == 'pre' || node.tag == 'li') {
      result.add(
        ExportBlock(
          'paragraph',
          runs: node.tag == 'pre'
              ? [ExportRun(node.textContent)]
              : inlineRuns(node.children ?? []),
          quote: quote,
        ),
      );
    } else {
      final text = node.textContent;
      if (text.trim().isNotEmpty) {
        result.add(
          ExportBlock('paragraph', runs: inlineRuns([node]), quote: quote),
        );
      }
    }
  }
  return result;
}

class BookExporter {
  static List<ExportChapter> chapters(BookSnapshot book) => book
      .manifest
      .chapters
      .map((c) => ExportChapter(c.title, parseBlocks(book.body(c))))
      .toList();
  static Future<Uint8List> export(BookSnapshot book, String format) async {
    final content = chapters(book);
    return switch (format) {
      'docx' => Uint8List.fromList(_docx(book, content)),
      'epub' => Uint8List.fromList(_epub(book, content)),
      'pdf' => _pdf(book, content),
      _ => throw ArgumentError('Unsupported export format.'),
    };
  }

  static void _put(
    Archive zip,
    String path,
    String content, {
    bool stored = false,
  }) {
    final file = ArchiveFile.string(path, content);
    if (stored) file.compression = CompressionType.none;
    zip.addFile(file);
  }

  static String _run(ExportRun run) =>
      '<w:r><w:rPr>${run.bold ? '<w:b/>' : ''}${run.italic ? '<w:i/>' : ''}${run.strike ? '<w:strike/>' : ''}</w:rPr>${run.text.split('\n').map((line) => '<w:t xml:space="preserve">${xmlEscape(line)}</w:t>').join('<w:br/>')}</w:r>';
  static String _paragraph(
    List<ExportRun> runs, {
    String? style,
    bool centered = false,
    bool pageBreak = false,
    bool quote = false,
  }) =>
      '<w:p><w:pPr>${style == null ? '' : '<w:pStyle w:val="$style"/>'}${centered ? '<w:jc w:val="center"/>' : ''}${pageBreak ? '<w:pageBreakBefore/>' : ''}<w:spacing w:line="300" w:after="120"/><w:ind w:firstLine="${quote ? 0 : 280}" w:left="${quote ? 450 : 0}"/></w:pPr>${runs.map(_run).join()}</w:p>';
  static List<int> _docx(BookSnapshot book, List<ExportChapter> chapters) {
    final zip = Archive();
    _put(
      zip,
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    );
    _put(
      zip,
      '_rels/.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    _put(
      zip,
      'word/_rels/document.xml.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    );
    _put(
      zip,
      'word/styles.xml',
      '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>${{'Title': 40, 'Heading1': 32, 'Heading2': 28, 'Heading3': 26}.entries.map((e) => '<w:style w:type="paragraph" w:styleId="${e.key}"><w:name w:val="${e.key}"/><w:rPr><w:b/><w:sz w:val="${e.value}"/></w:rPr></w:style>').join()}</w:styles>',
    );
    final body = StringBuffer()
      ..write(
        _paragraph(
          [ExportRun(book.manifest.data['title']?.toString() ?? '')],
          style: 'Title',
          centered: true,
        ),
      )
      ..write(
        _paragraph([
          ExportRun(book.manifest.data['author']?.toString() ?? ''),
        ], centered: true),
      );
    for (final chapter in chapters) {
      body.write(
        _paragraph(
          [ExportRun(chapter.title)],
          style: 'Heading1',
          centered: true,
          pageBreak: true,
        ),
      );
      for (final block in chapter.blocks) {
        body.write(
          _paragraph(
            block.type == 'scene' ? [const ExportRun('* * *')] : block.runs,
            style: block.type == 'heading'
                ? (block.level == 3 ? 'Heading3' : 'Heading2')
                : null,
            centered: block.type == 'scene',
            quote: block.quote,
          ),
        );
      }
    }
    _put(
      zip,
      'word/document.xml',
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>$body<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
    );
    return ZipEncoder().encode(zip);
  }

  static String _htmlRuns(List<ExportRun> runs) => runs.map((r) {
    var value = xmlEscape(r.text).replaceAll('\n', '<br />');
    if (r.italic) value = '<em>$value</em>';
    if (r.bold) value = '<strong>$value</strong>';
    if (r.strike) value = '<del>$value</del>';
    return value;
  }).join();
  static List<int> _epub(BookSnapshot book, List<ExportChapter> chapters) {
    final zip = Archive();
    _put(zip, 'mimetype', 'application/epub+zip', stored: true);
    _put(
      zip,
      'META-INF/container.xml',
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    );
    _put(
      zip,
      'OEBPS/style.css',
      'body{font-family:serif;line-height:1.45}h1{text-align:center;margin:2em 0}p{text-indent:1.2em;margin:0}.quote{margin:1em 2em;text-indent:0}.scene{text-align:center;text-indent:0;margin:1.4em 0}',
    );
    final nav = <String>[];
    final manifest = <String>[
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
      '<item id="style" href="style.css" media-type="text/css"/>',
    ];
    final spine = <String>[];
    for (var i = 0; i < chapters.length; i++) {
      final chapter = chapters[i];
      final id = 'chapter-${i + 1}';
      nav.add('<li><a href="$id.xhtml">${xmlEscape(chapter.title)}</a></li>');
      manifest.add(
        '<item id="$id" href="$id.xhtml" media-type="application/xhtml+xml"/>',
      );
      spine.add('<itemref idref="$id"/>');
      final body = chapter.blocks
          .map(
            (b) => b.type == 'scene'
                ? '<p class="scene">* * *</p>'
                : b.type == 'heading'
                ? '<h${b.level == 3 ? 3 : 2}>${xmlEscape(b.text)}</h${b.level == 3 ? 3 : 2}>'
                : '<p${b.quote ? ' class="quote"' : ''}>${_htmlRuns(b.runs)}</p>',
          )
          .join('\n');
      _put(
        zip,
        'OEBPS/$id.xhtml',
        '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xmlEscape(chapter.title)}</title><link rel="stylesheet" href="style.css" type="text/css"/></head><body><h1>${xmlEscape(chapter.title)}</h1>$body</body></html>',
      );
    }
    _put(
      zip,
      'OEBPS/nav.xhtml',
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${nav.join()}</ol></nav></body></html>',
    );
    _put(
      zip,
      'OEBPS/content.opf',
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:${const Uuid().v4()}</dc:identifier><dc:title>${xmlEscape(book.manifest.data['title']?.toString() ?? '')}</dc:title><dc:creator>${xmlEscape(book.manifest.data['author']?.toString() ?? '')}</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">${DateTime.now().toUtc().toIso8601String().replaceFirst(RegExp(r'\.\d+Z$'), 'Z')}</meta></metadata><manifest>${manifest.join()}</manifest><spine>${spine.join()}</spine></package>',
    );
    return ZipEncoder().encode(zip);
  }

  static Future<Uint8List> _pdf(
    BookSnapshot book,
    List<ExportChapter> chapters,
  ) async {
    final doc = pw.Document(
      title: book.manifest.data['title']?.toString(),
      author: book.manifest.data['author']?.toString(),
    );
    final format = PdfPageFormat(
      6 * PdfPageFormat.inch,
      9 * PdfPageFormat.inch,
      marginAll: 0.65 * PdfPageFormat.inch,
    );
    final theme = pw.ThemeData.withFont(
      base: pw.Font.ttf(await rootBundle.load('assets/fonts/regular.ttf')),
      bold: pw.Font.ttf(await rootBundle.load('assets/fonts/bold.ttf')),
      italic: pw.Font.ttf(await rootBundle.load('assets/fonts/italic.ttf')),
      boldItalic: pw.Font.ttf(
        await rootBundle.load('assets/fonts/bold-italic.ttf'),
      ),
    );
    doc.addPage(
      pw.Page(
        pageFormat: format,
        theme: theme,
        build: (context) => pw.Center(
          child: pw.Column(
            mainAxisAlignment: pw.MainAxisAlignment.center,
            children: [
              pw.Text(
                book.manifest.data['title']?.toString() ?? '',
                style: const pw.TextStyle(fontSize: 24),
                textAlign: pw.TextAlign.center,
              ),
              pw.SizedBox(height: 30),
              pw.Text(book.manifest.data['author']?.toString() ?? ''),
            ],
          ),
        ),
      ),
    );
    for (final chapter in chapters) {
      doc.addPage(
        pw.MultiPage(
          pageFormat: format,
          theme: theme,
          maxPages: 10000,
          footer: (context) => pw.Align(
            alignment: pw.Alignment.center,
            child: pw.Text(
              '${context.pageNumber}',
              style: const pw.TextStyle(fontSize: 9),
            ),
          ),
          build: (context) => [
            pw.Padding(
              padding: const pw.EdgeInsets.only(top: 36, bottom: 24),
              child: pw.Center(
                child: pw.Text(
                  chapter.title,
                  style: pw.TextStyle(
                    fontSize: 20,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
              ),
            ),
            for (final block in chapter.blocks)
              if (block.type == 'scene')
                pw.Padding(
                  padding: const pw.EdgeInsets.symmetric(vertical: 12),
                  child: pw.Center(child: pw.Text('* * *')),
                )
              else if (block.type == 'heading')
                pw.Padding(
                  padding: const pw.EdgeInsets.only(top: 16, bottom: 8),
                  child: pw.Text(
                    block.text,
                    style: pw.TextStyle(
                      fontSize: block.level == 3 ? 13 : 15,
                      fontWeight: pw.FontWeight.bold,
                    ),
                  ),
                )
              else ...[
                pw.RichText(
                  overflow: pw.TextOverflow.span,
                  text: pw.TextSpan(
                    style: const pw.TextStyle(fontSize: 11, lineSpacing: 3),
                    children: [
                      for (final run in block.runs)
                        pw.TextSpan(
                          text: run.text,
                          style: pw.TextStyle(
                            fontWeight: run.bold
                                ? pw.FontWeight.bold
                                : pw.FontWeight.normal,
                            fontStyle: run.italic
                                ? pw.FontStyle.italic
                                : pw.FontStyle.normal,
                            decoration: run.strike
                                ? pw.TextDecoration.lineThrough
                                : pw.TextDecoration.none,
                          ),
                        ),
                    ],
                  ),
                ),
                pw.SizedBox(height: 8),
              ],
          ],
        ),
      );
    }
    return doc.save();
  }
}
