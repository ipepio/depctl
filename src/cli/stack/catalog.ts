import {
  type StackBuildArtifacts,
  type ManagedStackMetadata,
  type ManagedStackService,
} from './types';
import { generateHexSecret } from '../secrets';

function quoteEnv(key: string): string {
  return `\${${key}}`;
}

function toEnvPrefix(serviceName: string): string {
  return serviceName
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function getExistingOrDefault(
  existingEntries: Record<string, string>,
  key: string,
  fallback: string,
): string {
  return existingEntries[key] ?? fallback;
}

function getExistingOrGeneratedSecret(
  existingEntries: Record<string, string>,
  key: string,
): string {
  return existingEntries[key] ?? generateHexSecret(24);
}

function buildAppService(service: ManagedStackService): Record<string, unknown> {
  const appService: Record<string, unknown> = {
    image: '${IMAGE_NAME}:${IMAGE_TAG}',
    restart: 'unless-stopped',
    env_file: ['.env', '.deploy.env'],
  };

  if (service.port) {
    const containerPort = service.internalPort ?? service.port;
    appService.ports = [`${service.port}:${containerPort}`];
  }

  return appService;
}

function buildWorkerService(service: ManagedStackService): Record<string, unknown> {
  const workerService: Record<string, unknown> = {
    image: '${IMAGE_NAME}:${IMAGE_TAG}',
    restart: 'unless-stopped',
    env_file: ['.env', '.deploy.env'],
  };

  if (service.command) {
    workerService.command = service.command.split(' ');
  }

  return workerService;
}

function buildPostgresService(
  service: ManagedStackService,
  existingEntries: Record<string, string>,
): {
  compose: Record<string, unknown>;
  envEntries: Record<string, string>;
  volumeName: string;
} {
  const prefix = toEnvPrefix(service.serviceName);
  const dbKey = `${prefix}_POSTGRES_DB`;
  const userKey = `${prefix}_POSTGRES_USER`;
  const passwordKey = service.passwordEnvKey ?? `${prefix}_POSTGRES_PASSWORD`;
  const databaseName = getExistingOrDefault(existingEntries, dbKey, service.databaseName ?? 'app');
  const username = getExistingOrDefault(existingEntries, userKey, service.username ?? 'app');
  const password = getExistingOrGeneratedSecret(existingEntries, passwordKey);

  return {
    compose: {
      image: 'postgres:16-alpine',
      restart: 'unless-stopped',
      env_file: ['.env'],
      environment: {
        POSTGRES_DB: quoteEnv(dbKey),
        POSTGRES_USER: quoteEnv(userKey),
        POSTGRES_PASSWORD: quoteEnv(passwordKey),
      },
      volumes: [`${service.serviceName}_data:/var/lib/postgresql/data`],
      healthcheck: {
        test: ['CMD-SHELL', `pg_isready -U ${username} -d ${databaseName}`],
        interval: '10s',
        timeout: '5s',
        retries: 5,
      },
    },
    envEntries: {
      [dbKey]: databaseName,
      [userKey]: username,
      [passwordKey]: password,
    },
    volumeName: `${service.serviceName}_data`,
  };
}

function buildRedisService(
  service: ManagedStackService,
  existingEntries: Record<string, string>,
): {
  compose: Record<string, unknown>;
  envEntries: Record<string, string>;
  volumeName: string;
} {
  const prefix = toEnvPrefix(service.serviceName);
  const passwordKey = service.passwordEnvKey ?? `${prefix}_REDIS_PASSWORD`;
  const password = getExistingOrGeneratedSecret(existingEntries, passwordKey);
  const command = [
    'redis-server',
    '--appendonly',
    service.appendOnly === false ? 'no' : 'yes',
    '--requirepass',
    quoteEnv(passwordKey),
  ];

  return {
    compose: {
      image: 'redis:7-alpine',
      restart: 'unless-stopped',
      env_file: ['.env'],
      command,
      volumes: [`${service.serviceName}_data:/data`],
      healthcheck: undefined,
    },
    envEntries: {
      [passwordKey]: password,
    },
    volumeName: `${service.serviceName}_data`,
  };
}

function buildNginxService(service: ManagedStackService): {
  compose: Record<string, unknown>;
  configPath: string;
  configContent: string;
} {
  const targetService = service.targetService ?? 'app';
  const targetPort = service.targetPort ?? 3000;
  const configFile = `${service.serviceName}.nginx.conf`;
  const configContent = [
    'server {',
    '  listen 80;',
    '  location / {',
    `    proxy_pass http://${targetService}:${targetPort};`,
    '    proxy_set_header Host $host;',
    '    proxy_set_header X-Real-IP $remote_addr;',
    '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '  }',
    '}',
    '',
  ].join('\n');

  return {
    compose: {
      image: 'nginx:1.27-alpine',
      restart: 'unless-stopped',
      depends_on: [targetService],
      ports: [`${service.port ?? 80}:80`],
      volumes: [`./${configFile}:/etc/nginx/conf.d/default.conf:ro`],
    },
    configPath: configFile,
    configContent,
  };
}

export function buildStackArtifacts(
  metadata: ManagedStackMetadata,
  existingEnvEntries: Record<string, string> = {},
): StackBuildArtifacts {
  const services: Record<string, Record<string, unknown>> = {};
  const volumes: Record<string, Record<string, never>> = {};
  const envBlocks: Array<{ blockId: string; entries: Record<string, string> }> = [];
  const extraFiles: Array<{ relativePath: string; content: string }> = [];
  const deployableServices: string[] = [];

  for (const service of metadata.services) {
    switch (service.kind) {
      case 'app': {
        services[service.serviceName] = buildAppService(service);
        deployableServices.push(service.serviceName);
        break;
      }
      case 'worker': {
        services[service.serviceName] = buildWorkerService(service);
        deployableServices.push(service.serviceName);
        break;
      }
      case 'postgres': {
        const postgres = buildPostgresService(service, existingEnvEntries);
        services[service.serviceName] = postgres.compose;
        volumes[postgres.volumeName] = {};
        envBlocks.push({
          blockId: `stack-service:${service.serviceName}`,
          entries: postgres.envEntries,
        });
        break;
      }
      case 'redis': {
        const redis = buildRedisService(service, existingEnvEntries);
        services[service.serviceName] = redis.compose;
        volumes[redis.volumeName] = {};
        envBlocks.push({
          blockId: `stack-service:${service.serviceName}`,
          entries: redis.envEntries,
        });
        break;
      }
      case 'nginx': {
        const nginx = buildNginxService(service);
        services[service.serviceName] = nginx.compose;
        extraFiles.push({
          relativePath: nginx.configPath,
          content: nginx.configContent,
        });
        break;
      }
    }
  }

  return {
    composeFile: {
      'x-deploy-webhook': metadata,
      services,
      volumes: Object.keys(volumes).length > 0 ? volumes : undefined,
    },
    envBlocks,
    deployEnvEntries: {
      IMAGE_NAME: `ghcr.io/${metadata.repository}`,
      IMAGE_TAG: 'bootstrap',
    },
    extraFiles,
    deployableServices,
  };
}
