/*
 * Theme rules. Copy next to the project (beside merge-rules.js of the site-merge skill) and edit.
 *
 * A theme is what a client is trying to solve, in the client's words: not a business unit, not a
 * product, not a section of a site. It is the unit all three reads are merged by, so one list
 * has to work for the landing pages of every site, for the questions people put to search and
 * AI assistants, and for the firm's own statements. Eight to twelve is a good number.
 */
export default {
  /*
   * Which needs of merge-rules.js are about a subject at all. A sign-in, a careers page or a
   * privacy notice has no theme; a service page, an article or a campaign page does.
   */
  topical: ['solutions', 'insights', 'campaign', 'other'],

  /*
   * Themes, in order: the first that matches wins, so the specific comes before the general
   * ("cyber" before "risk"). `words` are matched as whole words on the words of the landing
   * page path ("/insights/cyber-risk-2026.html" reads as "insights cyber risk 2026"), so `ai`
   * does not match "details" and `war` does not match "software". Alternatives with `|`,
   * `\\w*` for endings. Check the result: visits-by-theme.js lists the top pages of every theme.
   */
  themes: [
    { id: 'cyber', label: 'Cyber', words: 'cyber\\w*|ransomware|data breach|information security' },
    { id: 'ai-data', label: 'AI and data', words: 'ai|genai|artificial intelligence|generative|machine learning|data cent(er|re)s?' },
    { id: 'health', label: 'Health and benefits', words: 'health\\w*|benefits?|medical|wellbeing' },
    { id: 'people', label: 'People and pay', words: 'talent|workforce|compensation|rewards?|pay|skills|hr' },
    { id: 'energy', label: 'Energy and climate', words: 'climate|energy|renewables?|sustainab\\w*|net zero|carbon' },
    { id: 'risk', label: 'Risk and insurance', words: 'risks?|insur\\w*|claims?|liabilit\\w*|property' },
    { id: 'growth', label: 'Strategy and growth', words: 'strategy|transformation|pricing|growth|operations' },
  ],

  /*
   * Topical pages that are not part of the question (a consumer line next to a business one,
   * say). Checked before the themes; counted and listed as `excluded`, never dropped silently.
   * Leave the same subjects out of the topic demand, or the two reads do not compare.
   */
  exclude: 'personal|private client|family office',
};
