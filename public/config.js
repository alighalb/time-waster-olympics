/**
 * Backend location.
 *
 * Leave this EMPTY when the Node server serves the page itself (local `npm start`,
 * or a single-host deploy like Render/Railway/Fly) — the page then talks to its own origin.
 *
 * Set it to your backend's URL when the frontend is hosted separately, e.g. on Netlify:
 *
 *   window.TWO_API_BASE = "https://time-waster-olympics.onrender.com";
 *
 * No trailing slash. Must be https:// if the page itself is served over https.
 */
window.TWO_API_BASE = "";
