import { ConfigError } from './errors';
import { loadConfig, type LoadConfigOptions } from './loader';
import { loadServiceEnvIntoProcess } from './service-env';

export interface RuntimeValidationResult {
  ok: boolean;
  issues: string[];
}

export async function validateRuntimeConfig(
  options: LoadConfigOptions = {},
): Promise<RuntimeValidationResult> {
  loadServiceEnvIntoProcess();

  try {
    await loadConfig(options);
    return {
      ok: true,
      issues: [],
    };
  } catch (error) {
    if (error instanceof ConfigError) {
      const nestedErrors = Array.isArray(error.context?.errors)
        ? error.context.errors
            .map((entry) => {
              if (!entry || typeof entry !== 'object') {
                return null;
              }

              const message = 'message' in entry ? entry.message : null;
              return typeof message === 'string' ? message : null;
            })
            .filter((message): message is string => Boolean(message))
        : [];

      return {
        ok: false,
        issues: nestedErrors.length > 0 ? nestedErrors : [error.message],
      };
    }

    return {
      ok: false,
      issues: [String(error)],
    };
  }
}
