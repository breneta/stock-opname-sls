import * as XLSX from 'xlsx';
import { supabase } from './supabaseClient';
import { buildReconciliation } from './reconciliation';
import { buildRimpilanReconciliation } from './reconciliationRimpilan';

export async function exportSessionToExcel(sessionId, sessionName, plant) {
  const [{ data: sapData }, { data: entries }, { data: masterRimpilan }] = await Promise.all([
    supabase.from('so_sap_data').select('*').eq('session_id', sessionId),
    supabase.from('so_entries').select('*').eq('session_id', sessionId).order('created_at'),
    plant
      ? supabase.from('mr_materials').select('*').eq('plant', plant)
      : Promise.resolve({ data: [] }),
  ]);

  const sap = sapData || [];
  const rawEntries = entries || [];
  const sapEntries = rawEntries.filter((e) => e.source !== 'rimpilan');
  const rimpilanEntries = rawEntries.filter((e) => e.source === 'rimpilan');
  const master = masterRimpilan || [];

  const { rows, notYetScanned } = buildReconciliation(sap, sapEntries);
  const { rows: rimpilanRows, notYetScanned: rimpilanNotYetScanned } = buildRimpilanReconciliation(master, rimpilanEntries);

  const totalMaterialSap = sap.length;
  const materialBelumDiinput = notYetScanned.length;
  const materialSudahDiinput = totalMaterialSap - materialBelumDiinput;
  const materialSelisih = rows.filter((r) => r.status === 'Lebih' || r.status === 'Kurang').length;
  const totalQtyLebih = rows.filter((r) => r.selisih > 0).reduce((s, r) => s + r.selisih, 0);
  const totalQtyKurang = rows.filter((r) => r.selisih < 0).reduce((s, r) => s + Math.abs(r.selisih), 0);
  const progress = totalMaterialSap > 0 ? Math.round((materialSudahDiinput / totalMaterialSap) * 100) : 0;

  const totalMaterialRimpilan = master.length;
  const rimpilanBelumDiinput = rimpilanNotYetScanned.length;
  const rimpilanSudahDiinput = totalMaterialRimpilan - rimpilanBelumDiinput;
  const rimpilanSelisihCount = rimpilanRows.filter((r) => r.status === 'Lebih' || r.status === 'Kurang').length;

  const wb = XLSX.utils.book_new();

  // --- Sheet 1: Summary ---
  const summaryData = [
    ['Session', sessionName],
    ['RDC', plant || '-'],
    ['Tanggal Export', new Date().toLocaleString('id-ID')],
    [],
    ['SAP', ''],
    ['Total Material SAP', totalMaterialSap],
    ['Material Sudah Diinput', materialSudahDiinput],
    ['Material Belum Diinput', materialBelumDiinput],
    ['Material Selisih', materialSelisih],
    ['Total Qty Lebih', totalQtyLebih],
    ['Total Qty Kurang', totalQtyKurang],
    ['Progress Stock Opname SAP (%)', progress],
    [],
    ['Rimpilan', ''],
    ['Total Material Rimpilan (RDC ini)', totalMaterialRimpilan],
    ['Material Sudah Diinput', rimpilanSudahDiinput],
    ['Material Belum Diinput', rimpilanBelumDiinput],
    ['Material Selisih', rimpilanSelisihCount],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), 'Summary');

  // --- Sheet 2: Selisih SAP ---
  const selisihRows = rows.filter((r) => r.status !== 'Sesuai');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      selisihRows.map((r) => ({
        Material: r.material,
        'Material Description': r.material_description,
        Batch: r.batch,
        Plant: r.plant,
        'Storage Location': r.storage_location,
        'Qty SAP': r.qty_sap,
        'Total Qty Fisik': r.total_qty_fisik,
        Selisih: r.selisih,
        Status: r.status,
      }))
    ),
    'Selisih SAP'
  );

  // --- Sheet 3: Semua Data SAP ---
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        Material: r.material,
        'Material Description': r.material_description,
        Batch: r.batch,
        Plant: r.plant,
        'Storage Location': r.storage_location,
        'Qty SAP': r.qty_sap,
        'Total Qty Fisik': r.total_qty_fisik,
        Selisih: r.selisih,
        Status: r.status,
      }))
    ),
    'Semua Data SAP'
  );

  // --- Sheet 4: Rimpilan (comparison vs Master stok) ---
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      rimpilanRows.map((r) => ({
        'Kode Material': r.material,
        'Nama Material': r.material_description,
        'Nomor Rak': r.nomor_rak,
        Satuan: r.satuan,
        'Stok Master': r.stok_master,
        'Total Qty Fisik': r.total_qty_fisik,
        Selisih: r.selisih,
        Status: r.status,
      }))
    ),
    'Rimpilan'
  );

  // --- Sheet 5: Detail Scan (raw, un-aggregated entries — both tracks) ---
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      rawEntries.map((e) => ({
        'Waktu Input': new Date(e.created_at).toLocaleString('id-ID'),
        'Nama Petugas': e.petugas_nama,
        Sumber: e.source === 'rimpilan' ? 'Rimpilan' : 'SAP',
        Material: e.material_code,
        'Material Description': e.material_description,
        Batch: e.batch,
        'Nomor Rak': e.nomor_rak,
        'Qty Fisik': e.qty_fisik,
        'Kondisi Barang': e.kondisi_barang,
        Catatan: e.catatan,
        Status: e.source === 'rimpilan' ? '' : (e.status_sap === 'tidak_ada_di_sap' ? 'Tidak Ada di SAP' : 'Ditemukan'),
      }))
    ),
    'Detail Scan'
  );

  const fileName = `${sessionName.replace(/[^a-z0-9]+/gi, '_')}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
