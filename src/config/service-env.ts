import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

import { ensureDirectory, resolveServiceEnvPath } from './paths';

export type EnvEntries = Record<string, string>;

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex <= 0) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  const value = trimmed.slice(separatorIndex + 1);
  if (!key) {
    return null;
  }

  return [key, value];
}

export function readEnvFile(filePath = resolveServiceEnvPath()): EnvEntries {
  if (!existsSync(filePath)) {
    return {};
  }

  const entries: EnvEntries = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }

    const [key, value] = parsed;
    entries[key] = value;
  }

  return entries;
}

export function applyEnvEntriesToProcess(entries: EnvEntries): void {
  for (const [key, value] of Object.entries(entries)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadServiceEnvIntoProcess(): EnvEntries {
  const entries = readEnvFile();
  applyEnvEntriesToProcess(entries);
  return entries;
}

function formatManagedEnvBlock(blockId: string, entries: EnvEntries): string {
  const lines = [`# BEGIN docker-deploy-webhook ${blockId}`];
  for (const [key, value] of Object.entries(entries)) {
    lines.push(`${key}=${value}`);
  }
  lines.push(`# END docker-deploy-webhook ${blockId}`);
  return `${lines.join('\n')}\n`;
}

export function upsertManagedEnvBlock(
  filePath: string,
  blockId: string,
  entries: EnvEntries,
): void {
  ensureDirectory(dirname(filePath));

  const startMarker = `# BEGIN docker-deploy-webhook ${blockId}`;
  const endMarker = `# END docker-deploy-webhook ${blockId}`;
  const content = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  const block = formatManagedEnvBlock(blockId, entries);

  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);

  let nextContent = content;
  if (startIndex >= 0 && endIndex >= startIndex) {
    const blockEnd = endIndex + endMarker.length;
    const suffix = nextContent.slice(blockEnd).replace(/^\r?\n/, '');
    nextContent = `${nextContent.slice(0, startIndex)}${block}${suffix}`;
  } else {
    nextContent = nextContent.trimEnd();
    nextContent = nextContent.length > 0 ? `${nextContent}\n\n${block}` : block;
  }

  writeFileSync(filePath, nextContent, 'utf8');
  applyEnvEntriesToProcess(entries);
}

export function readManagedBlockValues(filePath: string, keys: string[]): EnvEntries {
  const entries = readEnvFile(filePath);
  return Object.fromEntries(
    keys.filter((key) => typeof entries[key] === 'string').map((key) => [key, entries[key]]),
  );
}
