# Contributing to Race Control

Thanks for your interest! Race Control is in early development, so the best ways to help right now are ideas, feedback and bug reports.

## Reporting bugs and suggesting features

Open an [issue](https://github.com/sithija-jayasinghe/race-control/issues/new/choose) using the bug or feature template.

## Working on the code

1. Fork the repo and create a branch from `main`: `git checkout -b feat/short-description`
2. Install dependencies: `pnpm install`
3. Make your change, with tests
4. Check everything passes: `pnpm lint && pnpm typecheck && pnpm test`
5. Open a pull request and fill in the template

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` a new feature
- `fix:` a bug fix
- `docs:` documentation only
- `test:` adding or fixing tests
- `refactor:` code change that isn't a fix or feature
- `chore:` tooling, dependencies, CI

Example: `feat(rules): block edits to .env files`

### Code style

- TypeScript in strict mode, no `any` without a comment explaining why
- Every query is scoped to a team; never return data across teams
- Never log or store secrets; redact before saving

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
