// so_sessions.recount_material_codes is meant to be a jsonb array of
// {code, source, qtySap, qtyTercatat, selisih, baseUom} objects (written by
// handleStartRecount in the Admin dashboard). In practice some rows come
// back with each entry as a JSON-encoded STRING instead of a parsed object
// (e.g. "{\"code\":\"ABGTB2026\",\"source\":\"normal\",...}") — this shows
// up as the raw JSON text being rendered straight into a badge instead of
// just the material code. This defensively unwraps either shape so every
// page reading this column behaves the same regardless of what's actually
// stored, instead of each page re-implementing its own `typeof x ===
// 'object'` check.
export function parseRecountCodes(raw) {
  const codes = raw || [];
  return codes.map((c) => {
    if (typeof c === 'string') {
      try {
        const parsed = JSON.parse(c);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        // Not JSON — a genuinely legacy plain code string. Wrap it so
        // callers always get a consistent { code, source } shape.
      }
      return { code: c, source: 'normal' };
    }
    return c;
  });
}
