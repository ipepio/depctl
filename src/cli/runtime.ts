import { initConfig, resetConfig } from '../config';
import { loadServiceEnvIntoProcess } from '../config/service-env';
import { closeDeployQueue, getDeployQueue } from '../queue/queue';
import { closeRedis, pingRedis } from '../queue/redis';

export interface LocalRuntimeOptions {
  requireQueue?: boolean;
}

export async function withLocalRuntime<T>(
  callback: () => Promise<T>,
  options: LocalRuntimeOptions = {},
): Promise<T> {
  loadServiceEnvIntoProcess();
  await initConfig();
  await pingRedis();

  if (options.requireQueue) {
    await getDeployQueue().waitUntilReady();
  }

  try {
    return await callback();
  } finally {
    await closeDeployQueue();
    await closeRedis();
    resetConfig();
  }
}
