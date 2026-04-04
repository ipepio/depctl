import { createHarnessWorkspace, runCli } from '../../test-utils/cli-harness';

describe('CLI failure path integration tests (F13)', () => {
  let workspace: ReturnType<typeof createHarnessWorkspace>;

  beforeAll(() => { workspace = createHarnessWorkspace(); });
  afterAll(() => { workspace.cleanup(); });

  it('repo show for unknown repo returns error with hint', () => {
    const result = runCli(['repo', 'show', '--repository', 'does/not-exist', '--json'], workspace);
    expect(result.exitCode).not.toBe(0);
  });

  it('repo secrets show for repo with no secrets returns actionable error', () => {
    // Register a repo without adding secrets
    const { addRepoFixture } = require('../../test-utils/cli-harness');
    addRepoFixture(workspace, 'acme/no-secrets-repo');

    // Clear the secrets from .env by creating a fresh workspace for this test
    const ws2 = createHarnessWorkspace();
    const { writeFileSync } = require('fs');
    const { join } = require('path');
    const repoYaml = [
      'repository: acme/no-secrets-here',
      'webhook:',
      '  bearer_token_env: ACME_NO_SECRETS_WEBHOOK_BEARER',
      '  hmac_secret_env: ACME_NO_SECRETS_WEBHOOK_HMAC',
      'environments:',
      '  production:',
      `    image_name: ghcr.io/acme/no-secrets-here`,
      `    compose_file: ${join(ws2.stacksRoot, 'docker-compose.yml')}`,
      `    runtime_env_file: ${join(ws2.stacksRoot, '.deploy.env')}`,
      '    services: [app]',
      '    allowed_workflows: [Release]',
      '    allowed_branches: [master]',
      "    allowed_tag_pattern: '^v[0-9]+\\.[0-9]+\\.[0-9]+$'",
      '    healthcheck:',
      '      enabled: false',
    ].join('\n') + '\n';
    writeFileSync(join(ws2.reposConfigPath, 'acme--no-secrets-here.yml'), repoYaml, 'utf8');

    const result = runCli(['repo', 'secrets', 'show', '--repository', 'acme/no-secrets-here', '--json'], ws2);
    ws2.cleanup();
    expect(result.exitCode).not.toBe(0);
    // Error should mention what to do
    expect(result.stderr).toMatch(/secrets not found|run.*generate/i);
  });

  it('unknown top-level command returns exit 2', () => {
    const result = runCli(['foobar-xyz'], workspace);
    expect(result.exitCode).toBe(2);
  });

  it('unknown nested command returns exit 2', () => {
    const result = runCli(['repo', 'foobar-xyz'], workspace);
    expect(result.exitCode).toBe(2);
  });

  it('deploy manual with missing required args fails in non-interactive mode', () => {
    // Only pass --repository, not --environment or --tag
    const result = runCli(['deploy', 'manual', '--repository', 'acme/test'], workspace);
    expect(result.exitCode).not.toBe(0);
  });
});
