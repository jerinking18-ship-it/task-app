# BGM Task App

Next.js App Router, React and TypeScript task app with a navy, ivory and gold responsive interface. The root route opens the authenticated workspace. Tasks support notes, meeting categories, dates/times in India time, repeat schedules, completion attribution, search, filters, a recoverable Bin, templates and Member history.

## Current workspace implementation

The approved individual-login workspace and assignment changes are live. Migration015 and protected initial Owner setup were applied once, preserving the existing account and original data. Production deployment and anonymous access checks passed. See the private publication record for verification details.

Each person signs in with their own verified email. A workspace invitation must match that verified email; selecting another person's display name cannot establish identity. One person can use multiple devices with the same login. Ten places include joined members and valid pending invitations. Owner-created invitation links expire after seven days, reserve a place and can be replaced or cancelled. The app supplies a link to share privately; it does not send invitation emails.

- Owner: manage members, invitations, roles and ownership; manage tasks and templates.
- Coordinator: manage tasks and templates; cannot manage member roles or invitations.
- Member: view shared task pages/categories, Member history and task Bin; no task editing/deletion/restoration or template access.
- Ordinary completion and reopening require the current assignee. The explicitly confirmed Missed-completion exception below is limited to Owners and Coordinators.

Every new task requires an assignee. Bulk creation supports up to20 separate titles and notes, and Apply details copies the assignee and scheduling details into existing and later draft rows. Reassigning unfinished work requires a named confirmation. The live occurrence-only path is retained. The local reassignment update adds a separate This occurrence only / Permanently choice for existing repeating tasks, independently of repeat editing scope (requires migration032 before deployment). Completed work must first be reopened by its authorized recorded person under the normal or Missed-completion rules. Assigned to and the actual Completed by remain separate.

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

The supported categories are Sunday Service, Healing Meeting, Revival Meeting and Special Meeting. India meeting windows run Sunday00:00 through Monday23:59, Wednesday00:00 through Thursday23:59, Friday00:00 through Saturday23:59, and the Special Meeting selected date00:00 through the following day23:59. The complete final minute is included; stored end instants are exclusive midnight. Tuesday has no regular meeting: overview, Needs help, Attendance, My profile and Member history show the approved No meeting today state, with the next Healing Meeting at Wednesday00:00. Scheduled Special Meetings remain separate. Ordinary saved task pages retain their existing rules. Category pages and their menu counters show all statuses, including active/future tasks, only during that category’s own meeting window; outside it they show zero tasks. This category-only gate does not change Assigned to me or per-occurrence expiry. Task due-time defaults stay23:50. Fine cutoffs are Monday01:00, Thursday01:00, Saturday01:00 and the Special Meeting date’s following day01:00. Existing custom due times remain protected from premature fines.

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

### Sunday Service subcategories

Sunday Service alone supports Morning Service and Evening Service. Its category view keeps both sections visible with independently selected Active, Completed, Overdue and All tabs. Morning appears first on Sunday before 4:00 PM India time; Evening appears first from Sunday 4:00 PM through Monday 11:59 PM. Reordering does not change task eligibility or remove records. Other categories retain their existing UI.

The Sunday-only Subcategory field is available in Add task, Edit task and each bulk row. Shared bulk details include the service for current and later draft rows. Task labels use yellow-gold Morning and orange Evening icons/text. Repeat snapshots preserve the selected service; this-occurrence edits leave queued snapshots unchanged and future edits update later active occurrences and pending schedules. Bin and restore preserve the service. Existing meeting deadlines, attendance rules, fine cutoffs and permissions stay unchanged.

Migration026 is installed through the approved guarded rollout and must not be replayed. It placed the existing Sunday tasks, including Bin/history and queued repeats, into Evening Service. Metadata backfill holds an exclusive task/queue lock, temporarily suppresses task mutation triggers and restores their exact modes in the same transaction, preserving original task values, timestamps, credits and fine behavior. Existing function owners/grants are preserved. Never replay installed001–026, resets, Owner bootstrap, fine activation or jobs. Local checks: `node --test scripts/sunday-service.test.mjs`, `python3 supabase/tests/sunday_service.py`; read-only postchecks: `supabase/verification/20261015_sunday_service_checks.sql`.

## Sunday attendance, Missed timing and retention — published 15 October 2026

Migrations 027–029 are installed through the approved guarded rollout; installed 001–029 must never be replayed. PR47 merged as `9f1635d30cfb3be8bd4ba95b63d48cc931e2b202`, and Vercel Production is Ready on the canonical app domain. Sunday absence and Attendance are scoped independently to Morning and Evening. Mark/Unmark opens Sunday 00:00–11:00 for Morning and 13:00–21:00 for Evening, India time. Both expire Tuesday at 00:00 and retain Monday at 01:00 fines. Existing unscoped Sunday marks retain both-service coverage until expiry; returning from one service preserves the other and all taken-task claims. Sunday overview remains combined and category section ordering still changes at 16:00.

Missed completion requires a dated task to reach its scheduled date at 00:00 India time. Undated regular tasks require their two-day meeting window; undated Special tasks use selected weekdays or their bounded creation-day fallback. The database checks timing after taking mutation locks. Ineligible lock actions open a centered explanatory notice. Eligible confirmation, the immediate unique ₹50 fine and recorded-actor reopening remain unchanged. Active still includes overdue tasks.

Regular completed tasks become permanently eligible after 7 full days from `completed_at`, including existing completions. After the user approved the concrete zero-eligible inventory, the private retention gate was enabled on 15 October 2026 at 8:41:21 PM India time. The existing hourly `bgm-task-history-cleanup` job performs cleanup after eligibility; the rollout did not purge tasks immediately or change the schedule. Never replay the installer or activation. Repeating History keeps 30 days; Bin, annual totals and fine history remain preserved. Eight live postchecks passed and existing task, absence, claim, account and fine counts were preserved.

Local checks: `node --test scripts/*.test.mjs`, `python3 supabase/tests/approved_additions.py`, TypeScript and production build. The SQL suite uses only disposable offline PostgreSQL and fictional identities. Postchecks: `supabase/verification/20261015_approved_additions_checks.sql`; read-only retention inventory: `supabase/verification/20261015_regular_retention_inventory.sql`. No existing CSS files were modified.

## Pending local changes: Missed windows and restricted absence

Migrations030 and031 are installed and published. Never replay installed001–031. Owner and Coordinator Missed completion uses India time: Sunday Morning 09:00–16:00 on Sunday; Sunday Evening 19:00–Monday01:00; Healing Wednesday 19:00–Thursday01:00; Revival Friday 19:00–Saturday01:00; Special selected-day 19:00–next-day01:00. Openings are inclusive and cutoffs exclusive. Dated occurrences cannot become eligible again next week. Normal own-assigned completion retains its existing timing.

Confirming Missed creates a restricted absence for that assignee’s meeting occurrence, scoped to just Morning or Evening on Sunday. Remaining unfinished tasks retain their assignee and display orange “Task taken by owner/coordinator” plus red “No access”. These tasks do not enter Needs help and cannot be taken by teammates. Only Owners/Coordinators can remove this restriction, using the orange action beside the affected absent member on Attendance and a centered confirmation. Regular self-marked absence has no Remove restriction action and retains its existing Unmark/Take rules. Restrictions expire at the existing next-day end-of-day meeting deadline; future occurrences and the other Sunday service remain unaffected.

Only the exact recorded actor may reopen Missed work. Reopening does not remove the forced absence or restriction. Removing the restriction does not change any fine. Forced absence is never a fine exemption: one Missed task incurs its unique immediate ₹50 fine, and two remaining eligible unfinished tasks incur ₹50 each at the unchanged next-day 01:00 cutoff, totaling ₹150. Existing paid/cancelled fines and repeating schedules remain preserved. Coordinator-to-Owner and Coordinator-to-Coordinator Missed actions are allowed within the same confirmed window.

Only additive UI rules are included: badges, the necessary forced-absence self-Unmark guard, and the Attendance removal action/dialog. Existing CSS rules remain byte-for-byte intact. Checks: `node --test scripts/*.test.mjs`, `python3 supabase/tests/restricted_absence.py`, `python3 supabase/tests/missed_completion_window.py`, `python3 supabase/tests/workspace_assignments.py`, production build, and native responsive checks. Read-only rollout checks are saved in `supabase/verification/20261016_restricted_absence_checks.sql`.


## Reassignment duration — local update, not published

The existing named reassignment confirmation keeps its current layout and adds two options for existing repeating tasks. **This occurrence only** changes the selected task once; unfinished work stays with that person, and future repeats keep their series assignee. **Permanently** changes the selected occurrence, later unfinished occurrences and future repeats of that same series. Earlier unfinished/overdue occurrences, completed records, completion credits and issued fines stay unchanged. Ordinary non-repeating reassignment keeps the existing flow. No midnight reversal is added.

Only verified Owners and Coordinators may reassign. The new additive `task_app_reassign_permanently` RPC reuses existing mutation checks and serializes with completion/repeat release using the series lock. It checks task and series versions and commits the selected task, later active assignments and future series assignee together; failures roll everything back. Pending repeat payloads keep their scheduling details and inherit the series assignee through the existing insertion trigger. Content/calendar edit scope remains independent from assignment duration.

Migration032 is prepared locally and has NOT been applied to hosted Supabase. Apply only the reviewed new migration when publication is authorized; never replay001–031, resets, activation or Cron installers. No accounts, old tasks or schedules are backfilled or deleted by032. Checks: `node --test scripts/*.test.mjs`, `python3 supabase/tests/permanent_reassignment.py`, `python3 supabase/tests/workspace_assignments.py`, and the production build. Tests use disposable offline PostgreSQL and fictional local UI data. Read-only postchecks: `supabase/verification/20261016_permanent_reassignment_checks.sql`.


## Shared Special Meeting title and category colours — local, not published

Special Meeting has one editable heading above its existing status tabs. Its current shared name appears in yellow with a calendar icon on Special Meeting task cards and in the read-only Meeting title field in Add task, Edit task and Add multiple tasks. Bin task cards use the same current name. The internal Special Meeting category stays unchanged, preserving all date/deadline/fine/assignment rules. Without a custom name the heading shows Special Meeting and cards keep their standard category label without a duplicate custom-name row. Clearing the name restores that default. The current workspace display title is shared across saved tasks; it is not a per-task historical snapshot.

Verified Owners and Coordinators can rename it; Members can read it. The centred editor uses the existing form style and first-letter capitalization. Names are limited to60 characters on one line. Version checks prevent silent overwrites; conflicts require reviewing the saved title. A dedicated private settings table and checked RPCs save the display name without updating task, category, repeat, completion or fine records. Changes use the existing task realtime signal and bounded catch-up refresh.

Task-card category text uses readable shades matching existing dots: Sunday gold, Healing green, Revival blue, Special purple; existing dot colours and Morning/Evening labels are unchanged. All old stylesheet rules are preserved. Only the requested title block, title controls/fields/labels and category text colours are added.

Hosted001–033 are already installed, including032 (reassignment) and033 (shared title). Never replay001–033, data resets, activation or Cron installers. The shared title table was installed empty without backfilling or renaming existing records. Tests: `node --test scripts/*.test.mjs`, `python3 supabase/tests/special_meeting_title.py`, existing workspace/reassignment SQL suites and the production build. SQL tests run only in disposable offline PostgreSQL. Read-only postchecks: `supabase/verification/20261016_special_meeting_title_checks.sql`.


## Activity — local implementation, not yet published

Activity sits immediately above Fines in the menu. Owners and Coordinators can read it; Members see Access restricted, and both the API and database reject their reads. All members shows one team timeline. Selecting a member enables Performed by / Affecting tabs, with meeting, action and date filters. Events use India-time dates, newest-first keyset pagination, current member names with historic fallbacks, and existing automatic refresh signals.

The new additive034 migration records future committed task, repeat-assignment, coverage, attendance, role/profile, fine, template, reopening-request and Special Meeting title changes. It copies only safe display fields, never task/template notes, credentials or invitation secrets. Presence heartbeats produce no activity. Logs survive task/template deletion; this feature has no manual clear/edit/delete control. The pending035 retention update adds automatic deletion after seven full days. Existing past actions are not reconstructed. Migrations001–034 are installed and published; never replay them. Activity gold focus borders are published through PR51.

Verify locally with `npm run test:activity`, `npm run test:activity:sql`, `npm run typecheck` and `npm run build`. SQL tests use disposable offline PostgreSQL, never the hosted database. Read-only postchecks: `supabase/verification/20261016_activity_log_checks.sql`.

## Pending local update: Needs help arrow and Activity retention

The arrow in Meeting overview’s teammate-help notice opens the existing Needs help page. The summary count cards keep their existing detail-filter behaviour. Existing layout and CSS remain unchanged.

Migration035 is local only and is not installed on hosted Supabase. It adds private, initially disabled Activity retention, an age index, and a purge restricted to database administration. The existing Activity reader excludes expired records from all filters/counts after activation. A separately approved `supabase/operations/activate_activity_cleanup.sql` enables deletion of existing and future Activity records at 168 elapsed hours, with physical cleanup hourly. Source tasks, fines, accounts and yearly totals stay saved according to their own rules. Migration installation performs no deletion, enables no Cron job, and preserves existing function privileges. Never replay installed001–034, prior resets or activation scripts.

Checks: `npm run test:overview`, `npm run test:activity`, `npm run test:activity:retention:sql`, `npm run typecheck`, and `npm run build`. The retention suite uses disposable offline PostgreSQL and includes existing Activity security tests. Read-only postchecks: `supabase/verification/20261016_activity_retention_checks.sql`.

## Pending local update: Assigned Special Meeting section

Assigned to me now separates the viewer’s retained Special Meeting tasks below the regular list, with the shared custom meeting title (or Special Meeting by default). It appears only if the viewer has eligible Special Meeting assignments. The new section has independent Active/Completed/Overdue/All tabs and scoped counts; regular task filters keep their behaviour and task actions keep their existing permissions. Both sections use the same category visibility/deadline rules as before. Existing CSS is reused. This addition requires no database migration;035 remains pending only for Activity retention above.

## Special Meeting events — published (16 October 2026)

Migration `202610160036_special_meeting_events.sql` and its matching application changes are published through PR53. Installed migrations001–036 must never be replayed.

- Create Special Meeting tasks in the existing forms. They are saved locked in their category automatically. The heading lock sits beside the existing title edit button; only Owners and Coordinators can confirm activation or relocking. Members can read the title and activation status.
- Choose a start date and optionally1–31 consecutive days. Weekday names appear automatically. A blank duration preserves one meeting-day occurrence and visibility through the following day’s11:59PM. An explicit duration ends at11:59PM on its final day.
- Bounded Daily plans create an independent current-day occurrence even when yesterday’s task remains unfinished. Only today’s card appears per plan in current views, including the Special category. Completion records and yearly credits remain independent. No unbounded regular repeat queue is created. Legacy Special tasks are adopted locked without changing any old task fields or deleting their old queue/history records; legacy Special pending queues stop releasing under the new event rule.
- During an activated event’s scheduled dates, current task pages and meeting areas show Special work instead of regular meetings. The Special category keeps its heading and lock controls available; preparation task rows follow the category meeting-window rule. Relocking restores regular views immediately without losing progress; reactivation resumes the original schedule. Future activation waits for the scheduled midnight. End-of-event midnight restores the normal meeting schedule automatically. Bin, issued fines and saved history remain preserved.
- Special absence applies to the selected meeting day. Mark/unmark stays12AM–9PM India time. Special Missed completion stays7PM–following1AM, except it closes at the final event’s11:59PM deadline. Current role, assignee, restriction and recorded-completer reopening checks remain enforced on the server.
- **No new Special Meeting fines** are issued, including confirmed Missed completion. Replaced regular occurrences are exempt from new automatic fines and Missed completion when covered by the activation interval; existing issued fines remain unchanged. Persistent activation intervals keep delayed maintenance from charging a replaced occurrence after relocking.
- Existing CSS and unrelated layout remain unchanged. New schedule controls use their own stylesheet and existing dialog styles.

Validation: `npm run test:special`, `npm run test:special:sql`, the existing Node test suites, TypeScript and the Node24 production build. SQL tests use disposable PostgreSQL16 with networking disabled, including populated legacy adoption, authorization, finite daily rollover, concurrent release, relocking, future activation, Missed without fines, historical replacement exemption and preservation checks. The fictional UI fixture (`node scripts/special-meeting-ui-fixture.mjs`, port3052) has no credentials or hosted connections; it is not a live cross-device test.

036 has already been applied once. Never apply it again. Read-only verification is available in `supabase/verification/special_meeting_events.sql`. The migration is transactional, guards prior task fields/function grants/trigger modes, rejects replay, does not create or enable a new job, and does not delete records. Existing bounded-release catch-up uses the established repeat maintenance entry point.


## Special Meeting date editing — migration037

Owners and Coordinators can edit the Due date in an existing Special Meeting task form. The field edits the shared meeting start date; its weekday list and end date update immediately. Confirming moves every task/plan in that meeting by the same number of days, including already-materialized daily occurrences and Bin records. Duration stays unchanged. The meeting locks again and requires explicit activation for the new dates. Completion timestamps, history records, assignments, cancellation state, existing fines and yearly totals are preserved. Historical activation snapshots keep earlier regular-meeting fine exemptions tied to the dates originally replaced. A stale task/meeting version or duplicate target schedule rejects the complete operation.

Locked and future Special Meeting preparations stay saved but are hidden from the category list and its menu count until activated and within their saved dates. Existing heading/lock controls remain available. Only activated, enabled current-day occurrences in the meeting window appear and contribute. Other counters and all CSS remain unchanged.

This release requires additive migration `202610160037_special_meeting_date_edit.sql` and matching application code. Check the deployment record before applying it: once installed, never replay037 or any earlier migration. The migration performs no task deletion, activation, account/role update or job installation. It requires the installed036 baseline.

Validation: all263 Node tests,76 disposable PostgreSQL checks (the existing036 suite plus shared-date tests), TypeScript/Node24 production build, and fictional desktop/mobile UI save/counter/confirmation checks. Run `python3 supabase/tests/special_meeting_date_edit.py` for isolated SQL verification. No hosted mutations or physical two-device checks were performed for this local update.

## Meeting completion locks — migration038 (local, not installed)

All tasks keeps future regular tasks and one current/prepared occurrence per Special Meeting plan visible with the existing Locked badge. An active Special Meeting still replaces regular tasks under the existing rules. Category lists and counters remain empty outside their meeting window, including for active and future tasks.

Locked tasks cannot be completed by Members, Coordinators or Owners, including through the editor or Missed action. Owners and Coordinators can still edit their details. Dated regular tasks unlock at India midnight for their own meeting occurrence; a following-day due date uses that meeting's start. Other off-day dates unlock on their actual date. Past dated overdue tasks keep normal completion permissions. Undated regular tasks can complete only during their category's meeting window. Special tasks also require activation, an enabled occurrence and the saved meeting dates.

The additive `202610180038_meeting_completion_lock.sql` repeats this policy at the actual status transition using the server clock. Its private trigger protects inserts and updates without changing existing role/assignment checks, historical completions, reopening rules, function grants, accounts, fines or scheduled jobs. It performs no deletion. Existing completed records can still be edited under their usual permissions. Migration038 is prepared and tested locally only; migrations001–037 are installed and must never be replayed.

Validation: `node --test scripts/meeting-completion-lock.test.mjs`, the existing Node suites, Node24 production build, `python3 supabase/tests/meeting_completion_lock.py` and `python3 supabase/tests/workspace_assignments.py`. Database suites run only in disposable network-isolated PostgreSQL. Read-only post-install verification: `supabase/verification/20261018_meeting_completion_lock_checks.sql`.

## Home Screen installation — Android and iPhone

BGM Task can be installed from its HTTPS website. The web manifest requests a standalone app window, with the existing navy/gold icon, and launches `/account` through the existing authentication flow. The default authenticated view is Assigned to me. Existing account credentials, workspace permissions and saved data are shared with the website.

The sign-in page includes an Install app action below the existing form. Supported browsers use their native install prompt when offered. Android users can also use Chrome’s menu → Install app. On iPhone/iPad, use Safari → Share → Add to Home Screen and enable Open as Web App when shown. Browser wording and availability vary; a browser shortcut is not the standalone installation. Install guidance hides while running standalone.

Internet is required. This implementation adds no service worker, offline task queue, private-response cache, push subscription, APK/native package or database migration. In-app notifications keep their existing behavior. Publish the matching application and static icons to make installation available on the live site; physical Android and iPhone installation, session persistence and resume must be checked on devices.

Validation: `npm run test:install`, all existing Node suites and `npm run build`. Current-schema notification and Missed SQL checks are available as `npm run test:current:notifications:sql` and `npm run test:current:missed:sql`; they use a private deterministic clock only inside disposable network-isolated PostgreSQL. Historical migration-specific suites remain available separately. Never run these fixture scripts against hosted data or replay installed migrations001–037.

### App Back and Forward navigation

In-app views and category selections create browser-history entries without changing the existing layout or URL. Back returns to the previous view; Forward restores it. Status/priority filter changes update the current entry. Existing dedicated routes keep their normal navigation. When an in-app history entry is available, Back first dismisses an open dialog/drawer through its normal close handler; unsaved changes retain their existing confirmation. No extra launch entry is added to trap users inside the app, so Back at the first screen can still leave normally. Navigation history stores only view/filter metadata, never tasks, account records or credentials.

Regression checks: `node --test scripts/view-history.test.mjs`, the existing Node suites and production build. Physical Android/iPhone Back gestures still require checking after deployment.


Task responsiveness: returning to Assigned to me keeps the loaded workspace rather than reloading the document. Existing four-category workspaces skip redundant category bootstrap requests. Status changes render only the committed, version-checked server result, then reconcile the dataset in the background; unchanged claim and Special schedule labels are retained during that refresh. Bin counters still load and receive live updates without reloading merely when another save starts or stops. Authentication, assignment checks, meeting rules and CSS remain unchanged.
