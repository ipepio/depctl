import { type ParsedCommandArgs } from '../argv';
import { getBooleanFlag, getStringFlag, getListFlag } from '../argv';
import { printJson, resolveRequiredString, resolveOptionalString, resolveList } from '../io';
import { selectFromList, type SelectOption } from '../select';
import {
  addEnvironment,
  editEnvironment,
  listRepositories,
  showRepository,
  editRepository,
} from '../use-cases/repo-config';
import {
  generateRepoSecrets,
  showRepoSecrets,
  rotateRepoSecrets,
  formatSecretsChecklist,
  formatRotateChecklist,
  showMultiEnvSecrets,
  formatMultiEnvSecrets,
} from '../use-cases/repo-secrets';
import { runRepoAddWizard, printRepoAddChecklist } from '../use-cases/repo-wizard';
import { formatRepoShow } from '../use-cases/repo-show';

function printWarnings(warnings: string[]): void {
  for (const w of warnings) process.stderr.write(`[warn] ${w}\n`);
}

// ── repo add ────────────────────────────────────────────────────────────────
export async function handleRepoAdd(parsed: ParsedCommandArgs): Promise<number> {
  const useJson = getBooleanFlag(parsed, 'json');
  const result = await runRepoAddWizard({
    repository: getStringFlag(parsed, 'repository'),
    environment: getStringFlag(parsed, 'environment'),
    imageName: getStringFlag(parsed, 'imageName'),
    allowedBranches: getListFlag(parsed, 'allowedBranches'),
    allowedTagPattern: getStringFlag(parsed, 'allowedTagPattern'),
    allowedWorkflows: getListFlag(parsed, 'allowedWorkflows'),
    services: getListFlag(parsed, 'services'),
    stackServices: getListFlag(parsed, 'stackServices'),
    nonInteractive: getBooleanFlag(parsed, 'nonInteractive'),
  });
  if (useJson) {
    printJson(result);
  } else {
    printRepoAddChecklist(result);
  }
  return 0;
}

// ── repo list ───────────────────────────────────────────────────────────────
export async function handleRepoList(_parsed: ParsedCommandArgs): Promise<number> {
  printJson(listRepositories());
  return 0;
}

// ── repo show ───────────────────────────────────────────────────────────────
export async function handleRepoShow(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRequiredString(
    getStringFlag(parsed, 'repository'),
    'Repository (owner/repo)',
  );
  const useJson = getBooleanFlag(parsed, 'json');
  const repoYaml = showRepository(repository);
  if (useJson) {
    printJson(repoYaml);
  } else {
    process.stdout.write(formatRepoShow(repoYaml));
  }
  return 0;
}

// ── repo edit ───────────────────────────────────────────────────────────────
async function selectRepository(flagValue?: string): Promise<string> {
  if (flagValue) return flagValue;

  const repos = listRepositories();
  if (repos.length === 0) {
    throw new Error('No repositories configured. Run: depctl repo add');
  }

  if (!process.stdin.isTTY) {
    throw new Error('Missing --repository flag');
  }

  const options: SelectOption[] = repos.map((r) => ({
    label: r.repository,
    value: r.repository,
  }));

  const selected = await selectFromList(options, 'Repository');
  if (selected === '__exit__') {
    process.stdout.write('Cancelled.\n');
    process.exit(0);
  }
  return selected;
}

async function interactiveRepoEdit(repository: string): Promise<number> {
  const repoYaml = showRepository(repository);
  const envNames = Object.keys(repoYaml.environments);

  if (envNames.length === 0) {
    process.stderr.write('No environments configured for this repo.\n');
    return 1;
  }

  let environment = envNames[0];
  if (envNames.length > 1) {
    const envOptions: SelectOption[] = envNames.map((e) => ({ label: e, value: e }));
    environment = await selectFromList(envOptions, 'Environment');
    if (environment === '__exit__') return 0;
  }

  const env = repoYaml.environments[environment];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const fields: SelectOption[] = [
      { label: 'Image name', value: 'imageName', detail: env.image_name },
      { label: 'Services', value: 'services', detail: env.services.join(', ') },
      { label: 'Allowed branches', value: 'branches', detail: env.allowed_branches?.join(', ') ?? '' },
      { label: 'Allowed tag pattern', value: 'tagPattern', detail: env.allowed_tag_pattern ?? '' },
      { label: 'Allowed workflows', value: 'workflows', detail: env.allowed_workflows?.join(', ') ?? '' },
      { label: 'Healthcheck URL', value: 'healthcheck', detail: env.healthcheck?.url ?? 'disabled' },
      { label: 'Done', value: '__done__', detail: 'save and exit' },
    ];

    const choice = await selectFromList(fields, `Edit ${repository} [${environment}]`);
    if (choice === '__exit__' || choice === '__done__') break;

    switch (choice) {
      case 'imageName': {
        const val = await resolveOptionalString(undefined, 'Image name', env.image_name);
        if (val) env.image_name = val;
        break;
      }
      case 'services': {
        const val = await resolveList(undefined, 'Services', env.services);
        if (val.length > 0) env.services = val;
        break;
      }
      case 'branches': {
        const val = await resolveList(undefined, 'Allowed branches', env.allowed_branches);
        if (val.length > 0) env.allowed_branches = val;
        break;
      }
      case 'tagPattern': {
        const val = await resolveOptionalString(undefined, 'Allowed tag pattern', env.allowed_tag_pattern);
        if (val) env.allowed_tag_pattern = val;
        break;
      }
      case 'workflows': {
        const val = await resolveList(undefined, 'Allowed workflows', env.allowed_workflows);
        if (val.length > 0) env.allowed_workflows = val;
        break;
      }
      case 'healthcheck': {
        const val = await resolveOptionalString(undefined, 'Healthcheck URL', env.healthcheck?.url ?? '');
        if (val) {
          env.healthcheck = { ...env.healthcheck, enabled: true, url: val };
        } else {
          env.healthcheck = { enabled: false };
        }
        break;
      }
    }
  }

  const result = await editEnvironment({
    repository,
    environment,
    imageName: env.image_name,
    services: env.services,
    allowedBranches: env.allowed_branches,
    allowedTagPattern: env.allowed_tag_pattern,
    allowedWorkflows: env.allowed_workflows,
    healthcheckUrl: env.healthcheck?.enabled ? env.healthcheck.url : undefined,
    disableHealthcheck: !env.healthcheck?.enabled,
  });
  printWarnings(result.warnings);
  process.stdout.write(`\nUpdated ${repository} [${environment}] ✓\n`);
  return 0;
}

export async function handleRepoEdit(parsed: ParsedCommandArgs): Promise<number> {
  const flagRepo = getStringFlag(parsed, 'repository');
  const hasDirectFlags = getStringFlag(parsed, 'bearerEnv') ||
    getStringFlag(parsed, 'hmacEnv') ||
    getBooleanFlag(parsed, 'refreshEnvNames');

  const repository = await selectRepository(flagRepo);

  if (hasDirectFlags) {
    const result = await editRepository({
      repository,
      bearerTokenEnv: getStringFlag(parsed, 'bearerEnv'),
      hmacSecretEnv: getStringFlag(parsed, 'hmacEnv'),
      refreshEnvNames: getBooleanFlag(parsed, 'refreshEnvNames'),
    });
    printWarnings(result.warnings);
    printJson(result);
    return 0;
  }

  if (!process.stdin.isTTY) {
    const result = await editRepository({ repository });
    printWarnings(result.warnings);
    printJson(result);
    return 0;
  }

  return interactiveRepoEdit(repository);
}

// ── repo remove ─────────────────────────────────────────────────────────────
export async function handleRepoRemove(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRequiredString(
    getStringFlag(parsed, 'repository'),
    'Repository (owner/repo)',
  );
  if (!getBooleanFlag(parsed, 'force')) {
    const answer = await resolveRequiredString(
      undefined,
      `Type "${repository}" to confirm removal`,
    );
    if (answer !== repository) {
      process.stderr.write('Confirmation did not match. Aborting.\n');
      return 1;
    }
  }
  const { removeRepository } = await import('../use-cases/repo-config');
  const result = await removeRepository(repository, {
    removeStack: getBooleanFlag(parsed, 'removeStack'),
  });
  printJson(result);
  process.stdout.write('\nRemember to restart the webhook:\n  docker compose restart webhook\n\n');
  return 0;
}

// ── repo secrets generate ───────────────────────────────────────────────────
export async function handleSecretsGenerate(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRequiredString(
    getStringFlag(parsed, 'repository'),
    'Repository (owner/repo)',
  );
  printJson(generateRepoSecrets(repository));
  return 0;
}

// ── repo secrets show ───────────────────────────────────────────────────────
export async function handleSecretsShow(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRequiredString(
    getStringFlag(parsed, 'repository'),
    'Repository (owner/repo)',
  );
  const useJson = getBooleanFlag(parsed, 'json');
  if (useJson) {
    printJson(showRepoSecrets(repository));
  } else {
    process.stdout.write(formatMultiEnvSecrets(showMultiEnvSecrets(repository)));
  }
  return 0;
}

// ── repo secrets rotate ─────────────────────────────────────────────────────
export async function handleSecretsRotate(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRequiredString(
    getStringFlag(parsed, 'repository'),
    'Repository (owner/repo)',
  );
  if (!getBooleanFlag(parsed, 'force')) {
    const { confirm } = await import('../io');
    const ok = await confirm(
      `Rotate secrets for ${repository}? Old secrets will stop working`,
      false,
    );
    if (!ok) {
      process.stdout.write('Aborted.\n');
      return 0;
    }
  }
  const useJson = getBooleanFlag(parsed, 'json');
  const secrets = rotateRepoSecrets(repository);
  if (useJson) {
    printJson(secrets);
  } else {
    process.stdout.write(formatRotateChecklist(secrets));
  }
  return 0;
}

// ── env add/edit ────────────────────────────────────────────────────────────
async function resolveEnvArgs(parsed: ParsedCommandArgs) {
  const repository = await resolveRequiredString(
    getStringFlag(parsed, 'repository'),
    'Repository (owner/repo)',
  );
  const environment = await resolveRequiredString(
    getStringFlag(parsed, 'environment'),
    'Environment',
    'production',
  );
  return { repository, environment };
}

export async function handleEnvAdd(parsed: ParsedCommandArgs): Promise<number> {
  const { repository, environment } = await resolveEnvArgs(parsed);
  const result = await addEnvironment({ repository, environment });
  printWarnings(result.warnings);
  printJson(result);
  return 0;
}

export async function handleEnvEdit(parsed: ParsedCommandArgs): Promise<number> {
  const { repository, environment } = await resolveEnvArgs(parsed);
  const result = await editEnvironment({
    repository,
    environment,
    imageName: getStringFlag(parsed, 'imageName'),
    composeFile: getStringFlag(parsed, 'composeFile'),
    runtimeEnvFile: getStringFlag(parsed, 'runtimeEnvFile'),
    services: getListFlag(parsed, 'services'),
    allowedWorkflows: getListFlag(parsed, 'allowedWorkflows'),
    allowedBranches: getListFlag(parsed, 'allowedBranches'),
    allowedTagPattern: getStringFlag(parsed, 'allowedTagPattern'),
    healthcheckUrl: getStringFlag(parsed, 'healthcheckUrl'),
    disableHealthcheck: getBooleanFlag(parsed, 'disableHealthcheck'),
  });
  printWarnings(result.warnings);
  printJson(result);
  return 0;
}
