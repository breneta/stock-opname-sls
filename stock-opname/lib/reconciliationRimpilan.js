// Aggregates Rimpilan-track scan entries (so_entries where source =
// 'rimpilan') grouped by Material Code, then compares against the
// running stok recorded in Master Material Rimpilan for the same RDC.
// Unlike the SAP comparison, a discrepancy here can be corrected
// directly — see applyStockAdjustment in the reconciliation-rimpilan page.

export function buildRimpilanReconciliation(masterMaterials, entries) {
  const masterByCode = new Map(masterMaterials.map((m) => [m.kode_material.trim().toUpperCase(), m]));

  const groups = new Map();
  for (const e of entries) {
    const key = e.material_code.trim().toUpperCase();
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        material: e.material_code,
        material_description: e.material_description,
        totalQtyFisik: 0,
        entries: [],
      });
    }
    const g = groups.get(key);
    g.totalQtyFisik += Number(e.qty_fisik) || 0;
    g.entries.push(e);
  }

  const rows = [];
  for (const g of groups.values()) {
    const master = masterByCode.get(g.key);
    const stokMaster = master ? Number(master.stok) : 0;
    const selisih = g.totalQtyFisik - stokMaster;

    let status;
    if (!master) status = 'Tidak Ada di Master';
    else if (selisih === 0) status = 'Sesuai';
    else if (selisih > 0) status = 'Lebih';
    else status = 'Kurang';

    rows.push({
      materialId: master?.id || null,
      material: g.material,
      material_description: master?.nama_material || g.material_description || '',
      nomor_rak: master?.nomor_rak || '',
      satuan: master?.satuan || '',
      stok_master: stokMaster,
      total_qty_fisik: g.totalQtyFisik,
      selisih,
      status,
      entries: g.entries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    });
  }

  const scannedKeys = new Set(groups.keys());
  const notYetScanned = masterMaterials.filter((m) => !scannedKeys.has(m.kode_material.trim().toUpperCase()));

  return { rows, notYetScanned };
}
