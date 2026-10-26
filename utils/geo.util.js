let geoip = null;
import('geoip-lite').then((m) => { geoip = m.default; }).catch(() => {});

/**
 * Extracts the user's client IP address from an Express request object.
 *
 * @param {import('express').Request} req - Express request object.
 * @returns {string|null} Client IP address or null if not found.
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = String(forwarded).split(',');
    return ips[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || null;
}

const TIMEZONE_TO_COUNTRY = {
  "Asia/Karachi": "PK",
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "Asia/Dhaka": "BD",
  "Asia/Dubai": "AE",
  "Asia/Riyadh": "SA",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Los_Angeles": "US",
  "America/Denver": "US",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "Europe/London": "GB",
  "Europe/Paris": "FR",
  "Europe/Berlin": "DE",
  "Europe/Amsterdam": "NL",
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
};

/**
 * Resolves 2-letter country code for a given IP address.
 *
 * @param {string|null} ip - IP address string.
 * @returns {string|null} ISO 3166-1 alpha-2 country code or null.
 */
export function getCountryFromIp(ip) {
  if (!ip || !geoip) return null;
  const geo = geoip.lookup(ip);
  return geo?.country || null;
}

/**
 * Resolves country code with fallback through proxy headers, geoip, and client timezone.
 */
export function resolveCountry({ req, ip, timeZone, countryHint } = {}) {
  if (req) {
    const headerCountry = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country-code'];
    if (headerCountry && typeof headerCountry === 'string' && headerCountry.length === 2 && headerCountry !== 'XX') {
      return headerCountry.toUpperCase();
    }
  }

  if (countryHint && typeof countryHint === 'string' && countryHint.length === 2) {
    return countryHint.toUpperCase();
  }

  if (ip) {
    const geo = getCountryFromIp(ip);
    if (geo) return geo.toUpperCase();
  }

  if (timeZone && typeof timeZone === 'string') {
    if (TIMEZONE_TO_COUNTRY[timeZone]) {
      return TIMEZONE_TO_COUNTRY[timeZone];
    }
    if (timeZone.startsWith("America/")) return "US";
  }

  return null;
}
