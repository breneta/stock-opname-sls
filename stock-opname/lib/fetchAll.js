// Supabase/PostgREST caps every response at 1000 rows by default
// (db.max_rows). A plain `.select('*')` on a big table like so_sap_data
// silently truncates instead of erroring — row *counts* (using
// `{ count: 'exact', head: true }`) are unaffected because that's a
// different code path, which is why the row count can look correct
// while sums computed from the actual rows come out wrong.
//
// This walks the table in pages until it truly has everything.
//
// Usage:
//   const rows = await fetchAll(() =>
//     supabase.from('so_sap_data').select('*').eq('session_id', id)
//   );
export async function fetchAll(queryFactory, pageSize = 1000) {
  let all = [];
  let from = 0;

  while (true) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}
