import { Router } from 'express';

import { requireAdminRead } from '../auth/admin.auth';
import { deployController } from './controllers/deploy.controller';
import { healthController } from './controllers/health.controller';
import { getJobController, getRecentDeploymentsController } from './controllers/jobs.controller';
import { adminRateLimiter, webhookRateLimiter } from './middlewares/rate-limiter';
import { parseRawDeployJsonMiddleware, rawDeployBodyMiddleware } from './middlewares/raw-body';

export function createRouter(): Router {
  const router = Router();

  router.post(
    '/deploy',
    webhookRateLimiter,
    rawDeployBodyMiddleware,
    parseRawDeployJsonMiddleware,
    deployController,
  );

  router.get('/health', healthController);
  router.get('/jobs/:id', adminRateLimiter, requireAdminRead, getJobController);
  router.get(
    '/deployments/recent',
    adminRateLimiter,
    requireAdminRead,
    getRecentDeploymentsController,
  );

  return router;
}
