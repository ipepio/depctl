import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, resolve } from 'path';

import yaml from 'js-yaml';

import { findRepoFile, listRepoFiles } from '../../config/repo-files';
import { ConfigError } from '../../config/errors';
import { resolveRequiredString, resolveOptionalString } from '../io';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type WorkflowTrigger = 'tag' | 'branch' | 'both' | 'manual';

export interface WorkflowEnvConfig {
  environment: string;
  trigger: 'tag' | 'branch' | 'manual';
  ref: string; // tag pattern (v*.*.*) or branch name (master)
}

export interface WorkflowGeneratorOptions {
  repository?: string;
  workflowName?: string;
  buildDocker?: boolean;
  registry?: string;
  environments?: WorkflowEnvConfig[];
  nonInteractive?: boolean;
}

export interface WorkflowGeneratorResult {
  yaml: string;
  workflowName: string;
  repository: string;
  environments: WorkflowEnvConfig[];
  secretsNeeded: string[];
  validationWarnings: string[];
}

// ─────────────────────────────────────────────
// Task 7.3 — Validation helpers
// ─────────────────────────────────────────────

function validateAgainstRepoConfig(
  repository: string,
  workflowName: string,
  envConfigs: WorkflowEnvConfig[],
): string[] {
  const warnings: string[] = [];
  const repoFile = findRepoFile(repository);
  if (!repoFile) {
    warnings.push(`Repository "${repository}" is not configured in this deployer. Register it first with: deployctl repo add`);
    return warnings;
  }

  for (const envConfig of envConfigs) {
    const envDef = repoFile.repoYaml.environments[envConfig.environment];
    if (!envDef) {
      warnings.push(`Environment "${envConfig.environment}" not found in repo config.`);
      continue;
    }

    if (!envDef.allowed_workflows.includes(workflowName)) {
      warnings.push(
        `Workflow name "${workflowName}" is not in allowed_workflows for ${envConfig.environment}. ` +
          `Allowed: [${envDef.allowed_workflows.join(', ')}]`,
      );
    }

    if (envConfig.trigger === 'tag') {
      try {
        const pattern = new RegExp(envDef.allowed_tag_pattern);
        const testTag = envConfig.ref.replace(/\*/g, '0');
        if (!pattern.test(testTag)) {
          warnings.push(
            `Tag pattern "${envConfig.ref}" may not match allowed_tag_pattern "${envDef.allowed_tag_pattern}" for ${envConfig.environment}.`,
          );
        }
      } catch {
        // ignore regex errors
      }
    }

    if (envConfig.trigger === 'branch' && !envDef.allowed_branches.includes(envConfig.ref)) {
      warnings.push(
        `Branch "${envConfig.ref}" is not in allowed_branches for ${envConfig.environment}. ` +
          `Allowed: [${envDef.allowed_branches.join(', ')}]`,
      );
    }
  }

  return warnings;
}

// ─────────────────────────────────────────────
// Task 7.2 — YAML generator
// ─────────────────────────────────────────────

function buildWebhookStep(
  workflowName: string,
  envConfig: WorkflowEnvConfig,
  secretSuffix: string,
): Record<string, unknown> {
  const payload = [
    `{"repository":"$\{{ github.repository }}","environment":"${envConfig.environment}",`,
    `"tag":"$\{{ steps.version.outputs.tag }}","sha":"$\{{ github.sha }}",`,
    `"workflow":"${workflowName}","ref_name":"$\{{ github.ref_name }}","run_id":$\{{ github.run_id }}}`,
  ].join('');

  return {
    name: `Notify deploy webhook (${envConfig.environment})`,
    if: 'success()',
    env: {
      [`DEPLOY_WEBHOOK_URL`]: `\${{ secrets.DEPLOY_WEBHOOK_URL${secretSuffix} }}`,
      [`DEPLOY_WEBHOOK_BEARER`]: `\${{ secrets.DEPLOY_WEBHOOK_BEARER${secretSuffix} }}`,
      [`DEPLOY_WEBHOOK_HMAC`]: `\${{ secrets.DEPLOY_WEBHOOK_HMAC${secretSuffix} }}`,
    },
    run: [
      'if [ -z "$DEPLOY_WEBHOOK_URL" ]; then',
      '  echo "::warning::DEPLOY_WEBHOOK_URL not configured, skipping"',
      '  exit 0',
      'fi',
      '',
      'TIMESTAMP=$(date +%s)',
      '',
      `PAYLOAD='${payload}'`,
      '',
      'SIGNATURE=$(printf "%s.%s" "$TIMESTAMP" "$PAYLOAD" | openssl dgst -sha256 -hmac "$DEPLOY_WEBHOOK_HMAC" -hex | awk \'{print $NF}\')',
      '',
      'echo "Sending deploy webhook to $DEPLOY_WEBHOOK_URL"',
      'HTTP_CODE=$(curl -s -o /tmp/wh_response.txt -w "%{http_code}" \\',
      '  -X POST "${DEPLOY_WEBHOOK_URL}/deploy" \\',
      '  -H "Content-Type: application/json" \\',
      '  -H "Authorization: Bearer $DEPLOY_WEBHOOK_BEARER" \\',
      '  -H "X-Deploy-Timestamp: $TIMESTAMP" \\',
      '  -H "X-Deploy-Signature: sha256=$SIGNATURE" \\',
      '  -d "$PAYLOAD" \\',
      '  --max-time 30)',
      '',
      'echo "Response: $HTTP_CODE"',
      'cat /tmp/wh_response.txt',
      '',
      'if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then',
      '  echo "::warning::Webhook responded with $HTTP_CODE"',
      'fi',
    ].join('\n'),
  };
}

function buildWorkflowYaml(opts: {
  repository: string;
  workflowName: string;
  buildDocker: boolean;
  registry: string;
  environments: WorkflowEnvConfig[];
}): string {
  const { workflowName, buildDocker, registry, environments, repository } = opts;

  // Build trigger section
  const onSection: Record<string, unknown> = {};
  const tagEnvs = environments.filter((e) => e.trigger === 'tag');
  const branchEnvs = environments.filter((e) => e.trigger === 'branch');
  const manualEnvs = environments.filter((e) => e.trigger === 'manual');

  if (tagEnvs.length > 0) {
    const tagPatterns = [...new Set(tagEnvs.map((e) => e.ref))];
    onSection.push = { tags: tagPatterns };
  }

  if (branchEnvs.length > 0) {
    const branchNames = [...new Set(branchEnvs.map((e) => e.ref))];
    if (onSection.push && typeof onSection.push === 'object') {
      (onSection.push as Record<string, unknown>).branches = branchNames;
    } else {
      onSection.push = { branches: branchNames };
    }
  }

  if (manualEnvs.length > 0) {
    onSection.workflow_dispatch = {};
  }

  // Build steps
  const steps: Record<string, unknown>[] = [
    {
      name: 'Checkout',
      uses: 'actions/checkout@v4',
      with: { 'fetch-depth': 0 },
    },
    {
      name: 'Extract version from tag',
      id: 'version',
      run: [
        'TAG="${GITHUB_REF#refs/tags/}"',
        'VERSION="${TAG#v}"',
        'echo "tag=$TAG" >> "$GITHUB_OUTPUT"',
        'echo "version=$VERSION" >> "$GITHUB_OUTPUT"',
        'echo "Tag: $TAG | Version: $VERSION"',
      ].join('\n'),
    },
  ];

  if (buildDocker) {
    const imageName =
      registry === 'ghcr.io'
        ? `${registry}/$\{{ github.repository }}`
        : `${registry}/${repository}`;

    steps.push({
      name: 'Login to registry',
      uses: 'docker/login-action@v3',
      with:
        registry === 'ghcr.io'
          ? {
              registry: 'ghcr.io',
              username: '${{ github.actor }}',
              password: '${{ secrets.GITHUB_TOKEN }}',
            }
          : {
              registry,
              username: '${{ secrets.REGISTRY_USERNAME }}',
              password: '${{ secrets.REGISTRY_PASSWORD }}',
            },
    });

    steps.push({
      name: 'Set up Docker Buildx',
      uses: 'docker/setup-buildx-action@v3',
    });

    steps.push({
      name: 'Build and push',
      uses: 'docker/build-push-action@v6',
      with: {
        context: '.',
        push: true,
        'build-args': 'APP_VERSION=${{ steps.version.outputs.version }}',
        tags: `${imageName}:$\{{ steps.version.outputs.tag }}\n${imageName}:latest`,
        'cache-from': 'type=gha',
        'cache-to': 'type=gha,mode=max',
      },
    });
  }

  // Webhook steps — one per environment, with conditional if needed
  const multiEnv = environments.length > 1;
  for (const envConfig of environments) {
    const secretSuffix = multiEnv
      ? `_${envConfig.environment.toUpperCase()}`
      : '';

    const step = buildWebhookStep(workflowName, envConfig, secretSuffix);

    // Add condition for multi-env routing
    if (multiEnv) {
      let condition = 'success()';
      if (envConfig.trigger === 'tag') {
        condition = `success() && startsWith(github.ref, 'refs/tags/')`;
      } else if (envConfig.trigger === 'branch') {
        condition = `success() && github.ref == 'refs/heads/${envConfig.ref}'`;
      }
      step.if = condition;
    }

    steps.push(step);
  }

  const workflow = {
    name: workflowName,
    on: onSection,
    permissions: buildDocker
      ? { contents: 'read', packages: 'write' }
      : { contents: 'read' },
    jobs: {
      release: {
        'runs-on': 'ubuntu-latest',
        steps,
      },
    },
  };

  return yaml.dump(workflow, { noRefs: true, lineWidth: 120, quotingType: '"' });
}

// ─────────────────────────────────────────────
// Task 7.1 — Interactive wizard
// ─────────────────────────────────────────────

export async function runWorkflowGeneratorWizard(
  opts: WorkflowGeneratorOptions = {},
): Promise<WorkflowGeneratorResult> {
  // List configured repos for hint
  const configuredRepos = listRepoFiles().map((f) => f.repoYaml.repository);
  const repoHint =
    configuredRepos.length > 0 ? configuredRepos[0] : 'owner/repo';

  const repository = await resolveRequiredString(
    opts.repository,
    `Repository (${configuredRepos.length > 0 ? configuredRepos.join(', ') : 'owner/repo'})`,
    repoHint,
  );

  const workflowName = await resolveRequiredString(
    opts.workflowName,
    'Workflow name (must match allowed_workflows in deployer config)',
    'Release',
  );

  const buildDockerStr = await resolveOptionalString(
    opts.buildDocker !== undefined ? (opts.buildDocker ? 'yes' : 'no') : undefined,
    'Build and push Docker image? (yes/no)',
    'yes',
  );
  const buildDocker = (buildDockerStr ?? 'yes').toLowerCase() !== 'no';

  const registry = await resolveRequiredString(
    opts.registry,
    'Docker registry',
    'ghcr.io',
  );

  // Load repo config to suggest environments and defaults
  const repoFile = findRepoFile(repository);
  const configuredEnvs = repoFile
    ? Object.keys(repoFile.repoYaml.environments)
    : ['production'];

  // Build environment configs
  let environments: WorkflowEnvConfig[];

  if (opts.environments && opts.environments.length > 0) {
    environments = opts.environments;
  } else {
    environments = [];
    for (const envName of configuredEnvs) {
      const envDef = repoFile?.repoYaml.environments[envName];
      const defaultBranch = envDef?.allowed_branches[0] ?? 'master';
      const defaultTagPattern = 'v*.*.*';

      process.stdout.write(`\n  Environment: ${envName}\n`);
      const triggerStr = await resolveOptionalString(
        undefined,
        '  Trigger: tag, branch, or manual',
        configuredEnvs.indexOf(envName) === 0 ? 'tag' : 'branch',
      );
      const trigger = (triggerStr ?? 'tag') as 'tag' | 'branch' | 'manual';

      let ref: string;
      if (trigger === 'tag') {
        ref = await resolveRequiredString(undefined, '  Tag pattern', defaultTagPattern);
      } else if (trigger === 'branch') {
        ref = await resolveRequiredString(undefined, '  Branch name', defaultBranch);
      } else {
        ref = 'manual';
      }

      environments.push({ environment: envName, trigger, ref });
    }
  }

  // Validation (Task 7.3)
  const validationWarnings = validateAgainstRepoConfig(repository, workflowName, environments);

  // Determine secrets needed
  const multiEnv = environments.length > 1;
  const secretsNeeded: string[] = [];
  for (const envConfig of environments) {
    const suffix = multiEnv ? `_${envConfig.environment.toUpperCase()}` : '';
    secretsNeeded.push(`DEPLOY_WEBHOOK_URL${suffix}`);
    secretsNeeded.push(`DEPLOY_WEBHOOK_BEARER${suffix}`);
    secretsNeeded.push(`DEPLOY_WEBHOOK_HMAC${suffix}`);
  }
  if (buildDocker && registry !== 'ghcr.io') {
    secretsNeeded.push('REGISTRY_USERNAME', 'REGISTRY_PASSWORD');
  }

  const workflowYaml = buildWorkflowYaml({
    repository,
    workflowName,
    buildDocker,
    registry,
    environments,
  });

  return {
    yaml: workflowYaml,
    workflowName,
    repository,
    environments,
    secretsNeeded,
    validationWarnings,
  };
}

// ─────────────────────────────────────────────
// Task 7.3 — Output / write helpers
// ─────────────────────────────────────────────

export function printWorkflowResult(result: WorkflowGeneratorResult): void {
  const divider = '━'.repeat(60);

  if (result.validationWarnings.length > 0) {
    process.stdout.write('\n⚠  Validation warnings:\n');
    for (const w of result.validationWarnings) {
      process.stdout.write(`  - ${w}\n`);
    }
  }

  process.stdout.write(`\n${divider}\n`);
  process.stdout.write('  .github/workflows/release.yml\n');
  process.stdout.write(`${divider}\n\n`);
  process.stdout.write(result.yaml);
  process.stdout.write(`\n${divider}\n`);
  process.stdout.write('  GitHub Secrets required:\n');
  process.stdout.write('  Settings → Secrets and variables → Actions\n\n');
  for (const secret of result.secretsNeeded) {
    process.stdout.write(`  ${secret}\n`);
  }
  process.stdout.write(`${divider}\n\n`);
}

export function writeWorkflowToFile(
  result: WorkflowGeneratorResult,
  outputPath?: string,
): string {
  let filePath: string;

  if (outputPath) {
    filePath = resolve(outputPath);
  } else {
    // Default: .github/workflows/ in current directory
    const cwd = process.cwd();

    // Verify we're in a git repo
    try {
      execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' });
    } catch {
      throw new ConfigError(
        '--write requires a git repository. Run from your project root or use --output <path>.',
      );
    }

    const workflowsDir = join(cwd, '.github', 'workflows');
    mkdirSync(workflowsDir, { recursive: true });
    filePath = join(workflowsDir, 'release.yml');
  }

  writeFileSync(filePath, result.yaml, 'utf8');
  return filePath;
}
