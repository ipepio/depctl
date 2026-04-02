import { printJson, resolveOptionalString, resolveRequiredString } from './io';
import {
  inferExistingService,
  parseSupportedServiceKinds,
  resolveStackServiceInput,
} from './stack/input';
import { withLocalRuntime } from './runtime';
import { buildMigrationPlan, scanMigration } from './use-cases/migration';
import {
  addEnvironment,
  addRepository,
  editEnvironment,
  listRepositories,
} from './use-cases/repo-config';
import { generateRepoSecrets, showRepoSecrets } from './use-cases/repo-secrets';
import { validateRuntimeConfig } from '../config/runtime-validator';
import { manualDeploy, redeployLastSuccessful, retryJob } from './use-cases/deploy-actions';
import {
  addManagedStackService,
  editManagedStackService,
  initializeManagedStack,
  readStackMetadata,
} from './use-cases/stack';

async function promptMenuChoice(): Promise<string> {
  process.stdout.write(
    [
      '',
      'deployctl tui',
      '1. Repo list',
      '2. Repo add',
      '3. Env add',
      '4. Env edit',
      '5. Repo secrets generate',
      '6. Repo secrets show',
      '7. Validate',
      '8. Deploy manual',
      '9. Redeploy last successful',
      '10. Retry job',
      '11. Stack init',
      '12. Stack service add',
      '13. Stack service edit',
      '14. Migration scan',
      '15. Migration plan',
      '0. Exit',
      '',
    ].join('\n'),
  );

  return resolveRequiredString(undefined, 'Choice');
}

async function promptRepository(): Promise<string> {
  return resolveRequiredString(undefined, 'Repository (owner/repo)');
}

async function promptEnvironment(): Promise<string> {
  return resolveRequiredString(undefined, 'Environment', 'production');
}

export async function runTui(): Promise<number> {
  let keepRunning = true;

  while (keepRunning) {
    const choice = await promptMenuChoice();

    try {
      switch (choice) {
        case '1':
          printJson(listRepositories());
          break;
        case '2': {
          const repository = await promptRepository();
          const environment = await promptEnvironment();
          printJson(addRepository({ repository, environment }));
          break;
        }
        case '3': {
          const repository = await promptRepository();
          const environment = await promptEnvironment();
          printJson(addEnvironment({ repository, environment }));
          break;
        }
        case '4': {
          const repository = await promptRepository();
          const environment = await promptEnvironment();
          const services = await resolveOptionalString(undefined, 'Services comma separated');
          printJson(
            editEnvironment({
              repository,
              environment,
              services: services
                ? services
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter((entry) => entry.length > 0)
                : undefined,
            }),
          );
          break;
        }
        case '5':
          printJson(generateRepoSecrets(await promptRepository()));
          break;
        case '6':
          printJson(showRepoSecrets(await promptRepository()));
          break;
        case '7':
          printJson(await validateRuntimeConfig());
          break;
        case '8': {
          const repository = await promptRepository();
          const environment = await promptEnvironment();
          const tag = await resolveRequiredString(undefined, 'Tag');
          const result = await withLocalRuntime(
            () => manualDeploy({ repository, environment, tag }),
            { requireQueue: true },
          );
          printJson(result);
          break;
        }
        case '9': {
          const repository = await promptRepository();
          const environment = await promptEnvironment();
          const result = await withLocalRuntime(
            () => redeployLastSuccessful({ repository, environment }),
            { requireQueue: true },
          );
          printJson(result);
          break;
        }
        case '10': {
          const jobId = await resolveRequiredString(undefined, 'Job ID');
          const result = await withLocalRuntime(() => retryJob({ jobId }), { requireQueue: true });
          printJson(result);
          break;
        }
        case '11': {
          const repository = await promptRepository();
          const environment = await promptEnvironment();
          const kinds = parseSupportedServiceKinds(
            (
              (await resolveOptionalString(undefined, 'Stack services comma separated', 'app')) ??
              'app'
            )
              .split(',')
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0),
          );
          const services = [];
          for (const kind of kinds) {
            services.push(
              await resolveStackServiceInput({
                repository,
                environment,
                kind,
              }),
            );
          }

          printJson(
            initializeManagedStack({
              repository,
              environment,
              services,
            }),
          );
          break;
        }
        case '12': {
          const repository = await promptRepository();
          const environment = await promptEnvironment();
          const kind = parseSupportedServiceKinds([
            await resolveRequiredString(undefined, 'Service kind'),
          ])[0];
          const service = await resolveStackServiceInput({
            repository,
            environment,
            kind,
          });
          printJson(addManagedStackService(service));
          break;
        }
        case '13': {
          const repository = await promptRepository();
          const environment = await promptEnvironment();
          const metadata = readStackMetadata(repository);
          const serviceName = await resolveRequiredString(undefined, 'Existing service name');
          const existingService = inferExistingService(metadata.services, serviceName);
          if (!existingService) {
            throw new Error(`Unknown managed service: ${serviceName}`);
          }

          const service = await resolveStackServiceInput({
            repository,
            environment,
            kind: existingService.kind,
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
              serviceName,
            },
          });

          printJson(
            editManagedStackService({
              ...service,
              serviceName,
            }),
          );
          break;
        }
        case '14':
          printJson(scanMigration());
          break;
        case '15':
          printJson(buildMigrationPlan());
          break;
        case '0':
          keepRunning = false;
          break;
        default:
          process.stderr.write(`Unknown choice: ${choice}\n`);
      }
    } catch (error) {
      process.stderr.write(`${String(error)}\n`);
    }
  }

  return 0;
}
