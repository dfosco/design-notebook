import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

let Ajv2020;
try {
  ({ default: Ajv2020 } = await import("ajv/dist/2020.js"));
} catch {
  // The package owner supplies Ajv as a development dependency.
}

const schema = JSON.parse(readFileSync(new URL("../../schemas/canvas/v1.schema.json", import.meta.url), "utf8"));
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("canvas event schema validates supported records and rejects events outside its subset", {
  skip: !Ajv2020 && "Ajv draft-2020-12 validator is not installed in this workspace",
}, () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);
  const supported = ["valid.jsonl", "unknown-extension.jsonl", "incomplete-tail.jsonl"];
  for (const name of supported) {
    for (const line of fixture(name).split(/\r?\n/).filter(Boolean)) {
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      assert.equal(validate(record), true, `${name}: ${JSON.stringify(record)}: ${ajv.errorsText(validate.errors)}`);
    }
  }

  const unsupported = [
    { event: "canvas_layout_updated", required: false },
    { event: "canvas_layout_updated", required: true },
    { event: "vendor_required", required: true },
    { event: "vendor_optional", required: "true" },
    { event: "canvas_created", formatVersion: 1, widgets: [], connectors: [null] },
  ];
  for (const record of unsupported) {
    assert.equal(validate(record), false, `${JSON.stringify(record)} should be outside the supported schema`);
  }
});
