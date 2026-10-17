function satisfiable(server, entry) {
  const required = (server.env ?? []).filter((variable) => !variable.optional).map((variable) => variable.name);
  return entry.auth.some((auth) => {
    if (auth.method === "oauth") return Boolean(server.oauth);
    if (server.oauth) return false;
    if (auth.method === "api_key") {
      const names = new Set((auth.fields ?? []).map((field) => field.name));
      return required.every((name) => names.has(name));
    }
    return auth.method === "none" && required.length === 0;
  });
}

export const serving = (integrationId, mcpEntries) =>
  mcpEntries.map(({ entry }) => entry).filter((server) => (server.serves ?? []).includes(integrationId));

export function integrationProblems(entry, label, mcpEntries) {
  const problems = [];
  const methods = new Set(entry.auth.map((auth) => auth.method));
  if (methods.size !== entry.auth.length) problems.push(`${label}: an auth method is listed twice`);
  for (const auth of entry.auth) {
    if ((auth.fields ?? []).some((field) => field.from)) problems.push(`${label}: a credential field cannot take its value from the machine`);
    if (auth.method === "api_key" && !(auth.fields ?? []).some((field) => field.secret)) {
      problems.push(`${label}: api_key needs at least one secret field`);
    }
    if (auth.method !== "api_key" && auth.fields?.length) problems.push(`${label}: only api_key takes fields`);
    if (auth.method === "cli_login" && !entry.native) problems.push(`${label}: cli_login needs a native protocol that knows the binary`);
  }
  const servers = serving(entry.id, mcpEntries);
  for (const server of servers) {
    if (!satisfiable(server, entry)) problems.push(`${label}: no auth method can satisfy mcp server ${server.id}, which serves it`);
  }
  if (entry.default_mcp && !servers.some((server) => server.id === entry.default_mcp)) {
    problems.push(`${label}: default_mcp ${entry.default_mcp} is not an mcp server that serves ${entry.id}`);
  }
  if (entry.default_on) {
    if (!entry.auth.every((auth) => auth.method === "none")) {
      problems.push(`${label}: default_on is only for an integration that needs no credentials`);
    }
    if (!entry.default_mcp) problems.push(`${label}: default_on needs a default_mcp`);
  }
  const actions = (entry.permissions ?? []).map((permission) => permission.action);
  if (new Set(actions).size !== actions.length) problems.push(`${label}: a permission action is listed twice`);
  return problems;
}

export function skillProblems(entry, label, skillIds) {
  return (entry.skills ?? [])
    .filter((id) => !skillIds.has(id))
    .map((id) => `${label}: skill ${id} has no entry in skills/`);
}

export function servesProblems(mcpEntries, integrationIds) {
  const problems = [];
  for (const { path, entry } of mcpEntries) {
    for (const id of entry.serves ?? []) {
      if (!integrationIds.has(id)) problems.push(`${path}: serves ${id}, which has no entry in integrations/`);
    }
  }
  return problems;
}
