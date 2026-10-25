import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { replayCanvas } from "../../src/canvas-format/index.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const event = (name, fields = {}) => ({ event: name, ...fields });
const header = (fields = {}) => event("canvas_created", { formatVersion: 1, canvasId: "test-canvas", widgets: [], ...fields });

test("compatible event fixture deterministically replays creation, move, resize, update and removal", () => {
  const source = fixture("valid.jsonl");
  const result = replayCanvas(source);
  assert.equal(result.status, "complete");
  assert.equal(result.canvasId, "design-review");
  assert.equal(result.formatVersion, 1);
  assert.deepEqual(result.state.widgets.map(({ id }) => id), ["note-1", "image-1", "prototype-1", "site-1"]);
  assert.deepEqual(result.placements[0], {
    id: "note-1",
    kind: "sticky-note",
    position: { x: 10, y: 20 },
    width: 320,
    height: 120,
    data: { width: 320, height: 120, text: "Updated note", tone: "blue", label: "Review note" },
    source: result.state.widgets[0],
  });
  assert.deepEqual(result.placements[1].position, { x: 440, y: 60 });
  assert.equal(result.placements[1].width, 520);
  assert.equal(result.placements[1].height, 320);
  assert.equal(result.records.length, 9);
  assert.equal(result.records.at(-1).applied, true);
  assert.equal(result.records[0].value.event, "canvas_created");
});

test("replay is deterministic and does not rewrite or mutate the input source", () => {
  const source = fixture("valid.jsonl");
  const first = replayCanvas(source);
  const second = replayCanvas(source);
  assert.deepEqual(first, second);
  assert.equal(source, fixture("valid.jsonl"));
});

test("unknown optional events and widget extensions are retained while playback continues", () => {
  const source = fixture("unknown-extension.jsonl");
  const result = replayCanvas(source);
  assert.equal(result.status, "complete");
  assert.equal(result.placements[0].kind, "future-widget");
  assert.equal(result.placements[0].source.vendorField, "retain");
  assert.deepEqual(result.placements[0].data.futurePayload, { keep: true });
  assert.equal(result.records[1].applied, false);
  assert.equal(result.records[1].value.extension.retain, true);
  assert.ok(result.diagnostics.some(({ code }) => code === "unknown-optional-event"));
});

test("unknown required events preserve the valid prefix and prevent complete playback", () => {
  const result = replayCanvas(fixture("unknown-required.jsonl"));
  assert.equal(result.status, "partial");
  assert.deepEqual(result.placements[0].position, { x: 4, y: 5 });
  assert.ok(result.diagnostics.some(({ code, line }) => code === "unknown-required-event" && line === 3));
  assert.equal(result.records[2].applied, false);
});

test("an incomplete final line reports the valid prefix without attempting repair", () => {
  const source = fixture("incomplete-tail.jsonl");
  const result = replayCanvas(source);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.placements[0].position, { x: 8, y: 9 });
  assert.equal(result.diagnostics.at(-1).code, "incomplete-record");
  assert.equal(result.diagnostics.at(-1).line, 3);
  assert.equal(result.records.at(-1).raw, '{"event":"widget_added","widget":{"id":"broken"');
  assert.equal(source.endsWith("\n"), false);
});

test("malformed interior lines stop replay with a line diagnostic", () => {
  const result = replayCanvas([JSON.stringify(header()), "{broken}", JSON.stringify(event("widget_added", { widget: { id: "later", type: "sticky-note" } }))].join("\n"));
  assert.equal(result.status, "partial");
  assert.equal(result.placements.length, 0);
  assert.equal(result.diagnostics[0].code, "malformed-json");
  assert.equal(result.diagnostics[0].line, 2);
});

test("unsupported versions and known-but-unimplemented events fail clearly", () => {
  const version = replayCanvas(`${JSON.stringify(header({ formatVersion: 3 }))}\n`);
  assert.equal(version.status, "invalid");
  assert.equal(version.formatVersion, 3);
  assert.equal(version.diagnostics[0].code, "unsupported-format-version");

  const layout = replayCanvas(`${JSON.stringify(header({ formatVersion: 2 }))}\n${JSON.stringify(event("canvas_layout_updated", {}))}\n`);
  assert.equal(layout.status, "partial");
  assert.equal(layout.diagnostics[0].code, "unsupported-event");
});

test("malformed header collections are diagnosed without throwing or exposing an applied header", () => {
  const malformedHeaders = [
    { connectors: null },
    { connectors: [null] },
    { connectors: [{ id: "c1", start: {}, end: { widgetId: "b" } }] },
    { widgets: "not-an-array" },
    { widgets: [null] },
    { sources: null },
    { canvasId: 7 },
    { formatVersion: "1" },
  ];
  for (const fields of malformedHeaders) {
    const result = replayCanvas(`${JSON.stringify(header({ widgets: [{ id: "a", type: "note" }], ...fields }))}\n`);
    assert.equal(result.status, "invalid");
    assert.ok(["invalid-event", "unsupported-format-version"].includes(result.diagnostics[0].code));
    assert.deepEqual(result.state.widgets, []);
    assert.deepEqual(result.placements, []);
    assert.equal(result.records[0].applied, false);
  }
});

test("malformed supported event payloads are diagnosed without throwing", () => {
  const malformedEvents = [
    event("widget_added", { widget: null }),
    event("widget_updated", { widgetId: "a", props: null }),
    event("widget_moved", { widgetId: "a", position: null }),
    event("widget_removed", { widget: null }),
  ];
  for (const invalid of malformedEvents) {
    const result = replayCanvas(`${JSON.stringify(header())}\n${JSON.stringify(invalid)}\n`);
    assert.equal(result.status, "partial");
    assert.equal(result.diagnostics[0].code, "invalid-event");
    assert.equal(result.records.at(-1).applied, false);
  }
});

test("invalid required flags are rejected before optional-event handling", () => {
  for (const value of ["true", 1, null]) {
    const result = replayCanvas(`${JSON.stringify(header())}\n${JSON.stringify(event("vendor_annotation", { required: value }))}\n`);
    assert.equal(result.status, "partial");
    assert.equal(result.diagnostics[0].code, "invalid-event");
    assert.match(result.diagnostics[0].message, /required must be a boolean/);
  }
});

test("duplicate initial widget IDs leave the header unapplied and state empty", () => {
  const result = replayCanvas(`${JSON.stringify(header({ widgets: [{ id: "same" }, { id: "same" }] }))}\n`);
  assert.equal(result.status, "invalid");
  assert.equal(result.diagnostics[0].code, "replay-conflict");
  assert.deepEqual(result.state.widgets, []);
  assert.deepEqual(result.placements, []);
  assert.equal(result.records[0].applied, false);
});

test("valid initial connectors are retained and safely detached when a widget is removed", () => {
  const result = replayCanvas(`${JSON.stringify(header({
    widgets: [{ id: "a" }, { id: "b" }],
    connectors: [{ id: "edge", start: { widgetId: "a" }, end: { widgetId: "b" } }],
  }))}\n${JSON.stringify(event("widget_removed", { widgetId: "a" }))}\n`);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.state.connectors, []);
});

test("invalid widgets, duplicate IDs, and edits to missing widgets stop replay", () => {
  const invalid = replayCanvas(`${JSON.stringify(header({ widgets: [{ id: "bad", type: "note", position: { x: NaN, y: 0 } }] }))}\n`);
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.diagnostics[0].code, "invalid-event");

  const duplicate = replayCanvas(`${JSON.stringify(header({ widgets: [{ id: "same", type: "note" }] }))}\n${JSON.stringify(event("widget_added", { widget: { id: "same", type: "note" } }))}\n`);
  assert.equal(duplicate.status, "partial");
  assert.equal(duplicate.diagnostics[0].code, "replay-conflict");

  const missing = replayCanvas(`${JSON.stringify(header())}\n${JSON.stringify(event("widget_moved", { widgetId: "absent", position: { x: 2, y: 3 } }))}\n`);
  assert.equal(missing.status, "partial");
  assert.equal(missing.diagnostics[0].code, "replay-conflict");
});

test("legacy streams replay without deriving identity from file names", () => {
  const result = replayCanvas(`${JSON.stringify(event("canvas_created", { widgets: [] }))}\n`);
  assert.equal(result.status, "complete");
  assert.equal(result.canvasId, undefined);
  assert.ok(result.diagnostics.some(({ code }) => code === "missing-canvas-id"));
});

test("legacy widgets without a type and removal records carrying the widget remain readable", () => {
  const result = replayCanvas(`${JSON.stringify(header({ widgets: [{ id: "legacy" }] }))}\n${JSON.stringify(event("widget_removed", { widget: { id: "legacy" } }))}\n`);
  assert.equal(result.status, "complete");
  assert.equal(result.placements.length, 0);
});

test("placement IDs cannot be reused after removal", () => {
  const source = [
    header({ widgets: [{ id: "one", type: "sticky-note" }] }),
    event("widget_removed", { widgetId: "one" }),
    event("widget_added", { widget: { id: "one", type: "sticky-note" } }),
  ].map(JSON.stringify).join("\n");
  const result = replayCanvas(source);
  assert.equal(result.status, "partial");
  assert.equal(result.diagnostics[0].code, "replay-conflict");
});
