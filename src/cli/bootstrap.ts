import { CliUsageError } from './errors';
import { HttpError } from '../errors/http-error';
import { parseCommandArgs } from './argv';
import { CommandRouter } from './router';

// ── Commands ─────────────────────────────────────────────────────────────────
import { handleInit, handleStatus } from './commands/instance.command';
import {
  handleWorkflowGenerate,
  handleValidate,
  handleStackInit,
  handleStackShow,
  handleStackServiceAdd,
  handleStackServiceEdit,
  handleMigrateScan,
  handleMigratePlan,
  handleMigrateApply,
  handleTui,
  handleUpdate,
} from './commands/platform.command';
import {
  handleRepoAdd,
  handleRepoList,
  handleRepoShow,
  handleRepoEdit,
  handleRepoRemove,
  handleSecretsGenerate,
  handleSecretsShow,
  handleSecretsRotate,
  handleEnvAdd,
  handleEnvEdit,
} from './commands/repo.command';
import {
  handleDeployManual,
  handleRedeployLast,
  handleRetry,
  handleHistory,
  handleLogs,
  handleRollback,
} from './commands/deploy.command';
import {
  handleProxyInit,
  handleProxyStatus,
  handleProxyDomains,
  handleProxyEnable,
  handleProxyDisable,
  handleProxySsl,
} from './commands/proxy.command';

// ─────────────────────────────────────────────────────────────────────────────
const HELP = `
depctl usage:
  depctl init                       Configure instance (URL, port, stacks dir)
  depctl status [--json]            Health of all components

  depctl repo add                   Interactive wizard (--non-interactive for CI)
  depctl repo list                  List configured repos
  depctl repo show  --repository    Environment matrix
  depctl repo edit  --repository    Edit repo config
  depctl repo remove --repository   Remove with confirmation [--force] [--remove-stack]

  depctl repo secrets generate --repository
  depctl repo secrets show     --repository [--json]
  depctl repo secrets rotate   --repository [--force]

  depctl env add  --repository --environment
  depctl env edit --repository --environment

  depctl logs    <owner/repo> [--job <id>] [--env <env>] [--json]
  depctl history <owner/repo> [--limit N] [--env <env>] [--json]
  depctl rollback <owner/repo> [--env <env>] [--force]

  depctl deploy manual                 --repository --environment --tag
  depctl deploy redeploy-last-successful --repository --environment
  depctl deploy retry                  --job-id

  depctl stack init        --repository --environment [--services app,postgres]
  depctl stack show        --repository
  depctl stack service add --repository --environment --kind
  depctl stack service edit --repository --environment --service-name

  depctl workflow generate [--repository] [--write] [--output <path>]

  depctl validate

  depctl migrate scan
  depctl migrate plan
  depctl migrate apply

  depctl update                      Update depctl CLI + webhook image

  depctl tui

  depctl proxy init    [--email <acme-email>]     Initialize reverse proxy (Caddy, ports 80/443)
  depctl proxy status  [--json]                   Caddy health, routes, SSL breakdown
  depctl proxy domains [--json]                   List all proxy routes with URLs
  depctl proxy enable  <owner/repo> [--env <env>] [--domain <d>] [--port <p>] [--ssl <mode>]
  depctl proxy disable <owner/repo> [--env <env>] Remove proxy route
  depctl proxy ssl     <owner/repo> [--env <env>] [--mode off|self-signed|auto]
`;

function buildRouter(): CommandRouter {
  const router = new CommandRouter();

  router.register('init', handleInit);
  router.register('status', handleStatus);

  router.register('repo add', handleRepoAdd);
  router.register('repo list', handleRepoList);
  router.register('repo show', handleRepoShow);
  router.register('repo edit', handleRepoEdit);
  router.register('repo remove', handleRepoRemove);

  router.register('repo secrets generate', handleSecretsGenerate);
  router.register('repo secrets show', handleSecretsShow);
  router.register('repo secrets rotate', handleSecretsRotate);

  router.register('env add', handleEnvAdd);
  router.register('env edit', handleEnvEdit);

  router.register('logs', handleLogs);
  router.register('history', handleHistory);
  router.register('rollback', handleRollback);

  router.register('deploy manual', handleDeployManual);
  router.register('deploy redeploy-last-successful', handleRedeployLast);
  router.register('deploy retry', handleRetry);

  router.register('stack init', handleStackInit);
  router.register('stack show', handleStackShow);
  router.register('stack service add', handleStackServiceAdd);
  router.register('stack service edit', handleStackServiceEdit);

  router.register('workflow generate', handleWorkflowGenerate);

  router.register('validate', handleValidate);

  router.register('migrate scan', handleMigrateScan);
  router.register('migrate plan', handleMigratePlan);
  router.register('migrate apply', handleMigrateApply);

  router.register('tui', handleTui);
  router.register('update', handleUpdate);

  router.register('proxy init', handleProxyInit);
  router.register('proxy status', handleProxyStatus);
  router.register('proxy domains', handleProxyDomains);
  router.register('proxy enable', handleProxyEnable);
  router.register('proxy disable', handleProxyDisable);
  router.register('proxy ssl', handleProxySsl);

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────

export async function runAdminCommand(args: string[]): Promise<number> {
  const parsed = parseCommandArgs(args);

  if (parsed.positionals.length === 0 || ['help', '--help', '-h'].includes(parsed.positionals[0])) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  if (parsed.positionals[0] === '--completions') {
    const type = parsed.positionals[1];
    if (type === 'repos') {
      const { listRepositories } = await import('./use-cases/repo-config');
      for (const r of listRepositories()) process.stdout.write(`${r.repository}\n`);
    } else if (type === 'commands') {
      const commands = [
        'init', 'status', 'repo', 'env', 'logs', 'history', 'rollback',
        'deploy', 'stack', 'workflow', 'validate', 'migrate', 'tui', 'proxy',
      ];
      for (const c of commands) process.stdout.write(`${c}\n`);
    }
    return 0;
  }

  const router = buildRouter();

  try {
    return await router.dispatch(parsed);
  } catch (error) {
    if (error instanceof CliUsageError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    if (error instanceof HttpError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      return 1;
    }
    process.stderr.write(`${String(error)}\n`);
    return 1;
  }
}
