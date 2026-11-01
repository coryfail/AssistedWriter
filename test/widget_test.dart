import 'package:flutter_test/flutter_test.dart';
import 'package:assisted_writer/book/manifest.dart';

void main() {
  test('reads an existing book manifest in chapter order', () {
    final book = BookManifest.parse('''{
      "format": "assisted-writer-1", "title": "Example", "chapters": [
        {"id":"b", "title":"Second", "file":"chapter-02.md", "notesFile":"chapter-02.notes.md"},
        {"id":"a", "title":"First", "file":"chapter-01.md", "notesFile":"chapter-01.notes.md"}
      ]
    }''');
    expect(book.chapters.map((chapter) => chapter.id), ['b', 'a']);
    expect(book.data['title'], 'Example');
  });

  test('rejects chapter paths outside the chapters directory', () {
    for (final path in ['../other.md', r'..\other.md', '.hidden.md']) {
      expect(
        () => BookManifest.parse(
          '{"format":"assisted-writer-1","chapters":['
          '{"id":"1","title":"One","file":${_json(path)},"notesFile":"notes.md"}]}',
        ),
        throwsFormatException,
      );
    }
  });
}

String _json(String value) => '"${value.replaceAll(r'\', r'\\')}"';
