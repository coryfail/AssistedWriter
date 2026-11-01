import 'package:flutter/material.dart';

import '../book/session.dart';
import '../services/assistant.dart';
import 'markdown_view.dart';

class AssistantPanel extends StatefulWidget {
  const AssistantPanel({
    super.key,
    required this.session,
    required this.selection,
  });
  final WriterSession session;
  final String selection;
  @override
  State<AssistantPanel> createState() => _AssistantPanelState();
}

class _AssistantPanelState extends State<AssistantPanel> {
  final service = AssistantService();
  final question = TextEditingController();
  final history = <Map<String, String>>[];
  Map<String, dynamic>? result;
  bool busy = false;
  String? error;
  final handled = <String>{};
  @override
  void dispose() {
    service.close();
    question.dispose();
    super.dispose();
  }

  Future<void> review(String action, {bool notes = false}) async {
    final session = widget.session;
    final chapter = session.chapter;
    if (chapter == null || session.store == null || busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      if (!await session.flush()) {
        throw StateError(
          'Save or resolve your current draft before asking the assistant.',
        );
      }
      final text = question.text.trim();
      final next = await service.review(
        session.store!,
        chapterId: chapter.id,
        action: action,
        apiKey: await session.settings.apiKey(),
        model: session.settings.model,
        question: text,
        history: List.of(history),
        selection: widget.selection,
        noteRequested: notes,
      );
      if (!mounted) return;
      setState(() {
        result = next;
        handled.clear();
        if (action == 'brainstorm') {
          history.add({
            'role': 'user',
            'text': text.isEmpty
                ? (notes
                      ? 'Suggest notes from this conversation.'
                      : 'Discuss this chapter.')
                : text,
          });
          history.add({'role': 'assistant', 'text': next['summary'] as String});
        }
        question.clear();
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> approve(
    Map<String, dynamic> item,
    String key, {
    bool note = false,
  }) async {
    final report = result;
    if (report == null || busy) return;
    setState(() => busy = true);
    try {
      String? nextHash;
      final success = await widget.session.mutate((store) async {
        if (note) {
          await store.appendNote(
            item['target'] as String,
            report['chapterId'] as String,
            item,
          );
        } else {
          nextHash = await store.approveSuggestion(
            report['chapterId'] as String,
            item['quote'] as String,
            item['replacement'] as String,
            report['sourceHash'] as String,
          );
        }
      });
      if (success && mounted) {
        setState(() {
          handled.add(key);
          if (nextHash != null) report['sourceHash'] = nextHash;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final report = result;
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        Text('Assistant', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        Text(
          widget.session.chapter == null
              ? 'Choose a chapter to begin.'
              : 'Using ${widget.session.chapter!.title}, book guidance, notes, context, and story trackers.',
        ),
        const SizedBox(height: 12),
        TextField(
          controller: question,
          minLines: 2,
          maxLines: 6,
          decoration: const InputDecoration(
            labelText: 'Discuss ideas or ask a question',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton(
              onPressed: busy ? null : () => review('brainstorm'),
              child: const Text('Discuss'),
            ),
            OutlinedButton(
              onPressed: busy ? null : () => review('ask'),
              child: const Text('Ask'),
            ),
            OutlinedButton(
              onPressed: busy ? null : () => review('chapter'),
              child: const Text('Review chapter'),
            ),
            OutlinedButton(
              onPressed: busy ? null : () => review('continuity'),
              child: const Text('Check continuity'),
            ),
            OutlinedButton(
              onPressed: busy ? null : () => review('editor'),
              child: const Text('Final editor pass'),
            ),
            OutlinedButton(
              onPressed: busy ? null : () => review('brainstorm', notes: true),
              child: const Text('Suggest notes'),
            ),
            TextButton(
              onPressed: busy
                  ? null
                  : () {
                      setState(() {
                        history.clear();
                        result = null;
                        handled.clear();
                      });
                    },
              child: const Text('New conversation'),
            ),
          ],
        ),
        if (busy)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: LinearProgressIndicator(),
          ),
        if (error != null)
          SelectableText(
            error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        for (var i = 0; i < history.length; i++)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  history[i]['role'] == 'user' ? 'You' : 'Assistant',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                MarkdownView(history[i]['text'] ?? ''),
              ],
            ),
          ),
        if (report != null) ...[
          const Divider(),
          Text(
            'Report for ${(report['sent'] as Map?)?['chapter'] ?? report['chapterId']}',
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
          if (report['action'] != 'brainstorm')
            MarkdownView(report['summary'] as String),
          for (final finding in report['findings'] as List)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(finding['title']?.toString() ?? ''),
              subtitle: SelectableText(
                '${finding['detail']}\n${finding['quote']}',
              ),
            ),
          for (final warning in report['warnings'] as List)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.warning_amber),
              title: Text(warning['category']?.toString() ?? 'Continuity'),
              subtitle: SelectableText(
                '${warning['detail']}\nEvidence: ${warning['evidence']}',
              ),
            ),
          for (var i = 0; i < (report['suggestions'] as List).length; i++)
            if (!handled.contains('edit-$i'))
              _proposal(
                report['suggestions'][i] as Map<String, dynamic>,
                'edit-$i',
              ),
          for (var i = 0; i < (report['notes'] as List).length; i++)
            if (!handled.contains('note-$i'))
              _proposal(
                report['notes'][i] as Map<String, dynamic>,
                'note-$i',
                note: true,
              ),
          const SizedBox(height: 10),
          const Text(
            'Review reports are saved in editorial/. Each edit and note requires approval.',
          ),
        ],
      ],
    );
  }

  Widget _proposal(
    Map<String, dynamic> item,
    String key, {
    bool note = false,
  }) => Card(
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            note
                ? '${item['title']} → ${item['target']}'
                : item['category']?.toString() ?? 'Suggested edit',
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          SelectableText(
            note
                ? item['content'] as String
                : 'Original: ${item['quote']}\n\nReplacement: ${item['replacement']}\n\n${item['reason']}',
          ),
          Row(
            children: [
              TextButton(
                onPressed: busy ? null : () => approve(item, key, note: note),
                child: Text(note ? 'Approve note' : 'Approve edit'),
              ),
              TextButton(
                onPressed: busy ? null : () => setState(() => handled.add(key)),
                child: const Text('Dismiss'),
              ),
            ],
          ),
        ],
      ),
    ),
  );
}
