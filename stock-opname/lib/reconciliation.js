// Aggregates raw scan entries (one row per physical count) into
// reconciled rows grouped by Material + Batch + Plant + Storage Location.
// This is the ONLY place merging happens — raw entries in so_entries
// are never updated, only ever appended (per business rule).
//
// RECOUNT: when Accounting starts a recount round, new entries for the
// flagged materials come in tagged with a higher recount_round. For any
// material that has entries in more than one round, only the entries
// from its HIGHEST round are used for the total — older rounds stay in
// the database untouched (audit trail) but are excluded from the sum,
// so a recount replaces the previous count instead of stacking on top
// of it.

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
        allEntries: [],
        statusSap: e.status_sap,
      });
    }
    const g = groups.get(key);
    g.allEntries.push(e);
    if (e.status_sap === 'tidak_ada_di_sap') g.statusSap = 'tidak_ada_di_sap';
  }

  const rows = [];
  for (const g of groups.values()) {
    const sap = sapByKey.get(g.key);
    const qtySap = sap ? Number(sap.qty) : 0;

    // Only entries from the highest recount_round count toward the total.
    // Round 0 = normal first count. If a recount (round 1, 2, ...) exists
    // for this material, it fully replaces the earlier round(s).
    const maxRound = Math.max(...g.allEntries.map((e) => e.recount_round || 0));
    const activeEntries = g.allEntries.filter((e) => (e.recount_round || 0) === maxRound);
    const totalQtyFisik = activeEntries.reduce((sum, e) => sum + (Number(e.qty_fisik) || 0), 0);

    const selisih = totalQtyFisik - qtySap;

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
      total_qty_fisik: totalQtyFisik,
      selisih,
      status,
      // Recount info for this material
      recountRound: maxRound,
      wasRecounted: maxRound > 0,
      // `entries` = only the entries actually counted in the total (current round).
      // `allEntriesHistory` = every attempt ever made, for audit/detail view.
      entries: activeEntries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
      allEntriesHistory: g.allEntries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
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
