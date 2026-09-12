import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:4321';
const reportName = process.env.LIGHTHOUSE_REPORT_NAME || '';
if (reportName && !/^[a-zA-Z0-9_-]+$/.test(reportName)) throw new Error('LIGHTHOUSE_REPORT_NAME must be a simple directory name');
const output = path.join(fileURLToPath(new URL('../output/lighthouse/', import.meta.url)), reportName);
const allRoutes = ['/', '/hass', '/ettinger', '/rent', '/catalog', '/catalog/domains', '/catalog/vps', '/catalog/dedicated', '/catalog/bulletproof', '/catalog/proxies', '/catalog/vps/vps', '/countries', '/payment', '/news', '/contacts'];
const args = process.argv.slice(2);
await mkdir(output, { recursive: true });
let previous;
try { previous = JSON.parse(await readFile(path.join(output, 'summary.json'), 'utf8')); } catch { previous = { results: [] }; }
const retry = args.includes('--retry-failed');
const explicit = args.filter(arg => arg.startsWith('/'));
const routes = explicit.length ? explicit : retry ? previous.results.filter(result => result.performance < 90 || result.accessibility < 90 || result.error).map(result => result.route) : allRoutes;
if (retry && !routes.length) { console.log('No failed routes to repeat.'); process.exit(0); }

const results = retry || explicit.length ? previous.results || [] : [];
const profileDir = path.resolve(output, `chrome-profile-${process.pid}`);
await mkdir(profileDir, { recursive: true });
const chrome = await launch({ chromePath: chromium.executablePath(), userDataDir: profileDir, chromeFlags: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'], logLevel: 'error' });
async function save() {
  const scores = results.filter(result => !result.error);
  const summary = { base, checkedAt: new Date().toISOString(), lighthouse: '13', profile: 'Lighthouse default mobile, simulated network and CPU throttling', thresholds: { performance: 90, accessibility: 90 }, minPerformance: scores.length ? Math.min(...scores.map(result => result.performance)) : null, minAccessibility: scores.length ? Math.min(...scores.map(result => result.accessibility)) : null, results };
  await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(path.join(output, 'summary.md'), `# Mobile Lighthouse\n\n${summary.profile}. Base: ${base}\n\n| Route | Performance | Accessibility | LCP (s) | CLS |\n| --- | ---: | ---: | ---: | ---: |\n${results.map(result => `| ${result.route} | ${result.performance ?? 'error'} | ${result.accessibility ?? 'error'} | ${result.lcpSeconds ?? '—'} | ${result.cls ?? '—'} |`).join('\n')}\n\nMinimum: Performance ${summary.minPerformance}; Accessibility ${summary.minAccessibility}.\n`);
}
try {
  for (const route of routes) {
    const name = route === '/' ? 'home' : route.slice(1).replaceAll('/', '-');
    const old = results.find(result => result.route === route);
    const attempt = (old?.attempt || 0) + 1;
    let result;
    try {
      const run = await lighthouse(new URL(route, base).href, { port: chrome.port, output: ['html', 'json'], onlyCategories: ['performance', 'accessibility'], formFactor: 'mobile', throttlingMethod: 'simulate', logLevel: 'error' });
      if (!run?.lhr || run.lhr.runtimeError) throw new Error(run?.lhr?.runtimeError?.message || 'Lighthouse did not return a report');
      const { lhr } = run;
      const audits = Object.values(lhr.audits).filter(audit => audit.score !== null && audit.score < 1).map(audit => ({ id: audit.id, title: audit.title, score: audit.score, displayValue: audit.displayValue, numericValue: audit.numericValue }));
      result = { route, attempt, performance: Math.round(lhr.categories.performance.score * 100), accessibility: Math.round(lhr.categories.accessibility.score * 100), fcpSeconds: +(lhr.audits['first-contentful-paint'].numericValue / 1000).toFixed(2), lcpSeconds: +(lhr.audits['largest-contentful-paint'].numericValue / 1000).toFixed(2), totalBlockingTimeMs: Math.round(lhr.audits['total-blocking-time'].numericValue), cls: +lhr.audits['cumulative-layout-shift'].numericValue.toFixed(4), failedAudits: audits, runWarnings: lhr.runWarnings, priorAttempts: old ? [...(old.priorAttempts || []), { attempt: old.attempt, performance: old.performance, accessibility: old.accessibility, error: old.error }] : [] };
      await writeFile(path.join(output, `${name}-attempt-${attempt}.html`), run.report[0]);
      await writeFile(path.join(output, `${name}-attempt-${attempt}.json`), run.report[1]);
      console.log(`${route}  Performance ${result.performance}  Accessibility ${result.accessibility}  LCP ${result.lcpSeconds}s  CLS ${result.cls}`);
    } catch (error) { result = { route, attempt, error: error.message }; console.error(`${route}: ${error.message}`); }
    const index = results.findIndex(item => item.route === route);
    if (index === -1) results.push(result); else results[index] = result;
    await save();
  }
} finally {
  await chrome.kill();
  // A private, explicitly bounded path avoids chrome-launcher's Windows Temp cleanup race.
  if (path.dirname(profileDir) !== path.resolve(output)) throw new Error('Unexpected Chrome profile path');
  try { await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }); }
  catch { console.warn('Temporary browser profile retained until Windows releases its handles; reports are complete.'); }
}
if (results.some(result => result.error || result.performance < 90 || result.accessibility < 90)) process.exitCode = 1;
