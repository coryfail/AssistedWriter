import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// GitHub OAuth device flow: the app contains a public client ID, never a secret.
class GitHubService {
  GitHubService({
    http.Client? client,
    this.clientId = const String.fromEnvironment('GITHUB_CLIENT_ID'),
  }) : _client = client ?? http.Client();
  final http.Client _client;
  final String clientId;
  void close() => _client.close();

  Future<Map<String, dynamic>> _oauth(
    String endpoint,
    Map<String, String> body,
  ) async {
    final response = await _client
        .post(
          Uri.https('github.com', endpoint),
          headers: {'Accept': 'application/json'},
          body: body,
        )
        .timeout(const Duration(seconds: 30));
    if (response.statusCode != 200) {
      throw StateError(
        'GitHub sign-in is unavailable (${response.statusCode}). Try again.',
      );
    }
    return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
  }

  Future<Map<String, dynamic>> startSignIn() async {
    if (clientId.isEmpty) {
      throw StateError(
        'This build needs GITHUB_CLIENT_ID to enable browser sign-in. You can connect with an access token below.',
      );
    }
    final result = await _oauth('/login/device/code', {
      'client_id': clientId,
      'scope': 'repo',
    });
    if (result['device_code'] is! String ||
        result['user_code'] is! String ||
        result['interval'] is! int ||
        result['expires_in'] is! int ||
        (result['interval'] as int) < 1 ||
        (result['expires_in'] as int) < 1) {
      throw StateError(
        'GitHub could not start sign-in. Check that Device Flow is enabled for the OAuth app.',
      );
    }
    return result;
  }

  /// One poll at a time; the caller controls interval, expiry and cancellation.
  Future<Map<String, dynamic>> pollSignIn(String code) =>
      _oauth('/login/oauth/access_token', {
        'client_id': clientId,
        'device_code': code,
        'grant_type': 'urn:ietf:params:oauth:grant-type:device_code',
      });

  Future<dynamic> request(
    String method,
    String path,
    String token, {
    Object? body,
  }) async {
    if (token.isEmpty) {
      throw StateError('Sign in to GitHub to access repositories.');
    }
    final request = http.Request(
      method,
      Uri.parse('https://api.github.com$path'),
    );
    request.headers.addAll({
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer $token',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final response = await _client
        .send(request)
        .then(http.Response.fromStream)
        .timeout(const Duration(seconds: 30));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      // Never display response bodies: they may contain credentials or user data.
      final detail = switch (response.statusCode) {
        401 => 'Your GitHub sign-in has expired. Sign out and reconnect.',
        403 => 'GitHub denied access. Check repository permissions, organization SSO, or the API rate limit.',
        404 => 'Repository not found or this account does not have access.',
        422 => 'That repository name already exists or is invalid. Choose another name.',
        _ => 'GitHub request failed (${response.statusCode}). Try again.',
      };
      throw StateError(detail);
    }
    return jsonDecode(response.body);
  }

  Future<Map<String, dynamic>> user(String token) async =>
      Map<String, dynamic>.from(await request('GET', '/user', token) as Map);
  Future<List<Map<String, dynamic>>> repositories(
    String token, {
    int page = 1,
  }) async => (await request(
    'GET',
    '/user/repos?per_page=50&page=$page&sort=updated&affiliation=owner,collaborator,organization_member',
    token,
  ) as List).map((v) => Map<String, dynamic>.from(v as Map)).toList();
  Future<Map<String, dynamic>> createRepository(
    String token,
    String name, {
    bool private = true,
  }) async {
    if (!RegExp(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$').hasMatch(name)) {
      throw ArgumentError(
        'Use 1–100 letters, numbers, dots, hyphens or underscores for the repository name.',
      );
    }
    return Map<String, dynamic>.from(
      await request(
        'POST',
        '/user/repos',
        token,
        body: {
          'name': name,
          'private': private,
          'auto_init': false,
          'description': 'An Assisted Writer book',
        },
      ) as Map,
    );
  }
}
