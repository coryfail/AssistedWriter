import 'dart:io';

import 'package:flutter/services.dart';

Future<List<String>> spellingSuggestions(String word) async {
  if (!Platform.isMacOS ||
      word.isEmpty ||
      word.length > 80 ||
      RegExp(r'\s').hasMatch(word)) {
    return [];
  }
  try {
    return await const MethodChannel('com.assistedwriter/book-folders')
            .invokeListMethod<String>('spelling', {'word': word}) ??
        [];
  } on MissingPluginException {
    return [];
  }
}
