import 'package:flutter/material.dart';

Future<Map<String, String>?> editFields(
  BuildContext context,
  String title,
  Map<String, String> fields, {
  Set<String> secret = const {},
  String submit = 'Save',
}) => showDialog<Map<String, String>>(
  context: context,
  builder: (_) => FieldsDialog(
    title: title,
    fields: fields,
    secret: secret,
    submit: submit,
  ),
);

class FieldsDialog extends StatefulWidget {
  const FieldsDialog({
    super.key,
    required this.title,
    required this.fields,
    required this.secret,
    required this.submit,
  });
  final String title, submit;
  final Map<String, String> fields;
  final Set<String> secret;
  @override
  State<FieldsDialog> createState() => _FieldsDialogState();
}

class _FieldsDialogState extends State<FieldsDialog> {
  late final controllers = {
    for (final entry in widget.fields.entries)
      entry.key: TextEditingController(text: entry.value),
  };
  @override
  void dispose() {
    for (final c in controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: SizedBox(
      width: 440,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final entry in controllers.entries)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: TextField(
                  controller: entry.value,
                  obscureText: widget.secret.contains(entry.key),
                  autocorrect: !widget.secret.contains(entry.key),
                  enableSuggestions: !widget.secret.contains(entry.key),
                  decoration: InputDecoration(labelText: entry.key),
                  autofocus: entry.key == controllers.keys.first,
                ),
              ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: () => Navigator.pop(context, {
          for (final entry in controllers.entries) entry.key: entry.value.text,
        }),
        child: Text(widget.submit),
      ),
    ],
  );
}

Future<bool> confirmAction(
  BuildContext context,
  String title,
  String detail, {
  String action = 'Continue',
}) async =>
    await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(detail),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(action),
          ),
        ],
      ),
    ) ??
    false;
