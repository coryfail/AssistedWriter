import 'dart:io';
import 'dart:async';

import 'package:auto_updater/auto_updater.dart';
import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:window_manager/window_manager.dart';

/// Native Sparkle / WinSparkle own download progress and restart confirmation.
/// iOS updates are distributed by the App Store or TestFlight.
class UpdateService extends ChangeNotifier with UpdaterListener {
  UpdateService({required this.beforeQuit});
  final Future<bool> Function() beforeQuit;
  static const feed = String.fromEnvironment('UPDATE_FEED_URL');
  static const storeURL = String.fromEnvironment('IOS_STORE_URL');
  String status = '';
  bool checking = false;
  bool _listening = false;
  bool _initialized = false;
  Future<void> check() async {
    if (Platform.isIOS) {
      if (storeURL.isEmpty) {
        status = 'Install iOS updates through the App Store or TestFlight.';
        notifyListeners();
        return;
      }
      await launchUrl(
        Uri.parse(storeURL),
        mode: LaunchMode.externalApplication,
      );
      return;
    }
    if (feed.isEmpty) {
      status = 'Update distribution is not configured for this build.';
      notifyListeners();
      return;
    }
    if (!feed.startsWith('https://')) {
      throw StateError('The update feed must use HTTPS.');
    }
    if (!_listening) {
      autoUpdater.addListener(this);
      _listening = true;
    }
    checking = true;
    status = 'Checking for updates…';
    notifyListeners();
    try {
      if (!_initialized) {
        await autoUpdater.setFeedURL(feed);
        await autoUpdater.setScheduledCheckInterval(0);
        _initialized = true;
      }
      await autoUpdater.checkForUpdates(inBackground: false);
    } catch (e) {
      checking = false;
      status = 'Update check failed: $e';
      notifyListeners();
    }
  }

  @override
  void onUpdaterError(UpdaterError? error) {
    checking = false;
    status = 'Update check failed: $error';
    notifyListeners();
  }

  @override
  void onUpdaterCheckingForUpdate(Appcast? appcast) {
    checking = true;
    status = 'Checking for updates…';
    notifyListeners();
  }

  @override
  void onUpdaterUpdateAvailable(AppcastItem? appcastItem) {
    checking = false;
    status = 'An update is available. Follow the update window to download and install it.';
    notifyListeners();
  }

  @override
  void onUpdaterUpdateNotAvailable(UpdaterError? error) {
    checking = false;
    status = 'Assisted Writer is up to date.';
    notifyListeners();
  }

  @override
  void onUpdaterUpdateDownloaded(AppcastItem? appcastItem) {
    checking = false;
    status = 'Update downloaded. Confirm restart in the update window.';
    notifyListeners();
  }

  @override
  void onUpdaterBeforeQuitForUpdate(AppcastItem? appcastItem) {
    status = 'Restarting for the update…';
    notifyListeners();
    unawaited(_finishUpdate());
  }

  Future<void> _finishUpdate() async {
    if (!await beforeQuit()) {
      status = 'Resolve unsaved changes before restarting for the update.';
      notifyListeners();
      return;
    }
    if (Platform.isWindows) await windowManager.destroy();
  }

  @override
  void dispose() {
    if (_listening) autoUpdater.removeListener(this);
    super.dispose();
  }
}
