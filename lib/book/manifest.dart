import 'dart:convert';

/// The on-disk manifest is shared with the existing desktop application.
class BookManifest {
  BookManifest._(this.data, this.chapters);

  final Map<String, dynamic> data;
  final List<BookChapter> chapters;

  factory BookManifest.parse(String source) {
    final decoded = jsonDecode(source);
    if (decoded is! Map<String, dynamic> ||
        decoded['format'] != 'assisted-writer-1' ||
        decoded['chapters'] is! List) {
      throw const FormatException(
        'This is not a supported Assisted Writer book.',
      );
    }
    final chapters = <BookChapter>[];
    final ids = <String>{};
    final paths = <String>{};
    for (final entry in decoded['chapters'] as List) {
      if (entry is! Map<String, dynamic>) {
        throw const FormatException(
          'The book manifest contains an invalid chapter entry.',
        );
      }
      final chapter = BookChapter.parse(entry);
      if (!ids.add(chapter.id) ||
          !paths.add(chapter.file) ||
          !paths.add(chapter.notesFile) ||
          !paths.add(
            '${chapter.file.substring(0, chapter.file.length - 3)}.context.md',
          )) {
        throw const FormatException(
          'Chapter IDs and filenames must be unique.',
        );
      }
      chapters.add(chapter);
    }
    return BookManifest._(decoded, List.unmodifiable(chapters));
  }
}

class BookChapter {
  BookChapter._(this.id, this.title, this.file, this.notesFile);

  final String id;
  final String title;
  final String file;
  final String notesFile;

  factory BookChapter.parse(Map<String, dynamic> value) {
    final id = value['id'];
    final title = value['title'];
    final file = value['file'];
    final notesFile = value['notesFile'];
    bool validFilename(dynamic name) =>
        name is String &&
        name.endsWith('.md') &&
        !name.startsWith('.') &&
        !name.contains('/') &&
        !name.contains('\\') &&
        !name.contains(':') &&
        !name.contains('\u0000');
    if (id is! String ||
        id.isEmpty ||
        title is! String ||
        title.isEmpty ||
        !validFilename(file) ||
        !validFilename(notesFile)) {
      throw const FormatException(
        'The book manifest contains an invalid chapter entry.',
      );
    }
    return BookChapter._(id, title, file as String, notesFile as String);
  }
}
