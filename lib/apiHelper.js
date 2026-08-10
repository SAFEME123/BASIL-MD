/**
 * Shared API request helpers to reduce boilerplate across plugins.
 */
import axios from 'axios';

const DEFAULT_TIMEOUT = 15000;

/**
 * Perform a GET request and return the response data, or null on failure.
 * @param {string} url
 * @param {object} [opts]  - axios config overrides (params, headers, timeout, etc.)
 * @param {string} [tag]   - log label used on error (e.g. '[Jikan API]')
 * @returns {Promise<any|null>}
 */
export async function safeGet(url, opts = {}, tag = '[API]') {
  try {
    const res = await axios.get(url, { timeout: DEFAULT_TIMEOUT, ...opts });
    return res.data;
  } catch (e) {
    console.log(tag, e.message);
    return null;
  }
}

/**
 * Perform a POST request and return the response data, or null on failure.
 * @param {string} url
 * @param {any}    body
 * @param {object} [opts]  - axios config overrides
 * @param {string} [tag]
 * @returns {Promise<any|null>}
 */
export async function safePost(url, body, opts = {}, tag = '[API]') {
  try {
    const res = await axios.post(url, body, { timeout: DEFAULT_TIMEOUT, ...opts });
    return res.data;
  } catch (e) {
    console.log(tag, e.message);
    return null;
  }
}
