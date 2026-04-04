import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import yaml from 'js-yaml';

import { resolveConfigPaths, resolveServiceEnvPath } from '../../config/paths';
import { ServerYamlSchema, type ServerYaml } from '../../config/schema';
import { resolveRequiredString, resolveOptionalString } from '../io';

export interface InitOptions {
  publicUrl?: string;
  port?: number;
  stacksRoot?: string;
  nonInteractive?: boolean;
}

export interface InitResult {
  changed: boolean;
  publicUrl: string;
  port: number;
  stacksRoot: string;
  serverConfigPath: string;
}

function readServerYamlRaw(serverConfigPath: string): Record<string, unknown> {
  if (!existsSync(serverConfigPath)) {
    throw new Error(`Config file not found: ${serverConfigPath}`);
  }
  return yaml.load(readFileSync(serverConfigPath, 'utf8')) as Record<string, unknown>;
}

function writeServerYaml(serverConfigPath: string, raw: Record<string, unknown>): void {
  writeFileSync(serverConfigPath, yaml.dump(raw, { lineWidth: 120 }), 'utf8');
}

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const { serverConfigPath } = resolveConfigPaths();
  const envPath = resolveServiceEnvPath();

  // Load current YAML
  const raw = readServerYamlRaw(serverConfigPath);
  const server = (raw.server ?? {}) as Record<string, unknown>;

  const currentPublicUrl = (server.public_url as string | undefined) ?? '';
  const currentPort = (server.port as number | undefined) ?? 8080;

  // Read STACKS_ROOT from env
  let currentStacksRoot = '/opt/stacks';
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf8');
    const match = envContent.match(/^STACKS_ROOT=(.+)$/m);
    if (match) currentStacksRoot = match[1].trim().replace(/^"(.*)"$/, '$1');
  }

  // Resolve values (interactive or from options)
  const publicUrl = await resolveRequiredString(
    options.publicUrl ?? (currentPublicUrl || undefined),
    'Public webhook URL (e.g. https://deploy.midominio.com)',
    currentPublicUrl || undefined,
  );

  const portStr = await resolveOptionalString(
    options.port !== undefined ? String(options.port) : undefined,
    'Port',
    String(currentPort),
  );
  const port = parseInt(portStr ?? String(currentPort), 10);

  const stacksRoot = await resolveRequiredString(
    options.stacksRoot ?? currentStacksRoot,
    'Stacks directory',
    currentStacksRoot,
  );

  // Detect changes
  const changed =
    publicUrl !== currentPublicUrl || port !== currentPort || stacksRoot !== currentStacksRoot;

  if (!changed) {
    return { changed: false, publicUrl, port, stacksRoot, serverConfigPath };
  }

  // Update server.yml
  server.public_url = publicUrl;
  server.port = port;
  raw.server = server;
  writeServerYaml(serverConfigPath, raw);

  // Update STACKS_ROOT in .env
  if (existsSync(envPath)) {
    let envContent = readFileSync(envPath, 'utf8');
    if (/^STACKS_ROOT=/m.test(envContent)) {
      envContent = envContent.replace(/^STACKS_ROOT=.*$/m, `STACKS_ROOT=${stacksRoot}`);
    } else {
      envContent += `\nSTACKS_ROOT=${stacksRoot}\n`;
    }
    writeFileSync(envPath, envContent, 'utf8');
  }

  // Validate new config is parseable
  const parsed = yaml.load(readFileSync(serverConfigPath, 'utf8')) as unknown;
  ServerYamlSchema.parse(parsed);

  // Restart webhook to apply changes
  try {
    const composeDir = resolve(serverConfigPath, '..', '..');
    execSync('docker compose restart webhook', { cwd: composeDir, stdio: 'pipe' });
  } catch {
    // Non-fatal: service may not be running yet
  }

  return { changed: true, publicUrl, port, stacksRoot, serverConfigPath };
}
