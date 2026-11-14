/*
 * Site-merge rules. Copy next to the project (not into code that ships) and edit.
 *
 * Several sites are being consolidated into one. Step 1 reads each site on its own: who visits
 * and what they come for (its cohorts). Step 2 merges the cohorts that share a need into the
 * audiences of the new site, and says for each what must be kept (so nobody who is served
 * today is worse off after the redirect) and what is gained by coming together.
 *
 * Regexes are case-insensitive strings so the file stays plain data.
 */
export default {
  title: 'Three sites, one front door',

  /*
   * The sites being merged, in the order they are drawn.
   *   id       short key: file name of its bundles (<id>-site.jsonl), env var of its domain key
   *            (OPTEL_DOMAIN_KEY_<ID>) and the value of ?from= in its redirects
   *   host     the hostname Optel has data for
   *   domain   registrable domain: a click to it from another site is a cross-site click
   *   home     its homepages (all locales). A visit that lands here has no need yet
   *   target   true on the site the others move to (as-redirected.js)
   *   homePath the one homepage that is being replaced (as-redirected.js)
   */
  sites: [
    { id: 'group', name: 'Example Group', was: 'example.com', host: 'www.example.com', domain: 'example.com', home: '^/([a-z]{2}/)?$', target: true, homePath: '/' },
    { id: 'shop', name: 'Shop', was: 'example-shop.com', host: 'www.example-shop.com', domain: 'example-shop.com', home: '^/$', homePath: '/' },
    { id: 'pro', name: 'Professional', was: 'example-pro.com, formerly Pro Co', host: 'www.example-pro.com', domain: 'example-pro.com', home: '^/(index\\.html)?$', homePath: '/index.html' },
  ],

  /*
   * What a visit comes for, read from the page it lands on. First match wins, so order matters:
   * the specific before the general. Write each pattern to hold on all the sites, anchor on
   * path segments ('/sign-in', not 'sign' which is also in "designing"), and check the result:
   * site-cohorts.js prints the top pages behind every need in sites.json (`topPages`).
   * `home` (a homepage with no next step) and `other` (nothing matched) are built in.
   */
  needs: [
    ['client', '/dashboard/|/auth/|/log-?in(/|\\.|$)|/sign-?in|/account|client-?portal'],
    ['careers', '/careers|careers\\.|/jobs'],
    ['investors', '/investors'],
    ['campaign', '/campaigns/|/lp/'],
    ['contact', '/contact|/locations|/offices'],
    ['insights', '/insights|/blog|/news/|/reports?/|/events'],
    ['legal', 'privacy|legal|terms|cookie|/policies|notice'],
    ['solutions', '/services|/solutions|/products|/industries'],
    ['about', '/about|/company|/leadership|/media'],
  ],

  needLabels: {
    client: 'Client sign-in', careers: 'Careers', investors: 'Investors', campaign: 'Campaign pages', contact: 'Contact and offices', insights: 'Research and insights', legal: 'Notices and policies', solutions: 'Services and solutions', about: 'Company and news', home: 'Homepage, no next step', other: 'Other pages',
  },

  /*
   * The audiences of the merged site, one per need, in the order they are drawn.
   *   keep  what this audience has on its own site today and must still have after the redirect
   *   gain  what it gets only because the sites come together ('' when there is none)
   *   on    where the new site serves it
   * keep and gain are decisions, not measurements: the numbers beside them are today's baseline.
   */
  audiences: [
    { id: 'solutions', label: 'Buyers with a problem', on: 'Solutions', keep: 'The offer of the site they came for, under the name they know.', gain: 'What the other sites offer for the same problem, side by side.' },
    { id: 'insights', label: 'Readers', on: 'Insights', keep: 'Every article redirects one to one.', gain: 'Related reading from the other sites.' },
    { id: 'home', label: 'Front-door visitors', on: 'Homepage', keep: 'What their site is, in the first screen, with its former name.', gain: 'The whole group in one place.' },
    { id: 'careers', label: 'Candidates', on: 'Careers', keep: 'Careers one step away, opening on the site they came for.', gain: 'Roles across the group.' },
    { id: 'campaign', label: 'Campaign responders', on: 'Landing pages', keep: 'Their landing page redirects one to one.', gain: '' },
    { id: 'about', label: 'Getting to know the firm', on: 'About', keep: 'Company, leadership and news of their site.', gain: 'One firm to read about.' },
    { id: 'client', label: 'Clients signing in', on: 'Sign in', keep: 'Sign-in stays one step, to the portal they use today.', gain: 'What else the group can do for them, beside it.' },
    { id: 'investors', label: 'Investors', on: 'Investors', keep: 'Investors one step from the header.', gain: '' },
    { id: 'contact', label: 'Getting in touch', on: 'Contact', keep: 'The contact page and offices of their site.', gain: 'One conversation across the group.' },
    { id: 'legal', label: 'Notices and policies', on: 'Footer', keep: 'Every notice redirects one to one.', gain: '' },
    { id: 'other', label: 'Everything else', on: 'Redirect one to one', keep: 'Pages that fit no need redirect one to one.', gain: '' },
  ],

  /*
   * Layers: the same merge for one kind of traffic at a time. `channels` are the acquisition
   * channels of a visit: direct, search, email, social, referral, paid, ai, other.
   */
  layers: [
    { id: 'all', label: 'All traffic', sub: 'Every visit' },
    { id: 'seo', label: 'SEO', sub: 'Visits from search engines', channels: ['search'] },
    { id: 'geo', label: 'GEO', sub: 'Visits from AI assistants and answer engines', channels: ['ai'] },
  ],

  // a cohort below this many sampled visits is marked as a low sample; a layer below minLayerSample too
  minSample: 30,
  minLayerSample: 300,
};
