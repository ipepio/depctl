import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface TempAdminWorkspace {
  rootDir: string;
  reposConfigPath: string;
  serviceEnvPath: string;
  stacksRoot: string;
  cleanup: () => void;
}

export function createTempAdminWorkspace(): TempAdminWorkspace {
  const rootDir = mkdtempSync(join(tmpdir(), 'docker-deploy-webhook-admin-'));
  const reposConfigPath = join(rootDir, 'config', 'repos');
  const serviceEnvPath = join(rootDir, '.env');
  const stacksRoot = join(rootDir, 'stacks');

  mkdirSync(reposConfigPath, { recursive: true });
  mkdirSync(stacksRoot, { recursive: true });
  writeFileSync(serviceEnvPath, 'REDIS_URL=redis://redis:6379\n', 'utf8');

  return {
    rootDir,
    reposConfigPath,
    serviceEnvPath,
    stacksRoot,
    cleanup: () => {
      rmSync(rootDir, { recursive: true, force: true });
    },
  };
}
