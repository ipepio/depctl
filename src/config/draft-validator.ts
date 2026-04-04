import { getManagedStackRoot } from './paths';
import { RepoYamlSchema, type RepoYaml } from './schema';

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

/**
 * Task 8.1 — Detect environments that share branches or tag patterns.
 * A repo should route any given ref_name to at most one environment.
 */
function detectEnvironmentOverlap(repoYaml: RepoYaml): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const envEntries = Object.entries(repoYaml.environments);

  for (let i = 0; i < envEntries.length; i++) {
    const [envA, configA] = envEntries[i];
    for (let j = i + 1; j < envEntries.length; j++) {
      const [envB, configB] = envEntries[j];

      // Shared branch names → same ref_name would match both
      const sharedBranches = configA.allowed_branches.filter((b) =>
        configB.allowed_branches.includes(b),
      );
      if (sharedBranches.length > 0) {
        issues.push({
          level: 'warning',
          message:
            `Environments "${envA}" and "${envB}" share allowed_branches: [${sharedBranches.join(', ')}]. ` +
            `A webhook with ref_name="${sharedBranches[0]}" would match both.`,
        });
      }

      // Identical tag patterns → same tag would match both
      if (configA.allowed_tag_pattern === configB.allowed_tag_pattern) {
        issues.push({
          level: 'warning',
          message:
            `Environments "${envA}" and "${envB}" have identical allowed_tag_pattern "${configA.allowed_tag_pattern}". ` +
            `Tags may match both environments ambiguously.`,
        });
      }
    }
  }

  return issues;
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

  // Task 8.1: detect overlapping environments
  issues.push(...detectEnvironmentOverlap(repoYaml));

  return issues;
}
