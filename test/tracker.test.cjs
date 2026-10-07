const test = require("node:test");
const assert = require("node:assert/strict");

test("named tracker entries preserve existing Markdown around them", async () => {
  const { addTrackerEntry, parseTracker, updateTrackerEntry,
    deleteTrackerEntry, updateTrackerSegment } = await import("../src/tracker.mjs");
  const original = "# Characters\n\n- Monster name: Ogee\n- Monster description: River creature.\n";
  const firstId = "11111111-1111-4111-8111-111111111111";
  const secondId = "22222222-2222-4222-8222-222222222222";
  let markdown = addTrackerEntry(original, firstId, "Mara");
  markdown = addTrackerEntry(markdown, secondId, "The Ferryman");
  assert.match(markdown, /^# Characters\n\n- Monster name: Ogee/m);
  assert.deepEqual(parseTracker(markdown).entries.map((entry) => entry.name), ["Mara", "The Ferryman"]);
  markdown = updateTrackerEntry(markdown, firstId,
    { name: "Mara Vale", description: "**Keeps a secret.**\n\n### Motivation\nProtect her brother." });
  assert.match(markdown, /## Mara Vale\n\n\*\*Keeps a secret\.\*\*/);
  assert.match(markdown, /### Motivation/);
  assert.match(markdown, /## The Ferryman/);
  const prefix = parseTracker(markdown).segments[0];
  markdown = updateTrackerSegment(markdown, prefix.start, prefix.end,
    prefix.text.replace("River creature", "Ancient river creature"));
  assert.match(markdown, /Ancient river creature/);
  markdown = deleteTrackerEntry(markdown, secondId);
  assert.deepEqual(parseTracker(markdown).entries.map((entry) => entry.name), ["Mara Vale"]);
  assert.match(markdown, /Monster name: Ogee/);
});
