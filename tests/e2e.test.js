// End-to-end test for the ERP Table Row Highlighter.
//
// Launches a Chromium-based browser (Brave by default) with the unpacked extension, and serves
// the CDC pages at their real erp.iitkgp.ac.in URLs via request interception, so the content
// script injects exactly as it does on the live portal:
//   - outer ERP shell with <iframe id="myframe">
//   - fixtures/TPStudent.html: the real CDC frame markup + jqGrid setup (personal data removed)
//   - real jQuery / jqGrid 4.6 / jQuery UI (downloaded once into tests/.cache)
//   - ERPMonitoring.htm: generated rows with deadlines relative to "now"
// The browser clock runs in America/New_York to prove deadlines are read as IST.
//
// Usage:  cd tests && npm install && npm test          (full run, ~3 min)
//         npm run test:quick                           (skips the wait-for-deadline check)
// Env:    BROWSER_PATH=/path/to/brave-or-chromium       (auto-detected otherwise)

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const QUICK = process.argv.includes('--quick');
const EXT = fs.realpathSync(path.join(__dirname, '..', 'extension'));
const FRAME_HTML = fs.readFileSync(path.join(__dirname, 'fixtures', 'TPStudent.html'), 'utf8');
const CACHE = path.join(__dirname, '.cache');
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

// Third-party libraries the ERP page loads, fetched once and cached (not committed).
// The npm build of jqGrid 4.6 is CommonJS-wrapped, so it is unwrapped for the browser.
const LIBS = {
  'jquery.js':  { url: 'https://cdn.jsdelivr.net/npm/jquery@1.9.1/jquery.min.js' },
  'jqgrid.js':  { url: 'https://cdn.jsdelivr.net/npm/jqgrid@4.6.0/js/jquery.jqGrid.src.js', cjs: true },
  'locale.js':  { url: 'https://cdn.jsdelivr.net/npm/jqgrid@4.6.0/js/i18n/grid.locale-en.js', cjs: true },
  'jqgrid.css': { url: 'https://cdn.jsdelivr.net/npm/jqgrid@4.6.0/css/ui.jqgrid.css' },
  'jqui.js':    { url: 'https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.10.3/jquery-ui.min.js' },
  'jqui.css':   { url: 'https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.10.3/themes/smoothness/jquery-ui.min.css' },
};
async function ensureLibs() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [file, { url, cjs }] of Object.entries(LIBS)) {
    const dest = path.join(CACHE, file);
    if (fs.existsSync(dest)) continue;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed: ${url} (${res.status})`);
    let text = await res.text();
    if (cjs) text = `var module={exports:{}};\n${text}\n;module.exports(jQuery);`;
    fs.writeFileSync(dest, text);
  }
}
const LIB = f => fs.readFileSync(path.join(CACHE, f));

function findBrowser() {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  const candidates = [
    '/usr/bin/brave-browser', '/usr/bin/brave', '/snap/bin/brave', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('No Brave/Chromium found — set BROWSER_PATH. (Google Chrome 137+ cannot load unpacked extensions from the command line.)');
  return found;
}

// IST wall-clock string, like the ERP shows
const ist = ms => new Date(ms + 330 * 60000).toISOString().slice(0, 16).replace('T', ' ');
const now = Date.now();
// A deadline on the next IST minute boundary that is at least 30s away -> flips to closed during the test
let flipAt = Math.ceil((now + 30000) / 60000) * 60000;
const ROWS = [
  ['Applied Open Co',   'Y', now + 864e5],
  ['Open Co',           '',  now + 3 * 864e5],
  ['Urgent Co',         '',  now + 3 * 36e5],
  ['Closed Co',         '',  now - 2 * 36e5],
  ['Applied Closed Co', 'Y', now - 864e5],
  ['Flips Soon Co',     '',  flipAt],
  ['20h Away Co',       '',  now + 20 * 36e5],
];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const xml = `<?xml version="1.0" encoding="UTF-8"?><rows><page>1</page><total>1</total><records>${ROWS.length}</records>` +
  ROWS.map(([name, ap, dl], i) => {
    // colModel order: companyname view2 view3 designation description ctc Currency view1 apply resumedeadline_st resumedeadline interview_date_confirmed contract view
    const cells = [name, '', '', 'Engineer', '', '1000000', 'INR', '', ap, ist(dl - 2 * 864e5), ist(dl), '', '', ''];
    return `<row id="${i + 1}">` + cells.map(c => `<cell>${esc(c)}</cell>`).join('') + '</row>';
  }).join('') + '</rows>';

const OUTER = `<!doctype html><html><body style="margin:0;font-family:sans-serif">
<div style="padding:10px;background:#eee">Academic &nbsp; Accounts &nbsp; <b>CDC</b> — mock ERP shell</div>
<iframe id="myframe" src="https://erp.iitkgp.ac.in/TrainingPlacementSSO/TPStudent.jsp" style="width:100%;height:760px;border:0"></iframe>
</body></html>`;

function route(url) {
  const u = url.toLowerCase();
  if (u.includes('/iit_erp3/showmenu')) return ['text/html', OUTER];
  if (u.includes('tpstudent.jsp')) return ['text/html', FRAME_HTML];
  if (u.includes('erpmonitoring.htm')) return ['text/xml', xml];
  if (u.includes('jquery.jqgrid')) return ['application/javascript', LIB('jqgrid.js')];
  if (u.includes('grid.locale-en')) return ['application/javascript', LIB('locale.js')];
  if (/jquery-1\.9\.\d(\.min)?\.js/.test(u)) return ['application/javascript', LIB('jquery.js')];
  if (u.includes('jquery-ui-1.10.3.custom.min.js')) return ['application/javascript', LIB('jqui.js')];
  if (u.includes('ui.jqgrid.css')) return ['text/css', LIB('jqgrid.css')];
  if (u.includes('jquery-ui-1.10.3.custom.css')) return ['text/css', LIB('jqui.css')];
  return null;
}

// Unpacked extension id = sha256(abs path) first 32 hex chars mapped 0-f -> a-p
const extId = crypto.createHash('sha256').update(EXT).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); };

(async () => {
  await ensureLibs();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-hl-test-'));
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    userDataDir: profile,
    env: { ...process.env, TZ: 'America/New_York' },
    args: [
      `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-first-run', '--window-size=1400,950',
    ],
    defaultViewport: { width: 1400, height: 950 },
  });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', req => {
    const r = route(req.url());
    if (r) req.respond({ status: 200, contentType: r[0], body: r[1] });
    else if (req.url().startsWith('https://erp.iitkgp.ac.in')) req.respond({ status: 404, body: '' });
    else req.continue();
  });
  page.on('pageerror', e => console.log('  [page error]', e.message.split('\n')[0]));

  console.log('Browser clock TZ:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), '| ext id', extId);
  await page.goto('https://erp.iitkgp.ac.in/IIT_ERP3/showmenu.htm', { waitUntil: 'networkidle0' });
  const frame = () => page.frames().find(f => f.url().includes('TPStudent.jsp'));
  await sleep(2500);

  const state = () => frame().evaluate(() => ({
    rows: [...document.querySelectorAll('#grid37 tr.jqgrow')].map(r => [
      r.querySelector('td[aria-describedby="grid37_companyname"]').textContent.trim(),
      (r.className.match(/erp-[a-z-]+/g) || []).join(' ') || '-',
      getComputedStyle(r).display]),
    bar: !!document.getElementById('erp-hl-bar'),
    pills: [...document.querySelectorAll('#erp-hl-bar-stats .erp-pill')].map(p => p.textContent),
    htable: !!document.querySelector('table.ui-jqgrid-htable th#grid37_companyname'),
  }));
  const cls = (s, name) => s.rows.find(r => r[0] === name)[1];

  let s = await state();
  console.log('\n— Initial load —');
  console.log('  real jqGrid header table present before data table:', s.htable);
  s.rows.forEach(r => console.log('   ', r[0].padEnd(18), r[1]));
  console.log('  bar:', s.pills.join(' · '));
  check('extension injected + bar shown', s.bar);
  // Initial position: top-right corner of the CDC frame, fully visible in the browser window
  const pos = await frame().evaluate(() => {
    const r = document.getElementById('erp-hl-bar').getBoundingClientRect();
    return { top: r.top, rightGap: document.documentElement.clientWidth - r.right, left: r.left, frameW: document.documentElement.clientWidth };
  });
  const winBox = await (await frame().$('#erp-hl-bar')).boundingBox();
  const win = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  check('bar starts at the top-right of the CDC frame', Math.round(pos.top) === 18 && Math.round(pos.rightGap) === 20 && pos.left > pos.frameW / 2,
    `top ${Math.round(pos.top)}px, right gap ${Math.round(pos.rightGap)}px`);
  check('bar starts fully visible in the top-right of the window',
    winBox.x >= 0 && winBox.y >= 0 && winBox.x + winBox.width <= win.w && winBox.x > win.w / 2 && winBox.y < win.h / 4,
    `x ${Math.round(winBox.x)}–${Math.round(winBox.x + winBox.width)} of ${win.w}, y ${Math.round(winBox.y)}`);
  check('Applied Open Co -> applied', cls(s, 'Applied Open Co') === 'erp-applied');
  check('Open Co -> can-apply', cls(s, 'Open Co') === 'erp-can-apply');
  check('Urgent Co (3h) -> urgent', cls(s, 'Urgent Co') === 'erp-urgent');
  check('Closed Co -> expired', cls(s, 'Closed Co') === 'erp-expired');
  check('Applied Closed Co -> applied', cls(s, 'Applied Closed Co') === 'erp-applied');
  check('20h Away Co -> can-apply (threshold 12h)', cls(s, '20h Away Co') === 'erp-can-apply');
  check('Flips Soon Co not closed yet', cls(s, 'Flips Soon Co') !== 'erp-expired', cls(s, 'Flips Soon Co'));
  await page.screenshot({ path: path.join(SHOTS, '1-initial.png') });

  console.log('\n— Filters —');
  const clickFilter = async key => { await frame().click(`.erp-filter-btn[data-f="${key}"]`); await sleep(200); return state(); };
  const visible = st => st.rows.filter(r => r[2] !== 'none').map(r => r[0]);
  s = await clickFilter('applied');
  check('Applied filter', JSON.stringify(visible(s)) === JSON.stringify(['Applied Open Co', 'Applied Closed Co']), visible(s).join(', '));
  s = await clickFilter('urgent');
  check('Urgent filter', visible(s).includes('Urgent Co') && !visible(s).includes('Open Co'), visible(s).join(', '));
  await page.screenshot({ path: path.join(SHOTS, '2-urgent-filter.png') });
  s = await clickFilter('hide-closed');
  check('Hide Closed filter', !visible(s).includes('Closed Co') && visible(s).includes('Applied Closed Co'), visible(s).join(', '));
  s = await clickFilter('all');
  check('All filter', visible(s).length === ROWS.length);

  console.log('\n— Floating bar: counts & filter buttons —');
  const barInfo = () => frame().evaluate(() => {
    const bar = document.getElementById('erp-hl-bar');
    if (!bar) return null;
    const r = bar.getBoundingClientRect();
    const body = bar.querySelector('#erp-hl-bar-body');
    return {
      left: r.left, top: r.top, width: r.width, height: r.height,
      bodyHidden: getComputedStyle(body).display === 'none',
      minText: bar.querySelector('#erp-hl-bar-min').textContent,
      active: [...bar.querySelectorAll('.erp-filter-btn.active')].map(b => b.dataset.f),
      buttons: [...bar.querySelectorAll('.erp-filter-btn')].map(b => b.textContent),
      pills: [...bar.querySelectorAll('.erp-pill')].map(p => p.textContent),
    };
  });
  let b = await barInfo();
  const count = c => s.rows.filter(r => r[1] === c).length;
  s = await state();
  const expectPills = [`⚡ ${count('erp-can-apply') + count('erp-urgent')} Can Apply`, `✓ ${count('erp-applied')} Applied`,
    `🔥 ${count('erp-urgent')} Urgent`, `⏳ ${count('erp-expired')} Closed`, `∑ ${s.rows.length}`];
  check('stat pills match the row colours', JSON.stringify(b.pills) === JSON.stringify(expectPills), b.pills.join(' · '));
  check('filter button labels carry counts', b.buttons.join('|') ===
    `All (7)|Can Apply (${count('erp-can-apply') + count('erp-urgent')})|Applied (${count('erp-applied')})|Urgent (${count('erp-urgent')})|Hide Closed`, b.buttons.join(' | '));
  check('"All" is highlighted by default', JSON.stringify(b.active) === '["all"]', b.active.join());
  for (const key of ['can-apply', 'applied', 'urgent', 'hide-closed', 'all']) {
    s = await clickFilter(key);
    b = await barInfo();
    check(`clicking "${key}" highlights only that button`, JSON.stringify(b.active) === JSON.stringify([key]), b.active.join());
  }
  s = await clickFilter('can-apply');
  check('Can Apply filter shows open + urgent, hides applied/closed',
    JSON.stringify(visible(s)) === JSON.stringify(['Open Co', 'Urgent Co', 'Flips Soon Co', '20h Away Co']), visible(s).join(', '));
  s = await clickFilter('all');

  console.log('\n— Floating bar: drag —');
  const title = await frame().$('#erp-hl-bar-title');
  const tb = await title.boundingBox();               // page coordinates (iframe offset included)
  const b0 = await barInfo();
  const drag = async (x, y, dx, dy) => {
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + dx * i / 10, y + dy * i / 10);
    await page.mouse.up(); await sleep(100);
  };
  await drag(tb.x + 10, tb.y + tb.height / 2, -500, 300);
  const b1 = await barInfo();
  check('dragging the title bar moves the bar by the mouse delta',
    Math.round(b1.left - b0.left) === -500 && Math.round(b1.top - b0.top) === 300,
    `moved ${Math.round(b1.left - b0.left)}, ${Math.round(b1.top - b0.top)}`);
  check('bar keeps its size while dragging', Math.round(b1.width) === Math.round(b0.width), `${b0.width} -> ${b1.width}`);
  const moveAfterUp = async () => { await page.mouse.move(tb.x - 200, tb.y + 400); await sleep(100); return barInfo(); };
  const b2 = await moveAfterUp();
  check('bar stops following the mouse after release', b2.left === b1.left && b2.top === b1.top);
  // Dragging from the stats area (not the handle) must not move it
  const pill = await (await frame().$('.erp-pill')).boundingBox();
  await drag(pill.x + 5, pill.y + 5, 150, 150);
  const b3 = await barInfo();
  check('dragging from the stats area does not move the bar', b3.left === b1.left && b3.top === b1.top);
  // Pressing on a header button must not start a drag
  const minBox = await (await frame().$('#erp-hl-bar-min')).boundingBox();
  await page.mouse.move(minBox.x + minBox.width / 2, minBox.y + minBox.height / 2);
  await page.mouse.down(); await page.mouse.move(minBox.x + 200, minBox.y + 100, { steps: 5 });
  await page.mouse.up(); await sleep(100);
  const b4 = await barInfo();
  check('press-and-drag on a header button does not move the bar', b4.left === b1.left && b4.top === b1.top);
  check('…and does not count as a minimise click', !b4.bodyHidden);
  // Position survives a re-scan (filter click re-renders pills/buttons)
  s = await clickFilter('urgent'); s = await clickFilter('all');
  const b5 = await barInfo();
  check('bar position survives a re-scan', b5.left === b1.left && b5.top === b1.top);
  const sel = await frame().evaluate(() => String(window.getSelection()));
  check('dragging does not select page text', sel === '', JSON.stringify(sel.slice(0, 40)));
  await page.screenshot({ path: path.join(SHOTS, '2b-dragged.png') });

  console.log('\n— Floating bar: minimise (—) —');
  await frame().click('#erp-hl-bar-min'); await sleep(150);
  let bm = await barInfo();
  check('— hides the stats & filters', bm.bodyHidden);
  check('— turns into □ (restore)', bm.minText === '□', bm.minText);
  check('minimised bar is shorter', bm.height < b5.height - 20, `${b5.height} -> ${bm.height}`);
  // Trigger a re-scan via a DOM change (the MutationObserver path)
  await frame().evaluate(() => document.getElementById('grid37').appendChild(document.createElement('tbody')));
  await sleep(500);
  bm = await barInfo();
  check('stays minimised after a re-scan', bm.bodyHidden && bm.minText === '□');
  const tb2 = await (await frame().$('#erp-hl-bar-title')).boundingBox();
  await drag(tb2.x + 10, tb2.y + tb2.height / 2, 100, -50);
  const bm2 = await barInfo();
  check('minimised bar can still be dragged', Math.round(bm2.left - bm.left) === 100 && Math.round(bm2.top - bm.top) === -50,
    `moved ${Math.round(bm2.left - bm.left)}, ${Math.round(bm2.top - bm.top)}`);
  await page.screenshot({ path: path.join(SHOTS, '2c-minimised.png') });
  await frame().click('#erp-hl-bar-min'); await sleep(150);
  bm = await barInfo();
  check('□ restores the stats & filters', !bm.bodyHidden && bm.minText === '—');
  check('filters work again after restore', (await clickFilter('applied')) && (await barInfo()).active[0] === 'applied');
  s = await clickFilter('all');

  console.log('\n— Closed row styling —');
  const op = await frame().evaluate(() => {
    const r = [...document.querySelectorAll('#grid37 tr.erp-expired')][0];
    return { tr: getComputedStyle(r).opacity, td: getComputedStyle(r.cells[1]).opacity };
  });
  check('closed row: tr opacity 1, cells 0.4 (no double fade)', op.tr === '1' && op.td === '0.4', JSON.stringify(op));

  console.log('\n— Popup → page (via chrome.storage) —');
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await sleep(300);
  await popup.screenshot({ path: path.join(SHOTS, '3-popup.png') });
  // Urgent threshold 24h -> 20h Away Co becomes urgent
  await popup.$eval('#urgentHours', el => { el.value = '24'; el.dispatchEvent(new Event('change')); });
  await sleep(500);
  s = await state();
  check('urgent threshold 24h -> 20h Away Co urgent', cls(s, '20h Away Co') === 'erp-urgent', cls(s, '20h Away Co'));
  // Custom colour
  await popup.$eval('#colorCanApply', el => { el.value = '#ffa500'; el.dispatchEvent(new Event('input')); });
  await sleep(400);
  const bg = await frame().evaluate(() => getComputedStyle(document.querySelector('#grid37 tr.erp-can-apply td')).backgroundColor);
  check('custom can-apply colour applied to page', bg === 'rgb(255, 165, 0)', bg);
  const lbl = await popup.$eval('#lblCanApply', e => getComputedStyle(e).color);
  check('popup ■ label follows colour', lbl === 'rgb(255, 165, 0)', lbl);
  // Toolbar toggle by clicking row text
  await popup.click('.sw:has(#toggleToolbar) .sl');
  await sleep(400);
  s = await state();
  check('turning off floating bar removes it', !s.bar);
  await popup.click('label.row:has(#toggleToolbar) .lbl');
  await sleep(400);
  s = await state();
  check('clicking row text turns it back on', s.bar);
  // Clicking a colour row's text must not toggle anything
  const before = await popup.$eval('#toggleApplied', e => e.checked);
  await popup.click('#lblApplied');
  const after = await popup.$eval('#toggleApplied', e => e.checked);
  check('clicking colour-row text does not flip its toggle', before === after);
  await popup.click('.sw:has(#toggleApplied) .sl');
  await sleep(400);
  s = await state();
  check('colour-row switch still works (Applied highlight off)', cls(s, 'Applied Open Co') === '-', cls(s, 'Applied Open Co'));
  await popup.click('.sw:has(#toggleApplied) .sl');
  await popup.$eval('#colorCanApply', el => { el.value = '#bfdbfe'; el.dispatchEvent(new Event('input')); });
  await popup.$eval('#urgentHours', el => { el.value = '12'; el.dispatchEvent(new Event('change')); });
  await popup.close();
  await sleep(400);
  await page.bringToFront();
  await page.screenshot({ path: path.join(SHOTS, '4-after-popup.png') });

  console.log('\n— Floating bar: close (✕) —');
  await frame().click('#erp-hl-bar-close'); await sleep(300);
  s = await state();
  check('✕ removes the bar', !s.bar);
  check('rows stay highlighted after closing the bar', cls(s, 'Open Co') === 'erp-can-apply');
  await frame().evaluate(() => document.getElementById('grid37').appendChild(document.createElement('tbody')));
  await sleep(500);
  check('bar does not come back on a re-scan', !(await state()).bar);
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(2500);
  s = await state();
  check('bar stays closed after a page reload (remembered)', !s.bar && cls(s, 'Open Co') === 'erp-can-apply');
  const popup2 = await browser.newPage();
  await popup2.goto(`chrome-extension://${extId}/popup.html`); await sleep(300);
  check('popup shows "Show floating bar" as off', !(await popup2.$eval('#toggleToolbar', e => e.checked)));
  await popup2.click('.sw:has(#toggleToolbar) .sl'); await sleep(400);
  await popup2.close(); await page.bringToFront();
  s = await state();
  check('turning it back on in the popup restores the bar', s.bar);

  if (QUICK) {
    console.log('\n— Time passing — skipped (--quick)');
  } else {
    console.log('\n— Time passing (60s rescan, no DOM changes) —');
    const waitMs = flipAt - Date.now() + 62000;
    console.log(`  waiting ${Math.round(waitMs / 1000)}s for "Flips Soon Co" deadline (${ist(flipAt)} IST) + next rescan...`);
    await sleep(waitMs);
    s = await state();
    check('Flips Soon Co became expired without reload', cls(s, 'Flips Soon Co') === 'erp-expired', cls(s, 'Flips Soon Co'));
    console.log('  bar:', s.pills.join(' · '));
    await page.screenshot({ path: path.join(SHOTS, '5-after-deadline.png') });
  }

  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
  console.log(`\n${failures ? failures + ' FAILED' : 'ALL PASSED'}  — screenshots in ${SHOTS}`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
