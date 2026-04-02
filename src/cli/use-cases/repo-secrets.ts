import { ConfigError } from '../../config/errors';
import { resolveServiceEnvPath } from '../../config/paths';
import { readRepoFile } from '../../config/repo-files';
import { readManagedBlockValues, upsertManagedEnvBlock } from '../../config/service-env';
import { generateHexSecret } from '../secrets';

export interface GeneratedRepoSecrets {
  repository: string;
  bearerTokenEnv: string;
  hmacSecretEnv: string;
}

export interface RevealedRepoSecrets extends GeneratedRepoSecrets {
  bearerToken: string;
  hmacSecret: string;
}

function getBlockId(repository: string): string {
  return `repo ${repository}`;
}

export function generateRepoSecrets(repository: string): GeneratedRepoSecrets {
  const repoYaml = readRepoFile(repository);
  const bearerToken = generateHexSecret(32);
  const hmacSecret = generateHexSecret(32);

  upsertManagedEnvBlock(resolveServiceEnvPath(), getBlockId(repository), {
    [repoYaml.webhook.bearer_token_env]: bearerToken,
    [repoYaml.webhook.hmac_secret_env]: hmacSecret,
  });

  return {
    repository,
    bearerTokenEnv: repoYaml.webhook.bearer_token_env,
    hmacSecretEnv: repoYaml.webhook.hmac_secret_env,
  };
}

export function showRepoSecrets(repository: string): RevealedRepoSecrets {
  const repoYaml = readRepoFile(repository);
  const values = readManagedBlockValues(resolveServiceEnvPath(), [
    repoYaml.webhook.bearer_token_env,
    repoYaml.webhook.hmac_secret_env,
  ]);

  const bearerToken = values[repoYaml.webhook.bearer_token_env];
  const hmacSecret = values[repoYaml.webhook.hmac_secret_env];
  if (!bearerToken || !hmacSecret) {
    throw new ConfigError(`Secrets not found for repository: ${repository}`);
  }

  return {
    repository,
    bearerTokenEnv: repoYaml.webhook.bearer_token_env,
    hmacSecretEnv: repoYaml.webhook.hmac_secret_env,
    bearerToken,
    hmacSecret,
  };
}
