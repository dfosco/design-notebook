const SUPPORTED_FORMAT_VERSIONS = new Set([1, 2]);
const FIRST_LOOK_EVENTS = new Set([
  "canvas_created",
  "widget_added",
  "widget_updated",
  "widget_moved",
  "widget_removed",
]);
const KNOWN_BUT_UNSUPPORTED_EVENTS = new Set([
  "settings_updated",
  "source_updated",
  "widgets_replaced",
  "connector_added",
  "connector_removed",
  "connectors_replaced",
  "connector_waypoints_set",
  "connector_waypoints_cleared",
  "connector_updated",
  "canvas_layout_updated",
  "canvas_layout_restored",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function diagnostic(code, severity, line, message) {
  return { code, severity, line, message };
}

function widgetError(widget) {
  if (!isRecord(widget)) return "widget must be an object";
  if (!nonEmpty(widget.id)) return "widget.id must be a non-empty string";
  if (widget.type !== undefined && !nonEmpty(widget.type)) return "widget.type must be a non-empty string when present";
  if (widget.position !== undefined && (!isRecord(widget.position) ||
      (widget.position.x !== undefined && !finite(widget.position.x)) ||
      (widget.position.y !== undefined && !finite(widget.position.y)))) {
    return "widget.position coordinates must be finite numbers";
  }
  if (widget.props !== undefined && widget.props !== null && !isRecord(widget.props)) {
    return "widget.props must be an object or null";
  }
  return null;
}

function connectorError(connector) {
  if (!isRecord(connector)) return "connector must be an object";
  if (!nonEmpty(connector.id)) return "connector.id must be a non-empty string";
  if (!isRecord(connector.start) || !nonEmpty(connector.start.widgetId)) return "connector.start.widgetId must be a non-empty string";
  if (!isRecord(connector.end) || !nonEmpty(connector.end.widgetId)) return "connector.end.widgetId must be a non-empty string";
  return null;
}

function eventError(event) {
  switch (event.event) {
    case "canvas_created":
      if (event.formatVersion !== undefined && !SUPPORTED_FORMAT_VERSIONS.has(event.formatVersion)) {
        return `Unsupported canvas formatVersion: ${String(event.formatVersion)}`;
      }
      if (event.canvasId !== undefined && !nonEmpty(event.canvasId)) return "canvasId must be a non-empty string";
      if (event.widgets !== undefined && (!Array.isArray(event.widgets) || event.widgets.some((widget) => widgetError(widget)))) {
        return "canvas_created.widgets must contain valid widget records";
      }
      if (event.sources !== undefined && !Array.isArray(event.sources)) return "canvas_created.sources must be an array";
      if (event.connectors !== undefined && (!Array.isArray(event.connectors) || event.connectors.some(connectorError))) {
        return "canvas_created.connectors must contain valid connector records";
      }
      return null;
    case "widget_added":
      return widgetError(event.widget);
    case "widget_updated":
      if (!nonEmpty(event.widgetId)) return "widgetId must be a non-empty string";
      if (!isRecord(event.props)) return "props must be an object";
      return null;
    case "widget_moved":
      if (!nonEmpty(event.widgetId)) return "widgetId must be a non-empty string";
      if (!isRecord(event.position) || !finite(event.position.x) || !finite(event.position.y)) {
        return "position must contain finite x and y values";
      }
      return null;
    case "widget_removed": {
      if (event.widget !== undefined) {
        const invalidWidget = widgetError(event.widget);
        if (invalidWidget) return `widget_removed.widget ${invalidWidget}`;
      }
      return nonEmpty(event.widgetId) || (isRecord(event.widget) && nonEmpty(event.widget.id))
        ? null
        : "widget_removed requires widgetId or widget.id";
    }
    default:
      return null;
  }
}

function normalizePlacements(widgets) {
  return widgets.map((widget) => ({
    id: widget.id,
    kind: widget.type,
    position: widget.position ? { ...widget.position } : undefined,
    ...(finite(widget.props?.width) ? { width: widget.props.width } : {}),
    ...(finite(widget.props?.height) ? { height: widget.props.height } : {}),
    data: isRecord(widget.props) ? { ...widget.props } : {},
    source: widget,
  }));
}

/**
 * Parse and replay the supported event-based canvas JSONL subset. The source
 * stream is never rewritten. Scene placements are a projection of materialized
 * widgets and do not replace the persisted event records.
 */
export function replayCanvas(sourceText) {
  const result = {
    status: "invalid",
    canvasId: undefined,
    formatVersion: undefined,
    state: { widgets: [], sources: [], connectors: [] },
    placements: [],
    diagnostics: [],
    records: [],
  };

  if (typeof sourceText !== "string") {
    result.diagnostics.push(diagnostic("invalid-source", "error", 0, "Canvas source must be a string"));
    return result;
  }

  const lines = sourceText.split(/\r?\n/);
  let created = false;
  let stopped = false;
  let sawRecord = false;
  const seenWidgetIds = new Set();
  const widgets = [];
  const sources = [];
  const connectors = [];
  const state = {};

  const stop = (code, line, message, status = created ? "partial" : "invalid") => {
    result.diagnostics.push(diagnostic(code, "error", line, message));
    result.status = status;
    stopped = true;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = index + 1;
    if (raw.trim() === "") continue;
    sawRecord = true;

    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      const isUnterminatedTail = index === lines.length - 1 && !sourceText.endsWith("\n");
      result.records.push({ line, raw, value: null, supported: false, applied: false });
      stop(isUnterminatedTail ? "incomplete-record" : "malformed-json", line,
        isUnterminatedTail ? "Final line is not a complete JSON event" : "Line is not a valid JSON event");
      break;
    }

    if (!isRecord(value) || !nonEmpty(value.event)) {
      result.records.push({ line, raw, value, supported: false, applied: false });
      stop("invalid-record", line, "Each JSONL record must be an event object with a non-empty event name");
      break;
    }

    if (value.required !== undefined && typeof value.required !== "boolean") {
      result.records.push({ line, raw, value, supported: FIRST_LOOK_EVENTS.has(value.event), applied: false });
      stop("invalid-event", line, "required must be a boolean when present");
      break;
    }

    if (!created && value.event !== "canvas_created") {
      result.records.push({ line, raw, value, supported: false, applied: false });
      stop("missing-header", line, "The first event must be canvas_created");
      break;
    }
    if (created && value.event === "canvas_created") {
      result.records.push({ line, raw, value, supported: false, applied: false });
      stop("duplicate-header", line, "canvas_created may appear only once");
      break;
    }

    if (value.event === "canvas_created") {
      result.canvasId = value.canvasId;
      result.formatVersion = value.formatVersion;
    }

    if (!FIRST_LOOK_EVENTS.has(value.event)) {
      result.records.push({ line, raw, value, supported: false, applied: false });
      if (KNOWN_BUT_UNSUPPORTED_EVENTS.has(value.event)) {
        stop("unsupported-event", line, `Canvas event is defined by the event format but outside this reader's supported subset: ${value.event}`);
        break;
      }
      if (value.required === true) {
        stop("unknown-required-event", line, `Unsupported required canvas event: ${value.event}`);
        break;
      }
      result.diagnostics.push(diagnostic("unknown-optional-event", "warning", line,
        `Unknown optional canvas event was preserved and skipped: ${value.event}`));
      continue;
    }

    const validationError = eventError(value);
    if (validationError) {
      result.records.push({ line, raw, value, supported: true, applied: false });
      const code = value.event === "canvas_created" && validationError.startsWith("Unsupported canvas formatVersion")
        ? "unsupported-format-version"
        : "invalid-event";
      stop(code, line, validationError, value.event === "canvas_created" ? "invalid" : "partial");
      break;
    }

    let applyError = null;
    switch (value.event) {
      case "canvas_created": {
        const initial = { ...value };
        delete initial.event;
        delete initial.timestamp;
        delete initial.formatVersion;
        const initialWidgets = (value.widgets || []).map((widget) => ({ ...widget, ...(isRecord(widget.props) ? { props: { ...widget.props } } : {}) }));
        const initialIds = new Set();
        for (const widget of initialWidgets) {
          if (initialIds.has(widget.id)) { applyError = `Duplicate widget ID in canvas_created: ${widget.id}`; break; }
          initialIds.add(widget.id);
        }
        if (!applyError) {
          Object.assign(state, initial);
          widgets.push(...initialWidgets);
          for (const id of initialIds) seenWidgetIds.add(id);
          sources.push(...(value.sources || []));
          connectors.push(...(value.connectors || []));
          created = true;
          result.canvasId = value.canvasId;
          result.formatVersion = value.formatVersion;
          if (!value.canvasId) result.diagnostics.push(diagnostic("missing-canvas-id", "warning", line,
            "Legacy canvas has no stable canvasId; discovery must diagnose it and must not derive one from the path"));
        }
        break;
      }
      case "widget_added": {
        const widget = value.widget;
        if (seenWidgetIds.has(widget.id)) applyError = `Widget ID cannot be reused: ${widget.id}`;
        else {
          seenWidgetIds.add(widget.id);
          widgets.push({ ...widget, ...(isRecord(widget.props) ? { props: { ...widget.props } } : {}) });
        }
        break;
      }
      case "widget_updated": {
        const widget = widgets.find((candidate) => candidate.id === value.widgetId);
        if (!widget) applyError = `Cannot update missing widget: ${value.widgetId}`;
        else widget.props = { ...(isRecord(widget.props) ? widget.props : {}), ...value.props };
        break;
      }
      case "widget_moved": {
        const widget = widgets.find((candidate) => candidate.id === value.widgetId);
        if (!widget) applyError = `Cannot move missing widget: ${value.widgetId}`;
        else widget.position = { ...value.position };
        break;
      }
      case "widget_removed": {
        const removedId = value.widget?.id ?? value.widgetId;
        const at = widgets.findIndex((candidate) => candidate.id === removedId);
        if (at < 0) applyError = `Cannot remove missing widget: ${removedId}`;
        else {
          widgets.splice(at, 1);
          for (let connectorIndex = connectors.length - 1; connectorIndex >= 0; connectorIndex -= 1) {
            const connector = connectors[connectorIndex];
            if (connector.start?.widgetId === removedId || connector.end?.widgetId === removedId) connectors.splice(connectorIndex, 1);
          }
        }
        break;
      }
    }

    if (applyError) {
      result.records.push({ line, raw, value, supported: true, applied: false });
      stop("replay-conflict", line, applyError);
      break;
    }

    result.records.push({ line, raw, value, supported: true, applied: true });
  }

  if (!stopped && !created) {
    stop("missing-header", sawRecord ? 1 : 0, "Canvas document has no canvas_created event", "invalid");
  } else if (!stopped) {
    result.status = "complete";
  }

  result.state = { ...state, widgets, sources, connectors };
  result.placements = normalizePlacements(widgets);
  return result;
}

export const canvasFormat = Object.freeze({ formatVersions: Object.freeze([1, 2]), events: Object.freeze([...FIRST_LOOK_EVENTS]) });
