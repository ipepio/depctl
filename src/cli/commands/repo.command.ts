import { type ParsedCommandArgs } from '../argv';
import { getBooleanFlag, getStringFlag, getListFlag } from '../argv';
import { printJson, resolveRequiredString, resolveOptionalString, resolveList, confirm } from '../io';
import { selectFromList, type SelectOption } from '../select';
import { resolveRepository } from '../resolve-repo';
import {
  addEnvironment,
  editEnvironment,
  listRepositories,
  showRepository,
  editRepository,
} from '../use-cases/repo-config';
import { addManagedStackService, readStackMetadata, removeStackService } from '../use-cases/stack';
import { resolveStackServiceInput, SUPPORTED_SERVICE_KINDS } from '../stack/input';
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
  const repository = await resolveRepository(getStringFlag(parsed, 'repository'));
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

  let stackServices: string[] = [];
  try {
    const meta = readStackMetadata(repository);
    stackServices = meta.services.map((s) => `${s.serviceName} (${s.kind})`);
  } catch { /* no stack yet */ }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const fields: SelectOption[] = [
      { label: 'Image name', value: 'imageName', detail: env.image_name },
      { label: 'Deployable services', value: 'services', detail: env.services.join(', ') },
      { label: 'Allowed branches', value: 'branches', detail: env.allowed_branches?.join(', ') ?? '' },
      { label: 'Allowed tag pattern', value: 'tagPattern', detail: env.allowed_tag_pattern ?? '' },
      { label: 'Allowed workflows', value: 'workflows', detail: env.allowed_workflows?.join(', ') ?? '' },
      { label: 'Healthcheck URL', value: 'healthcheck', detail: env.healthcheck?.url ?? 'disabled' },
      { label: 'Add stack service', value: 'addService', detail: 'postgres, redis, custom...' },
    ];

    if (stackServices.length > 0) {
      fields.push({ label: 'Remove stack service', value: 'removeService', detail: stackServices.join(', ') });
    }

    fields.push({ label: 'Secrets', value: 'secrets', detail: 'view, rotate' });
    fields.push({ label: 'Done', value: '__done__', detail: 'save and exit' });

    const choice = await selectFromList(fields, `Edit ${repository} [${environment}]`);
    if (choice === '__exit__' || choice === '__done__') break;

    switch (choice) {
      case 'imageName': {
        const val = await resolveOptionalString(undefined, 'Image name', env.image_name);
        if (val) env.image_name = val;
        break;
      }
      case 'services': {
        const val = await resolveList(undefined, 'Deployable services', env.services);
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
      case 'addService': {
        const kindOptions: SelectOption[] = SUPPORTED_SERVICE_KINDS.map((k) => ({
          label: k,
          value: k,
          detail: k === 'custom' ? 'any Docker image' : undefined,
        }));
        const kind = await selectFromList(kindOptions, 'Service kind');
        if (kind === '__exit__') break;

        const input = await resolveStackServiceInput({
          repository,
          environment,
          kind: kind as typeof SUPPORTED_SERVICE_KINDS[number],
        });

        try {
          const result = addManagedStackService(input);
          stackServices = result.services.map((s) => s);
          process.stdout.write(`Service added ✓\n`);
        } catch (e) {
          process.stderr.write(`${String(e)}\n`);
        }
        break;
      }
      case 'removeService': {
        try {
          const meta = readStackMetadata(repository);
          const svcOptions: SelectOption[] = meta.services.map((s) => ({
            label: s.serviceName,
            value: s.serviceName,
            detail: s.kind,
          }));
          const svcName = await selectFromList(svcOptions, 'Remove service');
          if (svcName === '__exit__') break;

          const ok = await confirm(`Remove '${svcName}' from stack?`, false);
          if (ok) {
            const result = removeStackService(repository, svcName);
            stackServices = result.services.map((s) => s);
            process.stdout.write(`Service '${svcName}' removed ✓\n`);
          }
        } catch (e) {
          process.stderr.write(`${String(e)}\n`);
        }
        break;
      }
      case 'secrets': {
        const secretActions: SelectOption[] = [
          { label: 'View secrets', value: 'view', detail: 'show current bearer + HMAC' },
          { label: 'Rotate secrets', value: 'rotate', detail: 'generate new secrets (old ones stop working)' },
        ];
        const action = await selectFromList(secretActions, 'Secrets');
        if (action === '__exit__') break;

        if (action === 'view') {
          try {
            process.stdout.write(formatMultiEnvSecrets(showMultiEnvSecrets(repository)));
          } catch (e) {
            process.stderr.write(`${String(e)}\n`);
          }
        } else if (action === 'rotate') {
          const ok = await confirm('Rotate secrets? Old secrets will stop working', false);
          if (ok) {
            const secrets = rotateRepoSecrets(repository);
            process.stdout.write(formatRotateChecklist(secrets));
          }
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

  const repository = await resolveRepository(flagRepo);

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
  const repository = await resolveRepository(getStringFlag(parsed, 'repository'));
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
  const repository = await resolveRepository(getStringFlag(parsed, 'repository'));
  printJson(generateRepoSecrets(repository));
  return 0;
}

// ── repo secrets show ───────────────────────────────────────────────────────
export async function handleSecretsShow(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRepository(getStringFlag(parsed, 'repository'));
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
  const repository = await resolveRepository(getStringFlag(parsed, 'repository'));
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
  const repository = await resolveRepository(getStringFlag(parsed, 'repository'));
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
