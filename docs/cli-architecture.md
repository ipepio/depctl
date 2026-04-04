# CLI Architecture

## Module tree (target state)

```
src/cli/
  bootstrap.ts              # thin dispatcher: parse args → router
  router.ts                 # command registry and nested dispatch
  argv.ts                   # arg parser (existing)
  io.ts                     # prompts and output helpers (existing)
  errors.ts                 # CliUsageError (existing)
  secrets.ts                # generateHexSecret (existing)
  runtime.ts                # withLocalRuntime (existing)

  commands/
    init.command.ts         # depctl init
    status.command.ts       # depctl status
    repo.command.ts         # depctl repo add/list/show/edit/remove
    secrets.command.ts      # depctl repo secrets generate/show/rotate
    env.command.ts          # depctl env add/edit
    stack.command.ts        # depctl stack init/show/service-add/service-edit
    deploy.command.ts       # depctl deploy manual/retry/redeploy-last-successful
    history.command.ts      # depctl history
    logs.command.ts         # depctl logs
    rollback.command.ts     # depctl rollback
    workflow.command.ts     # depctl workflow generate
    migrate.command.ts      # depctl migrate scan/plan/apply
    tui.command.ts          # depctl tui

  formatters/
    status.formatter.ts
    repo.formatter.ts       # repo show matrix
    history.formatter.ts
    logs.formatter.ts
    secrets.formatter.ts
    workflow.formatter.ts

  use-cases/                # business logic (existing, unchanged)
    instance-init.ts
    instance-status.ts
    repo-wizard.ts
    repo-config.ts
    repo-secrets.ts
    repo-show.ts
    deploy-actions.ts
    deploy-observability.ts
    ghcr-auth.ts
    stack.ts
    workflow-generator.ts
    migration.ts
```

## Ownership

| Module | Commands |
|--------|----------|
| `repo.command.ts` | `repo add`, `repo list`, `repo show`, `repo edit`, `repo remove` |
| `secrets.command.ts` | `repo secrets generate/show/rotate` |
| `env.command.ts` | `env add`, `env edit` |
| `stack.command.ts` | `stack init/show/service add/service edit` |
| `deploy.command.ts` | `deploy manual/retry/redeploy-last-successful` |
| `history.command.ts` | `history` |
| `logs.command.ts` | `logs` |
| `rollback.command.ts` | `rollback` |
| `workflow.command.ts` | `workflow generate` |
| `init.command.ts` | `init` |
| `status.command.ts` | `status` |
| `migrate.command.ts` | `migrate scan/plan/apply` |
| `tui.command.ts` | `tui` |

## Migration rules

1. **No functional changes during migration.** Each extraction is pure move + test.
2. **Move use-cases as-is.** Command modules call use-cases; no business logic in commands.
3. **Formatters are pure functions.** They receive data, return string. No side effects.
4. **Migration order:** router → repo/secrets → deploy/runtime → platform → formatters → bootstrap cleanup.
