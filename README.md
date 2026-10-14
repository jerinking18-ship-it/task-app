# BGM Task App

A responsive personal task app built with Next.js, React, TypeScript and Supabase.
The interface uses navy, ivory and gold, with desktop and mobile layouts.

## Features

- Create, edit and delete tasks; complete or reopen them with confirmation.
- Add 1–20 tasks together, with individual notes and optional shared details.
- Five meeting categories and optional weekday buttons; matching category lists.
- Required title, optional notes, priority, category and due date/time.
- Combine views, status, category, priority and text search.
- Empty, loading, error and no-match states.
- Saved account data, draft protection and conflict review.
- Daily, selected-weekday and monthly repeats in single and bulk entry.
- Completed repeats wait until midnight India time on their next scheduled date;
  the selected task time remains the deadline.
- History for previous completed repeats, with 30-day retention.

`/` opens the protected account route; signed-out visitors reach `/sign-in`.
`/account` requires sign-in and uses saved Supabase data. First-use setup asks
for India time (`Asia/Kolkata`), the currently supported account timezone.
`/sign-up` supports email/password account creation with email confirmation.
Production confirmation delivery still needs custom SMTP setup; the built-in
Supabase sender has restricted recipients. Real signup/email delivery is untested.
Reminders are not included. Offline support and PWA installation are deferred.

## Local setup

Use Node.js 24.x. With approval to install dependencies, run `npm ci`.
Copy `.env.example` to `.env.local` and replace its placeholders:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Your public publishable key; never a secret or service-role key. |
| `APP_ORIGIN` | Exact app origin, including scheme and local port. |
| `AUTH_RECOVERY_SECRET` | Random server-only value of at least 32 characters. |

Keep `.env.local` ignored. Do not prefix server-only variables with `NEXT_PUBLIC_`.
No usable credentials or account data are included in this source folder.

Start locally with:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3003
```

Configure Supabase Auth with the exact local Site URL and callback
`http://127.0.0.1:3003/auth/callback` before testing authentication links.
Use an existing Auth account or `/sign-up` with a configured email sender.

## Database files

The first two SQL migrations define private tasks, categories and account settings
and were already applied through the dashboard. The third adds weekday labels
and retained-record task deletion, and moves tasks from the former Personal,
Work and Shopping presets to Uncategorized while preserving every task.
The reviewed third migration has also been applied to the existing project.
The fourth migration adds owner-checked recurrence, atomic successor creation and
History metadata. Apply it only as part of the coordinated approved release: it
replaces direct client updates with a version-checked mutation function.
`supabase/operations/activate_history_cleanup.sql` is a separate approved action
requiring Supabase Cron. It schedules only an hourly cleanup of completed tasks
that have spent 30 full days in History. It never deletes active/upcoming tasks
or series metadata and performs no immediate purge. Unscheduling the named job
stops future runs; already deleted History cannot be restored through the app.
The fifth migration replaces immediate successor creation with an internal pending
schedule. A task is created only once its scheduled date starts in Asia/Kolkata;
selected time is its deadline. Late completion skips dates whose midnight has
already passed. The previous task enters History when its successor is released.
Existing generated future heads keep their IDs/details and become visible at
midnight; manually created future tasks remain visible.
`supabase/operations/activate_midnight_repeats.sql` separately schedules the
administrator-only worker every minute, using server date gating and safe retries.
It targets midnight; normal background execution may be up to a minute later.
Authenticated reads perform owner-scoped catch-up, and an open app refreshes at
the India date boundary while preserving dirty drafts. Service outages can delay
release; recovery creates one waiting occurrence instead of a backlog.
Stopping a pending repeat uses This and future tasks with Repeat Off. This task
only edits preserve its pending successor. The existing History cleanup remains
unchanged; generated queue snapshots expire with their source History record.
No real migration, maintenance or scheduler activation should occur without the
coordinated release approval. Do not rerun applied migrations or apply them automatically during deployment.
Their comments refer to planning records retained outside this release folder.
Dashboard execution did not establish CLI migration history; reconcile that
history before introducing a migration CLI workflow.

For a different empty database, review and explicitly approve the migrations
before applying them in filename order. `supabase/tests/` contains simulated
local fixtures, which must never be run against a real Supabase database.
`supabase/verification/` contains read-only catalog checks.

## Verification commands

```bash
npm run build
npm run typecheck
npm run test:supabase
npm run test:auth
npm run test:tasks
```

The tests use fixtures, without real sign-in or account writes.
`npm run check:supabase` separately reads configured Auth settings and checks
signed-out table access. It uses `.env.local` and contacts that project; run it
only with approval for that connection check.

Optional UI QA: `node scripts/saved-ui-fixture.mjs` creates an isolated local
fixture at port 3014, without connecting to Supabase. Stop it with Ctrl-C.
Optional SQL QA: `bash supabase/tests/run-local.sh` requires Docker and an
already-installed `postgres:16-alpine` image. It uses a disposable container
without network or published ports and removes it afterwards.

## Hosting preparation

The app is hosted on Vercel through the repository's main branch.
Use the declared Node 24.x runtime and `npm run build`. Supply production
variables separately, with a fresh server-only recovery secret, an exact stable
HTTPS `APP_ORIGIN`, and reviewed exact Supabase Site URL/callback settings.
A private source repository does not restrict access to the deployed website.
Review deployment access separately before publishing or connecting automatic
Git deployments. Other deployment URLs may fail origin checks or redirect to
the canonical origin.

The original working project passed a Node 24 production build, TypeScript and
45 local tests, plus offline recurrence/midnight/atomicity/concurrency/retention SQL suites. This release copy has been checked for selected-file equality;
no dependencies were installed and no build/tests were executed in this folder.
Hosted behavior, physical-device sync and real two-account isolation remain
unverified. Local planning history, private screenshots, installed dependencies
and generated output are intentionally omitted.

## Reopening completion credit

Migration013 corrects the durable yearly completion total when a task is reopened.
A reopened occurrence has no completion credit; completing it again restores its
one original member/year credit. It cannot count twice, even across members or
years. New repeating occurrences count separately. Bin, permanent purge and
Completed clear preserve credit for completed occurrences. The migration also
corrects surviving tasks reopened before deployment without changing task rows
or erasing credits for already purged tasks. Apply013 once after012.

The offline SQL runner verifies reopen/recomplete races, parallel counter writes,
rollback, first-member/year attribution and migration preservation. The fictional
Member history UI fixture mirrors those transitions for browser checks; it does
not contact a hosted database.

## Templates in Bin

Templates open through the compact icon beside Bin. Confirmed removal keeps the
whole template in a separate Bin section, including its name, titles and notes.
Hold a Bin item to select tasks and templates together, restore them, or confirm
permanent deletion. Removing a template never changes tasks already created from
it. Deleted times use India time and relative day labels. No template auto-purge
is scheduled.

Apply additive migration014 once after013 as part of the coordinated release.
Existing records are preserved. Deleted templates are excluded from normal reads
and stale saves; member/owner/version checks protect remove, restore and purge.
Mixed Bin batches are atomic and keep the existing recurrence-safe task behavior.
Legacy task-only clients continue using the existing RPC.

Run `node --test scripts/template-bin.test.mjs` for client/API checks and the full
offline SQL runner for permissions, migration preservation, races and repeat-queue
rollback. `node scripts/template-bin-ui-fixture.mjs` serves fictional data at
port3026, with controlled failure/ambiguous-response flags; it contacts no hosted
database. Stop it with Ctrl-C.
