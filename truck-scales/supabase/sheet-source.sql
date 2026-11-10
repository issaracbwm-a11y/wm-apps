-- Additive setup: does not modify existing registers or access functions.
begin;
create table if not exists wm_truck_private.sheet_source (
 id boolean primary key default true check(id), url text not null,
 updated_at timestamptz not null default now()
);
create table if not exists wm_truck_private.sheet_tickets (
 digest bytea primary key, device_id uuid not null references wm_truck_private.devices,
 expires_at timestamptz not null
);
alter table wm_truck_private.sheet_source enable row level security;
alter table wm_truck_private.sheet_tickets enable row level security;
revoke all on wm_truck_private.sheet_source,wm_truck_private.sheet_tickets from public,anon,authenticated;
create or replace function wm_truck_private.sheet_source_access(p_token text,p_action text,p_url text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d wm_truck_private.devices; u text; t text;
begin
 select * into d from wm_truck_private.devices where digest=sha256(convert_to(p_token,'UTF8')) and revoked_at is null;
 if not found or not d.is_admin then raise exception 'Admin required' using errcode='42501'; end if;
 if p_action='set' then
  if p_url is null or p_url !~ '^https://script[.]google[.]com/macros/s/[A-Za-z0-9_-]{20,}/exec$' or length(p_url)>500 then raise exception 'Invalid Apps Script URL' using errcode='22023'; end if;
  insert into wm_truck_private.sheet_source(id,url) values(true,p_url) on conflict(id) do update set url=excluded.url,updated_at=now();
 elsif p_action not in ('get','ticket') then raise exception 'Invalid action' using errcode='22023'; end if;
 select url into u from wm_truck_private.sheet_source where id;
 if p_action='ticket' then
  if u is null then return jsonb_build_object('url',null); end if;
  delete from wm_truck_private.sheet_tickets where expires_at<now();
  t:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into wm_truck_private.sheet_tickets values(sha256(convert_to(t,'UTF8')),d.id,now()+interval '60 seconds');
  return jsonb_build_object('url',u,'ticket',t);
 end if;
 return jsonb_build_object('url',u);
end $$;
create or replace function wm_truck_private.redeem_sheet_ticket(p_ticket text) returns boolean
language plpgsql security definer set search_path='' as $$
declare d uuid;
begin
 if p_ticket is null or p_ticket !~ '^[a-f0-9]{64}$' then return false; end if;
 delete from wm_truck_private.sheet_tickets where digest=sha256(convert_to(p_ticket,'UTF8')) and expires_at>clock_timestamp() returning device_id into d;
 return d is not null and exists(select 1 from wm_truck_private.devices where id=d and is_admin and revoked_at is null);
end $$;
create or replace function public.wm_truck_sheet_source(p_token text,p_action text,p_url text default null) returns jsonb
language sql security invoker set search_path='' as $$ select wm_truck_private.sheet_source_access(p_token,p_action,p_url); $$;
create or replace function public.wm_truck_sheet_ticket(p_ticket text) returns boolean
language sql security invoker set search_path='' as $$ select wm_truck_private.redeem_sheet_ticket(p_ticket); $$;
revoke all on function wm_truck_private.sheet_source_access(text,text,text),wm_truck_private.redeem_sheet_ticket(text),public.wm_truck_sheet_source(text,text,text),public.wm_truck_sheet_ticket(text) from public,anon,authenticated;
grant execute on function wm_truck_private.sheet_source_access(text,text,text),wm_truck_private.redeem_sheet_ticket(text),public.wm_truck_sheet_source(text,text,text),public.wm_truck_sheet_ticket(text) to anon;
notify pgrst,'reload schema';
commit;
