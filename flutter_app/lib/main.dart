import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_quill/flutter_quill.dart'
    show FlutterQuillLocalizations;
import 'package:path/path.dart' as p;
import 'package:window_manager/window_manager.dart';

import 'book/session.dart';
import 'book/store.dart';
import 'editor/markdown_editor.dart';
import 'platform/folders.dart';
import 'services/export.dart';
import 'services/settings.dart';
import 'services/updates.dart';
import 'ui/assistant_panel.dart';
import 'ui/dialogs.dart';
import 'ui/git_panel.dart';
import 'ui/tracker_editor.dart';
import 'ui/settings_page.dart';
import 'ui/mobile_library.dart';

bool get desktop => Platform.isMacOS || Platform.isWindows || Platform.isLinux;
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (desktop) {
    await windowManager.ensureInitialized();
    await windowManager.setMinimumSize(const Size(900, 680));
    await windowManager.setSize(const Size(1280, 820));
    await windowManager.center();
    await windowManager.setPreventClose(true);
  }
  final settings = await AppSettings.load();
  final templates = <String, String>{};
  for (final name in [
    'book-AGENTS.md',
    'book-reference-addendum.md',
    'book-brainstorm-addendum.md',
    'book-entries-addendum.md',
    'book-assistant-addendum.md',
  ]) {
    templates[name] = await rootBundle.loadString('assets/templates/$name');
  }
  runApp(AssistedWriterApp(settings: settings, templates: templates));
}

class AssistedWriterApp extends StatelessWidget {
  const AssistedWriterApp({
    super.key,
    required this.settings,
    required this.templates,
    this.pickFolder,
  });
  final AppSettings settings;
  final Map<String, String> templates;
  final Future<String?> Function()? pickFolder;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Assisted Writer',
    debugShowCheckedModeBanner: false,
    localizationsDelegates: const [
      GlobalMaterialLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      FlutterQuillLocalizations.delegate,
    ],
    supportedLocales: const [Locale('en')],
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xff6d6252),
        surface: const Color(0xfffaf8f3),
      ),
      scaffoldBackgroundColor: const Color(0xfffaf8f3),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
      ),
      dividerColor: const Color(0xffdedbd3),
    ),
    home: WriterHome(
      settings: settings,
      templates: templates,
      pickFolder: pickFolder,
    ),
  );
}

class WriterHome extends StatefulWidget {
  const WriterHome({
    super.key,
    required this.settings,
    required this.templates,
    this.pickFolder,
  });
  final AppSettings settings;
  final Map<String, String> templates;
  final Future<String?> Function()? pickFolder;
  @override
  State<WriterHome> createState() => _WriterHomeState();
}

class _WriterHomeState extends State<WriterHome> with WindowListener {
  late final session = WriterSession(widget.settings, widget.templates);
  late final updates = UpdateService(beforeQuit: session.prepareToQuit);
  final scaffold = GlobalKey<ScaffoldState>();
  String selection = '';
  String panel = 'assistant';
  bool sideOpen = false;
  bool gitVisited = false;
  bool exporting = false;
  late final AppLifecycleListener lifecycle;
  @override
  void initState() {
    super.initState();
    session.addListener(changed);
    if (desktop) windowManager.addListener(this);
    lifecycle = AppLifecycleListener(onInactive: () => session.flush());
    const MethodChannel('com.assistedwriter/lifecycle')
        .setMethodCallHandler((call) async {
          if (call.method == 'prepareToQuit') return session.prepareToQuit();
          return null;
        });
  }

  void changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    if (desktop) windowManager.removeListener(this);
    lifecycle.dispose();
    session.removeListener(changed);
    session.dispose();
    updates.dispose();
    super.dispose();
  }

  @override
  void onWindowClose() async {
    if (session.busy) {
      message('Wait for the current book operation to finish before closing.');
      return;
    }
    if (await session.prepareToQuit()) {
      await windowManager.destroy();
      return;
    }
    if (!mounted) return;
    final close = await confirmAction(
      context,
      'Close with unsaved changes?',
      'Your draft has not been saved. Cancel to copy or resolve it before closing.',
      action: 'Close without saving',
    );
    if (close) await windowManager.destroy();
  }

  void message(Object text) {
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('$text')));
    }
  }

  Future<void> openBook([String? root]) async {
    try {
      if (!desktop && root == null) {
        if (!await session.flush() || !mounted) return;
        scaffold.currentState?.closeDrawer();
        final selected = await Navigator.of(context).push<String>(
          MaterialPageRoute(
            builder: (context) => Scaffold(
              appBar: AppBar(title: const Text('Book library')),
              body: MobileLibraryView(
                settings: widget.settings,
                templates: widget.templates,
                onOpen: (root) async => Navigator.of(context).pop(root),
              ),
            ),
          ),
        );
        if (selected != null && !await session.activate(selected)) {
          message(session.error ?? 'Could not open this book.');
        }
        return;
      }
      final selected = root ?? await (widget.pickFolder ?? BookFolders.pick)();
      if (selected != null) await session.activate(selected);
    } catch (e) {
      message(e);
    }
  }

  Future<void> newBook() async {
    if (!desktop) return openBook();
    final values = await editFields(context, 'New book', {
      'Title': '',
      'Author': '',
    }, submit: 'Choose location');
    if (values == null) return;
    try {
      if (!await session.flush()) return;
      final parent = await (widget.pickFolder ?? BookFolders.pick)();
      if (parent == null) return;
      final next = await BookStore.create(
        parent,
        values['Title']!,
        values['Author']!,
        widget.templates['book-AGENTS.md']!,
      );
      await BookFolders.remember(next.root);
      await session.activate(next.root);
    } catch (e) {
      message(e);
    }
  }

  Future<void> selectDocument(String path, {String? chapter}) async {
    if (scaffold.currentState?.isDrawerOpen ?? false) Navigator.pop(context);
    if (await session.openDocument(path, forChapter: chapter)) {
      setState(() => selection = '');
    }
  }

  Future<void> bookDetails() async {
    final current = session.book;
    if (current == null) return;
    final values = await editFields(context, 'Book details', {
      'Title': current.manifest.data['title']?.toString() ?? '',
      'Author': current.manifest.data['author']?.toString() ?? '',
    });
    if (values != null) {
      await session.mutate(
        (store) => store.metadata(
          values['Title']!,
          values['Author']!,
          current.files['book.json']!.revision,
        ),
      );
    }
  }

  Future<void> export(String format) async {
    if (exporting || session.store == null) return;
    setState(() => exporting = true);
    try {
      if (!await session.flush()) {
        throw StateError('Resolve the current draft before exporting.');
      }
      final book = await session.store!.snapshot();
      final bytes = await BookExporter.export(book, format);
      final name = (book.manifest.data['title']?.toString() ?? 'book')
          .replaceAll(RegExp(r'[^a-zA-Z0-9._ -]'), '_');
      final destination = await FilePicker.saveFile(
        dialogTitle: 'Export ${format.toUpperCase()}',
        fileName: '$name.$format',
        mimeType: {
          'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'epub': 'application/epub+zip',
          'pdf': 'application/pdf',
        }[format]!,
        bytes: bytes,
        initialDirectory: Platform.isIOS
            ? null
            : p.join(session.store!.root, 'exports'),
      );
      if (destination != null) {
        message('Exported ${format.toUpperCase()}');
      }
    } catch (e) {
      message(e);
    } finally {
      if (mounted) setState(() => exporting = false);
    }
  }

  Future<void> reload() async {
    if (session.dirty) {
      if (!await confirmAction(
        context,
        'Reload and discard this draft?',
        'The editor will load the current file from disk. Copy your draft first if you want to keep it.',
        action: 'Reload and discard',
      )) {
        return;
      }
    }
    await session.reload(discard: true);
  }

  void togglePanel() {
    if (scaffold.currentState?.isEndDrawerOpen ?? false) {
      Navigator.pop(context);
    }
    setState(() => sideOpen = !sideOpen);
  }

  Widget navigation() {
    final book = session.book;
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 20, 12, 24),
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Text(
            'ASSISTED WRITER',
            style: Theme.of(context).textTheme.labelLarge
                ?.copyWith(letterSpacing: 2),
          ),
        ),
        ListTile(
          leading: const Icon(Icons.folder_open_outlined),
          title: Text(desktop ? 'Open book' : 'Book library'),
          onTap: session.busy ? null : () => openBook(),
        ),
        ListTile(
          leading: const Icon(Icons.add),
          title: const Text('New book'),
          onTap: session.busy ? null : newBook,
        ),
        if (book == null && desktop) ...[
          const Divider(),
          const Padding(
            padding: EdgeInsets.all(12),
            child: Text('RECENT BOOKS'),
          ),
          for (final root in widget.settings.recent)
            ListTile(
              title: Text(p.basename(root)),
              subtitle: Text(
                root,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              onTap: () => openBook(root),
            ),
        ] else if (book != null) ...[
          const Divider(),
          ListTile(
            title: Text(
              book.manifest.data['title']?.toString() ?? 'Book',
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
            subtitle: Text(book.manifest.data['author']?.toString() ?? ''),
            trailing: IconButton(
              onPressed: bookDetails,
              icon: const Icon(Icons.tune),
              tooltip: 'Book details',
            ),
          ),
          ListTile(
            title: const Text('Chapters'),
            trailing: IconButton(
              onPressed: session.busy
                  ? null
                  : () => session.mutate((store) => store.addChapter()),
              icon: const Icon(Icons.add),
              tooltip: 'Add chapter',
            ),
          ),
          for (final chapter in book.manifest.chapters)
            ExpansionTile(
              key: ValueKey(chapter.id),
              initiallyExpanded: chapter.id == session.chapterId,
              title: Text(chapter.title),
              children: [
                ListTile(
                  dense: true,
                  selected: session.path == 'chapters/${chapter.file}',
                  title: const Text('Manuscript'),
                  onTap: () => selectDocument(
                    'chapters/${chapter.file}',
                    chapter: chapter.id,
                  ),
                ),
                ListTile(
                  dense: true,
                  selected: session.path == 'chapters/${chapter.notesFile}',
                  title: const Text('Chapter notes'),
                  onTap: () => selectDocument(
                    'chapters/${chapter.notesFile}',
                    chapter: chapter.id,
                  ),
                ),
                ListTile(
                  dense: true,
                  selected: session.path == chapterContext(chapter),
                  title: const Text('Chapter AI context'),
                  onTap: () => selectDocument(
                    chapterContext(chapter),
                    chapter: chapter.id,
                  ),
                ),
                Wrap(
                  children: [
                    IconButton(
                      tooltip: 'Move up',
                      onPressed:
                          session.busy ||
                              chapter.id == book.manifest.chapters.first.id
                          ? null
                          : () => session.mutate(
                              (store) => store.reorderChapter(chapter.id, -1),
                            ),
                      icon: const Icon(Icons.arrow_upward, size: 18),
                    ),
                    IconButton(
                      tooltip: 'Move down',
                      onPressed:
                          session.busy ||
                              chapter.id == book.manifest.chapters.last.id
                          ? null
                          : () => session.mutate(
                              (store) => store.reorderChapter(chapter.id, 1),
                            ),
                      icon: const Icon(Icons.arrow_downward, size: 18),
                    ),
                    IconButton(
                      tooltip: 'Rename chapter',
                      onPressed: session.busy
                          ? null
                          : () async {
                              final values = await editFields(
                                context,
                                'Rename chapter',
                                {'Title': chapter.title},
                              );
                              if (values != null) {
                                await session.mutate(
                                  (store) => store.renameChapter(
                                    chapter.id,
                                    values['Title']!,
                                  ),
                                );
                              }
                            },
                      icon: const Icon(Icons.edit_outlined, size: 18),
                    ),
                    IconButton(
                      tooltip: 'Delete chapter',
                      onPressed:
                          session.busy || book.manifest.chapters.length <= 1
                          ? null
                          : () async {
                              if (await confirmAction(
                                context,
                                'Delete ${chapter.title}?',
                                'This removes its manuscript, notes, and chapter context files.',
                                action: 'Delete chapter',
                              )) {
                                await session.mutate(
                                  (store) => store.deleteChapter(chapter.id),
                                );
                              }
                            },
                      icon: const Icon(Icons.delete_outline, size: 18),
                    ),
                  ],
                ),
              ],
            ),
          const Divider(),
          for (final entry in {
            'Book notes': 'notes/book.md',
            'Book AI context': 'notes/ai-context.md',
            'Characters': 'notes/characters.md',
            'Locations': 'notes/locations.md',
            'Timeline': 'notes/timeline.md',
            'Terminology': 'notes/terminology.md',
          }.entries)
            ListTile(
              dense: true,
              selected: session.path == entry.value,
              title: Text(entry.key),
              onTap: () => selectDocument(entry.value),
            ),
        ],
        const Divider(),
        ListTile(
          leading: const Icon(Icons.settings_outlined),
          title: const Text('Settings'),
          onTap: () async {
            if (session.dirty && !await session.flush()) return;
            if (!mounted) return;
            await Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => SettingsPage(
                  settings: widget.settings,
                  beforeUpdate: session.flush,
                  updates: updates,
                ),
              ),
            );
            if (mounted) setState(() {});
          },
        ),
      ],
    );
  }

  Widget editor() {
    if (session.book == null) {
      if (!desktop) {
        return MobileLibraryView(
          settings: widget.settings,
          templates: widget.templates,
          onOpen: (root) async {
            if (!await session.activate(root)) {
              throw StateError(session.error ?? 'Could not open this book.');
            }
          },
        );
      }
      return Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'A place for your story.',
                  style: Theme.of(context).textTheme.headlineLarge,
                ),
                const SizedBox(height: 16),
                const Text(
                  'Open an existing Assisted Writer book or begin a new one. Your manuscript and notes stay in readable Markdown files.',
                ),
                const SizedBox(height: 24),
                Wrap(
                  spacing: 12,
                  children: [
                    FilledButton(
                      onPressed: () => openBook(),
                      child: const Text('Open book'),
                    ),
                    OutlinedButton(
                      onPressed: newBook,
                      child: const Text('New book'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      );
    }
    if (session.path == null) {
      return const Center(child: Text('Select a document.'));
    }
    final named = [
      'notes/characters.md',
      'notes/locations.md',
    ].contains(session.path);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 12, 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  session.manuscriptFor(session.path)?.title ?? session.path!,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              Text(
                session.conflict
                    ? 'Draft preserved'
                    : session.saving
                    ? 'Saving…'
                    : session.dirty
                    ? 'Unsaved'
                    : 'Saved',
              ),
              IconButton(
                onPressed: session.busy ? null : reload,
                tooltip: 'Reload from disk',
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: named
              ? TrackerEditor(
                  key: ValueKey(
                    '${session.store!.root}:${session.path}:${session.documentVersion}',
                  ),
                  value: session.draft,
                  readOnly: session.busy,
                  onChanged: session.edit,
                )
              : MarkdownEditor(
                  key: ValueKey(
                    '${session.store!.root}:${session.path}:${session.documentVersion}',
                  ),
                  value: session.draft,
                  readOnly: session.busy,
                  onChanged: session.edit,
                  onSelection: (value) => selection = value,
                ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
          child: Row(
            children: [
              Text(
                '${session.draft.trim().isEmpty ? 0 : session.draft.trim().split(RegExp(r'\s+')).length} words',
                style: Theme.of(context).textTheme.labelSmall,
              ),
              const Spacer(),
              if (session.conflict)
                TextButton(
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: session.draft));
                    message('Draft copied.');
                  },
                  child: const Text('Copy draft'),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget sidePanel() => Column(
    children: [
      Row(
        children: [
          Expanded(
            child: SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'assistant', label: Text('Assistant')),
                ButtonSegment(value: 'git', label: Text('Git')),
              ],
              selected: {panel},
              onSelectionChanged: (values) => setState(() {
                panel = values.single;
                if (panel == 'git') gitVisited = true;
              }),
            ),
          ),
          IconButton(
            onPressed: togglePanel,
            icon: const Icon(Icons.close),
            tooltip: 'Close side panel',
          ),
        ],
      ),
      Expanded(
        child: IndexedStack(
          index: panel == 'assistant' ? 0 : 1,
          children: [
            AssistantPanel(
              key: ValueKey('assistant:${session.store?.root}'),
              session: session,
              selection: selection,
            ),
            if (gitVisited)
              GitPanel(
                key: ValueKey('git:${session.store?.root}'),
                session: session,
              )
            else
              const SizedBox(),
          ],
        ),
      ),
    ],
  );
  @override
  Widget build(BuildContext context) => CallbackShortcuts(
    bindings: {
      for (final meta in [false, true]) ...{
        SingleActivator(
          LogicalKeyboardKey.keyS,
          control: !meta,
          meta: meta,
        ): () =>
            session.flush(),
        SingleActivator(
          LogicalKeyboardKey.digit1,
          control: !meta,
          meta: meta,
        ): () {
          final c = session.chapter;
          if (c != null) selectDocument('chapters/${c.file}', chapter: c.id);
        },
        SingleActivator(
          LogicalKeyboardKey.digit2,
          control: !meta,
          meta: meta,
        ): () =>
            selectDocument('notes/book.md'),
        SingleActivator(
          LogicalKeyboardKey.digit3,
          control: !meta,
          meta: meta,
        ): () {
          final c = session.chapter;
          if (c != null) selectDocument(chapterContext(c), chapter: c.id);
        },
        SingleActivator(
          LogicalKeyboardKey.backslash,
          control: !meta,
          meta: meta,
        ): togglePanel,
      },
    },
    child: LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 1100;
        return Scaffold(
          key: scaffold,
          appBar: AppBar(
            title: Text(
              session.book?.manifest.data['title']?.toString() ??
                  'Assisted Writer',
            ),
            actions: [
              if (exporting)
                const Padding(
                  padding: EdgeInsets.all(12),
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              if (session.book != null)
                PopupMenuButton<String>(
                  enabled: !exporting && !session.busy,
                  tooltip: 'Export manuscript',
                  icon: const Icon(Icons.ios_share_outlined),
                  onSelected: export,
                  itemBuilder: (_) => [
                    for (final type in ['docx', 'epub', 'pdf'])
                      PopupMenuItem(
                        value: type,
                        child: Text('Export ${type.toUpperCase()}'),
                      ),
                  ],
                ),
              IconButton(
                onPressed: session.book == null
                    ? null
                    : () async {
                        setState(() => sideOpen = true);
                        if (!wide) scaffold.currentState?.openEndDrawer();
                      },
                icon: const Icon(Icons.auto_awesome_outlined),
                tooltip: 'Assistant and Git',
              ),
              IconButton(
                onPressed: session.dirty && !session.busy
                    ? () => session.flush()
                    : null,
                icon: const Icon(Icons.save_outlined),
                tooltip: 'Save',
              ),
            ],
          ),
          drawer: wide ? null : Drawer(child: SafeArea(child: navigation())),
          endDrawer: !wide && session.book != null
              ? Drawer(
                  width: constraints.maxWidth.clamp(320, 480),
                  child: SafeArea(child: sidePanel()),
                )
              : null,
          body: Column(
            children: [
              if (session.busy) const LinearProgressIndicator(minHeight: 2),
              if (session.error != null)
                MaterialBanner(
                  content: SelectableText(session.error!),
                  actions: [
                    TextButton(
                      onPressed: session.clearError,
                      child: const Text('Dismiss'),
                    ),
                    if (session.store != null)
                      TextButton(
                        onPressed: reload,
                        child: const Text('Reload'),
                      ),
                  ],
                ),
              Expanded(
                child: Row(
                  children: [
                    if (wide) ...[
                      SizedBox(width: 260, child: navigation()),
                      const VerticalDivider(width: 1),
                    ],
                    Expanded(child: editor()),
                    if (wide && session.book != null) ...[
                      if (sideOpen) const VerticalDivider(width: 1),
                      Visibility(
                        visible: sideOpen,
                        maintainState: true,
                        child: SizedBox(width: 400, child: sidePanel()),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        );
      },
    ),
  );
}
