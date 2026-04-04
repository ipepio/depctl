import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

import yaml from 'js-yaml';

import { ConfigError } from '../../config/errors';
import { findRepoFile } from '../../config/repo-files';
import { resolveConfigPaths, getStackDirectory, resolveServiceEnvPath } from '../../config/paths';
import { type ServerYaml } from '../../config/schema';
import { resolveRequiredString, resolveOptionalString, confirm } from '../io';
import {
  addRepository,
  getRepositorySecretEnvNames,
} from './repo-config';
import { generateRepoSecrets, showRepoSecrets } from './repo-secrets';
import { initializeManagedStack, type StackServiceInput } from './stack';
import { parseSupportedServiceKinds, resolveStackServiceInput } from '../stack/input';
import { runImagePreflight } from './ghcr-auth';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

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

function validateRepository(value: string): void {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value)) {
    throw new ConfigError(
      `Invalid repository format: "${value}". Expected: owner/repo (e.g. acme/payments-api)`,
    );
  }
}

// ─────────────────────────────────────────────
// Wizard options / result
// ─────────────────────────────────────────────

export interface RepoWizardOptions {
  repository?: string;
  environment?: string;
  imageName?: string;
  allowedBranches?: string[];
  allowedTagPattern?: string;
  allowedWorkflows?: string[];
  services?: string[];
  stackServices?: string[];
  nonInteractive?: boolean;
}

export interface RepoWizardResult {
  repository: string;
  environment: string;
  configFilePath: string;
  stackDirectory: string;
  bearerTokenEnv: string;
  hmacSecretEnv: string;
  bearerToken: string;
  hmacSecret: string;
  publicUrl: string | null;
}

// ─────────────────────────────────────────────
// Main wizard
// ─────────────────────────────────────────────

export async function runRepoAddWizard(options: RepoWizardOptions = {}): Promise<RepoWizardResult> {

  // ── Step 1: repo & image ────────────────────
  const repository = await resolveRequiredString(
    options.repository,
    'Repository (owner/repo)',
  );
  validateRepository(repository);

  if (findRepoFile(repository)) {
    throw new ConfigError(
      `Repository already configured: ${repository}. Use 'repo edit' to modify it.`,
    );
  }

  const inferredImage = `ghcr.io/${repository}`;
  const imageNameInput = await resolveOptionalString(
    options.imageName,
    'Docker image',
    inferredImage,
  );
  const imageName = imageNameInput ?? inferredImage;

  // ── Step 2: environment ─────────────────────
  const environment = await resolveRequiredString(
    options.environment,
    'Environment name',
    'production',
  );

  // ── Step 3: allowed branches ────────────────
  const branchesInput = await resolveOptionalString(
    options.allowedBranches?.join(','),
    'Allowed branches (comma-separated)',
    'master,main',
  );
  const allowedBranches = (branchesInput ?? 'master,main')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);

  // ── Step 4: tag pattern ─────────────────────
  const allowedTagPattern = await resolveRequiredString(
    options.allowedTagPattern,
    'Allowed tag pattern (regex)',
    '^v[0-9]+\\.[0-9]+\\.[0-9]+$',
  );

  // ── Step 5: allowed workflows ───────────────
  const workflowsInput = await resolveOptionalString(
    options.allowedWorkflows?.join(','),
    'Allowed workflow names (comma-separated)',
    'Release',
  );
  const allowedWorkflows = (workflowsInput ?? 'Release')
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);

  // ── Step 6: deployable services ────────────
  const servicesInput = await resolveOptionalString(
    options.services?.join(','),
    'Deployable services (comma-separated)',
    'app',
  );
  const services = (servicesInput ?? 'app')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // ── Step 6b: GHCR preflight (Task 5.1 / 5.2 / 5.3) ─
  const installDir = resolve(resolveConfigPaths().serverConfigPath, '..', '..');
  process.stdout.write('\nChecking image access...\n');
  await runImagePreflight({
    imageName,
    defaultUsername: repository.split('/')[0],
    composeDir: installDir,
    nonInteractive: options.nonInteractive,
  });

  // ── Step 7: create repo config ──────────────
  const stackDirectory = getStackDirectory(repository);
  const configResult = addRepository({
    repository,
    environment,
    imageName,
    allowedBranches,
    allowedTagPattern,
    allowedWorkflows,
    services,
    composeFile: join(stackDirectory, 'docker-compose.yml'),
    runtimeEnvFile: join(stackDirectory, '.deploy.env'),
  });

  // ── Step 8: generate secrets inline ─────────
  generateRepoSecrets(repository);
  const secrets = showRepoSecrets(repository);

  // ── Step 9: stack services ──────────────────
  process.stdout.write('\nStack services:\n');
  const wantsPostgres = await confirm('Add Postgres?', false);
  const wantsRedis = await confirm('Add Redis?', false);

  const stackServiceKindNames = ['app'];
  if (wantsPostgres) stackServiceKindNames.push('postgres');
  if (wantsRedis) stackServiceKindNames.push('redis');

  if (options.stackServices && options.stackServices.length > 0) {
    // non-interactive path: use provided list
    stackServiceKindNames.splice(0, stackServiceKindNames.length, ...options.stackServices);
  }

  const serviceKinds = parseSupportedServiceKinds(stackServiceKindNames);
  const stackServiceInputs: StackServiceInput[] = [];
  for (const kind of serviceKinds) {
    stackServiceInputs.push(
      await resolveStackServiceInput({ repository, environment, kind }),
    );
  }

  initializeManagedStack({ repository, environment, services: stackServiceInputs });

  return {
    repository,
    environment,
    configFilePath: configResult.filePath,
    stackDirectory,
    bearerTokenEnv: secrets.bearerTokenEnv,
    hmacSecretEnv: secrets.hmacSecretEnv,
    bearerToken: secrets.bearerToken,
    hmacSecret: secrets.hmacSecret,
    publicUrl: getPublicUrl(),
  };
}

// ─────────────────────────────────────────────
// Checklist printer (Task 3.4)
// ─────────────────────────────────────────────

export function printRepoAddChecklist(result: RepoWizardResult): void {
  const webhookUrl = result.publicUrl ?? '(set via: depctl init)';
  const divider = '━'.repeat(50);

  process.stdout.write(`
${divider}
  Repo ${result.repository} configured ✅
${divider}

  Add these secrets in GitHub:
  Settings → Secrets and variables → Actions

  DEPLOY_WEBHOOK_URL    = ${webhookUrl}
  DEPLOY_WEBHOOK_BEARER = ${result.bearerToken}
  DEPLOY_WEBHOOK_HMAC   = ${result.hmacSecret}

  Stack:  ${result.stackDirectory}/
  Config: ${result.configFilePath}

  Next steps:
    1. depctl validate
    2. docker compose restart webhook
    3. depctl workflow generate --repository ${result.repository}
${divider}
`);
}
