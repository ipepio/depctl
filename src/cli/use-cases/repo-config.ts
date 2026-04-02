import { ConfigError } from '../../config/errors';
import { validateRepoDraft, type ValidationIssue } from '../../config/draft-validator';
import { findRepoFile, listRepoFiles, readRepoFile, writeRepoFile } from '../../config/repo-files';
import { getStackDirectory, resolveServiceEnvPath } from '../../config/paths';
import { type RepoYaml } from '../../config/schema';
import { readEnvFile, upsertManagedEnvBlock } from '../../config/service-env';

const DEFAULT_TAG_PATTERN = '^sha-[a-f0-9]{7,40}$';

export interface RepoMutationResult {
  repository: string;
  environment?: string;
  filePath: string;
  warnings: string[];
}

export interface RepositoryDefaults {
  imageName: string;
  composeFile: string;
  runtimeEnvFile: string;
  services: string[];
  allowedWorkflows: string[];
  allowedBranches: string[];
  allowedTagPattern: string;
}

export interface UpsertEnvironmentInput {
  repository: string;
  environment: string;
  imageName?: string;
  composeFile?: string;
  runtimeEnvFile?: string;
  services?: string[];
  allowedWorkflows?: string[];
  allowedBranches?: string[];
  allowedTagPattern?: string;
  healthcheckUrl?: string;
  healthcheckTimeoutMs?: number;
  healthcheckIntervalMs?: number;
  disableHealthcheck?: boolean;
}

export function toEnvVarPrefix(repository: string): string {
  return repository
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

export function getRepositorySecretEnvNames(repository: string): {
  bearerTokenEnv: string;
  hmacSecretEnv: string;
} {
  const prefix = toEnvVarPrefix(repository);
  return {
    bearerTokenEnv: `${prefix}_WEBHOOK_BEARER`,
    hmacSecretEnv: `${prefix}_WEBHOOK_HMAC`,
  };
}

export function buildRepositoryDefaults(
  repository: string,
  environment: string,
): RepositoryDefaults {
  const stackDirectory = getStackDirectory(repository);
  return {
    imageName: `ghcr.io/${repository}`,
    composeFile: `${stackDirectory}/docker-compose.yml`,
    runtimeEnvFile: `${stackDirectory}/.deploy.env`,
    services: ['app'],
    allowedWorkflows: [`deploy-${environment}`],
    allowedBranches: ['main'],
    allowedTagPattern: DEFAULT_TAG_PATTERN,
  };
}

function collectWarnings(issues: ValidationIssue[]): string[] {
  return issues.filter((issue) => issue.level === 'warning').map((issue) => issue.message);
}

function throwOnDraftErrors(issues: ValidationIssue[]): void {
  const errors = issues.filter((issue) => issue.level === 'error');
  if (errors.length > 0) {
    throw new ConfigError(errors.map((issue) => issue.message).join(' | '));
  }
}

function buildEnvironment(
  input: UpsertEnvironmentInput,
  current?: RepoYaml['environments'][string],
): RepoYaml['environments'][string] {
  const defaults = buildRepositoryDefaults(input.repository, input.environment);
  const healthcheckEnabled = input.disableHealthcheck
    ? false
    : Boolean(input.healthcheckUrl ?? current?.healthcheck?.url);

  return {
    image_name: input.imageName ?? current?.image_name ?? defaults.imageName,
    compose_file: input.composeFile ?? current?.compose_file ?? defaults.composeFile,
    runtime_env_file: input.runtimeEnvFile ?? current?.runtime_env_file ?? defaults.runtimeEnvFile,
    services: input.services ?? current?.services ?? defaults.services,
    allowed_workflows:
      input.allowedWorkflows ?? current?.allowed_workflows ?? defaults.allowedWorkflows,
    allowed_branches:
      input.allowedBranches ?? current?.allowed_branches ?? defaults.allowedBranches,
    allowed_tag_pattern:
      input.allowedTagPattern ?? current?.allowed_tag_pattern ?? defaults.allowedTagPattern,
    healthcheck: healthcheckEnabled
      ? {
          enabled: true,
          url: input.healthcheckUrl ?? current?.healthcheck?.url,
          timeout_ms: input.healthcheckTimeoutMs ?? current?.healthcheck?.timeout_ms,
          interval_ms: input.healthcheckIntervalMs ?? current?.healthcheck?.interval_ms,
        }
      : {
          enabled: false,
        },
  };
}

export function listRepositories(): Array<{ repository: string; filePath: string }> {
  return listRepoFiles().map((file) => ({
    repository: file.repoYaml.repository,
    filePath: file.filePath,
  }));
}

export function showRepository(repository: string): RepoYaml {
  return readRepoFile(repository);
}

export function addRepository(input: UpsertEnvironmentInput): RepoMutationResult {
  if (findRepoFile(input.repository)) {
    throw new ConfigError(`Repository already exists: ${input.repository}`);
  }

  const secrets = getRepositorySecretEnvNames(input.repository);
  const repoYaml: RepoYaml = {
    repository: input.repository,
    webhook: {
      bearer_token_env: secrets.bearerTokenEnv,
      hmac_secret_env: secrets.hmacSecretEnv,
    },
    environments: {
      [input.environment]: buildEnvironment(input),
    },
  };

  const issues = validateRepoDraft(repoYaml);
  throwOnDraftErrors(issues);
  const filePath = writeRepoFile(input.repository, repoYaml);
  return {
    repository: input.repository,
    environment: input.environment,
    filePath,
    warnings: collectWarnings(issues),
  };
}

export function editRepository(input: {
  repository: string;
  bearerTokenEnv?: string;
  hmacSecretEnv?: string;
  refreshEnvNames?: boolean;
}): RepoMutationResult {
  const current = readRepoFile(input.repository);
  const defaults = getRepositorySecretEnvNames(input.repository);
  const nextBearerTokenEnv =
    input.bearerTokenEnv ??
    (input.refreshEnvNames ? defaults.bearerTokenEnv : current.webhook.bearer_token_env);
  const nextHmacSecretEnv =
    input.hmacSecretEnv ??
    (input.refreshEnvNames ? defaults.hmacSecretEnv : current.webhook.hmac_secret_env);
  const repoYaml: RepoYaml = {
    ...current,
    webhook: {
      bearer_token_env: nextBearerTokenEnv,
      hmac_secret_env: nextHmacSecretEnv,
    },
  };

  const issues = validateRepoDraft(repoYaml);
  throwOnDraftErrors(issues);
  const filePath = writeRepoFile(input.repository, repoYaml);
  const warnings = collectWarnings(issues);

  if (
    current.webhook.bearer_token_env !== nextBearerTokenEnv ||
    current.webhook.hmac_secret_env !== nextHmacSecretEnv
  ) {
    const envEntries = readEnvFile(resolveServiceEnvPath());
    const bearerToken =
      envEntries[current.webhook.bearer_token_env] ?? envEntries[nextBearerTokenEnv];
    const hmacSecret = envEntries[current.webhook.hmac_secret_env] ?? envEntries[nextHmacSecretEnv];

    if (bearerToken || hmacSecret) {
      upsertManagedEnvBlock(resolveServiceEnvPath(), `repo ${input.repository}`, {
        ...(bearerToken ? { [nextBearerTokenEnv]: bearerToken } : {}),
        ...(hmacSecret ? { [nextHmacSecretEnv]: hmacSecret } : {}),
      });
    }

    if (!bearerToken || !hmacSecret) {
      warnings.push(
        'Secret env names were updated but some secret values could not be migrated automatically; regenerate or restore them before validate/restart.',
      );
    }
  }

  return {
    repository: input.repository,
    filePath,
    warnings,
  };
}

export function addEnvironment(input: UpsertEnvironmentInput): RepoMutationResult {
  const current = readRepoFile(input.repository);
  if (current.environments[input.environment]) {
    throw new ConfigError(`Environment already exists: ${input.repository} ${input.environment}`);
  }

  const repoYaml: RepoYaml = {
    ...current,
    environments: {
      ...current.environments,
      [input.environment]: buildEnvironment(input),
    },
  };

  const issues = validateRepoDraft(repoYaml);
  throwOnDraftErrors(issues);
  const filePath = writeRepoFile(input.repository, repoYaml);
  return {
    repository: input.repository,
    environment: input.environment,
    filePath,
    warnings: collectWarnings(issues),
  };
}

export function editEnvironment(input: UpsertEnvironmentInput): RepoMutationResult {
  const current = readRepoFile(input.repository);
  const currentEnvironment = current.environments[input.environment];
  if (!currentEnvironment) {
    throw new ConfigError(`Environment not found: ${input.repository} ${input.environment}`);
  }

  const repoYaml: RepoYaml = {
    ...current,
    environments: {
      ...current.environments,
      [input.environment]: buildEnvironment(input, currentEnvironment),
    },
  };

  const issues = validateRepoDraft(repoYaml);
  throwOnDraftErrors(issues);
  const filePath = writeRepoFile(input.repository, repoYaml);
  return {
    repository: input.repository,
    environment: input.environment,
    filePath,
    warnings: collectWarnings(issues),
  };
}

export function ensureRepositoryEnvironment(
  repository: string,
  environment: string,
): RepoMutationResult | null {
  const existing = findRepoFile(repository);
  if (!existing) {
    return addRepository({
      repository,
      environment,
    });
  }

  if (!existing.repoYaml.environments[environment]) {
    return addEnvironment({
      repository,
      environment,
    });
  }

  return null;
}

export function syncEnvironmentWithStack(input: {
  repository: string;
  environment: string;
  composeFile: string;
  runtimeEnvFile: string;
  imageName: string;
  services: string[];
  healthcheckUrl?: string;
}): RepoMutationResult {
  return editEnvironment({
    repository: input.repository,
    environment: input.environment,
    composeFile: input.composeFile,
    runtimeEnvFile: input.runtimeEnvFile,
    imageName: input.imageName,
    services: input.services,
    healthcheckUrl: input.healthcheckUrl,
    disableHealthcheck: !input.healthcheckUrl,
  });
}
