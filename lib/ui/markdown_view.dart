import 'package:flutter/material.dart';

import '../services/export.dart';

/// Read-only Markdown using the same supported prose constructs as exports.
class MarkdownView extends StatelessWidget {
  const MarkdownView(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final block in parseBlocks(text))
        if (block.type == 'scene')
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 10),
            child: Center(child: Text('* * *')),
          )
        else
          Padding(
            padding: EdgeInsets.only(
              top: block.type == 'heading' ? 12 : 0,
              bottom: 10,
              left: block.quote ? 14 : 0,
            ),
            child: SelectableText.rich(
              TextSpan(
                style: block.type == 'heading'
                    ? Theme.of(context).textTheme.titleMedium
                    : Theme.of(context).textTheme.bodyMedium,
                children: [
                  for (final run in block.runs)
                    TextSpan(
                      text: run.text,
                      style: TextStyle(
                        fontWeight: run.bold || block.type == 'heading'
                            ? FontWeight.bold
                            : FontWeight.normal,
                        fontStyle: run.italic
                            ? FontStyle.italic
                            : FontStyle.normal,
                        decoration: run.strike
                            ? TextDecoration.lineThrough
                            : TextDecoration.none,
                      ),
                    ),
                ],
              ),
            ),
          ),
    ],
  );
}
