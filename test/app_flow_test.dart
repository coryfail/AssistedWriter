import 'dart:io';

import 'package:assisted_writer/book/store.dart';
import 'package:assisted_writer/main.dart';
import 'package:assisted_writer/services/settings.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'opens an existing book, switches to source, and autosaves the manuscript',
    (tester) async {
      late Directory temp;
      late BookStore store;
      late AppSettings settings;
      await tester.runAsync(() async {
        temp = await Directory.systemTemp.createTemp('writer-ui-');
        store = await BookStore.create(
          temp.path,
          'UI Test',
          'Author',
          await File('assets/templates/book-AGENTS.md').readAsString(),
        );
        SharedPreferences.setMockInitialValues({'recentBooks': <String>[]});
        settings = await AppSettings.load();
      });
      addTearDown(() => temp.delete(recursive: true));
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
            const MethodChannel('com.assistedwriter/book-folders'),
            (call) async => call.method == 'pick'
                ? store.root
                : call.method == 'restore'
                ? (call.arguments as Map)['path']
                : null,
          );
      await tester.pumpWidget(
        AssistedWriterApp(
          settings: settings,
          templates: const {},
          pickFolder: () async => store.root,
        ),
      );
      await tester.pumpAndSettle();
      await tester.runAsync(() async {
        await tester.tap(find.widgetWithText(FilledButton, 'Open book'));
        await Future<void>.delayed(const Duration(milliseconds: 100));
      });
      for (
        var i = 0;
        i < 200 && find.text('Formatted text').evaluate().isEmpty;
        i++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump();
      }
      await tester.pump(const Duration(milliseconds: 100));
      expect(
        find.text('Formatted text'),
        findsOneWidget,
        reason: find
            .byType(SelectableText)
            .evaluate()
            .map((e) => (e.widget as SelectableText).data)
            .join('\n'),
      );
      await tester.tap(find.text('Source'));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.enterText(
        find.byType(TextField),
        'A manuscript written in Flutter.',
      );
      await tester.pump(const Duration(seconds: 1));
      var saved = '';
      for (var i = 0; i < 100; i++) {
        await tester.runAsync(() async {
          saved = (await store.read('chapters/chapter-01.md')).content;
          await Future<void>.delayed(const Duration(milliseconds: 10));
        });
        await tester.pump(const Duration(milliseconds: 10));
        if (saved.contains('A manuscript written in Flutter.')) break;
      }
      expect(saved, '# Chapter 1\n\nA manuscript written in Flutter.\n');
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
    },
  );
}
