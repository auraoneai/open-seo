// Idempotently enables Managed OAuth on the self-host Access application so
// MCP clients (Claude Code, Codex CLI, web connectors) can complete OAuth
// login through Cloudflare Access. Runs at the end of `pnpm deploy:selfhost`
// because alchemy's Access Application resource does not manage
// oauth_configuration — a dashboard-only change would be silently dropped by
// the next deploy that reconciles the app (e.g. adding a teammate).
//
// Auth: CLOUDFLARE_API_TOKEN (needs Access: Apps and Policies Write).
// Config: .env.selfhost (SELFHOST_CUSTOM_DOMAIN / WORKERS_SUBDOMAIN), with
// CF_ACCOUNT_ID override when the token spans multiple accounts.
import { existsSync, readFileSync } from "node:fs";

const API = "https://api.cloudflare.com/client/v4";
const APP_NAME = "open-seo selfhost";

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error("CLOUDFLARE_API_TOKEN is not set.");
  process.exit(1);
}

function loadEnvFile(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^["'](.*)["']$/, "$1");
  }
  return env;
}

async function cf(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed: ${JSON.stringify(data.errors)}`,
    );
  }
  return data.result;
}

const envFile = loadEnvFile(".env.selfhost");

let accountId = process.env.CF_ACCOUNT_ID?.trim();
if (!accountId) {
  const accounts = await cf("/accounts?per_page=100");
  if (accounts.length === 0) throw new Error("Token can access no accounts.");
  if (accounts.length > 1) {
    console.log(
      `Token spans ${accounts.length} accounts; using ${accounts[0].id} (${accounts[0].name}). Set CF_ACCOUNT_ID to override.`,
    );
  }
  accountId = accounts[0].id;
}

let appDomain = (envFile.SELFHOST_CUSTOM_DOMAIN ?? "").trim();
if (!appDomain) {
  let subdomain = (envFile.WORKERS_SUBDOMAIN ?? "").trim();
  if (!subdomain) {
    const { subdomain: observed } = await cf(
      `/accounts/${accountId}/workers/subdomain`,
    );
    subdomain = `${observed}.workers.dev`;
  }
  appDomain = `open-seo-selfhost.${subdomain}`;
}

const apps = await cf(
  `/accounts/${accountId}/access/apps?domain=${encodeURIComponent(appDomain)}`,
);
const app = apps.find((a) => a.name === APP_NAME) ?? apps[0];
if (!app) {
  throw new Error(`No Access application found for domain ${appDomain}.`);
}

const full = await cf(`/accounts/${accountId}/access/apps/${app.id}`);
const body = { ...full };
delete body.created_at;
delete body.updated_at;
body.oauth_configuration = {
  enabled: true,
  dynamic_client_registration: {
    allow_any_on_localhost: true,
    allow_any_on_loopback: true,
    // ChatGPT custom connectors (fixed + per-connection callbacks).
    allowed_uris: [
      "https://chatgpt.com/connector_platform_oauth_redirect",
      "https://chatgpt.com/connector/oauth/*",
    ],
  },
  grant: { session_duration: "336h", access_token_lifetime: "15m" },
};

const updated = await cf(`/accounts/${accountId}/access/apps/${app.id}`, {
  method: "PUT",
  body: JSON.stringify(body),
});
console.log(
  `Managed OAuth enabled on "${updated.name}" (${updated.domain}). ` +
    `DCR: localhost=${updated.oauth_configuration.dynamic_client_registration.allow_any_on_localhost} ` +
    `loopback=${updated.oauth_configuration.dynamic_client_registration.allow_any_on_loopback}, ` +
    `grant=${updated.oauth_configuration.grant.session_duration}/${updated.oauth_configuration.grant.access_token_lifetime}.`,
);
console.log(`MCP endpoint: https://${updated.domain}/mcp`);
