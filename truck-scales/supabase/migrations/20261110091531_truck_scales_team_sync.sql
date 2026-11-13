-- Apply in a dedicated Supabase project. Only these two public RPCs are exposed.
begin;

create schema wm_truck_private;
revoke all on schema wm_truck_private from public, anon, authenticated;
grant usage on schema wm_truck_private to anon;

create table wm_truck_private.invites (
  digest bytea primary key,
  label text not null,
  is_admin boolean not null default false,
  expires_at timestamptz not null default now() + interval '30 minutes'
);
create table wm_truck_private.devices (
  id uuid primary key default gen_random_uuid(),
  digest bytea unique not null,
  label text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create table wm_truck_private.records (
  kind text not null check (kind in ('machines','inspections','plans','evidence')),
  id text not null,
  value jsonb,
  revision integer not null check (revision > 0),
  updated_by uuid not null references wm_truck_private.devices,
  updated_at timestamptz not null default now(),
  primary key (kind,id)
);
alter table wm_truck_private.invites enable row level security;
alter table wm_truck_private.devices enable row level security;
alter table wm_truck_private.records enable row level security;
revoke all on all tables in schema wm_truck_private from public, anon, authenticated;

create function wm_truck_private.enroll(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare invite wm_truck_private.invites; token text;
begin
  if p_code is null or p_code !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid or expired device invitation' using errcode = '28000';
  end if;
  delete from wm_truck_private.invites
    where digest = sha256(convert_to(p_code,'UTF8')) and expires_at > clock_timestamp()
    returning * into invite;
  if not found then raise exception 'Invalid or expired device invitation' using errcode = '28000'; end if;
  token := replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');
  insert into wm_truck_private.devices (digest,label,is_admin)
    values (sha256(convert_to(token,'UTF8')),invite.label,invite.is_admin);
  return jsonb_build_object('token',token);
end;
$$;

create function wm_truck_private.access(p_token text, p_action text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  device wm_truck_private.devices;
  rec wm_truck_private.records;
  entry jsonb; kind_name text; record_id text; next_value jsonb;
  expected integer; actual integer; result jsonb := '[]'::jsonb;
  code text; expiry timestamptz; label text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Device access denied' using errcode = '28000';
  end if;
  select * into device from wm_truck_private.devices
    where digest = sha256(convert_to(p_token,'UTF8')) and revoked_at is null for share;
  if not found then raise exception 'Device access denied' using errcode = '28000'; end if;

  if p_action = 'status' then
    return jsonb_build_object('label',device.label,'admin',device.is_admin);
  elsif p_action = 'invite' and device.is_admin then
    label := btrim(p_data->>'label');
    if label is null or length(label) not between 1 and 100 then raise exception 'Invalid device label'; end if;
    code := replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');
    expiry := clock_timestamp() + interval '30 minutes';
    insert into wm_truck_private.invites(digest,label,expires_at) values (sha256(convert_to(code,'UTF8')),label,expiry);
    return jsonb_build_object('code',code,'expires_at',expiry);
  elsif p_action = 'devices' and device.is_admin then
    return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'label',d.label,'created_at',d.created_at,'admin',d.is_admin) order by d.created_at)
      from wm_truck_private.devices d where d.revoked_at is null),'[]'::jsonb);
  elsif p_action = 'revoke' and device.is_admin then
    update wm_truck_private.devices d set revoked_at = clock_timestamp()
      where d.id = (p_data->>'id')::uuid and not d.is_admin and d.revoked_at is null;
    return jsonb_build_object('revoked',found);
  elsif p_action = 'list' then
    kind_name := p_data->>'kind';
    if kind_name not in ('machines','inspections','plans','evidence') or kind_name is null then raise exception 'Invalid record kind'; end if;
    -- Evidence bodies are fetched individually. Tombstone revisions protect against stale writes.
    return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,
      'value',case when kind_name='evidence' then null else r.value end,'deleted',r.value is null) order by r.id)
      from wm_truck_private.records r where r.kind=kind_name),'[]'::jsonb);
  elsif p_action = 'evidence' then
    select * into rec from wm_truck_private.records r where r.kind='evidence' and r.id=p_data->>'id';
    if not found or rec.value is null then return null; end if;
    return rec.value;
  elsif p_action = 'apply' or (p_action = 'seed' and device.is_admin) then
    if jsonb_typeof(p_data) is distinct from 'array' or jsonb_array_length(p_data) not between 1 and 2500
      or octet_length(p_data::text) > 33554432 then raise exception 'Invalid or oversized record batch' using errcode = '22023'; end if;
    -- Lock the short write transaction so the initial import cannot race with other writes.
    perform pg_advisory_xact_lock(90593,1);
    if p_action='seed' and exists(select 1 from wm_truck_private.records) then
      raise exception 'Seed requires an empty team register' using errcode = '40001';
    end if;
    for entry in select item from jsonb_array_elements(p_data) as a(item) order by item->>'kind',item->>'id' loop
      kind_name := entry->>'kind'; record_id := entry->>'id';
      expected := (entry->>'revision')::integer; next_value := nullif(entry->'value','null'::jsonb);
      if kind_name not in ('machines','inspections','plans','evidence') or kind_name is null
        or record_id is null or length(record_id) not between 1 and 300 or expected is null or expected < 0
        or (next_value is not null and (jsonb_typeof(next_value) <> 'object' or next_value->>'id' is distinct from record_id)) then
        raise exception 'Invalid record';
      end if;
      if kind_name='machines' and (next_value is null or jsonb_typeof(next_value->'src') is distinct from 'object') then
        raise exception 'Invalid machine record or unsupported deletion' using errcode = '42501';
      end if;
      select * into rec from wm_truck_private.records r where r.kind=kind_name and r.id=record_id;
      actual := coalesce(rec.revision,0);
      if actual <> expected and rec.value is distinct from next_value then
        raise exception 'Record changed on another device' using errcode = '40001';
      end if;
      if kind_name='machines' and not device.is_admin and
        ((rec.value is null and next_value->'fieldAdded' is distinct from 'true'::jsonb)
         or (next_value is not null and rec.value is not null and
            (rec.value->'src' is distinct from next_value->'src' or rec.value->'fieldAdded' is distinct from next_value->'fieldAdded'))) then
        raise exception 'Only an administrator may change the source register' using errcode = '42501';
      end if;
      if rec.value is distinct from next_value then
        actual := actual + 1;
        insert into wm_truck_private.records(kind,id,value,revision,updated_by)
          values (kind_name,record_id,next_value,actual,device.id)
          on conflict (kind,id) do update set value=excluded.value,revision=excluded.revision,
            updated_by=excluded.updated_by,updated_at=clock_timestamp();
      end if;
      result := result || jsonb_build_array(jsonb_build_object('kind',kind_name,'id',record_id,'revision',actual));
    end loop;
    return result;
  end if;
  raise exception 'Action not authorized' using errcode = '42501';
end;
$$;

revoke all on all functions in schema wm_truck_private from public, anon, authenticated;
grant execute on function wm_truck_private.enroll(text), wm_truck_private.access(text,text,jsonb) to anon;

create function public.wm_truck_enroll(p_code text) returns jsonb
language sql security invoker set search_path = '' as $$
  select wm_truck_private.enroll(p_code);
$$;
create function public.wm_truck_access(p_token text,p_action text,p_data jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select wm_truck_private.access(p_token,p_action,p_data);
$$;
revoke all on function public.wm_truck_enroll(text), public.wm_truck_access(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.wm_truck_enroll(text), public.wm_truck_access(text,text,jsonb) to anon;
notify pgrst,'reload schema';
commit;
