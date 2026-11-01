import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:path/path.dart' as p;

import '../services/github.dart';
import '../services/mobile_library.dart';
import '../services/settings.dart';
import 'dialogs.dart';

class MobileLibraryView extends StatefulWidget {
  const MobileLibraryView({
    super.key,
    required this.settings,
    required this.templates,
    required this.onOpen,
    this.github,
    this.library,
    this.openBrowser,
  });
  final AppSettings settings;
  final Map<String, String> templates;
  final Future<void> Function(String) onOpen;
  final GitHubService? github;
  final MobileLibrary? library;
  final Future<bool> Function(Uri)? openBrowser;
  @override
  State<MobileLibraryView> createState() => _MobileLibraryViewState();
}

class _MobileLibraryViewState extends State<MobileLibraryView> {
  late final github = widget.github ?? GitHubService();
  late final library =
      widget.library ??
      MobileLibrary(widget.settings, github, templates: widget.templates);
  List<LibraryBook> books = [];
  final repositories = <Map<String, dynamic>>[];
  bool busy = false, more = false;
  String? error, progress;
  String query = '';
  int page = 0, signInGeneration = 0;
  Map<String, dynamic>? device;
  Timer? signInTimer;
  Completer<void>? signInDelay;
  bool get connected => widget.settings.githubAccount != null;

  @override
  void initState() {
    super.initState();
    run(() async {
      books = await library.books();
      if (connected) await loadRepositories(reset: true);
    });
  }

  @override
  void dispose() {
    cancelSignIn();
    github.close();
    super.dispose();
  }

  void cancelSignIn() {
    signInGeneration++;
    signInTimer?.cancel();
    if (signInDelay?.isCompleted == false) signInDelay!.complete();
    device = null;
  }

  Future<bool> openGitHub() =>
      (widget.openBrowser ??
      (uri) => launchUrl(uri, mode: LaunchMode.externalApplication))(
        Uri.https('github.com', '/login/device'),
      );

  Future<void> run(Future<void> Function() action, {String? label}) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
      progress = label;
    });
    try {
      await action();
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) {
        try {
          books = await library.books();
        } catch (e) {
          error ??= '$e';
        }
        if (mounted) {
          setState(() {
            busy = false;
            progress = null;
          });
        }
      }
    }
  }

  Future<void> loadRepositories({bool reset = false}) async {
    final nextPage = reset ? 1 : page + 1;
    final next = await github.repositories(
      await widget.settings.githubToken(),
      page: nextPage,
    );
    if (!mounted) return;
    if (reset) repositories.clear();
    repositories.addAll(next);
    page = nextPage;
    more = next.length == 50;
  }

  Future<void> acceptToken(String token) async {
    final account = await github.user(token);
    if (!mounted) return;
    await widget.settings.connectGitHub(token, account);
    await loadRepositories(reset: true);
  }

  Future<void> signIn() async {
    final generation = ++signInGeneration;
    await run(() async {
      final code = await github.startSignIn();
      if (!mounted || generation != signInGeneration) return;
      setState(() => device = code);
      // The code stays visible when the browser opens; users authorize on GitHub.
      await openGitHub();
      var interval = code['interval'] as int;
      final deadline = DateTime.now().add(
        Duration(seconds: code['expires_in'] as int),
      );
      while (mounted &&
          generation == signInGeneration &&
          DateTime.now().isBefore(deadline)) {
        signInDelay = Completer<void>();
        signInTimer = Timer(Duration(seconds: interval), signInDelay!.complete);
        await signInDelay!.future;
        if (!mounted || generation != signInGeneration) return;
        if (!DateTime.now().isBefore(deadline)) break;
        final result = await github.pollSignIn(code['device_code'] as String);
        if (!mounted || generation != signInGeneration) return;
        if (result['access_token'] is String) {
          await acceptToken(result['access_token'] as String);
          return;
        }
        switch (result['error']) {
          case 'authorization_pending':
            break;
          case 'slow_down':
            interval += 5;
          default:
            throw StateError(
              'GitHub sign-in ended (${result['error'] ?? 'unknown response'}). Please try again.',
            );
        }
      }
      if (generation == signInGeneration) {
        throw StateError('GitHub sign-in expired. Please try again.');
      }
    }, label: 'Waiting for GitHub authorization…');
    if (mounted && generation == signInGeneration) {
      setState(() => device = null);
    }
  }

  Future<void> tokenSignIn() async {
    final values = await editFields(
      context,
      'Connect GitHub',
      {'Access token': ''},
      secret: {'Access token'},
      submit: 'Connect',
    );
    if (values == null || !mounted) return;
    await run(
      () => acceptToken(values['Access token']!.trim()),
      label: 'Connecting to GitHub…',
    );
  }

  Future<void> publish(LibraryBook book) async {
    final repo = book.repository;
    final values = repo == null
        ? await editFields(context, 'Create private repository', {
            'Repository name': book.title
                .toLowerCase()
                .replaceAll(RegExp(r'[^a-z0-9_-]+'), '-')
                .replaceAll(RegExp(r'^-+|-+$'), ''),
          }, submit: 'Create and upload')
        : <String, String>{};
    if (values == null || !mounted) return;
    await library.publish(
      book,
      values['Repository name'] ?? repo!['name'] as String,
    );
    await loadRepositories(reset: true);
  }

  Future<void> createBook() async {
    final values = await editFields(context, 'New book', {
      'Title': '',
      'Author': '',
    }, submit: 'Create book');
    if (values == null || !mounted) return;
    await run(() async {
      final book = await library.createLocal(
        values['Title']!,
        values['Author']!,
        widget.templates['book-AGENTS.md']!,
      );
      if (!mounted) return;
      if (connected) await publish(book);
      if (mounted) await widget.onOpen(book.root);
    }, label: 'Creating your book…');
  }

  @override
  Widget build(BuildContext context) {
    final account = widget.settings.githubAccount;
    final filtered = repositories.where(
      (repo) => (repo['full_name'] as String).toLowerCase().contains(
        query.toLowerCase(),
      ),
    );
    return PopScope(
      canPop: !busy,
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            'Your book library',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 12),
          const Text(
            'Keep books in GitHub repositories and write offline on this device. Commit, pull and push from Book Git when you are ready to sync.',
          ),
          const SizedBox(height: 16),
          if (busy) ...[
            const LinearProgressIndicator(),
            if (progress != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Text(progress!),
              ),
          ],
          if (error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: SelectableText(
                error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          if (device != null) ...[
            const Text('Enter this code on github.com/login/device:'),
            SelectableText(
              device!['user_code'] as String,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            Wrap(
              children: [
                TextButton.icon(
                  onPressed: () => Clipboard.setData(
                    ClipboardData(text: device!['user_code'] as String),
                  ),
                  icon: const Icon(Icons.copy),
                  label: const Text('Copy code'),
                ),
                TextButton(
                  onPressed: openGitHub,
                  child: const Text('Open GitHub'),
                ),
                TextButton(
                  onPressed: () {
                    setState(cancelSignIn);
                  },
                  child: const Text('Cancel sign-in'),
                ),
              ],
            ),
          ],
          if (account == null) ...[
            FilledButton.icon(
              onPressed: busy
                  ? null
                  : github.clientId.isEmpty
                  ? tokenSignIn
                  : signIn,
              icon: const Icon(Icons.login),
              label: const Text('Sign in to GitHub'),
            ),
            ExpansionTile(
              title: const Text('Connect with an access token'),
              children: [
                const Text(
                  'Use a GitHub token with access to your book repositories. A classic token needs repo scope for private repositories; organization SSO may require authorization. The token is stored in this device’s secure storage.',
                ),
                TextButton(
                  onPressed: busy ? null : tokenSignIn,
                  child: const Text('Enter access token'),
                ),
              ],
            ),
          ] else
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text('Signed in as ${account['login']}'),
              trailing: TextButton(
                onPressed: busy
                    ? null
                    : () => run(() async {
                        await widget.settings.disconnectGitHub();
                        repositories.clear();
                        more = false;
                      }),
                child: const Text('Sign out'),
              ),
            ),
          const Divider(height: 32),
          Row(
            children: [
              Expanded(
                child: Text(
                  'On this device',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              IconButton(
                onPressed: busy ? null : createBook,
                tooltip: 'New book',
                icon: const Icon(Icons.add),
              ),
            ],
          ),
          if (books.isEmpty)
            const Text(
              'Clone a repository below, or create a new book. New repositories are private. Local books stay available after signing out.',
            ),
          for (final book in books)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.menu_book_outlined),
              title: Text(book.title),
              subtitle: Text(
                book.published
                    ? '${book.repository?['full_name']} · Available offline'
                    : 'Saved locally · Upload pending',
              ),
              onTap: busy ? null : () => run(() => widget.onOpen(book.root)),
              trailing: !book.published && connected
                  ? IconButton(
                      onPressed: busy
                          ? null
                          : () => run(
                              () => publish(book),
                              label: 'Uploading book…',
                            ),
                      tooltip: 'Upload to GitHub',
                      icon: const Icon(Icons.cloud_upload_outlined),
                    )
                  : null,
            ),
          for (final root in widget.settings.recent.where(
            (root) =>
                !root.contains('/books/book-') &&
                !books.any((book) => book.root == root),
          ))
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.history),
              title: Text(p.basename(root)),
              subtitle: const Text('Previously opened book'),
              onTap: busy ? null : () => run(() => widget.onOpen(root)),
            ),
          if (connected) ...[
            const Divider(height: 32),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'GitHub repositories',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                IconButton(
                  onPressed: busy
                      ? null
                      : () => run(() => loadRepositories(reset: true)),
                  tooltip: 'Refresh repositories',
                  icon: const Icon(Icons.refresh),
                ),
              ],
            ),
            const Text(
              'Choose a repository with book.json at its root. Opening it downloads a working copy to this device.',
            ),
            const SizedBox(height: 12),
            TextField(
              decoration: const InputDecoration(
                labelText: 'Search loaded repositories',
                prefixIcon: Icon(Icons.search),
              ),
              onChanged: (value) => setState(() => query = value),
            ),
            for (final repo in filtered)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(
                  repo['private'] == true ? Icons.lock_outline : Icons.public,
                ),
                title: Text(repo['full_name'] as String),
                subtitle: Text(
                  repo['archived'] == true
                      ? 'Archived · Read only on GitHub'
                      : repo['description'] as String? ?? 'GitHub repository',
                ),
                trailing: const Icon(Icons.download_outlined),
                onTap: busy
                    ? null
                    : () => run(() async {
                        final book = await library.clone(repo);
                        if (mounted) await widget.onOpen(book.root);
                      }, label: 'Downloading ${repo['name']}…'),
              ),
            if (repositories.isEmpty && !busy)
              const Text('No repositories found for this account.'),
            if (more)
              TextButton(
                onPressed: busy ? null : () => run(() => loadRepositories()),
                child: const Text('Load more repositories'),
              ),
          ],
        ],
      ),
    );
  }
}
