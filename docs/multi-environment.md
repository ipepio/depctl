# Multi-environment configuration

A single repository can be deployed to multiple environments from the same deployer instance.

## Example: production + staging

```yaml
# config/repos/acme--payments-api.yml

repository: acme/payments-api
webhook:
  bearer_token_env: ACME_PAYMENTS_API_WEBHOOK_BEARER
  hmac_secret_env: ACME_PAYMENTS_API_WEBHOOK_HMAC

environments:
  production:
    image_name: ghcr.io/acme/payments-api
    compose_file: /opt/stacks/acme/payments-api/production/docker-compose.yml
    runtime_env_file: /opt/stacks/acme/payments-api/production/.deploy.env
    services:
      - app
      - worker
    allowed_workflows:
      - Release
    allowed_branches:
      - master
    allowed_tag_pattern: '^v[0-9]+\.[0-9]+\.[0-9]+$'
    healthcheck:
      enabled: false

  staging:
    image_name: ghcr.io/acme/payments-api
    compose_file: /opt/stacks/acme/payments-api/staging/docker-compose.yml
    runtime_env_file: /opt/stacks/acme/payments-api/staging/.deploy.env
    services:
      - app
      - worker
    allowed_workflows:
      - Release
    allowed_branches:
      - staging
    allowed_tag_pattern: '^sha-[a-f0-9]{7,40}$'
    healthcheck:
      enabled: false
```

## Key rules

1. **Each environment must have a unique trigger.** Avoid sharing branches or tag patterns
   across environments — a webhook `ref_name` should match at most one environment.

   ✅ Good:
   - `production`: `allowed_branches: [master]`, tag pattern `^v[0-9]+...`
   - `staging`: `allowed_branches: [staging]`, tag pattern `^sha-...`

   ⚠ Ambiguous (will warn on validate):
   - Both environments share `allowed_branches: [master]`

2. **Each environment can have its own stack path.** Use separate directories per env:
   `/opt/stacks/<owner>/<repo>/production/` and `/opt/stacks/<owner>/<repo>/staging/`

3. **Secrets are shared per repo** (one Bearer + one HMAC). The environment is determined
   by the `environment` field in the webhook payload, not by separate secrets.

## GitHub Actions routing

In your workflow, route to the correct environment based on the Git ref:

```yaml
- name: Notify webhook (production)
  if: success() && startsWith(github.ref, 'refs/tags/')
  env:
    DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK_URL_PRODUCTION }}
    DEPLOY_WEBHOOK_BEARER: ${{ secrets.DEPLOY_WEBHOOK_BEARER_PRODUCTION }}
    DEPLOY_WEBHOOK_HMAC: ${{ secrets.DEPLOY_WEBHOOK_HMAC_PRODUCTION }}
  run: |
    # ... send payload with "environment": "production"

- name: Notify webhook (staging)
  if: success() && github.ref == 'refs/heads/staging'
  env:
    DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK_URL_STAGING }}
    DEPLOY_WEBHOOK_BEARER: ${{ secrets.DEPLOY_WEBHOOK_BEARER_STAGING }}
    DEPLOY_WEBHOOK_HMAC: ${{ secrets.DEPLOY_WEBHOOK_HMAC_STAGING }}
  run: |
    # ... send payload with "environment": "staging"
```

Use `depctl workflow generate` to generate this automatically.

## Validate before restarting

```bash
docker compose --profile admin run --rm admin validate
docker compose restart webhook
```
