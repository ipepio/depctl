import { type ParsedCommandArgs } from '../argv';
import { getBooleanFlag, getStringFlag } from '../argv';
import { printJson, resolveRequiredString } from '../io';
import { resolveRepository } from '../resolve-repo';
import { withLocalRuntime } from '../runtime';
import { manualDeploy, redeployLastSuccessful, retryJob } from '../use-cases/deploy-actions';
import {
  getDeployLogs,
  formatJobLogs,
  getDeployHistory,
  formatDeployHistory,
  runRollback,
  formatRollbackInfo,
} from '../use-cases/deploy-observability';

// ── deploy manual ───────────────────────────────────────────────────────────
export async function handleDeployManual(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRepository(getStringFlag(parsed, 'repository'));
  const environment = await resolveRequiredString(
    getStringFlag(parsed, 'environment'),
    'Environment',
    'production',
  );
  const tag = await resolveRequiredString(getStringFlag(parsed, 'tag'), 'Tag');
  const result = await withLocalRuntime(
    () => manualDeploy({ repository, environment, tag, force: getBooleanFlag(parsed, 'force') }),
    { requireQueue: true },
  );
  printJson(result);
  return 0;
}

// ── deploy redeploy-last-successful ─────────────────────────────────────────
export async function handleRedeployLast(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRepository(getStringFlag(parsed, 'repository'));
  const environment = await resolveRequiredString(
    getStringFlag(parsed, 'environment'),
    'Environment',
    'production',
  );
  const result = await withLocalRuntime(
    () =>
      redeployLastSuccessful({ repository, environment, force: getBooleanFlag(parsed, 'force') }),
    { requireQueue: true },
  );
  printJson(result);
  return 0;
}

// ── deploy retry ────────────────────────────────────────────────────────────
export async function handleRetry(parsed: ParsedCommandArgs): Promise<number> {
  const jobId = await resolveRequiredString(getStringFlag(parsed, 'jobId'), 'Job ID');
  const result = await withLocalRuntime(
    () => retryJob({ jobId, force: getBooleanFlag(parsed, 'force') }),
    { requireQueue: true },
  );
  printJson(result);
  return 0;
}

// ── history ─────────────────────────────────────────────────────────────────
export async function handleHistory(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRepository(
    parsed.positionals[1] ?? getStringFlag(parsed, 'repository'),
  );
  const useJson = getBooleanFlag(parsed, 'json');
  const jobs = await withLocalRuntime(
    () =>
      getDeployHistory({
        repository,
        environment: getStringFlag(parsed, 'env') ?? getStringFlag(parsed, 'environment'),
        limit: getStringFlag(parsed, 'limit') ? Number(getStringFlag(parsed, 'limit')) : undefined,
      }),
    { requireQueue: true },
  );
  if (useJson) {
    printJson(jobs);
  } else {
    process.stdout.write(formatDeployHistory(jobs, repository));
  }
  return 0;
}

// ── logs ─────────────────────────────────────────────────────────────────────
export async function handleLogs(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRepository(
    parsed.positionals[1] ?? getStringFlag(parsed, 'repository'),
  );
  const useJson = getBooleanFlag(parsed, 'json');
  const job = await withLocalRuntime(
    () =>
      getDeployLogs({
        repository,
        environment: getStringFlag(parsed, 'env') ?? getStringFlag(parsed, 'environment'),
        jobId: getStringFlag(parsed, 'job') ?? getStringFlag(parsed, 'jobId'),
      }),
    { requireQueue: true },
  );
  if (!job) {
    process.stdout.write(`\n  No deploy found for ${repository}\n\n`);
    return 0;
  }
  if (useJson) {
    printJson(job);
  } else {
    process.stdout.write(formatJobLogs(job));
  }
  return 0;
}

// ── rollback ─────────────────────────────────────────────────────────────────
export async function handleRollback(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRepository(
    parsed.positionals[1] ?? getStringFlag(parsed, 'repository'),
  );
  const environment =
    getStringFlag(parsed, 'env') ?? getStringFlag(parsed, 'environment') ?? 'production';
  if (!getBooleanFlag(parsed, 'force')) {
    process.stdout.write(formatRollbackInfo(repository, environment));
    const { confirm } = await import('../io');
    const ok = await confirm('Proceed with rollback?', false);
    if (!ok) {
      process.stdout.write('Aborted.\n');
      return 0;
    }
  }
  const result = await withLocalRuntime(
    () => runRollback({ repository, environment, force: getBooleanFlag(parsed, 'force') }),
    { requireQueue: true },
  );
  const useJson = getBooleanFlag(parsed, 'json');
  if (useJson) {
    printJson(result);
  } else {
    process.stdout.write(`\n  Rollback enqueued → tag: ${result.tag} (job: ${result.jobId})\n\n`);
  }
  return 0;
}
