import { runAdminCommand } from './cli/bootstrap';
import { logger } from './logger';
import { runWebhookMode } from './webhook/bootstrap';

// Emit deprecation warning when invoked as legacy admin container
function checkLegacyInvocation(): void {
  if (process.env.DEPCTL_NO_LEGACY_WARN === '1') return;
  const isLegacyContainer =
    process.env.DEPCTL_LEGACY === '1' ||
    (process.argv[2] === 'admin' && process.env.COMPOSE_PROJECT_NAME !== undefined);
  if (isLegacyContainer) {
    process.stderr.write(
      '[depctl] ⚠  Legacy admin container invocation detected.\n' +
        '[depctl]    Prefer running: depctl <command>\n' +
        '[depctl]    Set DEPCTL_NO_LEGACY_WARN=1 to silence.\n',
    );
  }
}

async function bootstrap(): Promise<void> {
  const [, , mode = 'webhook', ...args] = process.argv;
  if (mode === 'admin') {
    checkLegacyInvocation();
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
