/**
 * Shared formatting and text utilities used across plugins.
 */

/**
 * Format a byte count into a human-readable string (KB / MB / GB).
 * @param {number|string} bytes
 * @returns {string}
 */
export function fmtBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '';
  const n = parseInt(bytes);
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if (n >= 1048576)    return (n / 1048576).toFixed(0) + ' MB';
  return (n / 1024).toFixed(0) + ' KB';
}

/**
 * Truncate text to a maximum length, appending an ellipsis if needed.
 * @param {string} text
 * @param {number} [maxLen=500]
 * @returns {string}
 */
export function truncateText(text, maxLen = 500) {
  if (!text) return 'No description available.';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
}

/**
 * Derive a MIME type from a filename extension.
 * @param {string} [filename='']
 * @returns {string}
 */
export function getMimetype(filename = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return {
    mkv: 'video/x-matroska',
    mp4: 'video/mp4',
    avi: 'video/x-msvideo',
    webm: 'video/webm'
  }[ext] || 'video/mp4';
}

/**
 * Convert a human-readable title into a URL-friendly slug.
 * @param {string} title
 * @returns {string}
 */
export function titleToSlug(title) {
  return title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Format an array of genre objects (or strings) into a comma-separated list.
 * @param {Array} genres
 * @returns {string}
 */
export function formatGenres(genres) {
  if (!genres?.length) return 'N/A';
  return genres.map(g => g.name || g).join(', ');
}
