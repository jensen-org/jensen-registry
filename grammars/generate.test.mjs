import assert from "node:assert/strict";
import test from "node:test";
import { generateImports, generateTags } from "./generate.mjs";

const nodeTypes = [
  { type: "function_definition", named: true, fields: { name: {}, body: {} } },
  { type: "class_declaration", named: true, fields: { name: {} } },
  { type: "struct_item", named: true, fields: { name: {} } },
  { type: "method_definition", named: true, fields: { name: {} } },
  { type: "variable_declaration", named: true, fields: { name: {} } },
  { type: "_hidden_definition", named: true, fields: { name: {} } },
  { type: "call_expression", named: true, fields: { function: {} } },
  { type: "import_statement", named: true, fields: { source: {} } },
  { type: "use_declaration", named: true, fields: { argument: {} } },
  { type: "import", named: true, fields: {} },
];

test("a definition node with a name field becomes a tag with the kind its type names", () => {
  const text = generateTags(nodeTypes);
  assert.match(text, /\(function_definition name: \(_\) @name\) @definition\.function/);
  assert.match(text, /\(class_declaration name: \(_\) @name\) @definition\.class/);
  assert.match(text, /\(struct_item name: \(_\) @name\) @definition\.type/);
  assert.match(text, /\(method_definition name: \(_\) @name\) @definition\.method/);
  assert.doesNotMatch(text, /variable_declaration|_hidden|call_expression/);
});

test("no definition nodes means no query at all rather than an empty one", () => {
  assert.equal(generateTags([{ type: "program", named: true, fields: {} }]), null);
});

test("an import node captures the field that names what is imported", () => {
  const text = generateImports(nodeTypes);
  assert.match(text, /\(import_statement source: \(_\) @import\)/);
  assert.match(text, /\(use_declaration argument: \(_\) @import\)/);
  assert.doesNotMatch(text, /\(import /);
});
