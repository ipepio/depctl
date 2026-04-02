import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { extname, join } from 'path';

import yaml from 'js-yaml';

import { RepoYamlSchema, type RepoYaml } from './schema';
import { ConfigError } from './errors';
import { resolveConfigPaths } from './paths';

export interface RepoFileRecord {
  filePath: string;
  fileName: string;
  repoYaml: RepoYaml;
}

export function toRepoFileName(repository: string): string {
  return `${repository.replace('/', '--')}.yml`;
}

export function getRepoFilePath(repository: string): string {
  const { reposConfigPath } = resolveConfigPaths();
  return join(reposConfigPath, toRepoFileName(repository));
}

function parseRepoYamlFile(filePath: string): RepoYaml {
  const parsed = yaml.load(readFileSync(filePath, 'utf8')) as unknown;
  return RepoYamlSchema.parse(parsed);
}

export function listRepoFiles(): RepoFileRecord[] {
  const { reposConfigPath } = resolveConfigPaths();
  if (!existsSync(reposConfigPath)) {
    return [];
  }

  return readdirSync(reposConfigPath)
    .filter((entry) => ['.yml', '.yaml'].includes(extname(entry)))
    .sort()
    .map((entry) => {
      const filePath = join(reposConfigPath, entry);
      return {
        filePath,
        fileName: entry,
        repoYaml: parseRepoYamlFile(filePath),
      };
    });
}

export function findRepoFile(repository: string): RepoFileRecord | null {
  const canonicalPath = getRepoFilePath(repository);
  if (existsSync(canonicalPath)) {
    return {
      filePath: canonicalPath,
      fileName: toRepoFileName(repository),
      repoYaml: parseRepoYamlFile(canonicalPath),
    };
  }

  for (const file of listRepoFiles()) {
    if (file.repoYaml.repository === repository) {
      return file;
    }
  }

  return null;
}

export function writeRepoFile(repository: string, repoYaml: RepoYaml): string {
  const existing = findRepoFile(repository);
  const filePath = existing?.filePath ?? getRepoFilePath(repository);
  const { reposConfigPath } = resolveConfigPaths();
  mkdirSync(reposConfigPath, { recursive: true });
  writeFileSync(filePath, yaml.dump(repoYaml, { noRefs: true, lineWidth: 120 }), 'utf8');
  return filePath;
}

export function requireRepoFile(repository: string): RepoFileRecord {
  const file = findRepoFile(repository);
  if (!file) {
    throw new ConfigError(`Repository config file not found: ${repository}`);
  }
  return file;
}

export function readRepoFile(repository: string): RepoYaml {
  return requireRepoFile(repository).repoYaml;
}
