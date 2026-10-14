# BGM Task App

Next.js App Router, React and TypeScript task app with a navy, ivory and gold responsive interface. The root route opens the authenticated workspace. Tasks support notes, meeting categories, dates/times in India time, repeat schedules, completion attribution, search, filters, a recoverable Bin, templates and Member history.

## Workspace and task assignment

The individual-login workspace and assignment implementation requires migration015 and protected initial Owner setup before deployment. Existing accounts and app records are preserved by a reviewed rollout; no client can claim workspace ownership by typing a name.

Each person signs in with their own verified email. A workspace invitation must match that verified email; selecting another person's display name cannot establish identity. One person can use multiple devices with the same login. Ten places include joined members and valid pending invitations. Owner-created invitation links expire after seven days, reserve a place and can be replaced or cancelled. The app supplies a link to share privately; it does not send invitation emails.

- Owner: manage members, invitations, roles and ownership; manage tasks and templates.
- Coordinator: manage tasks and templates; cannot manage member roles or invitations.
- Member: view shared task pages/categories, Member history and task Bin; no task editing/deletion/restoration or template access.
- Every role, including Owner, can complete or reopen only tasks currently assigned to that person.

Every new task requires an assignee. Bulk creation supports up to20 separate titles and notes, and Apply details copies the assignee and scheduling details into existing and later draft rows. Reassigning unfinished work requires a named confirmation. Reassignment changes only that occurrence, independently of repeat editing scope. Completed work must first be reopened by its current assignee. Assigned to and the actual Completed by remain separate.

Assigned to me is a dedicated page directly below Users in the same menu group. It shows only the verified person's assignments and follows existing category visibility deadlines: expired completed/overdue work leaves this view and its counter; active and available future work stays. Records remain on the main saved-data pages. India-time cutoffs remain23:50: Sunday Service Monday, Healing Meeting Thursday, Woman's Meeting Friday, Revival Meeting Saturday, Special Meeting the day after its scheduled day with the existing fallback rules.

The modern Users page keeps You first, member search, capacity, role controls and activity based on actual presence leases. Ownership transfer makes the chosen existing member Owner and the previous Owner Coordinator. The current Owner must transfer ownership before leaving. Other departures preserve saved work and history.

## Meeting attendance and team coverage

Migration016 adds self-marked absence for a meeting category. Special Meeting requires its date and ends at23:50 India time the following day. Other categories use their existing category deadlines. Attendance clears automatically; no early-return control is provided. Users shows a separate Absent members list without changing online status.

Only unfinished, available work in that meeting period becomes available for a teammate to take. A confirmed, version-checked claim assigns only that occurrence, with one winner across concurrent requests. The absent assignee cannot complete it before another eligible member takes it. Helpers absent for the same meeting cannot take it. The new assignee alone can complete/reopen; actual completion attribution and existing annual-credit rules remain separate. Future repeat assignments and schedules stay unchanged. Expiry removes availability, not tasks or accounts; a successful claim stays assigned to its helper. Members gain only this narrowly scoped claim action, not general task editing, deletion, restoration or template access.

Task titles, template titles/names and member-name inputs capitalize the first typed letter while preserving later casing. Credentials, notes, search and existing saved content are unchanged.

Migration017 adds a read-only original-assignee lookup for taken occurrences. A completed taken task displays its source assignee separately from the helper who actually completed it; completion and reopening permissions still belong to the helper. Active released work shows a red Help me badge to teammates, while its absent assignee sees Available. My profile's meeting dropdown orders Sunday Service, Healing Meeting, Woman's Meeting, Revival Meeting, then Special Meeting.

## Data and authorization

Stable workspace owner_id partitions data independently of the current Owner role. Server/RPC checks derive identity and workspace from the verified Auth session. RLS limits shared reads; browser table mutations and legacy identity-picker/mutation function execution are revoked. Checked RPCs enforce current role, assignment, versions, category boundaries, invitation seats and ownership transfer. Private realtime invalidations refresh authorized devices without broadcasting task content.

Existing recurrence, Bin stop/resume behavior, completion attribution and annual completion-credit rules are retained. Reopening subtracts the occurrence's credited annual completion; completing it again restores that credit once. Permanently deleting saved tasks does not erase established annual totals. Templates store only ordered titles and notes and load into bulk drafts for review. Reminder delivery, native APK/iOS packaging and additional regular-completed-task retention are outside this change.

## Run locally

The production runtime is Node.js24.x. The final source passed the local Node24.19.0 test suite and production build. Authenticated hosted and two-device workflows still require separate live testing.

```bash
npm install
npm run dev -- --hostname 127.0.0.1 --port 3003
```

Use ignored `.env.local` values based on the placeholder `.env.example`. Public variables accept only the Supabase URL and publishable key. Never use a secret/service-role key or database password in public variables. `APP_ORIGIN` is the exact trusted app origin; server-only `AUTH_RECOVERY_SECRET` signs recovery grants. Credentials and actual environment values must never be committed. The user enters and manages their own passwords.

## Verification

```bash
node --test scripts/*.test.mjs
npm run typecheck
npm run build
npm run test:workspace:sql
npm run test:absence
npm run test:absence:sql
```

The Node suite uses local fixtures, no real credentials. The workspace SQL runner uses an already-installed `postgres:16-alpine` Docker image with `--pull=never`, no network/ports/persistent volume and removes its disposable container. It tests the actual migrations and forbidden database access using fictional Auth/session identities. **Never run local Auth fixtures or earlier reset scripts against hosted Supabase.**

For isolated browser QA, `node scripts/workspace-ui-fixture.mjs` creates disposable ignored `.local-ui-fixture/workspace-ui` source and data at `http://127.0.0.1:3028/account`, without copying environment files. Its fictional role routes are test-only and never belong in the actual app or release. Stop the owned fixture server after testing.

## Release boundary

Keep private planning, memory, screenshots, bootstrap identity details, database exports and environment values out of the public release. For this release, apply only reviewed new migration017 after checking the existing migration016 tables and function fingerprints; never replay applied001–016, Owner bootstrap or any completed fresh-data reset. Protected initial Owner setup must preserve the existing verified account/password and refuse unexpected mappings or data. Read-only schema/privilege verification is in `supabase/verification/20261014_workspace_assignment_schema_checks.sql` and `supabase/verification/20261014_absence_coverage_schema_checks.sql` and `supabase/verification/20261014_coverage_original_assignee_checks.sql`.

Hosted database/access changes, real invitations/account tests and Vercel publication require explicit approval. Local tests are evidence of local behavior, not proof of live email delivery, cross-device behavior or a hosted deployment.
