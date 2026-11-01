import 'dart:io';

import 'package:assisted_writer/book/session.dart';
import 'package:assisted_writer/book/store.dart';
import 'package:assisted_writer/services/settings.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    SharedPreferences.setMockInitialValues({'recentBooks': <String>[]});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('com.assistedwriter/book-folders'),
          (call) async =>
              call.method == 'restore' ? (call.arguments as Map)['path'] : null,
        );
  });
  test('a concurrent chapter-title change prevents an old heading from being saved', () async {
    final parent = await Directory.systemTemp.createTemp('writer-heading-');
    addTearDown(() => parent.delete(recursive: true));
    final store = await BookStore.create(
      parent.path,
      'Title race',
      'Writer',
      'Guide',
    );
    final session = WriterSession(await AppSettings.load(), {});
    addTearDown(session.dispose);
    expect(await session.activate(store.root), true);
    session.edit('Pending prose.');
    await store.renameChapter(session.chapter!.id, 'External title');
    expect(await session.flush(), false);
    expect(session.draft, 'Pending prose.');
    expect(
      (await store.read(session.path!)).content,
      startsWith('# External title\n'),
    );
  });
  test('interrupted drafts recover and stale revisions never overwrite external edits', () async {
    final parent = await Directory.systemTemp.createTemp('writer-session-');
    addTearDown(() => parent.delete(recursive: true));
    final store = await BookStore.create(
      parent.path,
      'Recovery',
      'Writer',
      'Guide',
    );
    final settings = await AppSettings.load();
    final first = WriterSession(settings, {});
    expect(await first.activate(store.root), true);
    first.edit('An unsaved draft.');
    await Future<void>.delayed(Duration.zero);
    first.dispose();
    final second = WriterSession(settings, {});
    addTearDown(second.dispose);
    expect(await second.activate(store.root), true);
    expect(second.draft, 'An unsaved draft.');
    expect(second.dirty, true);
    final file = await store.read(second.path!);
    await store.save(
      second.path!,
      '# Chapter 1\n\nExternal revision.\n',
      file.revision,
    );
    expect(await second.flush(), false);
    expect(second.draft, 'An unsaved draft.');
    expect(second.conflict, true);
    expect(
      (await store.read(second.path!)).content,
      contains('External revision.'),
    );
    await second.reload(discard: true);
    expect(second.draft, 'External revision.');
    expect(second.dirty, false);
    expect(second.conflict, false);
    second.edit('Approved new draft.');
    expect(await second.flush(), true);
    expect(settings.draft(store.root, second.path!), isNull);
    expect(
      (await store.read(second.path!)).content,
      contains('Approved new draft.'),
    );
  });
}
