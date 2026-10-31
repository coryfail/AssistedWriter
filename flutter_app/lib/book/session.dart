import 'dart:async';

import 'package:flutter/foundation.dart';

import '../platform/folders.dart';
import '../services/settings.dart';
import 'manifest.dart';
import 'store.dart';

class WriterSession extends ChangeNotifier {
  WriterSession(this.settings, this.templates) {
    _poll = Timer.periodic(const Duration(seconds: 2), (_) => _checkExternal());
  }
  final AppSettings settings;
  final Map<String, String> templates;
  BookStore? store;
  BookSnapshot? book;
  String? path, chapterId;
  String draft = '', saved = '', revision = '';
  String? error;
  bool busy = false, saving = false, conflict = false;
  int documentVersion = 0;
  Timer? _autosave, _poll;
  Future<bool>? _saving;
  bool _checking = false, _disposed = false;
  bool get dirty => draft != saved;
  BookChapter? get chapter {
    for (final c in book?.manifest.chapters ?? <BookChapter>[]) {
      if (c.id == chapterId) return c;
    }
    return (book?.manifest.chapters.isNotEmpty ?? false)
        ? book!.manifest.chapters.first
        : null;
  }

  BookChapter? manuscriptFor(String? file) {
    for (final c in book?.manifest.chapters ?? <BookChapter>[]) {
      if ('chapters/${c.file}' == file) return c;
    }
    return null;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void clearError() {
    error = null;
    _notify();
  }

  void edit(String value) {
    draft = value;
    error = null;
    if (store != null && path != null) {
      unawaited(
        settings.saveDraft(store!.root, path!, revision, value).catchError((
          Object e,
        ) {
          error = '$e';
          _notify();
        }),
      );
    }
    _autosave?.cancel();
    if (!conflict) {
      _autosave = Timer(const Duration(milliseconds: 900), () => flush());
    }
    _notify();
  }

  Future<bool> flush() async {
    _autosave?.cancel();
    if (_saving != null) {
      if (!await _saving!) return false;
    }
    if (!dirty) return true;
    if (conflict || store == null || path == null) return false;
    final completer = Completer<bool>();
    _saving = completer.future;
    final value = draft;
    final target = path!;
    final currentStore = store!;
    final manuscript = manuscriptFor(target);
    final content = manuscript == null
        ? value
        : chapterContent(manuscript.title, value);
    saving = true;
    _notify();
    try {
      final next = await currentStore.save(
        target,
        content,
        revision,
        expectedManifestRevision: manuscript == null
            ? null
            : book?.files['book.json']?.revision,
      );
      revision = next;
      saved = value;
      if (draft == value) {
        await settings.discardDraft(currentStore.root, target);
      } else {
        await settings.saveDraft(currentStore.root, target, next, draft);
      }
      if (book != null) {
        book = BookSnapshot(book!.manifest, {
          ...book!.files,
          target: BookFile(content, next),
        });
      }
      completer.complete(true);
      return true;
    } catch (e) {
      error = '$e';
      conflict = true;
      completer.complete(false);
      return false;
    } finally {
      saving = false;
      _saving = null;
      _notify();
    }
  }

  Future<bool> prepareToQuit() async {
    if (busy) {
      error = 'Wait for the current book operation to finish before quitting.';
      _notify();
      return false;
    }
    return flush();
  }

  Future<bool> activate(String root) async {
    if (busy) return false;
    busy = true;
    _notify();
    try {
      if (!await flush()) return false;
      final restored = await BookFolders.restore(root);
      final next = BookStore(restored);
      await next.migrate(templates);
      final snapshot = await next.snapshot();
      await BookFolders.remember(restored);
      await settings.remember(restored);
      store = next;
      book = snapshot;
      error = null;
      chapterId = snapshot.manifest.chapters.isEmpty
          ? null
          : snapshot.manifest.chapters.first.id;
      _setDocument(
        snapshot.manifest.chapters.isEmpty
            ? 'notes/book.md'
            : 'chapters/${snapshot.manifest.chapters.first.file}',
      );
      return true;
    } catch (e) {
      error = '$e';
      return false;
    } finally {
      busy = false;
      _notify();
    }
  }

  void _setDocument(String file) {
    final value = book!.files[file];
    if (value == null) {
      throw StateError('This document no longer exists. Reload the book.');
    }
    path = file;
    revision = value.revision;
    final manuscript = manuscriptFor(file);
    saved = manuscript == null ? value.content : withoutHeading(value.content);
    draft = saved;
    conflict = false;
    final recovery = settings.draft(store!.root, file);
    if (recovery?['text'] is String && recovery!['text'] != saved) {
      draft = recovery['text'] as String;
      conflict = recovery['revision'] != revision;
      error = conflict
          ? 'Recovered an unsaved draft, but the file has also changed. Copy the draft or reload before continuing.'
          : 'Recovered an unsaved draft. Review it and save when ready.';
    }
    documentVersion++;
    if (manuscript != null) chapterId = manuscript.id;
  }

  Future<bool> openDocument(String file, {String? forChapter}) async {
    if (busy) return false;
    busy = true;
    _notify();
    try {
      if (!await flush()) return false;
      book = await store!.snapshot();
      if (forChapter != null) chapterId = forChapter;
      _setDocument(file);
      return true;
    } catch (e) {
      error = '$e';
      return false;
    } finally {
      busy = false;
      _notify();
    }
  }

  Future<bool> mutate(Future<void> Function(BookStore) operation) async {
    if (busy || store == null) return false;
    busy = true;
    _notify();
    try {
      if (!await flush()) return false;
      await operation(store!);
      await store!.migrate(templates);
      final next = await store!.snapshot();
      book = next;
      final target = next.files.containsKey(path)
          ? path!
          : (next.manifest.chapters.isNotEmpty
                ? 'chapters/${next.manifest.chapters.first.file}'
                : 'notes/book.md');
      _setDocument(target);
      error = null;
      return true;
    } catch (e) {
      error = '$e';
      return false;
    } finally {
      busy = false;
      _notify();
    }
  }

  Future<void> reload({bool discard = false}) async {
    if (busy || store == null) return;
    if (dirty && !discard) {
      error = 'Save your draft or choose Reload and discard to load external changes.';
      _notify();
      return;
    }
    busy = true;
    _notify();
    try {
      if (discard && path != null) {
        await settings.discardDraft(store!.root, path!);
      }
      book = await store!.snapshot();
      final target = book!.files.containsKey(path)
          ? path!
          : (book!.manifest.chapters.isNotEmpty
                ? 'chapters/${book!.manifest.chapters.first.file}'
                : 'notes/book.md');
      _setDocument(target);
      error = null;
    } catch (e) {
      error = '$e';
    } finally {
      busy = false;
      _notify();
    }
  }

  Future<void> _checkExternal() async {
    if (busy ||
        saving ||
        _checking ||
        store == null ||
        book == null ||
        _disposed) {
      return;
    }
    _checking = true;
    try {
      final next = await store!.snapshot();
      if (busy || saving || _disposed) return;
      final previous = book!;
      final changed =
          next.files.length != previous.files.length ||
          next.files.entries.any(
            (e) => previous.files[e.key]?.revision != e.value.revision,
          );
      if (!changed) return;
      final latest = next.files[path];
      if (dirty &&
          (latest == null ||
              latest.revision != revision ||
              next.files['book.json']?.revision !=
                  previous.files['book.json']?.revision)) {
        conflict = true;
        _autosave?.cancel();
        error = 'This document or book structure changed outside Assisted Writer. Your draft is preserved. Copy your draft, or reload and discard it.';
        _notify();
        return;
      }
      book = next;
      if (!dirty && latest != null && latest.revision != revision) {
        _setDocument(path!);
      } else if (!dirty && latest == null) {
        _setDocument(
          next.manifest.chapters.isNotEmpty
              ? 'chapters/${next.manifest.chapters.first.file}'
              : 'notes/book.md',
        );
      }
      _notify();
    } catch (e) {
      if (!_disposed) {
        error = 'Could not refresh book: $e';
        _notify();
      }
    } finally {
      _checking = false;
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _autosave?.cancel();
    _poll?.cancel();
    super.dispose();
  }
}
