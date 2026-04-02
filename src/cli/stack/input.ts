import { CliUsageError } from '../errors';
import { confirm, resolveOptionalString, resolveRequiredString } from '../io';
import { type StackServiceInput } from '../use-cases/stack';
import { type ManagedStackService, type SupportedServiceKind } from './types';

export const SUPPORTED_SERVICE_KINDS: SupportedServiceKind[] = [
  'app',
  'worker',
  'postgres',
  'redis',
  'nginx',
];

function isSupportedServiceKind(value: string): value is SupportedServiceKind {
  return SUPPORTED_SERVICE_KINDS.includes(value as SupportedServiceKind);
}

function parseNumber(value: string | undefined, prompt: string): number | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new CliUsageError(`Invalid number for ${prompt}: ${value}`);
  }

  return parsed;
}

export function parseSupportedServiceKinds(values: string[]): SupportedServiceKind[] {
  return values.map((value) => {
    if (!isSupportedServiceKind(value)) {
      throw new CliUsageError(`Unsupported stack service: ${value}`);
    }
    return value;
  });
}

export function inferExistingService(
  services: ManagedStackService[],
  serviceName: string,
): ManagedStackService | undefined {
  return services.find((service) => service.serviceName === serviceName);
}

export async function resolveStackServiceInput(options: {
  repository: string;
  environment: string;
  kind: SupportedServiceKind;
  defaults?: Partial<StackServiceInput> & { serviceName?: string };
  overrides?: Partial<StackServiceInput>;
}): Promise<StackServiceInput> {
  const { repository, environment, kind, defaults, overrides } = options;
  const serviceName = await resolveRequiredString(
    overrides?.serviceName ?? defaults?.serviceName,
    'Service name',
    defaults?.serviceName ?? kind,
  );

  const common: StackServiceInput = {
    repository,
    environment,
    kind,
    serviceName,
  };

  if (kind === 'app') {
    const port = parseNumber(
      await resolveOptionalString(
        overrides?.port !== undefined ? String(overrides.port) : undefined,
        'Public port',
        defaults?.port !== undefined ? String(defaults.port) : '3000',
      ),
      'Public port',
    );
    const internalPort = parseNumber(
      await resolveOptionalString(
        overrides?.internalPort !== undefined ? String(overrides.internalPort) : undefined,
        'Container port',
        defaults?.internalPort !== undefined
          ? String(defaults.internalPort)
          : port !== undefined
            ? String(port)
            : '3000',
      ),
      'Container port',
    );
    const healthcheckPath = await resolveOptionalString(
      overrides?.healthcheckPath,
      'Healthcheck path',
      defaults?.healthcheckPath ?? '/health',
    );

    return {
      ...common,
      port,
      internalPort,
      healthcheckPath,
    };
  }

  if (kind === 'worker') {
    const command = await resolveOptionalString(
      overrides?.command,
      'Worker command',
      defaults?.command,
    );
    return {
      ...common,
      command,
    };
  }

  if (kind === 'postgres') {
    const databaseName = await resolveOptionalString(
      overrides?.databaseName,
      'Postgres database',
      defaults?.databaseName ?? 'app',
    );
    const username = await resolveOptionalString(
      overrides?.username,
      'Postgres username',
      defaults?.username ?? 'app',
    );
    const password = await resolveOptionalString(
      overrides?.password,
      'Postgres password (blank = auto-generate)',
    );

    return {
      ...common,
      databaseName,
      username,
      password,
    };
  }

  if (kind === 'redis') {
    const appendOnly =
      overrides?.appendOnly !== undefined
        ? overrides.appendOnly
        : await confirm('Enable Redis appendonly', defaults?.appendOnly ?? true);
    const password = await resolveOptionalString(
      overrides?.password,
      'Redis password (blank = auto-generate)',
    );

    return {
      ...common,
      appendOnly,
      password,
    };
  }

  const port = parseNumber(
    await resolveOptionalString(
      overrides?.port !== undefined ? String(overrides.port) : undefined,
      'Nginx public port',
      defaults?.port !== undefined ? String(defaults.port) : '80',
    ),
    'Nginx public port',
  );
  const targetService = await resolveOptionalString(
    overrides?.targetService,
    'Target service',
    defaults?.targetService ?? 'app',
  );
  const targetPort = parseNumber(
    await resolveOptionalString(
      overrides?.targetPort !== undefined ? String(overrides.targetPort) : undefined,
      'Target port',
      defaults?.targetPort !== undefined ? String(defaults.targetPort) : '3000',
    ),
    'Target port',
  );

  return {
    ...common,
    port,
    targetService,
    targetPort,
  };
}
