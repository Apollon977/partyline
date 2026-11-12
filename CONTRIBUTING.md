# Contributing to Partyline

Thanks for helping. Ideas, bug reports and pull requests are all welcome.

## Ideas and bugs

Open an issue. For a bug, say what you ran, what you expected and what happened. For an idea, describe the situation you're in: how your agents and your team work today, and where Partyline gets in the way. That helps more than a finished design does.

Issues labelled [`good first issue`](https://github.com/yehia-khalil/partyline/labels/good%20first%20issue) are small and self-contained, a good place to start.

## Security

If you find a way around the guard hook or the team isolation, please report it privately through [GitHub's private vulnerability reporting](https://github.com/yehia-khalil/partyline/security/advisories/new) rather than in a public issue.

## Setting up

Requires Node 22+ and, for the Docker image, Docker.

```sh
git clone https://github.com/yehia-khalil/partyline.git && cd partyline
npm ci
npm run check     # type-check both deployment targets
npm test          # guard hook tests, plus server tests against a server it starts
```

To run a server locally:

```sh
TEAMS='{"core":{"dev":"local-dev-token-0000000000000000000000"}}' npm run start:node   # http://localhost:8787
npm run dev       # the Cloudflare target locally (reads TEAMS from .dev.vars)
```

Server tests also run against any deployment, given two members of one team and a member of another:

```sh
PARTYLINE_URL=https://… TOKEN_A=… TOKEN_A2=… TOKEN_B=… npm test
```

## Where things go

| Change | Where |
|---|---|
| Tools, teams, members and tokens, message format | `src/core/`. Keep it free of anything host-specific, so both targets get the change. |
| The Docker server | `src/node/` |
| The Cloudflare Workers target | `src/cloudflare/` |
| The guard hook and its default weights | `hooks/` |
| End-to-end server tests | `test/` |
| User docs | `README.md` for the pitch and quick start, `docs/` for everything else |

## Pull requests

- **Keep each PR to one change** and explain why it's needed, not only what it does.
- **Add or update tests** for any change in behaviour: `hooks/room-guard.test.mjs` for the hook, `test/server.test.mjs` for the server. Server tests run against any deployment, so they cover both targets.
- **`npm run check` and `npm test` must pass.**
- **Be strict with the guard hook.** It decides what an agent may do on another agent's instructions, so a change that loosens it needs a clear reason and a test for the case it opens up.
- **Update the docs** (`README.md` or `docs/`) when you change how something is used or configured.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
