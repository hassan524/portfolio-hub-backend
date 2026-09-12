/**
 * Extracts clean domain name from a referrer URL string.
 *
 * @param {string|null} referrer - Referrer header or URL string.
 * @returns {string} Hostname without leading 'www.', or 'Direct' if invalid/missing.
 */
export function extractDomain(referrer) {
  if (!referrer) return "Direct";
  try {
    return new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return "Direct";
  }
}

/**
 * Groups objects by a specified selector function and counts occurrences.
 *
 * @param {Array<Object>} rows - Array of objects to process.
 * @param {Function} getValue - Callback receiving a row and returning key.
 * @returns {Object.<string, number>} Record mapping values to counts.
 */
export function countBy(rows, getValue) {
  const counts = {};
  (rows || []).forEach((r) => {
    const val = getValue(r);
    if (!val) return;
    counts[val] = (counts[val] || 0) + 1;
  });
  return counts;
}

/**
 * Converts a key-count map into a ranked array sorted by frequency descending.
 *
 * @param {Object.<string, number>} counts - Record of values to count.
 * @param {number} total - Total count for percentage calculation.
 * @param {number} limit - Max number of top items to return.
 * @returns {Array<{label: string, count: number, percentage: number}>} Ranked list.
 */
export function toRanked(counts, total, limit) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({
      label,
      count,
      percentage: total ? Math.round((count / total) * 100) : 0,
    }));
}
