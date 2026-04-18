# depctl

Self-hosted deploy webhook server + CLI for Docker Compose stacks.

Receives webhooks from GitHub Actions, validates auth (Bearer + HMAC + anti-replay),
and deploys new images to locally-managed stacks. All admin operations happen via
a native CLI on the server — nothing sensitive is exposed over HTTP.

## Install

```bash
curl -sSL https://raw.githubusercontent.com/ipepio/depctl/main/install.sh | sudo bash
```

The installer will:
- Install Docker, Node.js, and other prerequisites (with confirmation)
- Pull the pre-built image from `ghcr.io/ipepio/depctl`
- Start the webhook server + Redis
- Install the `depctl` CLI on your PATH
- Add your user to the `docker` group

### Update

```bash
depctl update
```

Downloads the latest CLI bundle + pulls the latest webhook image + restarts services.

## Quick start

```bash
# 1. Add a repo (interactive wizard)
depctl repo add

# 2. Generate the GitHub Actions workflow
depctl workflow generate --repository owner/repo

# 3. Validate config and restart
depctl validate
docker compose -f /opt/depctl/docker-compose.yml restart webhook

# 4. Add the secrets shown by the wizard to your GitHub repo
#    Settings > Secrets and variables > Actions
```

## How it works

```
GitHub Actions
    |
    |  POST /deploy
    |  Authorization: Bearer <token>
    |  X-Deploy-Timestamp + X-Deploy-Signature (HMAC-SHA256)
    v
webhook (Docker container)
    |  validates auth + payload against config
    |  enqueues job in Redis (BullMQ)
    v
worker
    |  docker compose pull
    |  docker compose up -d
    |  healthcheck + rollback if needed
    |  persists state + notifies
    v
stack running at /opt/stacks/<owner>/<repo>/
```

| Surface | Who | What |
|---------|-----|------|
| **Remote** — `POST /deploy`, `GET /health` | GitHub Actions | Trigger and observe deploys |
| **Local** — `depctl` CLI | Server operator | Configure repos, secrets, stacks, proxy |

## Commands

```
Instance
  depctl init                         Configure instance (URL, port, stacks dir)
  depctl status [--json]              Health of all components
  depctl update                       Update depctl CLI + webhook image

Repositories
  depctl repo add                     Interactive wizard
  depctl repo list                    List configured repos
  depctl repo show  --repository      Environment matrix
  depctl repo edit  [--repository]    Interactive editor (arrow-key selector)
  depctl repo remove --repository     Remove with confirmation

Secrets
  depctl repo secrets generate --repository
  depctl repo secrets show     --repository [--json]
  depctl repo secrets rotate   --repository [--force]

Environments
  depctl env add  --repository --environment
  depctl env edit --repository --environment

Deploy operations
  depctl logs    <owner/repo>         Logs of last deploy
  depctl history <owner/repo>         Recent deploy history
  depctl rollback <owner/repo>        Roll back to last successful tag
  depctl deploy manual                Trigger deploy manually
  depctl deploy redeploy-last-successful
  depctl deploy retry --job-id

Stack management
  depctl stack init                   Generate docker-compose.yml for a repo
  depctl stack show                   Show stack metadata
  depctl stack service add            Add a service (postgres, redis, custom...)
  depctl stack service edit

Workflow
  depctl workflow generate            Generate GitHub Actions workflow
                                      (--write to save, --output <path>)

Proxy (Caddy)
  depctl proxy init                   Initialize reverse proxy
  depctl proxy status                 Caddy health, routes, SSL
  depctl proxy domains                List all proxy routes
  depctl proxy enable <owner/repo>    Add proxy route
  depctl proxy disable <owner/repo>   Remove proxy route
  depctl proxy ssl <owner/repo>       Configure SSL mode

Other
  depctl validate                     Validate all config
  depctl tui                          Interactive terminal UI
```

## Stack services

The stack builder generates `docker-compose.yml` files with these service types:

| Kind | Image | Deployable | Use case |
|------|-------|-----------|----------|
| `app` | Your app image | Yes | Main application |
| `worker` | Your app image | Yes | Background jobs |
| `postgres` | `postgres:16-alpine` | No | Database |
| `redis` | `redis:7-alpine` | No | Cache/queue |
| `nginx` | `nginx:1.27-alpine` | No | Reverse proxy |
| `custom` | Any Docker image | Configurable | Anything else |

Custom services accept any Docker image with optional ports, volumes, environment variables, and commands.

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
    allowed_branches:  [main]
    allowed_tag_pattern: '^v[0-9]+\.[0-9]+\.[0-9]+$'
    healthcheck:
      enabled: true
      url: http://127.0.0.1:3000/health
```

## GitHub Secrets

After `depctl repo add`, copy these secrets to your GitHub repo:

| Secret | Value |
|--------|-------|
| `DEPLOY_WEBHOOK_URL` | `https://deploy.yourserver.com` |
| `DEPLOY_WEBHOOK_BEARER` | shown by wizard |
| `DEPLOY_WEBHOOK_HMAC` | shown by wizard |

## Remote API

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/deploy` | Bearer + HMAC | Deploy webhook |
| `GET` | `/health` | None | Service health |
| `GET` | `/jobs/:id` | Admin read token | Job status |
| `GET` | `/deployments/recent` | Admin read token | Recent history |

## Directory layout

```
/opt/depctl/
  depctl-cli.cjs          # CLI bundle (native Node.js)
  docker-compose.yml      # webhook + redis
  config/
    server.yml            # server config
    repos/                # one YAML per repo
  data/                   # job history + rollback state
  .env                    # tokens and secrets

/opt/stacks/
  <owner>/<repo>/
    docker-compose.yml    # generated by stack init
    .env                  # app secrets (managed blocks)
    .deploy.env           # IMAGE_NAME + IMAGE_TAG (written per deploy)
```

## Development

```bash
npm install               # Install dependencies
npm run build             # TypeScript compile
npm run build:cli         # Bundle CLI with esbuild
npm test                  # Jest tests
npm run lint              # ESLint
npm run dev               # Dev server with nodemon
```

## Tech stack

- **Runtime**: Node.js 20, TypeScript (strict)
- **Server**: Express
- **Queue**: BullMQ + Redis
- **Config**: YAML + Zod validation
- **Logging**: Winston (structured JSON)
- **Notifications**: Telegram, Resend (email)
- **Tests**: Jest + Supertest
- **Build**: esbuild (CLI bundle), Docker (webhook image)

## Security

- Local config is authoritative — payloads never decide paths, compose files, or commands
- Secrets only in environment variables, never in YAML or code
- No shell command construction from external data (`execFile` with array args only)
- Only `docker compose` on validated compose files + services
- Auto deploys: `POST /deploy` with Bearer + HMAC + anti-replay
- Admin operations: local CLI only, never via remote API

## License

[MPL-2.0](LICENSE) — Mozilla Public License 2.0
