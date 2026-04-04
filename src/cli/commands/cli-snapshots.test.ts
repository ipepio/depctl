import { createHarnessWorkspace, addRepoFixture, runCli, normalizeOutput } from '../../test-utils/cli-harness';

describe('CLI human output snapshots (F12)', () => {
  let workspace: ReturnType<typeof createHarnessWorkspace>;

  beforeAll(() => {
    workspace = createHarnessWorkspace();
    addRepoFixture(workspace, 'acme/snapshot-app');
  });

  afterAll(() => { workspace.cleanup(); });

  it('repo show human format contains key sections', () => {
    const result = runCli(['repo', 'show', '--repository', 'acme/snapshot-app'], workspace);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('acme/snapshot-app');
    expect(result.stdout).toContain('production');
    expect(result.stdout).toContain('master');
    expect(result.stdout).toContain('Release');
  });

  it('repo list human output contains repo name', () => {
    const result = runCli(['repo', 'list'], workspace);
    expect(result.exitCode).toBe(0);
    // repo list outputs JSON by default — check it includes our repo
    expect(result.stdout).toContain('acme/snapshot-app');
  });

  it('secrets show human format contains expected labels', () => {
    const result = runCli(['repo', 'secrets', 'show', '--repository', 'acme/snapshot-app'], workspace);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('DEPLOY_WEBHOOK_URL');
    expect(result.stdout).toContain('DEPLOY_WEBHOOK_BEARER');
    expect(result.stdout).toContain('DEPLOY_WEBHOOK_HMAC');
    expect(result.stdout).toContain('deploy.test.example.com');
  });

  it('help output contains all major command groups', () => {
    const result = runCli(['help'], workspace);
    const out = result.stdout;
    expect(out).toContain('depctl repo add');
    expect(out).toContain('depctl history');
    expect(out).toContain('depctl rollback');
    expect(out).toContain('depctl workflow generate');
    expect(out).toContain('depctl validate');
  });

  it('normalizeOutput strips dynamic fields', () => {
    const raw = 'job 550e8400-e29b-41d4-a716-446655440000 at 2026-04-04T08:00:00.000Z took 12s';
    const normalized = normalizeOutput(raw);
    expect(normalized).not.toContain('550e8400');
    expect(normalized).not.toContain('2026-04-04T');
    expect(normalized).not.toContain('12s');
    expect(normalized).toContain('<UUID>');
    expect(normalized).toContain('<TIMESTAMP>');
    expect(normalized).toContain('<Ns>');
  });
});
