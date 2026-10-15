const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
  "upgrade",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "mcp-session-id",
]);

export function mcpProblems(entry, label) {
  const problems = [];
  const env = new Map((entry.env ?? []).map((variable) => [variable.name, variable]));
  for (const header of entry.headers ?? []) {
    const where = `${label}: header ${header.name}`;
    if (FORBIDDEN_HEADERS.has(header.name.toLowerCase())) problems.push(`${where} may not be set by an entry`);
    if (!env.get(header.secret)?.secret) problems.push(`${where} must name a secret env variable`);
    if (header.scheme === "basic") {
      if (!header.user) problems.push(`${where} uses basic and needs a user`);
      else if (!env.has(header.user)) problems.push(`${where} user must name an env variable`);
      else if (env.get(header.user).secret) problems.push(`${where} user must not be a secret`);
    } else if (header.user) {
      problems.push(`${where} only basic takes a user`);
    }
  }
  if (entry.oauth && (entry.headers ?? []).some((header) => header.name.toLowerCase() === "authorization")) {
    problems.push(`${label}: oauth and an Authorization header cannot both be set`);
  }
  return problems;
}
