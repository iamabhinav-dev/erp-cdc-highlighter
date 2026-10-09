/**
 * ERP Highlighter – Popup Controller
 */
document.addEventListener('DOMContentLoaded', () => {
  const DEFAULTS = {
    highlightCanApply: true,
    highlightApplied: true,
    highlightUrgent: true,
    dimExpired: true,
    showToolbar: true,
    hoverHighlight: true,
    urgentHours: 12,
    customColors: {
      appliedBg:  '#bbf7d0',
      canApplyBg: '#bfdbfe',
      urgentBg:   '#fecdd3',
    }
  };

  const ids = [
    'toggleCanApply', 'toggleApplied', 'toggleUrgent',
    'toggleExpired', 'toggleToolbar', 'colorApplied',
    'colorCanApply', 'colorUrgent', 'urgentHours',
    'btnReset', 'btnReload'
  ];
  const el = {};
  ids.forEach(id => { el[id] = document.getElementById(id); });

  function applyToUI(c) {
    el.toggleCanApply.checked = c.highlightCanApply;
    el.toggleApplied.checked  = c.highlightApplied;
    el.toggleUrgent.checked   = c.highlightUrgent;
    el.toggleExpired.checked  = c.dimExpired;
    el.toggleToolbar.checked  = c.showToolbar;
    if (c.customColors) {
      el.colorApplied.value  = c.customColors.appliedBg  || '#bbf7d0';
      el.colorCanApply.value = c.customColors.canApplyBg || '#bfdbfe';
      el.colorUrgent.value   = c.customColors.urgentBg   || '#fecdd3';
    }
    if (el.urgentHours) el.urgentHours.value = c.urgentHours || 12;
  }

  chrome.storage.local.get(DEFAULTS, applyToUI);

  function save() {
    chrome.storage.local.set({
      highlightCanApply: el.toggleCanApply.checked,
      highlightApplied:  el.toggleApplied.checked,
      highlightUrgent:   el.toggleUrgent.checked,
      dimExpired:        el.toggleExpired.checked,
      showToolbar:       el.toggleToolbar.checked,
      urgentHours:       parseInt(el.urgentHours ? el.urgentHours.value : 12, 10) || 12,
      customColors: {
        appliedBg:  el.colorApplied.value,
        canApplyBg: el.colorCanApply.value,
        urgentBg:   el.colorUrgent.value,
      }
    });
  }

  [el.toggleCanApply, el.toggleApplied, el.toggleUrgent,
   el.toggleExpired, el.toggleToolbar].forEach(t => t && t.addEventListener('change', save));

  [el.colorApplied, el.colorCanApply, el.colorUrgent].forEach(c => c && c.addEventListener('input', save));
  if (el.urgentHours) el.urgentHours.addEventListener('change', save);

  if (el.btnReset) el.btnReset.addEventListener('click', () => {
    chrome.storage.local.set(DEFAULTS, () => applyToUI(DEFAULTS));
  });

  if (el.btnReload) el.btnReload.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.reload(tabs[0].id);
      window.close();
    });
  });
});
