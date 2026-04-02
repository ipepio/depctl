import { runAdminCommand } from './cli/bootstrap';
import { logger } from './logger';
import { runWebhookMode } from './webhook/bootstrap';

async function bootstrap(): Promise<void> {
  const [, , mode = 'webhook', ...args] = process.argv;
  if (mode === 'admin') {
    process.exit(await runAdminCommand(args));
  }

  await runWebhookMode();
}

void bootstrap().catch((error) => {
  logger.error('Failed to bootstrap application', {
    error: String(error),
  });
  process.exit(1);
});
