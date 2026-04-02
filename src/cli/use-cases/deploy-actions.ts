import { getRepoConfig } from '../../config';
import { HttpError } from '../../errors/http-error';
import { type EnqueueResult } from '../../queue/job.types';
import { enqueueDeployJob, getJob } from '../../queue/queue-manager';
import { readRollbackState } from '../../state/disk.store';
import {
  AdminDeployPayloadSchema,
  AdminRedeployPayloadSchema,
  validateManualDeployAgainstConfig,
} from '../../api/validators/deploy.validator';

export interface ManualDeployInput {
  repository: string;
  environment: string;
  tag: string;
  force?: boolean;
}

export interface RedeployLastSuccessfulInput {
  repository: string;
  environment: string;
  force?: boolean;
}

export interface RetryJobInput {
  jobId: string;
  force?: boolean;
}

export interface LocalAdminResult {
  status: EnqueueResult['status'];
  jobId: string;
  tag?: string;
}

function buildAdminPayload(repository: string, environment: string, tag: string, force: boolean) {
  return {
    repository,
    environment,
    tag,
    sha: tag,
    workflow: 'manual',
    refName: 'manual',
    runId: 0,
    triggeredBy: 'admin' as const,
    force,
  };
}

export async function manualDeploy(input: ManualDeployInput): Promise<LocalAdminResult> {
  const payload = AdminDeployPayloadSchema.parse({
    repository: input.repository,
    environment: input.environment,
    tag: input.tag,
    force: input.force ?? false,
  });

  const repoConfig = getRepoConfig(payload.repository);
  if (!repoConfig) {
    throw new HttpError(404, 'repository_not_found', 'Repository not found');
  }

  validateManualDeployAgainstConfig(payload, repoConfig);
  const result = await enqueueDeployJob(
    buildAdminPayload(payload.repository, payload.environment, payload.tag, payload.force),
  );

  return {
    status: result.status,
    jobId: result.jobId,
  };
}

export async function redeployLastSuccessful(
  input: RedeployLastSuccessfulInput,
): Promise<LocalAdminResult> {
  const payload = AdminRedeployPayloadSchema.parse({
    repository: input.repository,
    environment: input.environment,
    force: input.force ?? false,
  });

  const repoConfig = getRepoConfig(payload.repository);
  if (!repoConfig || !repoConfig.environments[payload.environment]) {
    throw new HttpError(404, 'repository_not_found', 'Repository or environment not found');
  }

  const rollbackState = readRollbackState(payload.repository, payload.environment);
  if (!rollbackState.successfulTag) {
    throw new HttpError(404, 'no_successful_deployment_found', 'No successful deployment found');
  }

  const result = await enqueueDeployJob(
    buildAdminPayload(
      payload.repository,
      payload.environment,
      rollbackState.successfulTag,
      payload.force,
    ),
  );

  return {
    status: result.status,
    jobId: result.jobId,
    tag: rollbackState.successfulTag,
  };
}

export async function retryJob(input: RetryJobInput): Promise<LocalAdminResult> {
  const job = await getJob(input.jobId);
  if (!job) {
    throw new HttpError(404, 'job_not_found', 'Job not found');
  }

  if (!['failed', 'rolled_back', 'rollback_failed'].includes(job.status)) {
    throw new HttpError(409, 'job_not_retryable', 'Job is not retryable');
  }

  const result = await enqueueDeployJob({
    ...job.payload,
    triggeredBy: 'admin',
    force: input.force ?? false,
  });

  return {
    status: result.status,
    jobId: result.jobId,
  };
}
