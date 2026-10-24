-- Bound extraction spend separately from low-cost search embeddings.
begin;
alter table public.numbase_document_queries add column kind text not null default 'search'
  check (kind in ('search', 'extraction'));
create function public.numbase_reserve_extraction(session_owner uuid)
returns void language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('numbase-extraction-budget', 0));
  if (select count(*) from public.numbase_document_queries where kind = 'extraction' and owner = session_owner and created_at >= date_trunc('day', now())) >= 3
    or (select count(*) from public.numbase_document_queries where kind = 'extraction' and created_at >= date_trunc('day', now())) >= 10
    then raise exception 'Extraction quota reached'; end if;
  insert into public.numbase_document_queries(owner, kind) values (session_owner, 'extraction');
end;
$$;
revoke all on function public.numbase_reserve_extraction(uuid) from public, anon, authenticated;
grant execute on function public.numbase_reserve_extraction(uuid) to service_role;
commit;
