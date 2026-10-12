/**
 * Approximate country resolution without IP addresses.
 *
 * Two sources, in order: edge geo headers the platform already attaches
 * (`cf-ipcountry` from Cloudflare, `x-vercel-ip-country` from Vercel) and, when
 * no header survives the proxy chain, the browser's IANA timezone mapped to its
 * most populous country. Timezone mapping is explicitly approximate — some zones
 * span borders — so the admin labels it as such and never presents it as precise.
 */

/** IANA zone → ISO 3166-1 alpha-2 of the zone's most populous country. */
const ZONE_COUNTRY: Record<string, string> = {
  'Africa/Lagos': 'NG', 'Africa/Accra': 'GH', 'Africa/Nairobi': 'KE', 'Africa/Johannesburg': 'ZA',
  'Africa/Cairo': 'EG', 'Africa/Casablanca': 'MA', 'Africa/Addis_Ababa': 'ET', 'Africa/Dakar': 'SN',
  'Africa/Abidjan': 'CI', 'Africa/Douala': 'CM', 'Africa/Kigali': 'RW',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US',
  'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA',
  'America/Mexico_City': 'MX', 'America/Sao_Paulo': 'BR', 'America/Buenos_Aires': 'AR', 'America/Bogota': 'CO',
  'America/Lima': 'PE', 'America/Santiago': 'CL',
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Lisbon': 'PT', 'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT', 'Europe/Zurich': 'CH', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI', 'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ',
  'Europe/Vienna': 'AT', 'Europe/Athens': 'GR', 'Europe/Istanbul': 'TR', 'Europe/Moscow': 'RU',
  'Europe/Kyiv': 'UA', 'Europe/Bucharest': 'RO',
  'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Karachi': 'PK', 'Asia/Kolkata': 'IN',
  'Asia/Dhaka': 'BD', 'Asia/Colombo': 'LK', 'Asia/Bangkok': 'TH', 'Asia/Jakarta': 'ID',
  'Asia/Singapore': 'SG', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Manila': 'PH', 'Asia/Hong_Kong': 'HK',
  'Asia/Shanghai': 'CN', 'Asia/Taipei': 'TW', 'Asia/Seoul': 'KR', 'Asia/Tokyo': 'JP',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Pacific/Auckland': 'NZ',
  'UTC': '', 'Etc/UTC': '', 'Etc/Universal': '',
};

const CODE = /^[A-Z]{2}$/;
const ZONE = /^[A-Za-z_+\-]+\/[A-Za-z_+\-()]+$/;

function cleanCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  const code = value.trim().toUpperCase();
  return CODE.test(code) ? code : '';
}

function cleanZone(value: unknown): string {
  if (typeof value !== 'string') return '';
  const zone = value.trim();
  if (!zone || zone.length > 60 || !ZONE.test(zone)) return '';
  try {
    // Rejects invented zones like "Mars/Olympus" without a lookup table.
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return '';
  }
}

export interface CountryInput {
  headers: { 'cf-ipcountry'?: unknown; 'x-vercel-ip-country'?: unknown };
  timeZone: unknown;
}

export interface CountryResult {
  /** ISO alpha-2, or '' when unknown. */
  country: string;
  /** Validated IANA zone, or '' — stored so the mapping stays auditable. */
  timeZone: string;
  /** True only when the code came from an edge header rather than approximation. */
  precise: boolean;
}

export function resolveCountry(input: CountryInput): CountryResult {
  const header = cleanCode(input.headers['cf-ipcountry']) || cleanCode(input.headers['x-vercel-ip-country']);
  if (header) return { country: header, timeZone: cleanZone(input.timeZone), precise: true };
  const zone = cleanZone(input.timeZone);
  const approx = zone ? (ZONE_COUNTRY[zone] ?? '') : '';
  return { country: approx, timeZone: zone, precise: false };
}
