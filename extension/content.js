/**
 * ERP Table Row Highlighter - Content Script
 * Firefox & Brave (IIT KGP CDC Placement Portal)
 * Focus: Row highlighting + draggable stats bar only.
 */

(function () {
  'use strict';

  if (window.__erpHighlighterLoaded) return;
  window.__erpHighlighterLoaded = true;

  const DEFAULT_CONFIG = {
    highlightCanApply: true,
    highlightApplied: true,
    highlightUrgent: true,
    dimExpired: true,
    hoverHighlight: true,
    showToolbar: true,
    urgentHours: 12,
    customColors: {
      appliedBg: '#bbf7d0',
      canApplyBg: '#bfdbfe',
      urgentBg: '#fecdd3',
      pinnedBg: '#fef08a'
    }
  };

  let config = { ...DEFAULT_CONFIG };
  let activeFilter = 'all';
  let observer = null;
  let debounceTimer = null;

  /* ── Load config from chrome.storage ── */
  function loadConfig(cb) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(DEFAULT_CONFIG, (items) => {
        config = { ...DEFAULT_CONFIG, ...items };
        if (config.customColors) {
          const r = document.documentElement;
          r.style.setProperty('--erp-applied', config.customColors.appliedBg);
          r.style.setProperty('--erp-can-apply', config.customColors.canApplyBg);
          r.style.setProperty('--erp-urgent', config.customColors.urgentBg);
        }
        if (cb) cb();
      });
    } else {
      if (cb) cb();
    }
  }

  /* ── Date parser: YYYY-MM-DD HH:MM or DD-MM-YYYY HH:MM ── */
  function parseDate(str) {
    if (!str) return null;
    const s = str.trim();
    // YYYY-MM-DD HH:MM
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2]-1, +m[3], +(m[4]||0), +(m[5]||0));
    // DD-MM-YYYY HH:MM
    m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[3], +m[2]-1, +m[1], +(m[4]||0), +(m[5]||0));
    return null;
  }

  /* ── Get text from a cell, stripping injected extension nodes ── */
  function cellText(td) {
    if (!td) return '';
    return td.textContent.trim();
  }

  /* ── Check if a specific table is strictly the CDC Placement grid ── */
  function isPlacementTable(table) {
    if (!table || table.nodeType !== 1) return false;

    // 1. In jqGrid (real ERP): Table must have the companyname column
    const hasJqCompany = !!table.querySelector('td[aria-describedby*="_companyname"], th[id*="_companyname"]');
    const hasJqDeadline = !!table.querySelector('td[aria-describedby$="_resumedeadline"]:not([aria-describedby*="_resumedeadline_st"]), th[id$="_resumedeadline"]:not([id*="_resumedeadline_st"])');
    const hasJqApply = !!table.querySelector('td[aria-describedby*="_apply"], th[id*="_apply"]');

    if (hasJqCompany && (hasJqDeadline || hasJqApply)) {
      return true;
    }

    // Check parent grid wrapper for companyname
    const gridId = table.id;
    if (gridId) {
      const gbox = document.getElementById('gbox_' + gridId) || table.closest('.ui-jqgrid');
      if (gbox) {
        const gboxCompany = !!gbox.querySelector(`th[id*="${gridId}_companyname"]`);
        const gboxDeadline = !!gbox.querySelector(`th[id$="${gridId}_resumedeadline"]:not([id*="_resumedeadline_st"])`);
        if (gboxCompany && gboxDeadline) {
          return true;
        }
      }
    }

    // 2. Plain / Mock tables: Must have explicit "Company" and ("Resume Upload End" or "Application Status") headers
    const ths = Array.from(table.querySelectorAll('thead th, tr:first-child th')).map(th => th.textContent.trim().toLowerCase());
    const hasCompanyTh = ths.some(t => t === 'company' || t === 'company name');
    const hasPlacementTh = ths.some(t => t.includes('resume upload end') || t.includes('application status') || t.includes('apply/acceptance'));

    if (hasCompanyTh && hasPlacementTh) {
      return true;
    }

    // 3. Local mock table support
    const href = window.location.href || '';
    if (href.includes('mock_table') || href.includes('mock_erp_test')) {
      if (table.id === 'grid37' || table.classList.contains('erp-table') || hasCompanyTh) {
        return true;
      }
    }

    return false;
  }

  /* ── Locate the single CDC Placement Table on page ── */
  function findCDCTable() {
    const tables = document.querySelectorAll('table.ui-jqgrid-btable, table[id^="grid"], table.erp-table, table');
    for (const t of tables) {
      if (isPlacementTable(t)) {
        return t;
      }
    }
    return null;
  }

  /* ── Check if current page/frame is the CDC Noticeboard / Placement portal ── */
  function isCDCNoticeboard() {
    const href = window.location.href || '';

    // 1. Direct CDC placement URL paths (Notice.jsp and TPStudent.jsp)
    if (/TrainingPlacementSSO\/(Notice|TPStudent)\.jsp/i.test(href) ||
        /TrainingPlacementSSO/i.test(href) ||
        /mock_erp_test|mock_table|firefox_frame/i.test(href)) {
      return true;
    }

    // 2. The placement table itself is present in the DOM
    if (findCDCTable()) {
      return true;
    }

    // 3. Explicit CDC placement grid banner text
    const bodyText = document.body ? (document.body.innerText || document.body.textContent || '') : '';
    if (bodyText.includes('Placement/Internship form will come in this grid')) {
      return true;
    }

    return false;
  }

  /* ── Main: scan all rows and colour them ── */
  function highlightAll() {
    if (!isCDCNoticeboard()) return;

    const cdcTable = findCDCTable();
    if (!cdcTable) {
      const bar = document.getElementById('erp-hl-bar');
      if (bar) bar.remove();
      return;
    }

    const now = new Date();
    const urgentMs = (config.urgentHours || 12) * 3600000;
    const stats = { total: 0, canApply: 0, applied: 0, urgent: 0, closed: 0 };

    // Resolve column indices for plain/mock tables if not using jqGrid aria-describedby
    const ths = Array.from(cdcTable.querySelectorAll('thead th, tr:first-child th')).map(th => th.textContent.trim().toLowerCase());
    const companyColIdx = ths.findIndex(t => t === 'company' || t === 'company name');
    const applyColIdx = ths.findIndex(t => t.includes('application status') || t.includes('apply'));
    const deadlineColIdx = ths.findIndex(t => t.includes('resume upload end') || t.includes('deadline'));

    /* STRICT: ONLY collect rows from the identified CDC placement table */
    const jqRows = cdcTable.querySelectorAll('tr.jqgrow');
    let rows = jqRows.length > 0 ? Array.from(jqRows) : Array.from(cdcTable.querySelectorAll('tbody tr'));

    rows.forEach(row => {
      /* Skip header or filter rows */
      if (row.classList.contains('ui-jqgrid-labels') || row.querySelector('th')) return;

      /* --- Resolve cells --- */
      let nameCell  = row.querySelector('td[aria-describedby*="_companyname"]');
      let applyCell = row.querySelector('td[aria-describedby*="_apply"]');
      // Strictly match the END deadline column, NEVER the start date column (resumedeadline_st)
      let endCell   = row.querySelector('td[aria-describedby$="_resumedeadline"]:not([aria-describedby*="_resumedeadline_st"])') ||
                      row.querySelector('td[aria-describedby="grid37_resumedeadline"]');

      /* Fallback for plain tables using exact header column index */
      if (!nameCell && companyColIdx !== -1) {
        const tds = row.querySelectorAll('td');
        if (tds[companyColIdx]) nameCell = tds[companyColIdx];
        if (applyColIdx !== -1 && tds[applyColIdx]) applyCell = tds[applyColIdx];
        if (deadlineColIdx !== -1 && tds[deadlineColIdx]) endCell = tds[deadlineColIdx];
      }

      /* MANDATORY REQUIREMENT: Row MUST have a valid, non-empty company name cell! */
      if (!nameCell || !cellText(nameCell)) {
        return; // Skip any row that is not an actual company row!
      }

      /* Must also have at least an apply cell or deadline cell */
      if (!applyCell && !endCell) {
        return;
      }

      /* --- Derive state --- */
      const appliedText = cellText(applyCell).toUpperCase();
      const isApplied   = (appliedText === 'Y' || appliedText === 'YES');
      const endDate     = parseDate(cellText(endCell));
      const isExpired   = endDate ? endDate < now : false;
      const timeLeft    = endDate ? endDate - now : 0;
      const isUrgent    = !isApplied && !isExpired && timeLeft > 0 && timeLeft <= urgentMs;
      const canApply    = !isApplied && !isExpired && (applyCell !== null || endCell !== null);

      /* --- Clear previous classes --- */
      row.classList.remove(
        'erp-applied', 'erp-can-apply', 'erp-urgent', 'erp-expired', 'erp-hidden'
      );

      /* --- Apply new class --- */
      if (isApplied) {
        if (config.highlightApplied) row.classList.add('erp-applied');
        stats.applied++;
      } else if (isExpired) {
        if (config.dimExpired) row.classList.add('erp-expired');
        stats.closed++;
      } else if (isUrgent) {
        if (config.highlightUrgent) row.classList.add('erp-urgent');
        stats.urgent++;
        stats.canApply++;
      } else if (canApply) {
        if (config.highlightCanApply) row.classList.add('erp-can-apply');
        stats.canApply++;
      }

      /* --- Apply active filter --- */
      let show = true;
      if      (activeFilter === 'applied')    show = isApplied;
      else if (activeFilter === 'can-apply')  show = canApply;
      else if (activeFilter === 'urgent')     show = isUrgent;
      else if (activeFilter === 'hide-closed') show = !isExpired || isApplied;

      if (!show) row.classList.add('erp-hidden');

      stats.total++;
    });

    if (config.showToolbar && stats.total > 0) {
      renderBar(stats);
    }

    return stats;
  }

  /* ── Debounced scan ── */
  function scan() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(highlightAll, 200);
  }

  /* ── Draggable floating stats bar ── */
  function renderBar(stats) {
    let bar = document.getElementById('erp-hl-bar');

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'erp-hl-bar';
      bar.innerHTML = `
        <div id="erp-hl-bar-drag" title="Drag to move">
          <span id="erp-hl-bar-logo">⚡</span>
          <span id="erp-hl-bar-title">ERP Highlighter</span>
          <button id="erp-hl-bar-min" title="Minimise">—</button>
          <button id="erp-hl-bar-close" title="Close">✕</button>
        </div>
        <div id="erp-hl-bar-body">
          <div id="erp-hl-bar-stats"></div>
          <div id="erp-hl-bar-filters"></div>
        </div>`;
      document.body.appendChild(bar);

      /* Minimise */
      bar.querySelector('#erp-hl-bar-min').addEventListener('click', (e) => {
        e.stopPropagation();
        const body = bar.querySelector('#erp-hl-bar-body');
        const isMin = body.style.display === 'none';
        body.style.display = isMin ? '' : 'none';
        bar.querySelector('#erp-hl-bar-min').textContent = isMin ? '—' : '□';
      });

      /* Close */
      bar.querySelector('#erp-hl-bar-close').addEventListener('click', (e) => {
        e.stopPropagation();
        config.showToolbar = false;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ showToolbar: false });
        }
        bar.remove();
      });

      /* Drag */
      makeDraggable(bar, bar.querySelector('#erp-hl-bar-drag'));
    }

    /* Update stats – build DOM safely (no innerHTML) */
    const statsEl = bar.querySelector('#erp-hl-bar-stats');
    while (statsEl.firstChild) statsEl.removeChild(statsEl.firstChild);
    const statsPills = [
      { cls: 'erp-pill-apply',  title: 'Can Apply',           icon: '⚡', label: `${stats.canApply} Can Apply` },
      { cls: 'erp-pill-applied',title: 'Applied',             icon: '✓',  label: `${stats.applied} Applied` },
      ...(stats.urgent > 0 ? [{ cls: 'erp-pill-urgent', title: 'Urgent (closing soon)', icon: '🔥', label: `${stats.urgent} Urgent` }] : []),
      { cls: 'erp-pill-closed', title: 'Closed / Expired',   icon: '⏳', label: `${stats.closed} Closed` },
      { cls: 'erp-pill-total',  title: 'Total rows',          icon: '∑',  label: String(stats.total) },
    ];
    statsPills.forEach(p => {
      const span = document.createElement('span');
      span.className = 'erp-pill ' + p.cls;
      span.title = p.title;
      span.textContent = p.icon + ' ' + p.label;
      statsEl.appendChild(span);
    });

    /* Update filter buttons */
    const filtersEl = bar.querySelector('#erp-hl-bar-filters');
    const filters = [
      { key: 'all',         label: `All (${stats.total})` },
      { key: 'can-apply',   label: `Can Apply (${stats.canApply})` },
      { key: 'applied',     label: `Applied (${stats.applied})` },
      { key: 'urgent',      label: `Urgent (${stats.urgent})` },
      { key: 'hide-closed', label: 'Hide Closed' },
    ];
    /* Update filter buttons – build DOM safely (no innerHTML) */
    while (filtersEl.firstChild) filtersEl.removeChild(filtersEl.firstChild);
    filters.forEach(f => {
      const btn = document.createElement('button');
      btn.className = 'erp-filter-btn' + (activeFilter === f.key ? ' active' : '');
      btn.dataset.f = f.key;
      btn.textContent = f.label;
      btn.addEventListener('click', () => {
        activeFilter = f.key;
        highlightAll();
      });
      filtersEl.appendChild(btn);
    });
  }

  /* ── Make element draggable ── */
  function makeDraggable(el, handle) {
    let startX, startY, origLeft, origTop;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      origLeft = rect.left;
      origTop  = rect.top;

      function onMove(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        el.style.left   = (origLeft + dx) + 'px';
        el.style.top    = (origTop  + dy) + 'px';
        el.style.right  = 'auto';
        el.style.bottom = 'auto';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /* ── MutationObserver to detect jqGrid async row injection ── */
  function setupObserver() {
    if (!isCDCNoticeboard()) return;
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.target && m.target.id === 'erp-hl-bar') continue;
        if (m.target && m.target.closest && m.target.closest('#erp-hl-bar')) continue;
        if (m.addedNodes.length > 0) {
          if (findCDCTable()) { scan(); break; }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ── Poll for async jqGrid load ── */
  function pollUntilRows() {
    if (!isCDCNoticeboard()) return;
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      const cdcTable = findCDCTable();
      if (cdcTable && cdcTable.querySelectorAll('tr.jqgrow, tbody tr').length > 0) {
        highlightAll();
        clearInterval(iv);
      }
      if (tries >= 30) clearInterval(iv);
    }, 400);
  }

  /* ── Storage change listener ── */
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes) => {
      for (const k in changes) config[k] = changes[k].newValue;
      const r = document.documentElement;
      if (config.customColors) {
        r.style.setProperty('--erp-applied',   config.customColors.appliedBg);
        r.style.setProperty('--erp-can-apply',  config.customColors.canApplyBg);
        r.style.setProperty('--erp-urgent',     config.customColors.urgentBg);
      }
      highlightAll();
    });
  }

  /* ── Boot ── */
  function init() {
    // Only activate on IIT KGP ERP CDC Noticeboard / Placement portal
    if (!isCDCNoticeboard()) {
      return;
    }

    loadConfig(() => {
      highlightAll();
      setupObserver();
      pollUntilRows();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
