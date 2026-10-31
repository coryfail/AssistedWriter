import 'package:flutter_quill/flutter_quill.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:markdown_quill/markdown_quill.dart';

void main() {
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
