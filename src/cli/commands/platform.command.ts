import { type ParsedCommandArgs } from '../argv';
import { getBooleanFlag, getStringFlag, getListFlag } from '../argv';
import { printJson, resolveRequiredString, resolveList } from '../io';
import { validateRuntimeConfig } from '../../config/runtime-validator';
import { parseSupportedServiceKinds, resolveStackServiceInput } from '../stack/input';
import { initializeManagedStack, addManagedStackService, editManagedStackService, readStackMetadata, type StackServiceInput } from '../use-cases/stack';
import { inferExistingService } from '../stack/input';
import { runWorkflowGeneratorWizard, printWorkflowResult, writeWorkflowToFile } from '../use-cases/workflow-generator';
import { buildMigrationPlan, applyMigration, scanMigration } from '../use-cases/migration';
import { runTui } from '../tui';

function getStackServiceOverrides(parsed: ParsedCommandArgs): Partial<StackServiceInput> {
  return {
    serviceName: getStringFlag(parsed, 'serviceName'),
    command: getStringFlag(parsed, 'command'),
    healthcheckPath: getStringFlag(parsed, 'healthcheckPath'),
    databaseName: getStringFlag(parsed, 'databaseName'),
    username: getStringFlag(parsed, 'username'),
    password: getStringFlag(parsed, 'password'),
    targetService: getStringFlag(parsed, 'targetService'),
    targetPort: getStringFlag(parsed, 'targetPort') ? Number(getStringFlag(parsed, 'targetPort')) : undefined,
    port: getStringFlag(parsed, 'port') ? Number(getStringFlag(parsed, 'port')) : undefined,
    internalPort: getStringFlag(parsed, 'internalPort') ? Number(getStringFlag(parsed, 'internalPort')) : undefined,
    appendOnly: parsed.flags.appendOnly !== undefined ? getBooleanFlag(parsed, 'appendOnly') : undefined,
  };
}

// ── validate ─────────────────────────────────────────────────────────────────
export async function handleValidate(_parsed: ParsedCommandArgs): Promise<number> {
  const result = await validateRuntimeConfig();
  printJson(result);
  return result.ok ? 0 : 1;
}

// ── workflow generate ─────────────────────────────────────────────────────────
export async function handleWorkflowGenerate(parsed: ParsedCommandArgs): Promise<number> {
  const result = await runWorkflowGeneratorWizard({
    repository: getStringFlag(parsed, 'repository'),
    workflowName: getStringFlag(parsed, 'workflowName') ?? getStringFlag(parsed, 'name'),
    buildDocker: parsed.flags.buildDocker !== undefined ? getBooleanFlag(parsed, 'buildDocker') : undefined,
    registry: getStringFlag(parsed, 'registry'),
    nonInteractive: getBooleanFlag(parsed, 'nonInteractive'),
  });
  if (getBooleanFlag(parsed, 'json')) { printJson(result); return 0; }
  printWorkflowResult(result);
  const outputPath = getStringFlag(parsed, 'output');
  if (getBooleanFlag(parsed, 'write') || outputPath) {
    const filePath = writeWorkflowToFile(result, outputPath);
    process.stdout.write(`  Written to: ${filePath}\n\n`);
  }
  return 0;
}

// ── stack init ────────────────────────────────────────────────────────────────
export async function handleStackInit(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRequiredString(getStringFlag(parsed, 'repository'), 'Repository (owner/repo)');
  const environment = await resolveRequiredString(getStringFlag(parsed, 'environment'), 'Environment', 'production');
  const serviceKinds = parseSupportedServiceKinds(
    await resolveList(getListFlag(parsed, 'services'), 'Stack services', ['app']),
  );
  const services: StackServiceInput[] = [];
  for (const kind of serviceKinds) {
    services.push(await resolveStackServiceInput({
      repository, environment, kind,
      overrides: serviceKinds.length === 1 ? getStackServiceOverrides(parsed) : undefined,
    }));
  }
  printJson(initializeManagedStack({ repository, environment, services }));
  return 0;
}

// ── stack show ────────────────────────────────────────────────────────────────
export async function handleStackShow(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRequiredString(getStringFlag(parsed, 'repository'), 'Repository (owner/repo)');
  printJson(readStackMetadata(repository));
  return 0;
}

// ── stack service add ─────────────────────────────────────────────────────────
export async function handleStackServiceAdd(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRequiredString(getStringFlag(parsed, 'repository'), 'Repository (owner/repo)');
  const environment = await resolveRequiredString(getStringFlag(parsed, 'environment'), 'Environment', 'production');
  const kind = parseSupportedServiceKinds([await resolveRequiredString(getStringFlag(parsed, 'kind'), 'Service kind')])[0];
  const service = await resolveStackServiceInput({ repository, environment, kind, overrides: getStackServiceOverrides(parsed) });
  printJson(addManagedStackService(service));
  return 0;
}

// ── stack service edit ────────────────────────────────────────────────────────
export async function handleStackServiceEdit(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRequiredString(getStringFlag(parsed, 'repository'), 'Repository (owner/repo)');
  const environment = await resolveRequiredString(getStringFlag(parsed, 'environment'), 'Environment', 'production');
  const serviceName = await resolveRequiredString(getStringFlag(parsed, 'serviceName'), 'Service name');
  const metadata = readStackMetadata(repository);
  const existing = inferExistingService(metadata.services, serviceName);
  if (!existing) { process.stderr.write(`Unknown managed service: ${serviceName}\n`); return 1; }
  const kind = getStringFlag(parsed, 'kind')
    ? parseSupportedServiceKinds([getStringFlag(parsed, 'kind') as string])[0]
    : existing.kind;
  const service = await resolveStackServiceInput({
    repository, environment, kind,
    defaults: {
      serviceName: existing.serviceName, port: existing.port, internalPort: existing.internalPort,
      command: existing.command, healthcheckPath: existing.healthcheckPath,
      databaseName: existing.databaseName, username: existing.username,
      targetService: existing.targetService, targetPort: existing.targetPort, appendOnly: existing.appendOnly,
    },
    overrides: { ...getStackServiceOverrides(parsed), serviceName },
  });
  printJson(editManagedStackService({ ...service, serviceName }));
  return 0;
}

// ── migrate ───────────────────────────────────────────────────────────────────
export async function handleMigrateScan(_parsed: ParsedCommandArgs): Promise<number> {
  printJson(scanMigration()); return 0;
}
export async function handleMigratePlan(_parsed: ParsedCommandArgs): Promise<number> {
  printJson(buildMigrationPlan()); return 0;
}
export async function handleMigrateApply(_parsed: ParsedCommandArgs): Promise<number> {
  printJson(applyMigration()); return 0;
}

// ── tui ───────────────────────────────────────────────────────────────────────
export async function handleTui(_parsed: ParsedCommandArgs): Promise<number> {
  return runTui();
}
