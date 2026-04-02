import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';

import yaml from 'js-yaml';
import { ZodError } from 'zod';

import { logger } from '../logger';
import {
  type DeployDefaults,
  type EnvironmentConfig,
  type LoadedConfig,
  RepoYamlSchema,
  ServerYamlSchema,
  type RepoConfig,
  type RepoYaml,
  type ServerConfig,
  type ServerYaml,
} from './schema';
import { ConfigError } from './errors';
import { getComposeServiceNames } from './compose';
import { resolveConfigPaths } from './paths';

export interface LoadConfigOptions {
  serverConfigPath?: string;
  reposConfigPath?: string;
}

function parseYamlFile<T>(filePath: string): T {
  if (!existsSync(filePath)) {
    throw new ConfigError(`Configuration file does not exist: ${filePath}`);
  }

  const rawContent = readFileSync(filePath, 'utf8');
  const parsed = yaml.load(rawContent) as unknown;
  return parsed as T;
}

function resolveEnvValue(envName: string, context: Record<string, unknown>): string {
  const value = process.env[envName];
  if (!value || value.trim().length === 0) {
    throw new ConfigError(`Required environment variable is missing or empty: ${envName}`, {
      ...context,
      envName,
    });
  }
  return value;
}

function toServerConfig(serverYaml: ServerYaml): ServerConfig {
  const security = serverYaml.server.security;
  const telegram = serverYaml.server.notifications.telegram;
  const email = serverYaml.server.notifications.email;

  const adminReadToken = resolveEnvValue(security.admin_read_token_env, {
    section: 'server.security.admin_read_token_env',
  });
  const adminWriteToken = resolveEnvValue(security.admin_write_token_env, {
    section: 'server.security.admin_write_token_env',
  });

  const telegramEnabled = telegram.enabled;
  const emailEnabled = email.enabled;

  const botToken = telegramEnabled
    ? resolveEnvValue(telegram.bot_token_env ?? '', {
        section: 'server.notifications.telegram.bot_token_env',
      })
    : undefined;

  const resendApiKey = emailEnabled
    ? resolveEnvValue(email.resend_api_key_env ?? '', {
        section: 'server.notifications.email.resend_api_key_env',
      })
    : undefined;

  if (emailEnabled && !email.from) {
    throw new ConfigError(
      'Email notifications are enabled but notifications.email.from is missing',
    );
  }

  return {
    id: serverYaml.server.id,
    port: Number(process.env.PORT ?? serverYaml.server.port),
    history: {
      maxJobs: serverYaml.server.history.max_jobs,
      ttlSeconds: serverYaml.server.history.ttl_seconds,
    },
    rateLimit: {
      webhookPerMinute: serverYaml.server.rate_limit.webhook_per_minute,
      adminPerMinute: serverYaml.server.rate_limit.admin_per_minute,
    },
    security: {
      replayWindowSeconds: serverYaml.server.security.replay_window_seconds,
      adminReadToken,
      adminWriteToken,
    },
    defaults: {
      pullTimeoutMs: serverYaml.server.defaults.pull_timeout_ms,
      upTimeoutMs: serverYaml.server.defaults.up_timeout_ms,
      healthcheckTimeoutMs: serverYaml.server.defaults.healthcheck_timeout_ms,
      healthcheckIntervalMs: serverYaml.server.defaults.healthcheck_interval_ms,
      retryAttempts: serverYaml.server.defaults.retry_attempts,
      retryBackoffMs: serverYaml.server.defaults.retry_backoff_ms,
    },
    notifications: {
      telegram: {
        enabled: telegramEnabled,
        botToken,
        chatIds: telegram.chat_ids,
      },
      email: {
        enabled: emailEnabled,
        resendApiKey,
        from: email.from,
        recipients: email.recipients,
      },
    },
  };
}

function validateEnvironmentFiles(
  repository: string,
  environment: string,
  config: EnvironmentConfig,
): void {
  if (!existsSync(config.composeFile)) {
    throw new ConfigError(`Compose file does not exist: ${config.composeFile}`, {
      repository,
      environment,
    });
  }

  const runtimeDir = dirname(config.runtimeEnvFile);
  if (!existsSync(runtimeDir)) {
    throw new ConfigError(`Runtime env directory does not exist: ${runtimeDir}`, {
      repository,
      environment,
    });
  }

  if (config.healthcheck.enabled && !config.healthcheck.url) {
    throw new ConfigError('Healthcheck is enabled but url is missing', {
      repository,
      environment,
    });
  }

  try {
    // eslint-disable-next-line no-new
    new RegExp(config.allowedTagPattern);
  } catch (error) {
    throw new ConfigError(`Invalid allowed_tag_pattern: ${config.allowedTagPattern}`, {
      repository,
      environment,
      error: String(error),
    });
  }

  const composeServices = getComposeServiceNames(config.composeFile);
  if (composeServices.length === 0) {
    throw new ConfigError(`Compose file does not define services: ${config.composeFile}`, {
      repository,
      environment,
    });
  }

  const missingServices = config.services.filter((service) => !composeServices.includes(service));
  if (missingServices.length > 0) {
    throw new ConfigError(
      `Configured services are missing in compose file: ${missingServices.join(', ')}`,
      {
        repository,
        environment,
        composeFile: config.composeFile,
      },
    );
  }
}

function toEnvironmentConfig(yamlEnvironment: RepoYaml['environments'][string]): EnvironmentConfig {
  return {
    imageName: yamlEnvironment.image_name,
    composeFile: yamlEnvironment.compose_file,
    runtimeEnvFile: yamlEnvironment.runtime_env_file,
    services: yamlEnvironment.services,
    allowedWorkflows: yamlEnvironment.allowed_workflows,
    allowedBranches: yamlEnvironment.allowed_branches,
    allowedTagPattern: yamlEnvironment.allowed_tag_pattern,
    healthcheck: {
      enabled: yamlEnvironment.healthcheck?.enabled ?? false,
      url: yamlEnvironment.healthcheck?.url,
      timeoutMs: yamlEnvironment.healthcheck?.timeout_ms,
      intervalMs: yamlEnvironment.healthcheck?.interval_ms,
    },
    timeouts: yamlEnvironment.timeouts
      ? {
          pullTimeoutMs: yamlEnvironment.timeouts.pull_timeout_ms,
          upTimeoutMs: yamlEnvironment.timeouts.up_timeout_ms,
          healthcheckTimeoutMs: yamlEnvironment.timeouts.healthcheck_timeout_ms,
          healthcheckIntervalMs: yamlEnvironment.timeouts.healthcheck_interval_ms,
          retryAttempts: yamlEnvironment.timeouts.retry_attempts,
          retryBackoffMs: yamlEnvironment.timeouts.retry_backoff_ms,
        }
      : undefined,
    notifications: yamlEnvironment.notifications
      ? {
          telegram: yamlEnvironment.notifications.telegram
            ? {
                chatIds: yamlEnvironment.notifications.telegram.chat_ids,
              }
            : undefined,
          email: yamlEnvironment.notifications.email
            ? {
                recipients: yamlEnvironment.notifications.email.recipients,
              }
            : undefined,
        }
      : undefined,
  };
}

function toRepoConfig(repoYaml: RepoYaml): RepoConfig {
  const bearerToken = resolveEnvValue(repoYaml.webhook.bearer_token_env, {
    repository: repoYaml.repository,
    section: 'webhook.bearer_token_env',
  });
  const hmacSecret = resolveEnvValue(repoYaml.webhook.hmac_secret_env, {
    repository: repoYaml.repository,
    section: 'webhook.hmac_secret_env',
  });

  const environments = Object.fromEntries(
    Object.entries(repoYaml.environments).map(([environmentName, environmentConfig]) => [
      environmentName,
      toEnvironmentConfig(environmentConfig),
    ]),
  );

  for (const [environmentName, environmentConfig] of Object.entries(environments)) {
    validateEnvironmentFiles(repoYaml.repository, environmentName, environmentConfig);
  }

  return {
    repository: repoYaml.repository,
    webhook: {
      bearerToken,
      hmacSecret,
    },
    environments,
  };
}

function getReposConfigFiles(reposConfigPath: string): string[] {
  if (!existsSync(reposConfigPath)) {
    throw new ConfigError(`Repos configuration directory does not exist: ${reposConfigPath}`);
  }

  return readdirSync(reposConfigPath)
    .filter((entry) => ['.yml', '.yaml'].includes(extname(entry)))
    .sort()
    .map((entry) => join(reposConfigPath, entry));
}

function mergeTimeouts(
  defaults: DeployDefaults,
  overrides?: Partial<DeployDefaults>,
): Partial<DeployDefaults> | undefined {
  if (!overrides) {
    return undefined;
  }

  return {
    pullTimeoutMs: overrides.pullTimeoutMs ?? defaults.pullTimeoutMs,
    upTimeoutMs: overrides.upTimeoutMs ?? defaults.upTimeoutMs,
    healthcheckTimeoutMs: overrides.healthcheckTimeoutMs ?? defaults.healthcheckTimeoutMs,
    healthcheckIntervalMs: overrides.healthcheckIntervalMs ?? defaults.healthcheckIntervalMs,
    retryAttempts: overrides.retryAttempts ?? defaults.retryAttempts,
    retryBackoffMs: overrides.retryBackoffMs ?? defaults.retryBackoffMs,
  };
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const { serverConfigPath, reposConfigPath } = resolveConfigPaths(options);

  const serverParsed = parseYamlFile<unknown>(serverConfigPath);
  const serverYaml = ServerYamlSchema.parse(serverParsed);
  const serverConfig = toServerConfig(serverYaml);

  const repos = new Map<string, RepoConfig>();
  const validationErrors: ConfigError[] = [];

  for (const filePath of getReposConfigFiles(reposConfigPath)) {
    try {
      const repoParsed = parseYamlFile<unknown>(filePath);
      const repoYaml = RepoYamlSchema.parse(repoParsed);
      const repoConfig = toRepoConfig(repoYaml);

      if (repos.has(repoConfig.repository)) {
        throw new ConfigError(`Duplicate repository config detected: ${repoConfig.repository}`, {
          filePath,
        });
      }

      for (const environmentConfig of Object.values(repoConfig.environments)) {
        environmentConfig.timeouts = mergeTimeouts(
          serverConfig.defaults,
          environmentConfig.timeouts,
        );
      }

      repos.set(repoConfig.repository, repoConfig);
    } catch (error) {
      if (error instanceof ConfigError) {
        validationErrors.push(error);
        continue;
      }

      if (error instanceof ZodError) {
        validationErrors.push(
          new ConfigError(`Invalid repository config schema in ${filePath}`, {
            filePath,
            issues: error.issues,
          }),
        );
        continue;
      }

      validationErrors.push(
        new ConfigError(`Failed to load repository config ${filePath}`, {
          filePath,
          error: String(error),
        }),
      );
    }
  }

  if (validationErrors.length > 0) {
    const messages = validationErrors.map((error) => error.message).join(' | ');
    throw new ConfigError(`Configuration errors detected: ${messages}`, {
      errors: validationErrors.map((error) => ({
        message: error.message,
        context: error.context,
      })),
    });
  }

  const stateDir = resolve(process.env.STATE_DIR ?? './data/state');
  mkdirSync(stateDir, { recursive: true });

  logger.debug('Configuration loaded', {
    serverId: serverConfig.id,
    repos: Array.from(repos.keys()),
  });

  return {
    server: serverConfig,
    repos,
  };
}
