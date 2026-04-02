import { type Server } from 'http';

import { initConfig } from '../config';
import { logger } from '../logger';
import { createApp } from '../api/server';
import { closeDeployQueue, getDeployQueue } from '../queue/queue';
import { closeRedis, pingRedis } from '../queue/redis';
import { recoverInterruptedJobs } from '../queue/recovery';
import { closeWorker, startWorker } from '../queue/worker';

async function shutdown(server: Server | null): Promise<void> {
  logger.info('Shutting down docker-deploy-webhook');

  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  await closeWorker();
  await closeDeployQueue();
  await closeRedis();
}

export async function runWebhookMode(): Promise<void> {
  await initConfig();
  await pingRedis();
  await getDeployQueue().waitUntilReady();
  await recoverInterruptedJobs();
  startWorker();

  const app = createApp();
  const port = app.locals.config.server.port;

  const server = app.listen(port, () => {
    logger.info(`Server listening on port ${port}`);
  });

  const handleSignal = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down`);
    try {
      await shutdown(server);
      process.exit(0);
    } catch (error) {
      logger.error('Shutdown failed', {
        error: String(error),
      });
      process.exit(1);
    }
  };

  process.once('SIGINT', () => {
    void handleSignal('SIGINT');
  });
  process.once('SIGTERM', () => {
    void handleSignal('SIGTERM');
  });
}
