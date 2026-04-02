import { readFileSync } from 'fs';

import { upsertManagedEnvBlock } from './service-env';
import { createTempAdminWorkspace } from '../test-utils/temp-admin-workspace';

describe('upsertManagedEnvBlock', () => {
  it('updates only the managed block and preserves unrelated content', () => {
    const workspace = createTempAdminWorkspace();
    process.env.SERVICE_ENV_PATH = workspace.serviceEnvPath;

    upsertManagedEnvBlock(workspace.serviceEnvPath, 'repo acme/api', {
      ACME_API_WEBHOOK_BEARER: 'first',
      ACME_API_WEBHOOK_HMAC: 'second',
    });
    upsertManagedEnvBlock(workspace.serviceEnvPath, 'repo acme/api', {
      ACME_API_WEBHOOK_BEARER: 'third',
      ACME_API_WEBHOOK_HMAC: 'fourth',
    });

    const content = readFileSync(workspace.serviceEnvPath, 'utf8');
    expect(content).toContain('REDIS_URL=redis://redis:6379');
    expect(content).toContain('ACME_API_WEBHOOK_BEARER=third');
    expect(content).toContain('ACME_API_WEBHOOK_HMAC=fourth');
    expect(content).not.toContain('ACME_API_WEBHOOK_BEARER=first');

    workspace.cleanup();
    delete process.env.SERVICE_ENV_PATH;
  });
});
