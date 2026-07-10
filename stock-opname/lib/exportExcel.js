import * as XLSX from 'xlsx';
import { supabase } from './supabaseClient';
import { buildReconciliation } from './reconciliation';

export async function exportSessionToExcel(sessionId, sessionName) {
  const [{ data: sapData }, { data: entries }] = await Promise.all([
    supabase.from('so_sap_data').select('*').eq('session_id', sessionId),
    supabase.from('so_entries').select('*').eq('session_id', sessionId).order('created_at'),
  ]);

  // Only materials with actual stock (Qty > 0) count toward "Total
  // Material" — keeps this in sync with the dashboard and Rekonsiliasi.
  const sap = (sapData || []).filter((r) => Number(r.qty) > 0);
  const rawEntries = entries || [];
  const { rows, notYetScanned } = buildReconciliation(sap, rawEntries);

  const totalMaterialSap = sap.length;
  const totalQtySap = sap.reduce((s, r) => s + Number(r.qty || 0), 0);
  const materialBelumDiinput = notYetScanned.length;
  const materialSudahDiinput = totalMaterialSap - materialBelumDiinput;
  const materialSelisih = rows.filter((r) => r.status === 'Lebih' || r.status === 'Kurang').length;
  const totalQtyLebih = rows.filter((r) => r.selisih > 0).reduce((s, r) => s + r.selisih, 0);
  const totalQtyKurang = rows.filter((r) => r.selisih < 0).reduce((s, r) => s + Math.abs(r.selisih), 0);
  const progress = totalMaterialSap > 0 ? Math.round((materialSudahDiinput / totalMaterialSap) * 100) : 0;

  const wb = XLSX.utils.book_new();

  // --- Sheet 1: Summary ---
  const summaryData = [
    ['Session', sessionName],
    ['Tanggal Export', new Date().toLocaleString('id-ID')],
    [],
    ['Metrik', 'Nilai'],
    ['Total Material SAP', totalMaterialSap],
    ['Total Qty SAP', totalQtySap],
    ['Material Sudah Diinput', materialSudahDiinput],
    ['Material Belum Diinput', materialBelumDiinput],
    ['Material Selisih', materialSelisih],
    ['Total Qty Lebih', totalQtyLebih],
    ['Total Qty Kurang', totalQtyKurang],
    ['Progress Stock Opname (%)', progress],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  // --- Sheet 2: Selisih (only rows with a discrepancy) ---
  const selisihRows = rows.filter((r) => r.status !== 'Sesuai');
  const selisihSheet = XLSX.utils.json_to_sheet(
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
  );
  XLSX.utils.book_append_sheet(wb, selisihSheet, 'Selisih');

  // --- Sheet 3: Semua Data (every material, reconciled) ---
  const semuaDataSheet = XLSX.utils.json_to_sheet(
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
  );
  XLSX.utils.book_append_sheet(wb, semuaDataSheet, 'Semua Data');

  // --- Sheet 4: Detail Scan (raw, un-aggregated entries) ---
  const detailScanSheet = XLSX.utils.json_to_sheet(
    rawEntries.map((e) => ({
      'Waktu Input': new Date(e.created_at).toLocaleString('id-ID'),
      'Nama Petugas': e.petugas_nama,
      Material: e.material_code,
      'Material Description': e.material_description,
      Batch: e.batch,
      'Nomor Rak': e.nomor_rak,
      'Qty Fisik': e.qty_fisik,
      'Kondisi Barang': e.kondisi_barang,
      Catatan: e.catatan,
      Status: e.status_sap === 'tidak_ada_di_sap' ? 'Tidak Ada di SAP' : 'Ditemukan',
    }))
  );
  XLSX.utils.book_append_sheet(wb, detailScanSheet, 'Detail Scan');

  const fileName = `${sessionName.replace(/[^a-z0-9]+/gi, '_')}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
