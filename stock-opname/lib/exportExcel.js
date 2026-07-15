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
  const materialBelumDiinput = notYetScanned.length;
  const materialSudahDiinput = totalMaterialSap - materialBelumDiinput;
  const materialSelisih = rows.filter((r) => r.status === 'Lebih' || r.status === 'Kurang').length;
  const progress = totalMaterialSap > 0 ? Math.round((materialSudahDiinput / totalMaterialSap) * 100) : 0;

  // Qty can't be summed across different units (BOX vs PC vs AU, etc.)
  // so it's broken down per Base Unit of Measure, same as the dashboard.
  const qtyByUom = new Map();
  for (const r of sap) {
    const uom = r.base_uom || '(tanpa satuan)';
    const cur = qtyByUom.get(uom) || { uom, qtySap: 0, qtyLebih: 0, qtyKurang: 0, qtyBelum: 0 };
    cur.qtySap += Number(r.qty) || 0;
    qtyByUom.set(uom, cur);
  }
  for (const r of rows) {
    if (r.selisih === 0) continue;
    const uom = r.base_uom || '(tanpa satuan)';
    const cur = qtyByUom.get(uom) || { uom, qtySap: 0, qtyLebih: 0, qtyKurang: 0, qtyBelum: 0 };
    if (r.selisih > 0) cur.qtyLebih += r.selisih;
    else cur.qtyKurang += Math.abs(r.selisih);
    qtyByUom.set(uom, cur);
  }
  for (const r of notYetScanned) {
    const uom = r.base_uom || '(tanpa satuan)';
    const cur = qtyByUom.get(uom) || { uom, qtySap: 0, qtyLebih: 0, qtyKurang: 0, qtyBelum: 0 };
    cur.qtyBelum += Number(r.qty) || 0;
    qtyByUom.set(uom, cur);
  }
  const uomRows = [...qtyByUom.values()].sort((a, b) => a.uom.localeCompare(b.uom));

  const wb = XLSX.utils.book_new();

  // --- Sheet 1: Summary ---
  const summaryData = [
    ['Session', sessionName],
    ['Tanggal Export', new Date().toLocaleString('id-ID')],
    [],
    ['Metrik', 'Nilai'],
    ['Material Sudah Diinput', materialSudahDiinput],
    ['Material Belum Diinput', materialBelumDiinput],
    ['Material Selisih', materialSelisih],
    ['Progress Stock Opname (%)', progress],
    [],
    ['Qty per Base Unit of Measure', '', '', '', ''],
    ['UoM', 'Qty SAP', 'Qty Belum Diinput', 'Qty Lebih', 'Qty Kurang'],
    ...uomRows.map((r) => [r.uom, r.qtySap, r.qtyBelum, r.qtyLebih, r.qtyKurang]),
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
      UoM: r.base_uom,
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
      UoM: r.base_uom,
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
      UoM: e.base_uom,
      'Kondisi Barang': e.kondisi_barang,
      Catatan: e.catatan,
      Status: e.status_sap === 'tidak_ada_di_sap' ? 'Tidak Ada di SAP' : 'Ditemukan',
    }))
  );
  XLSX.utils.book_append_sheet(wb, detailScanSheet, 'Detail Scan');

  const fileName = `${sessionName.replace(/[^a-z0-9]+/gi, '_')}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
