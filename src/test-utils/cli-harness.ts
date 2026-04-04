import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

// ─────────────────────────────────────────────
// Harness types
// ─────────────────────────────────────────────

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface HarnessWorkspace {
  rootDir: string;
  configPath: string;
  reposConfigPath: string;
  serviceEnvPath: string;
  stacksRoot: string;
  stateDir: string;
  cleanup: () => void;
}

// ─────────────────────────────────────────────
// Workspace builder (F10.A2 — fixture builders)
// ─────────────────────────────────────────────

export function createHarnessWorkspace(): HarnessWorkspace {
  const rootDir = mkdtempSync(join(tmpdir(), 'depctl-harness-'));
  const configPath = join(rootDir, 'config', 'server.yml');
  const reposConfigPath = join(rootDir, 'config', 'repos');
  const serviceEnvPath = join(rootDir, '.env');
  const stacksRoot = join(rootDir, 'stacks');
  const stateDir = join(rootDir, 'data', 'state');

  mkdirSync(join(rootDir, 'config'), { recursive: true });
  mkdirSync(reposConfigPath, { recursive: true });
  mkdirSync(stacksRoot, { recursive: true });
  mkdirSync(stateDir, { recursive: true });

  // Minimal server.yml
  writeFileSync(configPath, [
    'server:',
    '  id: test-server',
    '  public_url: https://deploy.test.example.com',
    '  port: 8080',
    '  security:',
    '    admin_read_token_env: DEPLOY_ADMIN_READ_TOKEN',
    '    admin_write_token_env: DEPLOY_ADMIN_WRITE_TOKEN',
  ].join('\n') + '\n', 'utf8');

  // Minimal .env
  writeFileSync(serviceEnvPath, [
    'DEPLOY_ADMIN_READ_TOKEN=test-read-token',
    'DEPLOY_ADMIN_WRITE_TOKEN=test-write-token',
    'REDIS_URL=redis://redis:6379',
  ].join('\n') + '\n', 'utf8');

  return {
    rootDir,
    configPath,
    reposConfigPath,
    serviceEnvPath,
    stacksRoot,
    stateDir,
    cleanup: () => rmSync(rootDir, { recursive: true, force: true }),
  };
}

export function addRepoFixture(
  workspace: HarnessWorkspace,
  repository: string,
  overrides: Partial<Record<string, string>> = {},
): string {
  const [owner, repo] = repository.split('/');
  const stackDir = join(workspace.stacksRoot, owner, repo, 'production');
  mkdirSync(stackDir, { recursive: true });

  const composeFile = join(stackDir, 'docker-compose.yml');
  const deployEnvFile = join(stackDir, '.deploy.env');

  writeFileSync(composeFile, [
    'services:',
    '  app:',
    `    image: \${IMAGE_NAME}:\${IMAGE_TAG:-latest}`,
    '    restart: unless-stopped',
  ].join('\n') + '\n', 'utf8');

  writeFileSync(deployEnvFile, 'IMAGE_NAME=ghcr.io/test/app\nIMAGE_TAG=latest\n', 'utf8');

  const envPrefix = repository.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  const repoYaml = [
    `repository: ${repository}`,
    'webhook:',
    `  bearer_token_env: ${envPrefix}_WEBHOOK_BEARER`,
    `  hmac_secret_env: ${envPrefix}_WEBHOOK_HMAC`,
    'environments:',
    '  production:',
    `    image_name: ghcr.io/${repository}`,
    `    compose_file: ${composeFile}`,
    `    runtime_env_file: ${deployEnvFile}`,
    '    services: [app]',
    '    allowed_workflows: [Release]',
    '    allowed_branches: [master]',
    `    allowed_tag_pattern: '^v[0-9]+\\.[0-9]+\\.[0-9]+$'`,
    '    healthcheck:',
    '      enabled: false',
  ].join('\n') + '\n';

  const fileName = repository.replace('/', '--') + '.yml';
  const filePath = join(workspace.reposConfigPath, fileName);
  writeFileSync(filePath, repoYaml, 'utf8');

  // Write secrets into .env
  const existing = existsSync(workspace.serviceEnvPath)
    ? require('fs').readFileSync(workspace.serviceEnvPath, 'utf8') as string
    : '';
  writeFileSync(workspace.serviceEnvPath,
    existing +
    `\n# BEGIN docker-deploy-webhook repo ${repository}\n` +
    `${envPrefix}_WEBHOOK_BEARER=test-bearer-token\n` +
    `${envPrefix}_WEBHOOK_HMAC=test-hmac-secret\n` +
    `# END docker-deploy-webhook repo ${repository}\n`,
    'utf8');

  return filePath;
}

// ─────────────────────────────────────────────
// CLI executor (F10.A1)
// ─────────────────────────────────────────────

const CLI_ENTRY = resolve(__dirname, '../../dist/index.js');

export function runCli(
  args: string[],
  workspace: HarnessWorkspace,
  extraEnv: Record<string, string> = {},
): CliResult {
  const result = spawnSync(process.execPath, [CLI_ENTRY, 'admin', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CONFIG_PATH: workspace.configPath,
      REPOS_CONFIG_PATH: workspace.reposConfigPath,
      SERVICE_ENV_PATH: workspace.serviceEnvPath,
      STACKS_ROOT: workspace.stacksRoot,
      STATE_DIR: workspace.stateDir,
      // Non-interactive: no stdin prompts
      ...extraEnv,
    },
    input: '',  // empty stdin to avoid hanging on prompts
    timeout: 10000,
  });

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function parseJson<T = unknown>(result: CliResult): T {
  return JSON.parse(result.stdout) as T;
}

export function normalizeOutput(output: string): string {
  return output
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/g, '<TIMESTAMP>')
    .replace(/\d+ms/g, '<Nms>')
    .replace(/\d+s\b/g, '<Ns>');
}
