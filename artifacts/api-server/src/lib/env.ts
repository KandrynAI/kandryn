import { logger } from "./logger.js";

interface EnvSpec {
  name: string;
  critical: boolean;
  description: string;
}

const REQUIRED_ENV: EnvSpec[] = [
  { name: "PORT",          critical: true,  description: "HTTP port the API server binds to" },
  { name: "DATABASE_URL",  critical: true,  description: "PostgreSQL connection string" },
  { name: "SESSION_SECRET",critical: false, description: "Secret used to sign session cookies" },
];

const OPTIONAL_ENV: EnvSpec[] = [
  { name: "ANTHROPIC_API_KEY", critical: false, description: "Claude API key (AI suggestions degrade to mocks when absent)" },
  { name: "OPENAI_API_KEY",    critical: false, description: "OpenAI API key (AI suggestions degrade to mocks when absent)" },
  { name: "GITHUB_TOKEN",      critical: false, description: "GitHub PAT for Git integration" },
  { name: "AZURE_REPOS_TOKEN", critical: false, description: "Azure Repos PAT for Git integration" },
  { name: "ADO_ORG",           critical: false, description: "Azure DevOps organisation slug for PLM sync" },
  { name: "ADO_TOKEN",         critical: false, description: "Azure DevOps PAT for PLM sync" },
  { name: "JIRA_DOMAIN",       critical: false, description: "Jira instance domain (e.g. acme.atlassian.net)" },
  { name: "JIRA_EMAIL",        critical: false, description: "Jira account email for PLM sync" },
  { name: "JIRA_TOKEN",        critical: false, description: "Jira API token for PLM sync" },
  { name: "CRON_SECRET",       critical: false, description: "Bearer secret guarding /api/internal/dispatch-runs (scheduled runs won't dispatch without it)" },
  { name: "APP_BASE_URL",      critical: false, description: "Public app origin used in run-notification email links (default https://getbluemantis.com)" },
  { name: "ENABLE_DEMO_AGENTS",critical: false, description: "When 'true', adds mock AntiGravity/Copilot suggestions (default off)" },
  { name: "CONFIG_ENCRYPTION_KEY", critical: false, description: "32-byte key (base64/hex) encrypting integration credentials at rest; when absent, credentials are stored plaintext" },
];

/**
 * Validates all known environment variables at startup.
 * Logs warnings for missing optional vars, and exits the process
 * if any critical var is missing.
 */
export function validateEnv(): void {
  const missing: EnvSpec[] = [];
  const warnings: EnvSpec[] = [];

  for (const spec of REQUIRED_ENV) {
    if (!process.env[spec.name]) {
      if (spec.critical) missing.push(spec);
      else warnings.push(spec);
    }
  }

  for (const spec of OPTIONAL_ENV) {
    if (!process.env[spec.name]) {
      warnings.push(spec);
    }
  }

  // Log optional gaps as info so they're visible in startup output
  if (warnings.length > 0) {
    logger.info(
      { missing: warnings.map((w) => w.name) },
      "Optional/non-critical env vars not set — related features will be degraded or unavailable",
    );
    for (const w of warnings) {
      logger.debug(`  ${w.name}: ${w.description}`);
    }
  }

  // Critical failures — log each clearly and exit
  if (missing.length > 0) {
    logger.fatal(
      { missing: missing.map((m) => m.name) },
      "Critical environment variables are missing — cannot start",
    );
    for (const m of missing) {
      logger.fatal(`  ${m.name}: ${m.description}`);
    }
    process.exit(1);
  }

  logger.info("Environment validation passed");
}
