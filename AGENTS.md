<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Working agreement

Read README.md before working on this release copy. Ask one question at a time
and obtain the user's approval before each next action or stage. Record plans,
decisions and important progress in the original project's local codex.md and
plans directory when available; do not copy their private history into this
release folder. If those records are unavailable, ask where to keep them.

This folder contains reviewed source for the existing public GitHub repository
and Vercel application. The user approved publishing the meeting categories, weekdays, bulk task entry
and retained-record Delete task changes to the existing Vercel application.
The matching database migration must be applied once before this release.
Preserve existing tasks; move only former Personal/Work/Shopping tasks to
Uncategorized. Other changes and real account tests require approval.

Preserve the existing Next.js/React/TypeScript stack, Node 24.x declaration and
lockfile. Read the installed Next.js guides before changing application code.
Do not install packages, upgrade dependencies or start servers without approval.
Use the verification commands in README.md when the approved change warrants it.
Do not claim a hosted build or device test passed based only on local checks.

Keep actual environment values, credentials, tokens, database exports and
private screenshots out of Git. Never read, type, store or submit the user's
credentials for them. The user handles credential forms. Preserve the ignored
placeholder-only .env.example exception; real values belong in ignored local
settings or separately approved hosting environment configuration.

Do not rerun the existing applied migrations during deployment. Local SQL
fixtures are for disposable local databases only. Database/data writes and
real account or email tests require their own approval. Keep Reminder/Repeat
disabled in saved mode until their implementation is approved. Subtasks remain
outside scope. Signup is implemented; preserve email confirmation and do not
claim general email delivery works until SMTP is configured and user-tested.
