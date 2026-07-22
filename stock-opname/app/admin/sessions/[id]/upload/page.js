'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { supabase } from '../../../../../lib/supabaseClient';
import { PLANTS, resolvePlant } from '../../../../../lib/plants';

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
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);
  const [uploadMode, setUploadMode] = useState('tambah'); // tambah | ganti
  const [uploadResult, setUploadResult] = useState(null);

  // --- Kelola Data SAP (edit / delete existing rows) ---
  const [totalCount, setTotalCount] = useState(0);
  const [sapSearch, setSapSearch] = useState('');
  const [sapRows, setSapRows] = useState([]);
  const [sapLoading, setSapLoading] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [manageMessage, setManageMessage] = useState(null);
  const [deletingAll, setDeletingAll] = useState(false);

  useEffect(() => {
    loadSapRows();
  }, [id]);

  async function loadSapRows(search = '') {
    setSapLoading(true);
    const { count } = await supabase
      .from('so_sap_data')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', id);
    setTotalCount(count || 0);

    let query = supabase.from('so_sap_data').select('*').eq('session_id', id).order('material').limit(50);
    if (search.trim()) query = query.ilike('material', `%${search.trim()}%`);
    const { data } = await query;
    setSapRows(data || []);
    setSapLoading(false);
  }

  function handleSapSearchSubmit(e) {
    e.preventDefault();
    loadSapRows(sapSearch);
  }

  async function handleDeleteRow(row) {
    if (!confirm(`Hapus baris Material "${row.material}" (Batch ${row.batch})?`)) return;
    const { error } = await supabase.from('so_sap_data').delete().eq('id', row.id);
    if (error) {
      setManageMessage({ type: 'error', text: error.message });
      return;
    }
    setManageMessage({ type: 'success', text: 'Baris berhasil dihapus.' });
    loadSapRows(sapSearch);
  }

  async function handleDeleteAll() {
    if (!confirm(`Hapus SEMUA ${totalCount} baris Data SAP di session ini? Tindakan ini tidak bisa dibatalkan.`)) return;
    if (!confirm('Konfirmasi sekali lagi — semua Data SAP session ini akan hilang. Lanjutkan?')) return;
    setDeletingAll(true);
    const { error } = await supabase.from('so_sap_data').delete().eq('session_id', id);
    setDeletingAll(false);
    if (error) {
      setManageMessage({ type: 'error', text: error.message });
      return;
    }
    setManageMessage({ type: 'success', text: 'Semua Data SAP di session ini sudah dihapus. Silakan upload ulang.' });
    loadSapRows('');
  }

  function openEdit(row) {
    setEditingRow({ ...row });
    setEditError(null);
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    setEditSaving(true);
    setEditError(null);
    const plant = resolvePlant(editingRow.plant) || editingRow.plant;
    const { error } = await supabase
      .from('so_sap_data')
      .update({
        material: String(editingRow.material || '').trim(),
        batch: String(editingRow.batch || '').trim(),
        plant,
        storage_location: String(editingRow.storage_location || '').trim(),
        base_uom: String(editingRow.base_uom || '').trim(),
        material_description: String(editingRow.material_description || '').trim(),
        material_group: String(editingRow.material_group || '').trim(),
        qty: Number(editingRow.qty) || 0,
      })
      .eq('id', editingRow.id);
    setEditSaving(false);
    if (error) {
      setEditError(error.message);
      return;
    }
    setEditingRow(null);
    setManageMessage({ type: 'success', text: 'Baris berhasil diperbarui.' });
    loadSapRows(sapSearch);
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
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

      if (rows.length < 2) throw new Error('File kosong atau tidak memiliki data.');

      const header = rows[0].map(normalizeHeader);
      const headerIndex = {};
      header.forEach((h, i) => {
        headerIndex[h] = i;
      });

      // Material Description is optional — everything else is required.
      const requiredFields = ['material', 'batch', 'base_uom', 'plant', 'storage_location', 'material_group', 'qty'];
      const missing = requiredFields.filter(
        (field) => !COLUMN_MAP[field].some((a) => headerIndex[a] !== undefined)
      );
      if (missing.length) {
        throw new Error(`Kolom wajib tidak ditemukan: ${missing.map((f) => COLUMN_MAP[f][0]).join(', ')}`);
      }

      const rawRows = rows
        .slice(1)
        .filter((r) => r.some((cell) => String(cell).trim() !== ''))
        .map((r) => mapRow(r, headerIndex));

      const valid = [];
      const invalid = [];
      for (const r of rawRows) {
        const material = String(r.material || '').trim();
        const plant = resolvePlant(r.plant);
        if (!material || !plant) {
          invalid.push({ ...r, reason: !plant ? `Plant "${r.plant}" tidak dikenali` : 'Kolom Material kosong' });
          continue;
        }
        valid.push({
          material,
          batch: String(r.batch || '').trim(),
          base_uom: String(r.base_uom || '').trim(),
          plant,
          storage_location: String(r.storage_location || '').trim(),
          material_description: String(r.material_description || '').trim() || material,
          material_group: String(r.material_group || '').trim(),
          qty: Number(r.qty) || 0,
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
      if (!confirm(`Hapus ${totalCount} baris Data SAP lama dan ganti dengan ${parsedRows.length} baris baru?`)) return;
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
        const { error: delError } = await supabase.from('so_sap_data').delete().eq('session_id', id);
        if (delError) throw new Error(delError.message);
      }

      const baseCountBefore = uploadMode === 'ganti' ? 0 : totalCount;

      for (let i = 0; i < rowsToInsert.length; i += chunkSize) {
        const chunk = rowsToInsert.slice(i, i + chunkSize);
        let chunkError = null;

        // Try each chunk up to 2 times (transient network/timeout issues)
        // before giving up on it — and even then, keep going with the
        // remaining chunks instead of aborting the whole upload.
        for (let attempt = 1; attempt <= 2; attempt++) {
          const { error } = await supabase.from('so_sap_data').insert(chunk);
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

      // Verify against what's actually in the database now — this is the
      // real source of truth, not just what we think we sent.
      const { count: actualCount } = await supabase
        .from('so_sap_data')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', id);

      const expectedCount = baseCountBefore + rowsToInsert.length;

      if (failedChunks.length > 0 || actualCount !== expectedCount) {
        setUploadResult({
          ok: false,
          inserted,
          attempted: rowsToInsert.length,
          actualCount,
          expectedCount,
          failedChunks,
        });
      } else {
        setUploadResult({ ok: true, inserted, attempted: rowsToInsert.length, actualCount, expectedCount });
        setTimeout(() => router.push(`/admin/sessions/${id}`), 1200);
      }
      loadSapRows(sapSearch);
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
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Upload Data SAP</h1>
        <p className="mt-1 text-sm text-ink/60">
          Upload file hasil export SAP (.xlsx / .csv). Kolom wajib: Material, Batch, Base Unit of
          Measure, Plant, Storage Location, Material Group, Qty. Material Description opsional.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/admin/sessions/${id}/upload/rimpilan`} className="badge bg-amber/15 text-warn hover:bg-amber/25">
            Upload Data Rimpilan →
          </Link>
          <Link href={`/admin/sessions/${id}/upload/racks`} className="badge bg-slate-850/10 text-ink hover:bg-slate-850/20">
            Upload Warehouse Racks →
          </Link>
        </div>
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
        <p className="mt-3 text-xs text-ink/40">
          Kolom Plant menerima nama RDC ({PLANTS.join(', ')}) atau kode Plant SAP (D104=Jakarta,
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

      {parsedRows.length > 0 && (
        <div className="card overflow-x-auto p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium">
              Preview ({parsedRows.length} baris valid)
            </span>
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-ink/50">
                <th className="pb-2 pr-3">Material</th>
                <th className="pb-2 pr-3">Batch</th>
                <th className="pb-2 pr-3">Plant</th>
                <th className="pb-2 pr-3">Storage Loc.</th>
                <th className="pb-2 pr-3">UoM</th>
                <th className="pb-2 pr-3">Description</th>
                <th className="pb-2 pr-3">Qty</th>
              </tr>
            </thead>
            <tbody>
              {parsedRows.slice(0, 8).map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-mono">{r.material}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.batch}</td>
                  <td className="py-1.5 pr-3">{r.plant}</td>
                  <td className="py-1.5 pr-3">{r.storage_location}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.base_uom}</td>
                  <td className="py-1.5 pr-3">{r.material_description}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalCount > 0 && (
            <div className="mt-4 rounded-lg border border-warn/30 bg-warn/5 p-4">
              <div className="mb-2 text-sm font-medium text-warn">
                Session ini sudah punya {totalCount} baris Data SAP.
              </div>
              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-2">
                  <input type="radio" name="uploadMode" checked={uploadMode === 'tambah'} onChange={() => setUploadMode('tambah')} className="mt-0.5" />
                  <span>
                    <span className="font-medium">Tambahkan</span> — file ini digabung dengan data yang sudah ada.
                    Pakai ini kalau file berisi material yang belum pernah di-upload.
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="uploadMode" checked={uploadMode === 'ganti'} onChange={() => setUploadMode('ganti')} className="mt-0.5" />
                  <span>
                    <span className="font-medium">Ganti semua</span> — hapus {totalCount} baris lama, ganti total dengan
                    file ini. Pakai ini kalau upload sebelumnya salah atau ini revisi ulang.
                  </span>
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
                <div>
                  ✓ {uploadResult.inserted} dari {uploadResult.attempted} baris berhasil disimpan. Total di
                  database sekarang: {uploadResult.actualCount} baris. Mengarahkan ke dashboard...
                </div>
              ) : (
                <div>
                  <div className="font-medium">
                    ⚠ Upload tidak lengkap — {uploadResult.inserted} dari {uploadResult.attempted} baris
                    berhasil disimpan.
                  </div>
                  <div className="mt-1 text-xs">
                    Total di database seharusnya {uploadResult.expectedCount} baris, tapi yang tersimpan
                    cuma {uploadResult.actualCount}. Kemungkinan koneksi terputus di tengah proses.
                  </div>
                  {uploadResult.failedChunks?.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs">
                      {uploadResult.failedChunks.map((f, i) => (
                        <li key={i}>Baris {f.from}–{f.to}: {f.message}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 font-medium">
                    Coba upload ulang file yang sama dengan mode "Tambahkan" untuk melengkapi baris yang
                    belum masuk, atau pakai "Ganti semua" untuk mulai bersih dari awal.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-line pt-6">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Kelola Data SAP</h2>
          {totalCount > 0 && (
            <button
              onClick={handleDeleteAll}
              disabled={deletingAll}
              className="btn-danger"
            >
              {deletingAll ? 'Menghapus...' : `Hapus Semua (${totalCount})`}
            </button>
          )}
        </div>
        <p className="mb-4 text-sm text-ink/60">
          Cari baris yang salah untuk diedit atau dihapus. Kalau seluruh file yang di-upload
          keliru, pakai "Hapus Semua" lalu upload ulang file yang benar.
        </p>

        {manageMessage && (
          <div className={`card mb-4 p-3 text-sm ${manageMessage.type === 'error' ? 'border-bad/30 bg-bad/5 text-bad' : 'border-good/30 bg-good/5 text-good'}`}>
            {manageMessage.text}
          </div>
        )}

        <form onSubmit={handleSapSearchSubmit} className="mb-3 flex gap-2">
          <input
            className="input-field font-mono"
            value={sapSearch}
            onChange={(e) => setSapSearch(e.target.value)}
            placeholder="Cari Material Code..."
          />
          <button type="submit" className="btn-ghost shrink-0">Cari</button>
        </form>

        <div className="card overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-paper text-ink/50">
              <tr>
                <th className="px-3 py-2">Material</th>
                <th className="px-3 py-2">Batch</th>
                <th className="px-3 py-2">Plant</th>
                <th className="px-3 py-2">Storage Loc.</th>
                <th className="px-3 py-2">UoM</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sapRows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2 font-mono">{r.material}</td>
                  <td className="px-3 py-2 font-mono">{r.batch}</td>
                  <td className="px-3 py-2">{r.plant}</td>
                  <td className="px-3 py-2">{r.storage_location}</td>
                  <td className="px-3 py-2 font-mono">{r.base_uom}</td>
                  <td className="px-3 py-2">{r.material_description}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.qty}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => openEdit(r)} className="font-medium text-slate-850 hover:underline">Edit</button>
                      <button onClick={() => handleDeleteRow(r)} className="btn-danger">Hapus</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!sapLoading && sapRows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-ink/40">
                  {sapSearch ? 'Tidak ada Material yang cocok.' : 'Belum ada Data SAP di session ini.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {!sapSearch && totalCount > 50 && (
          <p className="mt-2 text-xs text-ink/40">Menampilkan 50 dari {totalCount} baris — gunakan pencarian untuk baris lainnya.</p>
        )}
      </div>

      {editingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <form onSubmit={handleSaveEdit} className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <div className="font-medium">Edit Baris Data SAP</div>
              <button type="button" onClick={() => setEditingRow(null)} className="text-ink/40 hover:text-ink">✕</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="label-field">Material</label>
                <input className="input-field font-mono" value={editingRow.material || ''} onChange={(e) => setEditingRow({ ...editingRow, material: e.target.value })} />
              </div>
              <div>
                <label className="label-field">Material Description</label>
                <input className="input-field" value={editingRow.material_description || ''} onChange={(e) => setEditingRow({ ...editingRow, material_description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-field">Batch</label>
                  <input className="input-field font-mono" value={editingRow.batch || ''} onChange={(e) => setEditingRow({ ...editingRow, batch: e.target.value })} />
                </div>
                <div>
                  <label className="label-field">Base Unit of Measure</label>
                  <input className="input-field font-mono" value={editingRow.base_uom || ''} onChange={(e) => setEditingRow({ ...editingRow, base_uom: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label-field">Plant / RDC</label>
                <input className="input-field" value={editingRow.plant || ''} onChange={(e) => setEditingRow({ ...editingRow, plant: e.target.value })} placeholder="RDC Jakarta atau D104" />
              </div>
              <div>
                <label className="label-field">Storage Location</label>
                <input className="input-field" value={editingRow.storage_location || ''} onChange={(e) => setEditingRow({ ...editingRow, storage_location: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-field">Material Group</label>
                  <input className="input-field" value={editingRow.material_group || ''} onChange={(e) => setEditingRow({ ...editingRow, material_group: e.target.value })} />
                </div>
                <div>
                  <label className="label-field">Qty</label>
                  <input type="number" className="input-field font-mono" value={editingRow.qty ?? 0} onChange={(e) => setEditingRow({ ...editingRow, qty: e.target.value })} />
                </div>
              </div>
            </div>

            {editError && <div className="mt-3 text-sm text-bad">{editError}</div>}

            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setEditingRow(null)} className="btn-ghost flex-1">Batal</button>
              <button type="submit" disabled={editSaving} className="btn-primary flex-1">
                {editSaving ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
