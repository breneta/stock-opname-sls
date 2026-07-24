import * as XLSX from 'xlsx';

// Headers must match COLUMN_MAP in
// app/admin/sessions/[id]/upload/normal-rak/page.js exactly (aliases are
// matched case-insensitively). Format sengaja disamakan persis dengan
// Template Data Master Rimpilan (lib/rimpilanTemplate.js) — satu pola
// template Accounting buat kedua jenis rak master, cuma beda tabel tujuan.
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
  ['ABGTB2026', 'Step Tile dRomano Brown', 'S074G', 'RDC Jakarta', 'RFM1', 'PC', 100, 'A-01'],
  ['ABGTB2201', 'Step Tile dHybrida Cherry', 'S072G', 'RDC Jakarta', 'RFM1', 'PC', 50, 'A-01'],
];

export function downloadNormalRakTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...EXAMPLE_ROWS]);
  ws['!cols'] = HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 16) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Master Rak Normal SO');
  XLSX.writeFile(wb, 'Template_Master_Rak_Normal_SO.xlsx');
}
