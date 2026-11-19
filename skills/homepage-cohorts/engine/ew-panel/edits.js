/*
 * Section Metadata edits the Cohorts panel can ask for, as plain data: what each row action
 * changes, the request the Experience Workspace assistant gets, and whether the live document
 * shows the change afterwards.
 *
 * The SDK can only replace the node under the author's cursor (sendHTML replace), and the panel
 * cannot move that cursor, so a panel button cannot rewrite one section's metadata by itself.
 * The assistant can: the panel sends it one exact change (setPrompt) and then reads the live
 * document to confirm it, so the author never has to trust the chat on its word.
 */
import { list, sectionLabel, blockLabel } from './model.js';

export const KEY_LABEL = { cohorts: 'Cohorts', hideFor: 'Hide For', promote: 'Promote' };

/** A section's identity across edits: its blocks and heading (its index can shift). */
export const signature = (s) => `${s.blocks.map(blockLabel).join('+')}|${s.title ?? s.heading}`;

/** The section an edit was made for, in a newer copy of the page. */
export function findSection(sections, edit) {
  const same = sections[edit.i];
  if (same && signature(same) === edit.sig) return same;
  return sections.find((s) => signature(s) === edit.sig) || null;
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** Whether `sections` (the live document) already shows the edit. */
export function applied(sections, edit) {
  const s = findSection(sections, edit);
  if (edit.kind === 'delete') return !s;
  return !!s && sameSet(list(s.meta[edit.key]), edit.after);
}

/** Name a section the way an author finds it in the document. */
function where(s) {
  const { what, heading } = sectionLabel(s);
  const start = heading ? `, starting "${heading.slice(0, 70)}"` : '';
  return `section ${s.i + 1} (the ${what} block${start})`;
}

/**
 * One metadata change: add or remove a cohort id in one key of one section.
 * @returns {{kind, i, sig, key, op, id, before, after, label}}
 */
export function metaEdit(s, key, op, id, label) {
  const before = list(s.meta[key]);
  const after = op === 'add' ? [...new Set([...before, id])] : before.filter((x) => x !== id);
  return {
    kind: 'meta', i: s.i, sig: signature(s), key, op, id, before, after, label,
  };
}

export function deleteEdit(s, label) {
  return {
    kind: 'delete', i: s.i, sig: signature(s), label, html: null,
  };
}

/** The reverse of an edit, for Undo (a delete is undone in the editor, not here). */
export function reverse(edit, label) {
  return {
    ...edit, op: edit.op === 'add' ? 'remove' : 'add', before: edit.after, after: edit.before, label,
  };
}

/** The exact request for the assistant. */
export function promptFor(edit, s) {
  if (edit.kind === 'delete') {
    return `On this page, delete ${where(s)} completely, including its Section Metadata table. Change nothing else.`;
  }
  const key = KEY_LABEL[edit.key];
  const set = edit.after.length
    ? `set the "${key}" row to: ${edit.after.join(', ')}. If the section has no Section Metadata table, add one at the end of the section with that row`
    : `remove the "${key}" row (leave the other rows as they are)`;
  return `On this page, edit the Section Metadata table of ${where(s)} only: ${set}. Change nothing else on the page.`;
}

/** What to paste by hand when the assistant is not available or did not apply it. */
export function manualText(edit, s) {
  if (edit.kind === 'delete') return `Delete ${where(s)}.`;
  const key = KEY_LABEL[edit.key];
  return edit.after.length
    ? `Section ${s.i + 1}, Section Metadata: ${key} | ${edit.after.join(', ')}`
    : `Section ${s.i + 1}, Section Metadata: remove the ${key} row`;
}

/** A draft request (not sent) for a version of a section made for one group. */
export function versionPrompt(s, groupId, groupName, groupSub) {
  const meta = s.meta.slot
    ? `Section Metadata "Slot: ${s.meta.slot}" and "Cohorts: ${groupId}"`
    : `Section Metadata "Cohorts: ${groupId}"`;
  const original = s.meta.slot
    ? ''
    : ` Then add "${groupId}" to the original section's "Hide For" row, so ${groupName} visitors get the new one instead.`;
  const who = groupSub ? ` (${groupSub})` : '';
  return `Draft a version of ${where(s)} for ${groupName} visitors${who}. Put it right after the original as its own section, with ${meta}.${original}`;
}

/** A new, empty section for one group (DA table form: the editor parses it as a block). */
export function newSectionHtml(groupId, groupName) {
  const meta = groupId
    ? `<table><tr><td colspan="2">Section Metadata</td></tr><tr><td>Cohorts</td><td>${groupId}</td></tr></table>`
    : '';
  return `<hr><h2>New section for ${groupName}</h2><p>Write what ${groupName} visitors should see here.</p>${meta}<hr>`;
}
