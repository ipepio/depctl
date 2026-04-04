import { writeFileSync } from 'fs';

import { createTempAdminWorkspace } from '../../test-utils/temp-admin-workspace';

// We mock process.env for SERVICE_ENV_PATH and REPOS_CONFIG_PATH
function setupEnv(workspace: ReturnType<typeof createTempAdminWorkspace>) {
  process.env.SERVICE_ENV_PATH = workspace.serviceEnvPath;
  process.env.REPOS_CONFIG_PATH = workspace.reposConfigPath;
  process.env.STACKS_ROOT = workspace.stacksRoot;
}

function teardownEnv() {
  delete process.env.SERVICE_ENV_PATH;
  delete process.env.REPOS_CONFIG_PATH;
  delete process.env.STACKS_ROOT;
}

describe('repo-secrets — Task 9.4', () => {
  let workspace: ReturnType<typeof createTempAdminWorkspace>;

  beforeEach(() => {
    workspace = createTempAdminWorkspace();
    setupEnv(workspace);

    // Write a minimal repo config
    const repoYaml = `repository: acme/test-app
webhook:
  bearer_token_env: ACME_TEST_APP_WEBHOOK_BEARER
  hmac_secret_env: ACME_TEST_APP_WEBHOOK_HMAC
environments:
  production:
    image_name: ghcr.io/acme/test-app
    compose_file: ${workspace.stacksRoot}/acme/test-app/docker-compose.yml
    runtime_env_file: ${workspace.stacksRoot}/acme/test-app/.deploy.env
    services: [app]
    allowed_workflows: [Release]
    allowed_branches: [master]
    allowed_tag_pattern: '^v[0-9]+\\.[0-9]+\\.[0-9]+$'
    healthcheck:
      enabled: false
`;
    const { join } = require('path') as typeof import('path');
    writeFileSync(join(workspace.reposConfigPath, 'acme--test-app.yml'), repoYaml, 'utf8');
  });

  afterEach(() => {
    teardownEnv();
    workspace.cleanup();
  });

  it('generates secrets and stores them', () => {
    const { generateRepoSecrets } = require('./repo-secrets') as typeof import('./repo-secrets');
    const result = generateRepoSecrets('acme/test-app');
    expect(result.generated).toBe(true);
    expect(result.bearerTokenEnv).toBe('ACME_TEST_APP_WEBHOOK_BEARER');
    expect(result.hmacSecretEnv).toBe('ACME_TEST_APP_WEBHOOK_HMAC');
  });

  it('does not regenerate if secrets already exist', () => {
    const { generateRepoSecrets } = require('./repo-secrets') as typeof import('./repo-secrets');
    const first = generateRepoSecrets('acme/test-app');
    const second = generateRepoSecrets('acme/test-app');
    expect(first.generated).toBe(true);
    expect(second.generated).toBe(false);
  });

  it('shows secrets that were generated', () => {
    const { generateRepoSecrets, showRepoSecrets } = require('./repo-secrets') as typeof import('./repo-secrets');
    generateRepoSecrets('acme/test-app');
    const revealed = showRepoSecrets('acme/test-app');
    expect(revealed.bearerToken).toMatch(/^[a-f0-9]{64}$/);
    expect(revealed.hmacSecret).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rotate generates new secrets different from originals', () => {
    const { generateRepoSecrets, showRepoSecrets, rotateRepoSecrets } = require('./repo-secrets') as typeof import('./repo-secrets');
    generateRepoSecrets('acme/test-app');
    const before = showRepoSecrets('acme/test-app');
    const rotated = rotateRepoSecrets('acme/test-app');
    expect(rotated.bearerToken).not.toBe(before.bearerToken);
    expect(rotated.hmacSecret).not.toBe(before.hmacSecret);
    expect(rotated.generated).toBe(true);
  });

  it('throws clear error if secrets missing', () => {
    const { showRepoSecrets } = require('./repo-secrets') as typeof import('./repo-secrets');
    expect(() => showRepoSecrets('acme/test-app')).toThrow(/secrets not found/i);
  });
});
