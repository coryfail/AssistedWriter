import 'dart:convert';

import 'package:assisted_writer/book/manifest.dart';
import 'package:assisted_writer/book/store.dart';
import 'package:assisted_writer/services/assistant.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  final manifest = BookManifest.parse(
    '{"format":"assisted-writer-1","title":"Book","chapters":[{"id":"1","title":"One","file":"one.md","notesFile":"one.notes.md"}]}',
  );
  final book = BookSnapshot(manifest, {
    'chapters/one.md': const BookFile(
      '# One\n\nA unique line. Repeated. Repeated.',
      'revision',
    ),
  });
  test(
    'only unique edits and supported continuity evidence survive validation',
    () {
      final result = AssistantService.validateReview(
        {
          'summary': 'Review',
          'findings': [],
          'suggestions': [
            {'quote': 'A unique line.', 'replacement': 'A precise line.'},
            {'quote': 'Repeated.', 'replacement': 'Different.'},
            {'quote': 'Not present', 'replacement': 'No'},
          ],
          'warnings': [
            {'evidence': 'A unique line.', 'detail': 'Supported'},
            {'evidence': 'Invented', 'detail': 'Unsupported'},
          ],
          'notes': [],
        },
        book,
        manifest.chapters.single,
        'editor',
        'A unique line.',
      );
      expect(result['suggestions'], hasLength(1));
      expect(result['warnings'], hasLength(1));
      expect(
        result['sourceHash'],
        contentRevision(book.body(manifest.chapters.single)),
      );
    },
  );
  test(
    'brainstorm never returns manuscript suggestions and limits note proposals',
    () {
      final result = AssistantService.validateReview(
        {
          'summary': 'Discussion',
          'findings': [
            <String, dynamic>{
              'title': 'An observation',
              'detail': 'Detail',
              'quote': '',
            },
          ],
          'suggestions': [],
          'warnings': [],
          'notes': [
            {
              'target': 'book',
              'title': 'Decision',
              'content': 'Chosen fact',
              'entryId': '',
            },
            {
              'target': 'unknown',
              'title': 'Invalid',
              'content': 'No',
              'entryId': '',
            },
            {
              'target': 'characters',
              'title': 'Entry',
              'content': 'Fact',
              'entryId': 'invalid',
            },
          ],
        },
        book,
        manifest.chapters.single,
        'brainstorm',
        '',
      );
      expect(result['findings'], isEmpty);
      expect(result['notes'], hasLength(1));
    },
  );
  test(
    'Responses requests disable storage and parse raw output message content',
    () async {
      final client = MockClient((request) async {
        final body = jsonDecode(request.body) as Map;
        expect(body['store'], false);
        expect(body['text']['format']['type'], 'json_schema');
        expect(request.headers['authorization'], 'Bearer test-only-key');
        return http.Response(
          jsonEncode({
            'status': 'completed',
            'output': [
              {
                'type': 'message',
                'content': [
                  {
                    'type': 'output_text',
                    'text': '{"message":"Improve chapter"}',
                  },
                ],
              },
            ],
          }),
          200,
        );
      });
      final service = AssistantService(client: client);
      addTearDown(service.close);
      final result = await service.commitMessage(
        apiKey: 'test-only-key',
        model: 'existing-model',
        diffs: 'Selected changes',
      );
      expect(result, 'Improve chapter');
    },
  );
  test(
    'incomplete or refused Responses output is never treated as an approval',
    () async {
      final service = AssistantService(
        client: MockClient(
          (_) async =>
              http.Response('{"status":"incomplete","output":[]}', 200),
        ),
      );
      addTearDown(service.close);
      await expectLater(
        service.commitMessage(
          apiKey: 'test-only-key',
          model: 'existing-model',
          diffs: 'changes',
        ),
        throwsStateError,
      );
    },
  );
}
