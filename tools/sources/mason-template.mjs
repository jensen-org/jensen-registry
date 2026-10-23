export class TemplateMiss extends Error {}

const split = (text, separator) => {
  const parts = [];
  let quote = null;
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part, index, all) => part !== "" || all.length === 1);
};

const literal = (text) => {
  const match = /^(["'])(.*)\1$/s.exec(text);
  return match ? match[2] : undefined;
};

const platformMatches = (targets, wanted) =>
  targets.length > 0 &&
  targets.every((target) => {
    if (wanted === "unix") return target === "unix" || target.startsWith("linux") || target.startsWith("darwin");
    return target === wanted || target.startsWith(`${wanted}_`);
  });

function lookup(path, context) {
  let value = context;
  const keys = path.split(".");
  for (const [index, key] of keys.entries()) {
    if (value !== null && typeof value === "object" && !(key in value) && index === keys.length - 1 && keys[0] === "source" && index >= 2) return "";
    if (value === null || typeof value !== "object" || !(key in value)) throw new TemplateMiss(`unknown ${path}`);
    value = value[key];
  }
  if (typeof value !== "string") throw new TemplateMiss(`${path} is not a string`);
  return value;
}

function call(text, value) {
  const match = /^(\w+)\((.*)\)$/s.exec(text);
  if (!match) throw new TemplateMiss(`unsupported filter ${text}`);
  return { name: match[1], args: split(match[2], ",") };
}

function applyFilter(text, value, context) {
  const bare = /^(\w+)(?:\s+(.*))?$/s.exec(text);
  if (bare && (bare[1] === "strip_prefix" || bare[1] === "strip_suffix")) {
    const argument = literal(bare[2] ?? "");
    if (argument === undefined || value === null) throw new TemplateMiss(`unsupported filter ${text}`);
    if (bare[1] === "strip_prefix") return value.startsWith(argument) ? value.slice(argument.length) : value;
    return value.endsWith(argument) ? value.slice(0, -argument.length) : value;
  }
  const { name, args } = call(text);
  if (name !== "take_if" && name !== "take_if_not") throw new TemplateMiss(`unsupported filter ${text}`);
  const platform = /^is_platform\((["'])(\w+)\1\)$/.exec(args[0] ?? "");
  if (!platform) throw new TemplateMiss(`unsupported filter ${text}`);
  const targets = context.__targets ?? [];
  const matches = platformMatches(targets, platform[2]);
  const keep = name === "take_if" ? matches : !matches;
  const replacement = args[1] === undefined ? value : literal(args[1]);
  if (replacement === undefined) throw new TemplateMiss(`unsupported filter ${text}`);
  return keep ? (args[1] === undefined ? value : replacement) : null;
}

function evaluate(expression, context) {
  const cleaned = expression.replace(/^\{+/, "").replace(/\|\|/g, "|").trim();
  const [head, ...filters] = split(cleaned, "|");
  let value;
  const direct = literal(head);
  if (direct !== undefined) value = direct;
  else {
    const call = /^(\w+)\(/.exec(head);
    if (call) {
      value = "";
      filters.unshift(head);
    } else value = lookup(head, context);
  }
  for (const filter of filters) {
    value = applyFilter(filter, value, context);
  }
  return value;
}

export function resolveString(text, context) {
  if (!text.includes("{{")) return text;
  let dropped = false;
  const resolved = text.replace(/\{\{(.*?)\}\}/gs, (_, expression) => {
    const value = evaluate(expression, context);
    if (value === null) {
      dropped = true;
      return "";
    }
    return value;
  });
  return dropped && resolved === "" ? null : resolved;
}

export function resolveDeep(value, context, miss) {
  if (typeof value === "string") {
    try {
      return resolveString(value, context);
    } catch (error) {
      if (!(error instanceof TemplateMiss)) throw error;
      miss(`${value}: ${error.message}`);
      return undefined;
    }
  }
  if (Array.isArray(value)) return value.map((item) => resolveDeep(item, context, miss)).filter((item) => item !== undefined && item !== null);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const resolved = resolveDeep(item, context, miss);
      if (resolved !== undefined && resolved !== null) out[key] = resolved;
    }
    return out;
  }
  return value;
}
