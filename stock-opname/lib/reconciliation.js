// Aggregates raw scan entries (one row per physical count) into
// reconciled rows grouped by Material + Batch + Plant + Storage Location.
// This is the ONLY place merging happens — raw entries in so_entries
// are never updated, only ever appended (per business rule).

export function buildReconciliation(sapData, entries) {
  const sapByKey = new Map();
  for (const row of sapData) {
    const key = keyOf(row.material, row.batch, row.plant, row.storage_location);
    sapByKey.set(key, row);
  }

  const groups = new Map();

  for (const e of entries) {
    const key = keyOf(e.material_code, e.batch, e.plant, e.storage_location);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        material: e.material_code,
        material_description: e.material_description,
        batch: e.batch,
        plant: e.plant,
        storage_location: e.storage_location,
        base_uom: e.base_uom,
        totalQtyFisik: 0,
        entries: [],
        statusSap: e.status_sap,
      });
    }
    const g = groups.get(key);
    g.totalQtyFisik += Number(e.qty_fisik) || 0;
    g.entries.push(e);
    if (e.status_sap === 'tidak_ada_di_sap') g.statusSap = 'tidak_ada_di_sap';
  }

  const rows = [];
  for (const g of groups.values()) {
    const sap = sapByKey.get(g.key);
    const qtySap = sap ? Number(sap.qty) : 0;
    const selisih = g.totalQtyFisik - qtySap;

    let status;
    if (g.statusSap === 'tidak_ada_di_sap' || !sap) {
      status = 'Tidak Ada di SAP';
    } else if (selisih === 0) {
      status = 'Sesuai';
    } else if (selisih > 0) {
      status = 'Lebih';
    } else {
      status = 'Kurang';
    }

    rows.push({
      material: g.material,
      material_description: g.material_description || sap?.material_description || '',
      batch: g.batch,
      plant: g.plant || sap?.plant || '',
      storage_location: g.storage_location || sap?.storage_location || '',
      base_uom: sap?.base_uom || g.base_uom || '',
      qty_sap: qtySap,
      total_qty_fisik: g.totalQtyFisik,
      selisih,
      status,
      entries: g.entries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    });
  }

  // Also surface SAP materials that have zero scans yet (belum diinput),
  // useful for the dashboard's "Material Belum Diinput" count.
  const scannedKeys = new Set(groups.keys());
  const notYetScanned = sapData.filter(
    (row) => !scannedKeys.has(keyOf(row.material, row.batch, row.plant, row.storage_location))
  );

  return { rows, notYetScanned };
}

function keyOf(material, batch, plant, storageLocation) {
  return [material, batch, plant, storageLocation].map((v) => (v || '').trim().toUpperCase()).join('__');
}
