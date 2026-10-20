-- Run once in the Supabase SQL editor. Browser roles have no table access.
create table if not exists public.numbase_assets (
  id uuid primary key,
  owner uuid not null,
  conversation_id text not null,
  status text not null check (status in ('pending','ready')),
  byte_size bigint not null check (byte_size between 1 and 5242880),
  record jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists numbase_assets_owner_idx on public.numbase_assets(owner);
alter table public.numbase_assets enable row level security;
revoke all on public.numbase_assets from anon, authenticated;
grant all on public.numbase_assets to service_role;

create table if not exists public.numbase_image_jobs (
  id text primary key,
  owner uuid not null,
  status text not null check (status in ('running','succeeded','uncertain')),
  record jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists numbase_jobs_owner_created_idx on public.numbase_image_jobs(owner, created_at);
alter table public.numbase_image_jobs enable row level security;
revoke all on public.numbase_image_jobs from anon, authenticated;
grant all on public.numbase_image_jobs to service_role;

create or replace function public.numbase_reserve_asset(asset_row jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare owner_id uuid := (asset_row->>'owner')::uuid;
begin
  perform pg_advisory_xact_lock(7874401);
  if (select coalesce(sum(byte_size),0) from numbase_assets) + (asset_row->>'byte_size')::bigint > 524288000
    or (select coalesce(sum(byte_size),0) from numbase_assets where owner = owner_id) + (asset_row->>'byte_size')::bigint > 52428800
  then raise exception 'storage limit'; end if;
  insert into numbase_assets(id,owner,conversation_id,status,byte_size,record)
    values ((asset_row->>'id')::uuid,owner_id,asset_row->>'conversation_id',asset_row->>'status',
      (asset_row->>'byte_size')::bigint,asset_row->'record');
end $$;

create or replace function public.numbase_update_asset(asset_row jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare owner_id uuid := (asset_row->>'owner')::uuid;
asset_id uuid := (asset_row->>'id')::uuid;
begin
  -- Decoding can change file size; updates use the same quota lock as reservations.
  perform pg_advisory_xact_lock(7874401);
  if not exists (select 1 from numbase_assets where id = asset_id and owner = owner_id)
  then raise exception 'asset unavailable'; end if;
  if (select coalesce(sum(byte_size),0) from numbase_assets where id <> asset_id) + (asset_row->>'byte_size')::bigint > 524288000
    or (select coalesce(sum(byte_size),0) from numbase_assets where owner = owner_id and id <> asset_id) + (asset_row->>'byte_size')::bigint > 52428800
  then raise exception 'storage limit'; end if;
  update numbase_assets set byte_size=(asset_row->>'byte_size')::bigint,
    status=asset_row->>'status',record=asset_row->'record' where id=asset_id and owner=owner_id;
end $$;

create or replace function public.numbase_reserve_image_job(job_row jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare owner_id uuid := (job_row->>'owner')::uuid;
begin
  -- Atomic reservation: concurrent server instances share these limits.
  perform pg_advisory_xact_lock(7874402);
  if (select count(*) from numbase_image_jobs where created_at >= date_trunc('day',now())) >= 20
    or (select count(*) from numbase_image_jobs where owner = owner_id and created_at >= date_trunc('day',now())) >= 5
    or exists (select 1 from numbase_image_jobs where owner = owner_id and status = 'running' and created_at > now() - interval '5 minutes')
  then raise exception 'generation limit'; end if;
  insert into numbase_image_jobs(id,owner,status,record)
    values (job_row->>'id',owner_id,'running',job_row);
end $$;
revoke all on function public.numbase_reserve_asset(jsonb) from public, anon, authenticated;
revoke all on function public.numbase_reserve_image_job(jsonb) from public, anon, authenticated;
grant execute on function public.numbase_reserve_asset(jsonb) to service_role;
grant execute on function public.numbase_reserve_image_job(jsonb) to service_role;
revoke all on function public.numbase_update_asset(jsonb) from public, anon, authenticated;
grant execute on function public.numbase_update_asset(jsonb) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('numbase-images','numbase-images',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
-- Do not add public storage policies. Uploads use narrowly scoped signed URLs.
