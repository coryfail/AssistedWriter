import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../book/store.dart';
import 'git.dart';
import 'github.dart';
import 'settings.dart';

class LibraryBook {
  LibraryBook(this.directory, this.data);
  final Directory directory;
  final Map<String, dynamic> data;
  String get root => p.join(directory.path, 'repository');
  String get title => data['title'] as String;
  Map<String, dynamic>? get repository =>
      data['repository'] as Map<String, dynamic>?;
  bool get published => data['published'] == true;
  Future<void> save() async {
    final file = File(p.join(directory.path, 'library.json'));
    final temp = File('${file.path}.tmp');
    await temp.writeAsString(jsonEncode(data), flush: true);
    await temp.rename(file.path);
  }
}

/// App-private clones are durable working copies, not disposable network caches.
/// Catalog paths are relative to app support, so iOS container moves are safe.
class MobileLibrary {
  MobileLibrary(
    this.settings,
    this.github, {
    this.base,
    this.gitFactory,
    this.templates = const {},
  });
  final AppSettings settings;
  final GitHubService github;
  final Directory? base;
  final Future<GitService> Function(String root)? gitFactory;
  final Map<String, String> templates;
  Future<Directory> directory() async {
    final root =
        base ??
        Directory(
          p.join((await getApplicationSupportDirectory()).path, 'books'),
        );
    await root.create(recursive: true);
    return root;
  }

  Future<List<LibraryBook>> books() async {
    final result = <LibraryBook>[];
    await for (final entity in (await directory()).list(followLinks: false)) {
      if (entity is! Directory) continue;
      final catalog = File(p.join(entity.path, 'library.json'));
      if (!await catalog.exists()) continue;
      try {
        final data = Map<String, dynamic>.from(
          jsonDecode(await catalog.readAsString()) as Map,
        );
        if (data['title'] is String) result.add(LibraryBook(entity, data));
      } on FormatException {
        // Preserve damaged metadata and all manuscripts for recovery.
      }
    }
    result.sort(
      (a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()),
    );
    return result;
  }

  Future<LibraryBook> clone(Map<String, dynamic> repository) async {
    final existing = (await books()).where(
      (book) => book.repository?['id'] == repository['id'],
    );
    if (existing.isNotEmpty) return existing.first;
    final container = await (await directory()).createTemp('book-');
    final book = LibraryBook(container, {
      'title': repository['name'],
      'repository': repository,
      'published': true,
    });
    var complete = false;
    try {
      await (await git(book.root)).clone(repository['clone_url'] as String);
      final manifest = await BookStore(book.root).manifest();
      // Reject unrelated or malformed repositories before any migration writes.
      final store = BookStore(book.root);
      await store.read('notes/book.md');
      for (final chapter in manifest.chapters) {
        await store.read('chapters/${chapter.file}');
        await store.read('chapters/${chapter.notesFile}');
      }
      book.data['title'] =
          manifest.data['title']?.toString() ?? repository['name'];
      await book.save();
      complete = true;
      return book;
    } catch (e) {
      throw StateError(
        'Could not open this repository as a book. It must contain book.json and its Markdown files at the repository root. $e',
      );
    } finally {
      if (!complete) await container.delete(recursive: true);
    }
  }

  /// Persist locally first, so failed authentication/network never loses a book.
  Future<LibraryBook> createLocal(
    String title,
    String author,
    String guide,
  ) async {
    final container = await (await directory()).createTemp('book-');
    final book = LibraryBook(container, {
      'title': title.trim(),
      'published': false,
    });
    try {
      final created = await BookStore.create(
        container.path,
        title,
        author,
        guide,
      );
      await Directory(created.root).rename(book.root);
      await BookStore(book.root).migrate(templates);
      await book.save();
      return book;
    } catch (_) {
      await container.delete(recursive: true);
      rethrow;
    }
  }

  Future<void> publish(
    LibraryBook book,
    String name, {
    bool private = true,
  }) async {
    final account = settings.githubAccount;
    if (account == null) {
      throw StateError('Sign in before publishing this book.');
    }
    final savedOwner = book.data['accountId'];
    if (savedOwner != null && savedOwner != account['id']) {
      throw StateError(
        'Reconnect the GitHub account that created this repository before retrying its upload.',
      );
    }
    // Migration/validation must precede creating the remote and initial commit.
    await BookStore(book.root).manifest();
    if (book.repository == null) {
      final repository = await github.createRepository(
        await settings.githubToken(),
        name,
        private: private,
      );
      book.data['repository'] = repository;
      book.data['accountId'] = account['id'];
      await book.save();
    }
    final service = await git(book.root);
    var status = await service.status();
    if (status['initialized'] != true) await service.initialize();
    status = await service.status();
    if ((status['remote'] as String).isEmpty) {
      await service.remote(book.repository!['clone_url'] as String);
    }
    final files = (status['files'] as List)
        .map((f) => f['path'] as String)
        .toList();
    if (files.isNotEmpty) await service.commit('Create book', files);
    await service.sync('push');
    book.data['published'] = true;
    await book.save();
  }

  Future<GitService> git(String root) async {
    if (gitFactory != null) return gitFactory!(root);
    final account = settings.githubAccount;
    if (account == null) {
      throw StateError('Sign in to GitHub before syncing repositories.');
    }
    final login = account['login'] as String;
    return GitService(
      root,
      native: true,
      name: settings.gitName.isEmpty
          ? (account['name'] as String? ?? login)
          : settings.gitName,
      email: settings.gitEmail.isEmpty
          ? '${account['id']}+$login@users.noreply.github.com'
          : settings.gitEmail,
      username: login,
      token: await settings.githubToken(),
      caFile: await settings.certificatePath(),
    );
  }
}
