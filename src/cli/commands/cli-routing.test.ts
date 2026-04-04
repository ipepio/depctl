import { createHarnessWorkspace, addRepoFixture, runCli } from '../../test-utils/cli-harness';

describe('CLI routing integration tests (F11)', () => {
  let workspace: ReturnType<typeof createHarnessWorkspace>;

  beforeAll(() => { workspace = createHarnessWorkspace(); });
  afterAll(() => { workspace.cleanup(); });

  // ── F11.A1 — Command dispatch ──────────────────────────────────────────────

  it('help returns exit code 0', () => {
    const result = runCli(['help'], workspace);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('depctl usage');
  });

  it('unknown command returns exit code 2', () => {
    const result = runCli(['nonexistent-command-xyz'], workspace);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/unknown command/i);
  });

  it('nested unknown subcommand returns exit code 2', () => {
    const result = runCli(['repo', 'nonexistent'], workspace);
    expect(result.exitCode).toBe(2);
  });

  it('repo list works with no repos configured', () => {
    const result = runCli(['repo', 'list'], workspace);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  it('repo show requires --repository flag', () => {
    const result = runCli(['repo', 'show'], workspace);
    // should fail fast in non-interactive mode
    expect(result.exitCode).not.toBe(0);
  });

  // ── F11.A2 — JSON contract shapes ─────────────────────────────────────────

  it('repo list --json returns array with required keys', () => {
    addRepoFixture(workspace, 'acme/test-app');
    const result = runCli(['repo', 'list'], workspace);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout) as Array<{ repository: string; filePath: string }>;
    expect(Array.isArray(data)).toBe(true);
    const entry = data.find((d) => d.repository === 'acme/test-app');
    expect(entry).toBeDefined();
    expect(typeof entry!.repository).toBe('string');
    expect(typeof entry!.filePath).toBe('string');
  });

  it('repo show --json returns stable keys', () => {
    addRepoFixture(workspace, 'acme/json-contract-test');
    const result = runCli(['repo', 'show', '--repository', 'acme/json-contract-test', '--json'], workspace);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(typeof data.repository).toBe('string');
    expect(data.webhook).toBeDefined();
    expect(data.environments).toBeDefined();
  });

  it('repo secrets show --json returns stable keys', () => {
    addRepoFixture(workspace, 'acme/secrets-contract');
    const result = runCli(
      ['repo', 'secrets', 'show', '--repository', 'acme/secrets-contract', '--json'],
      workspace,
    );
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(typeof data.repository).toBe('string');
    expect(typeof data.bearerToken).toBe('string');
    expect(typeof data.hmacSecret).toBe('string');
  });
});
