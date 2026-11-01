import 'dart:convert';

import 'package:archive/archive.dart';
import 'package:assisted_writer/book/manifest.dart';
import 'package:assisted_writer/book/store.dart';
import 'package:assisted_writer/services/export.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xml/xml.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final manifest = BookManifest.parse(
    '{"format":"assisted-writer-1","title":"A & B","author":"Writer","chapters":[{"id":"2","title":"Second","file":"two.md","notesFile":"two.notes.md"},{"id":"1","title":"First","file":"one.md","notesFile":"one.notes.md"}]}',
  );
  final book = BookSnapshot(manifest, {
    'chapters/two.md': const BookFile(
      '# Second\n\n**Bold** *italic* ~~gone~~\n\n> Quoted text\n\n- List item\n\n---\n\n## Heading',
      '',
    ),
    'chapters/one.md': const BookFile('# First\n\nFinal chapter.', ''),
    'notes/book.md': const BookFile('SECRET NOTES MUST NOT EXPORT', ''),
  });
  test('DOCX preserves order and formatting while excluding notes', () async {
    final archive = ZipDecoder().decodeBytes(
      await BookExporter.export(book, 'docx'),
    );
    final xml = utf8.decode(archive.find('word/document.xml')!.content);
    XmlDocument.parse(xml);
    expect(xml.indexOf('Second'), lessThan(xml.indexOf('First')));
    expect(xml, contains('<w:b/>'));
    expect(xml, contains('<w:i/>'));
    expect(xml, contains('<w:strike/>'));
    expect(xml, contains('* * *'));
    expect(xml, contains('A &amp; B'));
    expect(xml, isNot(contains('SECRET')));
  });
  test('EPUB starts with uncompressed mimetype and has valid XML and ordered spine', () async {
    final bytes = await BookExporter.export(book, 'epub');
    final archive = ZipDecoder().decodeBytes(bytes);
    expect(archive.files.first.name, 'mimetype');
    expect(archive.files.first.compression, CompressionType.none);
    for (final file in archive.files.where(
      (f) =>
          f.name.endsWith('.xml') ||
          f.name.endsWith('.opf') ||
          f.name.endsWith('.xhtml'),
    )) {
      XmlDocument.parse(utf8.decode(file.content));
    }
    final chapter = utf8.decode(archive.find('OEBPS/chapter-1.xhtml')!.content);
    expect(chapter, contains('Second'));
    expect(chapter, contains('<strong>Bold</strong>'));
    expect(chapter, contains('<del>gone</del>'));
    expect(chapter, isNot(contains('SECRET')));
  });
  test('PDF is generated as a 6 by 9 inch interior', () async {
    final bytes = await BookExporter.export(book, 'pdf');
    final content = latin1.decode(bytes);
    expect(content, startsWith('%PDF-'));
    expect(content, contains('/MediaBox[0 0 432 648]'));
  });
  test('a long prose paragraph flows across PDF pages', () async {
    final prose = List.filled(
      2500,
      'A longer paragraph continues with readable text.',
    ).join(' ');
    final longBook = BookSnapshot(manifest, {
      ...book.files,
      'chapters/two.md': BookFile('# Second\n\n$prose', ''),
    });
    final bytes = await BookExporter.export(longBook, 'pdf');
    expect(bytes.length, greaterThan(10000));
    expect(
      RegExp(r'/Type\s*/Page\b').allMatches(latin1.decode(bytes)).length,
      greaterThan(3),
    );
  });
}
