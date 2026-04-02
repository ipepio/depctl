import { getManagedStackRoot } from './paths';
import { RepoYamlSchema, type RepoYaml } from './schema';

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

export function validateRepoDraft(repoYaml: RepoYaml): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const stackRoot = getManagedStackRoot();
  RepoYamlSchema.parse(repoYaml);

  for (const [environment, config] of Object.entries(repoYaml.environments)) {
    if (!config.compose_file.startsWith('/')) {
      issues.push({
        level: 'error',
        message: `Environment ${environment} compose_file must be an absolute path`,
      });
    }

    if (!config.runtime_env_file.startsWith('/')) {
      issues.push({
        level: 'error',
        message: `Environment ${environment} runtime_env_file must be an absolute path`,
      });
    }

    if (!config.compose_file.startsWith(`${stackRoot}/`)) {
      issues.push({
        level: 'warning',
        message: `Environment ${environment} compose_file is outside ${stackRoot}`,
      });
    }

    if (!config.runtime_env_file.startsWith(`${stackRoot}/`)) {
      issues.push({
        level: 'warning',
        message: `Environment ${environment} runtime_env_file is outside ${stackRoot}`,
      });
    }
  }

  return issues;
}
