# Contributing

Thanks for helping. Issues and pull requests are both welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Ideas we'd like help with are tracked as issues labelled `help wanted`.

## Making a change

1. Fork the repo and create a branch from `main`.
2. Load your copy into a session to try it: `claude --plugin-dir ./plugins/dev-dash`.
3. Run both checks. They must pass before a PR is merged:
   ```
   claude plugin validate ./plugins/dev-dash
   claude plugin test ./plugins/dev-dash
   ```
4. Add or update a test in `plugins/dev-dash/hooks/` for behaviour you change.
5. If you add a value to plugin state, declare it in `plugins/dev-dash/types/index.d.ts`.
6. Open a PR describing what changed and how you checked it. A screenshot of the pane helps.

## Guidelines

- Keep the pane fast. Anything slow or rate-limited (like `gh`) runs on a slower timer and only while the pane is open.
- Nothing should open, toast or draw unless the person asked for it.
- No network calls other than through tools the user already has configured (`git`, `gh`).
- Match the style of the surrounding code.

## Reporting bugs

Include your OS, your Claude Code version (`claude --version`), what you expected, and what the pane showed.
