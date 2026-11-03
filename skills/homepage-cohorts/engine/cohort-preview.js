/*
 * Page variation picked in the Cohorts panel → Experience Workspace's Layout view.
 *
 * The Layout view and the Cohorts panel are both served from {ref}--{site}--{org}.preview.da.live
 * inside da.live, so they share storage and a BroadcastChannel. The panel stores the pick and
 * announces it; the Layout page reloads and the engine applies those keys instead of resolving
 * the author's own signals. Only in that preview iframe: visitors on aem.page / aem.live never
 * read it.
 */
const STORE = 'cohorts-preview';
const CHANNEL = 'cohorts-preview';
const TTL = 2 * 60 * 60 * 1000; // a pick from an old session does not linger in the Layout view

export const inEditorPreview = () => window.self !== window.top
  && /\.preview\.da\.live$/.test(window.location.hostname);

/** The picked variation: { id, experience, keys, rule, label } or null. */
export function readPick() {
  try {
    const v = JSON.parse(window.localStorage.getItem(STORE));
    return v && Array.isArray(v.keys) && Date.now() - v.at < TTL ? v : null;
  } catch {
    return null;
  }
}

/** The panel's side: store the pick and tell the Layout view. */
export function sendPick(pick) {
  const v = { ...pick, at: Date.now() };
  try { window.localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* no storage */ }
  try { new BroadcastChannel(CHANNEL).postMessage({ type: 'pick', id: v.id }); } catch { /* old browser */ }
}

/** Keys the engine should apply in the Layout view, or null (everywhere else). */
export function previewForce() {
  return inEditorPreview() ? readPick() : null;
}

/** In the Layout view: reload when the panel picks a different variation. */
export function listenForPicks(currentId) {
  if (!inEditorPreview() || typeof BroadcastChannel !== 'function') return;
  const bc = new BroadcastChannel(CHANNEL);
  bc.onmessage = ({ data }) => {
    if (data?.type === 'pick' && data.id !== currentId) window.location.reload();
  };
}
