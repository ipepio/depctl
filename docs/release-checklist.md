# Release Checklist

Use this checklist before tagging a new release of `depctl`.

## Pre-release

- [ ] All tests pass: `npm test`
- [ ] Build is clean: `npm run build`
- [ ] No TypeScript errors: `npx tsc --noEmit`
- [ ] Lint passes: `npm run lint`

## Code quality

- [ ] No `console.log` left in production code (use `logger`)
- [ ] No secrets or tokens in source code or committed files
- [ ] New features have tests covering happy path and main error cases

## Dockerfile

- [ ] `docker-cli-compose` is installed (`RUN apk add --no-cache docker-cli docker-cli-compose`)
- [ ] Image builds without errors: `docker build .`
- [ ] `docker compose version` works inside the built container

## Documentation

- [ ] `README.md` is up to date with new commands
- [ ] `docs/troubleshooting.md` covers any new known failure modes
- [ ] `docs/multi-environment.md` reflects any schema changes
- [ ] CHANGELOG.md entry added (if maintained)

## Versioning

- [ ] `package.json` version bumped (semver: major.minor.patch)
- [ ] Git tag created: `git tag v<version>`
- [ ] Tag pushed: `git push origin v<version>`

## Post-release

- [ ] Verify the install script works on a clean Ubuntu VM:
  ```bash
  curl -sSL https://raw.githubusercontent.com/ipepio/docker-deploy-webhook/main/install.sh | bash
  ```
- [ ] Run `depctl repo add` on the test instance and verify the full flow end-to-end
- [ ] Confirm webhook receives deploy and containers start correctly
