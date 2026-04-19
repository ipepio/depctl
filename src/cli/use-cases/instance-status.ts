import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { extname } from 'path';

import { resolveConfigPaths } from '../../config/paths';

export interface StatusResult {
  version: string;
  publicUrl: string | null;
  webhook: {
    ok: boolean;
    hint?: string;
    uptime?: string;
  };
  redis: {
    ok: boolean;
    latencyMs?: number;
    hint?: string;
  };
  worker: {
    ok: boolean;
    pending?: number;
    running?: number;
    hint?: string;
  };
  docker: {
    ok: boolean;
    hint?: string;
  };
  repos: {
    count: number;
    names: string[];
  };
}

declare const __APP_VERSION__: string | undefined;

function getPackageVersion(): string {
  if (typeof __APP_VERSION__ !== 'undefined') return __APP_VERSION__;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require('../../../package.json') as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

function checkDocker(): StatusResult['docker'] {
  try {
    execSync('docker info', { stdio: 'pipe' });
    return { ok: true };
  } catch {
    return {
      ok: false,
      hint: 'Docker daemon not accessible. Is Docker running? Check: sudo systemctl status docker',
    };
  }
}

function checkWebhook(port = 8080): StatusResult['webhook'] {
  try {
    const raw = execSync(`curl -sf --max-time 3 http://localhost:${port}/health`, {
      stdio: 'pipe',
    }).toString();

    const json = JSON.parse(raw) as { uptime_seconds?: number };
    const uptimeSeconds = json.uptime_seconds;
    let uptime: string | undefined;

    if (typeof uptimeSeconds === 'number') {
      const d = Math.floor(uptimeSeconds / 86400);
      const h = Math.floor((uptimeSeconds % 86400) / 3600);
      const m = Math.floor((uptimeSeconds % 3600) / 60);
      uptime = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    return { ok: true, uptime };
  } catch {
    return {
      ok: false,
      hint: `Webhook not responding at http://localhost:${port}/health. Is it running?`,
    };
  }
}

function checkRedis(port = 8080): StatusResult['redis'] {
  try {
    const start = Date.now();
    const raw = execSync(`curl -sf --max-time 3 http://localhost:${port}/health`, {
      stdio: 'pipe',
    }).toString();
    const latencyMs = Date.now() - start;

    const json = JSON.parse(raw) as { redis?: string };
    if (json.redis === 'connected') {
      return { ok: true, latencyMs };
    }
    return { ok: false, hint: 'Redis not connected. Check: docker compose logs redis' };
  } catch {
    return { ok: false, hint: 'Could not check Redis status (webhook unreachable).' };
  }
}

function checkWorker(port = 8080): StatusResult['worker'] {
  try {
    const raw = execSync(`curl -sf --max-time 3 http://localhost:${port}/health`, {
      stdio: 'pipe',
    }).toString();

    const json = JSON.parse(raw) as {
      worker?: string;
      queue?: { pending?: number; running?: number };
    };

    if (json.worker === 'running') {
      return {
        ok: true,
        pending: json.queue?.pending ?? 0,
        running: json.queue?.running ?? 0,
      };
    }

    return { ok: false, hint: 'Worker not running. Check: docker compose logs webhook' };
  } catch {
    return { ok: false, hint: 'Could not check worker status (webhook unreachable).' };
  }
}

function getRepos(): StatusResult['repos'] {
  const { reposConfigPath } = resolveConfigPaths();
  if (!existsSync(reposConfigPath)) {
    return { count: 0, names: [] };
  }

  const files = readdirSync(reposConfigPath).filter((f) => ['.yml', '.yaml'].includes(extname(f)));

  const names = files.map((f) => f.replace(/\.ya?ml$/, '').replace(/--/g, '/'));
  return { count: names.length, names };
}

function getPublicUrl(port = 8080): string | null {
  try {
    const raw = execSync(`curl -sf --max-time 3 http://localhost:${port}/health`, {
      stdio: 'pipe',
    }).toString();
    const json = JSON.parse(raw) as { public_url?: string };
    return json.public_url ?? null;
  } catch {
    return null;
  }
}

export function runStatus(): StatusResult {
  // Try to read port from env
  let port = 8080;
  try {
    const portEnv = process.env.PORT;
    if (portEnv) port = parseInt(portEnv, 10);
  } catch {
    // ignore
  }

  const docker = checkDocker();
  const webhook = checkWebhook(port);
  const redis = checkRedis(port);
  const worker = checkWorker(port);
  const repos = getRepos();
  const publicUrl = getPublicUrl(port);

  return {
    version: getPackageVersion(),
    publicUrl,
    webhook,
    redis,
    worker,
    docker,
    repos,
  };
}

export function formatStatus(status: StatusResult): string {
  const tick = '✅';
  const cross = '❌';
  const lines: string[] = [];

  const webhookLine = status.webhook.ok
    ? `${tick} healthy${status.webhook.uptime ? ` (up ${status.webhook.uptime})` : ''}`
    : `${cross} unreachable${status.webhook.hint ? `\n        → ${status.webhook.hint}` : ''}`;

  const redisLine = status.redis.ok
    ? `${tick} connected${status.redis.latencyMs !== undefined ? ` (${status.redis.latencyMs}ms)` : ''}`
    : `${cross} disconnected${status.redis.hint ? `\n        → ${status.redis.hint}` : ''}`;

  const workerLine = status.worker.ok
    ? `${tick} running (${status.worker.pending ?? 0} pending, ${status.worker.running ?? 0} active)`
    : `${cross} not running${status.worker.hint ? `\n        → ${status.worker.hint}` : ''}`;

  const dockerLine = status.docker.ok
    ? `${tick} socket OK`
    : `${cross} inaccessible${status.docker.hint ? `\n        → ${status.docker.hint}` : ''}`;

  lines.push('');
  lines.push(`  depctl v${status.version}`);
  lines.push(`  URL:     ${status.publicUrl ?? '(not configured — run: depctl init)'}`);
  lines.push('');
  lines.push(`  Webhook: ${webhookLine}`);
  lines.push(`  Redis:   ${redisLine}`);
  lines.push(`  Worker:  ${workerLine}`);
  lines.push(`  Docker:  ${dockerLine}`);
  lines.push(
    `  Repos:   ${status.repos.count} configured${status.repos.names.length > 0 ? ` (${status.repos.names.join(', ')})` : ''}`,
  );
  lines.push('');

  return lines.join('\n');
}
