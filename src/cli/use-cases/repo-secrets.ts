import { existsSync, readFileSync } from 'fs';

import yaml from 'js-yaml';

import { ConfigError } from '../../config/errors';
import { resolveConfigPaths, resolveServiceEnvPath } from '../../config/paths';
import { readRepoFile } from '../../config/repo-files';
import { readManagedBlockValues, upsertManagedEnvBlock } from '../../config/service-env';
import { type ServerYaml } from '../../config/schema';
import { generateHexSecret } from '../secrets';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface GeneratedRepoSecrets {
  repository: string;
  bearerTokenEnv: string;
  hmacSecretEnv: string;
  generated: boolean; // false if already existed and we skipped
}

export interface RevealedRepoSecrets extends GeneratedRepoSecrets {
  bearerToken: string;
  hmacSecret: string;
  publicUrl: string | null;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getBlockId(repository: string): string {
  return `repo ${repository}`;
}

function getPublicUrl(): string | null {
  const { serverConfigPath } = resolveConfigPaths();
  if (!existsSync(serverConfigPath)) return null;
  try {
    const raw = yaml.load(readFileSync(serverConfigPath, 'utf8')) as ServerYaml;
    return raw?.server?.public_url ?? null;
  } catch {
    return null;
  }
}

function hasExistingSecrets(repository: string): boolean {
  const repoYaml = readRepoFile(repository);
  const values = readManagedBlockValues(resolveServiceEnvPath(), [
    repoYaml.webhook.bearer_token_env,
    repoYaml.webhook.hmac_secret_env,
  ]);
  return Boolean(
    values[repoYaml.webhook.bearer_token_env] && values[repoYaml.webhook.hmac_secret_env],
  );
}

// ─────────────────────────────────────────────
// Task 4.1 — Generate (non-destructive)
// ─────────────────────────────────────────────

export function generateRepoSecrets(repository: string): GeneratedRepoSecrets {
  const repoYaml = readRepoFile(repository);

  // Task 4.1: skip if secrets already exist
  if (hasExistingSecrets(repository)) {
    return {
      repository,
      bearerTokenEnv: repoYaml.webhook.bearer_token_env,
      hmacSecretEnv: repoYaml.webhook.hmac_secret_env,
      generated: false,
    };
  }

  const bearerToken = generateHexSecret(32); // 64 hex chars
  const hmacSecret = generateHexSecret(32);

  upsertManagedEnvBlock(resolveServiceEnvPath(), getBlockId(repository), {
    [repoYaml.webhook.bearer_token_env]: bearerToken,
    [repoYaml.webhook.hmac_secret_env]: hmacSecret,
  });

  return {
    repository,
    bearerTokenEnv: repoYaml.webhook.bearer_token_env,
    hmacSecretEnv: repoYaml.webhook.hmac_secret_env,
    generated: true,
  };
}

// ─────────────────────────────────────────────
// Task 4.2 — Show with public URL
// ─────────────────────────────────────────────

export function showRepoSecrets(repository: string): RevealedRepoSecrets {
  const repoYaml = readRepoFile(repository);
  const values = readManagedBlockValues(resolveServiceEnvPath(), [
    repoYaml.webhook.bearer_token_env,
    repoYaml.webhook.hmac_secret_env,
  ]);

  const bearerToken = values[repoYaml.webhook.bearer_token_env];
  const hmacSecret = values[repoYaml.webhook.hmac_secret_env];

  if (!bearerToken || !hmacSecret) {
    throw new ConfigError(
      `Secrets not found for repository: ${repository}.\n  Run: deployctl repo secrets generate --repository ${repository}`,
    );
  }

  return {
    repository,
    bearerTokenEnv: repoYaml.webhook.bearer_token_env,
    hmacSecretEnv: repoYaml.webhook.hmac_secret_env,
    bearerToken,
    hmacSecret,
    publicUrl: getPublicUrl(),
    generated: false,
  };
}

// ─────────────────────────────────────────────
// Task 4.3 — Rotate (force-overwrites)
// ─────────────────────────────────────────────

export function rotateRepoSecrets(repository: string): RevealedRepoSecrets {
  const repoYaml = readRepoFile(repository);

  const bearerToken = generateHexSecret(32);
  const hmacSecret = generateHexSecret(32);

  upsertManagedEnvBlock(resolveServiceEnvPath(), getBlockId(repository), {
    [repoYaml.webhook.bearer_token_env]: bearerToken,
    [repoYaml.webhook.hmac_secret_env]: hmacSecret,
  });

  return {
    repository,
    bearerTokenEnv: repoYaml.webhook.bearer_token_env,
    hmacSecretEnv: repoYaml.webhook.hmac_secret_env,
    bearerToken,
    hmacSecret,
    publicUrl: getPublicUrl(),
    generated: true,
  };
}

// ─────────────────────────────────────────────
// Human-readable formatter (Task 4.2)
// ─────────────────────────────────────────────

export function formatSecretsChecklist(secrets: RevealedRepoSecrets): string {
  const webhookUrl = secrets.publicUrl ?? '(set via: deployctl init)';
  const divider = '━'.repeat(50);
  return [
    '',
    divider,
    `  GitHub Secrets for ${secrets.repository}`,
    divider,
    '',
    '  Settings → Secrets and variables → Actions',
    '',
    `  DEPLOY_WEBHOOK_URL    = ${webhookUrl}`,
    `  DEPLOY_WEBHOOK_BEARER = ${secrets.bearerToken}`,
    `  DEPLOY_WEBHOOK_HMAC   = ${secrets.hmacSecret}`,
    '',
    divider,
    '',
  ].join('\n');
}

export function formatRotateChecklist(secrets: RevealedRepoSecrets): string {
  const webhookUrl = secrets.publicUrl ?? '(set via: deployctl init)';
  const divider = '━'.repeat(50);
  return [
    '',
    divider,
    `  Secrets rotated for ${secrets.repository} ✅`,
    divider,
    '',
    '  ⚠  Old secrets are now invalid.',
    '  Update GitHub Secrets:',
    '  Settings → Secrets and variables → Actions',
    '',
    `  DEPLOY_WEBHOOK_URL    = ${webhookUrl}`,
    `  DEPLOY_WEBHOOK_BEARER = ${secrets.bearerToken}`,
    `  DEPLOY_WEBHOOK_HMAC   = ${secrets.hmacSecret}`,
    '',
    '  Then restart the webhook:',
    '    docker compose restart webhook',
    '',
    divider,
    '',
  ].join('\n');
}

// ─────────────────────────────────────────────
// Task 8.3 — Multi-environment secrets display
// ─────────────────────────────────────────────

export interface MultiEnvSecretsEntry {
  environment: string;
  secretSuffix: string;
  bearerToken: string;
  hmacSecret: string;
}

export interface MultiEnvSecretsResult {
  repository: string;
  publicUrl: string | null;
  envEntries: MultiEnvSecretsEntry[];
}

/**
 * Returns secrets for all environments with correct suffix for multi-env setups.
 */
export function showMultiEnvSecrets(repository: string): MultiEnvSecretsResult {
  const repoYaml = readRepoFile(repository);
  const envNames = Object.keys(repoYaml.environments);
  const multiEnv = envNames.length > 1;
  const secrets = showRepoSecrets(repository);

  const envEntries: MultiEnvSecretsEntry[] = envNames.map((envName) => ({
    environment: envName,
    secretSuffix: multiEnv ? `_${envName.toUpperCase()}` : '',
    bearerToken: secrets.bearerToken,
    hmacSecret: secrets.hmacSecret,
  }));

  return { repository, publicUrl: getPublicUrl(), envEntries };
}

export function formatMultiEnvSecrets(result: MultiEnvSecretsResult): string {
  const webhookUrl = result.publicUrl ?? '(set via: deployctl init)';
  const divider = '━'.repeat(60);
  const lines: string[] = ['', divider, `  GitHub Secrets for ${result.repository}`, divider, ''];
  lines.push('  Settings → Secrets and variables → Actions');
  lines.push('');

  for (const entry of result.envEntries) {
    if (result.envEntries.length > 1) lines.push(`  # ${entry.environment}`);
    lines.push(`  DEPLOY_WEBHOOK_URL${entry.secretSuffix}    = ${webhookUrl}`);
    lines.push(`  DEPLOY_WEBHOOK_BEARER${entry.secretSuffix} = ${entry.bearerToken}`);
    lines.push(`  DEPLOY_WEBHOOK_HMAC${entry.secretSuffix}   = ${entry.hmacSecret}`);
    if (result.envEntries.length > 1) lines.push('');
  }

  lines.push(divider, '');
  return lines.join('\n');
}
