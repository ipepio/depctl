import { existsSync, readFileSync } from 'fs';

import { createTempAdminWorkspace } from '../../test-utils/temp-admin-workspace';
import { addManagedStackService, initializeManagedStack } from './stack';

describe('managed stack use cases', () => {
  afterEach(() => {
    delete process.env.REPOS_CONFIG_PATH;
    delete process.env.SERVICE_ENV_PATH;
    delete process.env.STACKS_ROOT;
  });

  it('creates a managed stack and syncs deployable services into repo config', () => {
    const workspace = createTempAdminWorkspace();
    process.env.REPOS_CONFIG_PATH = workspace.reposConfigPath;
    process.env.SERVICE_ENV_PATH = workspace.serviceEnvPath;
    process.env.STACKS_ROOT = workspace.stacksRoot;

    const result = initializeManagedStack({
      repository: 'acme/payments-api',
      environment: 'production',
      services: [
        {
          repository: 'acme/payments-api',
          environment: 'production',
          kind: 'app',
          serviceName: 'app',
          port: 3000,
          internalPort: 3000,
          healthcheckPath: '/health',
        },
        {
          repository: 'acme/payments-api',
          environment: 'production',
          kind: 'postgres',
          serviceName: 'postgres',
          databaseName: 'app',
          username: 'app',
        },
      ],
    });

    const composePath = `${workspace.stacksRoot}/acme/payments-api/docker-compose.yml`;
    const deployEnvPath = `${workspace.stacksRoot}/acme/payments-api/.deploy.env`;
    const stackEnvPath = `${workspace.stacksRoot}/acme/payments-api/.env`;
    expect(result.stackDirectory).toBe(`${workspace.stacksRoot}/acme/payments-api`);
    expect(existsSync(composePath)).toBe(true);
    expect(existsSync(deployEnvPath)).toBe(true);
    expect(existsSync(stackEnvPath)).toBe(true);

    const composeContent = readFileSync(composePath, 'utf8');
    expect(composeContent).toContain('x-deploy-webhook:');
    expect(composeContent).toContain('image: ${IMAGE_NAME}:${IMAGE_TAG}');
    expect(composeContent).toContain('postgres:16-alpine');

    const repoConfigPath = `${workspace.reposConfigPath}/acme--payments-api.yml`;
    const repoConfigContent = readFileSync(repoConfigPath, 'utf8');
    expect(repoConfigContent).toContain('services:');
    expect(repoConfigContent).toContain('- app');
    expect(repoConfigContent).not.toContain('- postgres');

    const stackEnvContent = readFileSync(stackEnvPath, 'utf8');
    const postgresPasswordLine = stackEnvContent
      .split('\n')
      .find((line) => line.startsWith('POSTGRES_POSTGRES_PASSWORD='));
    expect(postgresPasswordLine).toBeDefined();
    expect(postgresPasswordLine).not.toContain('postgres-password');

    workspace.cleanup();
  });

  it('preserves generated service secrets when regenerating a managed stack', () => {
    const workspace = createTempAdminWorkspace();
    process.env.REPOS_CONFIG_PATH = workspace.reposConfigPath;
    process.env.SERVICE_ENV_PATH = workspace.serviceEnvPath;
    process.env.STACKS_ROOT = workspace.stacksRoot;

    initializeManagedStack({
      repository: 'acme/payments-api',
      environment: 'production',
      services: [
        {
          repository: 'acme/payments-api',
          environment: 'production',
          kind: 'app',
          serviceName: 'app',
        },
        {
          repository: 'acme/payments-api',
          environment: 'production',
          kind: 'redis',
          serviceName: 'redis',
        },
      ],
    });

    const stackEnvPath = `${workspace.stacksRoot}/acme/payments-api/.env`;
    const firstEnv = readFileSync(stackEnvPath, 'utf8');
    const firstPasswordLine = firstEnv
      .split('\n')
      .find((line) => line.startsWith('REDIS_REDIS_PASSWORD='));

    addManagedStackService({
      repository: 'acme/payments-api',
      environment: 'production',
      kind: 'nginx',
      serviceName: 'nginx',
      targetService: 'app',
      targetPort: 3000,
      port: 80,
    });

    const secondEnv = readFileSync(stackEnvPath, 'utf8');
    const secondPasswordLine = secondEnv
      .split('\n')
      .find((line) => line.startsWith('REDIS_REDIS_PASSWORD='));

    expect(firstPasswordLine).toBeDefined();
    expect(secondPasswordLine).toBe(firstPasswordLine);

    workspace.cleanup();
  });
});
