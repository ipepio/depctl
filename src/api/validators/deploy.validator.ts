import { z } from 'zod';

import { type RepoConfig } from '../../config/schema';
import { HttpError } from '../../errors/http-error';
import { ERRORS } from '../../errors/actionable-errors';

export const DeployPayloadSchema = z.object({
  repository: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
  environment: z.string().trim().min(1).max(100),
  tag: z.string().trim().min(1).max(200),
  sha: z.string().trim().min(1).max(200),
  workflow: z.string().trim().min(1).max(200),
  ref_name: z.string().trim().min(1).max(200),
  run_id: z.number().int().positive(),
});

export const AdminDeployPayloadSchema = z.object({
  repository: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
  environment: z.string().trim().min(1).max(100),
  tag: z.string().trim().min(1).max(200),
  force: z.boolean().optional().default(false),
});

export const AdminRedeployPayloadSchema = z.object({
  repository: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
  environment: z.string().trim().min(1).max(100),
  force: z.boolean().optional().default(false),
});

export function validateDeployAgainstConfig(
  payload: z.infer<typeof DeployPayloadSchema>,
  repoConfig: RepoConfig,
): void {
  const environmentConfig = repoConfig.environments[payload.environment];
  if (!environmentConfig) {
    const err = ERRORS.ENVIRONMENT_NOT_ALLOWED(payload.environment);
    throw new HttpError(403, err.code, err.message);
  }

  if (!environmentConfig.allowedWorkflows.includes(payload.workflow)) {
    const err = ERRORS.WORKFLOW_NOT_ALLOWED(payload.workflow, environmentConfig.allowedWorkflows);
    throw new HttpError(403, err.code, err.message);
  }

  const tagPattern = new RegExp(environmentConfig.allowedTagPattern);
  const refMatchesTagPattern = tagPattern.test(payload.ref_name);

  if (!refMatchesTagPattern && !environmentConfig.allowedBranches.includes(payload.ref_name)) {
    const err = ERRORS.BRANCH_NOT_ALLOWED(
      payload.ref_name,
      environmentConfig.allowedBranches,
      environmentConfig.allowedTagPattern,
    );
    throw new HttpError(403, err.code, err.message);
  }

  if (!tagPattern.test(payload.tag)) {
    const err = ERRORS.TAG_NOT_ALLOWED(payload.tag, environmentConfig.allowedTagPattern);
    throw new HttpError(403, err.code, err.message);
  }
}

export function validateManualDeployAgainstConfig(
  payload: z.infer<typeof AdminDeployPayloadSchema>,
  repoConfig: RepoConfig,
): void {
  const environmentConfig = repoConfig.environments[payload.environment];
  if (!environmentConfig) {
    const err = ERRORS.ENVIRONMENT_NOT_ALLOWED(payload.environment);
    throw new HttpError(403, err.code, err.message);
  }

  const tagPattern = new RegExp(environmentConfig.allowedTagPattern);
  if (!tagPattern.test(payload.tag)) {
    const err = ERRORS.TAG_NOT_ALLOWED(payload.tag, environmentConfig.allowedTagPattern);
    throw new HttpError(403, err.code, err.message);
  }
}
