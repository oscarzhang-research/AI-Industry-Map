import { describe, expect, it } from 'vitest';
import { looksLikeBrokerResearch, privacyHits, privateLifeWord, privateTermsFrom, reportConcerns, scannableText } from '../src/lib/privacy.ts';

describe('privacy scan', () => {
  it('finds personal details wherever a reader could see them', () => {
    expect(reportConcerns('<a href="mailto:someone@example.com">write</a>')).toEqual(['an email address']);
    expect(reportConcerns('<p>call 415-555-0100</p>')).toEqual(['a phone number']);
    expect(reportConcerns('<p>手机：13812345678</p>')).toEqual(['a phone number']);
    expect(reportConcerns('<p>I am on OPT until June.</p>')).toEqual(['visa or ID terms']);
    expect(reportConcerns('<script>const T = { zh: "我的签证快到期了" }</script>')).toEqual(['visa or ID terms in Chinese']);
    expect(reportConcerns('<p data-zh="写给小王的信">x</p>')).toEqual(['personal terms in Chinese']);
    expect(reportConcerns('<p>fine</p>', { meta: 'summary: reach me at me@example.org' })).toEqual(['an email address']);
  });

  it('does not flag ordinary research text', () => {
    const clean = [
      '<img src="logo@2x.png"><script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js"></script>',
      '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">',
      '<p>The company filed a Form F-1 registration statement.</p>',
      '<p>Visa and Mastercard volumes rose.</p><table><tr><td>123</td><td>456</td><td>7890</td></tr></table>',
      '<script>const revenue = [13812345678, 13500000000];</script><p>Revenue was 13500000000 in total.</p>',
    ];
    for (const html of clean) expect(reportConcerns(html)).toEqual([]);
  });

  it("matches the owner's private terms as whole words", () => {
    expect(privacyHits('Thanks to Jordan Lee at Example Capital.', ['Lee'])).toEqual(['a term from your private list']);
    expect(privacyHits('A sleek design.', ['Lee'])).toEqual([]);
    expect(privacyHits('感谢王小明的帮助', ['王小明'])).toEqual(['a term from your private list']);
    expect(privateTermsFrom('tokenExpires: 2027-10-10\nprivateTerms: [Jordan Lee, "Example Capital"]\n')).toEqual(['Jordan Lee', 'Example Capital']);
    expect(privateTermsFrom('privateTerms:\n  - Jordan Lee   # a friend\n  - 王小明\ntokenExpires: 2027-10-10\n')).toEqual(['Jordan Lee', '王小明']);
    expect(privateTermsFrom('tokenExpires: 2027-10-10\n')).toEqual([]);
  });

  it('recognises broker research by its boilerplate', () => {
    expect(looksLikeBrokerResearch('Analyst Certification … Important Disclosures …')).toBe(true);
    expect(looksLikeBrokerResearch('证券研究报告 … 分析师声明 …')).toBe(true);
    expect(looksLikeBrokerResearch('We compare the stock with the consensus price target. Not investment advice.')).toBe(false);
    expect(reportConcerns('<p>Analyst Certification</p><p>Distribution of ratings</p>')).toEqual(["a broker's disclosures (third-party research)"]);
  });

  it('reads attribute values, script strings and comments', () => {
    const text = scannableText('<p title="tip">a</p><script>var s = "in a script";</script><!-- a comment -->');
    for (const part of ['tip', 'in a script', 'a comment']) expect(text).toContain(part);
  });
});

describe('news items stay on the business', () => {
  it('flags private-life words and leaves business language alone', () => {
    expect(privateLifeWord('The CEO admitted an affair with a consultant.')).toBe('an affair');
    expect(privateLifeWord('The founder is divorcing; shares may be split.')).toBe('divorcing');
    expect(privateLifeWord('The Ministry of Foreign Affairs and the head of corporate affairs commented.')).toBeUndefined();
    expect(privateLifeWord('The board opened an independent review; shares fell 5%.')).toBeUndefined();
  });
});
