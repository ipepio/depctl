# depctl

Self-hosted deploy webhook server + CLI for Docker Compose stacks.

Receives webhooks from GitHub Actions, validates them and deploys new images
to locally-managed stacks. All sensitive administration is done locally via
a CLI/TUI — nothing sensitive is exposed over HTTP.

## Install

```bash
curl -sSL https://raw.githubusercontent.com/ipepio/docker-deploy-webhook/main/install.sh | bash
```

The script installs prerequisites, creates `/opt/depctl` and `/opt/stacks`,
starts the service and shows you the admin tokens.

## Quick start

```bash
# 1. Configure instance (public URL, port, stacks dir)
depctl init

# 2. Add a repo (interactive wizard: image, secrets, stack, GHCR auth)
depctl repo add

# 3. Generate the GitHub Actions workflow
depctl workflow generate

# 4. Validate config and restart
depctl validate
docker compose restart webhook
```

## Commands

```
depctl init                       Configure instance (URL, port, stacks dir)
depctl status                     Health check of all components

depctl repo add                   Interactive wizard: image, secrets, stack, GHCR auth
depctl repo remove                Remove repo with confirmation
depctl repo list                  List configured repos
depctl repo show  <owner/repo>    Environment matrix (branches, tags, workflows, stack)
depctl repo edit  --repository    Edit repo config

depctl repo secrets generate      Generate Bearer + HMAC tokens (non-destructive)
depctl repo secrets show          Show tokens formatted for GitHub Secrets
depctl repo secrets rotate        Regenerate tokens with confirmation

depctl env add   --repository --environment
depctl env edit  --repository --environment

depctl logs    <owner/repo>       Logs of last deploy (--job <id> for specific job)
depctl history <owner/repo>       Table of last N deploys (--limit, --env, --json)
depctl rollback <owner/repo>      Roll back to last successful tag (with confirmation)

depctl deploy manual              Trigger deploy manually
depctl deploy redeploy-last-successful
depctl deploy retry --job-id

depctl stack init                 Generate docker-compose.yml for a repo
depctl stack show                 Show stack metadata
depctl stack service add          Add a service (postgres, redis, nginx...)
depctl stack service edit

depctl workflow generate          Interactive wizard → .github/workflows/release.yml
                                  (--write to save directly, --output <path>)

depctl validate                   Validate all config before restarting webhook

depctl migrate scan               Scan for v1 config to migrate
depctl migrate plan
depctl migrate apply

depctl tui                        Interactive terminal UI
```

## How it works

```
GitHub Actions
    │
    │  POST /deploy
    │  Authorization: Bearer <token>
    │  X-Deploy-Timestamp + X-Deploy-Signature (HMAC-SHA256)
    ▼
webhook container
    │  validates auth + payload against config/repos/*.yml
    │  enqueues job in Redis
    ▼
worker
    │  docker compose pull
    │  docker compose up -d
    │  optional healthcheck
    │  saves rollback state
    ▼
stack running in /opt/stacks/<owner>/<repo>/
```

Two surfaces:

| Surface | Who uses it | What it does |
|---------|-------------|--------------|
| Remote (`POST /deploy`, `GET /health`, `GET /deployments/recent`) | GitHub Actions, monitoring | Trigger and observe deploys |
| Local (`depctl` CLI / TUI) | Operator on the server | Configure repos, secrets, stacks |

## Repo config

Each repo lives in `config/repos/<owner>--<repo>.yml`:

```yaml
repository: acme/payments-api
webhook:
  bearer_token_env: ACME_PAYMENTS_API_WEBHOOK_BEARER
  hmac_secret_env:  ACME_PAYMENTS_API_WEBHOOK_HMAC
environments:
  production:
    image_name:        ghcr.io/acme/payments-api
    compose_file:      /opt/stacks/acme/payments-api/docker-compose.yml
    runtime_env_file:  /opt/stacks/acme/payments-api/.deploy.env
    services:          [app, worker]
    allowed_workflows: [Release]
    allowed_branches:  [master]
    allowed_tag_pattern: '^v[0-9]+\.[0-9]+\.[0-9]+$'
    healthcheck:
      enabled: false
```

See `docs/multi-environment.md` for production + staging setups.

## GitHub Secrets

After `depctl repo add` (or `depctl repo secrets show`):

| Secret | Value |
|--------|-------|
| `DEPLOY_WEBHOOK_URL` | `https://deploy.yourserver.com` |
| `DEPLOY_WEBHOOK_BEARER` | shown by `secrets show` |
| `DEPLOY_WEBHOOK_HMAC` | shown by `secrets show` |

Generate the workflow with `depctl workflow generate`.

## Remote API

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/deploy` | Bearer + HMAC | Automatic webhook |
| `GET` | `/health` | None | Service health |
| `GET` | `/jobs/:id` | Admin read | Job status |
| `GET` | `/deployments/recent` | Admin read | Recent history |

## Directory layout

```
/opt/depctl/
  config/
    server.yml          # server config
    repos/
      acme--app.yml     # one file per repo
  data/                 # job history + rollback state
  .env                  # tokens and secrets

/opt/stacks/
  <owner>/<repo>/
    docker-compose.yml
    .env                # app secrets and config
    .deploy.env         # IMAGE_NAME + IMAGE_TAG (written per deploy)
```

## Development

```bash
npm run build           # TypeScript compile
npm test                # Run tests (32 tests, 11 suites)
npm run lint            # ESLint
npm start               # Webhook mode
npm run start:admin -- help   # Admin CLI
```

## Documentation

- `docs/how-it-works-v2.md` — detailed internals
- `docs/how-to-add-repo.md` — step-by-step repo setup
- `docs/multi-environment.md` — production + staging configuration
- `docs/troubleshooting.md` — GHCR auth, branch vs tag, common errors
- `docs/release-checklist.md` — release process
- `docs/runbook.md` — day-to-day operations
- `docs/arquitectura-v2.md` — architecture contracts
