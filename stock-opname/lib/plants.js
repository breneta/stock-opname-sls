// Lima RDC PT Satya Langgeng Sentosa. Ubah di sini kalau ada
// penambahan/pengurangan lokasi — dipakai di seluruh app.
export const PLANTS = [
  'RDC Jakarta',
  'RDC Surabaya',
  'RDC Semarang',
  'RDC Denpasar',
  'RDC Palembang',
];

// Kode Plant SAP -> nama RDC. Dipakai supaya kolom Plant di file
// export SAP (isinya kode kayak "D104") otomatis diterjemahkan,
// operator/Accounting tidak perlu translate manual tiap upload.
export const PLANT_CODES = {
  D104: 'RDC Jakarta',
  D105: 'RDC Surabaya',
  D106: 'RDC Semarang',
  D107: 'RDC Denpasar',
  D108: 'RDC Palembang',
};

// Menerima nama RDC ("RDC Jakarta"), kode SAP ("D104"), atau
// variasi penulisan (case-insensitive, spasi longgar) lalu
// mengembalikan nama RDC baku — atau null kalau tidak dikenali.
export function resolvePlant(value) {
  const v = String(value || '').trim();
  if (!v) return null;

  const byCode = PLANT_CODES[v.toUpperCase()];
  if (byCode) return byCode;

  const byName = PLANTS.find((p) => p.toLowerCase() === v.toLowerCase());
  if (byName) return byName;

  return null;
}
