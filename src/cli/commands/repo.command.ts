import { type ParsedCommandArgs } from '../argv';
import { getBooleanFlag, getStringFlag, getListFlag } from '../argv';
import { printJson, resolveRequiredString } from '../io';
import { addEnvironment, editEnvironment, listRepositories, showRepository, editRepository } from '../use-cases/repo-config';
import { generateRepoSecrets, showRepoSecrets, rotateRepoSecrets, formatSecretsChecklist, formatRotateChecklist, showMultiEnvSecrets, formatMultiEnvSecrets } from '../use-cases/repo-secrets';
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
  if (useJson) { printJson(result); } else { printRepoAddChecklist(result); }
  return 0;
}

// ── repo list ───────────────────────────────────────────────────────────────
export async function handleRepoList(_parsed: ParsedCommandArgs): Promise<number> {
  printJson(listRepositories());
  return 0;
}

// ── repo show ───────────────────────────────────────────────────────────────
export async function handleRepoShow(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRequiredString(getStringFlag(parsed, 'repository'), 'Repository (owner/repo)');
  const useJson = getBooleanFlag(parsed, 'json');
  const repoYaml = showRepository(repository);
  if (useJson) { printJson(repoYaml); } else { process.stdout.write(formatRepoShow(repoYaml)); }
  return 0;
}

// ── repo edit ───────────────────────────────────────────────────────────────
export async function handleRepoEdit(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRequiredString(getStringFlag(parsed, 'repository'), 'Repository (owner/repo)');
  const result = editRepository({
    repository,
    bearerTokenEnv: getStringFlag(parsed, 'bearerEnv'),
    hmacSecretEnv: getStringFlag(parsed, 'hmacEnv'),
    refreshEnvNames: getBooleanFlag(parsed, 'refreshEnvNames'),
  });
  printWarnings(result.warnings);
  printJson(result);
  return 0;
}

// ── repo remove ─────────────────────────────────────────────────────────────
export async function handleRepoRemove(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRequiredString(getStringFlag(parsed, 'repository'), 'Repository (owner/repo)');
  if (!getBooleanFlag(parsed, 'force')) {
    const answer = await resolveRequiredString(undefined, `Type "${repository}" to confirm removal`);
    if (answer !== repository) { process.stderr.write('Confirmation did not match. Aborting.\n'); return 1; }
  }
  const { removeRepository } = await import('../use-cases/repo-config');
  const result = removeRepository(repository, { removeStack: getBooleanFlag(parsed, 'removeStack') });
  printJson(result);
  process.stdout.write('\nRemember to restart the webhook:\n  docker compose restart webhook\n\n');
  return 0;
}

// ── repo secrets generate ───────────────────────────────────────────────────
export async function handleSecretsGenerate(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRequiredString(getStringFlag(parsed, 'repository'), 'Repository (owner/repo)');
  printJson(generateRepoSecrets(repository));
  return 0;
}

// ── repo secrets show ───────────────────────────────────────────────────────
export async function handleSecretsShow(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRequiredString(getStringFlag(parsed, 'repository'), 'Repository (owner/repo)');
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
  const repository = await resolveRequiredString(getStringFlag(parsed, 'repository'), 'Repository (owner/repo)');
  if (!getBooleanFlag(parsed, 'force')) {
    const { confirm } = await import('../io');
    const ok = await confirm(`Rotate secrets for ${repository}? Old secrets will stop working`, false);
    if (!ok) { process.stdout.write('Aborted.\n'); return 0; }
  }
  const useJson = getBooleanFlag(parsed, 'json');
  const secrets = rotateRepoSecrets(repository);
  if (useJson) { printJson(secrets); } else { process.stdout.write(formatRotateChecklist(secrets)); }
  return 0;
}

// ── env add/edit ────────────────────────────────────────────────────────────
async function resolveEnvArgs(parsed: ParsedCommandArgs) {
  const repository = await resolveRequiredString(getStringFlag(parsed, 'repository'), 'Repository (owner/repo)');
  const environment = await resolveRequiredString(getStringFlag(parsed, 'environment'), 'Environment', 'production');
  return { repository, environment };
}

export async function handleEnvAdd(parsed: ParsedCommandArgs): Promise<number> {
  const { repository, environment } = await resolveEnvArgs(parsed);
  const result = addEnvironment({ repository, environment });
  printWarnings(result.warnings);
  printJson(result);
  return 0;
}

export async function handleEnvEdit(parsed: ParsedCommandArgs): Promise<number> {
  const { repository, environment } = await resolveEnvArgs(parsed);
  const result = editEnvironment({
    repository, environment,
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
