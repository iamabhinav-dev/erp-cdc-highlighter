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

  /* ── Main: scan all rows and colour them ── */
  function highlightAll() {
    const now = new Date();
    const urgentMs = (config.urgentHours || 12) * 3600000;

    const stats = { total: 0, canApply: 0, applied: 0, urgent: 0, closed: 0 };

    /* Collect candidate row sets from jqGrid or plain tables */
    let rows = [];

    /* 1. jqGrid rows: tr.jqgrow */
    const jqRows = document.querySelectorAll('tr.jqgrow');
    if (jqRows.length > 0) {
      rows = Array.from(jqRows);
    } else {
      /* 2. Fallback: plain <table> rows (our mock) */
      document.querySelectorAll('table tbody tr').forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length >= 5) rows.push(tr);
      });
    }

    rows.forEach(row => {
      /* --- Resolve cells --- */
      /* Try jqGrid aria-describedby first */
      let applyCell  = row.querySelector('td[aria-describedby$="_apply"]');
      let endCell    = row.querySelector('td[aria-describedby$="_resumedeadline"]');
      let nameCell   = row.querySelector('td[aria-describedby$="_companyname"]');

      /* Fallback for plain tables: scan positionally */
      if (!applyCell && !endCell) {
        const tds = row.querySelectorAll('td');
        tds.forEach(td => {
          const t = td.textContent.trim().toUpperCase();
          if (t === 'Y' && !applyCell) applyCell = td;
        });
        /* Find deadline by date pattern (last date-looking cell) */
        let lastDate = null, lastDateCell = null;
        tds.forEach(td => {
          const d = parseDate(td.textContent);
          if (d) { lastDate = d; lastDateCell = td; }
        });
        endCell = lastDateCell;
      }

      /* --- Derive state --- */
      const appliedText = cellText(applyCell).toUpperCase();
      const isApplied   = (appliedText === 'Y' || appliedText === 'YES');
      const endDate     = parseDate(cellText(endCell));
      const isExpired   = endDate ? endDate < now : false;
      const timeLeft    = endDate ? endDate - now : 0;
      const isUrgent    = !isApplied && !isExpired && timeLeft > 0 && timeLeft <= urgentMs;
      const canApply    = !isApplied && !isExpired;

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

    /* Update stats */
    const statsEl = bar.querySelector('#erp-hl-bar-stats');
    statsEl.innerHTML = `
      <span class="erp-pill erp-pill-apply"  title="Can Apply">⚡ ${stats.canApply} Can Apply</span>
      <span class="erp-pill erp-pill-applied" title="Applied">✓ ${stats.applied} Applied</span>
      ${stats.urgent > 0 ? `<span class="erp-pill erp-pill-urgent" title="Urgent (closing soon)">🔥 ${stats.urgent} Urgent</span>` : ''}
      <span class="erp-pill erp-pill-closed"  title="Closed / Expired">⏳ ${stats.closed} Closed</span>
      <span class="erp-pill erp-pill-total"   title="Total rows">∑ ${stats.total}</span>`;

    /* Update filter buttons */
    const filtersEl = bar.querySelector('#erp-hl-bar-filters');
    const filters = [
      { key: 'all',         label: `All (${stats.total})` },
      { key: 'can-apply',   label: `Can Apply (${stats.canApply})` },
      { key: 'applied',     label: `Applied (${stats.applied})` },
      { key: 'urgent',      label: `Urgent (${stats.urgent})` },
      { key: 'hide-closed', label: 'Hide Closed' },
    ];
    filtersEl.innerHTML = filters.map(f =>
      `<button class="erp-filter-btn${activeFilter === f.key ? ' active' : ''}" data-f="${f.key}">${f.label}</button>`
    ).join('');
    filtersEl.querySelectorAll('.erp-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.f;
        highlightAll();
      });
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
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.target && m.target.id === 'erp-hl-bar') continue;
        if (m.target && m.target.closest && m.target.closest('#erp-hl-bar')) continue;
        if (m.addedNodes.length > 0) { scan(); break; }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ── Poll for async jqGrid load ── */
  function pollUntilRows() {
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (document.querySelectorAll('tr.jqgrow').length > 0 ||
          document.querySelectorAll('table tbody tr td').length > 0) {
        highlightAll();
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
