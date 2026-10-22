import luaparse from "luaparse";

export const MISSING = Symbol("unextractable");

const SEVERITY = { ERROR: 1, WARN: 2, INFO: 3, HINT: 4 };

export const HELPERS = {
  root_pattern: (args) => ({ root_markers: args.flat() }),
  root_file: (args) => ({ root_markers: args.flat() }),
  from_node_modules: (args) => (typeof args[0] === "string" ? args[0] : MISSING),
  exepath: (args) => (typeof args[0] === "string" ? { bin: args[0] } : MISSING),
  from_pattern: (args) => ({ parser: "pattern", pattern: args[0], groups: args[1], severity: args[2], defaults: args[3], opts: args[4] }),
  from_errorformat: (args) => ({ parser: "errorformat", errorformat: args[0], skeleton: args[1] }),
};

const dotted = (node) => {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") {
    const base = dotted(node.base);
    return base === null ? null : `${base}.${node.identifier.name}`;
  }
  return null;
};

const BUFFER_PATH = { "vim.api.nvim_buf_get_name": "{file}" };
const EXPAND = { "%": "{file}", "%:p": "{file}", "%:.": "{relative_file}", "%:p:h": "{dir}", "%:h": "{dir}" };

function bufferPath(node) {
  if (node.body.length !== 1 || node.body[0].type !== "ReturnStatement" || node.body[0].arguments.length !== 1) return null;
  const call = node.body[0].arguments[0];
  if (call.type !== "CallExpression") return null;
  const name = dotted(call.base);
  if (name in BUFFER_PATH) return BUFFER_PATH[name];
  const argument = call.arguments[0];
  if (name === "vim.fn.expand" && argument?.type === "StringLiteral") return EXPAND[stringValue(argument)] ?? null;
  return null;
}

export function stringValue(node) {
  if (typeof node.value === "string") return node.value;
  const long = /^\[(=*)\[\r?\n?([\s\S]*)\]\1\]$/.exec(node.raw);
  return long ? long[2] : node.raw.slice(1, -1);
}

function fallbackString(node, scope, run) {
  const last = node.body.at(-1);
  const result = last?.type === "ReturnStatement" ? last.arguments[0] : undefined;
  if (result?.type !== "LogicalExpression" || result.operator !== "or") return null;
  const value = run(result.right, scope, "", []);
  return typeof value === "string" ? value : null;
}

function rpcCommand(node, scope, run) {
  const local = new Map(scope);
  for (const statement of node.body) {
    if (statement.type === "LocalStatement") {
      statement.variables.forEach((variable, index) => {
        const init = statement.init[index];
        const seen = [];
        const value = init ? run(init, local, variable.name, seen) : MISSING;
        if (value !== MISSING && !seen.length) local.set(variable.name, value);
      });
    } else if (statement.type === "ReturnStatement") {
      const call = statement.arguments[0];
      if (call?.type !== "CallExpression" || dotted(call.base) !== "vim.lsp.rpc.start") return null;
      const seen = [];
      const value = run(call.arguments[0], local, "cmd", seen);
      return !seen.length && Array.isArray(value) && value.length && value.every((item) => typeof item === "string") ? value : null;
    }
  }
  return null;
}

function evaluator(helpers) {
  const run = (node, scope, path, misses) => {
    const miss = () => {
      misses.push(path);
      return MISSING;
    };
    const next = (child, label) => run(child, scope, label, misses);
    switch (node.type) {
      case "StringLiteral":
        return stringValue(node);
      case "NumericLiteral":
        return node.value;
      case "BooleanLiteral":
        return node.value;
      case "NilLiteral":
        return null;
      case "Identifier":
        return scope.has(node.name) ? scope.get(node.name) : miss();
      case "TableConstructorExpression": {
        const positional = node.fields.length > 0 && node.fields.every((field) => field.type === "TableValue");
        const out = positional ? [] : {};
        let index = 0;
        for (const field of node.fields) {
          let key;
          if (field.type === "TableValue") key = (index += 1) - 1;
          else if (field.type === "TableKeyString") key = field.key.name;
          else {
            key = next(field.key, path);
            if (key === MISSING) continue;
          }
          const label = path ? `${path}.${key}` : String(key);
          const value = run(field.value, scope, label, misses);
          if (value === MISSING) continue;
          if (positional) out.push(value);
          else out[key] = value;
        }
        return out;
      }
      case "BinaryExpression": {
        if (node.operator !== "..") return miss();
        const left = next(node.left, path);
        const right = next(node.right, path);
        if (left === MISSING || right === MISSING || typeof left === "object" || typeof right === "object") return miss();
        return `${left}${right}`;
      }
      case "LogicalExpression": {
        const left = next(node.left, path);
        if (node.operator === "or") return left !== MISSING && left !== null && left !== false ? left : next(node.right, path);
        return left === MISSING ? MISSING : left && left !== null ? next(node.right, path) : left;
      }
      case "UnaryExpression": {
        const value = next(node.argument, path);
        if (value === MISSING) return MISSING;
        if (node.operator === "-" && typeof value === "number") return -value;
        if (node.operator === "not") return !value;
        return miss();
      }
      case "MemberExpression": {
        const name = dotted(node);
        const severity = /^vim\.diagnostic\.severity\.(\w+)$/.exec(name ?? "");
        if (severity && severity[1] in SEVERITY) return SEVERITY[severity[1]];
        const base = next(node.base, path);
        if (base && typeof base === "object" && node.identifier.name in base) return base[node.identifier.name];
        return miss();
      }
      case "IndexExpression": {
        const base = next(node.base, path);
        const index = next(node.index, path);
        if (base && typeof base === "object" && index !== MISSING && index in base) return base[index];
        return miss();
      }
      case "CallExpression":
      case "StringCallExpression":
      case "TableCallExpression": {
        const name = dotted(node.base);
        const leaf = node.base.type === "MemberExpression" ? node.base.identifier.name : name;
        if (!leaf || !(leaf in helpers)) return miss();
        const raw = node.type === "CallExpression" ? node.arguments : [node.type === "StringCallExpression" ? node.argument : node.arguments];
        const args = raw.map((argument) => next(argument, path));
        const value = helpers[leaf](args.map((argument) => (argument === MISSING ? undefined : argument)));
        return value === MISSING ? miss() : value;
      }
      case "FunctionDeclaration":
        return bufferPath(node) ?? (path === "cmd" ? rpcCommand(node, scope, run) : null) ?? (/(^|\.)(cmd|command)$/.test(path) ? fallbackString(node, scope, run) : null) ?? miss();
      default:
        return miss();
    }
  };
  return run;
}

function assign(scope, target, value) {
  if (target.type === "Identifier") {
    scope.set(target.name, value);
    return;
  }
  const keys = [];
  let node = target;
  while (node.type === "MemberExpression" || node.type === "IndexExpression") {
    keys.unshift(node.type === "MemberExpression" ? node.identifier.name : node.index.value ?? node.index.raw?.slice(1, -1));
    node = node.base;
  }
  if (node.type !== "Identifier" || !scope.has(node.name)) return;
  let holder = scope.get(node.name);
  for (const key of keys.slice(0, -1)) {
    if (!holder || typeof holder !== "object") return;
    holder = holder[key] ??= {};
  }
  if (holder && typeof holder === "object") holder[keys.at(-1)] = value;
}

export function readModule(source, { helpers = HELPERS } = {}) {
  const chunk = luaparse.parse(source, { luaVersion: "LuaJIT", comments: false });
  const evaluate = evaluator(helpers);
  const scope = new Map();
  const misses = [];
  const localMisses = [];
  let value = MISSING;
  for (const statement of chunk.body) {
    if (statement.type === "LocalStatement") {
      statement.variables.forEach((variable, index) => {
        const init = statement.init[index];
        if (!init) return;
        const result = evaluate(init, scope, variable.name, localMisses);
        if (result !== MISSING) scope.set(variable.name, result);
      });
    } else if (statement.type === "AssignmentStatement") {
      statement.variables.forEach((variable, index) => {
        const init = statement.init[index];
        const label = variable.type === "MemberExpression" ? variable.identifier.name : variable.name ?? "";
        const result = init ? evaluate(init, scope, label, misses) : MISSING;
        if (result !== MISSING) assign(scope, variable, result);
      });
    } else if (statement.type === "ReturnStatement") {
      const argument = statement.arguments[0];
      value = argument ? evaluate(argument, scope, "", misses) : MISSING;
    }
  }
  return { value: value === MISSING ? undefined : value, misses, localMisses, scope };
}

export function dropShiftedArrays(value, misses) {
  if (!value || typeof value !== "object") return value;
  for (const key of Object.keys(value)) {
    if (Array.isArray(value[key]) && misses.some((path) => path.startsWith(`${key}.`))) delete value[key];
  }
  return value;
}
