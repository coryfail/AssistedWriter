import 'dart:io';
import 'dart:convert';

import 'package:crypto/crypto.dart';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:flutter/services.dart';

class AppSettings {
  AppSettings(this.preferences);
  final SharedPreferences preferences;
  Map<String, dynamic>? get githubAccount {
    final raw = preferences.getString('githubAccount');
    return raw == null
        ? null
        : Map<String, dynamic>.from(jsonDecode(raw) as Map);
  }

  Future<String> githubToken() async =>
      await secure.read(key: 'github-oauth-token') ?? '';
  Future<void> connectGitHub(String token, Map<String, dynamic> account) async {
    await secure.write(key: 'github-oauth-token', value: token);
    await preferences.setString(
      'githubAccount',
      jsonEncode({
        'id': account['id'],
        'login': account['login'],
        'name': account['name'],
      }),
    );
  }

  Future<void> disconnectGitHub() async {
    await secure.delete(key: 'github-oauth-token');
    await preferences.remove('githubAccount');
  }

  static final secure = Platform.isMacOS
      ? const FlutterSecureStorage(
          mOptions: MacOsOptions(usesDataProtectionKeychain: false),
        )
      : const FlutterSecureStorage();
  static Future<AppSettings> load() async {
    final settings = AppSettings(await SharedPreferences.getInstance());
    if (!settings.preferences.containsKey('recentBooks') &&
        (Platform.isMacOS || Platform.isWindows)) {
      try {
        final support = await getApplicationSupportDirectory();
        final legacy = File(
          p.join(support.parent.path, 'Assisted Writer', 'recent.json'),
        );
        if (await legacy.exists()) {
          final paths = jsonDecode(await legacy.readAsString());
          if (paths is List) {
            await settings.preferences.setStringList(
              'recentBooks',
              paths.whereType<String>().take(8).toList(),
            );
          }
        }
      } on FileSystemException {
        /* Existing data remains available to the legacy app. */
      } on FormatException {
        /* A malformed legacy recent list is ignored. */
      }
    }
    return settings;
  }

  String _draftKey(String root, String path) =>
      'draft.${sha256.convert(utf8.encode('$root\u0000$path'))}';
  Map<String, dynamic>? draft(String root, String path) {
    final value = preferences.getString(_draftKey(root, path));
    if (value == null) return null;
    try {
      final data = jsonDecode(value);
      return data is Map<String, dynamic> ? data : null;
    } on FormatException {
      return null;
    }
  }

  Future<void> saveDraft(
    String root,
    String path,
    String revision,
    String text,
  ) async {
    final stored = await preferences.setString(
      _draftKey(root, path),
      jsonEncode({'revision': revision, 'text': text}),
    );
    if (!stored) {
      throw StateError('Could not save a recovery copy of this draft.');
    }
  }

  Future<void> discardDraft(String root, String path) async {
    await preferences.remove(_draftKey(root, path));
  }

  List<String> get recent => preferences.getStringList('recentBooks') ?? [];
  Future<void> remember(String root) async {
    await preferences.setStringList(
      'recentBooks',
      [root, ...recent.where((p) => p != root)].take(8).toList(),
    );
  }

  Future<String> apiKey() async =>
      await secure.read(key: 'openai-api-key') ?? '';
  Future<void> setApiKey(String value) async {
    if (value.trim().isEmpty) {
      await secure.delete(key: 'openai-api-key');
    } else {
      await secure.write(key: 'openai-api-key', value: value.trim());
    }
  }

  String get model => preferences.getString('aiModel') ?? 'gpt-6-astra';
  Future<void> setModel(String model) =>
      preferences.setString('aiModel', model.trim());
  String get gitName => preferences.getString('gitName') ?? '';
  String get gitEmail => preferences.getString('gitEmail') ?? '';
  String get gitUsername => preferences.getString('gitUsername') ?? '';
  String get gitHost => preferences.getString('gitHost') ?? 'github.com';
  String get gitPublicKey => preferences.getString('gitPublicKey') ?? '';
  String get gitFingerprint => preferences.getString('gitFingerprint') ?? '';
  Future<String> gitPrivateKey() async =>
      await secure.read(key: 'git-ssh-private-key') ?? '';
  Future<String> gitPassphrase() async =>
      await secure.read(key: 'git-ssh-passphrase') ?? '';
  Future<void> setNativeGit(
    String host,
    String publicKey,
    String privateKey,
    String passphrase,
    String fingerprint,
  ) async {
    final cleanHost = host.trim().toLowerCase();
    if (cleanHost.isEmpty ||
        cleanHost.contains('/') ||
        cleanHost.contains('@')) {
      throw ArgumentError('Enter the Git server hostname, such as github.com.');
    }
    await preferences.setString('gitHost', cleanHost);
    await preferences.setString('gitPublicKey', publicKey.trim());
    await preferences.setString('gitFingerprint', fingerprint.trim());
    if (privateKey.trim().isNotEmpty) {
      await secure.write(key: 'git-ssh-private-key', value: privateKey.trim());
    }
    if (passphrase.isNotEmpty) {
      await secure.write(key: 'git-ssh-passphrase', value: passphrase);
    }
  }

  Future<void> clearGitCredentials() async {
    for (final key in [
      'git-token',
      'git-ssh-private-key',
      'git-ssh-passphrase',
    ]) {
      await secure.delete(key: key);
    }
  }

  Future<String> certificatePath() async {
    final bytes = (await rootBundle.load(
      'packages/git2dart_binaries/assets/certs/cacert.pem',
    )).buffer.asUint8List();
    final support = await getApplicationSupportDirectory();
    await support.create(recursive: true);
    final file = File(p.join(support.path, 'git-ca-certificates.pem'));
    if (!await file.exists() ||
        sha256.convert(await file.readAsBytes()) != sha256.convert(bytes)) {
      await file.writeAsBytes(bytes, flush: true);
    }
    return file.path;
  }

  Future<String> gitToken() async => await secure.read(key: 'git-token') ?? '';
  Future<void> setGit(
    String name,
    String email,
    String username,
    String token,
  ) async {
    await preferences.setString('gitName', name.trim());
    await preferences.setString('gitEmail', email.trim());
    await preferences.setString('gitUsername', username.trim());
    if (token.trim().isNotEmpty) {
      await secure.write(key: 'git-token', value: token.trim());
    }
  }
}
