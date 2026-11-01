import 'dart:io';

import 'package:flutter/material.dart';

import '../book/session.dart';
import '../services/git.dart';
import '../services/assistant.dart';
import 'dialogs.dart';

class GitPanel extends StatefulWidget {
  const GitPanel({super.key, required this.session});
  final WriterSession session;
  @override
  State<GitPanel> createState() => _GitPanelState();
}

class _GitPanelState extends State<GitPanel> {
  Map<String, dynamic>? state;
  String? error, patch;
  final selected = <String>{};
  final message = TextEditingController();
  bool busy = false;
  @override
  void initState() {
    super.initState();
    refresh();
  }

  @override
  void dispose() {
    message.dispose();
    super.dispose();
  }

  Future<GitService> service({bool credentials = false}) async {
    final settings = widget.session.settings;
    if (Platform.isIOS || Platform.isAndroid) {
      final account = settings.githubAccount;
      if (credentials && account == null) {
        throw StateError(
          'Open Book library and sign in to GitHub before syncing.',
        );
      }
      final login = account?['login'] as String? ?? 'writer';
      return GitService(
        widget.session.store!.root,
        native: true,
        name: settings.gitName.isNotEmpty
            ? settings.gitName
            : account?['name'] as String? ?? login,
        email: settings.gitEmail.isNotEmpty
            ? settings.gitEmail
            : account == null
            ? 'writer@localhost'
            : '${account['id']}+$login@users.noreply.github.com',
        username: login,
        token: credentials ? await settings.githubToken() : '',
        caFile: credentials ? await settings.certificatePath() : '',
      );
    }
    return GitService(
      widget.session.store!.root,
      name: settings.gitName,
      email: settings.gitEmail,
      username: settings.gitUsername,
      token: credentials ? await settings.gitToken() : '',
      credentialHost: settings.gitHost,
      caFile: credentials ? await settings.certificatePath() : '',
      sshPublicKey: settings.gitPublicKey,
      sshPrivateKey: credentials ? await settings.gitPrivateKey() : '',
      sshPassphrase: credentials ? await settings.gitPassphrase() : '',
      sshFingerprint: settings.gitFingerprint,
    );
  }

  Future<void> refresh() async {
    if (busy || widget.session.store == null) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      if (!await widget.session.flush()) {
        throw StateError('Resolve the current draft before using Git.');
      }
      final next = await (await service()).status();
      if (!mounted) return;
      setState(() {
        state = next;
        final allowed = (next['files'] as List? ?? [])
            .map((f) => f['path'])
            .toSet();
        selected.removeWhere((p) => !allowed.contains(p));
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> action(
    Future<void> Function(GitService) run, {
    bool network = false,
  }) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final git = await service(credentials: network);
      final success = await widget.session.mutate((_) => run(git));
      if (!success) {
        throw StateError(
          widget.session.error ?? 'Git action did not complete.',
        );
      }
      final next = await git.status();
      if (mounted) {
        setState(() {
          state = next;
          patch = null;
          selected.clear();
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> preview(String path) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final text = await (await service()).diff(path);
      if (mounted) setState(() => patch = text);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> generate() async {
    if (busy || selected.isEmpty) return;
    setState(() => busy = true);
    final ai = AssistantService();
    try {
      if (!await widget.session.flush()) {
        throw StateError('Resolve your current draft first.');
      }
      final diffs = await (await service()).selectedDiffs(selected.toList());
      final settings = widget.session.settings;
      final next = await ai.commitMessage(
        apiKey: await settings.apiKey(),
        model: settings.model,
        diffs: diffs,
      );
      if (mounted) message.text = next;
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      ai.close();
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = state;
    final initialized = status?['initialized'] == true;
    final files = status?['files'] as List? ?? [];
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        Row(
          children: [
            Text('Book Git', style: Theme.of(context).textTheme.titleLarge),
            const Spacer(),
            IconButton(
              onPressed: busy ? null : refresh,
              icon: const Icon(Icons.refresh),
              tooltip: 'Refresh Git',
            ),
          ],
        ),
        if (busy) const LinearProgressIndicator(),
        if (error != null)
          SelectableText(
            error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        if (status != null && !initialized)
          FilledButton(
            onPressed: busy ? null : () => action((git) => git.initialize()),
            child: const Text('Set up Git for this book'),
          ),
        if (initialized) ...[
          Text(
            'Branch: ${status!['branch']} · ${status['ahead']} ahead · ${status['behind']} behind',
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            children: [
              PopupMenuButton<String>(
                enabled: !busy,
                tooltip: 'Switch branch',
                onSelected: (branch) => action((git) => git.branch(branch)),
                itemBuilder: (_) => [
                  for (final branch in status['branches'] as List)
                    PopupMenuItem(value: branch as String, child: Text(branch)),
                ],
                child: const Padding(
                  padding: EdgeInsets.all(10),
                  child: Text('Switch branch'),
                ),
              ),
              TextButton(
                onPressed: busy
                    ? null
                    : () async {
                        final values = await editFields(context, 'New branch', {
                          'Branch name': '',
                        }, submit: 'Create branch');
                        if (values != null) {
                          await action(
                            (git) => git.branch(
                              values['Branch name']!,
                              create: true,
                            ),
                          );
                        }
                      },
                child: const Text('New branch'),
              ),
              for (final type in ['fetch', 'pull', 'push'])
                TextButton(
                  onPressed: busy
                      ? null
                      : () => action((git) => git.sync(type), network: true),
                  child: Text(type[0].toUpperCase() + type.substring(1)),
                ),
            ],
          ),
          if ((status['remote'] as String).isEmpty)
            TextButton(
              onPressed: busy
                  ? null
                  : () async {
                      final values = await editFields(
                        context,
                        'Add origin remote',
                        {'Remote URL': ''},
                        submit: 'Add remote',
                      );
                      if (values != null) {
                        await action(
                          (git) => git.remote(values['Remote URL']!),
                        );
                      }
                    },
              child: const Text('Add origin remote'),
            )
          else
            SelectableText(status['remote'] as String),
          const Divider(),
          if (files.isEmpty) const Text('Working tree is clean.'),
          for (final file in files)
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: selected.contains(file['path']),
              onChanged: busy
                  ? null
                  : (value) => setState(() {
                      if (value == true) {
                        selected.add(file['path'] as String);
                      } else {
                        selected.remove(file['path']);
                      }
                    }),
              title: Text(file['path'] as String),
              subtitle: Text(file['code'] as String),
              secondary: IconButton(
                onPressed: busy ? null : () => preview(file['path'] as String),
                icon: const Icon(Icons.difference_outlined),
                tooltip: 'View diff',
              ),
            ),
          if (files.isNotEmpty) ...[
            TextButton(
              onPressed: busy
                  ? null
                  : () => setState(
                      () => selected.addAll(
                        files.map((f) => f['path'] as String),
                      ),
                    ),
              child: const Text('Select all changed files'),
            ),
            TextField(
              controller: message,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Commit message',
                border: OutlineInputBorder(),
              ),
            ),
            TextButton(
              onPressed: busy || selected.isEmpty ? null : generate,
              child: const Text('Generate commit message with AI'),
            ),
            FilledButton(
              onPressed: busy || selected.isEmpty
                  ? null
                  : () async {
                      await action(
                        (git) => git.commit(message.text, selected.toList()),
                      );
                      if (error == null) message.clear();
                    },
              child: Text('Commit ${selected.length} selected files'),
            ),
          ],
          if (patch != null) ...[
            const Divider(),
            const Text('Diff preview'),
            SelectableText(
              patch!,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
            ),
          ],
        ],
      ],
    );
  }
}
