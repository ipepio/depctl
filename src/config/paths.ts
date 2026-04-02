import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

const DEFAULT_SERVER_CONFIG_PATH = './config/server.yml';
const DEFAULT_REPOS_CONFIG_PATH = './config/repos';
const DEFAULT_SERVICE_ENV_PATH = './.env';
const DEFAULT_STACK_ROOT = '/opt/stacks';

export interface ResolvedConfigPaths {
  serverConfigPath: string;
  reposConfigPath: string;
}

export function resolveConfigPaths(options?: {
  serverConfigPath?: string;
  reposConfigPath?: string;
}): ResolvedConfigPaths {
  return {
    serverConfigPath: resolve(
      options?.serverConfigPath ?? process.env.CONFIG_PATH ?? DEFAULT_SERVER_CONFIG_PATH,
    ),
    reposConfigPath: resolve(
      options?.reposConfigPath ?? process.env.REPOS_CONFIG_PATH ?? DEFAULT_REPOS_CONFIG_PATH,
    ),
  };
}

export function resolveServiceEnvPath(): string {
  return resolve(process.env.SERVICE_ENV_PATH ?? DEFAULT_SERVICE_ENV_PATH);
}

export function getManagedStackRoot(): string {
  return process.env.STACKS_ROOT ?? DEFAULT_STACK_ROOT;
}

export function getStackDirectory(repository: string): string {
  return join(getManagedStackRoot(), repository);
}

export function ensureDirectory(filePath: string): void {
  if (!existsSync(filePath)) {
    mkdirSync(filePath, { recursive: true });
  }
}
