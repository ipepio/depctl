import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import yaml from 'js-yaml';

import { ConfigError } from '../../config/errors';
import { readComposeDocument } from '../../config/compose';
import { getStackDirectory } from '../../config/paths';
import { readEnvFile, upsertManagedEnvBlock } from '../../config/service-env';
import { ensureRepositoryEnvironment, syncEnvironmentWithStack } from './repo-config';
import { buildStackArtifacts } from '../stack/catalog';
import {
  type ManagedStackMetadata,
  type ManagedStackService,
  type SupportedServiceKind,
} from '../stack/types';

export interface StackMutationResult {
  repository: string;
  environment: string;
  stackDirectory: string;
  services: string[];
}

export interface StackServiceInput {
  repository: string;
  environment: string;
  kind: SupportedServiceKind;
  serviceName?: string;
  port?: number;
  internalPort?: number;
  command?: string;
  healthcheckPath?: string;
  databaseName?: string;
  username?: string;
  password?: string;
  targetService?: string;
  targetPort?: number;
  appendOnly?: boolean;
}

function getComposePath(repository: string): string {
  return join(getStackDirectory(repository), 'docker-compose.yml');
}

function getStackEnvPath(repository: string): string {
  return join(getStackDirectory(repository), '.env');
}

function getDeployEnvPath(repository: string): string {
  return join(getStackDirectory(repository), '.deploy.env');
}

function createManagedService(
  input: StackServiceInput,
  existing?: ManagedStackService,
): ManagedStackService {
  const serviceName = input.serviceName ?? existing?.serviceName ?? input.kind;
  const deployable = input.kind === 'app' || input.kind === 'worker';
  const passwordEnvKey =
    input.kind === 'postgres' || input.kind === 'redis'
      ? (existing?.passwordEnvKey ??
        `${serviceName
          .replace(/[^a-zA-Z0-9]/g, '_')
          .replace(/_+/g, '_')
          .toUpperCase()}_${input.kind === 'redis' ? 'REDIS_PASSWORD' : 'POSTGRES_PASSWORD'}`)
      : undefined;

  return {
    kind: input.kind,
    serviceName,
    deployable,
    port: input.port ?? existing?.port,
    internalPort: input.internalPort ?? existing?.internalPort,
    command: input.command ?? existing?.command,
    healthcheckPath: input.healthcheckPath ?? existing?.healthcheckPath,
    databaseName: input.databaseName ?? existing?.databaseName,
    username: input.username ?? existing?.username,
    passwordEnvKey,
    appendOnly: input.appendOnly ?? existing?.appendOnly,
    targetService: input.targetService ?? existing?.targetService,
    targetPort: input.targetPort ?? existing?.targetPort,
  };
}

function writeManagedStack(metadata: ManagedStackMetadata): StackMutationResult {
  const stackDirectory = getStackDirectory(metadata.repository);
  mkdirSync(stackDirectory, { recursive: true });

  const artifacts = buildStackArtifacts(
    metadata,
    readEnvFile(getStackEnvPath(metadata.repository)),
  );
  writeFileSync(
    getComposePath(metadata.repository),
    yaml.dump(artifacts.composeFile, { noRefs: true, lineWidth: 120 }),
    'utf8',
  );

  for (const block of artifacts.envBlocks) {
    upsertManagedEnvBlock(getStackEnvPath(metadata.repository), block.blockId, block.entries);
  }

  if (!existsSync(getDeployEnvPath(metadata.repository))) {
    const deployEnvContent = Object.entries(artifacts.deployEnvEntries)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    writeFileSync(getDeployEnvPath(metadata.repository), `${deployEnvContent}\n`, 'utf8');
  }

  for (const extraFile of artifacts.extraFiles) {
    writeFileSync(join(stackDirectory, extraFile.relativePath), extraFile.content, 'utf8');
  }

  const appService = metadata.services.find((service) => service.kind === 'app');
  const healthcheckUrl =
    appService?.port && appService.healthcheckPath
      ? `http://127.0.0.1:${appService.port}${appService.healthcheckPath}`
      : undefined;

  syncEnvironmentWithStack({
    repository: metadata.repository,
    environment: metadata.environment,
    composeFile: getComposePath(metadata.repository),
    runtimeEnvFile: getDeployEnvPath(metadata.repository),
    imageName: `ghcr.io/${metadata.repository}`,
    services: artifacts.deployableServices,
    healthcheckUrl,
  });

  return {
    repository: metadata.repository,
    environment: metadata.environment,
    stackDirectory,
    services: metadata.services.map((service) => service.serviceName),
  };
}

function readManagedMetadata(repository: string): ManagedStackMetadata {
  const document = readComposeDocument(getComposePath(repository));
  const metadata = document['x-deploy-webhook'];
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new ConfigError(`Stack is not managed by docker-deploy-webhook: ${repository}`);
  }

  return metadata as ManagedStackMetadata;
}

export function initializeManagedStack(input: {
  repository: string;
  environment: string;
  services: StackServiceInput[];
}): StackMutationResult {
  ensureRepositoryEnvironment(input.repository, input.environment);

  const metadata: ManagedStackMetadata = {
    managed: true,
    version: 1,
    repository: input.repository,
    environment: input.environment,
    services: input.services.map((service) => createManagedService(service)),
  };

  return writeManagedStack(metadata);
}

export function addManagedStackService(input: StackServiceInput): StackMutationResult {
  const metadata = readManagedMetadata(input.repository);
  const service = createManagedService(input);
  if (metadata.services.some((entry) => entry.serviceName === service.serviceName)) {
    throw new ConfigError(`Service already exists in stack: ${service.serviceName}`);
  }

  const nextMetadata: ManagedStackMetadata = {
    ...metadata,
    services: [...metadata.services, service],
  };

  const result = writeManagedStack(nextMetadata);
  if (input.password && service.passwordEnvKey) {
    upsertManagedEnvBlock(
      getStackEnvPath(input.repository),
      `stack-service:${service.serviceName}`,
      {
        [service.passwordEnvKey]: input.password,
      },
    );
  }
  return result;
}

export function editManagedStackService(
  input: StackServiceInput & { serviceName: string },
): StackMutationResult {
  const metadata = readManagedMetadata(input.repository);
  const current = metadata.services.find((service) => service.serviceName === input.serviceName);
  if (!current) {
    throw new ConfigError(`Service not found in stack: ${input.serviceName}`);
  }

  const nextService = createManagedService(input, current);
  const nextMetadata: ManagedStackMetadata = {
    ...metadata,
    services: metadata.services.map((service) =>
      service.serviceName === input.serviceName ? nextService : service,
    ),
  };

  const result = writeManagedStack(nextMetadata);
  if (input.password && nextService.passwordEnvKey) {
    upsertManagedEnvBlock(
      getStackEnvPath(input.repository),
      `stack-service:${nextService.serviceName}`,
      {
        [nextService.passwordEnvKey]: input.password,
      },
    );
  }
  return result;
}

export function readStackMetadata(repository: string): ManagedStackMetadata {
  return readManagedMetadata(repository);
}
