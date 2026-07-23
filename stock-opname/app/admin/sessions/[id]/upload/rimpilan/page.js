'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { supabase } from '../../../../../../lib/supabaseClient';
import { PLANTS, resolvePlant } from '../../../../../../lib/plants';
import { downloadRimpilanTemplate } from '../../../../../../lib/rimpilanTemplate';

// Same template shape as the Normal SO SAP upload, plus Nomor Rak — that's
// what lets the Rimpilan Input page group materials into the per-rak
// accordion without petugas having to type anything. Level is NOT part of
// master data on purpose — a rimpilan pile's shelf level can change between
// counts, so petugas picks it fresh every time on the Input page instead.
const COLUMN_MAP = {
  material: ['material'],
  batch: ['batch'],
  base_uom: ['base unit of measure', 'base uom', 'uom'],
  plant: ['plant'],
  storage_location: ['storage location'],
  material_description: ['material description'],
  qty: ['qty'],
  nomor_rak: ['nomor rak', 'rak', 'rack code', 'rack'],
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

export default function UploadRimpilanMasterPage() {
  const { id } = useParams();
  const router = useRouter();
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);
  const [uploadMode, setUploadMode] = useState('tambah'); // tambah | ganti
  const [uploadResult, setUploadResult] = useState(null);

  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [manageMessage, setManageMessage] = useState(null);
  const [deletingAll, setDeletingAll] = useState(false);

  useEffect(() => {
    loadRows();
  }, [id]);

  async function loadRows(searchTerm = '') {
    setRowsLoading(true);
    const { count } = await supabase
      .from('rimpilan_sap_data')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', id);
    setTotalCount(count || 0);

    let query = supabase.from('rimpilan_sap_data').select('*').eq('session_id', id).order('material_code').limit(50);
    if (searchTerm.trim()) query = query.ilike('material_code', `%${searchTerm.trim()}%`);
    const { data } = await query;
    setRows(data || []);
    setRowsLoading(false);
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    loadRows(search);
  }

  async function handleDeleteRow(row) {
    if (!confirm(`Hapus baris Material "${row.material_code}" (Rak ${row.nomor_rak})?`)) return;
    const { error } = await supabase.from('rimpilan_sap_data').delete().eq('id', row.id);
    if (error) {
      setManageMessage({ type: 'error', text: error.message });
      return;
    }
    setManageMessage({ type: 'success', text: 'Baris berhasil dihapus.' });
    loadRows(search);
  }

  async function handleDeleteAll() {
    if (!confirm(`Hapus SEMUA ${totalCount} baris Data Master Rimpilan di session ini? Tindakan ini tidak bisa dibatalkan.`)) return;
    if (!confirm('Konfirmasi sekali lagi — semua Data Master Rimpilan session ini akan hilang. Lanjutkan?')) return;
    setDeletingAll(true);
    const { error } = await supabase.from('rimpilan_sap_data').delete().eq('session_id', id);
    setDeletingAll(false);
    if (error) {
      setManageMessage({ type: 'error', text: error.message });
      return;
    }
    setManageMessage({ type: 'success', text: 'Semua Data Master Rimpilan di session ini sudah dihapus. Silakan upload ulang.' });
    loadRows('');
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

      // Material Description opsional. Sisanya wajib, termasuk Nomor Rak.
      const requiredFields = ['material', 'batch', 'base_uom', 'plant', 'storage_location', 'qty', 'nomor_rak'];
      const missing = requiredFields.filter(
        (field) => !COLUMN_MAP[field].some((a) => headerIndex[a] !== undefined)
      );
      if (missing.length) {
        throw new Error(`Kolom wajib tidak ditemukan: ${missing.map((f) => COLUMN_MAP[f][0]).join(', ')}`);
      }

      const rawRows = rowsRaw
        .slice(1)
        .filter((r) => r.some((cell) => String(cell).trim() !== ''))
        .map((r) => mapRow(r, headerIndex));

      const valid = [];
      const invalid = [];
      for (const r of rawRows) {
        const material = String(r.material || '').trim();
        const plant = resolvePlant(r.plant);
        const nomorRak = String(r.nomor_rak || '').trim();

        if (!material) {
          invalid.push({ ...r, reason: 'Kolom Material kosong' });
          continue;
        }
        if (!plant) {
          invalid.push({ ...r, reason: `Plant "${r.plant}" tidak dikenali` });
          continue;
        }
        if (!nomorRak) {
          invalid.push({ ...r, reason: 'Kolom Nomor Rak kosong' });
          continue;
        }

        valid.push({
          material_code: material,
          batch: String(r.batch || '').trim(),
          base_uom: String(r.base_uom || '').trim(),
          plant,
          storage_location: String(r.storage_location || '').trim(),
          material_description: String(r.material_description || '').trim() || material,
          qty: Number(r.qty) || 0,
          nomor_rak: nomorRak,
        });
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
    if (uploadMode === 'ganti' && totalCount > 0) {
      if (!confirm(`Hapus ${totalCount} baris Data Master Rimpilan lama dan ganti dengan ${parsedRows.length} baris baru?`)) return;
    }
    setUploading(true);
    setProgress(0);
    setError(null);
    setUploadResult(null);

    const chunkSize = 500;
    const rowsToInsert = parsedRows.map((r) => ({ session_id: id, ...r }));
    let inserted = 0;
    const failedChunks = [];

    try {
      if (uploadMode === 'ganti' && totalCount > 0) {
        const { error: delError } = await supabase.from('rimpilan_sap_data').delete().eq('session_id', id);
        if (delError) throw new Error(delError.message);
      }

      const baseCountBefore = uploadMode === 'ganti' ? 0 : totalCount;

      for (let i = 0; i < rowsToInsert.length; i += chunkSize) {
        const chunk = rowsToInsert.slice(i, i + chunkSize);
        let chunkError = null;

        for (let attempt = 1; attempt <= 2; attempt++) {
          const { error } = await supabase.from('rimpilan_sap_data').insert(chunk);
          if (!error) {
            chunkError = null;
            break;
          }
          chunkError = error;
        }

        if (chunkError) {
          failedChunks.push({ from: i + 1, to: i + chunk.length, message: chunkError.message });
        } else {
          inserted += chunk.length;
        }
        setProgress(Math.round(((i + chunk.length) / rowsToInsert.length) * 100));
      }

      const { count: actualCount } = await supabase
        .from('rimpilan_sap_data')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', id);

      const expectedCount = baseCountBefore + rowsToInsert.length;

      if (failedChunks.length > 0 || actualCount !== expectedCount) {
        setUploadResult({ ok: false, inserted, attempted: rowsToInsert.length, actualCount, expectedCount, failedChunks });
      } else {
        setUploadResult({ ok: true, inserted, attempted: rowsToInsert.length, actualCount, expectedCount });
        setTimeout(() => router.push(`/admin/sessions/${id}`), 1200);
      }
      loadRows(search);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link href={`/admin/sessions/${id}`} className="text-xs text-ink/50 hover:text-ink">← Kembali</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Upload Data Master Rimpilan</h1>
          <button onClick={downloadRimpilanTemplate} className="btn-ghost shrink-0">Download Template</button>
        </div>
        <p className="mt-1 text-sm text-ink/60">
          Template sama seperti Data SAP Normal, ditambah kolom Nomor Rak. Kolom wajib: Material, Batch,
          Base Unit of Measure, Plant, Storage Location, Qty, Nomor Rak. Material Description opsional.
          Level TIDAK ada di sini — dipilih petugas sendiri saat input, karena bisa berubah tiap hitung.
        </p>
      </div>

      <div className="card p-5">
        <label className="label-field">File Master Rimpilan</label>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-850 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
        />
        {parsing && <div className="mt-3 text-sm text-ink/50">Membaca file...</div>}
        {error && <div className="mt-3 text-sm text-bad">{error}</div>}
        <p className="mt-3 text-xs text-ink/40">
          Kolom Plant menerima nama RDC ({PLANTS.join(', ')}) atau kode Plant SAP.
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

      {parsedRows.length > 0 && (
        <div className="card overflow-x-auto p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium">Preview ({parsedRows.length} baris valid)</span>
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-ink/50">
                <th className="pb-2 pr-3">Material</th>
                <th className="pb-2 pr-3">Rak</th>
                <th className="pb-2 pr-3">Plant</th>
                <th className="pb-2 pr-3">UoM</th>
                <th className="pb-2 pr-3">Qty</th>
              </tr>
            </thead>
            <tbody>
              {parsedRows.slice(0, 8).map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-mono">{r.material_code}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.nomor_rak}</td>
                  <td className="py-1.5 pr-3">{r.plant}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.base_uom}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalCount > 0 && (
            <div className="mt-4 rounded-lg border border-warn/30 bg-warn/5 p-4">
              <div className="mb-2 text-sm font-medium text-warn">
                Session ini sudah punya {totalCount} baris Data Master Rimpilan.
              </div>
              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-2">
                  <input type="radio" name="uploadMode" checked={uploadMode === 'tambah'} onChange={() => setUploadMode('tambah')} className="mt-0.5" />
                  <span><span className="font-medium">Tambahkan</span> — digabung dengan data yang sudah ada.</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="uploadMode" checked={uploadMode === 'ganti'} onChange={() => setUploadMode('ganti')} className="mt-0.5" />
                  <span><span className="font-medium">Ganti semua</span> — hapus {totalCount} baris lama, ganti total dengan file ini.</span>
                </label>
              </div>
            </div>
          )}

          {uploading && (
            <div className="mt-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-slate-850 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-1 text-xs text-ink/50">{progress}%</div>
            </div>
          )}

          <button onClick={handleUpload} disabled={uploading} className="btn-primary mt-4">
            {uploading
              ? (uploadMode === 'ganti' && totalCount > 0 ? 'Mengganti data...' : 'Mengunggah...')
              : uploadMode === 'ganti' && totalCount > 0
                ? `Hapus ${totalCount} Baris Lama & Simpan ${parsedRows.length} Baris Baru`
                : `Simpan ${parsedRows.length} Baris ke Session`}
          </button>

          {uploadResult && (
            <div className={`mt-4 rounded-lg border p-4 text-sm ${uploadResult.ok ? 'border-good/30 bg-good/5 text-good' : 'border-bad/30 bg-bad/5 text-bad'}`}>
              {uploadResult.ok ? (
                <div>✓ {uploadResult.inserted} dari {uploadResult.attempted} baris berhasil disimpan. Mengarahkan ke dashboard...</div>
              ) : (
                <div>
                  <div className="font-medium">⚠ Upload tidak lengkap — {uploadResult.inserted} dari {uploadResult.attempted} baris berhasil disimpan.</div>
                  {uploadResult.failedChunks?.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs">
                      {uploadResult.failedChunks.map((f, i) => (
                        <li key={i}>Baris {f.from}–{f.to}: {f.message}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-line pt-6">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Kelola Data Master Rimpilan</h2>
          {totalCount > 0 && (
            <button onClick={handleDeleteAll} disabled={deletingAll} className="btn-danger">
              {deletingAll ? 'Menghapus...' : `Hapus Semua (${totalCount})`}
            </button>
          )}
        </div>

        {manageMessage && (
          <div className={`card mb-4 p-3 text-sm ${manageMessage.type === 'error' ? 'border-bad/30 bg-bad/5 text-bad' : 'border-good/30 bg-good/5 text-good'}`}>
            {manageMessage.text}
          </div>
        )}

        <form onSubmit={handleSearchSubmit} className="mb-3 flex gap-2">
          <input className="input-field font-mono" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari Material Code..." />
          <button type="submit" className="btn-ghost shrink-0">Cari</button>
        </form>

        <div className="card overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-paper text-ink/50">
              <tr>
                <th className="px-3 py-2">Material</th>
                <th className="px-3 py-2">Rak</th>
                <th className="px-3 py-2">Plant</th>
                <th className="px-3 py-2">UoM</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2 font-mono">{r.material_code}</td>
                  <td className="px-3 py-2 font-mono">{r.nomor_rak}</td>
                  <td className="px-3 py-2">{r.plant}</td>
                  <td className="px-3 py-2 font-mono">{r.base_uom}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.qty}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => handleDeleteRow(r)} className="btn-danger">Hapus</button>
                  </td>
                </tr>
              ))}
              {!rowsLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-ink/40">
                  {search ? 'Tidak ada Material yang cocok.' : 'Belum ada Data Master Rimpilan di session ini.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {!search && totalCount > 50 && (
          <p className="mt-2 text-xs text-ink/40">Menampilkan 50 dari {totalCount} baris — gunakan pencarian untuk baris lainnya.</p>
        )}
      </div>
    </div>
  );
}
