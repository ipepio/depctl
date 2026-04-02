import { readFileSync, writeFileSync } from 'fs';

import yaml from 'js-yaml';

import { createTempAdminWorkspace } from '../../test-utils/temp-admin-workspace';
import { applyMigration } from './migration';

describe('migration use cases', () => {
  afterEach(() => {
    delete process.env.REPOS_CONFIG_PATH;
    delete process.env.SERVICE_ENV_PATH;
    delete process.env.STACKS_ROOT;
  });

  it('canonicalizes repo file names and secret env names when values exist', () => {
    const workspace = createTempAdminWorkspace();
    process.env.REPOS_CONFIG_PATH = workspace.reposConfigPath;
    process.env.SERVICE_ENV_PATH = workspace.serviceEnvPath;
    process.env.STACKS_ROOT = workspace.stacksRoot;

    const legacyRepoPath = `${workspace.reposConfigPath}/legacy.yml`;
    writeFileSync(
      legacyRepoPath,
      yaml.dump({
        repository: 'acme/payments-api',
        webhook: {
          bearer_token_env: 'LEGACY_BEARER',
          hmac_secret_env: 'LEGACY_HMAC',
        },
        environments: {
          production: {
            image_name: 'ghcr.io/acme/payments-api',
            compose_file: `${workspace.stacksRoot}/acme/payments-api/docker-compose.yml`,
            runtime_env_file: `${workspace.stacksRoot}/acme/payments-api/.deploy.env`,
            services: ['app'],
            allowed_workflows: ['deploy-production'],
            allowed_branches: ['main'],
            allowed_tag_pattern: '^sha-[a-f0-9]{7,40}$',
            healthcheck: { enabled: false },
          },
        },
      }),
      'utf8',
    );

    writeFileSync(
      workspace.serviceEnvPath,
      [
        'REDIS_URL=redis://redis:6379',
        '',
        '# BEGIN docker-deploy-webhook repo acme/payments-api',
        'LEGACY_BEARER=foo',
        'LEGACY_HMAC=bar',
        '# END docker-deploy-webhook repo acme/payments-api',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = applyMigration();

    const canonicalRepoPath = `${workspace.reposConfigPath}/acme--payments-api.yml`;
    const repoConfig = readFileSync(canonicalRepoPath, 'utf8');
    const envContent = readFileSync(workspace.serviceEnvPath, 'utf8');

    expect(result.applied.some((line) => line.includes('Renamed legacy.yml'))).toBe(true);
    expect(result.applied.some((line) => line.includes('Canonicalized secret env names'))).toBe(
      true,
    );
    expect(repoConfig).toContain('ACME_PAYMENTS_API_WEBHOOK_BEARER');
    expect(repoConfig).toContain('ACME_PAYMENTS_API_WEBHOOK_HMAC');
    expect(envContent).toContain('ACME_PAYMENTS_API_WEBHOOK_BEARER=foo');
    expect(envContent).toContain('ACME_PAYMENTS_API_WEBHOOK_HMAC=bar');

    workspace.cleanup();
  });
});
