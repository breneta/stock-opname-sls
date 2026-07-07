'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { supabase } from '../../../../lib/supabaseClient';

const COLUMN_MAP = {
  material: ['material'],
  batch: ['batch'],
  base_uom: ['base unit of measure', 'base uom', 'uom'],
  plant: ['plant'],
  storage_location: ['storage location'],
  material_description: ['material description'],
  material_group: ['material group'],
  qty: ['qty'],
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

export default function UploadSapPage() {
  const { id } = useParams();
  const router = useRouter();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);

  async function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError(null);
    setParsing(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

      if (rows.length < 2) throw new Error('File kosong atau tidak memiliki data.');

      const header = rows[0].map(normalizeHeader);
      const headerIndex = {};
      header.forEach((h, i) => {
        headerIndex[h] = i;
      });

      const missing = [];
      for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
        const found = aliases.some((a) => headerIndex[a] !== undefined);
        if (!found) missing.push(aliases[0]);
      }
      if (missing.length) {
        throw new Error(`Kolom berikut tidak ditemukan di file: ${missing.join(', ')}`);
      }

      const dataRows = rows
        .slice(1)
        .filter((r) => r.some((cell) => String(cell).trim() !== ''))
        .map((r) => mapRow(r, headerIndex));

      setParsedRows(dataRows);
      setPreview(dataRows.slice(0, 8));
    } catch (err) {
      setError(err.message);
      setParsedRows([]);
      setPreview([]);
    } finally {
      setParsing(false);
    }
  }

  async function handleUpload() {
    if (parsedRows.length === 0) return;
    setUploading(true);
    setProgress(0);
    setError(null);

    const chunkSize = 500;
    const rowsToInsert = parsedRows.map((r) => ({
      session_id: id,
      material: String(r.material || '').trim(),
      batch: String(r.batch || '').trim(),
      base_uom: String(r.base_uom || '').trim(),
      plant: String(r.plant || '').trim(),
      storage_location: String(r.storage_location || '').trim(),
      material_description: String(r.material_description || '').trim(),
      material_group: String(r.material_group || '').trim(),
      qty: Number(r.qty) || 0,
    }));

    try {
      for (let i = 0; i < rowsToInsert.length; i += chunkSize) {
        const chunk = rowsToInsert.slice(i, i + chunkSize);
        const { error } = await supabase.from('so_sap_data').insert(chunk);
        if (error) throw new Error(error.message);
        setProgress(Math.round(((i + chunk.length) / rowsToInsert.length) * 100));
      }
      router.push(`/sessions/${id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link href={`/sessions/${id}`} className="text-xs text-ink/50 hover:text-ink">← Kembali</Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Upload Data SAP</h1>
        <p className="mt-1 text-sm text-ink/60">
          Upload file hasil export SAP (.xlsx / .csv). Kolom wajib: Material, Batch, Base Unit of
          Measure, Plant, Storage Location, Material Description, Material Group, Qty.
        </p>
      </div>

      <div className="card p-5">
        <label className="label-field">File SAP</label>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-850 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
        />
        {parsing && <div className="mt-3 text-sm text-ink/50">Membaca file...</div>}
        {error && <div className="mt-3 text-sm text-bad">{error}</div>}
      </div>

      {preview.length > 0 && (
        <div className="card overflow-x-auto p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium">
              Preview ({parsedRows.length} baris terdeteksi)
            </span>
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-ink/50">
                <th className="pb-2 pr-3">Material</th>
                <th className="pb-2 pr-3">Batch</th>
                <th className="pb-2 pr-3">Plant</th>
                <th className="pb-2 pr-3">Storage Loc.</th>
                <th className="pb-2 pr-3">Description</th>
                <th className="pb-2 pr-3">Qty</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-mono">{r.material}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.batch}</td>
                  <td className="py-1.5 pr-3">{r.plant}</td>
                  <td className="py-1.5 pr-3">{r.storage_location}</td>
                  <td className="py-1.5 pr-3">{r.material_description}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {uploading && (
            <div className="mt-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-slate-850 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-1 text-xs text-ink/50">{progress}%</div>
            </div>
          )}

          <button onClick={handleUpload} disabled={uploading} className="btn-primary mt-4">
            {uploading ? 'Mengunggah...' : `Simpan ${parsedRows.length} Baris ke Session`}
          </button>
        </div>
      )}
    </div>
  );
}
