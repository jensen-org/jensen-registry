import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SCHEMA_VERSION, checksumsText, checksummed, dump, loadEntries, readYaml, validator, writeText } from "./lib.mjs";
import { discoverGrammars } from "./grammars/discover.mjs";
import { trackGrammars } from "./grammars/track.mjs";
import { validateGrammars } from "./grammars/validate.mjs";
import { trackIntegrations } from "./integrations/track.mjs";
import { validateIntegrations } from "./integrations/validate.mjs";
import { trackMcpServers } from "./mcp/track.mjs";
import { validateMcp } from "./mcp/validate.mjs";
import { trackSkills } from "./skills/track.mjs";
import { validateSkills } from "./skills/validate.mjs";
import { trackTools } from "./tools/track.mjs";
import { validateTools } from "./tools/validate.mjs";

const warnings = [];
const warn = (message) => {
  warnings.push(message);
  console.warn(`warning: ${message}`);
};

async function track() {
  const check = validator();
  const previous = existsSync(join(ROOT, "index.yaml")) ? readYaml("index.yaml") : {};
  const problems = [];
  const skills = await trackSkills({ check, previous, problems });
  const { mcp, entries: mcpEntries } = await trackMcpServers({ check, previous, problems, warn });
  const integrations = trackIntegrations({ check, problems, mcpEntries });
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  const grammars = await trackGrammars();
  await trackTools();
  writeText("index.yaml", dump({ schema_version: SCHEMA_VERSION, skills, mcp, integrations }));
  writeText("checksums.txt", checksumsText(checksummed()));
  console.log(`tracked ${skills.length} skills, ${mcp.length} mcp servers, ${integrations.length} integrations and ${grammars.length} grammars, ${warnings.length} warnings`);
}

async function validate(online) {
  const check = validator();
  const problems = [];
  const index = readYaml("index.yaml");
  if (index.schema_version !== SCHEMA_VERSION) problems.push(`index.yaml: schema_version must be ${SCHEMA_VERSION}`);
  const same = (label, left, right) => {
    if (JSON.stringify(left ?? null) !== JSON.stringify(right ?? null)) problems.push(`${label} differs from its entry file`);
  };
  const context = { check, index, problems, same, online };
  await validateTools(context);
  validateGrammars(context);
  await validateSkills(context);
  validateMcp(context);
  validateIntegrations({ ...context, mcpEntries: loadEntries("mcp") });
  if (readFileSync(join(ROOT, "checksums.txt"), "utf8") !== checksumsText(checksummed())) problems.push("checksums.txt does not match the published files");
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`ok: ${index.skills?.length ?? 0} skills, ${index.mcp?.length ?? 0} mcp servers, ${index.integrations?.length ?? 0} integrations`);
}

const [command, flag] = process.argv.slice(2);
const commands = { track, discover: () => discoverGrammars(), validate: () => validate(flag === "--online") };
if (!commands[command]) {
  console.error("usage: node registry.mjs track | discover | validate [--online]");
  process.exit(2);
}
commands[command]().catch((error) => {
  console.error(error);
  process.exit(1);
});
