'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as XLSX from 'xlsx';
import { supabase } from '../../../../../../lib/supabaseClient';

// Deliberately minimal — just warehouse_code -> rack_code. This powers the
// "Pilih Warehouse" step at the top of the Rimpilan Input accordion.
const COLUMN_MAP = {
  warehouse_code: ['warehouse_code', 'warehouse code', 'warehouse', 'gudang'],
  rack_code: ['rack_code', 'rack code', 'rack', 'rak'],
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

export default function UploadWarehouseRacksPage() {
  const { id } = useParams();
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);
  const [uploadResult, setUploadResult] = useState(null);

  const [totalCount, setTotalCount] = useState(0);
  const [rows, setRows] = useState([]);
  const [manageMessage, setManageMessage] = useState(null);
  const [deletingAll, setDeletingAll] = useState(false);

  useEffect(() => {
    loadRows();
  }, [id]);

  async function loadRows() {
    const { data, count } = await supabase
      .from('warehouse_racks')
      .select('*', { count: 'exact' })
      .eq('session_id', id)
      .order('warehouse_code')
      .order('rack_code')
      .limit(200);
    setRows(data || []);
    setTotalCount(count || 0);
  }

  async function handleDeleteRow(row) {
    if (!confirm(`Hapus rak "${row.rack_code}" dari gudang "${row.warehouse_code}"?`)) return;
    const { error } = await supabase.from('warehouse_racks').delete().eq('id', row.id);
    if (error) {
      setManageMessage({ type: 'error', text: error.message });
      return;
    }
    setManageMessage({ type: 'success', text: 'Baris berhasil dihapus.' });
    loadRows();
  }

  async function handleDeleteAll() {
    if (!confirm(`Hapus SEMUA ${totalCount} mapping rak di session ini?`)) return;
    setDeletingAll(true);
    const { error } = await supabase.from('warehouse_racks').delete().eq('session_id', id);
    setDeletingAll(false);
    if (error) {
      setManageMessage({ type: 'error', text: error.message });
      return;
    }
    setManageMessage({ type: 'success', text: 'Semua mapping rak sudah dihapus.' });
    loadRows();
  }

  async function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setParsing(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rowsRaw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

      if (rowsRaw.length < 2) throw new Error('File kosong atau tidak memiliki data.');

      const header = rowsRaw[0].map(normalizeHeader);
      const headerIndex = {};
      header.forEach((h, i) => {
        headerIndex[h] = i;
      });

      const missing = Object.entries(COLUMN_MAP)
        .filter(([, aliases]) => !aliases.some((a) => headerIndex[a] !== undefined))
        .map(([field]) => field);
      if (missing.length) {
        throw new Error(`Kolom wajib tidak ditemukan: ${missing.join(', ')} (warehouse_code, rack_code)`);
      }

      const rawRows = rowsRaw
        .slice(1)
        .filter((r) => r.some((cell) => String(cell).trim() !== ''))
        .map((r) => mapRow(r, headerIndex));

      const seen = new Set();
      const valid = [];
      const invalid = [];
      for (const r of rawRows) {
        const warehouseCode = String(r.warehouse_code || '').trim();
        const rackCode = String(r.rack_code || '').trim();
        if (!warehouseCode || !rackCode) {
          invalid.push({ ...r, reason: 'warehouse_code atau rack_code kosong' });
          continue;
        }
        const key = `${warehouseCode}__${rackCode}`;
        if (seen.has(key)) continue; // silently dedupe within the file
        seen.add(key);
        valid.push({ warehouse_code: warehouseCode, rack_code: rackCode });
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
  }

  async function handleUpload() {
    if (parsedRows.length === 0) return;
    setUploading(true);
    setError(null);
    setUploadResult(null);
    try {
      // upsert on (session_id, warehouse_code, rack_code) so re-uploading
      // the same/updated file is idempotent instead of erroring on the
      // unique constraint or creating duplicates.
      const rowsToInsert = parsedRows.map((r) => ({ session_id: id, ...r }));
      const { error } = await supabase
        .from('warehouse_racks')
        .upsert(rowsToInsert, { onConflict: 'session_id,warehouse_code,rack_code' });
      if (error) throw new Error(error.message);
      setUploadResult({ ok: true, count: rowsToInsert.length });
      loadRows();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  const byWarehouse = rows.reduce((acc, r) => {
    (acc[r.warehouse_code] ||= []).push(r);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link href={`/admin/sessions/${id}`} className="text-xs text-ink/50 hover:text-ink">← Kembali</Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Upload Warehouse Racks</h1>
        <p className="mt-1 text-sm text-ink/60">
          CSV/Excel dengan 2 kolom: <span className="font-mono">warehouse_code</span>,{' '}
          <span className="font-mono">rack_code</span>. Mapping ini dipakai di halaman Input Rimpilan
          untuk menu "Pilih Warehouse" — otomatis terhubung ke session ini.
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
          <div className="font-medium text-warn">{invalidRows.length} baris dilewati karena tidak valid</div>
          <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs text-ink/60">
            {invalidRows.slice(0, 20).map((r, i) => (
              <li key={i}>{r.warehouse_code || '(kosong)'} / {r.rack_code || '(kosong)'} — {r.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {parsedRows.length > 0 && (
        <div className="card p-5">
          <div className="mb-3 text-sm font-medium">Preview ({parsedRows.length} mapping unik)</div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-ink/50">
                <th className="pb-2 pr-3">Warehouse</th>
                <th className="pb-2 pr-3">Rack</th>
              </tr>
            </thead>
            <tbody>
              {parsedRows.slice(0, 10).map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-mono">{r.warehouse_code}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.rack_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={handleUpload} disabled={uploading} className="btn-primary mt-4">
            {uploading ? 'Menyimpan...' : `Simpan ${parsedRows.length} Mapping`}
          </button>
          {uploadResult?.ok && (
            <div className="mt-3 rounded-lg border border-good/30 bg-good/5 p-3 text-sm text-good">
              ✓ {uploadResult.count} mapping tersimpan (baris yang sudah ada otomatis diperbarui).
            </div>
          )}
        </div>
      )}

      <div className="border-t border-line pt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Mapping Saat Ini ({totalCount})</h2>
          {totalCount > 0 && (
            <button onClick={handleDeleteAll} disabled={deletingAll} className="btn-danger">
              {deletingAll ? 'Menghapus...' : 'Hapus Semua'}
            </button>
          )}
        </div>

        {manageMessage && (
          <div className={`card mb-4 p-3 text-sm ${manageMessage.type === 'error' ? 'border-bad/30 bg-bad/5 text-bad' : 'border-good/30 bg-good/5 text-good'}`}>
            {manageMessage.text}
          </div>
        )}

        {Object.keys(byWarehouse).length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink/40">Belum ada mapping rak di session ini.</div>
        ) : (
          <div className="space-y-4">
            {Object.entries(byWarehouse).map(([warehouse, list]) => (
              <div key={warehouse} className="card p-4">
                <div className="mb-2 text-sm font-medium">{warehouse} <span className="text-ink/40">({list.length} rak)</span></div>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((r) => (
                    <span key={r.id} className="group inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1 text-xs font-mono">
                      {r.rack_code}
                      <button onClick={() => handleDeleteRow(r)} className="text-ink/30 hover:text-bad">✕</button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
