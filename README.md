# BGM Task App

Next.js App Router, React and TypeScript task app with a navy, ivory and gold responsive interface. The root route opens the authenticated workspace. Tasks support notes, meeting categories, dates/times in India time, repeat schedules, completion attribution, search, filters, a recoverable Bin, templates and Member history.

## Current workspace implementation

The approved individual-login workspace and assignment changes are live. Migration015 and protected initial Owner setup were applied once, preserving the existing account and original data. Production deployment and anonymous access checks passed. See the private publication record for verification details.

Each person signs in with their own verified email. A workspace invitation must match that verified email; selecting another person's display name cannot establish identity. One person can use multiple devices with the same login. Ten places include joined members and valid pending invitations. Owner-created invitation links expire after seven days, reserve a place and can be replaced or cancelled. The app supplies a link to share privately; it does not send invitation emails.

- Owner: manage members, invitations, roles and ownership; manage tasks and templates.
- Coordinator: manage tasks and templates; cannot manage member roles or invitations.
- Member: view shared task pages/categories, Member history and task Bin; no task editing/deletion/restoration or template access.
- Ordinary completion and reopening require the current assignee. The explicitly confirmed Missed-completion exception below is limited to Owners and Coordinators.

Every new task requires an assignee. Bulk creation supports up to20 separate titles and notes, and Apply details copies the assignee and scheduling details into existing and later draft rows. Reassigning unfinished work requires a named confirmation. Reassignment changes only that occurrence, independently of repeat editing scope. Completed work must first be reopened by its authorized recorded person under the normal or Missed-completion rules. Assigned to and the actual Completed by remain separate.

Assigned to me is a dedicated page directly below Users in the same menu group. It shows only the verified person's assignments and follows existing category visibility deadlines: expired completed/overdue work leaves this view and its counter; active and available future work stays. Records remain on the main saved-data pages. India-time visibility cutoffs include the full23:59 minute: Sunday Service Monday, Healing Meeting Thursday, Revival Meeting Saturday, Special Meeting the day after its scheduled day with the existing fallback rules.

The modern Users page keeps You first, member search, capacity, role controls and activity based on actual presence leases. Ownership transfer makes the chosen existing member Owner and the previous Owner Coordinator. The current Owner must transfer ownership before leaving. Other departures preserve saved work and history.

## Data and authorization

Stable workspace owner_id partitions data independently of the current Owner role. Server/RPC checks derive identity and workspace from the verified Auth session. RLS limits shared reads; browser table mutations and legacy identity-picker/mutation function execution are revoked. Checked RPCs enforce current role, assignment, versions, category boundaries, invitation seats and ownership transfer. Private realtime invalidations refresh authorized devices without broadcasting task content.

Existing recurrence, Bin stop/resume behavior, completion attribution and annual completion-credit rules are retained. Reopening subtracts the occurrence's credited annual completion; completing it again restores that credit once. Permanently deleting saved tasks does not erase established annual totals. Templates store only ordered titles and notes and load into bulk drafts for review. Reminder delivery, native APK/iOS packaging and additional regular-completed-task retention are outside this change.

## Run locally

The declared production runtime is Node.js24.x and the hosted production build passed. Local tests used installed Node.js26.2.0. Authenticated production CRUD, physical two-device sync and email delivery have not been tested live.

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
```

The Node suite uses local fixtures, no real credentials. The workspace SQL runner uses an already-installed `postgres:16-alpine` Docker image with `--pull=never`, no network/ports/persistent volume and removes its disposable container. It tests the actual migrations and forbidden database access using fictional Auth/session identities. **Never run local Auth fixtures or earlier reset scripts against hosted Supabase.**

For isolated browser QA, `node scripts/workspace-ui-fixture.mjs` creates disposable ignored `.local-ui-fixture/workspace-ui` source and data at `http://127.0.0.1:3028/account`, without copying environment files. Its fictional role routes are test-only and never belong in the actual app or release. Stop the owned fixture server after testing.

## Release boundary

Keep private planning, memory, screenshots, bootstrap identity details, database exports and environment values out of the public release. Migrations001–023 are already applied. Never replay migrations001–023, protected Owner bootstrap or any completed fresh-data reset against hosted Supabase. Protected initial Owner setup must preserve the existing verified account/password and refuse unexpected mappings or data. Read-only schema/privilege verification is in `supabase/verification/20261014_workspace_assignment_schema_checks.sql`.

Hosted database/access changes, real invitations/account tests and Vercel publication require the user's approval. Local tests are evidence of local behavior, not proof of live email delivery, cross-device behavior or a hosted deployment.

## Attendance and four meeting categories

Users has a dark navy Attendance action opening the protected Attendance page. Existing verified workspace members can view separate Absent and Present sections for the automatically selected regular meeting, with Special Meeting dates shown separately when tasks exist. Present means not marked absent for that meeting; it does not mean online or physically checked in. Existing member updates and absence expiry refresh these lists. The duplicate Absent members section is removed from Users; attendance lists live on Attendance.

The supported categories are Sunday Service, Healing Meeting, Revival Meeting and Special Meeting. India meeting windows run Sunday00:00 through Monday23:59, Wednesday00:00 through Thursday23:59, Friday00:00 through Saturday23:59, and the Special Meeting selected date00:00 through the following day23:59. The complete final minute is included; stored end instants are exclusive midnight. Tuesday has no regular meeting: overview, Needs help, Attendance, My profile and Member history show the approved No meeting today state, with the next Healing Meeting at Wednesday00:00. Scheduled Special Meetings remain separate. Ordinary saved task pages and active/future category assignments remain available. Task due-time defaults stay23:50. Fine cutoffs are Monday01:00, Thursday01:00, Saturday01:00 and the Special Meeting date’s following day01:00. Existing custom due times remain protected from premature fines.

Migration021 permanently retires Woman’s Meeting and its saved occurrences, including Bin items and queued repeats, only after explicit live confirmation and exact-count checks. Shared series and future work for other categories remain. Existing annual completion credits, issued fines, accounts and fine activation remain unchanged. It refuses unexpected cross-category claim provenance or issued retired fines rather than silently removing them. Never replay earlier migrations, resets or activation/Cron installers. Migration021 is already installed and must not be replayed. Migration022 is installed: it preserved tasks/accounts/annual totals/issued fines, extended only still-active old23:50 absence intervals, updated future pending fine deadlines without retrospective charges, and retained all existing grants. Do not replay it. Never activate fines or replace Cron jobs again during this rollout.

### Attendance change window

Mark absent and Unmark absent are available only on the meeting day, from midnight until the 9:00 PM cutoff in India time: Sunday Service on Sunday, Healing Meeting on Wednesday, Revival Meeting on Friday, and Special Meeting on its selected date. At exactly9:00 PM both actions close, including confirmation dialogs already open. Existing absences still expire at their usual following-day midnight boundary; task deadlines, coverage claims, fine cutoffs and annual totals are unchanged.

The profile checks the live window, and migration023 enforces it using the database clock after attendance/fine row locks. Clients cannot supply a clock or execute the private time helper. Existing verified-member identity, own-absence authorization and RPC privileges remain. Migration023 is already installed and must not be replayed. Local SQL coverage is `python3 supabase/tests/attendance_action_window.py`; its clock fixtures run only in disposable offline PostgreSQL.

### Confirmed Missed completion

Owners and Coordinators can explicitly confirm completing another active member’s assigned meeting task when that member did not mark absence. The confirmation applies a ₹50 fine immediately to the assignee and records a Missed completion without reassigning the occurrence. The completed card uses a red Missed badge, a shield-check icon and role-only attribution (Owner or Coordinator); the actual actor identity remains recorded. Only that exact actor can reopen a Missed completion, including through the edit API. Other managers and the assignee cannot reopen it. Ordinary completion and absence/Take task rules stay unchanged.

Reopening retains the existing fine and subtracts the recorded annual credit. The original assignee can then complete normally, or a manager can confirm a new Missed completion. Missed-related recompletions credit the actual completing member once in their completion year; regular occurrence credit rules are preserved. Fine uniqueness is per occurrence, including paid or cancelled records; retries, future cutoff assessment and recompletion never add a second fine. Existing repeat queues, future assignments and deadline rules remain unchanged.

Migration024 is installed with Migration025 after the approved, guarded database update. Existing task data, fine history and function grants were preserved; no backfill charges, fine activation or Cron changes were included. Run `node --test scripts/missed-completion.test.mjs` and `python3 supabase/tests/missed_completion.py` for the API/model and offline database checks. Never replay installed migrations001–025.


### Personal notifications and reopening requests

The gold message icon beside Attendance on Users opens the current verified member’s private Notifications inbox. Unread, All and Requests have separate counters. Requests includes incoming and outgoing request records; the pending indicator counts only incoming requests the recorded completer can review. Messages are newest first, grouped by India calendar dates. A message becomes read only after it is mostly visible for one second in a focused, foreground page. Opening a page, switching filters, reading a request or clearing messages never approves a request.

Automatic messages cover reassignment, released work becoming available/taken/completed, role-only Missed completion, overdue work, an actually issued fine and its paid/cancelled result, role changes and reopening-request results. Initial task assignment and new repeating-occurrence notices are deliberately excluded. Availability notices are saved at release for eligible recipients, including offline teammates; their Take action rechecks current absence, claim, task and meeting state. Overdue catch-up runs when the existing app sync reads the inbox. There is no new Cron job, email, push, chat or historical backfill. The existing live sync and automatic fallback refresh inbox state across devices.

Preferences hide only routine availability, coverage updates and reassignment notices. Fine, role, request and overdue notices remain enabled. Hidden messages remain saved until the recipient clears them. The red bin opens a centered confirmation for an exact current message count and snapshot, including hidden messages. Confirming physically deletes only this member’s notification rows, without Bin or a message-body archive. Tasks, fines, other recipients’ inboxes and the separate request records remain. A private clear watermark prevents old catch-up events or retried requests recreating cleared notices. New committed activity still arrives. A changed message snapshot refuses clearing until reviewed again.

Only the affected current assignee can request reopening of the current Missed completion, with a structured reason. The request goes to the exact recorded completer, never every manager. Only that actor can approve or decline it. Approval explicitly confirms reopening and uses the normal checked task mutation, preserving the fine and existing annual-credit/repeat rules. Concurrent decisions serialize; stale/deleted/Bin/reassigned/reopened completions or departed participants become unavailable. Requests are not chat and never grant additional task or fine permissions.

Migration025 is installed after024 through the approved, guarded update. Never replay installed001–025, protected bootstrap, resets, fine activation or jobs. Four new tables have RLS and no direct app-role access; checked RPCs derive the verified recipient from the session. Private message bodies are never included in realtime broadcast payloads. The rollout preserved existing app data and accounts, with no historical notification backfill. New notification access is restricted to verified recipients through checked RPCs. Read-only postchecks: `supabase/verification/20261015_notifications_checks.sql`. Run `npm run test:notifications` and `npm run test:notifications:sql`; the SQL runner uses only disposable offline PostgreSQL and fictional identities.
