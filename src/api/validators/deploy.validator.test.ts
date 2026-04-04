import {
  validateDeployAgainstConfig,
} from './deploy.validator';
import { type RepoConfig } from '../../config/schema';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeRepoConfig(overrides: Partial<RepoConfig['environments']['production']> = {}): RepoConfig {
  return {
    repository: 'acme/test-app',
    webhook: { bearerToken: 'token', hmacSecret: 'secret' },
    environments: {
      production: {
        imageName: 'ghcr.io/acme/test-app',
        composeFile: '/opt/stacks/acme/test-app/docker-compose.yml',
        runtimeEnvFile: '/opt/stacks/acme/test-app/.deploy.env',
        services: ['app'],
        allowedWorkflows: ['Release'],
        allowedBranches: ['master', 'main'],
        allowedTagPattern: '^v[0-9]+\\.[0-9]+\\.[0-9]+$',
        healthcheck: { enabled: false },
        ...overrides,
      },
    },
  };
}

const basePayload = {
  repository: 'acme/test-app',
  environment: 'production',
  sha: 'abc123',
  workflow: 'Release',
  run_id: 42,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('deploy validator — ref_name (Task 9.1 / bug fix)', () => {
  it('accepts branch name in allowedBranches', () => {
    const config = makeRepoConfig();
    expect(() =>
      validateDeployAgainstConfig(
        { ...basePayload, tag: 'v1.0.0', ref_name: 'master' },
        config,
      ),
    ).not.toThrow();
  });

  it('accepts tag ref_name that matches allowedTagPattern (bug fix)', () => {
    const config = makeRepoConfig();
    expect(() =>
      validateDeployAgainstConfig(
        { ...basePayload, tag: 'v1.2.3', ref_name: 'v1.2.3' },
        config,
      ),
    ).not.toThrow();
  });

  it('rejects ref_name not in branches and not matching tag pattern', () => {
    const config = makeRepoConfig();
    expect(() =>
      validateDeployAgainstConfig(
        { ...basePayload, tag: 'sha-abc1234', ref_name: 'feature/something' },
        config,
      ),
    ).toThrow(/branch_not_allowed|not in allowed_branches/i);
  });

  it('rejects tag that does not match allowedTagPattern', () => {
    const config = makeRepoConfig();
    expect(() =>
      validateDeployAgainstConfig(
        { ...basePayload, tag: 'not-a-semver', ref_name: 'master' },
        config,
      ),
    ).toThrow(/tag_not_allowed|does not match allowed_tag_pattern|branch_not_allowed/i);
  });

  it('rejects unknown workflow', () => {
    const config = makeRepoConfig();
    expect(() =>
      validateDeployAgainstConfig(
        { ...basePayload, tag: 'v1.0.0', ref_name: 'v1.0.0', workflow: 'UnknownPipeline' },
        config,
      ),
    ).toThrow(/workflow_not_allowed|not in allowed_workflows/i);
  });

  it('rejects unknown environment', () => {
    const config = makeRepoConfig();
    expect(() =>
      validateDeployAgainstConfig(
        { ...basePayload, tag: 'v1.0.0', ref_name: 'v1.0.0', environment: 'staging' },
        config,
      ),
    ).toThrow(/environment_not_allowed|not configured/i);
  });
});

describe('deploy validator — multi-environment routing', () => {
  const multiConfig: RepoConfig = {
    repository: 'acme/test-app',
    webhook: { bearerToken: 'token', hmacSecret: 'secret' },
    environments: {
      production: {
        imageName: 'ghcr.io/acme/test-app',
        composeFile: '/opt/stacks/acme/test-app/production/docker-compose.yml',
        runtimeEnvFile: '/opt/stacks/acme/test-app/production/.deploy.env',
        services: ['app'],
        allowedWorkflows: ['Release'],
        allowedBranches: ['master'],
        allowedTagPattern: '^v[0-9]+\\.[0-9]+\\.[0-9]+$',
        healthcheck: { enabled: false },
      },
      staging: {
        imageName: 'ghcr.io/acme/test-app',
        composeFile: '/opt/stacks/acme/test-app/staging/docker-compose.yml',
        runtimeEnvFile: '/opt/stacks/acme/test-app/staging/.deploy.env',
        services: ['app'],
        allowedWorkflows: ['Release'],
        allowedBranches: ['staging'],
        allowedTagPattern: '^sha-[a-f0-9]{7,40}$',
        healthcheck: { enabled: false },
      },
    },
  };

  it('routes production tag correctly', () => {
    expect(() =>
      validateDeployAgainstConfig(
        { ...basePayload, tag: 'v2.0.0', ref_name: 'v2.0.0', environment: 'production' },
        multiConfig,
      ),
    ).not.toThrow();
  });

  it('routes staging sha correctly', () => {
    expect(() =>
      validateDeployAgainstConfig(
        { ...basePayload, tag: 'sha-abcdef1', ref_name: 'staging', environment: 'staging' },
        multiConfig,
      ),
    ).not.toThrow();
  });

  it('rejects staging sha going to production', () => {
    expect(() =>
      validateDeployAgainstConfig(
        { ...basePayload, tag: 'sha-abcdef1', ref_name: 'staging', environment: 'production' },
        multiConfig,
      ),
    ).toThrow(/tag_not_allowed|does not match allowed_tag_pattern|branch_not_allowed/i);
  });
});
