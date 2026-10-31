import 'dart:io';

import 'package:assisted_writer/book/store.dart';
import 'package:assisted_writer/services/git.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

Future<String> git(String root, List<String> args) async {
  final result = await Process.run('git', args, workingDirectory: root);
  if (result.exitCode != 0) throw StateError('${result.stderr}');
  return result.stdout as String;
}

void main() {
  test('porcelain parser preserves whitespace, Unicode and rename records', () {
    final files = GitService.parseStatus(
      ' M chapters/a b.md\u0000R  chapters/new.md\u0000chapters/old.md\u0000?? notes/é.md\u0000',
    );
    expect(files.map((f) => f['path']), [
      'chapters/a b.md',
      'chapters/new.md',
      'notes/é.md',
    ]);
  });
  for (final native in [false, true]) {
    test(
      '${native ? 'libgit2' : 'CLI'} preserves unselected staged changes and syncs local branches',
      () async {
        final parent = await Directory.systemTemp.createTemp('writer-git-');
        addTearDown(() => parent.delete(recursive: true));
        final store = await BookStore.create(
          parent.path,
          'Test Book',
          'Author',
          'Guide',
        );
        final service = GitService(
          store.root,
          native: native,
          name: 'Test Author',
          email: 'test@example.invalid',
        );
        expect((await service.status())['initialized'], false);
        await service.initialize();
        await git(store.root, ['config', 'user.name', 'Test Author']);
        await git(store.root, ['config', 'user.email', 'test@example.invalid']);
        final initial = await service.status();
        await service.commit(
          'Create book',
          (initial['files'] as List).map((f) => f['path'] as String).toList(),
        );
        final book = await store.manifest();
        final path = 'chapters/${book.chapters.first.file}';
        final chapter = await store.read(path);
        await store.save(
          path,
          '# Chapter 1\n\nRevised manuscript.\n',
          chapter.revision,
        );
        final notes = await store.read('notes/book.md');
        await store.save(
          'notes/book.md',
          'Unrelated staged notes',
          notes.revision,
        );
        await git(store.root, ['add', 'notes/book.md']);
        await service.commit('Revise manuscript', [path]);
        expect(
          (await git(store.root, ['diff', '--cached', '--name-only'])).trim(),
          'notes/book.md',
        );
        expect(
          await git(store.root, ['show', 'HEAD:notes/book.md']),
          isNot(contains('Unrelated staged')),
        );
        expect(
          await service.diff('notes/book.md'),
          contains('Unrelated staged notes'),
        );
        await expectLater(
          service.branch('draft', create: true),
          throwsStateError,
        );
        await service.commit('Update notes', ['notes/book.md']);
        await service.branch('draft', create: true);
        expect((await service.status())['branch'], 'draft');
        await service.branch('main');
        final remote = p.join(parent.path, 'remote.git');
        await Directory(remote).create();
        await git(remote, ['init', '--bare']);
        await service.remote(remote);
        await service.sync('push');
        final clone = p.join(parent.path, 'clone');
        await git(parent.path, ['clone', '--branch', 'main', remote, clone]);
        await git(clone, ['config', 'user.name', 'Other Author']);
        await git(clone, ['config', 'user.email', 'other@example.invalid']);
        await File(p.join(clone, 'notes', 'timeline.md'))
            .writeAsString('Remote timeline change');
        await git(clone, ['add', 'notes/timeline.md']);
        await git(clone, ['commit', '-m', 'Update timeline']);
        await git(clone, ['push']);
        await service.sync('fetch');
        expect((await service.status())['behind'], 1);
        await service.sync('pull');
        expect(
          (await store.read('notes/timeline.md')).content,
          'Remote timeline change',
        );
        expect((await service.status())['files'], isEmpty);
      },
      timeout: const Timeout(Duration(minutes: 2)),
    );
  }
}
