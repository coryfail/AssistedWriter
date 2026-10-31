import 'dart:io';

import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../services/settings.dart';
import '../services/updates.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({
    super.key,
    required this.settings,
    required this.beforeUpdate,
    required this.updates,
  });
  final AppSettings settings;
  final Future<bool> Function() beforeUpdate;
  final UpdateService updates;
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  final keyInput = TextEditingController();
  final tokenInput = TextEditingController();
  final privateKeyInput = TextEditingController();
  final passphraseInput = TextEditingController();
  late final gitHost = TextEditingController(text: widget.settings.gitHost);
  late final publicKey = TextEditingController(
    text: widget.settings.gitPublicKey,
  );
  late final fingerprint = TextEditingController(
    text: widget.settings.gitFingerprint,
  );
  late final model = TextEditingController(text: widget.settings.model);
  late final gitName = TextEditingController(text: widget.settings.gitName);
  late final gitEmail = TextEditingController(text: widget.settings.gitEmail);
  late final gitUser = TextEditingController(text: widget.settings.gitUsername);
  UpdateService get updates => widget.updates;
  String status = '', version = '';
  bool hasKey = false, busy = false;
  @override
  void initState() {
    super.initState();
    updates.addListener(changed);
    load();
  }

  void changed() {
    if (mounted) setState(() {});
  }

  Future<void> load() async {
    try {
      final saved = await widget.settings.apiKey();
      final info = await PackageInfo.fromPlatform();
      if (mounted) {
        setState(() {
          hasKey = saved.isNotEmpty;
          version = '${info.version}+${info.buildNumber}';
        });
      }
    } catch (e) {
      if (mounted) setState(() => status = '$e');
    }
  }

  @override
  void dispose() {
    updates.removeListener(changed);
    for (final c in [
      keyInput,
      tokenInput,
      model,
      gitName,
      gitEmail,
      gitUser,
      privateKeyInput,
      passphraseInput,
      gitHost,
      publicKey,
      fingerprint,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> save() async {
    setState(() => busy = true);
    try {
      if (model.text.trim().isEmpty) throw ArgumentError('Enter an AI model.');
      if (keyInput.text.trim().isNotEmpty) {
        await widget.settings.setApiKey(keyInput.text);
      }
      await widget.settings.setModel(model.text);
      await widget.settings.setGit(
        gitName.text,
        gitEmail.text,
        gitUser.text,
        tokenInput.text,
      );
      await widget.settings.setNativeGit(
        gitHost.text,
        publicKey.text,
        privateKeyInput.text,
        passphraseInput.text,
        fingerprint.text,
      );
      keyInput.clear();
      tokenInput.clear();
      privateKeyInput.clear();
      passphraseInput.clear();
      await load();
      if (mounted) setState(() => status = 'Settings saved.');
    } catch (e) {
      if (mounted) setState(() => status = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Settings')),
    body: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 700),
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              'Assisted Writer $version',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 24),
            const Text('OpenAI', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            Text(
              hasKey
                  ? 'An API key is saved in secure storage.'
                  : 'No OpenAI API key is saved.',
            ),
            const SizedBox(height: 10),
            TextField(
              controller: keyInput,
              obscureText: true,
              autocorrect: false,
              enableSuggestions: false,
              decoration: const InputDecoration(
                labelText: 'New OpenAI API key',
                helperText: 'Leave blank to keep the saved key.',
              ),
            ),
            TextButton(
              onPressed: busy || !hasKey
                  ? null
                  : () async {
                      try {
                        await widget.settings.setApiKey('');
                        await load();
                      } catch (e) {
                        if (mounted) setState(() => status = '$e');
                      }
                    },
              child: const Text('Remove saved API key'),
            ),
            TextField(
              controller: model,
              decoration: const InputDecoration(labelText: 'AI model'),
            ),
            const SizedBox(height: 24),
            const Text(
              'Git identity and native credentials',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: gitName,
              decoration: const InputDecoration(labelText: 'Git author name'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: gitEmail,
              decoration: const InputDecoration(labelText: 'Git author email'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: gitHost,
              decoration: const InputDecoration(
                labelText: 'Git credential hostname',
                helperText: 'Credentials are used only for this server.',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: gitUser,
              decoration: const InputDecoration(
                labelText: 'Git HTTPS username',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: tokenInput,
              obscureText: true,
              autocorrect: false,
              enableSuggestions: false,
              decoration: const InputDecoration(
                labelText: 'New Git HTTPS token',
                helperText: 'Leave blank to keep the saved token.',
              ),
            ),
            const SizedBox(height: 8),
            ExpansionTile(
              title: const Text('SSH key authentication'),
              children: [
                TextField(
                  controller: publicKey,
                  decoration: const InputDecoration(
                    labelText: 'SSH public key',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: privateKeyInput,
                  obscureText: true,
                  autocorrect: false,
                  enableSuggestions: false,
                  decoration: const InputDecoration(
                    labelText: 'New SSH private key',
                    helperText: 'Paste the full OpenSSH key. Leave blank to keep the saved key.',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: passphraseInput,
                  obscureText: true,
                  autocorrect: false,
                  enableSuggestions: false,
                  decoration: const InputDecoration(
                    labelText: 'New SSH key passphrase',
                    helperText: 'Leave blank to keep the saved passphrase.',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: fingerprint,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'Server SHA256 host-key fingerprint',
                    helperText:
                        'Use the fingerprint published by your Git server.',
                  ),
                ),
              ],
            ),
            TextButton(
              onPressed: busy
                  ? null
                  : () async {
                      try {
                        await widget.settings.clearGitCredentials();
                        if (mounted) {
                          setState(
                            () => status = 'Saved Git credentials removed.',
                          );
                        }
                      } catch (e) {
                        if (mounted) setState(() => status = '$e');
                      }
                    },
              child: const Text('Remove saved Git credentials'),
            ),
            Text(
              Platform.isIOS ? 'iOS Git uses these HTTPS or SSH credentials.' : 'Desktop Git uses your installed Git client and its configured credentials. Windows uses these native credentials if Git is not installed.',
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: busy ? null : save,
              child: const Text('Save settings'),
            ),
            if (status.isNotEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: SelectableText(status),
              ),
            const Divider(height: 40),
            const Text(
              'App updates',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: updates.checking
                  ? null
                  : () async {
                      try {
                        if (await widget.beforeUpdate()) await updates.check();
                      } catch (e) {
                        if (mounted) setState(() => status = '$e');
                      }
                    },
              child: Text(Platform.isIOS ? 'iOS updates' : 'Check for updates'),
            ),
            if (updates.status.isNotEmpty) Text(updates.status),
            const Divider(height: 40),
            const Text(
              'Keyboard shortcuts',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            const Text(
              '⌘ / Ctrl + S    Save\n⌘ / Ctrl + 1    Chapter manuscript\n⌘ / Ctrl + 2    Book notes\n⌘ / Ctrl + 3    Chapter context\n⌘ / Ctrl + \\    Assistant panel\n⌘ / Ctrl + B / I    Bold / italic in the formatted editor',
            ),
          ],
        ),
      ),
    ),
  );
}
