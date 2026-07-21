// Aggregates raw scan entries (one row per physical count) into
// reconciled rows grouped by Material + Batch + Plant + Storage Location.
// This is the ONLY place merging happens — raw entries in so_entries /
// rimpilan_entries are never updated, only ever appended (per business rule).
//
// RECOUNT: when Accounting starts a recount round, new entries for the
// flagged materials come in tagged with a higher recount_round. For any
// material that has entries in more than one round, only the entries
// from its HIGHEST round are used for the total — older rounds stay in
// the database untouched (audit trail) but are excluded from the sum,
// so a recount replaces the previous count instead of stacking on top
// of it. Normal SO and Rimpilan SO SHARE the same recount_round per
// business rule ("Accounting klik Mulai Recount → include both normal +
// rimpilan materials yang selisih"), so this still holds when the two
// entry sources are combined.

export function buildReconciliation(sapData, entries) {
  return aggregate(sapData, normalizeSoEntries(entries));
}

// Rimpilan-only reconciliation — same shape as buildReconciliation, but
// pointed at rimpilan_sap_data as the master ("Qty SAP" here) and
// rimpilan_entries as the count source. Used by the Rimpilan SO tab.
export function buildRimpilanReconciliation(rimpilanSapData, rimpilanEntries) {
  const sapAsRows = rimpilanSapData.map((r) => ({
    material: r.material_code,
    material_description: r.material_description,
    batch: r.batch,
    plant: r.plant,
    storage_location: r.storage_location,
    base_uom: r.base_uom,
    qty: r.qty,
  }));
  return aggregate(sapAsRows, normalizeRimpilanEntries(rimpilanEntries));
}

// Combined reconciliation across BOTH workflows, for the overall/
// management view: Selisih = Qty SAP - (Qty Fisik Normal + Qty Fisik
// Rimpilan). Master qty comes from so_sap_data (per business rule, that
// qty already includes rimpilan stock — no separate calc needed there).
// Both so_entries and rimpilan_entries are queried and summed per
// material+batch+plant+storage_location key, sharing recount_round.
export function buildCombinedReconciliation(sapData, normalEntries, rimpilanEntries) {
  const combined = [
    ...normalizeSoEntries(normalEntries),
    ...normalizeRimpilanEntries(rimpilanEntries),
  ];
  return aggregate(sapData, combined);
}

function normalizeSoEntries(entries) {
  return (entries || []).map((e) => ({
    material_code: e.material_code,
    material_description: e.material_description,
    batch: e.batch,
    plant: e.plant,
    storage_location: e.storage_location,
    base_uom: e.base_uom,
    qty_fisik: e.qty_fisik,
    status_sap: e.status_sap,
    recount_round: e.recount_round,
    created_at: e.created_at,
    source: 'normal',
  }));
}

// rimpilan_entries has no base_uom / status_sap columns (those live on
// rimpilan_sap_data) — every rimpilan entry is by definition matched to
// a known rimpilan master row, so status_sap is always 'ditemukan'.
function normalizeRimpilanEntries(entries) {
  return (entries || []).map((e) => ({
    material_code: e.material_code,
    material_description: e.material_description,
    batch: e.batch,
    plant: e.plant,
    storage_location: e.storage_location,
    base_uom: null,
    qty_fisik: e.qty_fisik,
    status_sap: 'ditemukan',
    recount_round: e.recount_round,
    created_at: e.created_at,
    source: 'rimpilan',
    keterangan_khusus: e.keterangan_khusus,
  }));
}

function aggregate(sapData, entries) {
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
    if (!g.base_uom && e.base_uom) g.base_uom = e.base_uom;
    if (!g.material_description && e.material_description) g.material_description = e.material_description;
  }

  const rows = [];
  for (const g of groups.values()) {
    const sap = sapByKey.get(g.key);
    const qtySap = sap ? Number(sap.qty) : 0;

    // Only entries from the highest recount_round count toward the total
    // — shared across normal + rimpilan entries for the same key, since
    // recount rounds are session-wide, not per-source.
    const maxRound = Math.max(...g.allEntries.map((e) => e.recount_round || 0));
    const activeEntries = g.allEntries.filter((e) => (e.recount_round || 0) === maxRound);
    const totalQtyFisik = activeEntries.reduce((sum, e) => sum + (Number(e.qty_fisik) || 0), 0);
    const totalQtyNormal = activeEntries
      .filter((e) => e.source !== 'rimpilan')
      .reduce((sum, e) => sum + (Number(e.qty_fisik) || 0), 0);
    const totalQtyRimpilan = activeEntries
      .filter((e) => e.source === 'rimpilan')
      .reduce((sum, e) => sum + (Number(e.qty_fisik) || 0), 0);

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
      total_qty_normal: totalQtyNormal,
      total_qty_rimpilan: totalQtyRimpilan,
      selisih,
      status,
      recountRound: maxRound,
      wasRecounted: maxRound > 0,
      entries: activeEntries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
      allEntriesHistory: g.allEntries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    });
  }

  const scannedKeys = new Set(groups.keys());
  const notYetScanned = sapData.filter(
    (row) => !scannedKeys.has(keyOf(row.material, row.batch, row.plant, row.storage_location))
  );

  return { rows, notYetScanned };
}

function keyOf(material, batch, plant, storageLocation) {
  return [material, batch, plant, storageLocation].map((v) => (v || '').trim().toUpperCase()).join('__');
}
