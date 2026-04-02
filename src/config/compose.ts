import { existsSync, readFileSync } from 'fs';

import yaml from 'js-yaml';

import { ConfigError } from './errors';

export interface ComposeDocument {
  services?: Record<string, unknown>;
  volumes?: Record<string, unknown>;
  [key: string]: unknown;
}

export function readComposeDocument(filePath: string): ComposeDocument {
  if (!existsSync(filePath)) {
    throw new ConfigError(`Compose file does not exist: ${filePath}`);
  }

  const parsed = yaml.load(readFileSync(filePath, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(`Compose file is not a valid object: ${filePath}`);
  }

  return parsed as ComposeDocument;
}

export function getComposeServiceNames(filePath: string): string[] {
  const document = readComposeDocument(filePath);
  const services = document.services;
  if (!services || typeof services !== 'object' || Array.isArray(services)) {
    return [];
  }

  return Object.keys(services);
}
