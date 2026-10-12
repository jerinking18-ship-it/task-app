-- Disposable local database only. Run before migration 005.
insert into public.tasks(owner_id,title,notes,due_date,due_time,repeat_rule,priority)
values('00000000-0000-4000-8000-000000000001','Midnight legacy transition','Original notes','2099-01-01','10:00','daily','high');
update public.tasks set status='completed' where title='Midnight legacy transition';
update public.tasks set notes='Edited future notes',priority='low'
where title='Midnight legacy transition' and status='active';
create table public.local_midnight_snapshot as
select id,owner_id,title,notes,status,due_date,due_time,priority,category_id,weekdays,
  repeat_rule,repeat_anchor_day,series_id,occurrence_number,created_at
from public.tasks where title='Midnight legacy transition';
insert into public.tasks(owner_id,title,due_date,due_time,repeat_rule)
values('00000000-0000-4000-8000-000000000001','Midnight first future task','2099-01-01','10:00','daily');
