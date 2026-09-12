let geoip = null;
try {
  // Dynamically import geoip-lite if available in dependencies
  geoip = (await import('geoip-lite')).default;
} catch {
  // geoip-lite optional fallback if not installed
}

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
