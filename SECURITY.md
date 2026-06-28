# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly by emailing the maintainers directly. Do **not** open a public issue.

## Security Changes (v2.5.5+)

### Hardcoded Secrets Removed

The bootstrap loader (`start.js`) previously contained obfuscated but extractable secrets:

- **GitHub Personal Access Token** — used to download private release assets
- **AES-256-CBC encryption key** — used to decrypt the bot bundle

These have been replaced with environment variables that must be configured at deployment time:

| Variable | Purpose |
|----------|---------|
| `LOADER_URL` | URL to the loader script (required) |
| `BUNDLE_TOKEN` | GitHub PAT for private release downloads |
| `BUNDLE_KEY` | AES-256-CBC key for bundle decryption |
| `LOADER_SHA256` | SHA-256 hash for loader integrity verification |

### Integrity Verification

The new `start.js` supports optional SHA-256 integrity checking of the downloaded loader. Set `LOADER_SHA256` to the expected hash to prevent execution of tampered code.

### Dependency Updates

Critical vulnerabilities addressed:
- `axios` updated to `^1.8.2` (fixes SSRF, CSRF, credential leakage, prototype pollution)
- `drizzle-orm` updated to `^0.44.7` (fixes SQL injection via improperly escaped identifiers)
- `node-fetch` updated to `^3.3.2`
- `helmet` added for HTTP security headers on the Express health/status server

### HTTPS Enforcement

The loader now rejects any `LOADER_URL` that does not use HTTPS, preventing man-in-the-middle attacks during code download.

## Recommendations

1. **Rotate the GitHub PAT** — The previously hardcoded token (`ghp_vFV6...`) should be revoked immediately and a new fine-grained token generated with minimal scope (read-only on the releases repo).

2. **Set `LOADER_SHA256`** — After downloading `loader.js` once, compute its hash and set this variable to catch any future tampering.

3. **Use a private environment** for secrets — Never put `BUNDLE_TOKEN` or `BUNDLE_KEY` in version-controlled files. Use your platform's secret management (Heroku Config Vars, Render Environment, Railway Variables).

4. **Review `synchrony` dependency** — It pulls in `babel-traverse`, `safe-eval`, and `lodash` which have critical prototype pollution and arbitrary code execution vulnerabilities. Consider replacing it if not strictly needed.
