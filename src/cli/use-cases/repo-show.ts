import { type RepoYaml } from '../../config/schema';
import { getStackDirectory } from '../../config/paths';

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

/**
 * Task 8.2 — Human-readable matrix of environments for a repo.
 */
export function formatRepoShow(repoYaml: RepoYaml): string {
  const lines: string[] = [''];
  const stackRoot = getStackDirectory(repoYaml.repository);

  lines.push(`  Repository: ${repoYaml.repository}`);
  lines.push(`  Bearer env: ${repoYaml.webhook.bearer_token_env}`);
  lines.push(`  HMAC env:   ${repoYaml.webhook.hmac_secret_env}`);
  lines.push('');

  const header = `  ${pad('Env', 14)}${pad('Branches', 18)}${pad('Tags', 28)}${pad('Workflows', 14)}Stack`;
  const divider = '  ' + '─'.repeat(96);

  lines.push(header);
  lines.push(divider);

  for (const [envName, envConfig] of Object.entries(repoYaml.environments)) {
    const branches = envConfig.allowed_branches.join(', ');
    const tagPattern = envConfig.allowed_tag_pattern;
    const workflows = envConfig.allowed_workflows.join(', ');
    const stackPath = envConfig.compose_file
      ? envConfig.compose_file.replace('/docker-compose.yml', '')
      : stackRoot;

    lines.push(
      `  ${pad(envName, 14)}${pad(branches, 18)}${pad(tagPattern, 28)}${pad(workflows, 14)}${stackPath}`,
    );

    if (envConfig.healthcheck?.enabled && envConfig.healthcheck.url) {
      lines.push(`  ${pad('', 14)}Healthcheck: ${envConfig.healthcheck.url}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
