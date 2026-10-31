import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:path/path.dart' as p;
import 'package:uuid/uuid.dart';

import 'manifest.dart';
import 'tracker.dart';

String contentRevision(String content) =>
    sha256.convert(utf8.encode(content)).toString();
String withoutHeading(String content) =>
    content.replaceFirst(RegExp(r'^# [^\n]*\n(?:\n)?'), '').trim();
String chapterContent(String title, String body) =>
    '# $title\n\n${body.trim()}\n';
String chapterContext(BookChapter chapter) =>
    'chapters/${chapter.file.substring(0, chapter.file.length - 3)}.context.md';
const referenceNames = ['characters', 'locations', 'timeline', 'terminology'];
const noteTargets = ['book', 'chapter', ...referenceNames];

class BookFile {
  const BookFile(this.content, this.revision);
  final String content;
  final String revision;
}

class BookSnapshot {
  const BookSnapshot(this.manifest, this.files);
  final BookManifest manifest;
  final Map<String, BookFile> files;
  String text(String path) => files[path]?.content ?? '';
  String body(BookChapter chapter) =>
      withoutHeading(text('chapters/${chapter.file}'));
}

class BookStore {
  BookStore(this.root);
  final String root;
  static final Map<String, Future<void>> _queues = {};

  /// Serialize app-originated operations across handles for the same book.
  /// Revision checks additionally detect edits made by external applications.
  Future<T> _exclusive<T>(Future<T> Function() action) async {
    final key = p.normalize(p.absolute(root));
    final previous = _queues[key] ?? Future<void>.value();
    final completed = Completer<void>();
    _queues[key] = completed.future;
    await previous;
    try {
      return await action();
    } finally {
      completed.complete();
      if (identical(_queues[key], completed.future)) _queues.remove(key);
    }
  }

  static Future<BookStore> create(
    String parent,
    String title,
    String author,
    String agentGuide,
  ) async {
    final cleanTitle = title.trim().replaceAll(RegExp(r'[\r\n]+'), ' ');
    if (cleanTitle.isEmpty) throw ArgumentError('Book title is required.');
    var slug = cleanTitle
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    if (slug.length > 48) slug = slug.substring(0, 48);
    final store = BookStore(p.join(parent, slug.isEmpty ? 'untitled' : slug));
    return store._exclusive(() async {
      if (await FileSystemEntity.type(store.root) !=
          FileSystemEntityType.notFound) {
        throw FileSystemException(
          'A book folder with this name already exists.',
          store.root,
        );
      }
      await Directory(store.root).create();
      for (final name in ['chapters', 'notes', 'editorial', 'exports']) {
        await Directory(p.join(store.root, name)).create();
      }
      final chapter = {
        'id': const Uuid().v4(),
        'title': 'Chapter 1',
        'file': 'chapter-01.md',
        'notesFile': 'chapter-01.notes.md',
      };
      final manifest = {
        'format': 'assisted-writer-1',
        'title': cleanTitle,
        'author': author.trim(),
        'genre': 'Fiction',
        'chapters': [chapter],
        'createdAt': DateTime.now().toUtc().toIso8601String(),
      };
      final files = <String, String>{
        'AGENTS.md': agentGuide,
        'chapters/chapter-01.md': chapterContent('Chapter 1', ''),
        'chapters/chapter-01.notes.md': '# Notes for Chapter 1\n\n',
        'chapters/chapter-01.context.md': '# AI Context for Chapter 1\n\n',
        'notes/book.md': '# Book Notes\n\n',
        'notes/ai-context.md': '# AI Context for This Book\n\n',
        for (final name in referenceNames)
          'notes/$name.md': '# ${_capital(name)}\n\n',
      };
      for (final entry in files.entries) {
        await store._createMissing(entry.key, entry.value);
      }
      // The manifest is the final publication step for a newly created book.
      await store._createMissing('book.json', _json(manifest));
      return store;
    });
  }

  static String _capital(String name) =>
      '${name[0].toUpperCase()}${name.substring(1)}';
  static String _json(Object value) =>
      '${const JsonEncoder.withIndent('  ').convert(value)}\n';

  Future<File> _file(String relativePath) async {
    final parts = relativePath.split('/');
    if (parts.any(
      (part) =>
          part.isEmpty ||
          part == '.' ||
          part == '..' ||
          part.contains(r'\') ||
          part.contains(':') ||
          part.contains('\u0000'),
    )) {
      throw ArgumentError('Invalid book path.');
    }
    final canonicalRoot = await Directory(root).resolveSymbolicLinks();
    final file = File(p.joinAll([canonicalRoot, ...parts]));
    final parent = await file.parent.resolveSymbolicLinks();
    if (parent != canonicalRoot && !p.isWithin(canonicalRoot, parent)) {
      throw ArgumentError('Book path points outside this book.');
    }
    if (await FileSystemEntity.type(file.path, followLinks: false) ==
        FileSystemEntityType.link) {
      final target = await file.resolveSymbolicLinks();
      if (!p.isWithin(canonicalRoot, target)) {
        throw ArgumentError('Book file points outside this book.');
      }
    }
    return file;
  }

  Future<BookFile> read(String path) async {
    final content = await (await _file(path)).readAsString();
    return BookFile(content, contentRevision(content));
  }

  Future<BookManifest> manifest() async =>
      BookManifest.parse((await read('book.json')).content);

  Future<void> _createMissing(String path, String content) async {
    final file = await _file(path);
    try {
      await file.create(exclusive: true);
    } on FileSystemException {
      if (await file.exists()) return;
      rethrow;
    }
    await file.writeAsString(content, flush: true);
  }

  Future<BookSnapshot> snapshot() async {
    final manifestFile = await read('book.json');
    final book = BookManifest.parse(manifestFile.content);
    final paths = [
      'AGENTS.md',
      'notes/book.md',
      'notes/ai-context.md',
      for (final name in referenceNames) 'notes/$name.md',
      for (final chapter in book.chapters) ...[
        'chapters/${chapter.file}',
        'chapters/${chapter.notesFile}',
        chapterContext(chapter),
      ],
    ];
    final files = <String, BookFile>{'book.json': manifestFile};
    for (final path in paths) {
      files[path] = await read(path);
    }
    if ((await read('book.json')).revision != manifestFile.revision) {
      throw StateError(
        'The book structure changed while loading. Reload the book.',
      );
    }
    return BookSnapshot(book, files);
  }

  Future<void> migrate(Map<String, String> templates) => _exclusive(() async {
    var book = await manifest();
    // Validate mandatory files before changing an older book.
    await read('notes/book.md');
    for (final chapter in book.chapters) {
      await read('chapters/${chapter.file}');
      await read('chapters/${chapter.notesFile}');
    }
    await Directory(p.join(root, 'notes')).create();
    await Directory(p.join(root, 'editorial')).create();
    await Directory(p.join(root, 'exports')).create();
    await _createMissing(
      'notes/ai-context.md',
      '# AI Context for This Book\n\n',
    );
    for (final name in referenceNames) {
      await _createMissing('notes/$name.md', '# ${_capital(name)}\n\n');
    }
    for (final chapter in book.chapters) {
      await _createMissing(
        chapterContext(chapter),
        '# AI Context for ${chapter.title}\n\n',
      );
    }
    await _createMissing('AGENTS.md', templates['book-AGENTS.md'] ?? '');
    var guide = await read('AGENTS.md');
    if (guide.content.trim().isEmpty) {
      await _writeChecked(
        'AGENTS.md',
        templates['book-AGENTS.md'] ?? '',
        guide.revision,
      );
    }
    for (final entry in {
      'context-v1': 'book-reference-addendum.md',
      'brainstorm-v1': 'book-brainstorm-addendum.md',
      'entries-v1': 'book-entries-addendum.md',
      'assistant-v2': 'book-assistant-addendum.md',
    }.entries) {
      guide = await read('AGENTS.md');
      if (!guide.content.contains('<!-- assisted-writer-${entry.key} -->')) {
        final addition = templates[entry.value];
        if (addition != null) {
          await _writeChecked(
            'AGENTS.md',
            '${guide.content.trimRight()}\n\n$addition',
            guide.revision,
          );
        }
      }
    }
    // Preserve the narrow default-title migration from the Electron app.
    for (final chapter in book.chapters) {
      if (chapter.file == 'chapter-01.md' && chapter.title == 'Chapter One') {
        final file = await read('chapters/${chapter.file}');
        if (file.content.startsWith('# Chapter One\n')) {
          final raw = await read('book.json');
          for (final entry in {
            'chapters/${chapter.file}': ['# Chapter One\n', '# Chapter 1\n'],
            'chapters/${chapter.notesFile}': [
              '# Notes for Chapter One\n',
              '# Notes for Chapter 1\n',
            ],
            chapterContext(chapter): [
              '# AI Context for Chapter One\n',
              '# AI Context for Chapter 1\n',
            ],
          }.entries) {
            final text = await read(entry.key);
            if (text.content.startsWith(entry.value[0])) {
              await _writeChecked(
                entry.key,
                entry.value[1] + text.content.substring(entry.value[0].length),
                text.revision,
              );
            }
          }
          final data = jsonDecode(raw.content) as Map<String, dynamic>;
          for (final entry in data['chapters'] as List) {
            if (entry['id'] == chapter.id) entry['title'] = 'Chapter 1';
          }
          await _writeChecked('book.json', _json(data), raw.revision);
          book = await manifest();
        }
      }
    }
  });

  Future<String> save(
    String path,
    String content,
    String expectedRevision, {
    String? expectedManifestRevision,
  }) => _exclusive(() async {
    final manifestFile = await read('book.json');
    if (expectedManifestRevision != null &&
        expectedManifestRevision != manifestFile.revision) {
      throw const FileSystemException(
        'The book structure changed outside Assisted Writer. Reload before saving.',
      );
    }
    final book = BookManifest.parse(manifestFile.content);
    final allowed = {
      'notes/book.md',
      'notes/ai-context.md',
      for (final name in referenceNames) 'notes/$name.md',
      for (final chapter in book.chapters) ...[
        'chapters/${chapter.file}',
        'chapters/${chapter.notesFile}',
        chapterContext(chapter),
      ],
    };
    if (!allowed.contains(path)) throw ArgumentError('Unknown book file.');
    return _writeChecked(path, content, expectedRevision);
  });

  Future<String> _writeChecked(
    String path,
    String content,
    String expected,
  ) async {
    final file = await _file(path);
    final current = await read(path);
    if (current.revision != expected) {
      throw const FileSystemException(
        'This file changed outside Assisted Writer. Reload it before saving.',
      );
    }
    final temporary = File('${file.path}.${const Uuid().v4()}.tmp');
    try {
      await temporary.create(exclusive: true);
      await temporary.writeAsString(content, flush: true);
      if ((await read(path)).revision != expected) {
        throw const FileSystemException(
          'This file changed outside Assisted Writer. Reload it before saving.',
        );
      }
      await temporary.rename(file.path);
    } finally {
      if (await temporary.exists()) await temporary.delete();
    }
    return contentRevision(content);
  }

  Future<void> addChapter() => _exclusive(() async {
    final raw = await read('book.json');
    final book = BookManifest.parse(raw.content);
    final id = const Uuid().v4();
    final stem = 'chapter-$id';
    final title = 'Chapter ${book.chapters.length + 1}';
    final entry = {
      'id': id,
      'title': title,
      'file': '$stem.md',
      'notesFile': '$stem.notes.md',
    };
    await _createMissing('chapters/$stem.md', chapterContent(title, ''));
    await _createMissing('chapters/$stem.notes.md', '# Notes for $title\n\n');
    await _createMissing(
      'chapters/$stem.context.md',
      '# AI Context for $title\n\n',
    );
    await _writeChecked(
      'book.json',
      _json({
        ...book.data,
        'chapters': [...book.data['chapters'] as List, entry],
      }),
      raw.revision,
    );
  });

  Future<void> reorderChapter(String id, int direction) => _exclusive(() async {
    if (direction != -1 && direction != 1) {
      throw ArgumentError('Invalid direction.');
    }
    final raw = await read('book.json');
    final book = BookManifest.parse(raw.content);
    final chapters = List<dynamic>.from(book.data['chapters'] as List);
    final index = book.chapters.indexWhere((c) => c.id == id);
    if (index < 0) throw ArgumentError('Chapter not found.');
    final next = index + direction;
    if (next < 0 || next >= chapters.length) return;
    final entry = chapters.removeAt(index);
    chapters.insert(next, entry);
    await _writeChecked(
      'book.json',
      _json({...book.data, 'chapters': chapters}),
      raw.revision,
    );
  });

  Future<void> metadata(String title, String author, String expected) =>
      _exclusive(() async {
        final raw = await read('book.json');
        final book = BookManifest.parse(raw.content);
        if (title.trim().isEmpty) {
          throw ArgumentError('Book title is required.');
        }
        await _writeChecked(
          'book.json',
          _json({...book.data, 'title': title.trim(), 'author': author.trim()}),
          expected,
        );
      });

  Future<void> renameChapter(String id, String title) => _exclusive(() async {
    final clean = title.trim().replaceAll(RegExp(r'[\r\n]+'), ' ');
    if (clean.isEmpty) throw ArgumentError('Chapter title is required.');
    final raw = await read('book.json');
    final book = BookManifest.parse(raw.content);
    final chapter = book.chapters.firstWhere((c) => c.id == id);
    final file = await read('chapters/${chapter.file}');
    final data = jsonDecode(raw.content) as Map<String, dynamic>;
    for (final entry in data['chapters'] as List) {
      if (entry['id'] == id) entry['title'] = clean;
    }
    final updated = chapterContent(clean, withoutHeading(file.content));
    final newRevision = await _writeChecked(
      'chapters/${chapter.file}',
      updated,
      file.revision,
    );
    try {
      await _writeChecked('book.json', _json(data), raw.revision);
    } catch (_) {
      await _writeChecked(
        'chapters/${chapter.file}',
        file.content,
        newRevision,
      );
      rethrow;
    }
  });

  Future<void> deleteChapter(String id) => _exclusive(() async {
    final raw = await read('book.json');
    final book = BookManifest.parse(raw.content);
    if (book.chapters.length <= 1) {
      throw StateError('A book must contain at least one chapter.');
    }
    final chapter = book.chapters.firstWhere((c) => c.id == id);
    final chapters = (book.data['chapters'] as List)
        .where((c) => c['id'] != id)
        .toList();
    await _writeChecked(
      'book.json',
      _json({...book.data, 'chapters': chapters}),
      raw.revision,
    );
    for (final path in [
      'chapters/${chapter.file}',
      'chapters/${chapter.notesFile}',
      chapterContext(chapter),
    ]) {
      final file = await _file(path);
      if (await file.exists()) await file.delete();
    }
  });

  Future<String> approveSuggestion(
    String chapterId,
    String quote,
    String replacement,
    String expectedHash,
  ) => _exclusive(() async {
    if (quote.isEmpty) {
      throw ArgumentError('The suggestion has no quoted text.');
    }
    final book = await manifest();
    final chapter = book.chapters.firstWhere((c) => c.id == chapterId);
    final path = 'chapters/${chapter.file}';
    final file = await read(path);
    final body = withoutHeading(file.content);
    if (contentRevision(body) != expectedHash) {
      throw StateError(
        'The chapter changed since this review. Run the review again.',
      );
    }
    final index = body.indexOf(quote);
    if (index < 0 || body.indexOf(quote, index + quote.length) >= 0) {
      throw StateError(
        'The quoted text could not be matched uniquely. Make this edit manually.',
      );
    }
    final updated = body.replaceRange(index, index + quote.length, replacement);
    await _writeChecked(
      path,
      chapterContent(chapter.title, updated),
      file.revision,
    );
    return contentRevision(updated.trim());
  });

  Future<void> appendNote(
    String target,
    String chapterId,
    Map<String, dynamic> note,
  ) => _exclusive(() async {
    if (!noteTargets.contains(target)) {
      throw ArgumentError('Unknown notes destination.');
    }
    final title = (note['title'] as String? ?? '')
        .trim()
        .replaceAll(RegExp(r'[\r\n]+'), ' ')
        .replaceFirst(RegExp(r'^#+\s*'), '');
    final content = (note['content'] as String? ?? '').trim();
    if (title.isEmpty || content.isEmpty || content.length > 10000) {
      throw ArgumentError(
        'The proposed note needs a title and content under 10,000 characters.',
      );
    }
    final book = await manifest();
    final path = target == 'book'
        ? 'notes/book.md'
        : target == 'chapter'
        ? 'chapters/${book.chapters.firstWhere((c) => c.id == chapterId).notesFile}'
        : 'notes/$target.md';
    final file = await read(path);
    final id = note['entryId'] as String? ?? '';
    String updated;
    if (id.isNotEmpty) {
      if (!['characters', 'locations'].contains(target)) {
        throw ArgumentError('Invalid tracker destination.');
      }
      final entries = parseTracker(file.content)
          .where((e) => e.id == id)
          .toList();
      if (entries.length != 1) {
        throw StateError(
          'The tracker entry changed. Review the proposal before saving.',
        );
      }
      final entry = entries.single;
      updated = updateTrackerEntry(
        file.content,
        id,
        entry.name,
        '${entry.description.trimRight()}\n\n### $title\n\n$content',
      );
    } else if (['characters', 'locations'].contains(target)) {
      updated =
          '${file.content.trimRight()}\n\n${trackerBlock(const Uuid().v4(), title, content)}\n';
    } else {
      updated = '${file.content.trimRight()}\n\n## $title\n\n$content\n';
    }
    await _writeChecked(path, updated, file.revision);
  });

  Future<void> writeReport(Map<String, dynamic> report) async {
    final directory = Directory(p.join(root, 'editorial'));
    await directory.create();
    final name =
        '${DateTime.now().toUtc().toIso8601String().replaceAll(RegExp(r'[:.]'), '-')}-${const Uuid().v4()}.json';
    await _createMissing('editorial/$name', _json(report));
  }
}
