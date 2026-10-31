import 'dart:convert';
import 'dart:io';

import 'package:assisted_writer/book/store.dart';
import 'package:assisted_writer/book/tracker.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

void main() {
  late Directory parent;
  late BookStore store;
  setUp(() async {
    parent = await Directory.systemTemp.createTemp('writer-parity-');
    store = await BookStore.create(
      parent.path,
      'Parity',
      'Author',
      await File('assets/templates/book-AGENTS.md').readAsString(),
    );
  });
  tearDown(() async {
    await parent.delete(recursive: true);
  });
  test(
    'legacy migrations are idempotent and preserve custom guidance and notes',
    () async {
      await File(p.join(store.root, 'AGENTS.md'))
          .writeAsString('Custom author instructions.\n');
      await File(p.join(store.root, 'notes', 'ai-context.md')).delete();
      await File(p.join(store.root, 'notes', 'characters.md')).delete();
      final notes = await store.read('notes/book.md');
      await store.save('notes/book.md', 'Existing notes', notes.revision);
      final templates = <String, String>{};
      for (final name in [
        'book-AGENTS.md',
        'book-reference-addendum.md',
        'book-brainstorm-addendum.md',
        'book-entries-addendum.md',
        'book-assistant-addendum.md',
      ]) {
        templates[name] = await File('assets/templates/$name').readAsString();
      }
      await store.migrate(templates);
      final first = await store.read('AGENTS.md');
      await store.migrate(templates);
      expect((await store.read('AGENTS.md')).content, first.content);
      expect(first.content, contains('Custom author instructions.'));
      expect((await store.read('notes/book.md')).content, 'Existing notes');
      expect((await store.snapshot()).files, contains('notes/characters.md'));
    },
  );
  test(
    'approved edits require the same chapter version and a unique quote',
    () async {
      final chapter = (await store.manifest()).chapters.single;
      final path = 'chapters/${chapter.file}';
      final file = await store.read(path);
      await store.save(
        path,
        chapterContent(chapter.title, 'Unique phrase. Repeat. Repeat.'),
        file.revision,
      );
      final body = withoutHeading((await store.read(path)).content);
      final hash = contentRevision(body);
      await expectLater(
        store.approveSuggestion(chapter.id, 'Repeat.', 'Changed.', hash),
        throwsStateError,
      );
      final next = await store.approveSuggestion(
        chapter.id,
        'Unique phrase.',
        'Precise phrase.',
        hash,
      );
      expect(next, contentRevision('Precise phrase. Repeat. Repeat.'));
      await expectLater(
        store.approveSuggestion(
          chapter.id,
          'Precise phrase.',
          'Another.',
          hash,
        ),
        throwsStateError,
      );
      expect((await store.read(path)).content, contains('Precise phrase.'));
    },
  );
  test('approved tracker notes append inside the chosen stable entry and preserve other notes', () async {
    const id = '11111111-1111-4111-8111-111111111111';
    final previous = await store.read('notes/characters.md');
    final source =
        'Freeform before.\n\n${trackerBlock(id, 'Ogee', 'Existing description.')}\n\nFreeform after.\n';
    await store.save('notes/characters.md', source, previous.revision);
    await store.appendNote(
      'characters',
      (await store.manifest()).chapters.single.id,
      {'title': 'A detail', 'content': 'New approved fact.', 'entryId': id},
    );
    final result = (await store.read('notes/characters.md')).content;
    final entry = parseTracker(result).single;
    expect(entry.id, id);
    expect(entry.description, contains('Existing description.'));
    expect(entry.description, contains('New approved fact.'));
    expect(result, startsWith('Freeform before.'));
    expect(result, endsWith('Freeform after.\n'));
  });
  test(
    'concurrent saves from the same revision cannot overwrite each other',
    () async {
      final file = await store.read('notes/book.md');
      final results = await Future.wait([
        store
            .save('notes/book.md', 'First', file.revision)
            .then((_) => true, onError: (_) => false),
        BookStore(store.root)
            .save('notes/book.md', 'Second', file.revision)
            .then((_) => true, onError: (_) => false),
      ]);
      expect(results.where((r) => r), hasLength(1));
      expect(
        (await store.read('notes/book.md')).content,
        anyOf('First', 'Second'),
      );
    },
  );
  test('chapter rename, metadata, deletion and last-chapter guard preserve manifest contracts', () async {
    final first = (await store.manifest()).chapters.single;
    await store.addChapter();
    await store.renameChapter(first.id, 'Renamed\nchapter');
    expect((await store.manifest()).chapters.first.title, 'Renamed chapter');
    expect(
      (await store.read('chapters/${first.file}')).content,
      startsWith('# Renamed chapter\n'),
    );
    final raw = await store.read('book.json');
    await store.metadata('New book', 'New author', raw.revision);
    await expectLater(
      store.metadata('Stale', 'Author', raw.revision),
      throwsA(isA<FileSystemException>()),
    );
    await store.deleteChapter(first.id);
    expect((await store.manifest()).chapters, hasLength(1));
    expect(
      await File(p.join(store.root, 'chapters', first.file)).exists(),
      false,
    );
    await expectLater(
      store.deleteChapter((await store.manifest()).chapters.single.id),
      throwsStateError,
    );
  });
  test('book created by Flutter is readable by the existing Node implementation', () async {
    final script =
        'const book=require(process.argv[1]); book.readBook(process.argv[2]).then(b=>process.stdout.write(JSON.stringify({title:b.manifest.title,chapters:b.chapters.length}))).catch(e=>{process.stderr.write(e.stack);process.exitCode=1;});';
    final result = await Process.run('node', [
      '-e',
      script,
      p.absolute('../electron/book.cjs'),
      store.root,
    ]);
    expect(result.exitCode, 0, reason: '${result.stderr}');
    expect(jsonDecode(result.stdout as String), {
      'title': 'Parity',
      'chapters': 1,
    });
  });
  test(
    'book symlinks cannot reach files outside the book',
    () async {
      final outside = File(p.join(parent.path, 'outside.md'));
      await outside.writeAsString('External data');
      final notes = File(p.join(store.root, 'notes', 'book.md'));
      await notes.delete();
      await Link(notes.path).create(outside.path);
      await expectLater(store.read('notes/book.md'), throwsArgumentError);
      expect(await outside.readAsString(), 'External data');
    },
    skip: Platform.isWindows
        ? 'Symlink creation requires elevated privileges on Windows.'
        : false,
  );
}
