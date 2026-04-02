import { readFileSync } from 'fs';

import { createTempAdminWorkspace } from '../../test-utils/temp-admin-workspace';
import { readEnvFile } from '../../config/service-env';
import { generateRepoSecrets } from './repo-secrets';
import {
  addRepository,
  editRepository,
  getRepositorySecretEnvNames,
  toEnvVarPrefix,
} from './repo-config';

describe('repo config use cases', () => {
  afterEach(() => {
    delete process.env.REPOS_CONFIG_PATH;
    delete process.env.SERVICE_ENV_PATH;
    delete process.env.STACKS_ROOT;
  });

  it('creates a canonical repo config file with defaults', () => {
    const workspace = createTempAdminWorkspace();
    process.env.REPOS_CONFIG_PATH = workspace.reposConfigPath;
    process.env.SERVICE_ENV_PATH = workspace.serviceEnvPath;
    process.env.STACKS_ROOT = workspace.stacksRoot;

    const result = addRepository({
      repository: 'acme/payments-api',
      environment: 'production',
    });

    expect(result.filePath).toContain('acme--payments-api.yml');
    const content = readFileSync(result.filePath, 'utf8');
    expect(content).toContain('repository: acme/payments-api');
    expect(content).toContain(`${workspace.stacksRoot}/acme/payments-api/docker-compose.yml`);

    workspace.cleanup();
  });

  it('derives stable env names from the repository id', () => {
    expect(toEnvVarPrefix('acme/payments-api')).toBe('ACME_PAYMENTS_API');
    expect(getRepositorySecretEnvNames('acme/payments-api')).toEqual({
      bearerTokenEnv: 'ACME_PAYMENTS_API_WEBHOOK_BEARER',
      hmacSecretEnv: 'ACME_PAYMENTS_API_WEBHOOK_HMAC',
    });
  });

  it('migrates existing repo secret values when env names are refreshed', () => {
    const workspace = createTempAdminWorkspace();
    process.env.REPOS_CONFIG_PATH = workspace.reposConfigPath;
    process.env.SERVICE_ENV_PATH = workspace.serviceEnvPath;
    process.env.STACKS_ROOT = workspace.stacksRoot;

    addRepository({
      repository: 'acme/payments-api',
      environment: 'production',
    });
    generateRepoSecrets('acme/payments-api');

    editRepository({
      repository: 'acme/payments-api',
      bearerTokenEnv: 'LEGACY_BEARER',
      hmacSecretEnv: 'LEGACY_HMAC',
    });
    const migrated = editRepository({
      repository: 'acme/payments-api',
      refreshEnvNames: true,
    });

    const envEntries = readEnvFile(workspace.serviceEnvPath);
    expect(migrated.warnings).toEqual([]);
    expect(envEntries.ACME_PAYMENTS_API_WEBHOOK_BEARER).toBeDefined();
    expect(envEntries.ACME_PAYMENTS_API_WEBHOOK_HMAC).toBeDefined();

    workspace.cleanup();
  });
});
