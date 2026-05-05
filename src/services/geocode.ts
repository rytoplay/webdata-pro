import { db } from '../db/knex';

interface LatLng { lat: number; lng: number; }

// ── Geocode cache lookup / write ─────────────────────────────────────────────

export async function geocodeLocation(rawAddress: string): Promise<LatLng | null> {
  const address = rawAddress.trim();
  if (!address) return null;

  // Check control-DB cache first
  const cached = await db('_wdpro_geocode').where({ address }).first() as { lat: number; lng: number } | undefined;
  if (cached) return { lat: cached.lat, lng: cached.lng };

  // Live geocode — DB setting takes precedence over env var
  const dbRow  = await db('settings').where({ key: 'google_geocoding_api_key' }).first() as { value: string } | undefined;
  const apiKey = dbRow?.value || process.env.GOOGLE_GEOCODING_API_KEY || '';
  const result = apiKey
    ? await geocodeWithGoogle(address, apiKey)
    : await geocodeWithNominatim(address);

  if (result) {
    try {
      await db('_wdpro_geocode').insert({
        address,
        lat:        result.lat,
        lng:        result.lng,
        fetched_at: new Date().toISOString(),
      });
    } catch {
      // Race condition — another concurrent request already cached it; ignore
    }
  }

  return result;
}

// ── Geocoding providers ──────────────────────────────────────────────────────

async function geocodeWithGoogle(address: string, apiKey: string): Promise<LatLng | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
  try {
    const res  = await fetch(url);
    const data = await res.json() as { status: string; results?: Array<{ geometry: { location: { lat: number; lng: number } } }> };
    if (data.status !== 'OK' || !data.results?.[0]) return null;
    const loc = data.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return null;
  }
}

async function geocodeWithNominatim(address: string): Promise<LatLng | null> {
  // US zip codes (5-digit or ZIP+4) are ambiguous to Nominatim — the same number
  // may match postal codes in Bosnia, Germany, Italy, etc. Use the structured
  // postalcode endpoint with countrycodes=us to avoid foreign matches.
  const isUsZip = /^\d{5}(-\d{4})?$/.test(address.trim());
  const params  = isUsZip
    ? `postalcode=${encodeURIComponent(address.trim())}&countrycodes=us&format=json&limit=1`
    : `q=${encodeURIComponent(address)}&format=json&limit=1`;

  const url = `https://nominatim.openstreetmap.org/search?${params}`;
  try {
    const res  = await fetch(url, {
      headers: { 'User-Agent': 'WebdataPro/2.0 (geocode-cache; contact: admin)' },
    });
    const data = await res.json() as Array<{ lat: string; lon: string }>;
    if (!data?.[0]) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

// ── Haversine distance ───────────────────────────────────────────────────────

/** Returns distance in miles between two lat/lng points. */
export function haversineDistanceMiles(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R     = 3958.8; // Earth radius in miles
  const dLat  = (lat2 - lat1) * Math.PI / 180;
  const dLng  = (lng2 - lng1) * Math.PI / 180;
  const a     = Math.sin(dLat / 2) ** 2
              + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// ── Token arg parser ─────────────────────────────────────────────────────────

/**
 * Parse the args inside $distance[...].
 * Handles quoted strings that may contain commas:
 *   '12 Maple St, Irvine, CA', pets.zip  →  ["12 Maple St, Irvine, CA", "pets.zip"]
 */
export function parseDistanceArgs(ref: string): string[] {
  const args: string[] = [];
  let i       = 0;
  let current = '';

  while (i < ref.length) {
    const ch = ref[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < ref.length && ref[i] !== quote) current += ref[i++];
      i++; // skip closing quote
    } else if (ch === ',') {
      args.push(current.trim());
      current = '';
      i++;
    } else {
      current += ch;
      i++;
    }
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

// ── Row-level pre-computation ────────────────────────────────────────────────

/**
 * Scan the row template for $distance[from, to] tokens, geocode all referenced
 * locations (cached), and return a per-row map of { _dist__0: "4.2", _dist__1: "12.0", ... }.
 *
 * "from" and "to" args can be:
 *   - A literal zip code or address:              88201   or   '107 N Main St, Roswell, NM'
 *   - A simple field reference:                  sightings.zip   or   sightings__zip
 *   - A template string with field interpolation: '${sightings.city}, ${sightings.state}'
 *
 * Call this before the row rendering loop and spread the result into each rowData.
 * In renderTokens, $distance[...] tokens are replaced by the _dist__N values.
 * The token returns a bare number ("4.2") — units are written in the template.
 */
export async function prefetchDistances(
  rowTemplate: string,
  rows: Record<string, unknown>[],
): Promise<Map<number, Record<string, string>>> {
  // Extract all $distance[...] tokens in order of appearance
  const tokens: Array<{ fromArg: string; toArg: string }> = [];
  for (const m of rowTemplate.matchAll(/\$distance\[([^\]]+)\]/g)) {
    const args = parseDistanceArgs(m[1]);
    if (args.length < 2) continue;
    tokens.push({ fromArg: args[0], toArg: args[1] });
  }

  if (!tokens.length) return new Map();

  // Collect all unique resolved location strings across all rows
  const toGeocode = new Set<string>();

  for (const { fromArg, toArg } of tokens) {
    for (const row of rows) {
      const from = resolveArg(fromArg, row);
      const to   = resolveArg(toArg,   row);
      if (from) toGeocode.add(from);
      if (to)   toGeocode.add(to);
    }
  }

  // Geocode all unique locations in parallel (DB cache hits are fast; API calls are one-time)
  const coordCache = new Map<string, LatLng | null>();
  await Promise.all([...toGeocode].map(async loc => {
    coordCache.set(loc, await geocodeLocation(loc));
  }));

  // Build per-row distance extras
  const result = new Map<number, Record<string, string>>();

  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i];
    const extras: Record<string, string> = {};

    for (let t = 0; t < tokens.length; t++) {
      const fromLoc = resolveArg(tokens[t].fromArg, row);
      const toLoc   = resolveArg(tokens[t].toArg,   row);

      const from = fromLoc ? coordCache.get(fromLoc) : null;
      const to   = toLoc   ? coordCache.get(toLoc)   : null;

      extras[`_dist__${t}`] = (from && to)
        ? haversineDistanceMiles(from.lat, from.lng, to.lat, to.lng).toFixed(1)
        : '';
    }

    result.set(i, extras);
  }

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a $distance arg to a concrete location string for a given row.
 *
 * Three forms:
 *  1. Simple field ref:         sightings.zip  →  row value (e.g. "88201")
 *  2. Template with ${fields}:  '${sightings.city}, ${sightings.state}'  →  "Roswell, NM"
 *  3. Literal:                  88201  →  "88201"
 */
function resolveArg(arg: string, row: Record<string, unknown>): string {
  // Form 1: bare field reference (table.field or table__field, no ${})
  if (isFieldRef(arg)) {
    return String(row[toFieldAlias(arg)] ?? '');
  }

  // Form 2: contains ${...} field interpolation — substitute each field token
  if (arg.includes('${')) {
    return arg.replace(/\$\{([^}]+)\}/g, (_, token: string) => {
      const alias = token.includes('__') ? token : token.replace('.', '__');
      return String(row[alias] ?? row[token] ?? '');
    }).trim();
  }

  // Form 3: plain literal (zip code, address string)
  return arg;
}

/** True if the arg looks like a bare field reference (table.field or table__field, no template syntax). */
function isFieldRef(arg: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*(\.|__)[a-zA-Z_][a-zA-Z0-9_]*$/.test(arg);
}

/** Convert table.field or table__field to the aliased column name used in query results. */
function toFieldAlias(arg: string): string {
  return arg.includes('__') ? arg : arg.replace('.', '__');
}
