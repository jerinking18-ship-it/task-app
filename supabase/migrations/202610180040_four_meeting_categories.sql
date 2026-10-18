-- Only the four supported meetings. No rows, roles, functions or jobs change.
-- Refuse installation if unexpected legacy categories exist; never delete them.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.categories add constraint task_app_meeting_categories_only
 check(name in('Sunday Service','Healing Meeting','Revival Meeting','Special Meeting'));
commit;
