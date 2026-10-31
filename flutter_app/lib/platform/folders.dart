import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/services.dart';

/// Apple platforms retain security-scoped URLs and persist their bookmarks.
/// A plain path returned by a picker does not preserve sandbox access.
class BookFolders {
  static const _channel = MethodChannel('com.assistedwriter/book-folders');
  static bool get _apple => Platform.isMacOS || Platform.isIOS;
  static Future<String?> pick() async => _apple
      ? await _channel.invokeMethod<String>('pick')
      : await FilePicker.getDirectoryPath(dialogTitle: 'Choose a book folder');
  static Future<void> remember(String root) async {
    if (_apple) await _channel.invokeMethod<void>('remember', {'path': root});
  }

  static Future<String> restore(String root) async {
    if (!_apple) return root;
    return await _channel.invokeMethod<String>('restore', {'path': root}) ??
        root;
  }
}
