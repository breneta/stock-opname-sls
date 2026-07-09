import * as XLSX from 'xlsx';

export function exportMaterialsToExcel(materials) {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(
    materials.map((m) => ({
      'Kode Material': m.kode_material,
      'Nama Material': m.nama_material,
      RDC: m.plant,
      'Nomor Rak': m.nomor_rak,
      Batch: m.batch,
      Satuan: m.satuan,
      Stok: m.stok,
      Keterangan: m.keterangan,
    }))
  );
  XLSX.utils.book_append_sheet(wb, sheet, 'Master Material');
  XLSX.writeFile(wb, `Master_Material_Rimpilan_${dateStamp()}.xlsx`);
}

export function exportRiwayatToExcel(tx) {
  const wb = XLSX.utils.book_new();

  const masuk = tx.filter((t) => t.tipe === 'masuk');
  const keluar = tx.filter((t) => t.tipe === 'keluar');

  const toRows = (rows) =>
    rows.map((t) => ({
      Tanggal: new Date(t.tanggal).toLocaleDateString('id-ID'),
      Jam: new Date(t.created_at).toLocaleTimeString('id-ID'),
      RDC: t.mr_materials?.plant,
      'Kode Material': t.mr_materials?.kode_material,
      'Nama Material': t.mr_materials?.nama_material,
      Qty: t.qty,
      Satuan: t.mr_materials?.satuan,
      Keterangan: t.keterangan,
    }));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(masuk)), 'Barang Masuk');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(keluar)), 'Barang Keluar');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(tx)), 'Riwayat Transaksi');

  XLSX.writeFile(wb, `Riwayat_Material_Rimpilan_${dateStamp()}.xlsx`);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
