# CLI Output Contract

## Human mode (default)

- Readable, aligned, emoji status indicators (✅/❌).
- Dynamic fields shown (timestamps, paths, tokens).
- Sections separated clearly.
- Error messages include code + description + actionable hint.

## JSON mode (`--json`)

All data commands support `--json`. Output is a stable object with documented keys.
Breaking key changes are considered a semver-major change.

### Stable shapes

| Command | Top-level keys |
|---------|----------------|
| `depctl status --json` | `version`, `publicUrl`, `webhook`, `redis`, `worker`, `docker`, `repos` |
| `depctl repo show --json` | `repository`, `webhook`, `environments` |
| `depctl history --json` | Array of `DeployJob` |
| `depctl logs --json` | Single `DeployJob` or `null` |
| `depctl repo secrets show --json` | `repository`, `bearerToken`, `hmacSecret`, `publicUrl`, `generated` |
| `depctl workflow generate --json` | `yaml`, `workflowName`, `repository`, `environments`, `secretsNeeded`, `validationWarnings` |

## Error shape

All errors follow:

```json
{
  "code": "branch_not_allowed",
  "message": "ref_name \"feature/x\" is not in allowed_branches...",
  "hint": "Add the branch to allowed_branches or adjust allowed_tag_pattern"
}
```

HTTP 403 errors from the webhook surface the `code` in the JSON body.
CLI errors are written to stderr with exit code `1` (runtime) or `2` (usage).

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Runtime error (config missing, docker unreachable, etc.) |
| `2` | Usage error (unknown command, missing required flag) |
