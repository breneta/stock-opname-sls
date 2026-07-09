'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { supabase } from '../../../lib/supabaseClient';
import { PLANTS, resolvePlant } from '../../../lib/plants';

const COLUMN_MAP = {
  material: ['material', 'kode material', 'kode'],
  batch: ['batch'],
  plant: ['rdc', 'plant', 'lokasi'],
  qty: ['qty', 'stok awal', 'stok'],
  base_uom: ['base unit of measure', 'base uom', 'satuan', 'uom'],
  nomor_rak: ['location', 'location (rak)', 'nomor rak', 'rak'],
  nama_material: ['nama material', 'nama', 'material description'],
  keterangan: ['keterangan'],
};

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase();
}

function mapRow(rawRow, headerIndex) {
  const out = {};
  for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
    for (const alias of aliases) {
      if (headerIndex[alias] !== undefined) {
        out[field] = rawRow[headerIndex[alias]];
        break;
      }
    }
  }
  return out;
}

export default function UploadMaterialsPage() {
  const router = useRouter();
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);

  async function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setParsing(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      if (raw.length < 2) throw new Error('File kosong atau tidak memiliki data.');

      const header = raw[0].map(normalizeHeader);
      const headerIndex = {};
      header.forEach((h, i) => { headerIndex[h] = i; });

      const requiredFields = ['material', 'plant', 'base_uom'];
      const missing = requiredFields.filter(
        (field) => !COLUMN_MAP[field].some((a) => headerIndex[a] !== undefined)
      );
      if (missing.length) {
        throw new Error(`Kolom wajib tidak ditemukan: ${missing.map((f) => COLUMN_MAP[f][0]).join(', ')}`);
      }

      const dataRows = raw
        .slice(1)
        .filter((r) => r.some((cell) => String(cell).trim() !== ''))
        .map((r) => mapRow(r, headerIndex));

      const valid = [];
      const invalid = [];
      for (const r of dataRows) {
        const plant = resolvePlant(r.plant);
        const material = String(r.material || '').trim();
        const satuan = String(r.base_uom || '').trim();
        if (!material || !satuan || !plant) {
          invalid.push({ ...r, reason: !plant ? `RDC/kode Plant "${r.plant}" tidak dikenali` : 'Ada kolom wajib kosong' });
          continue;
        }
        valid.push({
          kode_material: material,
          nama_material: String(r.nama_material || '').trim() || material,
          batch: String(r.batch || '').trim() || null,
          plant,
          satuan,
          nomor_rak: String(r.nomor_rak || '').trim() || null,
          keterangan: String(r.keterangan || '').trim() || null,
          stok_awal: Number(r.qty) || 0,
        });
      }

      setRows(valid);
      setInvalidRows(invalid);
    } catch (err) {
      setError(err.message);
      setRows([]);
      setInvalidRows([]);
    } finally {
      setParsing(false);
    }
  }

  async function handleUpload() {
    if (rows.length === 0) return;
    setUploading(true);
    setProgress(0);
    setError(null);

    try {
      // Look up which (kode_material, plant) combos already exist so we
      // never clobber a stok value that's been building up from transactions.
      const { data: existing, error: fetchError } = await supabase
        .from('mr_materials')
        .select('id, kode_material, plant');
      if (fetchError) throw new Error(fetchError.message);

      const existingMap = new Map((existing || []).map((m) => [`${m.kode_material}__${m.plant}`, m.id]));

      const toInsert = [];
      const toUpdate = [];
      for (const r of rows) {
        const key = `${r.kode_material}__${r.plant}`;
        if (existingMap.has(key)) {
          toUpdate.push({ id: existingMap.get(key), ...r });
        } else {
          toInsert.push(r);
        }
      }

      let done = 0;
      const total = toInsert.length + toUpdate.length;

      const chunkSize = 500;
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize).map((r) => ({
          kode_material: r.kode_material,
          nama_material: r.nama_material,
          satuan: r.satuan,
          plant: r.plant,
          nomor_rak: r.nomor_rak,
          batch: r.batch,
          keterangan: r.keterangan,
          stok: r.stok_awal,
        }));
        const { error } = await supabase.from('mr_materials').insert(chunk);
        if (error) throw new Error(error.message);
        done += chunk.length;
        setProgress(Math.round((done / total) * 100));
      }

      // Updates go one at a time (stok is intentionally excluded so
      // existing transaction-driven stock is never overwritten).
      for (const r of toUpdate) {
        const { error } = await supabase
          .from('mr_materials')
          .update({
            nama_material: r.nama_material,
            satuan: r.satuan,
            nomor_rak: r.nomor_rak,
            batch: r.batch,
            keterangan: r.keterangan,
          })
          .eq('id', r.id);
        if (error) throw new Error(error.message);
        done += 1;
        setProgress(Math.round((done / total) * 100));
      }

      router.push('/materials');
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link href="/materials" className="text-xs text-ink/50 hover:text-ink">← Master Material</Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Upload Data Master Material</h1>
        <p className="mt-1 text-sm text-ink/60">
          Upload file .xlsx / .csv. Kolom wajib: Material, RDC (nama atau kode SAP seperti
          D104), Base Unit of Measure. Opsional: Batch, Qty, Location (Rak), Nama Material.
        </p>
      </div>

      <div className="card p-5">
        <label className="label-field">File</label>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-850 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
        />
        {parsing && <div className="mt-3 text-sm text-ink/50">Membaca file...</div>}
        {error && <div className="mt-3 text-sm text-bad">{error}</div>}
        <p className="mt-3 text-xs text-ink/40">
          Kolom RDC menerima nama ({PLANTS.join(', ')}) atau kode Plant SAP (D104=Jakarta,
          D105=Surabaya, D106=Semarang, D107=Denpasar, D108=Palembang).
        </p>
      </div>

      {invalidRows.length > 0 && (
        <div className="card border-warn/30 bg-warn/5 p-4 text-sm">
          <div className="font-medium text-warn">{invalidRows.length} baris dilewati karena tidak valid</div>
          <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs text-ink/60">
            {invalidRows.slice(0, 20).map((r, i) => (
              <li key={i}>{r.material || '(kosong)'} — {r.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card overflow-x-auto p-5">
          <div className="mb-3 text-sm font-medium">Preview ({rows.length} baris valid)</div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-ink/50">
                <th className="pb-2 pr-3">Material</th>
                <th className="pb-2 pr-3">Batch</th>
                <th className="pb-2 pr-3">RDC</th>
                <th className="pb-2 pr-3">Rak</th>
                <th className="pb-2 pr-3">Satuan</th>
                <th className="pb-2 pr-3">Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-mono">{r.kode_material}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.batch}</td>
                  <td className="py-1.5 pr-3">{r.plant}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.nomor_rak}</td>
                  <td className="py-1.5 pr-3">{r.satuan}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.stok_awal}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {uploading && (
            <div className="mt-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-teal transition-all" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-1 text-xs text-ink/50">{progress}%</div>
            </div>
          )}

          <button onClick={handleUpload} disabled={uploading} className="btn-teal mt-4">
            {uploading ? 'Mengunggah...' : `Simpan ${rows.length} Baris`}
          </button>
        </div>
      )}
    </div>
  );
}
