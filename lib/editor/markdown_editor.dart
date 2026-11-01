import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_quill/flutter_quill.dart' as q;
import 'package:markdown/markdown.dart' as md;
import 'package:markdown_quill/markdown_quill.dart';

import '../platform/spelling.dart';

class MarkdownEditor extends StatefulWidget {
  const MarkdownEditor({
    super.key,
    required this.value,
    required this.onChanged,
    this.onSelection,
    this.readOnly = false,
  });
  final String value;
  final ValueChanged<String> onChanged;
  final ValueChanged<String>? onSelection;
  final bool readOnly;
  @override
  State<MarkdownEditor> createState() => _MarkdownEditorState();
}

class _MarkdownEditorState extends State<MarkdownEditor> {
  late q.QuillController controller;
  late TextEditingController source;
  StreamSubscription<dynamic>? subscription;
  bool sourceMode = false;
  String? conversionError;
  String lastValue = '';
  final focus = FocusNode();
  final scroll = ScrollController();
  static final parser = MarkdownToDelta(
    markdownDocument: md.Document(
      encodeHtml: false,
      extensionSet: md.ExtensionSet.gitHubWeb,
    ),
  );
  static final serializer = DeltaToMarkdown();
  @override
  void initState() {
    super.initState();
    _load(widget.value);
  }

  void _load(String value) {
    lastValue = value;
    source = TextEditingController(text: value);
    try {
      controller = q.QuillController(
        document: value.trim().isEmpty
            ? q.Document()
            : q.Document.fromDelta(parser.convert(value)),
        selection: const TextSelection.collapsed(offset: 0),
      );
    } catch (e) {
      controller = q.QuillController.basic();
      conversionError = 'This Markdown is available in source mode: $e';
      sourceMode = true;
    }
    // Unsupported structures and tracker markers must stay byte-preserving in source mode.
    if (RegExp(r'<!--|!\[|\|.*\|').hasMatch(value)) sourceMode = true;
    controller.readOnly = widget.readOnly;
    subscription = controller.document.changes.listen((change) {
      if (change.source != q.ChangeSource.local || sourceMode) return;
      try {
        final value = serializer.convert(controller.document.toDelta());
        lastValue = value;
        widget.onChanged(value);
      } catch (e) {
        setState(() => conversionError = 'Could not serialize this edit: $e');
      }
    });
    controller.addListener(_selection);
  }

  void _selection() {
    final range = controller.selection;
    final text = controller.document.toPlainText();
    if (range.start >= 0 && range.end <= text.length) {
      widget.onSelection?.call(text.substring(range.start, range.end));
    }
  }

  @override
  void didUpdateWidget(covariant MarkdownEditor old) {
    super.didUpdateWidget(old);
    controller.readOnly = widget.readOnly;
  }

  @override
  void dispose() {
    subscription?.cancel();
    controller.removeListener(_selection);
    controller.dispose();
    source.dispose();
    focus.dispose();
    scroll.dispose();
    super.dispose();
  }

  void toggleSource() {
    if (sourceMode) {
      try {
        if (source.text.trim().isNotEmpty) {
          q.Document.fromDelta(parser.convert(source.text));
        }
        subscription?.cancel();
        controller.removeListener(_selection);
        controller.dispose();
        source.dispose();
        conversionError = null;
        sourceMode = false;
        _load(lastValue);
      } catch (e) {
        setState(
          () =>
              conversionError = 'Keep editing this document in source mode: $e',
        );
        return;
      }
    } else {
      source.text = lastValue;
      sourceMode = true;
    }
    setState(() {});
  }

  void sceneBreak() {
    final position = controller.selection.start.clamp(
      0,
      controller.document.length - 1,
    );
    controller.replaceText(
      position,
      controller.selection.end - position,
      const q.BlockEmbed('divider', 'hr'),
      TextSelection.collapsed(offset: position + 1),
    );
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Row(
        children: [
          const SizedBox(width: 12),
          Text(
            sourceMode ? 'Markdown source' : 'Formatted text',
            style: Theme.of(context).textTheme.labelLarge,
          ),
          const Spacer(),
          TextButton.icon(
            onPressed: toggleSource,
            icon: Icon(sourceMode ? Icons.article_outlined : Icons.code),
            label: Text(sourceMode ? 'Formatted' : 'Source'),
          ),
        ],
      ),
      if (conversionError != null)
        Padding(
          padding: const EdgeInsets.all(8),
          child: Text(conversionError!),
        ),
      if (!sourceMode) ...[
        q.QuillSimpleToolbar(
          controller: controller,
          config: const q.QuillSimpleToolbarConfig(
            multiRowsDisplay: false,
            showFontFamily: false,
            showFontSize: false,
            showColorButton: false,
            showBackgroundColorButton: false,
            showInlineCode: false,
            showCodeBlock: false,
            showListCheck: false,
            showLink: false,
            showIndent: false,
            showSubscript: false,
            showSuperscript: false,
            showUnderLineButton: false,
            showSmallButton: false,
          ),
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: widget.readOnly ? null : sceneBreak,
            icon: const Icon(Icons.horizontal_rule),
            label: const Text('Scene break'),
          ),
        ),
      ],
      Expanded(
        child: sourceMode
            ? TextField(
                controller: source,
                readOnly: widget.readOnly,
                expands: true,
                minLines: null,
                maxLines: null,
                textAlignVertical: TextAlignVertical.top,
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurface,
                  fontFamily: 'monospace',
                  fontSize: 15,
                  height: 1.6,
                ),
                decoration: const InputDecoration(
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.all(24),
                ),
                onChanged: (value) {
                  lastValue = value;
                  widget.onChanged(value);
                },
                onTap: () {
                  final selection = source.selection;
                  if (selection.isValid) {
                    widget.onSelection?.call(selection.textInside(source.text));
                  }
                },
              )
            : q.QuillEditor(
                controller: controller,
                focusNode: focus,
                scrollController: scroll,
                config: q.QuillEditorConfig(
                  padding: const EdgeInsets.fromLTRB(32, 24, 32, 48),
                  expands: true,
                  placeholder: 'Write your story…',
                  enableScribble: true,
                  embedBuilders: const [SceneBreakBuilder()],
                  customStyles: q.DefaultStyles(
                    paragraph: q.DefaultTextBlockStyle(
                      TextStyle(
                        color: Theme.of(context).colorScheme.onSurface,
                        fontFamily: 'Book',
                        fontSize: 17,
                        height: 1.65,
                      ),
                      const q.HorizontalSpacing(0, 0),
                      const q.VerticalSpacing(0, 14),
                      const q.VerticalSpacing(0, 0),
                      null,
                    ),
                  ),
                  contextMenuBuilder: (context, rawState) {
                    final range = controller.selection;
                    final plain = controller.document.toPlainText();
                    final word = range.isValid && range.end <= plain.length
                        ? range.textInside(plain)
                        : '';
                    return FutureBuilder<List<String>>(
                      future: spellingSuggestions(word),
                      builder: (context, snapshot) =>
                          AdaptiveTextSelectionToolbar.buttonItems(
                            anchors: rawState.contextMenuAnchors,
                            buttonItems: [
                              if (!widget.readOnly)
                                for (final guess in snapshot.data ?? <String>[])
                                  ContextMenuButtonItem(
                                    label: guess,
                                    onPressed: () {
                                      ContextMenuController.removeAny();
                                      if (controller.selection == range) {
                                        controller.replaceText(
                                          range.start,
                                          range.end - range.start,
                                          guess,
                                          TextSelection.collapsed(
                                            offset: range.start + guess.length,
                                          ),
                                        );
                                      }
                                    },
                                  ),
                              ...rawState.contextMenuButtonItems,
                            ],
                          ),
                    );
                  },
                ),
              ),
      ),
    ],
  );
}

class SceneBreakBuilder extends q.EmbedBuilder {
  const SceneBreakBuilder();
  @override
  String get key => 'divider';
  @override
  Widget build(BuildContext context, q.EmbedContext embedContext) =>
      const Padding(
        padding: EdgeInsets.symmetric(vertical: 20),
        child: Center(child: Text('* * *', style: TextStyle(letterSpacing: 5))),
      );
}
