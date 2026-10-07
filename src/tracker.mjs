const startPattern = /^<!-- assisted-writer-entry:([a-f0-9-]+) -->$/gm;
const endMarker = "<!-- /assisted-writer-entry -->";

export function parseTracker(source) {
  const entries = [];
  for (const match of source.matchAll(startPattern)) {
    const start = match.index;
    const bodyStart = start + match[0].length;
    const close = source.indexOf(endMarker, bodyStart);
    if (close < 0 || (entries.length && start < entries.at(-1).end)) continue;
    const body = source.slice(bodyStart, close).trim();
    const heading = /^## ([^\n]+)(?:\n|$)/.exec(body);
    if (!heading) continue;
    entries.push({
      id: match[1],
      name: heading[1].trim(),
      description: body.slice(heading[0].length).trim(),
      start,
      end: close + endMarker.length,
    });
  }
  const segments = [];
  let previous = 0;
  for (const entry of entries) {
    segments.push({ start: previous, end: entry.start, text: source.slice(previous, entry.start) });
    previous = entry.end;
  }
  segments.push({ start: previous, end: source.length, text: source.slice(previous) });
  return { entries, segments };
}

function entryMarkdown({ id, name, description }) {
  const safeName = String(name || "Untitled").trim().replace(/[\r\n]+/g, " ") || "Untitled";
  return `<!-- assisted-writer-entry:${id} -->\n## ${safeName}\n\n${String(description || "").trim()}\n\n${endMarker}`;
}

export function addTrackerEntry(source, id, name) {
  if (!/^[a-f0-9-]{8,}$/.test(id)) throw new Error("Invalid tracker entry ID.");
  return `${source.trimEnd()}\n\n${entryMarkdown({ id, name, description: "" })}\n`;
}

export function updateTrackerEntry(source, id, values) {
  const entry = parseTracker(source).entries.find((item) => item.id === id);
  if (!entry) throw new Error("Tracker entry not found.");
  const next = entryMarkdown({ ...entry, ...values, id });
  return source.slice(0, entry.start) + next + source.slice(entry.end);
}

export function deleteTrackerEntry(source, id) {
  const entry = parseTracker(source).entries.find((item) => item.id === id);
  if (!entry) throw new Error("Tracker entry not found.");
  return source.slice(0, entry.start) + source.slice(entry.end);
}

export function updateTrackerSegment(source, start, end, text) {
  if (start < 0 || end < start || end > source.length) throw new Error("Invalid tracker text range.");
  return source.slice(0, start) + text + source.slice(end);
}
