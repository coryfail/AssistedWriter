import 'dart:convert';
import 'dart:io';

import 'package:assisted_writer/book/store.dart';
import 'package:assisted_writer/services/git.dart';
import 'package:assisted_writer/services/github.dart';
import 'package:assisted_writer/services/mobile_library.dart';
import 'package:assisted_writer/services/settings.dart';
import 'package:assisted_writer/ui/mobile_library.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';

const repository = <String, dynamic>{
  'id': 123,
  'name': 'story',
  'full_name': 'author/story',
  'clone_url': 'https://github.com/author/story.git',
  'private': true,
};

class FixtureGit extends GitService {
  FixtureGit(super.root, {this.source});
  final String? source;
  bool initialized = false, failPush = false;
  String origin = '';
  int pushes = 0, commits = 0;
  List<Map<String, String>> files = [
    {'path': 'book.json', 'code': '??'},
  ];
  @override
  Future<void> clone(String url) async {
    await Directory(root).create();
    if (source == null) return;
    await for (final file in Directory(source!).list(recursive: true)) {
      final destination = p.join(root, p.relative(file.path, from: source));
      if (file is Directory) await Directory(destination).create();
      if (file is File) await file.copy(destination);
    }
  }

  @override
  Future<Map<String, dynamic>> status() async => initialized
      ? {'initialized': true, 'files': files, 'remote': origin}
      : {'initialized': false};
  @override
  Future<void> initialize() async {
    initialized = true;
  }

  @override
  Future<void> remote(String url) async {
    origin = url;
  }

  @override
  Future<void> commit(String message, List<String> selected) async {
    expect(selected, ['book.json']);
    commits++;
    files = [];
  }

  @override
  Future<void> sync(String action) async {
    expect(action, 'push');
    pushes++;
    if (failPush) throw StateError('Network interrupted');
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late AppSettings settings;
  late Directory temp;
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({'recentBooks': <String>[]});
    settings = await AppSettings.load();
    temp = await Directory.systemTemp.createTemp('writer-library-test-');
  });
  tearDown(() => temp.delete(recursive: true));
  test('device authorization uses a public client ID and exposes pending/slow-down responses', () async {
    var polls = 0;
    final api = GitHubService(
      clientId: 'public-client',
      client: MockClient((request) async {
        expect(request.url.host, 'github.com');
        final body = Uri.splitQueryString(request.body);
        expect(body['client_id'], 'public-client');
        expect(body.containsKey('client_secret'), false);
        if (request.url.path.endsWith('/device/code')) {
          expect(body['scope'], 'repo');
          return http.Response(
            jsonEncode({
              'device_code': 'device',
              'user_code': 'ABCD-EFGH',
              'interval': 5,
              'expires_in': 900,
            }),
            200,
          );
        }
        expect(body['device_code'], 'device');
        expect(
          body['grant_type'],
          'urn:ietf:params:oauth:grant-type:device_code',
        );
        return http.Response(
          jsonEncode(
            polls++ == 0
                ? {'error': 'authorization_pending'}
                : polls == 2
                ? {'error': 'slow_down'}
                : {'access_token': 'test-token'},
          ),
          200,
        );
      }),
    );
    addTearDown(api.close);
    expect((await api.startSignIn())['user_code'], 'ABCD-EFGH');
    expect((await api.pollSignIn('device'))['error'], 'authorization_pending');
    expect((await api.pollSignIn('device'))['error'], 'slow_down');
    expect((await api.pollSignIn('device'))['access_token'], 'test-token');
  });
  test('API paginates, creates private repositories, and keeps response secrets out of errors', () async {
    var created = 0;
    final api = GitHubService(
      client: MockClient((request) async {
        expect(request.headers['Authorization'], 'Bearer test-token');
        if (request.method == 'POST') {
          created++;
          expect(jsonDecode(request.body), containsPair('private', true));
          expect(jsonDecode(request.body), containsPair('auto_init', false));
          return http.Response(jsonEncode(repository), 201);
        }
        expect(request.url.queryParameters['page'], '2');
        expect(request.url.queryParameters['per_page'], '50');
        return http.Response('test-token should never appear in errors', 401);
      }),
    );
    addTearDown(api.close);
    await api.createRepository('test-token', 'story');
    expect(created, 1);
    await expectLater(
      api.createRepository('test-token', '../unsafe'),
      throwsArgumentError,
    );
    await expectLater(
      api.repositories('test-token', page: 2),
      throwsA(
        predicate(
          (e) => '$e'.contains('expired') && !'$e'.contains('test-token'),
        ),
      ),
    );
  });
  test('interrupted upload keeps the book and retries without another repository or commit', () async {
    var creates = 0;
    final api = GitHubService(
      client: MockClient((request) async {
        creates++;
        return http.Response(jsonEncode(repository), 201);
      }),
    );
    addTearDown(api.close);
    await settings.connectGitHub('test-token', {
      'id': 99,
      'login': 'author',
      'name': 'Author',
    });
    FixtureGit? git;
    final library = MobileLibrary(
      settings,
      api,
      base: temp,
      gitFactory: (root) async => git ??= FixtureGit(root)..failPush = true,
    );
    final book = await library.createLocal('A story', 'Author', 'Guidance');
    await expectLater(library.publish(book, 'story'), throwsStateError);
    expect((await library.books()).single.published, false);
    expect((await BookStore(book.root).manifest()).data['title'], 'A story');
    expect(book.repository?['id'], 123);
    git!.failPush = false;
    await library.publish(book, 'ignored-on-retry');
    expect(creates, 1);
    expect(git!.commits, 1);
    expect(git!.pushes, 2);
    expect((await library.books()).single.published, true);
    await settings.disconnectGitHub();
    expect(await settings.githubToken(), '');
    expect(settings.githubAccount, null);
    expect((await library.books()).single.root, book.root);
    expect(await File(p.join(book.root, 'book.json')).exists(), true);
  });
  test(
    'clones older books, reuses offline copies, and removes invalid clones',
    () async {
      final sourceParent = await Directory.systemTemp.createTemp(
        'writer-clone-source-',
      );
      addTearDown(() => sourceParent.delete(recursive: true));
      final source = await BookStore.create(
        sourceParent.path,
        'Legacy book',
        'Author',
        'Guide',
      );
      await File(p.join(source.root, 'chapters/chapter-01.context.md'))
          .delete();
      final api = GitHubService();
      addTearDown(api.close);
      var clones = 0;
      final library = MobileLibrary(
        settings,
        api,
        base: temp,
        gitFactory: (root) async {
          clones++;
          return FixtureGit(root, source: source.root);
        },
      );
      final book = await library.clone(repository);
      expect(book.title, 'Legacy book');
      expect((await library.clone(repository)).root, book.root);
      expect(clones, 1);
      final invalid = MobileLibrary(
        settings,
        api,
        base: temp,
        gitFactory: (root) async => FixtureGit(root),
      );
      await expectLater(
        invalid.clone({...repository, 'id': 456}),
        throwsStateError,
      );
      expect(await temp.list().length, 1);
      expect((await library.books()).single.root, book.root);
    },
  );
  test(
    'clone refuses credential URLs and other hosts before touching disk',
    () async {
      final git = GitService(p.join(temp.path, 'clone'), token: 'test-token');
      await expectLater(
        git.clone('https://test-token@github.com/author/book.git'),
        throwsArgumentError,
      );
      await expectLater(
        git.clone('https://example.com/author/book.git'),
        throwsArgumentError,
      );
      expect(await temp.list().isEmpty, true);
    },
  );
  testWidgets('browser sign-in respects slow-down and cancellation', (
    tester,
  ) async {
    var polls = 0;
    final api = GitHubService(
      clientId: 'public-client',
      client: MockClient((request) async {
        if (request.url.path == '/login/device/code') {
          return http.Response(
            jsonEncode({
              'device_code': 'device',
              'user_code': 'CODE-1234',
              'interval': 1,
              'expires_in': 900,
            }),
            200,
          );
        }
        if (request.url.path == '/login/oauth/access_token') {
          polls++;
          return http.Response(
            jsonEncode({
              'error': polls == 1 ? 'authorization_pending' : 'slow_down',
            }),
            200,
          );
        }
        throw StateError('Unexpected request: ${request.url.path}');
      }),
    );
    final library = MobileLibrary(settings, api, base: temp);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MobileLibraryView(
            settings: settings,
            templates: const {},
            library: library,
            github: api,
            openBrowser: (uri) async {
              expect(uri.toString(), 'https://github.com/login/device');
              return true;
            },
            onOpen: (_) async {},
          ),
        ),
      ),
    );
    for (var i = 0; i < 100; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 10)),
      );
      await tester.pump();
      if (tester
              .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Sign in to GitHub'),
              )
              .onPressed !=
          null) {
        break;
      }
    }
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Sign in to GitHub'),
          )
          .onPressed,
      isNotNull,
    );
    await tester.tap(find.text('Sign in to GitHub'));
    await tester.pump();
    await tester.pump();
    for (var i = 0; i < 10; i++) {
      await tester.pump();
    }
    expect(
      find.text('CODE-1234', findRichText: true),
      findsOneWidget,
      reason: find
          .byType(SelectableText)
          .evaluate()
          .map((e) => (e.widget as SelectableText).data)
          .join('\n'),
    );
    await tester.pump(const Duration(seconds: 1));
    expect(polls, 1);
    await tester.pump(const Duration(seconds: 1));
    expect(polls, 2);
    await tester.pump(const Duration(seconds: 5));
    expect(polls, 2);
    await tester.pump(const Duration(seconds: 1));
    expect(polls, 3);
    await tester.ensureVisible(find.text('Cancel sign-in'));
    await tester.tap(find.text('Cancel sign-in'));
    await tester.pump(const Duration(seconds: 30));
    expect(polls, 3);
    expect(settings.githubAccount, null);
    expect(find.text('CODE-1234', findRichText: true), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets(
    'mobile library opens local books offline without a folder picker',
    (tester) async {
      final api = GitHubService();
      final library = MobileLibrary(settings, api, base: temp);
      late LibraryBook book;
      await tester.runAsync(() async {
        book = await library.createLocal('Offline book', 'Author', 'Guide');
      });
      String? opened;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MobileLibraryView(
              settings: settings,
              templates: const {},
              library: library,
              github: api,
              onOpen: (root) async {
                opened = root;
              },
            ),
          ),
        ),
      );
      for (
        var i = 0;
        i < 30 && find.text('Offline book').evaluate().isEmpty;
        i++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 10)),
        );
        await tester.pump();
      }
      await tester.ensureVisible(find.text('Offline book'));
      await tester.tap(find.text('Offline book'));
      await tester.pump();
      expect(opened, book.root);
      expect(find.text('Sign in to GitHub'), findsOneWidget);
      expect(find.text('Open book'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
