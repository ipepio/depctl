import { type ParsedCommandArgs } from '../argv';
import { getBooleanFlag, getStringFlag } from '../argv';
import { printJson } from '../io';
import { resolveRepository } from '../resolve-repo';
import {
  runProxyInit,
  runProxyStatus,
  runProxyDomains,
  runProxyEnable,
  runProxyDisable,
  runProxySsl,
  formatProxyStatus,
  formatProxyDomains,
} from '../use-cases/proxy';
import { type ProxySslMode } from '../../config/schema';
import { listProxyRoutes } from '../../proxy/proxy-config';

// ── proxy init ────────────────────────────────────────────────────────────────
export async function handleProxyInit(parsed: ParsedCommandArgs): Promise<number> {
  const result = await runProxyInit({
    acmeEmail: getStringFlag(parsed, 'email'),
    nonInteractive: getBooleanFlag(parsed, 'nonInteractive'),
  });
  if (getBooleanFlag(parsed, 'json')) {
    printJson(result);
  } else {
    if (result.initialized) {
      process.stdout.write(`\n  Proxy initialized.\n`);
      process.stdout.write(`  IP: ${result.fallbackIp ?? '(unknown)'}\n`);
      if (result.acmeEmail) process.stdout.write(`  ACME email: ${result.acmeEmail}\n`);
      process.stdout.write('\n  Add repos with: depctl proxy enable <owner/repo>\n\n');
    }
  }
  return 0;
}

// ── proxy status ──────────────────────────────────────────────────────────────
export async function handleProxyStatus(parsed: ParsedCommandArgs): Promise<number> {
  const status = await runProxyStatus();
  if (getBooleanFlag(parsed, 'json')) {
    printJson(status);
  } else {
    process.stdout.write(formatProxyStatus(status));
  }
  return 0;
}

// ── proxy domains ─────────────────────────────────────────────────────────────
export async function handleProxyDomains(parsed: ParsedCommandArgs): Promise<number> {
  const rows = await runProxyDomains();
  if (getBooleanFlag(parsed, 'json')) {
    printJson(rows);
  } else {
    process.stdout.write(formatProxyDomains(rows));
  }
  return 0;
}

// ── proxy enable ──────────────────────────────────────────────────────────────
export async function handleProxyEnable(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRepository(
    parsed.positionals[2] ?? getStringFlag(parsed, 'repository'),
  );
  const environment =
    getStringFlag(parsed, 'environment') ?? getStringFlag(parsed, 'env') ?? 'production';

  const sslRaw = getStringFlag(parsed, 'ssl') ?? getStringFlag(parsed, 'mode');
  const ssl = (sslRaw as ProxySslMode | undefined) ?? undefined;

  const result = await runProxyEnable({
    repository,
    environment,
    domain: getStringFlag(parsed, 'domain'),
    containerPort: getStringFlag(parsed, 'port')
      ? Number(getStringFlag(parsed, 'port'))
      : undefined,
    ssl,
  });

  if (getBooleanFlag(parsed, 'json')) {
    printJson(result);
  } else {
    process.stdout.write(`\n  Proxy enabled: ${result.repository} (${result.environment})\n`);
    process.stdout.write(`  URL:  ${result.url}\n`);
    process.stdout.write(`  Note: ${result.note}\n\n`);
  }
  return 0;
}

// ── proxy disable ─────────────────────────────────────────────────────────────
export async function handleProxyDisable(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRepository(
    parsed.positionals[2] ?? getStringFlag(parsed, 'repository'),
  );
  const environment =
    getStringFlag(parsed, 'environment') ?? getStringFlag(parsed, 'env') ?? 'production';

  const result = await runProxyDisable(repository, environment);

  if (getBooleanFlag(parsed, 'json')) {
    printJson(result);
  } else {
    process.stdout.write(`\n  Proxy disabled: ${result.repository} (${result.environment})\n\n`);
  }
  return 0;
}

// ── proxy ssl ─────────────────────────────────────────────────────────────────
export async function handleProxySsl(parsed: ParsedCommandArgs): Promise<number> {
  const repository = await resolveRepository(
    parsed.positionals[2] ?? getStringFlag(parsed, 'repository'),
  );
  const environment =
    getStringFlag(parsed, 'environment') ?? getStringFlag(parsed, 'env') ?? 'production';
  const modeRaw = getStringFlag(parsed, 'mode');

  if (!modeRaw) {
    // Read-only: show current SSL status
    const routes = listProxyRoutes();
    const route = routes.find((r) => r.repository === repository && r.environment === environment);
    if (!route) {
      process.stderr.write(`No proxy configured for ${repository} (${environment})\n`);
      return 1;
    }
    if (getBooleanFlag(parsed, 'json')) {
      printJson({ repository, environment, ssl: route.ssl });
    } else {
      process.stdout.write(`\n  ${repository} (${environment}) — SSL: ${route.ssl}\n\n`);
    }
    return 0;
  }

  const validModes: ProxySslMode[] = ['off', 'self-signed', 'auto'];
  if (!validModes.includes(modeRaw as ProxySslMode)) {
    process.stderr.write(`Invalid SSL mode: ${modeRaw}. Valid: off, self-signed, auto\n`);
    return 1;
  }

  const result = await runProxySsl(repository, environment, modeRaw as ProxySslMode);

  if (getBooleanFlag(parsed, 'json')) {
    printJson(result);
  } else {
    process.stdout.write(`\n  SSL mode set to "${result.ssl}"\n`);
    process.stdout.write(`  URL: ${result.url}\n\n`);
  }
  return 0;
}
