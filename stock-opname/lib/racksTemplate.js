import * as XLSX from 'xlsx';

// Headers must match COLUMN_MAP in app/admin/sessions/[id]/upload/racks/page.js
// exactly (aliases are matched case-insensitively, so these canonical labels
// always work). Deliberately just 2 columns — this is only a
// warehouse -> rack mapping, not material data.
const HEADERS = ['warehouse_code', 'rack_code'];

const EXAMPLE_ROWS = [
  ['GD1', 'A-12'],
  ['GD1', 'A-14'],
];

export function downloadRacksTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...EXAMPLE_ROWS]);
  ws['!cols'] = HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 16) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Warehouse Racks');
  XLSX.writeFile(wb, 'Template_Warehouse_Racks.xlsx');
}
