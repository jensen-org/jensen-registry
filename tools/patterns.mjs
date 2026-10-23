export class Untranslatable extends Error {}

const FIELD = {
  file: "path",
  lnum: "line",
  col: "column",
  end_lnum: "end_line",
  end_col: "end_column",
  severity: "severity",
  code: "code",
  message: "message",
};

const CLASS = {
  a: "A-Za-z",
  d: "0-9",
  l: "a-z",
  s: "\\s",
  u: "A-Z",
  w: "A-Za-z0-9",
  x: "A-Fa-f0-9",
  p: "!-\\/:-@\\[-`{-~",
  c: "\\x00-\\x1f\\x7f",
  g: "!-~",
};
const NEGATED = { S: "\\S", D: "\\D", W: "\\W" };

const escapeLiteral = (char) => (/[\\^$.|?*+()[\]{}\-/]/.test(char) ? `\\${char}` : char);

function luaSet(pattern, start) {
  let index = start + 1;
  let out = "[";
  if (pattern[index] === "^") {
    out += "^";
    index += 1;
  }
  let first = true;
  while (index < pattern.length && (pattern[index] !== "]" || first)) {
    first = false;
    const char = pattern[index];
    if (char === "%") {
      const next = pattern[index + 1];
      if (next in CLASS) out += CLASS[next];
      else if (next in NEGATED) out += NEGATED[next];
      else if (/[A-Z]/.test(next)) throw new Untranslatable(`%${next} inside a set`);
      else out += escapeLiteral(next);
      index += 2;
    } else if (char === "-" && out.length > 1 && pattern[index + 1] !== "]") {
      out += "-";
      index += 1;
    } else {
      out += char === "\\" || char === "[" || char === "]" ? `\\${char}` : char;
      index += 1;
    }
  }
  if (pattern[index] !== "]") throw new Untranslatable("unterminated set");
  return { text: `${out}]`, end: index + 1 };
}

export function luaPatternToRegex(pattern, names) {
  let out = "";
  let index = 0;
  let captures = 0;
  const open = [];
  while (index < pattern.length) {
    const char = pattern[index];
    let item = null;
    if (char === "^" && index === 0) {
      out += "^";
      index += 1;
      continue;
    }
    if (char === "$" && index === pattern.length - 1) {
      out += "$";
      index += 1;
      continue;
    }
    if (char === "(") {
      if (pattern[index + 1] === ")") throw new Untranslatable("position capture");
      const name = names?.[captures];
      captures += 1;
      open.push(captures);
      out += name ? `(?<${name}>` : "(";
      index += 1;
      continue;
    }
    if (char === ")") {
      if (!open.pop()) throw new Untranslatable("unbalanced capture");
      out += ")";
      index += 1;
      continue;
    }
    if (char === "%") {
      const next = pattern[index + 1];
      if (next === "b" || next === "f" || /\d/.test(next)) throw new Untranslatable(`%${next}`);
      if (next in CLASS) item = `[${CLASS[next]}]`;
      else if (next in NEGATED) item = NEGATED[next];
      else if (/[A-Z]/.test(next)) item = `[^${CLASS[next.toLowerCase()] ?? ""}]`;
      else item = escapeLiteral(next);
      index += 2;
    } else if (char === "[") {
      const set = luaSet(pattern, index);
      item = set.text;
      index = set.end;
    } else if (char === ".") {
      item = ".";
      index += 1;
    } else {
      item = escapeLiteral(char);
      index += 1;
    }
    const quantifier = pattern[index];
    if (quantifier === "*" || quantifier === "+" || quantifier === "?") {
      out += item + quantifier;
      index += 1;
    } else if (quantifier === "-") {
      out += `${item}*?`;
      index += 1;
    } else out += item;
  }
  if (open.length) throw new Untranslatable("unbalanced capture");
  if (names && captures !== names.length) throw new Untranslatable(`${captures} captures for ${names.length} names`);
  return out;
}

const EFM = { f: "path", l: "line", c: "column", e: "end_line", k: "end_column", m: "message", t: "severity", n: "code" };
const EFM_PATTERN = { path: ".+?", line: "\\d+", column: "\\d+", end_line: "\\d+", end_column: "\\d+", message: ".*", severity: "[A-Za-z]", code: "\\d+" };

function splitEfm(text) {
  const parts = [];
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\\" && text[index + 1] === ",") {
      current += ",";
      index += 1;
    } else if (text[index] === ",") {
      parts.push(current);
      current = "";
    } else current += text[index];
  }
  parts.push(current);
  return parts.filter(Boolean);
}

function efmToRegex(format) {
  let out = "^";
  const seen = new Set();
  for (let index = 0; index < format.length; index += 1) {
    const char = format[index];
    if (char !== "%") {
      out += escapeLiteral(char);
      continue;
    }
    const next = format[index + 1];
    index += 1;
    if (next === "%") out += "%";
    else if (next in EFM) {
      const name = EFM[next];
      if (seen.has(name)) throw new Untranslatable(`%${next} twice`);
      seen.add(name);
      out += `(?<${name}>${EFM_PATTERN[name]})`;
    } else if (next === "*" && format[index + 1] === "[") {
      const end = format.indexOf("]", index + 2);
      if (end < 0) throw new Untranslatable("unterminated %*[");
      out += `${format.slice(index + 1, end + 1)}*`;
      index = end;
    } else if (next === "." && format[index + 1] === "%" && format[index + 2] === "#") {
      out += ".*";
      index += 2;
    } else if (next === "\\" && format[index + 1] === "s" && format[index + 2] === "%" && format[index + 3] === "#") {
      out += "\\s*";
      index += 3;
    } else if (next === "\\" && format[index + 1] === "s" && format[index + 2] === "\\" && format[index + 3] === "+") {
      out += "\\s+";
      index += 3;
    } else throw new Untranslatable(`%${next}`);
  }
  return `${out}$`;
}

export function errorformatToPatterns(errorformat) {
  return splitEfm(errorformat).map(efmToRegex);
}

function severityMap(map) {
  if (!map || typeof map !== "object") return undefined;
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [String(key), value]));
}

export function translateParser(parser) {
  if (parser.parser === "pattern") {
    if (typeof parser.pattern !== "string" || !Array.isArray(parser.groups)) throw new Untranslatable("pattern or groups not literal");
    const names = parser.groups.map((group, position) => {
      if (group === "_") return `skip${position}`;
      if (!(group in FIELD)) throw new Untranslatable(`group ${group}`);
      return FIELD[group];
    });
    if (new Set(names).size !== names.length) throw new Untranslatable("repeated group");
    return {
      kind: "regex",
      patterns: [luaPatternToRegex(parser.pattern, names)],
      severity: severityMap(parser.severity),
      defaults: parser.defaults && typeof parser.defaults === "object" ? parser.defaults : undefined,
    };
  }
  if (typeof parser.errorformat !== "string") throw new Untranslatable("errorformat not literal");
  return { kind: "regex", patterns: errorformatToPatterns(parser.errorformat), defaults: parser.skeleton && typeof parser.skeleton === "object" ? parser.skeleton : undefined };
}
