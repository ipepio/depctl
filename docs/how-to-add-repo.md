# How to add a new repository

The recommended flow uses the interactive wizard. No manual YAML editing required.

## 1. Start the service (if not already running)

```bash
cd /opt/depctl && docker compose up -d webhook redis
```

Or if installing fresh:
```bash
curl -sSL https://raw.githubusercontent.com/ipepio/docker-deploy-webhook/main/install.sh | bash
```

## 2. Run the wizard

```bash
depctl repo add
```

The wizard will:
1. Ask for the repository (`owner/repo`)
2. Infer the Docker image (`ghcr.io/<owner>/<repo>` by default)
3. Try to pull the image — if it's private, guide you through GHCR login
4. Ask for environment name, allowed branches/tags/workflows
5. Ask if you need Postgres, Redis or other services
6. Generate `Bearer` and `HMAC` secrets automatically
7. Create the stack at `/opt/stacks/<owner>/<repo>/`
8. Show a GitHub Secrets checklist to copy

## 3. Add secrets to GitHub

The wizard shows exactly what to add:

```
Settings → Secrets and variables → Actions

DEPLOY_WEBHOOK_URL    = https://deploy.yourserver.com
DEPLOY_WEBHOOK_BEARER = <generated>
DEPLOY_WEBHOOK_HMAC   = <generated>
```

## 4. Generate the GitHub Actions workflow

```bash
depctl workflow generate --repository acme/payments-api
```

Add `--write` to save directly to `.github/workflows/release.yml` in the current git repo.

## 5. Validate and restart

```bash
depctl validate
docker compose restart webhook
```

## 6. Verify

```bash
depctl status
curl https://deploy.yourserver.com/health
```

---

## Non-interactive (scripting/CI)

```bash
depctl repo add \
  --repository acme/payments-api \
  --environment production \
  --image-name ghcr.io/acme/payments-api \
  --allowed-branches master \
  --allowed-tag-pattern '^v[0-9]+\.[0-9]+\.[0-9]+$' \
  --allowed-workflows Release \
  --services app,worker \
  --stack-services app,postgres \
  --non-interactive
```

---

## Manual flow (advanced)

If you prefer to manage YAML directly:

```bash
# Admin container
docker compose --profile admin run --rm admin repo add --repository acme/payments-api
docker compose --profile admin run --rm admin repo secrets generate --repository acme/payments-api
docker compose --profile admin run --rm admin stack init \
  --repository acme/payments-api --environment production --services app,postgres
docker compose --profile admin run --rm admin validate
docker compose restart webhook
docker compose --profile admin run --rm admin repo secrets show --repository acme/payments-api
```
