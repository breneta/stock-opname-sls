import * as XLSX from 'xlsx';
import { supabase } from './supabaseClient';
import { buildReconciliation, buildRimpilanReconciliation, buildCombinedReconciliation } from './reconciliation';
import { fetchAll } from './fetchAll';

export async function exportSessionToExcel(sessionId, sessionName) {
  const [sapData, entries, rimpilanSapData, rimpilanEntries] = await Promise.all([
    fetchAll(() => supabase.from('so_sap_data').select('*').eq('session_id', sessionId)),
    fetchAll(() => supabase.from('so_entries').select('*').eq('session_id', sessionId).order('created_at')),
    fetchAll(() => supabase.from('rimpilan_sap_data').select('*').eq('session_id', sessionId)),
    fetchAll(() => supabase.from('rimpilan_entries').select('*').eq('session_id', sessionId).order('created_at')),
  ]);

  // Only materials with actual stock (Qty > 0) count toward "Total
  // Material" — keeps this in sync with the dashboard and Rekonsiliasi.
  const sap = (sapData || []).filter((r) => Number(r.qty) > 0);
  const rawEntries = entries || [];
  const rawRimpilanEntries = rimpilanEntries || [];

  // Normal SO's own view (Tab 1 — unchanged from before Rimpilan existed).
  const { rows, notYetScanned } = buildReconciliation(sap, rawEntries);

  // Rimpilan's own view (Tab 2), scoped to rimpilan_sap_data as baseline.
  const rimpilanResult = buildRimpilanReconciliation(rimpilanSapData || [], rawRimpilanEntries);

  // The "true" combined view — Qty SAP vs Normal + Rimpilan qty_fisik
  // together. This is what the Selisih / Semua Data sheets below use,
  // since that's the number that actually matters for closing a session.
  const combined = buildCombinedReconciliation(sap, rawEntries, rawRimpilanEntries);

  const totalMaterialSap = sap.length;
  const materialBelumDiinput = notYetScanned.length;
  const materialSudahDiinput = totalMaterialSap - materialBelumDiinput;
  const materialSelisihCombined = combined.rows.filter((r) => r.status === 'Lebih' || r.status === 'Kurang').length;
  const progress = totalMaterialSap > 0 ? Math.round((materialSudahDiinput / totalMaterialSap) * 100) : 0;

  const totalMaterialRimpilan = (rimpilanSapData || []).length;
  const rimpilanBelum = rimpilanResult.notYetScanned.length;
  const rimpilanSudah = totalMaterialRimpilan - rimpilanBelum;
  const rimpilanProgress = totalMaterialRimpilan > 0 ? Math.round((rimpilanSudah / totalMaterialRimpilan) * 100) : 0;

  // Qty can't be summed across different units (BOX vs PC vs AU, etc.)
  // so it's broken down per Base Unit of Measure, same as the dashboard.
  const byUom = new Map();
  const getUom = (uom) => {
    const key = uom || '(tanpa satuan)';
    if (!byUom.has(key)) {
      byUom.set(key, { uom: key, qtySap: 0, qtyBelum: 0, qtyInput: 0, qtyLebih: 0, qtyKurang: 0 });
    }
    return byUom.get(key);
  };
  for (const r of sap) {
    getUom(r.base_uom).qtySap += Number(r.qty) || 0;
  }
  for (const r of notYetScanned) {
    getUom(r.base_uom).qtyBelum += Number(r.qty) || 0;
  }
  for (const r of combined.rows) {
    const u = getUom(r.base_uom);
    if (r.selisih > 0) u.qtyLebih += r.selisih;
    else if (r.selisih < 0) u.qtyKurang += Math.abs(r.selisih);
  }
  for (const e of rawEntries) {
    if (e.status_sap === 'tidak_ada_di_sap') continue;
    getUom(e.base_uom).qtyInput += Number(e.qty_fisik) || 0;
  }
  for (const e of rawRimpilanEntries) {
    if (e.keterangan_khusus) continue; // metadata only, not counted qty
    getUom(e.base_uom).qtyInput += Number(e.qty_fisik) || 0;
  }
  const uomRows = [...byUom.values()]
    .map((u) => ({ ...u, selisih: u.qtyLebih - u.qtyKurang }))
    .sort((a, b) => a.uom.localeCompare(b.uom));

  const wb = XLSX.utils.book_new();

  // --- Sheet 1: Summary ---
  const summaryData = [
    ['Session', sessionName],
    ['Tanggal Export', new Date().toLocaleString('id-ID')],
    [],
    ['Metrik', 'Nilai'],
    ['Material Sudah Diinput (Normal)', materialSudahDiinput],
    ['Material Belum Diinput (Normal)', materialBelumDiinput],
    ['Progress Normal SO (%)', progress],
    ['Material Rimpilan Sudah Diinput', rimpilanSudah],
    ['Material Rimpilan Belum Diinput', rimpilanBelum],
    ['Progress Rimpilan SO (%)', rimpilanProgress],
    ['Material Selisih (Gabungan Normal + Rimpilan)', materialSelisihCombined],
    [],
    ['Ringkasan Qty (Gabungan Normal + Rimpilan)', '', '', ''],
    ['UoM', 'Qty SAP', 'Qty Input', 'Selisih'],
    ...uomRows.map((r) => [r.uom, r.qtySap, r.qtyInput, r.selisih]),
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  // --- Sheet 2: Selisih (gabungan Normal + Rimpilan, only discrepancies) ---
  const selisihRows = combined.rows.filter((r) => r.status !== 'Sesuai');
  const selisihSheet = XLSX.utils.json_to_sheet(
    selisihRows.map((r) => ({
      Material: r.material,
      'Material Description': r.material_description,
      Batch: r.batch,
      Plant: r.plant,
      'Storage Location': r.storage_location,
      UoM: r.base_uom,
      'Qty SAP': r.qty_sap,
      'Total Qty Fisik (Normal+Rimpilan)': r.total_qty_fisik,
      Selisih: r.selisih,
      Status: r.status,
    }))
  );
  XLSX.utils.book_append_sheet(wb, selisihSheet, 'Selisih');

  // --- Sheet 3: Semua Data (every material, reconciled, gabungan) ---
  const semuaDataSheet = XLSX.utils.json_to_sheet(
    combined.rows.map((r) => ({
      Material: r.material,
      'Material Description': r.material_description,
      Batch: r.batch,
      Plant: r.plant,
      'Storage Location': r.storage_location,
      UoM: r.base_uom,
      'Qty SAP': r.qty_sap,
      'Total Qty Fisik (Normal+Rimpilan)': r.total_qty_fisik,
      Selisih: r.selisih,
      Status: r.status,
    }))
  );
  XLSX.utils.book_append_sheet(wb, semuaDataSheet, 'Semua Data');

  // --- Sheet 4: Detail Scan Normal (raw, un-aggregated so_entries) ---
  const detailScanSheet = XLSX.utils.json_to_sheet(
    rawEntries.map((e) => ({
      'Waktu Input': new Date(e.created_at).toLocaleString('id-ID'),
      'Nama Petugas': e.petugas_nama,
      Material: e.material_code,
      'Material Description': e.material_description,
      Batch: e.batch,
      'Nomor Rak': e.nomor_rak,
      'Qty Fisik': e.qty_fisik,
      UoM: e.base_uom,
      'Kondisi Barang': e.kondisi_barang,
      Catatan: e.catatan,
      'Recount Round': e.recount_round || 0,
      Status: e.status_sap === 'tidak_ada_di_sap' ? 'Tidak Ada di SAP' : 'Ditemukan',
    }))
  );
  XLSX.utils.book_append_sheet(wb, detailScanSheet, 'Detail Scan Normal');

  // --- Sheet 5: Detail Scan Rimpilan (raw, un-aggregated rimpilan_entries) ---
  const detailScanRimpilanSheet = XLSX.utils.json_to_sheet(
    rawRimpilanEntries.map((e) => ({
      'Waktu Input': new Date(e.created_at).toLocaleString('id-ID'),
      'Nama Petugas': e.petugas_nama,
      Material: e.material_code,
      'Material Description': e.material_description,
      Batch: e.batch,
      'Nomor Rak': e.nomor_rak,
      Level: e.level,
      'Qty Fisik': e.qty_fisik,
      UoM: e.base_uom,
      'Keterangan Khusus': e.keterangan_khusus || '',
      'Keterangan Catatan': e.keterangan_catatan || '',
      'Recount Round': e.recount_round || 0,
    }))
  );
  XLSX.utils.book_append_sheet(wb, detailScanRimpilanSheet, 'Detail Scan Rimpilan');

  const fileName = `${sessionName.replace(/[^a-z0-9]+/gi, '_')}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
