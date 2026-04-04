# Runbook

## Service management

```bash
# Start
cd /opt/depctl && docker compose up -d webhook redis

# Restart webhook (after config changes)
docker compose restart webhook

# Logs
docker compose logs -f webhook
```

## Health check

```bash
# Quick status
depctl status

# Remote health
curl https://deploy.yourserver.com/health
```

## Add a repo

```bash
depctl repo add
```
See `docs/how-to-add-repo.md` for full walkthrough.

## View repo config

```bash
depctl repo show acme/payments-api
```

Shows environment matrix: branches, tags, workflows, stack path.

## Secrets

```bash
# Show current secrets (GitHub Secrets format)
depctl repo secrets show --repository acme/payments-api

# Rotate (invalidates old secrets)
depctl repo secrets rotate --repository acme/payments-api
# → Update GitHub Secrets, then: docker compose restart webhook
```

## Deploy history and logs

```bash
# Last 10 deploys
depctl history acme/payments-api

# Logs from latest deploy
depctl logs acme/payments-api

# Logs from specific job
depctl logs acme/payments-api --job <job-id>

# Remote history (read token required)
curl https://deploy.yourserver.com/deployments/recent \
  -H "Authorization: Bearer <admin_read_token>"
```

## Manual deploy

```bash
depctl deploy manual --repository acme/payments-api --environment production --tag v1.2.3
```

## Rollback

```bash
depctl rollback acme/payments-api
# Shows target tag and asks for confirmation
```

## Retry failed job

```bash
depctl deploy retry --job-id <job-id>
```

## Edit environment config

```bash
depctl env edit --repository acme/payments-api --environment production \
  --allowed-branches master,main
```

## Add service to stack

```bash
docker compose --profile admin run --rm admin stack service add \
  --repository acme/payments-api \
  --environment production \
  --kind redis
```

## Validate config before restart

```bash
depctl validate
docker compose restart webhook
```

## Generate workflow

```bash
depctl workflow generate --repository acme/payments-api
# or write directly to the repo:
depctl workflow generate --repository acme/payments-api --write
```

## Remove a repo

```bash
depctl repo remove --repository acme/payments-api
# Type repo name to confirm. Add --remove-stack to also delete /opt/stacks/
```

## Migrate from v1

```bash
docker compose --profile admin run --rm admin migrate scan
docker compose --profile admin run --rm admin migrate plan
docker compose --profile admin run --rm admin migrate apply
```

## Common issues

See `docs/troubleshooting.md` for:
- GHCR 401/403
- Branch vs tag in ref_name
- Docker compose plugin missing
- DB schema not initialized
- Secrets not working after rotation
