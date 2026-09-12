/**
 * Formats a project name into a safe, valid slug for hosting platforms (Vercel/Netlify).
 *
 * @param {string} rawName - Raw input name.
 * @returns {string} Sanitized slugified string.
 */
export function slugifyProjectName(rawName) {
  const slug = (rawName || 'portfolio')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);

  return slug || 'portfolio';
}

/**
 * Delays execution for a given number of milliseconds.
 *
 * @param {number} ms - Milliseconds to sleep.
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
