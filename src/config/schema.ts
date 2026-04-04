import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);

const NotificationTelegramYamlSchema = z.object({
  enabled: z.boolean().default(false),
  bot_token_env: nonEmptyString.optional(),
  chat_ids: z.array(nonEmptyString).default([]),
});

const NotificationEmailYamlSchema = z.object({
  enabled: z.boolean().default(false),
  resend_api_key_env: nonEmptyString.optional(),
  from: nonEmptyString.optional(),
  recipients: z.array(nonEmptyString).default([]),
});

export const ServerYamlSchema = z.object({
  server: z.object({
    id: nonEmptyString,
    public_url: z.string().trim().optional(),
    port: z.number().int().min(1).max(65535).default(8080),
    history: z
      .object({
        max_jobs: z.number().int().min(1).default(250),
        ttl_seconds: z.number().int().min(60).default(604800),
      })
      .default({
        max_jobs: 250,
        ttl_seconds: 604800,
      }),
    rate_limit: z
      .object({
        webhook_per_minute: z.number().int().min(1).default(30),
        admin_per_minute: z.number().int().min(1).default(60),
      })
      .default({
        webhook_per_minute: 30,
        admin_per_minute: 60,
      }),
    security: z.object({
      replay_window_seconds: z.number().int().min(30).default(300),
      admin_read_token_env: nonEmptyString,
      admin_write_token_env: nonEmptyString,
    }),
    defaults: z
      .object({
        pull_timeout_ms: z.number().int().positive().default(300000),
        up_timeout_ms: z.number().int().positive().default(300000),
        healthcheck_timeout_ms: z.number().int().positive().default(60000),
        healthcheck_interval_ms: z.number().int().positive().default(5000),
        retry_attempts: z.number().int().min(0).max(5).default(2),
        retry_backoff_ms: z.number().int().positive().default(5000),
      })
      .default({
        pull_timeout_ms: 300000,
        up_timeout_ms: 300000,
        healthcheck_timeout_ms: 60000,
        healthcheck_interval_ms: 5000,
        retry_attempts: 2,
        retry_backoff_ms: 5000,
      }),
    notifications: z
      .object({
        telegram: NotificationTelegramYamlSchema.default({
          enabled: false,
          chat_ids: [],
        }),
        email: NotificationEmailYamlSchema.default({
          enabled: false,
          recipients: [],
        }),
      })
      .default({
        telegram: {
          enabled: false,
          chat_ids: [],
        },
        email: {
          enabled: false,
          recipients: [],
        },
      }),
  }),
});

const HealthcheckYamlSchema = z
  .object({
    enabled: z.boolean().default(false),
    url: nonEmptyString.optional(),
    timeout_ms: z.number().int().positive().optional(),
    interval_ms: z.number().int().positive().optional(),
  })
  .default({
    enabled: false,
  });

const TimeoutsYamlSchema = z.object({
  pull_timeout_ms: z.number().int().positive().optional(),
  up_timeout_ms: z.number().int().positive().optional(),
  healthcheck_timeout_ms: z.number().int().positive().optional(),
  healthcheck_interval_ms: z.number().int().positive().optional(),
  retry_attempts: z.number().int().min(0).max(5).optional(),
  retry_backoff_ms: z.number().int().positive().optional(),
});

const RepoNotificationsYamlSchema = z.object({
  telegram: z
    .object({
      chat_ids: z.array(nonEmptyString).default([]),
    })
    .optional(),
  email: z
    .object({
      recipients: z.array(nonEmptyString).default([]),
    })
    .optional(),
});

const EnvironmentYamlSchema = z.object({
  image_name: nonEmptyString,
  compose_file: nonEmptyString,
  runtime_env_file: nonEmptyString,
  services: z.array(nonEmptyString).min(1),
  allowed_workflows: z.array(nonEmptyString).min(1),
  allowed_branches: z.array(nonEmptyString).min(1),
  allowed_tag_pattern: nonEmptyString,
  healthcheck: HealthcheckYamlSchema.optional(),
  timeouts: TimeoutsYamlSchema.optional(),
  notifications: RepoNotificationsYamlSchema.optional(),
});

export const RepoYamlSchema = z.object({
  repository: nonEmptyString.regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
  webhook: z.object({
    bearer_token_env: nonEmptyString,
    hmac_secret_env: nonEmptyString,
  }),
  environments: z
    .record(nonEmptyString, EnvironmentYamlSchema)
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one environment must be configured',
    }),
});

export type ServerYaml = z.infer<typeof ServerYamlSchema>;
export type RepoYaml = z.infer<typeof RepoYamlSchema>;

export interface DeployDefaults {
  pullTimeoutMs: number;
  upTimeoutMs: number;
  healthcheckTimeoutMs: number;
  healthcheckIntervalMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
}

export interface ServerNotificationConfig {
  telegram: {
    enabled: boolean;
    botToken?: string;
    chatIds: string[];
  };
  email: {
    enabled: boolean;
    resendApiKey?: string;
    from?: string;
    recipients: string[];
  };
}

export interface ServerConfig {
  id: string;
  publicUrl?: string;
  port: number;
  history: {
    maxJobs: number;
    ttlSeconds: number;
  };
  rateLimit: {
    webhookPerMinute: number;
    adminPerMinute: number;
  };
  security: {
    replayWindowSeconds: number;
    adminReadToken: string;
    adminWriteToken: string;
  };
  defaults: DeployDefaults;
  notifications: ServerNotificationConfig;
}

export interface EnvironmentConfig {
  imageName: string;
  composeFile: string;
  runtimeEnvFile: string;
  services: string[];
  allowedWorkflows: string[];
  allowedBranches: string[];
  allowedTagPattern: string;
  healthcheck: {
    enabled: boolean;
    url?: string;
    timeoutMs?: number;
    intervalMs?: number;
  };
  timeouts?: Partial<DeployDefaults>;
  notifications?: {
    telegram?: {
      chatIds: string[];
    };
    email?: {
      recipients: string[];
    };
  };
}

export interface RepoConfig {
  repository: string;
  webhook: {
    bearerToken: string;
    hmacSecret: string;
  };
  environments: Record<string, EnvironmentConfig>;
}

export interface LoadedConfig {
  server: ServerConfig;
  repos: Map<string, RepoConfig>;
}
