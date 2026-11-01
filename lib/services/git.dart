import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

import 'package:path/path.dart' as p;
import 'package:git2dart/git2dart.dart' as g;
import 'package:crypto/crypto.dart';

import '../book/store.dart';

class GitService {
  GitService(
    this.root, {
    this.native = false,
    this.name = '',
    this.email = '',
    this.username = '',
    this.token = '',
    this.credentialHost = 'github.com',
    this.caFile = '',
    this.sshPublicKey = '',
    this.sshPrivateKey = '',
    this.sshPassphrase = '',
    this.sshFingerprint = '',
  });
  final String root, name, email, username, token;
  final String credentialHost,
      caFile,
      sshPublicKey,
      sshPrivateKey,
      sshPassphrase,
      sshFingerprint;
  final bool native;
  bool _nativeFallback = false;
  bool get useNative => native || Platform.isIOS || _nativeFallback;

  /// Clone before validating the book: its manifest does not exist locally yet.
  Future<void> clone(String url) async {
    final uri = Uri.parse(url);
    if (uri.scheme != 'https' ||
        uri.host != credentialHost ||
        uri.userInfo.isNotEmpty) {
      throw ArgumentError(
        'Clone requires an HTTPS URL on the credential host.',
      );
    }
    if (await FileSystemEntity.type(root, followLinks: false) !=
        FileSystemEntityType.notFound) {
      throw StateError('The clone destination already exists.');
    }
    await _native('clone', {'url': url});
  }

  Future<dynamic> _native(
    String action, [
    Map<String, dynamic> args = const {},
  ]) async {
    final input = {
      'root': root,
      'action': action,
      'name': name,
      'email': email,
      'username': username,
      'token': token,
      'credentialHost': credentialHost,
      'caFile': caFile,
      'sshPublicKey': sshPublicKey,
      'sshPrivateKey': sshPrivateKey,
      'sshPassphrase': sshPassphrase,
      'sshFingerprint': sshFingerprint,
      ...args,
    };
    return Isolate.run(() => _nativeOperation(input));
  }

  Future<String> _run(List<String> args) async {
    final process = await Process.start(
      'git',
      args,
      workingDirectory: root,
      environment: {'GIT_TERMINAL_PROMPT': '0'},
      runInShell: false,
    );
    Future<String> collect(Stream<List<int>> stream) async {
      var size = 0;
      final bytes = <int>[];
      await for (final chunk in stream) {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) {
          process.kill();
          throw StateError(
            'Git output exceeded 5 MB. Use Git outside the app for this operation.',
          );
        }
        bytes.addAll(chunk);
      }
      return utf8.decode(bytes, allowMalformed: true);
    }

    final out = collect(process.stdout);
    final err = collect(process.stderr);
    try {
      final results = await Future.wait<dynamic>([process.exitCode, out, err])
          .timeout(const Duration(minutes: 2));
      if (results[0] != 0) {
        throw StateError(
          (results[2] as String).trim().replaceFirst(RegExp(r'^fatal: '), ''),
        );
      }
      return results[1] as String;
    } on TimeoutException {
      process.kill();
      throw StateError('Git timed out.');
    } on ProcessException {
      throw StateError(
        'Git is not installed. Install Git and restart Assisted Writer.',
      );
    }
  }

  Future<void> _validate() async {
    await BookStore(root).manifest();
  }

  Future<Map<String, dynamic>> status() async {
    await _validate();
    if (useNative) {
      return Map<String, dynamic>.from(await _native('status') as Map);
    }
    String top;
    try {
      top = (await _run(['rev-parse', '--show-toplevel'])).trim();
    } on ProcessException {
      if (Platform.isWindows) {
        _nativeFallback = true;
        return Map<String, dynamic>.from(await _native('status') as Map);
      }
      throw StateError(
        'Git is not installed. Install Git to use book version control.',
      );
    } on StateError {
      return {'initialized': false};
    }
    if (p.normalize(await Directory(top).resolveSymbolicLinks()) !=
        p.normalize(await Directory(root).resolveSymbolicLinks())) {
      return {'initialized': false};
    }
    final files = parseStatus(
      await _run(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    );
    String upstream = '', remote = '';
    var ahead = 0, behind = 0;
    try {
      upstream = (await _run([
        'rev-parse',
        '--abbrev-ref',
        '--symbolic-full-name',
        '@{upstream}',
      ])).trim();
    } on StateError {
      /* Unpublished branches have no upstream. */
    }
    if (upstream.isNotEmpty) {
      final counts = (await _run([
        'rev-list',
        '--left-right',
        '--count',
        '$upstream...HEAD',
      ])).trim().split(RegExp(r'\s+'));
      behind = int.parse(counts[0]);
      ahead = int.parse(counts[1]);
    }
    try {
      remote = (await _run(['remote', 'get-url', 'origin'])).trim();
    } on StateError {
      /* The book may be local only. */
    }
    return {
      'initialized': true,
      'branch': (await _run(['branch', '--show-current'])).trim(),
      'branches': (await _run([
        'for-each-ref',
        '--format=%(refname:short)',
        'refs/heads',
      ])).trim().split('\n').where((s) => s.isNotEmpty).toList(),
      'files': files,
      'upstream': upstream,
      'ahead': ahead,
      'behind': behind,
      'remote': remote,
    };
  }

  static List<Map<String, String>> parseStatus(String output) {
    final entries = output.split('\u0000');
    final files = <Map<String, String>>[];
    for (var i = 0; i < entries.length; i++) {
      final entry = entries[i];
      if (entry.length < 4) continue;
      final code = entry.substring(0, 2);
      files.add({'path': entry.substring(3), 'code': code});
      if (code.contains('R') || code.contains('C')) i++;
    }
    return files;
  }

  Future<void> initialize() async {
    await _validate();
    if ((await status())['initialized'] == true) {
      throw StateError('This book already has a Git repository.');
    }
    if (useNative) {
      await _native('init');
    } else {
      await _run(['init', '-b', 'main']);
    }
    final ignore = File(p.join(root, '.gitignore'));
    try {
      await ignore.create(exclusive: true);
      await ignore.writeAsString('exports/\n.DS_Store\n');
    } on FileSystemException {
      if (!await ignore.exists()) rethrow;
    }
  }

  Future<String> diff(String path) async {
    final state = await status();
    _requireRepo(state);
    final files = state['files'] as List;
    if (!files.any((f) => f['path'] == path)) {
      throw StateError('This file has no changes to preview.');
    }
    if (useNative) return await _native('diff', {'path': path}) as String;
    final file = files.firstWhere((f) => f['path'] == path);
    if (file['code'] == '??') return _newFilePreview(root, path);
    try {
      return await _run(['diff', 'HEAD', '--', path]);
    } on StateError {
      return await _run(['diff', '--cached', '--', path]);
    }
  }

  Future<String> selectedDiffs(List<String> files) async {
    final state = await status();
    _validateSelection(state, files);
    final buffer = StringBuffer();
    for (final path in files) {
      final section = 'File: $path\n${await diff(path)}\n\n';
      if (buffer.length + section.length > 40000) {
        final remaining = 40000 - buffer.length;
        buffer.write(section.substring(0, remaining));
        buffer.write('\n[Diff truncated after 40,000 characters.]');
        break;
      }
      buffer.write(section);
    }
    return buffer.toString();
  }

  static void _requireRepo(Map state) {
    if (state['initialized'] != true) {
      throw StateError('Set up Git for this book first.');
    }
  }

  static void _validateSelection(Map state, List<String> files) {
    _requireRepo(state);
    if (files.isEmpty) throw StateError('Select at least one changed file.');
    final allowed = (state['files'] as List).map((f) => f['path']).toSet();
    if (files.any((f) => !allowed.contains(f))) {
      throw StateError('Changed files have changed. Refresh Git status.');
    }
  }

  Future<void> commit(String message, List<String> files) async {
    final state = await status();
    _validateSelection(state, files);
    if (message.trim().isEmpty) throw StateError('Enter a commit message.');
    if (useNative) {
      await _native('commit', {'message': message.trim(), 'files': files});
    } else {
      await _run(['add', '--', ...files]);
      await _run([
        if (name.isNotEmpty && email.isNotEmpty) ...[
          '-c',
          'user.name=$name',
          '-c',
          'user.email=$email',
        ],
        'commit',
        '--only',
        '-m',
        message.trim(),
        '--',
        ...files,
      ]);
    }
  }

  Future<void> branch(String name, {bool create = false}) async {
    final state = await status();
    _requireRepo(state);
    if ((state['files'] as List).isNotEmpty) {
      throw StateError(
        'Commit or otherwise resolve changes before switching branches.',
      );
    }
    if (name.trim().isEmpty || name.startsWith('-')) {
      throw ArgumentError('Enter a valid branch name.');
    }
    if (!create && !(state['branches'] as List).contains(name)) {
      throw StateError('Branch not found. Refresh Git status.');
    }
    if (useNative) {
      await _native('branch', {'branch': name, 'create': create});
    } else {
      await _run(['check-ref-format', '--branch', name]);
      await _run(['switch', if (create) '-c', name]);
    }
  }

  Future<void> remote(String url) async {
    final state = await status();
    _requireRepo(state);
    if ((state['remote'] as String).isNotEmpty) {
      throw StateError('This book already has an origin remote.');
    }
    final value = url.trim();
    if (value.isEmpty || value.startsWith('-')) {
      throw ArgumentError('Enter a valid remote URL.');
    }
    if (useNative) {
      await _native('remote', {'url': value});
    } else {
      await _run(['remote', 'add', 'origin', value]);
    }
  }

  Future<void> sync(String action) async {
    final state = await status();
    _requireRepo(state);
    if (!['fetch', 'pull', 'push'].contains(action)) {
      throw ArgumentError('Unsupported Git action.');
    }
    if ((state['remote'] as String).isEmpty) {
      throw StateError('Add an origin remote first.');
    }
    if (action == 'pull') {
      if ((state['files'] as List).isNotEmpty) {
        throw StateError('Commit or otherwise resolve changes before pulling.');
      }
      if ((state['upstream'] as String).isEmpty) {
        throw StateError('This branch has no upstream. Push it first.');
      }
    }
    if (useNative) {
      await _native(action);
    } else if (action == 'fetch') {
      await _run(['fetch', 'origin']);
    } else if (action == 'pull') {
      await _run(['pull', '--ff-only']);
    } else {
      await _run([
        'push',
        if ((state['upstream'] as String).isEmpty) ...[
          '-u',
          'origin',
          state['branch'] as String,
        ],
      ]);
    }
  }
}

Future<String> _newFilePreview(String root, String path) async {
  final full = p.normalize(p.join(root, path));
  if (!p.isWithin(p.normalize(p.absolute(root)), p.absolute(full))) {
    throw ArgumentError('Invalid file path.');
  }
  if (await FileSystemEntity.type(full, followLinks: false) ==
      FileSystemEntityType.link) {
    return 'Symlink preview unavailable.';
  }
  final file = File(full);
  if (await file.length() > 200000) {
    return 'Binary or large file; preview unavailable.';
  }
  final bytes = await file.readAsBytes();
  if (bytes.contains(0)) return 'Binary or large file; preview unavailable.';
  return 'New file: $path\n\n${utf8.decode(bytes, allowMalformed: true)}';
}

Future<dynamic> _nativeOperation(Map<String, dynamic> input) async {
  await g.PlatformSpecific.initialize();
  if ((input['caFile'] as String).isNotEmpty) {
    g.Libgit2.setSSLCertLocations(file: input['caFile'] as String);
  }
  final root = input['root'] as String;
  final action = input['action'] as String;
  try {
    if (action == 'clone') {
      final repo = g.Repository.clone(
        url: input['url'] as String,
        localPath: root,
        callbacks: g.Callbacks(
          credentials: (input['token'] as String).isEmpty
              ? null
              : g.UserPass(
                  username: (input['username'] as String).isEmpty
                      ? 'git'
                      : input['username'] as String,
                  password: input['token'] as String,
                ),
          certificateCheck: (_, host, {required valid}) =>
              valid &&
              host.toLowerCase() ==
                  (input['credentialHost'] as String).toLowerCase(),
        ),
      );
      repo.free();
      return null;
    }
    if (action == 'init') {
      final repo = g.Repository.init(path: root, initialHead: 'main');
      repo.free();
      return null;
    }
    if (!Directory(p.join(root, '.git')).existsSync() &&
        !File(p.join(root, '.git')).existsSync()) {
      if (action == 'status') return {'initialized': false};
      throw StateError('Set up Git for this book first.');
    }
    final repo = g.Repository.open(root);
    try {
      if (p.normalize(Directory(repo.workdir).resolveSymbolicLinksSync()) !=
          p.normalize(Directory(root).resolveSymbolicLinksSync())) {
        throw StateError('The Git repository must belong to this book folder.');
      }
      if (action == 'status') return _nativeStatus(repo);
      if (action == 'remote') {
        final remote = g.Remote.create(
          repo: repo,
          name: 'origin',
          url: input['url'] as String,
        );
        remote.free();
        return null;
      }
      if (action == 'diff') {
        final path = input['path'] as String;
        final statuses = _nativeFiles(repo);
        if (!statuses.containsKey(path)) {
          throw StateError('This file has no changes to preview.');
        }
        if (statuses[path]!.contains(g.GitStatus.wtNew)) {
          return await _newFilePreview(root, path);
        }
        g.Commit? parent;
        g.Tree? tree;
        if (!repo.isBranchUnborn) {
          final head = repo.head;
          parent = g.Commit.lookup(repo: repo, oid: head.target);
          head.free();
          tree = parent.tree;
        }
        final diff = g.Diff.treeToWorkdirWithIndex(repo: repo, tree: tree);
        try {
          final patches = diff.patches;
          try {
            return patches
                .where(
                  (patch) =>
                      patch.delta.newFile.path == path ||
                      patch.delta.oldFile.path == path,
                )
                .map((patch) => patch.text)
                .join();
          } finally {
            for (final patch in patches) {
              patch.free();
            }
          }
        } finally {
          diff.free();
          tree?.free();
          parent?.free();
        }
      }
      if (action == 'commit') {
        final files = (input['files'] as List).cast<String>();
        GitService._validateSelection(_nativeStatus(repo), files);
        final index = repo.index;
        if (index.hasConflicts) {
          index.free();
          throw StateError('Resolve Git conflicts before committing.');
        }
        final originalIndex = repo.index;
        g.Commit? parent;
        g.Tree? parentTree;
        g.Tree? tree;
        g.Signature? signature;
        try {
          if (!repo.isBranchUnborn) {
            final head = repo.head;
            parent = g.Commit.lookup(repo: repo, oid: head.target);
            head.free();
            parentTree = parent.tree;
            index.readTree(parentTree);
          } else {
            index.clear();
          }
          _stageNative(index, root, files);
          tree = g.Tree.lookup(repo: repo, oid: index.writeTree());
          final name = input['name'] as String;
          final email = input['email'] as String;
          signature = name.isNotEmpty && email.isNotEmpty
              ? g.Signature.create(name: name, email: email)
              : repo.defaultSignature;
          g.Commit.create(
            repo: repo,
            updateRef: 'HEAD',
            author: signature,
            committer: signature,
            message: input['message'] as String,
            tree: tree,
            parents: [?parent],
          );
          // Preserve unrelated staged files; update only committed entries.
          if (originalIndex.path != null &&
              File(originalIndex.path!).existsSync()) {
            originalIndex.read(force: true);
          } else {
            originalIndex.clear();
          }
          _stageNative(originalIndex, root, files);
          originalIndex.write();
        } finally {
          signature?.free();
          tree?.free();
          parentTree?.free();
          parent?.free();
          index.free();
          originalIndex.free();
        }
        return null;
      }
      if (action == 'branch') {
        if (_nativeFiles(repo).isNotEmpty) {
          throw StateError(
            'Commit or otherwise resolve changes before switching branches.',
          );
        }
        final name = input['branch'] as String;
        if (!g.Branch.isNameValid(name) || name.startsWith('-')) {
          throw ArgumentError('Enter a valid branch name.');
        }
        if (input['create'] == true) {
          final head = repo.head;
          final commit = g.Commit.lookup(repo: repo, oid: head.target);
          head.free();
          try {
            final branch = g.Branch.create(
              repo: repo,
              name: name,
              target: commit,
            );
            branch.free();
          } finally {
            commit.free();
          }
        }
        g.Checkout.reference(repo: repo, name: 'refs/heads/$name');
        repo.setHead('refs/heads/$name');
        return null;
      }
      final remote = g.Remote.lookup(repo: repo, name: 'origin');
      try {
        final token = input['token'] as String;
        final username = input['username'] as String;
        final remoteUri = Uri.tryParse(remote.url);
        final scp =
            remote.url.contains('://') ||
                RegExp(r'^[A-Za-z]:[\\/]').hasMatch(remote.url)
            ? null
            : RegExp(r'^(?:([^@/]+)@)?([^:/]+):(.+)$').firstMatch(remote.url);
        final host = (remoteUri?.host.isNotEmpty ?? false)
            ? remoteUri!.host
            : (scp?[2] ?? '');
        final credentialHost = input['credentialHost'] as String;
        final ssh =
            remoteUri?.scheme == 'ssh' ||
            remoteUri?.scheme == 'git+ssh' ||
            scp != null;
        final privateKey = input['sshPrivateKey'] as String;
        if (host.isNotEmpty &&
            (token.isNotEmpty || privateKey.isNotEmpty) &&
            host.toLowerCase() != credentialHost.toLowerCase()) {
          throw StateError(
            'The remote host does not match the saved Git credential host. Update the hostname in Settings.',
          );
        }
        g.Credentials? credentials;
        if (ssh && privateKey.isNotEmpty) {
          final publicKey = input['sshPublicKey'] as String;
          if (publicKey.isEmpty) {
            throw StateError('Enter the matching SSH public key in Settings.');
          }
          final sshUser = (remoteUri?.userInfo.isNotEmpty ?? false)
              ? remoteUri!.userInfo.split(':').first
              : (scp?[1] ?? 'git');
          credentials = g.KeypairFromMemory(
            username: sshUser,
            pubKey: publicKey,
            privateKey: privateKey,
            passPhrase: input['sshPassphrase'] as String,
          );
        } else if (remoteUri?.scheme == 'https' && token.isNotEmpty) {
          credentials = g.UserPass(
            username: username.isEmpty ? 'git' : username,
            password: token,
          );
        }
        final callbacks = g.Callbacks(
          credentials: credentials,
          certificateCheck: (certificate, host, {required valid}) {
            if (certificate.type != g.GitCertificateType.hostkeyLibssh2) {
              return valid;
            }
            final expected = (input['sshFingerprint'] as String)
                .replaceFirst('SHA256:', '')
                .replaceAll('=', '')
                .trim();
            if (expected.isEmpty) return valid;
            final key = certificate.hostkey!;
            final digest =
                key.sha256 ??
                (key.rawHostkey == null
                    ? null
                    : sha256.convert(key.rawHostkey!).bytes);
            return host.toLowerCase() == credentialHost.toLowerCase() &&
                digest != null &&
                base64Encode(digest).replaceAll('=', '') == expected;
          },
        );
        if (action == 'fetch' || action == 'pull') {
          remote.fetch(callbacks: callbacks);
        }
        if (action == 'pull') {
          if (_nativeFiles(repo).isNotEmpty) {
            throw StateError(
              'Commit or otherwise resolve changes before pulling.',
            );
          }
          final head = repo.head;
          final branch = g.Branch.lookup(repo: repo, name: head.shorthand);
          head.free();
          try {
            final upstream = branch.upstream;
            final target = g.Commit.lookup(repo: repo, oid: upstream.target);
            upstream.free();
            try {
              if (target.oid.sha == branch.target.sha) return null;
              final local = g.Commit.lookup(repo: repo, oid: branch.target);
              try {
                if (local.descendantOf(target.oid)) return null;
              } finally {
                local.free();
              }
              if (!target.descendantOf(branch.target)) {
                throw StateError(
                  'The branches have diverged. Pull is fast-forward only.',
                );
              }
              g.Checkout.commit(repo: repo, commit: target);
              g.Reference.setTarget(
                repo: repo,
                name: 'refs/heads/${branch.name}',
                target: target.oid,
              );
            } finally {
              target.free();
            }
          } finally {
            branch.free();
          }
        } else if (action == 'push') {
          final head = repo.head;
          final branchName = head.shorthand;
          head.free();
          if (branchName.isEmpty ||
              repo.isHeadDetached ||
              repo.isBranchUnborn) {
            throw StateError(
              'Create a commit on a local branch before pushing.',
            );
          }
          remote.push(
            refspecs: ['refs/heads/$branchName:refs/heads/$branchName'],
            callbacks: callbacks,
          );
          remote.fetch(callbacks: callbacks);
          final branch = g.Branch.lookup(repo: repo, name: branchName);
          try {
            branch.setUpstream('origin/$branchName');
          } finally {
            branch.free();
          }
        } else if (action != 'fetch') {
          throw ArgumentError('Unsupported Git action.');
        }
      } finally {
        remote.free();
      }
      return null;
    } finally {
      repo.free();
    }
  } catch (e, stack) {
    var detail = '$e';
    for (final key in ['token', 'sshPrivateKey', 'sshPassphrase']) {
      final secret = input[key] as String? ?? '';
      if (secret.isNotEmpty) detail = detail.replaceAll(secret, '[redacted]');
    }
    Error.throwWithStackTrace(StateError('Git $action failed: $detail'), stack);
  }
}

void _stageNative(g.Index index, String root, List<String> files) {
  for (final file in files) {
    if (FileSystemEntity.typeSync(p.join(root, file), followLinks: false) !=
        FileSystemEntityType.notFound) {
      index.add(file);
    } else if (index.find(file)) {
      index.remove(file);
    }
  }
}

Map<String, dynamic> _nativeStatus(g.Repository repo) {
  final branches = g.Branch.list(repo: repo, type: g.GitBranch.local);
  final names = branches.map((b) => b.name).toList();
  for (final b in branches) {
    b.free();
  }
  String branch = '', upstream = '', remoteURL = '';
  var ahead = 0, behind = 0;
  if (!repo.isBranchUnborn && !repo.isHeadDetached) {
    final head = repo.head;
    branch = head.shorthand;
    head.free();
    final local = g.Branch.lookup(repo: repo, name: branch);
    try {
      final ref = local.upstream;
      try {
        upstream = ref.shorthand;
        final counts = repo.aheadBehind(
          local: local.target,
          upstream: ref.target,
        );
        ahead = counts[0];
        behind = counts[1];
      } finally {
        ref.free();
      }
    } catch (_) {
      /* New branches have no upstream. */
    } finally {
      local.free();
    }
  } else if (repo.isBranchUnborn) {
    branch = 'main';
  }
  try {
    final remote = g.Remote.lookup(repo: repo, name: 'origin');
    remoteURL = remote.url;
    remote.free();
  } catch (_) {
    /* A remote is optional. */
  }
  return {
    'initialized': true,
    'branch': branch,
    'branches': names,
    'files': _nativeFiles(repo).entries
        .map(
          (e) => {'path': e.key, 'code': e.value.map((v) => v.name).join(', ')},
        )
        .toList(),
    'upstream': upstream,
    'ahead': ahead,
    'behind': behind,
    'remote': remoteURL,
  };
}

// libgit2's default status options omit untracked files. Add them explicitly
// while respecting ignore rules and never traversing directory symlinks.
Map<String, Set<g.GitStatus>> _nativeFiles(g.Repository repo) {
  final result = Map<String, Set<g.GitStatus>>.from(repo.status);
  final root = Directory(repo.workdir);
  var visited = 0;
  void visit(Directory directory) {
    for (final entity in directory.listSync(followLinks: false)) {
      if (++visited > 100000) {
        throw StateError(
          'This repository has too many files to inspect in the app.',
        );
      }
      final path = p
          .relative(entity.path, from: root.path)
          .replaceAll(p.separator, '/');
      if (path == '.git' || path.startsWith('.git/')) continue;
      if (g.Ignore.pathIsIgnored(repo: repo, path: path)) continue;
      if (entity is Directory) {
        visit(entity);
      } else if (!result.containsKey(path)) {
        final status = repo.statusFile(path);
        if (status.any(
          (s) => s != g.GitStatus.current && s != g.GitStatus.ignored,
        )) {
          result[path] = status;
        }
      }
    }
  }

  visit(root);
  return result;
}
