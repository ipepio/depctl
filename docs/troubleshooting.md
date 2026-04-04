# Troubleshooting

## GHCR 401 — Authentication required

**Symptom:** Deploy fails with `unauthorized` when pulling the image.

**Cause:** The host running the webhook has no credentials for `ghcr.io`.

**Fix:**
```bash
# On the server host
docker login ghcr.io -u <your-github-username>
# Enter a GitHub PAT (classic) with scope: read:packages
```

Then restart the webhook so the container picks up the credentials:
```bash
cd /opt/depctl && docker compose restart webhook
```

If using `depctl`, run `depctl repo add` and it will guide you through login automatically.

---

## GHCR 403 — Access denied (wrong scope)

**Symptom:** Deploy fails with `denied` even after logging in.

**Cause:** The token used has insufficient permissions.

**Fix:**
1. Go to https://github.com/settings/tokens/new
2. Select **Classic token** (not fine-grained — fine-grained tokens have limitations with org packages)
3. Enable scope: ✅ `read:packages`
4. Re-run `docker login ghcr.io` with the new token.

**Note:** If the package belongs to an org, verify you're a member of that org with package read access.

---

## 403 — Branch not allowed (`branch_not_allowed`)

**Symptom:** Webhook responds `403 {"error":"branch_not_allowed"}`.

**Cause:** The `ref_name` in the webhook payload is not in `allowed_branches` and doesn't match `allowed_tag_pattern`.

**Common scenario:** When you push a tag, `ref_name` is the tag name (e.g. `v0.0.1`), not a branch. The deployer now accepts this automatically if `v0.0.1` matches `allowed_tag_pattern` — but only after updating to the fixed version.

**Fix:**
```bash
depctl repo show acme/my-app
# Check allowed_branches and allowed_tag_pattern

# Update if needed:
depctl env edit --repository acme/my-app --environment production \
  --allowed-branches master,main
```

---

## 403 — Workflow not allowed (`workflow_not_allowed`)

**Symptom:** Webhook responds `403 {"error":"workflow_not_allowed"}`.

**Cause:** The `workflow` field in the payload doesn't match any entry in `allowed_workflows`.

**Fix:**
```bash
depctl repo show acme/my-app
# Shows: Workflows | Release

# In your GitHub Actions workflow, the 'name:' field must match exactly
# e.g. if the deployer expects "Release", your workflow must be named "Release"
```

Regenerate the workflow to ensure consistency:
```bash
depctl workflow generate --repository acme/my-app
```

---

## Compose file not found

**Symptom:** Deployer starts but immediately fails with `Compose file does not exist: /opt/stacks/...`

**Fix:**
```bash
depctl stack init --repository acme/my-app --environment production --services app,postgres
```

Or create the stack directory and `docker-compose.yml` manually.

---

## Docker socket error

**Symptom:** `docker compose pull` fails inside the webhook container with connection errors.

**Fix:**
Verify the Docker socket is mounted in `docker-compose.yml`:
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

And that Docker is running on the host:
```bash
sudo systemctl start docker
```

---

## DB schema not initialized (Prisma baseline)

**Symptom:** App starts but crashes with `The table 'public.X' does not exist`.

**Cause:** The database was restored from a dump but `_prisma_migrations` table is missing.

**Fix:**
```bash
# Inside the app container, mark all migrations as applied
docker exec <app-container> npx prisma migrate resolve --applied <migration-name>
# ... repeat for all migrations

# Or check status first:
docker exec <app-container> npx prisma migrate status
```

---

## Secrets not working after rotation

**Symptom:** After rotating secrets, GitHub Actions still gets `401`.

**Fix:**
1. Update GitHub Secrets with the new values (shown by `depctl repo secrets show`).
2. Restart the webhook: `docker compose restart webhook`.
3. Re-trigger the workflow.
