/**
 * Task 9.3 — Actionable error catalogue
 *
 * Centralises known error codes with human-readable messages and remediation hints.
 * Used both in HTTP responses (deploy validator) and in CLI output.
 */

export interface ActionableError {
  code: string;
  message: string;
  hint: string;
}

export const ERRORS = {
  // ── Auth / GHCR ─────────────────────────────────────────────────
  GHCR_UNAUTHORIZED: {
    code: 'ghcr_unauthorized',
    message: 'GHCR authentication required — no credentials found for this registry.',
    hint:
      "Run: docker login ghcr.io\n" +
      "  You need a GitHub PAT (classic) with 'read:packages' scope.\n" +
      "  Create one at: https://github.com/settings/tokens/new?scopes=read:packages",
  },
  GHCR_DENIED: {
    code: 'ghcr_denied',
    message: 'GHCR access denied — credentials exist but lack required permissions.',
    hint:
      "The token used for 'docker login ghcr.io' does not have the 'read:packages' scope.\n" +
      "  Create a classic PAT with 'read:packages' and run 'docker login ghcr.io' again.\n" +
      "  If the package belongs to an org, verify you have access to that org's packages.",
  },

  // ── Deploy validator (403s) ────────────────────────────────────
  BRANCH_NOT_ALLOWED: (refName: string, allowed: string[], tagPattern: string): ActionableError => ({
    code: 'branch_not_allowed',
    message: `ref_name "${refName}" is not in allowed_branches and does not match allowed_tag_pattern.`,
    hint:
      `Allowed branches: [${allowed.join(', ')}]\n` +
      `  Allowed tag pattern: ${tagPattern}\n` +
      `  Fix options:\n` +
      `    1. Add "${refName}" to allowed_branches in the repo config.\n` +
      `    2. Adjust allowed_tag_pattern to match this ref.\n` +
      `    3. Update your GitHub Actions workflow to send the correct ref_name.`,
  }),

  WORKFLOW_NOT_ALLOWED: (workflow: string, allowed: string[]): ActionableError => ({
    code: 'workflow_not_allowed',
    message: `Workflow "${workflow}" is not in allowed_workflows.`,
    hint:
      `Allowed workflows: [${allowed.join(', ')}]\n` +
      `  Fix options:\n` +
      `    1. Add "${workflow}" to allowed_workflows in the repo config.\n` +
      `    2. Update your GitHub Actions workflow name to match one of the allowed values.\n` +
      `    3. Regenerate the workflow with: deployctl workflow generate`,
  }),

  ENVIRONMENT_NOT_ALLOWED: (env: string): ActionableError => ({
    code: 'environment_not_allowed',
    message: `Environment "${env}" is not configured for this repository.`,
    hint:
      `Run: deployctl env add --repository <owner/repo> --environment ${env}\n` +
      `  Or check the existing environments with: deployctl repo show <owner/repo>`,
  }),

  TAG_NOT_ALLOWED: (tag: string, pattern: string): ActionableError => ({
    code: 'tag_not_allowed',
    message: `Tag "${tag}" does not match allowed_tag_pattern.`,
    hint:
      `Pattern: ${pattern}\n` +
      `  Fix options:\n` +
      `    1. Push a tag that matches the pattern (e.g. v1.2.3).\n` +
      `    2. Update allowed_tag_pattern in the repo config.`,
  }),

  // ── Config / runtime ────────────────────────────────────────────
  COMPOSE_FILE_NOT_FOUND: (path: string): ActionableError => ({
    code: 'compose_file_not_found',
    message: `Compose file does not exist: ${path}`,
    hint:
      `Run: deployctl stack init --repository <owner/repo> --environment <env>\n` +
      `  Or create the file manually at ${path}`,
  }),

  DOCKER_SOCKET_ERROR: {
    code: 'docker_socket_error',
    message: 'Cannot access Docker socket.',
    hint:
      'Is Docker running?\n' +
      '  Check: sudo systemctl status docker\n' +
      '  Start: sudo systemctl start docker\n' +
      '  Make sure the webhook container has /var/run/docker.sock mounted.',
  },

  SECRETS_MISSING: (repository: string): ActionableError => ({
    code: 'secrets_missing',
    message: `Webhook secrets not found for repository: ${repository}`,
    hint:
      `Run: deployctl repo secrets generate --repository ${repository}\n` +
      `  Then copy the output to GitHub Secrets:\n` +
      `  Settings → Secrets and variables → Actions`,
  }),

  REPOSITORY_NOT_FOUND: (repository: string): ActionableError => ({
    code: 'repository_not_found',
    message: `Repository not configured: ${repository}`,
    hint:
      `Run: deployctl repo add\n` +
      `  Or list configured repos with: deployctl repo list`,
  }),
} as const;

/**
 * Format an ActionableError for CLI output.
 */
export function formatActionableError(error: ActionableError): string {
  return `\n  ❌ ${error.message}\n\n  Hint:\n  ${error.hint.replace(/\n/g, '\n  ')}\n`;
}
