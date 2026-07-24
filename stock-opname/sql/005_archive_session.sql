-- Soft-delete for sessions — an alternative to actually deleting
-- so_sessions and cascading through every child table. Audit/retention
-- best practice for physical inventory count records is usually 5-7
-- years, so permanently destroying a session on a misclick or a change of
-- mind is riskier than it needs to be. Hard delete (the existing flow in
-- app/admin/page.js) still exists for cases where the data genuinely
-- shouldn't be kept (test sessions, duplicate uploads, etc.) — this just
-- adds a safer default choice alongside it.
--
-- Safe to re-run.

alter table so_sessions add column if not exists archived_at timestamptz;

create index if not exists idx_so_sessions_archived on so_sessions(archived_at);
