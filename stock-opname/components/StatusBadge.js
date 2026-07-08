const STYLES = {
  'Sesuai': 'bg-good/10 text-good',
  'Lebih': 'bg-amber/20 text-warn',
  'Kurang': 'bg-bad/10 text-bad',
  'Tidak Ada di SAP': 'bg-ink/10 text-ink/70',
};

export default function StatusBadge({ status }) {
  return <span className={`badge ${STYLES[status] || 'bg-ink/10 text-ink/70'}`}>{status}</span>;
}
