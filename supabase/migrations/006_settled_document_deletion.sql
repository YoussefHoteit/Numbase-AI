-- Close deletion races with requests that have not settled yet.
begin;
create or replace function public.numbase_set_document_removed(session_owner uuid, file_id uuid, chat_id text, remove_file boolean)
returns jsonb language plpgsql set search_path = public as $$
declare item public.numbase_documents; next_record jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('numbase-document-reservations', 0));
  select * into item from public.numbase_documents where id = file_id and owner = session_owner and conversation_id = chat_id for update;
  if not found then raise exception 'File unavailable'; end if;
  if item.record ? 'purgedAt' or item.record ? 'purgePendingAt' then raise exception 'File deletion has started'; end if;
  if remove_file = (item.record ? 'removedAt') then return item.record; end if;
  if remove_file then
    if item.status in ('pending', 'queued', 'processing') and item.created_at > now() - interval '10 minutes' then raise exception 'File is processing'; end if;
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

create or replace function public.numbase_begin_document_purge(session_owner uuid, file_id uuid, chat_id text)
returns void language plpgsql set search_path = public as $$
declare item public.numbase_documents;
begin
  perform pg_advisory_xact_lock(hashtextextended('numbase-document-reservations', 0));
  select * into item from public.numbase_documents where id = file_id and owner = session_owner and conversation_id = chat_id for update;
  if not found or not item.record ? 'removedAt' then raise exception 'Remove file first'; end if;
  if item.record ? 'purgedAt' then return; end if;
  if not item.record ? 'generated' and (item.record->>'createdAt')::numeric > extract(epoch from clock_timestamp() - interval '125 minutes') * 1000 then raise exception 'Upload ticket not expired'; end if;
  if item.record ? 'generated' and item.status <> 'ready' and (item.record->>'createdAt')::numeric > extract(epoch from clock_timestamp() - interval '10 minutes') * 1000 then raise exception 'File request not settled'; end if;
  update public.numbase_documents set record = record || jsonb_build_object('purgePendingAt', floor(extract(epoch from clock_timestamp()) * 1000)) where id = file_id and owner = session_owner;
end; $$;


commit;
