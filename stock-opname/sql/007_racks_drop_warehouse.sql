-- 1 session = 1 warehouse (per user decision), so warehouse_code on
-- warehouse_racks is redundant — the session itself already scopes which
-- warehouse this is. Make the column optional (old rows keep whatever they
-- had) and switch the uniqueness rule to just (session_id, rack_code) so a
-- rack list uploaded without any warehouse_code still de-dupes correctly.
-- Not dropping the column outright, to avoid breaking anything that still
-- reads it — it's just no longer required or used going forward.
alter table warehouse_racks alter column warehouse_code drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'warehouse_racks_session_rack_key'
  ) then
    alter table warehouse_racks add constraint warehouse_racks_session_rack_key unique (session_id, rack_code);
  end if;
end $$;
