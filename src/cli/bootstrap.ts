import { HttpError } from '../errors/http-error';
import { validateRuntimeConfig } from '../config/runtime-validator';
import { CliUsageError } from './errors';
import { getBooleanFlag, getListFlag, getStringFlag, parseCommandArgs } from './argv';
import { printJson, resolveList, resolveRequiredString } from './io';
import { runInit } from './use-cases/instance-init';
import { runStatus, formatStatus } from './use-cases/instance-status';
import { runRepoAddWizard, printRepoAddChecklist } from './use-cases/repo-wizard';
import {
  getDeployLogs,
  formatJobLogs,
  getDeployHistory,
  formatDeployHistory,
  runRollback,
  formatRollbackInfo,
} from './use-cases/deploy-observability';
import {
  runWorkflowGeneratorWizard,
  printWorkflowResult,
  writeWorkflowToFile,
} from './use-cases/workflow-generator';
import { formatRepoShow } from './use-cases/repo-show';
import {
  inferExistingService,
  parseSupportedServiceKinds,
  resolveStackServiceInput,
} from './stack/input';
import { withLocalRuntime } from './runtime';
import { runTui } from './tui';
import { buildMigrationPlan, applyMigration, scanMigration } from './use-cases/migration';
import {
  addEnvironment,
  addRepository,
  editEnvironment,
  editRepository,
  listRepositories,
  showRepository,
} from './use-cases/repo-config';
import { manualDeploy, redeployLastSuccessful, retryJob } from './use-cases/deploy-actions';
import { generateRepoSecrets, showRepoSecrets, rotateRepoSecrets, formatSecretsChecklist, formatRotateChecklist, showMultiEnvSecrets, formatMultiEnvSecrets } from './use-cases/repo-secrets';
import {
  addManagedStackService,
  editManagedStackService,
  initializeManagedStack,
  readStackMetadata,
  type StackServiceInput,
} from './use-cases/stack';

function renderHelp(): string {
  return [
    'depctl usage:',
    '  deployctl init                      Configure this instance (public URL, port, stacks dir)',
    '  deployctl status                    Show health of all components',
    '  deployctl logs <owner/repo> [--job <id>] [--env <env>] [--json]',
    '  deployctl history <owner/repo> [--limit N] [--env <env>] [--json]',
    '  deployctl rollback <owner/repo> [--env <env>] [--force]',
    '  deployctl workflow generate [--repository owner/repo] [--write] [--output <path>]',
    '  deployctl repo add [--repository owner/repo] [--non-interactive]',
    '  deployctl repo remove --repository owner/repo [--force] [--remove-stack]',
    '  deployctl repo edit --repository owner/repo [--refresh-env-names]',
    '  deployctl repo edit --repository owner/repo [--refresh-env-names]',
    '  deployctl repo list',
    '  deployctl repo show --repository owner/repo',
    '  deployctl repo secrets generate --repository owner/repo',
    '  deployctl repo secrets show --repository owner/repo [--json]',
    '  deployctl repo secrets rotate --repository owner/repo [--force] [--json]',
    '  deployctl env add --repository owner/repo --environment production',
    '  deployctl env edit --repository owner/repo --environment production [--services app,worker]',
    '  deployctl validate',
    '  deployctl deploy manual --repository owner/repo --environment production --tag sha-abc1234',
    '  deployctl deploy redeploy-last-successful --repository owner/repo --environment production',
    '  deployctl deploy retry --job-id <uuid>',
    '  deployctl stack init --repository owner/repo --environment production [--services app,postgres]',
    '  deployctl stack show --repository owner/repo',
    '  deployctl stack service add --repository owner/repo --environment production --kind postgres',
    '  deployctl stack service edit --repository owner/repo --environment production --service-name app --kind app',
    '  deployctl migrate scan',
    '  deployctl migrate plan',
    '  deployctl migrate apply',
    '  deployctl tui',
  ].join('\n');
}

function printWarnings(warnings: string[]): void {
  for (const warning of warnings) {
    process.stderr.write(`[warn] ${warning}\n`);
  }
}

async function resolveRepoEnvironmentFromArgs(parsed: ReturnType<typeof parseCommandArgs>) {
  const repository = await resolveRequiredString(
    getStringFlag(parsed, 'repository'),
    'Repository (owner/repo)',
  );
  const environment = await resolveRequiredString(
    getStringFlag(parsed, 'environment'),
    'Environment',
    'production',
  );
  return {
    repository,
    environment,
  };
}

async function handleRepoCommand(parsed: ReturnType<typeof parseCommandArgs>): Promise<number> {
  const [_, action, nested] = parsed.positionals;

  if (action === 'list') {
    printJson(listRepositories());
    return 0;
  }

  if (action === 'show') {
    const repository = await resolveRequiredString(
      getStringFlag(parsed, 'repository'),
      'Repository (owner/repo)',
    );
    const useJson = getBooleanFlag(parsed, 'json');
    const repoYaml = showRepository(repository);
    if (useJson) {
      printJson(repoYaml);
    } else {
      process.stdout.write(formatRepoShow(repoYaml));
    }
    return 0;
  }

  if (action === 'add') {
    const useJson = getBooleanFlag(parsed, 'json');
    const result = await runRepoAddWizard({
      repository: getStringFlag(parsed, 'repository'),
      environment: getStringFlag(parsed, 'environment'),
      imageName: getStringFlag(parsed, 'imageName'),
      allowedBranches: getListFlag(parsed, 'allowedBranches'),
      allowedTagPattern: getStringFlag(parsed, 'allowedTagPattern'),
      allowedWorkflows: getListFlag(parsed, 'allowedWorkflows'),
      services: getListFlag(parsed, 'services'),
      stackServices: getListFlag(parsed, 'stackServices'),
      nonInteractive: getBooleanFlag(parsed, 'nonInteractive'),
    });
    if (useJson) {
      printJson(result);
    } else {
      printRepoAddChecklist(result);
    }
    return 0;
  }

  if (action === 'remove') {
    const repository = await resolveRequiredString(
      getStringFlag(parsed, 'repository'),
      'Repository (owner/repo)',
    );
    // Explicit confirmation: type the repo name
    if (!getBooleanFlag(parsed, 'force')) {
      const answer = await resolveRequiredString(
        undefined,
        `Type "${repository}" to confirm removal`,
      );
      if (answer !== repository) {
        process.stderr.write('Confirmation did not match. Aborting.\n');
        return 1;
      }
    }
    const removeStack = getBooleanFlag(parsed, 'removeStack');
    const { removeRepository } = await import('./use-cases/repo-config');
    const result = removeRepository(repository, { removeStack });
    printJson(result);
    process.stdout.write('\nRemember to restart the webhook:\n  docker compose restart webhook\n\n');
    return 0;
  }

  if (action === 'edit') {
    const repository = await resolveRequiredString(
      getStringFlag(parsed, 'repository'),
      'Repository (owner/repo)',
    );
    const result = editRepository({
      repository,
      bearerTokenEnv: getStringFlag(parsed, 'bearerEnv'),
      hmacSecretEnv: getStringFlag(parsed, 'hmacEnv'),
      refreshEnvNames: getBooleanFlag(parsed, 'refreshEnvNames'),
    });
    printWarnings(result.warnings);
    printJson(result);
    return 0;
  }

  if (action === 'secrets' && nested === 'generate') {
    const repository = await resolveRequiredString(
      getStringFlag(parsed, 'repository'),
      'Repository (owner/repo)',
    );
    printJson(generateRepoSecrets(repository));
    return 0;
  }

  if (action === 'secrets' && nested === 'show') {
    const repository = await resolveRequiredString(
      getStringFlag(parsed, 'repository'),
      'Repository (owner/repo)',
    );
    const useJson = getBooleanFlag(parsed, 'json');
    const secrets = showRepoSecrets(repository);
    if (useJson) {
      printJson(secrets);
    } else {
      // Task 8.3: use multi-env format (shows suffixes when multiple envs exist)
      const multiEnv = showMultiEnvSecrets(repository);
      process.stdout.write(formatMultiEnvSecrets(multiEnv));
    }
    return 0;
  }

  if (action === 'secrets' && nested === 'rotate') {
    const repository = await resolveRequiredString(
      getStringFlag(parsed, 'repository'),
      'Repository (owner/repo)',
    );
    // Confirmation required unless --force
    if (!getBooleanFlag(parsed, 'force')) {
      const { confirm } = await import('./io');
      const ok = await confirm(
        `Rotate secrets for ${repository}? Old secrets will stop working`,
        false,
      );
      if (!ok) {
        process.stdout.write('Aborted.\n');
        return 0;
      }
    }
    const useJson = getBooleanFlag(parsed, 'json');
    const secrets = rotateRepoSecrets(repository);
    if (useJson) {
      printJson(secrets);
    } else {
      process.stdout.write(formatRotateChecklist(secrets));
    }
    return 0;
  }

  throw new CliUsageError(renderHelp());
}

async function handleEnvCommand(parsed: ReturnType<typeof parseCommandArgs>): Promise<number> {
  const [_, action] = parsed.positionals;
  const { repository, environment } = await resolveRepoEnvironmentFromArgs(parsed);
  const services = await resolveList(getListFlag(parsed, 'services'), 'Deployable services', [
    'app',
  ]);

  if (action === 'add') {
    const result = addEnvironment({ repository, environment, services });
    printWarnings(result.warnings);
    printJson(result);
    return 0;
  }

  if (action === 'edit') {
    const result = editEnvironment({
      repository,
      environment,
      imageName: getStringFlag(parsed, 'imageName'),
      composeFile: getStringFlag(parsed, 'composeFile'),
      runtimeEnvFile: getStringFlag(parsed, 'runtimeEnvFile'),
      services: getListFlag(parsed, 'services') ?? services,
      allowedWorkflows: getListFlag(parsed, 'allowedWorkflows'),
      allowedBranches: getListFlag(parsed, 'allowedBranches'),
      allowedTagPattern: getStringFlag(parsed, 'allowedTagPattern'),
      healthcheckUrl: getStringFlag(parsed, 'healthcheckUrl'),
      disableHealthcheck: getBooleanFlag(parsed, 'disableHealthcheck'),
    });
    printWarnings(result.warnings);
    printJson(result);
    return 0;
  }

  throw new CliUsageError(renderHelp());
}

async function handleValidateCommand(): Promise<number> {
  const result = await validateRuntimeConfig();
  printJson(result);
  return result.ok ? 0 : 1;
}

async function handleDeployCommand(parsed: ReturnType<typeof parseCommandArgs>): Promise<number> {
  const [_, action] = parsed.positionals;

  if (action === 'manual') {
    const { repository, environment } = await resolveRepoEnvironmentFromArgs(parsed);
    const tag = await resolveRequiredString(getStringFlag(parsed, 'tag'), 'Tag');
    const result = await withLocalRuntime(
      () =>
        manualDeploy({
          repository,
          environment,
          tag,
          force: getBooleanFlag(parsed, 'force'),
        }),
      { requireQueue: true },
    );
    printJson(result);
    return 0;
  }

  if (action === 'redeploy-last-successful') {
    const { repository, environment } = await resolveRepoEnvironmentFromArgs(parsed);
    const result = await withLocalRuntime(
      () =>
        redeployLastSuccessful({
          repository,
          environment,
          force: getBooleanFlag(parsed, 'force'),
        }),
      { requireQueue: true },
    );
    printJson(result);
    return 0;
  }

  if (action === 'retry') {
    const jobId = await resolveRequiredString(getStringFlag(parsed, 'jobId'), 'Job ID');
    const result = await withLocalRuntime(
      () => retryJob({ jobId, force: getBooleanFlag(parsed, 'force') }),
      { requireQueue: true },
    );
    printJson(result);
    return 0;
  }

  throw new CliUsageError(renderHelp());
}

function getStackServiceOverrides(
  parsed: ReturnType<typeof parseCommandArgs>,
): Partial<StackServiceInput> {
  return {
    serviceName: getStringFlag(parsed, 'serviceName'),
    command: getStringFlag(parsed, 'command'),
    healthcheckPath: getStringFlag(parsed, 'healthcheckPath'),
    databaseName: getStringFlag(parsed, 'databaseName'),
    username: getStringFlag(parsed, 'username'),
    password: getStringFlag(parsed, 'password'),
    targetService: getStringFlag(parsed, 'targetService'),
    targetPort: getStringFlag(parsed, 'targetPort')
      ? Number(getStringFlag(parsed, 'targetPort'))
      : undefined,
    port: getStringFlag(parsed, 'port') ? Number(getStringFlag(parsed, 'port')) : undefined,
    internalPort: getStringFlag(parsed, 'internalPort')
      ? Number(getStringFlag(parsed, 'internalPort'))
      : undefined,
    appendOnly:
      parsed.flags.appendOnly !== undefined ? getBooleanFlag(parsed, 'appendOnly') : undefined,
  };
}

async function handleStackCommand(parsed: ReturnType<typeof parseCommandArgs>): Promise<number> {
  const [_, action, nested] = parsed.positionals;

  if (action === 'show') {
    const repository = await resolveRequiredString(
      getStringFlag(parsed, 'repository'),
      'Repository (owner/repo)',
    );
    printJson(readStackMetadata(repository));
    return 0;
  }

  if (action === 'init') {
    const { repository, environment } = await resolveRepoEnvironmentFromArgs(parsed);
    const serviceKinds = parseSupportedServiceKinds(
      await resolveList(getListFlag(parsed, 'services'), 'Stack services', ['app']),
    );
    const services: StackServiceInput[] = [];
    for (const kind of serviceKinds) {
      services.push(
        await resolveStackServiceInput({
          repository,
          environment,
          kind,
          overrides: serviceKinds.length === 1 ? getStackServiceOverrides(parsed) : undefined,
        }),
      );
    }

    const result = initializeManagedStack({
      repository,
      environment,
      services,
    });
    printJson(result);
    return 0;
  }

  if (action === 'service' && nested === 'add') {
    const { repository, environment } = await resolveRepoEnvironmentFromArgs(parsed);
    const kind = parseSupportedServiceKinds([
      await resolveRequiredString(getStringFlag(parsed, 'kind'), 'Service kind'),
    ])[0];
    const service = await resolveStackServiceInput({
      repository,
      environment,
      kind,
      overrides: getStackServiceOverrides(parsed),
    });
    const result = addManagedStackService(service);
    printJson(result);
    return 0;
  }

  if (action === 'service' && nested === 'edit') {
    const { repository, environment } = await resolveRepoEnvironmentFromArgs(parsed);
    const metadata = readStackMetadata(repository);
    const serviceName = await resolveRequiredString(
      getStringFlag(parsed, 'serviceName'),
      'Service name',
    );
    const existingService = inferExistingService(metadata.services, serviceName);
    if (!existingService) {
      throw new CliUsageError(`Unknown managed service: ${serviceName}`);
    }

    const kind = getStringFlag(parsed, 'kind')
      ? parseSupportedServiceKinds([getStringFlag(parsed, 'kind') as string])[0]
      : existingService.kind;
    const service = await resolveStackServiceInput({
      repository,
      environment,
      kind,
      defaults: {
        serviceName: existingService.serviceName,
        port: existingService.port,
        internalPort: existingService.internalPort,
        command: existingService.command,
        healthcheckPath: existingService.healthcheckPath,
        databaseName: existingService.databaseName,
        username: existingService.username,
        targetService: existingService.targetService,
        targetPort: existingService.targetPort,
        appendOnly: existingService.appendOnly,
      },
      overrides: {
        ...getStackServiceOverrides(parsed),
        serviceName,
      },
    });

    const result = editManagedStackService({
      ...service,
      serviceName,
    });
    printJson(result);
    return 0;
  }

  throw new CliUsageError(renderHelp());
}

async function handleMigrateCommand(parsed: ReturnType<typeof parseCommandArgs>): Promise<number> {
  const [_, action] = parsed.positionals;
  if (action === 'scan') {
    printJson(scanMigration());
    return 0;
  }

  if (action === 'plan') {
    printJson(buildMigrationPlan());
    return 0;
  }

  if (action === 'apply') {
    printJson(applyMigration());
    return 0;
  }

  throw new CliUsageError(renderHelp());
}

export async function runAdminCommand(args: string[]): Promise<number> {
  const parsed = parseCommandArgs(args);
  if (parsed.positionals.length === 0) {
    process.stdout.write(`${renderHelp()}\n`);
    return 0;
  }

  try {
    switch (parsed.positionals[0]) {
      case 'init': {
        const result = await runInit({
          publicUrl: getStringFlag(parsed, 'publicUrl') ?? getStringFlag(parsed, 'url'),
          port: getStringFlag(parsed, 'port') ? Number(getStringFlag(parsed, 'port')) : undefined,
          stacksRoot: getStringFlag(parsed, 'stacksRoot') ?? getStringFlag(parsed, 'stacks'),
          nonInteractive: getBooleanFlag(parsed, 'nonInteractive'),
        });
        printJson(result);
        return 0;
      }
      case 'status': {
        const useJson = getBooleanFlag(parsed, 'json');
        const status = runStatus();
        if (useJson) {
          printJson(status);
        } else {
          process.stdout.write(formatStatus(status));
        }
        return 0;
      }
      case 'logs': {
        const repository = await resolveRequiredString(
          parsed.positionals[1] ?? getStringFlag(parsed, 'repository'),
          'Repository (owner/repo)',
        );
        const useJson = getBooleanFlag(parsed, 'json');
        const job = await withLocalRuntime(
          () => getDeployLogs({
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
      case 'history': {
        const repository = await resolveRequiredString(
          parsed.positionals[1] ?? getStringFlag(parsed, 'repository'),
          'Repository (owner/repo)',
        );
        const useJson = getBooleanFlag(parsed, 'json');
        const jobs = await withLocalRuntime(
          () => getDeployHistory({
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
      case 'rollback': {
        const repository = await resolveRequiredString(
          parsed.positionals[1] ?? getStringFlag(parsed, 'repository'),
          'Repository (owner/repo)',
        );
        const environment = getStringFlag(parsed, 'env') ?? getStringFlag(parsed, 'environment') ?? 'production';
        const useJson = getBooleanFlag(parsed, 'json');

        // Show what we're rolling back to before confirming
        if (!getBooleanFlag(parsed, 'force')) {
          process.stdout.write(formatRollbackInfo(repository, environment));
          const { confirm } = await import('./io');
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
        if (useJson) {
          printJson(result);
        } else {
          process.stdout.write(`\n  Rollback enqueued → tag: ${result.tag} (job: ${result.jobId})\n\n`);
        }
        return 0;
      }
      case 'workflow': {
        const [_, action] = parsed.positionals;
        if (action !== 'generate') {
          throw new CliUsageError('Usage: deployctl workflow generate [--repository owner/repo] [--write] [--output <path>]');
        }

        const result = await runWorkflowGeneratorWizard({
          repository: getStringFlag(parsed, 'repository'),
          workflowName: getStringFlag(parsed, 'workflowName') ?? getStringFlag(parsed, 'name'),
          buildDocker: parsed.flags.buildDocker !== undefined
            ? getBooleanFlag(parsed, 'buildDocker')
            : undefined,
          registry: getStringFlag(parsed, 'registry'),
          nonInteractive: getBooleanFlag(parsed, 'nonInteractive'),
        });

        if (getBooleanFlag(parsed, 'json')) {
          printJson(result);
          return 0;
        }

        printWorkflowResult(result);

        const writeFlag = getBooleanFlag(parsed, 'write');
        const outputPath = getStringFlag(parsed, 'output');

        if (writeFlag || outputPath) {
          const filePath = writeWorkflowToFile(result, outputPath);
          process.stdout.write(`  Written to: ${filePath}\n\n`);
        }

        return 0;
      }
      case 'repo':
        return handleRepoCommand(parsed);
      case 'env':
        return handleEnvCommand(parsed);
      case 'validate':
        return handleValidateCommand();
      case 'deploy':
        return handleDeployCommand(parsed);
      case 'stack':
        return handleStackCommand(parsed);
      case 'migrate':
        return handleMigrateCommand(parsed);
      case 'tui':
        return runTui();
      case 'help':
      case '--help':
      case '-h':
        process.stdout.write(`${renderHelp()}\n`);
        return 0;
      default:
        throw new CliUsageError(renderHelp());
    }
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
