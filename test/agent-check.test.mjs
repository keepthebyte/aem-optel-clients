import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingsOf, VIEWPORTS } from '../skills/homepage-cohorts/scripts/agent-check.js';

const clean = () => ({
  experience: 'agent',
  h1InFirstScreen: true,
  controlInFirstScreen: true,
  cls: 0.002,
  movedByAnswering: 0,
  fixedOrSticky: [],
  dialogs: 0,
  closed: [],
  animated: 0,
  smallTargets: [],
  unnamed: [],
  duplicateNames: [],
  tablesWithoutCaption: 0,
  fakeControls: [],
  overflow: false,
  reloadLost: false,
  errors: [],
});

test('a page built by the rules has no findings', () => {
  assert.deepEqual(findingsOf('desktop', clean()), []);
});

test('checks a desktop and a phone', () => {
  assert.deepEqual(Object.keys(VIEWPORTS), ['desktop', 'phone']);
  assert.equal(VIEWPORTS.phone.width, 375);
});

test('the people version served to an agent is a finding', () => {
  const f = findingsOf('phone', { ...clean(), experience: 'default' });
  assert.equal(f.length, 1);
  assert.match(f[0], /^phone: experience is "default", expected "agent"/);
});

test('each thing an agent trips over is named', () => {
  const f = findingsOf('desktop', {
    ...clean(),
    controlInFirstScreen: false,
    cls: 0.2,
    movedByAnswering: 3,
    fixedOrSticky: ['div.sticky-quote'],
    dialogs: 1,
    closed: ['Can I cancel?'],
    smallTargets: ['Log in'],
    unnamed: ['button.icon'],
    duplicateNames: ['link "Get a price" → 3 targets'],
    tablesWithoutCaption: 1,
    overflow: true,
    reloadLost: true,
  });
  assert.equal(f.length, 12);
  assert.ok(f.some((x) => /no form control in the first screen/.test(x)));
  assert.ok(f.some((x) => /a reload lost the answers/.test(x)));
});

test('long lists are cut to five with a count', () => {
  const f = findingsOf('desktop', { ...clean(), smallTargets: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
  assert.match(f[0], /a \| b \| c \| d \| e \(\+2\)$/);
});

test('the layout shift budget can be changed', () => {
  assert.equal(findingsOf('desktop', { ...clean(), cls: 0.05 }, { cls: 0.1 }).length, 0);
});
