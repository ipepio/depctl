import { copyFileSync, existsSync, renameSync, writeFileSync } from 'fs';

import yaml from 'js-yaml';

import { getManagedStackRoot, getStackDirectory, resolveServiceEnvPath } from '../../config/paths';
import { readComposeDocument } from '../../config/compose';
import { getRepoFilePath, listRepoFiles, toRepoFileName } from '../../config/repo-files';
import { readEnvFile, upsertManagedEnvBlock } from '../../config/service-env';
import { getRepositorySecretEnvNames } from './repo-config';
import { type RepoYaml } from '../../config/schema';

function writeRepoYamlFile(filePath: string, repoYaml: RepoYaml): void {
  copyFileSync(filePath, `${filePath}.bak`);
  writeFileSync(filePath, yaml.dump(repoYaml, { noRefs: true, lineWidth: 120 }), 'utf8');
}

export interface MigrationFinding {
  repository: string;
  environment?: string;
  type:
    | 'rename_repo_file'
    | 'normalize_stack_paths'
    | 'rename_secret_env_names'
    | 'missing_secret_values'
    | 'missing_stack_metadata';
  message: string;
}

export interface MigrationPlan {
  findings: MigrationFinding[];
  actions: string[];
}

function getStackMetadata(filePath: string): Record<string, unknown> | null {
  try {
    const document = readComposeDocument(filePath);
    const metadata = document['x-deploy-webhook'];
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }
    return metadata as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function scanMigration(): MigrationFinding[] {
  const findings: MigrationFinding[] = [];
  const envEntries = readEnvFile();

  for (const file of listRepoFiles()) {
    const repository = file.repoYaml.repository;
    const canonicalFileName = toRepoFileName(repository);
    if (file.fileName !== canonicalFileName) {
      findings.push({
        repository,
        type: 'rename_repo_file',
        message: `Repository config file should be renamed to ${canonicalFileName}`,
      });
    }

    const expectedSecrets = getRepositorySecretEnvNames(repository);
    if (
      file.repoYaml.webhook.bearer_token_env !== expectedSecrets.bearerTokenEnv ||
      file.repoYaml.webhook.hmac_secret_env !== expectedSecrets.hmacSecretEnv
    ) {
      findings.push({
        repository,
        type: 'rename_secret_env_names',
        message: `Repository uses non-canonical secret env names`,
      });
    }

    if (
      !envEntries[file.repoYaml.webhook.bearer_token_env] ||
      !envEntries[file.repoYaml.webhook.hmac_secret_env]
    ) {
      findings.push({
        repository,
        type: 'missing_secret_values',
        message: `Repository secrets are missing from the service .env file`,
      });
    }

    for (const [environment, config] of Object.entries(file.repoYaml.environments)) {
      const expectedStackDir = getStackDirectory(repository);
      const expectedComposeFile = `${expectedStackDir}/docker-compose.yml`;
      const expectedRuntimeEnvFile = `${expectedStackDir}/.deploy.env`;
      if (
        config.compose_file !== expectedComposeFile ||
        config.runtime_env_file !== expectedRuntimeEnvFile
      ) {
        findings.push({
          repository,
          environment,
          type: 'normalize_stack_paths',
          message: `Environment ${environment} is outside ${getManagedStackRoot()}`,
        });
      }

      if (existsSync(config.compose_file)) {
        const metadata = getStackMetadata(config.compose_file);
        if (!metadata || metadata.managed !== true) {
          findings.push({
            repository,
            environment,
            type: 'missing_stack_metadata',
            message: `Compose file for ${environment} is not marked as managed`,
          });
        }
      }
    }
  }

  return findings;
}

export function buildMigrationPlan(): MigrationPlan {
  const findings = scanMigration();
  const actions = findings.map((finding) => {
    switch (finding.type) {
      case 'rename_repo_file':
        return `[SAFE] Rename repo config file for ${finding.repository}`;
      case 'normalize_stack_paths':
        return `[MANUAL] Move or regenerate stack for ${finding.repository} ${finding.environment ?? ''}`.trim();
      case 'rename_secret_env_names':
        return `[SAFE WHEN VALUES EXIST] Canonicalize secret env names for ${finding.repository}`;
      case 'missing_secret_values':
        return `[SAFE] Regenerate or restore secrets for ${finding.repository}`;
      case 'missing_stack_metadata':
        return `[MANUAL] Recreate or import managed metadata for ${finding.repository} ${finding.environment ?? ''}`.trim();
    }
  });

  return {
    findings,
    actions,
  };
}

export function applyMigration(): { applied: string[]; skipped: string[] } {
  const applied: string[] = [];
  const skipped: string[] = [];
  const serviceEnvPath = resolveServiceEnvPath();
  const serviceEnvEntries = readEnvFile(serviceEnvPath);

  for (const file of listRepoFiles()) {
    const repository = file.repoYaml.repository;
    const canonicalPath = getRepoFilePath(repository);
    let currentFilePath = file.filePath;

    if (file.filePath === canonicalPath) {
      currentFilePath = file.filePath;
    } else {
      if (existsSync(canonicalPath)) {
        skipped.push(`Skipped rename for ${repository}; canonical file already exists`);
      } else {
        const backupPath = `${file.filePath}.bak`;
        copyFileSync(file.filePath, backupPath);
        renameSync(file.filePath, canonicalPath);
        currentFilePath = canonicalPath;
        applied.push(
          `Renamed ${file.fileName} -> ${toRepoFileName(repository)} (backup: ${backupPath})`,
        );
      }
    }

    const expectedSecrets = getRepositorySecretEnvNames(repository);
    if (
      file.repoYaml.webhook.bearer_token_env !== expectedSecrets.bearerTokenEnv ||
      file.repoYaml.webhook.hmac_secret_env !== expectedSecrets.hmacSecretEnv
    ) {
      const bearerToken =
        serviceEnvEntries[file.repoYaml.webhook.bearer_token_env] ??
        serviceEnvEntries[expectedSecrets.bearerTokenEnv];
      const hmacSecret =
        serviceEnvEntries[file.repoYaml.webhook.hmac_secret_env] ??
        serviceEnvEntries[expectedSecrets.hmacSecretEnv];

      if (!bearerToken || !hmacSecret) {
        skipped.push(
          `Skipped secret env rename for ${repository}; missing current secret values in service .env`,
        );
      } else {
        upsertManagedEnvBlock(serviceEnvPath, `repo ${repository}`, {
          [expectedSecrets.bearerTokenEnv]: bearerToken,
          [expectedSecrets.hmacSecretEnv]: hmacSecret,
        });

        const nextRepoYaml: RepoYaml = {
          ...file.repoYaml,
          webhook: {
            bearer_token_env: expectedSecrets.bearerTokenEnv,
            hmac_secret_env: expectedSecrets.hmacSecretEnv,
          },
        };
        writeRepoYamlFile(currentFilePath, nextRepoYaml);
        applied.push(`Canonicalized secret env names for ${repository}`);
      }
    }
  }

  return {
    applied,
    skipped,
  };
}
