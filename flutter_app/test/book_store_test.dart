import 'dart:io';

import 'package:assisted_writer/book/store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

void main() {
  test('creates a compatible book and changes chapter order', () async {
    final parent = await Directory.systemTemp.createTemp('writer-create-');
    addTearDown(() => parent.delete(recursive: true));
    final store = await BookStore.create(
      parent.path,
      'Example Book',
      'Author',
      'guide',
    );
    var manifest = await store.manifest();
    expect(manifest.data['title'], 'Example Book');
    expect(manifest.chapters, hasLength(1));
    expect((await store.read('AGENTS.md')).content, 'guide');
    await store.addChapter();
    manifest = await store.manifest();
    expect(manifest.chapters, hasLength(2));
    final second = manifest.chapters[1];
    expect(
      (await store.read('chapters/${second.file}')).content,
      contains('# Chapter 2'),
    );
    await store.reorderChapter(second.id, -1);
    expect((await store.manifest()).chapters.first.id, second.id);
    await expectLater(
      BookStore.create(parent.path, 'Example Book', '', ''),
      throwsA(isA<FileSystemException>()),
    );
  });

  test('saves only recognized files and rejects stale revisions', () async {
    final dir = await Directory.systemTemp.createTemp('writer-test-');
    addTearDown(() => dir.delete(recursive: true));
    await Directory(p.join(dir.path, 'chapters')).create();
    await File(p.join(dir.path, 'book.json')).writeAsString(
      '''{"format":"assisted-writer-1","chapters":[{"id":"1","title":"One","file":"one.md","notesFile":"one.notes.md"}]}''',
    );
    final chapter = File(p.join(dir.path, 'chapters', 'one.md'));
    await chapter.writeAsString('# One\n\nOriginal\n');
    final store = BookStore(dir.path);
    final loaded = await store.read('chapters/one.md');
    await chapter.writeAsString('External change');
    await expectLater(
      store.save('chapters/one.md', 'New text', loaded.revision),
      throwsA(isA<FileSystemException>()),
    );
    expect(await chapter.readAsString(), 'External change');
    final current = await store.read('chapters/one.md');
    await store.save('chapters/one.md', 'New text', current.revision);
    expect(await chapter.readAsString(), 'New text');
    await expectLater(
      store.save('../outside.md', 'x', current.revision),
      throwsArgumentError,
    );
  });
}
