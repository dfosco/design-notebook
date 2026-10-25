# Canvas JSONL format, first-look subset

The canvas is a direct-edit JSONL file at `name.canvas/name.canvas.jsonl`. Each non-empty line is one JSON event, replayed in file order. Writers are editors or agents changing the file itself. The reader does not append, rewrite, repair, compact, or persist changes. There is no canvas mutation API or authoring command-line interface.

This first-look format keeps the established event envelope used by existing canvas documents: the first event is `canvas_created`, followed by events such as `widget_added`, `widget_moved`, `widget_updated`, and `widget_removed`. It does not introduce a new header/operation envelope. The first-look subset uses the existing `formatVersion: 1`; `canvasId` is an additive field on `canvas_created` and provides stable identity when a canvas is moved or renamed. Legacy events without `canvasId` still replay, with a warning. Discovery must report the missing stable identity; it must not invent an ID from the path.

The schema for the supported first-look event subset is [v1.schema.json](../../schemas/canvas/v1.schema.json). It accepts extension fields on known events and widgets. It does not claim support for every event or feature in other canvas readers. In particular, format-v2 layout snapshots and the other defined canvas events are recognized as outside this reader's subset and stop replay with a diagnostic rather than being silently skipped. The event-level `required` marker, when present, must be a boolean. Initial connectors must have an ID and widget references at both ends, so later widget removal can safely detach them.

## Header and widget records

A new first-look document starts with a `canvas_created` event. For example:

```json
{"event":"canvas_created","formatVersion":1,"canvasId":"design-review","widgets":[],"sources":[],"connectors":[]}
```

`canvasId` is a non-empty authored ID, unique within the notebook. It belongs in this existing header event. A separate canvas descriptor is not required, and the canvas ID is not duplicated in another header field. Older documents may omit `formatVersion` or `canvasId`; the reader accepts the legacy stream and warns if the ID is absent.

Widgets are persisted in `canvas_created.widgets` or added later with `widget_added`. Existing widget records require an `id`; they commonly include `type`, optional `position`, and optional `props`. This reader keeps that event-format permissiveness, including legacy widgets with no type. The `props` object holds type-specific content, including width and height when set. Unknown or missing widget types and extra fields are retained in the materialized record. A client may diagnose a type it cannot render while preserving it for other clients.

The first-look Tiny Canvas viewer recognizes an optional text fallback for an otherwise unknown widget type: `props.fallback` may be `{ "type": "text", "text": "..." }`. This is an optional widget-props convention; it does not add a JSONL event or constrain the permissive `props` schema. The viewer displays the text literally, labels it as a fallback for an unsupported widget, and preserves the original widget ID and geometry. It does not interpret HTML/MDX or execute fallback content. Missing, malformed, or other fallback shapes remain visibly unavailable with a diagnostic. For example:

```json
{"event":"widget_added","widget":{"id":"chart-1","type":"chart","position":{"x":24,"y":32},"props":{"width":420,"height":240,"fallback":{"type":"text","text":"Chart preview unavailable. Open the source report for the full chart."}}}}
```

## Supported changes

The reader applies this first-look event subset:

| Event | Fields | Effect |
| --- | --- | --- |
| `canvas_created` | `formatVersion`, `canvasId`, initial `widgets` and optional document fields | Starts replay with the initial document state. |
| `widget_added` | `widget` | Adds a new widget with a never-before-used ID. |
| `widget_moved` | `widgetId`, `position: {x, y}` | Replaces its position. |
| `widget_updated` | `widgetId`, `props` | Shallowly merges props. Set `width` and `height` here to resize. |
| `widget_removed` | `widgetId` | Removes the widget. Its ID remains reserved for this stream. |

These are the existing event names and field shapes. For example, moving and resizing a widget can be recorded as:

```json
{"event":"widget_moved","widgetId":"note-1","position":{"x":80,"y":120}}
{"event":"widget_updated","widgetId":"note-1","props":{"width":320,"height":180}}
```

An update preserves unspecified props. Create, move, update, or removal events that refer to an invalid or missing widget stop replay at that line. IDs are opaque, case-sensitive strings. IDs cannot be reused after removal. Replay is deterministic and does not infer undo from event metadata.

Prototype and site widgets refer to notebook artifacts through their ordinary widget props. The pure reader does not resolve or execute these targets. Discovery, the runtime boundary, and the client handle those separate concerns.

## Compatibility and unsupported records

`formatVersion: 1` is the supported first-look format version. Version 2 is part of the broader event format, but its layout snapshot events are outside this subset. If a known event such as `canvas_layout_updated`, `settings_updated`, or a connector event appears, replay stops with `unsupported-event` rather than producing a state that silently omits its effect. Unknown events with `required: true` stop replay with `unknown-required-event`. Unknown events without `required: true` are treated as optional, retained in the raw record list, warned about, and skipped.

This behavior keeps the event stream extensible while distinguishing unknown optional annotations from events that this implementation cannot safely fold. The reader never rewrites unfamiliar data. A client may display the valid prefix after an error, but it must label it partial and must not present it as the complete document.

## Reader result and diagnostics

`replayCanvas(sourceText)` from [src/canvas-format/index.js](../../src/canvas-format/index.js) returns:

- `status`: `complete`, `partial`, or `invalid`.
- `canvasId` and `formatVersion`, when present in the header.
- `state`: the event-format document after replay, including widgets, sources, connectors, and other initial document fields.
- `placements`: a normalized widget projection for scene/rendering work. Each entry has `id`, `kind` (the source widget `type`), optional `position`, optional width and height, `data` (widget props), and `source` (the materialized widget). This projection does not replace or rewrite wire records.
- `diagnostics`: stable code, severity, one-based line, and explanation.
- `records`: parsed event records with their exact raw line, source line, and `supported`/`applied` flags. Unknown optional records are retained here.

`complete` means every required event was understood and applied. `partial` means replay stopped after a valid header and may include the successfully materialized prefix. `invalid` means replay could not establish a valid starting event. A malformed final JSON line without a terminating newline is reported as `incomplete-record`; malformed interior JSON is `malformed-json`. Blank lines are ignored. A valid final JSON event does not need a trailing newline.

## File editing and failure handling

The intended first-look workflow is one editor or agent writing a canvas file at a time. Append complete, newline-terminated event records and preserve the existing header and history. If an append is interrupted, the reader reports the valid prefix and malformed tail; the author must inspect and fix the source before continuing. The format does not provide locking, transactions across files, concurrent-writer conflict resolution, or automatic repair.

The fixtures cover compatible `canvas_created` and widget events, create/move/resize/update/remove behavior, extension preservation, unknown optional and required events, legacy missing identity, unsupported events and versions, replay conflicts, and an incomplete tail. See [replay.test.js](../../tests/canvas-format/replay.test.js) for executable behavior checks.
