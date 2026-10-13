-- Disposable PostgreSQL ONLY. Stand-in verifies SQL/RLS, not hosted transport.
create schema realtime;
create table realtime.messages(id bigint generated always as identity primary key,extension text,topic text,event text,payload jsonb,private boolean);
alter table realtime.messages enable row level security;
revoke all on realtime.messages from public,anon,authenticated,service_role;
grant usage on schema realtime to authenticated;
grant select on realtime.messages to authenticated;
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true); $$;
create function realtime.send(payload jsonb,event text,topic text,private boolean default true)
returns void language sql as $$ insert into realtime.messages(extension,topic,event,payload,private) values('broadcast',topic,event,payload,private); $$;
