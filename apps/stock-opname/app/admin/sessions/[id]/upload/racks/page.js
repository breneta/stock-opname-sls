'use client';

// Upload Warehouse Racks — CSV/XLSX sederhana warehouse_code, rack_code.
// Auto-link ke session_id. Dipakai sebagai daftar Warehouse yang muncul
// di dropdown pertama halaman input Rimpilan.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as XLSX from 'xlsx';
import { supabase } from '../../../../../../lib/supabaseClient';

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase();
}

export default function UploadWarehouseRacksPage() {
  const { id } = useParams();
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);
  const [existing, setExisting] = useState([]);
  const [uploadResult, setUploadResult] = useState(null);

  useEffect(() => {
    loadExisting();
  }, [id]);

  async function loadExisting() {
    const { data } = await supabase
      .from('warehouse_racks')
      .select('*')
      .eq('session_id', id)
      .order('warehouse_code')
      .order('rack_code');
    setExisting(data || []);
  }

  function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setParsing(true);
    setUploadResult(null);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
        if (rows.length < 2) throw new Error('File kosong atau tidak memiliki data.');

        const header = rows[0].map(normalizeHeader);
        const idxWarehouse = header.findIndex((h) => ['warehouse_code', 'warehouse', 'gudang'].includes(h));
        const idxRack = header.findIndex((h) => ['rack_code', 'rak', 'nomor rak'].includes(h));

        if (idxWarehouse === -1 || idxRack === -1) {
          throw new Error('Kolom wajib tidak ditemukan: warehouse_code, rack_code.');
        }

        const valid = [];
        const invalid = [];
        for (const r of rows.slice(1)) {
          if (!r.some((c) => String(c).trim() !== '')) continue;
          const warehouse_code = String(r[idxWarehouse] || '').trim();
          const rack_code = String(r[idxRack] || '').trim();
          if (!warehouse_code || !rack_code) {
            invalid.push({ warehouse_code, rack_code, reason: 'warehouse_code atau rack_code kosong' });
            continue;
          }
          valid.push({ warehouse_code, rack_code });
        }
        setParsedRows(valid);
        setInvalidRows(invalid);
      } catch (err) {
        setError(err.message);
        setParsedRows([]);
        setInvalidRows([]);
      } finally {
        setParsing(false);
      }
    };
    reader.readAsArrayBuffer(f);
  }

  async function handleUpload() {
    if (parsedRows.length === 0) return;
    setUploading(true);
    setError(null);
    setUploadResult(null);
    try {
      // upsert on (session_id, warehouse_code, rack_code) unique index —
      // re-uploading the same file is idempotent instead of duplicating rows.
      const rows = parsedRows.map((r) => ({ session_id: id, ...r }));
      const { error } = await supabase
        .from('warehouse_racks')
        .upsert(rows, { onConflict: 'session_id,warehouse_code,rack_code' });
      if (error) throw new Error(error.message);
      setUploadResult({ ok: true, count: rows.length });
      loadExisting();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteAll() {
    if (!confirm(`Hapus semua ${existing.length} mapping rak di session ini?`)) return;
    await supabase.from('warehouse_racks').delete().eq('session_id', id);
    loadExisting();
  }

  const grouped = existing.reduce((acc, r) => {
    (acc[r.warehouse_code] ||= []).push(r.rack_code);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link href={`/admin/sessions/${id}`} className="text-xs text-ink/50 hover:text-ink">← Kembali</Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Upload Warehouse Racks</h1>
        <p className="mt-1 text-sm text-ink/60">
          CSV/XLSX dengan 2 kolom: <code>warehouse_code</code>, <code>rack_code</code>. Dipakai
          sebagai daftar Warehouse pada dropdown pertama halaman Input Rimpilan.
        </p>
      </div>

      <div className="card p-5">
        <label className="label-field">File Warehouse Racks</label>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-850 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
        />
        {parsing && <div className="mt-3 text-sm text-ink/50">Membaca file...</div>}
        {error && <div className="mt-3 text-sm text-bad">{error}</div>}
      </div>

      {invalidRows.length > 0 && (
        <div className="card border-warn/30 bg-warn/5 p-4 text-sm">
          <div className="font-medium text-warn">{invalidRows.length} baris dilewati</div>
          <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs text-ink/60">
            {invalidRows.slice(0, 20).map((r, i) => (
              <li key={i}>{r.warehouse_code || '(kosong)'} / {r.rack_code || '(kosong)'} — {r.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {parsedRows.length > 0 && (
        <div className="card p-5">
          <div className="mb-3 text-sm font-medium">Preview ({parsedRows.length} baris valid)</div>
          <table className="w-full text-left text-xs">
            <thead><tr className="text-ink/50"><th className="pb-2 pr-3">Warehouse Code</th><th className="pb-2 pr-3">Rack Code</th></tr></thead>
            <tbody>
              {parsedRows.slice(0, 10).map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5 pr-3">{r.warehouse_code}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.rack_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={handleUpload} disabled={uploading} className="btn-primary mt-4">
            {uploading ? 'Menyimpan...' : `Simpan ${parsedRows.length} Mapping Rak`}
          </button>
          {uploadResult?.ok && <div className="mt-3 text-sm text-good">✓ {uploadResult.count} mapping tersimpan.</div>}
        </div>
      )}

      <div className="border-t border-line pt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Rak Terdaftar</h2>
          {existing.length > 0 && (
            <button onClick={handleDeleteAll} className="btn-danger">Hapus Semua ({existing.length})</button>
          )}
        </div>
        {Object.keys(grouped).length === 0 && (
          <div className="card p-4 text-center text-sm text-ink/40">Belum ada rak terdaftar.</div>
        )}
        {Object.entries(grouped).map(([wh, racks]) => (
          <div key={wh} className="card mb-3 p-4">
            <div className="mb-1 text-sm font-medium">{wh}</div>
            <div className="flex flex-wrap gap-1.5">
              {racks.map((r) => (
                <span key={r} className="badge bg-slate-850/10 text-ink font-mono">{r}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
