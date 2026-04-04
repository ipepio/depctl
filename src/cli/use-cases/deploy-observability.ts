import { type DeployJob } from '../../queue/job.types';
import { getJob, getRecentJobs } from '../../queue/queue-manager';
import { readRollbackState } from '../../state/disk.store';
import { HttpError } from '../../errors/http-error';
import { enqueueDeployJob } from '../../queue/queue-manager';
import { getRepoConfig } from '../../config';
import { listRepoFiles } from '../../config/repo-files';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
  success: '✅',
  failed: '❌',
  rolled_back: '↩️ ',
  rollback_failed: '💥',
  cancelled: '⊘ ',
  pending: '⏳',
  running: '🔄',
};

function formatDuration(durationMs?: number): string {
  if (!durationMs) return '-';
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${Math.round(durationMs / 1000)}s`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '-';
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '');
}

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

// ─────────────────────────────────────────────
// Task 6.1 — logs command
// ─────────────────────────────────────────────

export interface LogsOptions {
  repository: string;
  environment?: string;
  jobId?: string;
}

export async function getDeployLogs(opts: LogsOptions): Promise<DeployJob | null> {
  if (opts.jobId) {
    return getJob(opts.jobId);
  }

  // Get latest job for repo/env
  const env = opts.environment ?? 'production';
  const jobs = await getRecentJobs(opts.repository, env, 1);
  return jobs[0] ?? null;
}

export function formatJobLogs(job: DeployJob, useColor = true): string {
  const icon = STATUS_ICONS[job.status] ?? '?';
  const lines: string[] = [];

  lines.push('');
  lines.push(`  Job:     ${job.id}`);
  lines.push(`  Repo:    ${job.payload.repository} / ${job.payload.environment}`);
  lines.push(`  Tag:     ${job.payload.tag}`);
  lines.push(`  Status:  ${icon} ${job.status}`);
  lines.push(`  Started: ${formatDate(job.startedAt)}`);
  lines.push(`  Ended:   ${formatDate(job.finishedAt)}`);
  lines.push(`  By:      ${job.payload.triggeredBy}`);
  lines.push('');
  lines.push('  ── Logs ──────────────────────────────────────');

  if (!job.logs || job.logs.length === 0) {
    lines.push('  (no logs)');
  } else {
    for (const line of job.logs) {
      lines.push(`  ${line}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ─────────────────────────────────────────────
// Task 6.2 — history command
// ─────────────────────────────────────────────

export interface HistoryOptions {
  repository: string;
  environment?: string;
  limit?: number;
}

export async function getDeployHistory(opts: HistoryOptions): Promise<DeployJob[]> {
  return getRecentJobs(opts.repository, opts.environment, opts.limit ?? 10);
}

export function formatDeployHistory(jobs: DeployJob[], repository: string): string {
  if (jobs.length === 0) {
    return `\n  No deploy history found for ${repository}\n`;
  }

  const lines: string[] = [''];
  const header = `  ${pad('#', 4)}${pad('Date', 22)}${pad('Tag', 12)}${pad('Env', 14)}${pad('Status', 16)}${pad('Duration', 10)}`;
  const divider = '  ' + '─'.repeat(78);

  lines.push(header);
  lines.push(divider);

  jobs.forEach((job, i) => {
    const icon = STATUS_ICONS[job.status] ?? '?';
    const num = pad(String(i + 1), 4);
    const date = pad(formatDate(job.startedAt ?? job.createdAt), 22);
    const tag = pad(job.payload.tag, 12);
    const env = pad(job.payload.environment, 14);
    const status = pad(`${icon} ${job.status}`, 16);
    const duration = pad(formatDuration(job.durationMs), 10);
    lines.push(`  ${num}${date}${tag}${env}${status}${duration}`);
  });

  lines.push('');
  return lines.join('\n');
}

// ─────────────────────────────────────────────
// Task 6.3 — rollback command
// ─────────────────────────────────────────────

export interface RollbackOptions {
  repository: string;
  environment?: string;
  force?: boolean;
}

export interface RollbackResult {
  jobId: string;
  tag: string;
  status: string;
}

export async function runRollback(opts: RollbackOptions): Promise<RollbackResult> {
  const environment = opts.environment ?? 'production';

  const repoConfig = getRepoConfig(opts.repository);
  if (!repoConfig || !repoConfig.environments[environment]) {
    throw new HttpError(404, 'repository_not_found', `Repository or environment not found: ${opts.repository}/${environment}`);
  }

  const state = readRollbackState(opts.repository, environment);
  if (!state.successfulTag) {
    throw new HttpError(
      404,
      'no_rollback_target',
      `No successful deployment found for ${opts.repository}/${environment}. Cannot rollback.`,
    );
  }

  const result = await enqueueDeployJob({
    repository: opts.repository,
    environment,
    tag: state.successfulTag,
    sha: state.successfulTag,
    workflow: 'rollback',
    refName: 'rollback',
    runId: 0,
    triggeredBy: 'admin',
    force: opts.force ?? false,
  });

  return {
    jobId: result.jobId,
    tag: state.successfulTag,
    status: result.status,
  };
}

export function formatRollbackInfo(repository: string, environment: string): string {
  const state = readRollbackState(repository, environment);
  if (!state.successfulTag) {
    return `\n  No successful deployment found for ${repository}/${environment}.\n`;
  }

  return [
    '',
    `  Rolling back ${repository}/${environment}`,
    `  → Target tag: ${state.successfulTag}`,
    `  → Last deployed: ${formatDate(state.deployedAt)}`,
    '',
  ].join('\n');
}

// ─────────────────────────────────────────────
// Rollback state reader (for display without action)
// ─────────────────────────────────────────────
export { readRollbackState };
