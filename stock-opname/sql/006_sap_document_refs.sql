-- Record-keeping only — not an approval workflow. After a session is
-- closed and the SAP-side physical inventory posting is done (MI04/MI07 or
-- equivalent), Accounting can note down the two reference numbers SAP
-- generates so anyone looking at this session later (or an auditor) can
-- trace straight to the SAP side without hunting through email/SAP itself:
--
--   - Physical Inventory Document (PID) — the count document SAP created
--     for this physical inventory.
--   - Material Document — the posting that actually adjusted the stock/
--     accounting once differences were confirmed.
--
-- Both nullable, both free text (no format validation — SAP document
-- numbers vary by client config), no workflow gating them.
--
-- Safe to re-run.

alter table so_sessions add column if not exists pid_number text;
alter table so_sessions add column if not exists material_document_number text;
