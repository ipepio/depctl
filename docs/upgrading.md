# Upgrading depctl

## Quick upgrade

```bash
curl -sSL https://raw.githubusercontent.com/ipepio/docker-deploy-webhook/main/install.sh | bash -s -- --upgrade
```

Or if you already have the repo cloned:

```bash
bash install.sh --upgrade
```

## What happens during upgrade

1. **Verify** existing installation at `INSTALL_DIR` (default `/opt/depctl`).
2. **Backup** `.env`, `config/server.yml`, and `config/repos/` to `backup-YYYYMMDD-HHMMSS/`.
3. **Download** updated `docker-compose.yml`, `Dockerfile`, `.env.example`, `config/server.example.yml`.
4. **Preserve** user config — `.env`, `server.yml`, and repo configs are **never overwritten**.
5. **Rebuild** the webhook container (`docker compose build --no-cache webhook`).
6. **Restart** webhook + redis.
7. **Health check** — waits up to 30s for `/health` to respond.
8. **Update** the `/usr/local/bin/depctl` wrapper.

## What is NOT touched

| File/Dir | Preserved? | Why |
|----------|-----------|-----|
| `.env` | ✅ Always | Contains tokens, secrets, port config |
| `config/server.yml` | ✅ Always | User-customized server config |
| `config/repos/*.yml` | ✅ Always | Repo configurations |
| `data/` | ✅ Always | State and logs |
| Stacks (`/opt/stacks/`) | ✅ Always | Stack compose files and deploy envs |

## Rollback

Every upgrade creates a backup. To rollback:

```bash
cp /opt/depctl/backup-YYYYMMDD-HHMMSS/* /opt/depctl/
docker compose -f /opt/depctl/docker-compose.yml up -d --build
```

## Version compatibility

| From → To | Migration needed? | Notes |
|-----------|------------------|-------|
| 0.1.x → 0.1.x | No | Patch updates, just rebuild |
| 0.1.x → 0.2.x | Maybe | Check release notes for config schema changes |
| Any → next major | Yes | Run `depctl migrate scan` before upgrading |

## Config schema changes

When a new version adds config fields:

1. **New optional fields** — no action needed, defaults apply.
2. **New required fields** — upgrade will work but `depctl validate` will warn. Add the fields to `server.yml`.
3. **Renamed/removed fields** — `depctl migrate scan` detects these and `depctl migrate plan` generates a migration script.

## Checking current version

```bash
depctl status --json | jq .version
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEPCTL_VERSION` | `latest` | Target version (for future tagged releases) |
| `INSTALL_DIR` | `/opt/depctl` | Installation directory |
| `STACKS_DIR` | `/opt/stacks` | Stacks root directory |
