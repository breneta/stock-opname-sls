import * as XLSX from 'xlsx';

// Headers must match COLUMN_MAP in app/admin/sessions/[id]/upload/racks/page.js
// exactly (aliases are matched case-insensitively, so these canonical labels
// always work). Just 1 column — no warehouse_code, since 1 session = 1
// warehouse already (the session itself is the scope).
const HEADERS = ['rack_code'];

const EXAMPLE_ROWS = [['A-12'], ['A-14']];

export function downloadRacksTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...EXAMPLE_ROWS]);
  ws['!cols'] = HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 16) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Warehouse Racks');
  XLSX.writeFile(wb, 'Template_Warehouse_Racks.xlsx');
}
