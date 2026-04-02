import request from 'supertest';

import { createApp } from './server';
import { initConfig, resetConfig } from '../config';
import { createTempConfigFixture } from '../test-utils/temp-config';

describe('router v2 surface', () => {
  afterEach(() => {
    resetConfig();
    delete process.env.TEST_ADMIN_READ_TOKEN;
    delete process.env.TEST_ADMIN_WRITE_TOKEN;
    delete process.env.TEST_REPO_BEARER;
    delete process.env.TEST_REPO_HMAC;
    delete process.env.STATE_DIR;
  });

  it('does not expose admin write routes remotely', async () => {
    const fixture = createTempConfigFixture();
    process.env.TEST_ADMIN_READ_TOKEN = 'read-token';
    process.env.TEST_ADMIN_WRITE_TOKEN = 'write-token';
    process.env.TEST_REPO_BEARER = 'repo-bearer';
    process.env.TEST_REPO_HMAC = 'repo-hmac';
    process.env.STATE_DIR = `${fixture.rootDir}/state`;

    await initConfig({
      serverConfigPath: fixture.serverConfigPath,
      reposConfigPath: fixture.reposConfigPath,
    });

    const app = createApp();
    await request(app).post('/admin/deploy').send({}).expect(404);
    await request(app).post('/admin/deploy/redeploy-last-successful').send({}).expect(404);
    await request(app).post('/admin/jobs/job-1/retry').send({}).expect(404);

    fixture.cleanup();
  });
});
