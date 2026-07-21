export function buildReconciliation(sapRows = [], entryRows = []) {
  const map = new Map();

  const keyOf = (r) => [r.material, r.batch, r.plant, r.storage_location].join('||');

  (sapRows || []).forEach((r) => {
    const key = keyOf(r);
    map.set(key, {
      material: r.material,
      material_description: r.material_description,
      batch: r.batch,
      plant: r.plant,
      storage_location: r.storage_location,
      base_uom: r.base_uom,
      qty_sap: Number(r.qty) || 0,
      total_qty_fisik: 0,
      entries: [],
      });
    });

  (entryRows || []).forEach((e) => {
    const key = keyOf(e);
    let row = map.get(key);
    if (!row) {
      row = {
        material: e.material,
        material_description: e.material_description,
        batch: e.batch,
        plant: e.plant,
        storage_location: e.storage_location,
        base_uom: e.base_uom,
        qty_sap: 0,
        total_qty_fisik: 0,
        entries: [],
        };
      map.set(key, row);
      }
    row.total_qty_fisik += Number(e.qty_fisik) || 0;
    row.entries.push(e);
    });

  const rows = Array.from(map.values()).map((row) => {
    const selisih = row.total_qty_fisik - row.qty_sap;
    let status;
    if (row.qty_sap === 0 && row.entries.length > 0) {
      status = 'Tidak Ada di SAP';
      } else if (selisih === 0) {
      status = 'Sesuai';
      } else if (selisih > 0) {
      status = 'Lebih';
      } else {
      status = 'Kurang';
      }
    return { ...row, selisih, status };
    });

  return { rows };
}
  
