import 'package:flutter_quill/flutter_quill.dart';
import 'package:flutter/material.dart';
import 'package:assisted_writer/editor/markdown_editor.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:markdown_quill/markdown_quill.dart';

void main() {
  testWidgets('manuscript text has readable contrast on the light page', (
    tester,
  ) async {
    const paper = Color(0xfffaf8f3);
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xff6d6252),
            surface: paper,
          ),
          scaffoldBackgroundColor: paper,
        ),
        localizationsDelegates: const [FlutterQuillLocalizations.delegate],
        home: Scaffold(
          body: MarkdownEditor(
            value: 'Readable manuscript text.',
            onChanged: (_) {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final prose = tester
        .widgetList<RichText>(find.byType(RichText))
        .where(
          (widget) =>
              widget.text.toPlainText().contains('Readable manuscript text.'),
        );
    expect(prose, isNotEmpty);
    void check(InlineSpan span, Color inherited) {
      final color = span.style?.color ?? inherited;
      if (span is TextSpan) {
        if (span.text?.contains('Readable manuscript text.') == true) {
          final ink = color.computeLuminance();
          final background = paper.computeLuminance();
          final contrast = background > ink
              ? (background + 0.05) / (ink + 0.05)
              : (ink + 0.05) / (background + 0.05);
          expect(contrast, greaterThanOrEqualTo(4.5));
        }
        for (final child in span.children ?? <InlineSpan>[]) {
          check(child, color);
        }
      }
    }

    for (final widget in prose) {
      check(widget.text, Colors.white);
    }
    await tester.pumpWidget(const SizedBox());
  });
  test('supported manuscript formatting round-trips through the rich editor', () {
    const source =
        '## Subheading\n\n**Bold** and *italic* and ~~strike~~.\n\n> Quoted paragraph\n\n- First\n- Second\n\n---\n\nEnd.';
    final parser = MarkdownToDelta(
      markdownDocument: md.Document(
        encodeHtml: false,
        extensionSet: md.ExtensionSet.gitHubWeb,
      ),
    );
    final doc = Document.fromDelta(parser.convert(source));
    final result = DeltaToMarkdown().convert(doc.toDelta());
    expect(result, contains('## Subheading'));
    expect(result, contains('**Bold**'));
    expect(result, anyOf(contains('*italic*'), contains('_italic_')));
    expect(result, contains('~~strike~~'));
    expect(result, contains('> Quoted'));
    expect(
      md.Document()
          .parseLines(result.split('\n'))
          .whereType<md.Element>()
          .any((node) => node.tag == 'hr'),
      isTrue,
    );
    expect(result, contains('First'));
    expect(result, contains('End'));
  });
}
