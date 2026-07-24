const STYLES = {
  'Sesuai': 'bg-good/10 text-good',
  'Lebih': 'bg-amber/20 text-warn',
  'Kurang': 'bg-bad/10 text-bad',
  'Tidak Ada di SAP': 'bg-ink/10 text-ink/70',
};

// Internal status value stays 'Tidak Ada di SAP' (used throughout
// reconciliation.js keying/filtering) — this is only the display label,
// which now covers BOTH "material code not found" and "batch not found
// for that material", since both cases fail the same master-data lookup.
const LABELS = {
  'Tidak Ada di SAP': 'Material/Batch tidak ada di Master Data',
};

export default function StatusBadge({ status }) {
  return <span className={`badge ${STYLES[status] || 'bg-ink/10 text-ink/70'}`}>{LABELS[status] || status}</span>;
}
