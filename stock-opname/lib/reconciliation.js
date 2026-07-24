// Aggregates raw scan entries (one row per physical count) into
// reconciled rows grouped by Material + Batch + Plant + Storage Location.
// This is the ONLY place merging happens — raw entries in so_entries /
// rimpilan_entries are never updated, only ever appended (per business
// rule).
//
// RECOUNT: when Accounting starts a recount round, new entries for the
// flagged materials come in tagged with a higher recount_round. For any
// material that has entries in more than one round, only the entries
// from its HIGHEST round are used for the total — older rounds stay in
// the database untouched (audit trail) but are excluded from the sum,
// so a recount replaces the previous count instead of stacking on top
// of it. Normal SO and Rimpilan SO share the same round counter per
// session (so_sessions.active_recount_round) — see buildCombinedReconciliation.

// keterangan_khusus rows (Pecah / Pallet rusak / Stock tidak terikat /
// Kardus rusak / Lainnya) are metadata only — they document the condition
// of some of the qty already counted in the "normal" row for that same
// material+batch+rak+round, not additional qty on top of it. Same rule
// Rimpilan already uses (see buildRimpilanReconciliation below).
export function buildReconciliation(sapData, entries) {
  const result = buildFromEntries(
    sapData,
    entries.map((e) => ({ ...e, __qty: e.keterangan_khusus ? 0 : Number(e.qty_fisik) || 0, __isKeterangan: !!e.keterangan_khusus }))
  );
  for (const row of result.rows) {
    row.keteranganEntries = row.allEntriesHistory.filter((e) => e.__isKeterangan);
  }
  return result;
}

// Rimpilan-only reconciliation, scoped to rimpilan_sap_data as the
// baseline instead of so_sap_data. Used for the Rimpilan tab's own
// Progress/Sudah/Belum/Selisih cards.
//
// keterangan_khusus rows are metadata only (Pecah / Pallet rusak / Stock
// tidak terikat / Kardus rusak / Lainnya) — they document the CONDITION
// of some of the counted qty, they are not an additional qty on top of
// it. Only the "normal qty" row (keterangan_khusus IS NULL) for a given
// material+rak+level+round counts toward the total; keterangan rows are
// still attached to each reconciled row (as `keteranganEntries`) for the
// audit/detail view, just excluded from the sum.
export function buildRimpilanReconciliation(rimpilanSapData, rimpilanEntries) {
  const sapAsQtyRows = rimpilanSapData.map((r) => ({
    material: r.material_code,
    batch: r.batch,
    plant: r.plant,
    storage_location: r.storage_location,
    qty: r.qty,
    base_uom: r.base_uom,
    material_description: r.material_description,
  }));

  const taggedEntries = rimpilanEntries.map((e) => ({
    ...e,
    material_code: e.material_code,
    status_sap: 'ditemukan', // rimpilan_sap_data is a closed list — everything in it is "in SAP" by definition
    __qty: e.keterangan_khusus ? 0 : Number(e.qty_fisik) || 0,
    __isKeterangan: !!e.keterangan_khusus,
  }));

  const result = buildFromEntries(sapAsQtyRows, taggedEntries);

  // Surface the keterangan-khusus rows separately per reconciled row so
  // the UI can show "2 Pecah, 1 Kardus rusak" without them polluting the
  // qty math above.
  for (const row of result.rows) {
    row.keteranganEntries = row.allEntriesHistory.filter((e) => e.__isKeterangan);
  }

  return result;
}

// The "true" reconciliation used for closing a session: Qty SAP (from
// so_sap_data, which per business rule ALREADY includes whatever portion
// is rimpilan) compared against Normal SO qty_fisik + Rimpilan qty_fisik
// combined, respecting the shared recount round. This is what the main
// Rekonsiliasi page and the Excel export use — Tab 1 / Tab 2 dashboards
// each use their own narrower view (buildReconciliation / buildRimpilanReconciliation)
// for a tab-scoped progress read, but THIS is the number that decides
// whether a material is actually settled.
export function buildCombinedReconciliation(sapData, normalEntries, rimpilanEntries) {
  const taggedNormal = (normalEntries || []).map((e) => ({
    ...e,
    __qty: e.keterangan_khusus ? 0 : Number(e.qty_fisik) || 0,
    __source: 'normal',
  }));
  const taggedRimpilan = (rimpilanEntries || []).map((e) => ({
    ...e,
    material_code: e.material_code,
    status_sap: e.status_sap || 'ditemukan',
    __qty: e.keterangan_khusus ? 0 : Number(e.qty_fisik) || 0,
    __source: 'rimpilan',
  }));

  return buildFromEntries(sapData, [...taggedNormal, ...taggedRimpilan]);
}

// Shared aggregation core. `entries` must already have a numeric `__qty`
// field set (the amount that should count toward the sum — this is how
// keterangan-khusus rows and Tidak-Ada-di-SAP rows get handled uniformly
// without branching all over the place).
function buildFromEntries(sapData, entries) {
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
    const maxRound = Math.max(0, ...g.allEntries.map((e) => e.recount_round || 0));
    const activeEntries = g.allEntries.filter((e) => (e.recount_round || 0) === maxRound);
    const totalQtyFisik = activeEntries.reduce((sum, e) => sum + (Number(e.__qty) || 0), 0);

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
