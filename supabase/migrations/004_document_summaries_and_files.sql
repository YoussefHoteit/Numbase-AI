-- Reuses existing private document storage and query ledger. No new bucket or table.
begin;
alter table public.numbase_document_queries drop constraint numbase_document_queries_kind_check;
alter table public.numbase_document_queries add constraint numbase_document_queries_kind_check check (kind in ('search', 'extraction', 'summary'));

create or replace function public.numbase_reserve_document(document_record jsonb)
returns void language plpgsql set search_path = public, extensions as $$
declare session_owner uuid := (document_record->>'owner')::uuid; chat_id text := document_record->>'conversationId';
begin
  perform pg_advisory_xact_lock(hashtextextended('numbase-document-reservations', 0));
  if (document_record->>'size')::bigint not between 1 and 20971520 or document_record->>'status' <> 'pending' then raise exception 'Invalid document'; end if;
  if (select count(*) from public.numbase_documents where owner = session_owner and conversation_id = chat_id) >= 8
    or (select count(*) from public.numbase_documents where owner = session_owner and not record ? 'removedAt') >= 5
    or (select count(*) from public.numbase_documents) >= 25
    or (select count(*) from public.numbase_documents where owner = session_owner and created_at >= date_trunc('day', now())) >= 5
    or (select count(*) from public.numbase_documents where created_at >= date_trunc('day', now())) >= 20
    then raise exception 'Document quota reached'; end if;
  insert into public.numbase_documents(id, owner, conversation_id, status, record) values ((document_record->>'id')::uuid, session_owner, chat_id, 'pending', document_record);
end; $$;

create function public.numbase_set_document_removed(session_owner uuid, file_id uuid, chat_id text, remove_file boolean)
returns jsonb language plpgsql set search_path = public as $$
declare item public.numbase_documents; next_record jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('numbase-document-reservations', 0));
  select * into item from public.numbase_documents where id = file_id and owner = session_owner and conversation_id = chat_id for update;
  if not found then raise exception 'File unavailable'; end if;
  if remove_file = (item.record ? 'removedAt') then return item.record; end if;
  if remove_file then
    if item.status in ('queued', 'processing') and item.created_at > now() - interval '10 minutes' then raise exception 'File is processing'; end if;
    next_record := item.record || jsonb_build_object('removedAt', floor(extract(epoch from clock_timestamp()) * 1000));
    if next_record->'summary'->>'status' in ('queued', 'processing') then
      next_record := jsonb_set(next_record, '{summary}', (next_record->'summary') || jsonb_build_object('status', 'cancelled', 'active', false, 'revision', coalesce((next_record->'summary'->>'revision')::int, 0) + 1));
    end if;
  else
    if (select count(*) from public.numbase_documents where owner = session_owner and not record ? 'removedAt') >= 5 then raise exception 'Active file quota reached'; end if;
    next_record := item.record - 'removedAt';
    -- Interrupted indexing is not restarted silently after restoring a stalled file.
    if item.status in ('pending', 'queued', 'processing') then next_record := next_record || jsonb_build_object('status', 'failed', 'error', 'Processing was interrupted. Upload a fresh copy to index it.'); end if;
  end if;
  update public.numbase_documents set record = next_record, status = next_record->>'status' where id = file_id and owner = session_owner;
  return next_record;
end; $$;

create function public.numbase_begin_document_summary(session_owner uuid, file_id uuid, chat_id text, summary_record jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare item public.numbase_documents;
begin
  perform pg_advisory_xact_lock(hashtextextended('numbase-document-summary-budget', 0));
  select * into item from public.numbase_documents where id = file_id and owner = session_owner and conversation_id = chat_id for update;
  if not found or item.status <> 'ready' or item.record ? 'removedAt' then raise exception 'File unavailable'; end if;
  if item.record->'summary'->>'status' in ('queued', 'processing', 'ready') then return (item.record->'summary') || jsonb_build_object('_created', false); end if;
  -- A user-requested resume keeps its job ID, completed sections and reserved cost.
  -- Competing starts receive _created=false so only one workflow is launched.
  if item.record->'summary'->>'status' in ('failed', 'cancelled') and item.record->'summary'->>'id' = summary_record->>'id' then
    if (summary_record->>'revision')::int <> (item.record->'summary'->>'revision')::int + 1 then raise exception 'Invalid resume revision'; end if;
    update public.numbase_documents set record = jsonb_set(record, '{summary}', summary_record) where id = file_id and owner = session_owner;
    return summary_record || jsonb_build_object('_created', true);
  end if;
  if (select count(*) from public.numbase_document_queries where kind = 'summary' and owner = session_owner and created_at >= date_trunc('day', now())) >= 1
    or (select count(*) from public.numbase_document_queries where kind = 'summary' and created_at >= date_trunc('day', now())) >= 2 then raise exception 'Summary quota reached'; end if;
  insert into public.numbase_document_queries(owner, kind) values (session_owner, 'summary');
  update public.numbase_documents set record = jsonb_set(record, '{summary}', summary_record) where id = file_id and owner = session_owner;
  return summary_record || jsonb_build_object('_created', true);
end; $$;

create function public.numbase_update_document_summary(session_owner uuid, file_id uuid, job_id uuid, expected_revision integer, summary_record jsonb)
returns boolean language plpgsql set search_path = public as $$
declare changed integer;
begin
  if (summary_record->>'id')::uuid <> job_id or (summary_record->>'revision')::int <> expected_revision + 1 then raise exception 'Invalid summary revision'; end if;
  update public.numbase_documents set record = jsonb_set(record, '{summary}', summary_record)
    where id = file_id and owner = session_owner and not record ? 'removedAt'
      and record->'summary'->>'id' = job_id::text and (record->'summary'->>'revision')::int = expected_revision
      and record->'summary'->>'status' in ('queued', 'processing');
  get diagnostics changed = row_count;
  return changed = 1;
end; $$;
revoke all on function public.numbase_set_document_removed(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.numbase_begin_document_summary(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.numbase_update_document_summary(uuid, uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.numbase_set_document_removed(uuid, uuid, text, boolean) to service_role;
grant execute on function public.numbase_begin_document_summary(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.numbase_update_document_summary(uuid, uuid, uuid, integer, jsonb) to service_role;
commit;
