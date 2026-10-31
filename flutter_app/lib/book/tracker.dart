import 'package:uuid/uuid.dart';

const trackerEnd = '<!-- /assisted-writer-entry -->';

class TrackerEntry {
  const TrackerEntry(
    this.id,
    this.name,
    this.description,
    this.start,
    this.end,
  );
  final String id;
  final String name;
  final String description;
  final int start;
  final int end;
}

List<TrackerEntry> parseTracker(String source) {
  final entries = <TrackerEntry>[];
  final starts = RegExp(
    r'^<!-- assisted-writer-entry:([a-f0-9-]+) -->$',
    multiLine: true,
  );
  for (final match in starts.allMatches(source)) {
    final close = source.indexOf(trackerEnd, match.end);
    if (close < 0 || (entries.isNotEmpty && match.start < entries.last.end)) {
      continue;
    }
    final body = source.substring(match.end, close).trim();
    final heading = RegExp(r'^## ([^\n]+)(?:\n|$)').firstMatch(body);
    if (heading == null) continue;
    entries.add(
      TrackerEntry(
        match[1]!,
        heading[1]!.trim(),
        body.substring(heading.end).trim(),
        match.start,
        close + trackerEnd.length,
      ),
    );
  }
  return entries;
}

String trackerBlock(String id, String name, String description) {
  if (!RegExp(r'^[a-f0-9-]{8,}$').hasMatch(id)) {
    throw ArgumentError('Invalid tracker entry ID.');
  }
  final safeName = name.trim().replaceAll(RegExp(r'[\r\n]+'), ' ');
  return '<!-- assisted-writer-entry:$id -->\n## ${safeName.isEmpty ? 'Untitled' : safeName}\n\n${description.trim()}\n\n$trackerEnd';
}

String addTrackerEntry(String source, String name, {String? id}) =>
    '${source.trimRight()}\n\n${trackerBlock(id ?? const Uuid().v4(), name, '')}\n';

String updateTrackerEntry(
  String source,
  String id,
  String name,
  String description,
) {
  final matches = parseTracker(source).where((e) => e.id == id).toList();
  if (matches.length != 1) {
    throw StateError(
      'Tracker entry could not be matched uniquely. Reload the tracker.',
    );
  }
  final entry = matches.single;
  return source.replaceRange(
    entry.start,
    entry.end,
    trackerBlock(id, name, description),
  );
}

String deleteTrackerEntry(String source, String id) {
  final matches = parseTracker(source).where((e) => e.id == id).toList();
  if (matches.length != 1) {
    throw StateError(
      'Tracker entry could not be matched uniquely. Reload the tracker.',
    );
  }
  return source.replaceRange(matches.single.start, matches.single.end, '');
}
