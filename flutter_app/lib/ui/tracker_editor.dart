import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

import '../book/tracker.dart';
import '../editor/markdown_editor.dart';
import 'dialogs.dart';

class TrackerEditor extends StatefulWidget {
  const TrackerEditor({
    super.key,
    required this.value,
    required this.onChanged,
    this.readOnly = false,
  });
  final String value;
  final ValueChanged<String> onChanged;
  final bool readOnly;
  @override
  State<TrackerEditor> createState() => _TrackerEditorState();
}

class _TrackerEditorState extends State<TrackerEditor> {
  String selected = 'other';
  @override
  Widget build(BuildContext context) {
    final entries = parseTracker(widget.value);
    final matching = entries.where((e) => e.id == selected).toList();
    final entry = matching.isEmpty ? null : matching.first;
    final segments = <({int start, int end, String text})>[];
    var previous = 0;
    for (final item in entries) {
      segments.add((
        start: previous,
        end: item.start,
        text: widget.value.substring(previous, item.start),
      ));
      previous = item.end;
    }
    segments.add((
      start: previous,
      end: widget.value.length,
      text: widget.value.substring(previous),
    ));
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Expanded(
                child: DropdownButton<String>(
                  isExpanded: true,
                  value: entry == null ? 'other' : selected,
                  items: [
                    const DropdownMenuItem(
                      value: 'other',
                      child: Text('Other notes'),
                    ),
                    for (final item in entries)
                      DropdownMenuItem(value: item.id, child: Text(item.name)),
                  ],
                  onChanged: widget.readOnly
                      ? null
                      : (value) => setState(() => selected = value!),
                ),
              ),
              IconButton(
                tooltip: 'Add entry',
                onPressed: widget.readOnly
                    ? null
                    : () async {
                        final values = await editFields(context, 'New entry', {
                          'Name': '',
                        }, submit: 'Add');
                        if (values == null) return;
                        final id = const Uuid().v4();
                        widget.onChanged(
                          addTrackerEntry(
                            widget.value,
                            values['Name']!,
                            id: id,
                          ),
                        );
                        setState(() => selected = id);
                      },
                icon: const Icon(Icons.person_add_alt),
              ),
              if (entry != null) ...[
                IconButton(
                  tooltip: 'Rename entry',
                  onPressed: widget.readOnly
                      ? null
                      : () async {
                          final values = await editFields(
                            context,
                            'Rename entry',
                            {'Name': entry.name},
                          );
                          if (values != null) {
                            widget.onChanged(
                              updateTrackerEntry(
                                widget.value,
                                entry.id,
                                values['Name']!,
                                entry.description,
                              ),
                            );
                          }
                        },
                  icon: const Icon(Icons.edit_outlined),
                ),
                IconButton(
                  tooltip: 'Delete entry',
                  onPressed: widget.readOnly
                      ? null
                      : () async {
                          if (await confirmAction(
                            context,
                            'Delete ${entry.name}?',
                            'This removes the entry and its description from this tracker.',
                            action: 'Delete',
                          )) {
                            widget.onChanged(
                              deleteTrackerEntry(widget.value, entry.id),
                            );
                            setState(() => selected = 'other');
                          }
                        },
                  icon: const Icon(Icons.delete_outline),
                ),
              ],
            ],
          ),
        ),
        Expanded(
          child: entry != null
              ? MarkdownEditor(
                  key: ValueKey(entry.id),
                  value: entry.description,
                  readOnly: widget.readOnly,
                  onChanged: (value) {
                    final current = parseTracker(widget.value)
                        .firstWhere((e) => e.id == entry.id);
                    widget.onChanged(
                      updateTrackerEntry(
                        widget.value,
                        current.id,
                        current.name,
                        value,
                      ),
                    );
                  },
                )
              : ListView(
                  children: [
                    const Padding(
                      padding: EdgeInsets.all(16),
                      child: Text(
                        'Freeform text outside named entries stays in its original Markdown file.',
                      ),
                    ),
                    for (var i = 0; i < segments.length; i++)
                      SizedBox(
                        height: 340,
                        child: MarkdownEditor(
                          key: ValueKey('segment-$i'),
                          value: segments[i].text,
                          readOnly: widget.readOnly,
                          onChanged: (value) {
                            final segment = segments[i];
                            widget.onChanged(
                              widget.value.replaceRange(
                                segment.start,
                                segment.end,
                                value,
                              ),
                            );
                          },
                        ),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}
