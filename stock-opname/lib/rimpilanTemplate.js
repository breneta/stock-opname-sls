import * as XLSX from 'xlsx';

// Headers must match COLUMN_MAP in app/admin/sessions/[id]/upload/rimpilan/page.js
// exactly (aliases are matched case-insensitively, so these canonical labels
// always work). No Level column on purpose — see that page's comment.
const HEADERS = [
  'Material',
  'Material Description',
  'Batch',
  'Plant',
  'Storage Location',
  'Base Unit of Measure',
  'Qty',
  'Nomor Rak',
];

const EXAMPLE_ROWS = [
  ['RM-00123', 'Keramik 60x60 Putih', 'B2406', 'RDC Jakarta', 'GD1-01', 'BOX', 100, 'A-12'],
  ['RM-00456', 'Keramik 40x40 Krem', 'B2407', 'RDC Jakarta', 'GD1-02', 'BOX', 50, 'A-14'],
];

export function downloadRimpilanTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...EXAMPLE_ROWS]);
  ws['!cols'] = HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 16) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data Master Rimpilan');
  XLSX.writeFile(wb, 'Template_Data_Master_Rimpilan.xlsx');
}
