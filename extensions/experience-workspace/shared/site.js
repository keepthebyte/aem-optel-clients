/*
 * Per-site settings for the Experience Workspace panels.
 *
 * The panels run for any site: the library row's URL says which one, and
 * whatever it leaves out is asked once and remembered in this browser.
 *
 *   ?domain=www.example.com  host whose telemetry is read; the hostname visitors
 *                            see, the one the domain key was issued for
 *   ?domainkey=...           Optel domain key for that host
 *   ?paid-medium=a|b         utm_medium values that mean paid on this site, on top of
 *                            the client's rule (see configure() in analyze.js)
 *   ?ai=on                   AI-surface section (Brand Visibility); off by default
 *   ?site-id=...             Brand Visibility site id, read only with ai=on
 *
 * Experience Workspace tells a panel the project (org and site) and the page
 * path, not the production host, so a domain typed into the panel is
 * remembered per project. Keys are remembered per host.
 */

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked */ } };

/** "https://www.example.com/x" → "www.example.com" */
export function normalizeDomain(x) {
  const s = String(x || '').trim().toLowerCase();
  if (!s) return '';
  try { return new URL(s.includes('://') ? s : `https://${s}`).hostname; } catch { return ''; }
}

/** "org/site" from the SDK handshake, or '' standalone. */
export function projectKey(sdk) {
  const ctx = sdk?.context || {}; const p = sdk?.project || {};
  const org = ctx.org || p.org || p.owner || '';
  const site = ctx.repo || ctx.site || p.repo || p.site || '';
  return org && site ? `${org}/${site}` : '';
}

const domainStore = (project) => `optel-domain:${project || 'standalone'}`;
const keyStore = (domain) => `optel-domainkey:${domain}`;

export const rememberDomain = (project, domain) => write(domainStore(project), normalizeDomain(domain) || null);
export const rememberKey = (domain, key) => write(keyStore(domain), key || null);
export const forgetKey = (domain) => write(keyStore(domain), null);

/**
 * Settings for this panel load. Values in the URL win and are remembered;
 * the rest come from this browser. `domain` or `domainKey` may be empty:
 * the panel then asks for them.
 */
export function siteSettings(params, project = '') {
  const domain = normalizeDomain(params.get('domain')) || normalizeDomain(read(domainStore(project)));
  if (params.get('domain') && domain) rememberDomain(project, domain);
  const urlKey = params.get('domainkey');
  if (urlKey && domain) rememberKey(domain, urlKey);
  const ai = params.get('ai') === 'on';
  const siteIdStore = `bv-site-id:${domain}`;
  if (ai && params.get('site-id')) write(siteIdStore, params.get('site-id'));
  return {
    project,
    domain,
    domainKey: urlKey || (domain ? read(keyStore(domain)) : null),
    paidMedium: params.get('paid-medium') || '',
    ai,
    siteId: ai ? (params.get('site-id') || read(siteIdStore)) : null,
    pageUrl: (path) => (domain ? `https://${domain}${path || '/'}` : ''),
  };
}
