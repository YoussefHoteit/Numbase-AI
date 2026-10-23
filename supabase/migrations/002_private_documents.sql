-- Additive migration for the existing Supabase project. Image storage is unchanged.
begin;
create extension if not exists vector with schema extensions;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('numbase-documents', 'numbase-documents', false, 20971520, array[
  'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/plain'
]) on conflict (id) do nothing;

create table public.numbase_documents (
  id uuid primary key,
  owner uuid not null,
  conversation_id text not null check (length(conversation_id) between 1 and 128),
  status text not null check (status in ('pending', 'queued', 'processing', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  record jsonb not null,
  unique (id, owner, conversation_id)
);
create index numbase_documents_owner on public.numbase_documents(owner, conversation_id);
create table public.numbase_document_chunks (
  document_id uuid not null,
  owner uuid not null,
  conversation_id text not null,
  chunk_index integer not null check (chunk_index between 0 and 799),
  location text not null check (length(location) <= 1000),
  content text not null check (length(content) between 1 and 4000),
  embedding extensions.vector(1536),
  primary key (document_id, chunk_index),
  foreign key (document_id, owner, conversation_id) references public.numbase_documents(id, owner, conversation_id) on delete cascade
);
create table public.numbase_document_queries (
  id bigint generated always as identity primary key,
  owner uuid not null,
  created_at timestamptz not null default now()
);
create index numbase_document_queries_created on public.numbase_document_queries(created_at);

alter table public.numbase_documents enable row level security;
alter table public.numbase_document_chunks enable row level security;
alter table public.numbase_document_queries enable row level security;
-- Anonymous browser sessions are verified by the server, not Supabase Auth.
-- No browser role may read these tables, even if a storage path is guessed.
revoke all on public.numbase_documents, public.numbase_document_chunks, public.numbase_document_queries from public, anon, authenticated;
grant all on public.numbase_documents, public.numbase_document_chunks, public.numbase_document_queries to service_role;
grant usage, select on sequence public.numbase_document_queries_id_seq to service_role;

create function public.numbase_reserve_document(document_record jsonb)
returns void language plpgsql set search_path = public, extensions as $$
declare
  session_owner uuid := (document_record->>'owner')::uuid;
  chat_id text := document_record->>'conversationId';
begin
  -- Serialize reservations across instances; reserve the full signed-upload allowance.
  perform pg_advisory_xact_lock(hashtextextended('numbase-document-reservations', 0));
  if (document_record->>'size')::bigint not between 1 and 20971520
    or document_record->>'status' <> 'pending' then raise exception 'Invalid document'; end if;
  if (select count(*) from public.numbase_documents where owner = session_owner and conversation_id = chat_id) >= 8
    or (select count(*) from public.numbase_documents where owner = session_owner) >= 5
    or (select count(*) from public.numbase_documents) >= 25
    or (select count(*) from public.numbase_documents where owner = session_owner and created_at >= date_trunc('day', now())) >= 5
    or (select count(*) from public.numbase_documents where created_at >= date_trunc('day', now())) >= 20
    then raise exception 'Document quota reached'; end if;
  insert into public.numbase_documents(id, owner, conversation_id, status, record)
    values ((document_record->>'id')::uuid, session_owner, chat_id, 'pending', document_record);
end;
$$;

create function public.numbase_reserve_document_query(session_owner uuid)
returns void language plpgsql set search_path = public, extensions as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('numbase-document-query-budget', 0));
  delete from public.numbase_document_queries where created_at < now() - interval '2 days';
  if (select count(*) from public.numbase_document_queries where owner = session_owner and created_at >= date_trunc('day', now())) >= 100
    or (select count(*) from public.numbase_document_queries where created_at >= date_trunc('day', now())) >= 500
    then raise exception 'Document search quota reached'; end if;
  insert into public.numbase_document_queries(owner) values (session_owner);
end;
$$;

create function public.numbase_match_document(session_owner uuid, chat_id text, file_id uuid, query_embedding extensions.vector(1536), result_count integer default 3)
returns table(chunk_index integer, location text, content text, score double precision)
language sql stable set search_path = public, extensions as $$
  select c.chunk_index, c.location, c.content, 1 - (c.embedding <=> query_embedding) as score
  from public.numbase_document_chunks c
  join public.numbase_documents d on d.id = c.document_id
  where c.owner = session_owner and c.conversation_id = chat_id and c.document_id = file_id
    and d.owner = session_owner and d.conversation_id = chat_id and d.status = 'ready'
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit least(greatest(result_count, 1), 6);
$$;

revoke all on function public.numbase_reserve_document(jsonb) from public, anon, authenticated;
revoke all on function public.numbase_reserve_document_query(uuid) from public, anon, authenticated;
revoke all on function public.numbase_match_document(uuid, text, uuid, extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.numbase_reserve_document(jsonb) to service_role;
grant execute on function public.numbase_reserve_document_query(uuid) to service_role;
grant execute on function public.numbase_match_document(uuid, text, uuid, extensions.vector, integer) to service_role;
commit;
