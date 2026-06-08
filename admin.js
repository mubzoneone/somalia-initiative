(() => {
'use strict';

window.SI_STRICT_WRITE_INIT = true;

function genId() {
  return Math.random().toString(36).slice(2, 9);
}

// ── HELPERS ─────────────────────────────────────────────────────────────────
const fmt       = n => {
  const num = Math.round(Number(n) * 100) / 100;
  const hasPence = !Number.isInteger(num);
  return (
    '£' +
    num.toLocaleString('en-GB', {
      minimumFractionDigits: hasPence ? 2 : 0,
      maximumFractionDigits: hasPence ? 2 : 0,
    })
  );
};
const fmtAmount = n => Number(n) > 0 ? fmt(n) : '—';
const esc       = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function rowStatusBadge(amount, kind) {
  const ok = Number(amount) > 0;
  const label = kind === 'donor'
    ? (ok ? 'Paid' : 'Unpaid')
    : (ok ? 'Sent' : 'Not sent');
  const mod = ok ? 'success' : 'danger';
  return `<span class="status-badge status-badge--${mod}">${label}</span>`;
}
const sum       = arr => arr.reduce((t, n) => t + Number(n), 0);

function ensureMonthHidden(month) {
  if (!month.hiddenDonors) month.hiddenDonors = [];
  if (!month.hiddenRecipients) month.hiddenRecipients = [];
}

function isPersonHidden(month, kind, personId) {
  ensureMonthHidden(month);
  const list = kind === 'donor' ? month.hiddenDonors : month.hiddenRecipients;
  return list.includes(personId);
}

function setPersonHidden(month, kind, personId, hidden) {
  ensureMonthHidden(month);
  const list = kind === 'donor' ? month.hiddenDonors : month.hiddenRecipients;
  const i = list.indexOf(personId);
  if (hidden && i === -1) list.push(personId);
  else if (!hidden && i !== -1) list.splice(i, 1);
}

function hasHiddenPeople(month, kind) {
  if (!month) return false;
  ensureMonthHidden(month);
  const list = kind === 'recipients' ? month.hiddenRecipients : month.hiddenDonors;
  return list.length > 0;
}

function isPersonArchived(p) { return !!p?.archived; }
function activeDonors(data)     { return (data.donors || []).filter(d => !isPersonArchived(d)); }
function activeRecipients(data) { return (data.recipients || []).filter(r => !isPersonArchived(r)); }
function findDonor(data, id)     { return (data.donors || []).find(d => d.id === id); }
function findRecipient(data, id) { return (data.recipients || []).find(r => r.id === id); }

function donorsForPills(data, selectedId) {
  const list = activeDonors(data);
  const selected = findDonor(data, selectedId);
  if (selected && isPersonArchived(selected) && !list.some(d => d.id === selectedId)) {
    return [...list, selected];
  }
  return list;
}

function recipientsForPills(data, selectedId) {
  const list = activeRecipients(data);
  const selected = findRecipient(data, selectedId);
  if (selected && isPersonArchived(selected) && !list.some(r => r.id === selectedId)) {
    return [...list, selected];
  }
  return list;
}

function isPersonReferencedInReports(data, kind, id) {
  const listKey = kind === 'donor' ? 'donations' : 'distributions';
  const idField = kind === 'donor' ? 'donorId' : 'recipientId';
  return Object.values(data.months || {}).some(month => {
    const hasRow = (month[listKey] || []).some(row => row[idField] === id);
    return hasRow && !isPersonHidden(month, kind, id);
  });
}

function purgePersonFromAllMonths(data, kind, id) {
  const listKey = kind === 'donor' ? 'donations' : 'distributions';
  const idField = kind === 'donor' ? 'donorId' : 'recipientId';
  const hiddenKey = kind === 'donor' ? 'hiddenDonors' : 'hiddenRecipients';
  Object.values(data.months || {}).forEach(month => {
    if (month[listKey]) {
      month[listKey] = month[listKey].filter(row => row[idField] !== id);
    }
    ensureMonthHidden(month);
    const hidden = month[hiddenKey];
    const hi = hidden.indexOf(id);
    if (hi !== -1) hidden.splice(hi, 1);
  });
}

function archiveOrRemovePerson(data, type, id) {
  const kind = type === 'donor' ? 'donor' : 'recipient';
  const list = type === 'donor' ? data.donors : data.recipients;
  const person = list.find(p => p.id === id);
  if (!person) return;
  if (isPersonReferencedInReports(data, kind, id)) {
    person.archived = true;
  } else {
    purgePersonFromAllMonths(data, kind, id);
    const i = list.indexOf(person);
    if (i !== -1) list.splice(i, 1);
  }
}

function deletePeopleConfirmMessage(data, type, ids) {
  const kind = type === 'donor' ? 'donor' : 'recipient';
  const idList = [...ids];
  const anyReferenced = idList.some(id => isPersonReferencedInReports(data, kind, id));
  const n = idList.length;
  if (n === 1) {
    if (anyReferenced) {
      return 'They\u2019ll be archived. Their name will stay on past reports.';
    }
    return 'They\u2019ll be removed completely. They aren\u2019t on any reports.';
  }
  if (anyReferenced) {
    return `${n} people will be archived. Names will stay on past reports where they appear.`;
  }
  return `${n} people will be removed completely. None appear on any reports.`;
}

function rosterPillsHtml(people, opts = {}) {
  const {
    isChecked = () => false,
    emptyMessage = 'No people on the People tab yet.',
    inputClass = 'manage-roster-toggle',
    dataKind = '',
    ariaVerb = 'Include',
  } = opts;

  if (!people.length) {
    return `<p class="manage-roster-note manage-roster-note--empty">${esc(emptyMessage)}</p>`;
  }

  const kindAttr = dataKind ? ` data-kind="${esc(dataKind)}"` : '';
  const pills = people.map(p => {
    const checked = isChecked(p);
    return `<label class="pill-option">
      <input type="checkbox" class="${esc(inputClass)}" data-person-id="${esc(p.id)}"${kindAttr}${checked ? ' checked' : ''} aria-label="${esc(ariaVerb)} ${esc(p.name)} in this report">
      <span class="pill-option__text">${esc(p.name)}</span>
    </label>`;
  }).join('');
  return `<div class="pill-group" role="group">${pills}</div>`;
}

function applyMonthRosterFromCheckboxes(month, people, personKind, checkboxClass) {
  ensureMonthHidden(month);
  const isRecipients = personKind === 'recipient';
  const listKey = isRecipients ? 'distributions' : 'donations';
  const idField = isRecipients ? 'recipientId' : 'donorId';
  if (!month[listKey]) month[listKey] = [];

  document.querySelectorAll(`.${checkboxClass}`).forEach(el => {
    const personId = el.getAttribute('data-person-id');
    setPersonHidden(month, personKind, personId, !el.checked);
  });
  people.forEach(p => {
    if (isPersonHidden(month, personKind, p.id)) return;
    if (!month[listKey].some(row => row[idField] === p.id)) {
      month[listKey].push({ id: genId(), [idField]: p.id, amount: 0 });
    }
  });
}

function syncMonthRoster(mKey, data) {
  const month = data.months[mKey];
  if (!month) return false;
  ensureMonthHidden(month);
  if (!month.donations) month.donations = [];
  if (!month.distributions) month.distributions = [];
  let changed = false;
  activeDonors(data).forEach(donor => {
    if (isPersonHidden(month, 'donor', donor.id)) return;
    if (!month.donations.some(d => d.donorId === donor.id)) {
      month.donations.push({ id: genId(), donorId: donor.id, amount: 0 });
      changed = true;
    }
  });
  activeRecipients(data).forEach(recip => {
    if (isPersonHidden(month, 'recipient', recip.id)) return;
    if (!month.distributions.some(d => d.recipientId === recip.id)) {
      month.distributions.push({ id: genId(), recipientId: recip.id, amount: 0 });
      changed = true;
    }
  });
  return changed;
}

function orderedDonations(data, donations) {
  const order = new Map((data.donors || []).map((d, i) => [d.id, i]));
  return [...donations].sort((a, b) => (order.get(a.donorId) ?? 99) - (order.get(b.donorId) ?? 99));
}

function orderedDistributions(data, distributions) {
  const order = new Map((data.recipients || []).map((r, i) => [r.id, i]));
  return [...distributions].sort((a, b) => (order.get(a.recipientId) ?? 99) - (order.get(b.recipientId) ?? 99));
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function monthKeyFromParts(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function suggestedNewMonthParts(data) {
  const keys = Object.keys(data.months || {}).sort();
  if (!keys.length) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  const [y, m] = keys[keys.length - 1].split('-').map(Number);
  let year = y;
  let month = m + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return { year, month };
}

function preferredMonthForYear(year, data) {
  const y = Number(year);
  const available = Array.from({ length: 12 }, (_, i) => i + 1)
    .filter(m => !data.months[monthKeyFromParts(y, m)]);
  if (!available.length) return null;

  const suggested = suggestedNewMonthParts(data);
  if (suggested.year === y && available.includes(suggested.month)) {
    return suggested.month;
  }

  const latestInYear = Object.keys(data.months || {})
    .filter(k => k.startsWith(`${y}-`))
    .sort()
    .pop();
  if (latestInYear) {
    const afterLatest = available.find(m => m > Number(latestInYear.split('-')[1]));
    if (afterLatest !== undefined) return afterLatest;
  }

  return available[0];
}

function newMonthOptionsHtml(year, data, preferredMonth) {
  const available = Array.from({ length: 12 }, (_, i) => i + 1)
    .filter(m => !data.months[monthKeyFromParts(year, m)]);
  if (!available.length) {
    return '<option value="">No reports available</option>';
  }
  const pick = available.includes(preferredMonth) ? preferredMonth : available[0];
  return available.map(m => {
    const label = new Date(2000, m - 1, 1).toLocaleDateString('en-GB', { month: 'long' });
    const sel = m === pick ? ' selected' : '';
    return `<option value="${m}"${sel}>${label}</option>`;
  }).join('');
}

function refreshNewMonthSelect() {
  const yearEl = document.getElementById('inp-year');
  const monthEl = document.getElementById('inp-month');
  if (!yearEl || !monthEl) return;
  const year = yearEl.value.trim();
  const preferred = preferredMonthForYear(year, getData());
  monthEl.innerHTML = newMonthOptionsHtml(year, getData(), preferred);
  monthEl.disabled = !monthEl.options.length || monthEl.options[0].value === '';
}

function donorName(data, id)     { return findDonor(data, id)?.name || '[Removed]'; }
function recipientName(data, id) { return findRecipient(data, id)?.name || '[Removed]'; }

function usedIdsForMonth(mKey, listKey, excludeEntryId = null) {
  const idField = listKey === 'donations' ? 'donorId' : 'recipientId';
  return (getData().months[mKey]?.[listKey] || [])
    .filter(entry => entry.id !== excludeEntryId)
    .map(entry => entry[idField]);
}

function personPillsHtml(people, { name, selectedId, usedIds = [], emptyMessage }) {
  const list = people || [];
  const taken = usedIds || [];
  const available = list.filter(p => !taken.includes(p.id) || p.id === selectedId);
  if (!available.length) {
    return `<p class="pill-group--empty">${esc(emptyMessage || 'No one available.')}</p>`;
  }
  if (available.length === 1) {
    const p = available[0];
    return `<p class="field__display-name">${esc(p.name)}</p>
      <input type="hidden" name="${esc(name)}" value="${esc(p.id)}">`;
  }
  const pills = available.map((p, i) => {
    const checked = selectedId ? p.id === selectedId : i === 0;
    return `<label class="pill-option">
      <input type="radio" name="${esc(name)}" value="${esc(p.id)}"${checked ? ' checked' : ''}>
      <span class="pill-option__text">${esc(p.name)}</span>
    </label>`;
  }).join('');
  return `<div class="pill-group" role="radiogroup">${pills}</div>`;
}

function getSelectedPillValue(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  if (checked) return checked.value;
  return document.querySelector(`input[type="hidden"][name="${name}"]`)?.value;
}

// ── COMPUTED STATS ───────────────────────────────────────────────────────────
function sumVisibleDonations(month) {
  return (month.donations || [])
    .filter(d => !isPersonHidden(month, 'donor', d.donorId))
    .reduce((s, d) => s + Number(d.amount), 0);
}

function computeTotalRaised(data) {
  const fromReports = Object.values(data.months || {})
    .reduce((s, m) => s + sumVisibleDonations(m), 0);
  return Number(data.legacyFunds ?? 0) + fromReports;
}

let _statsCache = null;
let _statsCacheRev = -1;
const _monthSummaryCache = {};

function computeStats(data) {
  const rev = getDataRevision();
  if (_statsCache && _statsCacheRev === rev) return _statsCache;
  const months = Object.values(data.months || {});
  const result = {
    totalRaised: computeTotalRaised(data),
    totalSent: sum(months.flatMap(m => (m.distributions || []).map(d => d.amount))),
    monthCount: months.length,
  };
  _statsCache = result;
  _statsCacheRev = rev;
  return result;
}

function invalidateDerivedCache() {
  _statsCache = null;
  _statsCacheRev = -1;
  Object.keys(_monthSummaryCache).forEach(k => delete _monthSummaryCache[k]);
}

// ── ROW KEBAB MENU ───────────────────────────────────────────────────────────
const KEBAB_SVG = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="3" r="1.25" fill="currentColor"/><circle cx="7" cy="7" r="1.25" fill="currentColor"/><circle cx="7" cy="11" r="1.25" fill="currentColor"/></svg>';
const ARCHIVE_SVG = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 5.5h8v6.5a1 1 0 01-1 1H4a1 1 0 01-1-1V5.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M5.5 5.5V4.2a1.3 1.3 0 013 0V5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 8h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const CHEVRON_RIGHT_SVG = '<svg viewBox="0 0 8 14" fill="none" aria-hidden="true"><path d="M1 2L6 7L1 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEVRON_LEFT_SVG = '<svg viewBox="0 0 10 16" fill="none" aria-hidden="true"><path d="M8 2L2 8L8 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const IOS_SPRING = 'spring(3, 1000, 500, 0)';
const NAV_PUSH_MS = 500;
const NAV_POP_MS = 430;

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function playReportsViewEnter(el, variant) {
  if (!el || prefersReducedMotion()) return;

  el.classList.remove('reports-view--enter--home', 'reports-view--enter--detail');

  const isPush = variant === 'detail';
  const offset = isPush ? 30 : -24;
  const duration = isPush ? NAV_PUSH_MS : NAV_POP_MS;

  const clearInline = () => {
    el.style.opacity = '';
    el.style.transform = '';
  };

  if (typeof el.animate === 'function') {
    el.getAnimations().forEach(a => a.cancel());
    const anim = el.animate(
      [
        { transform: `translateX(${offset}px)`, opacity: 0.92 },
        { transform: 'translateX(0)', opacity: 1 },
      ],
      { duration, easing: IOS_SPRING, fill: 'both' }
    );
    anim.finished.then(clearInline).catch(clearInline);
    return;
  }

  void el.offsetWidth;
  el.classList.add(isPush ? 'reports-view--enter--detail' : 'reports-view--enter--home');
  el.addEventListener('animationend', () => {
    el.classList.remove('reports-view--enter--home', 'reports-view--enter--detail');
  }, { once: true });
}
function getLatestMonthKey(data) {
  const keys = Object.keys(data.months || {}).sort().reverse();
  return keys[0] || null;
}

function copyMonthRoster(targetMonth, sourceMonth, data) {
  ensureMonthHidden(targetMonth);
  targetMonth.donations = [];
  targetMonth.distributions = [];
  targetMonth.hiddenDonors = activeDonors(data).map(d => d.id);
  targetMonth.hiddenRecipients = activeRecipients(data).map(r => r.id);
}

function sectionHeadManageListBtn(mKey, kind, month) {
  const isRecipients = kind === 'recipients';
  const personKind = isRecipients ? 'recipient' : 'donor';
  const people = isRecipients ? activeRecipients(getData()) : activeDonors(getData());
  const included = people.filter(p => !isPersonHidden(month, personKind, p.id)).length;
  return `<button type="button" class="section-head__manage-list" onclick="openMonthRosterManage('${mKey}','${kind}')">Manage list (${included})</button>`;
}

function reportIndexStatsHtml(summary) {
  return `
    <span class="report-index-stat"><span class="report-index-stat__label">Raised</span> <span class="report-index-stat__value">${fmt(summary.raised)}</span></span>
    <span class="report-index-stat"><span class="report-index-stat__label">Sent</span> <span class="report-index-stat__value">${fmt(summary.sent)}</span></span>
    <span class="report-index-stat"><span class="report-index-stat__label">Donors</span> <span class="report-index-stat__value">${summary.donors}</span></span>`;
}

function refreshReportsHomeRow(mKey) {
  if (monthsView !== 'home') return;
  const data = getData();
  const month = data.months[mKey];
  const row = document.querySelector(`[data-report-key="${mKey}"]`);
  if (!month || !row) {
    renderMonthsHome();
    return;
  }
  const statsEl = row.querySelector('.report-index-row__stats');
  if (statsEl) statsEl.innerHTML = reportIndexStatsHtml(computeMonthSummary(month, mKey));
}

function refreshMonthSectionTotals(mKey) {
  const data = getData();
  const month = data.months[mKey];
  if (!month) return;

  const visibleDonations = (month.donations || []).filter(d => !isPersonHidden(month, 'donor', d.donorId));
  const visibleDistributions = (month.distributions || []).filter(d => !isPersonHidden(month, 'recipient', d.recipientId));
  const totalRaised = sum(visibleDonations.map(d => d.amount));
  const totalSent = sum(visibleDistributions.map(d => d.amount));

  const donTotal = document.querySelector('#md-donations .list-row--total .list-row__amount');
  const distTotal = document.querySelector('#md-distributions .list-row--total .list-row__amount');
  if (donTotal) donTotal.textContent = fmt(totalRaised);
  if (distTotal) distTotal.textContent = fmt(totalSent);
  refreshReportsHomeRow(mKey);
}

function refreshSectionHeadManageBtn(mKey, kind, month) {
  const headId = kind === 'recipients' ? 'md-dist-head' : 'md-don-head';
  const head = document.getElementById(headId);
  if (!head) return;
  const label = kind === 'recipients' ? 'Recipients' : 'Donors';
  head.innerHTML = `<h3 class="section-head__title">${label}</h3>${sectionHeadManageListBtn(mKey, kind, month)}`;
}

function refreshDonationsSection(mKey) {
  const data = getData();
  const month = data.months[mKey];
  const el = document.getElementById('md-donations');
  if (!month || !el) return;
  ensureMonthHidden(month);
  const donations = orderedDonations(data, month.donations || []);
  const visibleDonations = donations.filter(d => !isPersonHidden(month, 'donor', d.donorId));
  const totalRaised = sum(visibleDonations.map(d => d.amount));
  el.innerHTML = visibleDonations.length
    ? visibleDonations.map(d => monthAmountRowHtml(mKey, d.id, donorName(data, d.donorId), d.amount, 'donor')).join('')
      + monthListTotalRowHtml('Total', totalRaised)
    : '<div class="empty-row">No donors on this report — use Manage list</div>' + monthListTotalRowHtml('Total', 0);
  refreshSectionHeadManageBtn(mKey, 'donors', month);
  refreshReportsHomeRow(mKey);
}

function refreshDistributionsSection(mKey) {
  const data = getData();
  const month = data.months[mKey];
  const el = document.getElementById('md-distributions');
  if (!month || !el) return;
  ensureMonthHidden(month);
  const distributions = orderedDistributions(data, month.distributions || []);
  const visibleDistributions = distributions.filter(d => !isPersonHidden(month, 'recipient', d.recipientId));
  const totalSent = sum(visibleDistributions.map(d => d.amount));
  el.innerHTML = visibleDistributions.length
    ? visibleDistributions.map(d => monthAmountRowHtml(mKey, d.id, recipientName(data, d.recipientId), d.amount, 'recipient')).join('')
      + monthListTotalRowHtml('Total', totalSent)
    : '<div class="empty-row">No recipients on this report — use Manage list</div>' + monthListTotalRowHtml('Total', 0);
  refreshSectionHeadManageBtn(mKey, 'recipients', month);
  refreshReportsHomeRow(mKey);
}

function noteRowHtml(mKey, text, idx) {
  return `
    <div class="list-row">
      <span class="list-row__name" style="white-space:normal;line-height:1.4;font-weight:500">${esc(text)}</span>
      <div class="list-row__actions">
        ${rowMenuHtml([
          { label: 'Edit', onClick: `editNote('${mKey}',${idx})` },
          { label: 'Delete', danger: true, onClick: `deleteNote('${mKey}',${idx})` },
        ])}
      </div>
    </div>`;
}

function refreshNotesSection(mKey) {
  const data = getData();
  const month = data.months[mKey];
  const notesEl = document.getElementById('md-notes');
  if (!month || !notesEl) return;
  const notes = month.notes || [];
  notesEl.innerHTML = notes.length
    ? notes.map((n, i) => noteRowHtml(mKey, n, i)).join('')
    : '<div class="empty-row">No notes added</div>';
}

function saveReportAmountFromInput(input) {
  const row = input.closest('[data-month-key]');
  if (!row) return false;

  const mKey = row.dataset.monthKey;
  const entryId = row.dataset.entryId;
  const kind = row.dataset.entryKind;
  const listKey = kind === 'donor' ? 'donations' : 'distributions';

  const amount = parseFloat(input.value);
  if (isNaN(amount) || amount < 0) {
    const data = getData();
    const item = data.months[mKey]?.[listKey]?.find(x => x.id === entryId);
    input.value = item ? Number(item.amount) || 0 : 0;
    return false;
  }

  const d = getData();
  const item = d.months[mKey]?.[listKey]?.find(x => x.id === entryId);
  if (!item) return false;

  const normalized = amount;
  if (item.amount === normalized) return false;

  item.amount = normalized;
  saveData(d);

  const badgeWrap = row.querySelector('.status-badge-wrap');
  if (badgeWrap) badgeWrap.innerHTML = rowStatusBadge(normalized, kind);
  refreshMonthSectionTotals(mKey);
  return true;
}

function rowMenuHtml(items, opts = {}) {
  const menuClass = opts.dropDown ? 'row-menu row-menu--drop-down' : 'row-menu';
  const btns = items.map(item => {
    const cls = item.danger ? 'row-menu__item row-menu__item--danger' : 'row-menu__item';
    return `<button type="button" class="${cls}" onclick="closeRowMenus();${item.onClick}">${esc(item.label)}</button>`;
  }).join('');
  return `
    <div class="${menuClass}">
      <button type="button" class="icon-btn kebab-btn" aria-label="Actions" aria-haspopup="true" aria-expanded="false" onclick="toggleRowMenu(this, event)">${KEBAB_SVG}</button>
      <div class="row-menu__dropdown" role="menu">${btns}</div>
    </div>`;
}

window.toggleRowMenu = function(btn, e) {
  e.stopPropagation();
  const menu = btn.closest('.row-menu');
  const wasOpen = menu.classList.contains('is-open');
  closeRowMenus();
  if (!wasOpen) {
    menu.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
  }
};

window.closeRowMenus = function() {
  document.querySelectorAll('.row-menu.is-open').forEach(menu => {
    menu.classList.remove('is-open');
    const btn = menu.querySelector('[aria-haspopup="true"]');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
};

function mobileDrawerEls() {
  return {
    overlay: document.getElementById('mobile-drawer-overlay'),
    drawer: document.getElementById('mobile-drawer'),
    btn: document.getElementById('header-nav-btn'),
  };
}

function isMobileDrawerOpen() {
  const { drawer } = mobileDrawerEls();
  return !!drawer && drawer.classList.contains('is-open');
}

window.openMobileDrawer = function () {
  const { overlay, drawer, btn } = mobileDrawerEls();
  if (!overlay || !drawer) return;
  closeRowMenus();
  overlay.classList.add('is-open');
  drawer.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
  drawer.setAttribute('aria-hidden', 'false');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
};

window.closeMobileDrawer = function () {
  const { overlay, drawer, btn } = mobileDrawerEls();
  if (!overlay || !drawer) return;
  overlay.classList.remove('is-open');
  drawer.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
  drawer.setAttribute('aria-hidden', 'true');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
};

window.toggleHeaderNav = function(btn, e) {
  e.stopPropagation();
  const wasOpen = isMobileDrawerOpen();
  if (wasOpen) closeMobileDrawer();
  else openMobileDrawer();
};

window.selectNavPanel = function(name) {
  closeRowMenus();
  switchTab(name);
};

document.addEventListener('click', e => {
  if (!e.target.closest('.row-menu')) closeRowMenus();
});

(() => {
  const { overlay } = mobileDrawerEls();
  if (overlay) overlay.addEventListener('click', () => closeMobileDrawer());
  window.addEventListener('resize', () => {
    if (window.matchMedia('(min-width: 900px)').matches) closeMobileDrawer();
  });
})();

function monthAmountRowHtml(mKey, entryId, displayName, amount, kind) {
  const val = Number(amount) || 0;
  return `
    <div class="list-row list-row--amount" data-month-key="${esc(mKey)}" data-entry-id="${esc(entryId)}" data-entry-kind="${kind}">
      <div class="list-row__body">
        <div class="list-row__main">
          <div class="list-row__name">${esc(displayName)}</div>
          <span class="status-badge-wrap">${rowStatusBadge(amount, kind)}</span>
        </div>
        <div class="report-amount-input-wrap">
          <span class="report-amount-input__prefix">£</span>
          <input type="number" inputmode="decimal" class="report-amount-input" min="0" step="0.01" value="${val}" aria-label="Amount for ${esc(displayName)}">
        </div>
      </div>
    </div>`;
}

function monthListTotalRowHtml(label, total) {
  return `
    <div class="list-row list-row--total">
      <div class="list-row__body">
        <span class="list-row__name">${esc(label)}</span>
        <span class="list-row__amount">${fmt(total)}</span>
      </div>
    </div>`;
}

function peopleListRowHtml(person, type) {
  const data = getData();
  const kind = type === 'donor' ? 'donor' : 'recipient';
  const removeLabel = isPersonReferencedInReports(data, kind, person.id) ? 'Archive' : 'Delete';
  return `
    <div class="list-row list-row--people">
      <div class="list-row__body">
        <span class="list-row__name">${esc(person.name)}</span>
        <div class="list-row__actions">
          ${rowMenuHtml([
            { label: 'Rename', onClick: `editPerson('${type}','${person.id}')` },
            { label: removeLabel, danger: true, onClick: `deletePerson('${type}','${person.id}')` },
          ])}
        </div>
      </div>
    </div>`;
}

function archivedPeopleModalRowHtml(person, type) {
  return `
    <div class="list-row list-row--archived">
      <span class="list-row__name">${esc(person.name)}</span>
      <button type="button" class="btn btn--ghost btn--sm" onclick="restorePerson('${type}','${person.id}')">Restore</button>
    </div>`;
}

function archivedPeopleModalBodyHtml(type) {
  const data = getData();
  const list = type === 'donor'
    ? (data.donors || []).filter(isPersonArchived)
    : (data.recipients || []).filter(isPersonArchived);
  const label = type === 'donor' ? 'donors' : 'recipients';
  if (!list.length) {
    return `<p class="archived-people-empty">No archived ${label}</p>`;
  }
  return `<div class="archived-people-list manage-roster-list">${list.map(p => archivedPeopleModalRowHtml(p, type)).join('')}</div>`;
}

function injectArchiveButtonIcons() {
  [document.getElementById('btn-archived-donors'), document.getElementById('btn-archived-recipients')].forEach(btn => {
    if (btn) btn.innerHTML = ARCHIVE_SVG;
  });
}

function updateArchivedPeopleButtons(archivedDonors, archivedRecipients) {
  const donorBtn = document.getElementById('btn-archived-donors');
  const recipientBtn = document.getElementById('btn-archived-recipients');
  if (donorBtn) {
    donorBtn.setAttribute('aria-label', archivedDonors.length
      ? `Archived donors (${archivedDonors.length})`
      : 'Archived donors');
    donorBtn.classList.toggle('section-head__archive--empty', archivedDonors.length === 0);
  }
  if (recipientBtn) {
    recipientBtn.setAttribute('aria-label', archivedRecipients.length
      ? `Archived recipients (${archivedRecipients.length})`
      : 'Archived recipients');
    recipientBtn.classList.toggle('section-head__archive--empty', archivedRecipients.length === 0);
  }
}

function refreshArchivedPeopleModal(type) {
  if (_archivedModalType !== type || !overlay.classList.contains('overlay--open')) return;
  modalTitle.textContent = type === 'donor' ? 'Archived Donors' : 'Archived Recipients';
  modalBody.innerHTML = archivedPeopleModalBodyHtml(type);
}

// ── RENDER SCHEDULER ─────────────────────────────────────────────────────────
let _renderFrame = null;

function renderActivePanel() {
  if (activePanel === 'overview') renderOverview();
  else if (activePanel === 'people') renderPeople();
  else if (activePanel === 'months') renderMonths();
}

function scheduleActivePanelRender() {
  if (_renderFrame) return;
  _renderFrame = requestAnimationFrame(() => {
    _renderFrame = null;
    renderActivePanel();
  });
}

// ── NAV / PANELS ─────────────────────────────────────────────────────────────
let activePanel = 'months';

const PANEL_TITLES = {
  months: 'Reports',
  overview: 'Overview',
  people: 'People',
};

function updateHeaderTitle() {
  const el = document.getElementById('header-page-title');
  if (el) el.textContent = PANEL_TITLES[activePanel] || activePanel;
}

function updateHeaderActions() {
  const isMonths = activePanel === 'months';
  const monthActs = document.getElementById('header-month-actions');
  if (monthActs) monthActs.hidden = !isMonths;
  if (isMonths) renderMonthHeadMenu();
}

function switchTab(name) {
  activePanel = name;
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('panel-' + name).classList.remove('hidden');
  document.querySelectorAll('#header-nav [data-panel]').forEach(btn => {
    btn.classList.toggle('row-menu__item--active', btn.dataset.panel === name);
  });
  document.querySelectorAll('#mobile-drawer [data-panel]').forEach(btn => {
    btn.classList.toggle('drawer__item--active', btn.dataset.panel === name);
  });
  document.querySelectorAll('.sidebar [data-panel]').forEach(btn => {
    btn.classList.toggle('sidebar__item--active', btn.dataset.panel === name);
  });
  if (name === 'overview') renderOverview();
  if (name === 'people')   renderPeople();
  if (name === 'months') {
    monthsView = 'home';
    activeMonthKey = null;
    renderMonths();
  }
  updateHeaderActions();
  updateHeaderTitle();
}

// ── OVERVIEW ─────────────────────────────────────────────────────────────────
function renderOverview() {
  const data = getData();
  const { totalRaised, totalSent, monthCount } = computeStats(data);

  document.getElementById('reserves-display').textContent = fmt(data.reserves ?? 0);
  document.getElementById('legacy-funds-display').textContent = fmt(data.legacyFunds ?? 0);

  document.getElementById('overview-stats').innerHTML = `
    <div class="stat-card stat-card--accent">
      <p class="stat-card__label">Total Raised</p>
      <p class="stat-card__value">${fmt(totalRaised)}</p>
    </div>
    <div class="stat-card">
      <p class="stat-card__label">Total Sent</p>
      <p class="stat-card__value">${fmt(totalSent)}</p>
    </div>
    <div class="stat-card">
      <p class="stat-card__label">Donors</p>
      <p class="stat-card__value">${activeDonors(data).length}</p>
    </div>
    <div class="stat-card">
      <p class="stat-card__label">Active reports</p>
      <p class="stat-card__value">${monthCount}</p>
    </div>`;
}

document.getElementById('btn-edit-reserves').addEventListener('click', () => {
  const data = getData();
  openModal('Edit Reserves', `
    <div class="field">
      <label class="field__label" for="inp-reserves">Reserves Amount</label>
      <div class="field__prefix-wrap">
        <span class="field__prefix">£</span>
        <input class="field__input field__input--prefixed" id="inp-reserves" type="number" inputmode="decimal" min="0" step="0.01" value="${data.reserves ?? 0}">
      </div>
    </div>`,
    () => {
      const val = parseFloat(document.getElementById('inp-reserves').value);
      if (isNaN(val) || val < 0) return alert('Please enter a valid amount.');
      const d = getData(); d.reserves = val; saveData(d);
      renderOverview();
    }
  );
});

document.getElementById('btn-edit-legacy-funds').addEventListener('click', () => {
  const data = getData();
  openModal('Edit Legacy Funds', `
    <p class="manage-roster-note" style="margin:0 0 0.75rem;">Pre-tracker total included in Total raised.</p>
    <div class="field" style="margin-bottom:0;">
      <label class="field__label" for="inp-legacy-funds">Legacy funds</label>
      <div class="field__prefix-wrap">
        <span class="field__prefix">£</span>
        <input class="field__input field__input--prefixed" id="inp-legacy-funds" type="number" inputmode="decimal" min="0" step="0.01" value="${data.legacyFunds ?? 0}">
      </div>
    </div>`,
    () => {
      const val = parseFloat(document.getElementById('inp-legacy-funds').value);
      if (isNaN(val) || val < 0) return alert('Please enter a valid amount.');
      const d = getData(); d.legacyFunds = val; saveData(d);
      renderOverview();
    }
  );
});

// ── PEOPLE ───────────────────────────────────────────────────────────────────
function peopleSectionTitle(count, singular) {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`;
}

let _peopleListFingerprint = '';

function addPersonFromInline(type) {
  const inputId = type === 'donor' ? 'donor-add-input' : 'recipient-add-input';
  const input = document.getElementById(inputId);
  if (!input) return;
  const name = input.value.trim();
  if (!name) return alert('Please enter a name.');
  const d = getData();
  const list = type === 'donor' ? d.donors : d.recipients;
  list.push({ id: genId(), name });
  saveData(d);
  input.value = '';
  renderPeople();
  input.focus();
}

function renderPeople() {
  const data = getData();
  const donors = activeDonors(data);
  const recipients = activeRecipients(data);
  const archivedDonors = (data.donors || []).filter(isPersonArchived);
  const archivedRecipients = (data.recipients || []).filter(isPersonArchived);
  const fp = JSON.stringify({ donors, recipients });

  document.getElementById('donors-title').textContent = peopleSectionTitle(donors.length, 'Donor');
  document.getElementById('recipients-title').textContent = peopleSectionTitle(recipients.length, 'Recipient');
  injectArchiveButtonIcons();
  updateArchivedPeopleButtons(archivedDonors, archivedRecipients);

  if (fp === _peopleListFingerprint) return;
  _peopleListFingerprint = fp;

  document.getElementById('donors-list').innerHTML = donors.length
    ? donors.map(d => peopleListRowHtml(d, 'donor')).join('')
    : '<div class="empty-row">No donors yet</div>';

  document.getElementById('recipients-list').innerHTML = recipients.length
    ? recipients.map(r => peopleListRowHtml(r, 'recipient')).join('')
    : '<div class="empty-row">No recipients yet</div>';

  if (_archivedModalType) refreshArchivedPeopleModal(_archivedModalType);
}

document.getElementById('btn-add-donor').addEventListener('click', () => addPersonFromInline('donor'));
document.getElementById('btn-add-recipient').addEventListener('click', () => addPersonFromInline('recipient'));
document.getElementById('donor-add-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addPersonFromInline('donor'); }
});
document.getElementById('recipient-add-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addPersonFromInline('recipient'); }
});

window.editPerson = function(type, id) {
  const data  = getData();
  const list  = type === 'donor' ? activeDonors(data) : activeRecipients(data);
  const person = list.find(p => p.id === id);
  if (!person) return;
  const label = type === 'donor' ? 'Donor' : 'Recipient';
  const kind = type === 'donor' ? 'donor' : 'recipient';
  const removeLabel = isPersonReferencedInReports(data, kind, id) ? 'Archive' : 'Delete';

  openModal(`Edit ${label}`, `
    <div class="field">
      <label class="field__label" for="inp-pname">Full Name</label>
      <input class="field__input" id="inp-pname" type="text" value="${esc(person.name)}" autocomplete="off">
    </div>`,
    () => {
      const name = document.getElementById('inp-pname').value.trim();
      if (!name) return alert('Please enter a name.');
      const d = getData();
      const l = type === 'donor' ? d.donors : d.recipients;
      const p = l.find(x => x.id === id);
      if (p) p.name = name;
      saveData(d); renderPeople();
    },
    {
      onDelete: () => { closeModal(); deletePerson(type, id); },
      deleteLabel: removeLabel,
    }
  );
  setTimeout(() => { const i = document.getElementById('inp-pname'); if(i){i.focus();i.select();} }, 80);
};

window.restorePerson = function(type, id) {
  const d = getData();
  const list = type === 'donor' ? d.donors : d.recipients;
  const person = list.find(p => p.id === id);
  if (!person) return;
  person.archived = false;
  saveData(d);
  renderPeople();
  refreshArchivedPeopleModal(type);
};

window.openArchivedPeopleModal = function(type) {
  const sectionLabel = type === 'donor' ? 'Donors' : 'Recipients';
  _archivedModalType = type;
  openModal(`Archived ${sectionLabel}`, archivedPeopleModalBodyHtml(type), null, { viewOnly: true });
};

window.deletePerson = function(type, id) {
  const data = getData();
  const list = type === 'donor' ? data.donors : data.recipients;
  const person = list.find(p => p.id === id);
  const name = person?.name || 'this person';
  const kind = type === 'donor' ? 'donor' : 'recipient';
  const willArchive = isPersonReferencedInReports(data, kind, id);
  const actionLabel = willArchive ? 'Archive' : 'Delete';
  openConfirm(
    `${actionLabel} ${name}?`,
    deletePeopleConfirmMessage(data, type, new Set([id])),
    () => {
      const d = getData();
      archiveOrRemovePerson(d, type, id);
      saveData(d); renderPeople();
    },
    true,
    actionLabel
  );
};

// ── MONTHS ───────────────────────────────────────────────────────────────────
let monthsView = 'home';
let activeMonthKey = null;

function computeMonthSummary(month, mKey) {
  const rev = getDataRevision();
  if (mKey && _monthSummaryCache[mKey]?.rev === rev) return _monthSummaryCache[mKey].value;
  ensureMonthHidden(month);
  const donations = (month.donations || []).filter(d => !isPersonHidden(month, 'donor', d.donorId));
  const distributions = (month.distributions || []).filter(d => !isPersonHidden(month, 'recipient', d.recipientId));
  const value = {
    raised: sum(donations.map(d => d.amount)),
    sent: sum(distributions.map(d => d.amount)),
    donors: donations.filter(d => Number(d.amount) > 0).length,
  };
  if (mKey) _monthSummaryCache[mKey] = { rev, value };
  return value;
}

function reportIndexRowHtml(key, summary) {
  return `
    <div class="list-row list-row--selectable list-row--report" data-report-key="${esc(key)}" role="button" tabindex="0" onclick="openMonthReport('${esc(key)}')">
      <div class="list-row__body report-index-row__body">
        <div class="report-index-row__main">
          <span class="list-row__name report-index-row__title">${esc(monthLabel(key))}</span>
          <div class="report-index-row__stats">${reportIndexStatsHtml(summary)}</div>
        </div>
        <span class="list-row__chevron" aria-hidden="true">${CHEVRON_RIGHT_SVG}</span>
      </div>
    </div>`;
}

function renderMonthsHome() {
  const el = document.getElementById('months-home');
  if (!el) return;
  const data = getData();
  const keys = Object.keys(data.months || {}).sort().reverse();
  if (!keys.length) {
    el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:1.5rem 0;font-size:0.9rem;">No reports yet — tap <strong>New</strong> in the header to create one.</p>';
    return;
  }
  el.innerHTML = `
    <div class="card reports-home__list">
      ${keys.map(k => reportIndexRowHtml(k, computeMonthSummary(data.months[k], k))).join('')}
    </div>`;
}

function showReportsHome() {
  monthsView = 'home';
  activeMonthKey = null;
  const homeEl = document.getElementById('months-home');
  const detailWrap = document.getElementById('months-detail');
  if (detailWrap) detailWrap.hidden = true;
  if (homeEl) {
    homeEl.hidden = false;
    renderMonthsHome();
    playReportsViewEnter(homeEl, 'home');
  }
  renderMonthHeadMenu();
}

window.openMonthReport = function(key) {
  const data = getData();
  if (!data.months[key]) return;
  monthsView = 'detail';
  activeMonthKey = key;
  const homeEl = document.getElementById('months-home');
  const detailWrap = document.getElementById('months-detail');
  const titleEl = document.getElementById('month-detail-title');
  if (homeEl) homeEl.hidden = true;
  if (detailWrap) {
    detailWrap.hidden = false;
    playReportsViewEnter(detailWrap, 'detail');
  }
  if (titleEl) titleEl.textContent = monthLabel(key);
  renderMonthHeadMenu();
  renderMonthDetail(key);
};

function renderMonthHeadMenu() {
  const el = document.getElementById('month-head-menu');
  if (!el) return;
  if (monthsView !== 'detail' || !activeMonthKey) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <div class="header-report-actions">
      ${rowMenuHtml([
        { label: 'Delete report', danger: true, onClick: `deleteMonth('${activeMonthKey}')` },
      ], { dropDown: true })}
    </div>`;
}

function renderMonths() {
  const data = getData();
  if (monthsView === 'detail' && activeMonthKey && data.months[activeMonthKey]) {
    const homeEl = document.getElementById('months-home');
    const detailWrap = document.getElementById('months-detail');
    const titleEl = document.getElementById('month-detail-title');
    if (homeEl) homeEl.hidden = true;
    if (detailWrap) detailWrap.hidden = false;
    if (titleEl) titleEl.textContent = monthLabel(activeMonthKey);
    renderMonthHeadMenu();
    renderMonthDetail(activeMonthKey);
  } else {
    showReportsHome();
  }
}

document.getElementById('btn-reports-back').addEventListener('click', () => showReportsHome());

document.getElementById('month-detail').addEventListener('focusout', e => {
  if (e.target.classList?.contains('report-amount-input')) {
    saveReportAmountFromInput(e.target);
  }
});

document.getElementById('month-detail').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.classList?.contains('report-amount-input')) {
    e.preventDefault();
    e.target.blur();
  }
});

document.getElementById('btn-new-month').addEventListener('click', () => {
  const data = getData();
  const suggested = suggestedNewMonthParts(data);
  const latestKey = getLatestMonthKey(data);
  const copyHint = `<p class="manage-roster-note" style="margin:0 0 0.5rem;">No donors or recipients are selected yet. After creating, use <strong>Manage list</strong> on each section to choose who appears on this report.</p>`;
  openModal('New Report', `
    ${copyHint}
    <div class="field">
      <label class="field__label" for="inp-year">Year</label>
      <input class="field__input" id="inp-year" type="number" inputmode="numeric" min="2020" max="2099" value="${suggested.year}">
    </div>
    <div class="field" style="margin-bottom:0;">
      <label class="field__label" for="inp-month">Month</label>
      <select class="field__select" id="inp-month">
        ${newMonthOptionsHtml(suggested.year, data, suggested.month)}
      </select>
    </div>`,
    () => {
      const y = document.getElementById('inp-year').value.trim();
      const m = document.getElementById('inp-month').value;
      if (!m) return alert('No reports available for that year.');
      const key = monthKeyFromParts(y, m);
      const d = getData();
      if (d.months[key]) return alert('That report already exists.');
      const month = { donations: [], distributions: [], notes: [] };
      const sourceMonth = latestKey ? d.months[latestKey] : null;
      copyMonthRoster(month, sourceMonth, d);
      d.months[key] = month;
      saveData(d);
      openMonthReport(key);
    }
  );
  const confirmBtn = document.getElementById('btn-confirm');
  if (confirmBtn) confirmBtn.textContent = 'Create';
  setTimeout(() => {
    const yearEl = document.getElementById('inp-year');
    yearEl?.addEventListener('input', refreshNewMonthSelect);
    yearEl?.addEventListener('change', refreshNewMonthSelect);
    refreshNewMonthSelect();
  }, 80);
});

function renderMonthDetail(key) {
  const detailEl = document.getElementById('month-detail');
  if (!key) { detailEl.innerHTML = '<p style="color:var(--muted);text-align:center;padding:1.5rem 0;font-size:0.9rem;">No reports yet — tap <strong>New</strong> in the header to create one.</p>'; return; }

  const data  = getData();
  const month = data.months[key];
  if (!month) { detailEl.innerHTML = ''; return; }

  ensureMonthHidden(month);

  const donations     = orderedDonations(data, month.donations || []);
  const distributions = orderedDistributions(data, month.distributions || []);
  const visibleDonations = donations.filter(d => !isPersonHidden(month, 'donor', d.donorId));
  const visibleDistributions = distributions.filter(d => !isPersonHidden(month, 'recipient', d.recipientId));
  const notes         = month.notes         || [];

  const totalRaised = sum(visibleDonations.map(d => d.amount));
  const totalSent   = sum(visibleDistributions.map(d => d.amount));

  detailEl.innerHTML = `
    <div class="month-detail-layout">

      <!-- DONORS -->
      <div class="card">
        <div class="section-head" id="md-don-head">
          <h3 class="section-head__title">Donors</h3>
          ${sectionHeadManageListBtn(key, 'donors', month)}
        </div>
        <div id="md-donations">
          ${visibleDonations.length
            ? visibleDonations.map(d => monthAmountRowHtml(
              key,
              d.id,
              donorName(data, d.donorId),
              d.amount,
              'donor'
            )).join('')
            : '<div class="empty-row">No donors on this report — use Manage list</div>'}
          ${monthListTotalRowHtml('Total', totalRaised)}
        </div>
      </div>

      <!-- RECIPIENTS -->
      <div class="card">
        <div class="section-head" id="md-dist-head">
          <h3 class="section-head__title">Recipients</h3>
          ${sectionHeadManageListBtn(key, 'recipients', month)}
        </div>
        <div id="md-distributions">
          ${visibleDistributions.length
            ? visibleDistributions.map(d => monthAmountRowHtml(
              key,
              d.id,
              recipientName(data, d.recipientId),
              d.amount,
              'recipient'
            )).join('')
            : '<div class="empty-row">No recipients on this report — use Manage list</div>'}
          ${monthListTotalRowHtml('Total', totalSent)}
        </div>
      </div>

      <!-- NOTES -->
      <div class="card card--menu-overflow card--notes">
        <div class="section-head">
          <h3 class="section-head__title">Notes</h3>
        </div>
        <div id="md-notes">
          ${notes.length
            ? notes.map((n, i) => noteRowHtml(key, n, i)).join('')
            : '<div class="empty-row">No notes added</div>'}
        </div>
        <div class="add-row">
          <button class="add-row__btn" onclick="addNote('${key}')">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Add Note
          </button>
        </div>
      </div>

    </div>`;
}

// ── MONTH CRUD ───────────────────────────────────────────────────────────────
window.addNote = function(mKey) {
  openModal('Add Note', `
    <div class="field">
      <label class="field__label" for="inp-note">Note</label>
      <input class="field__input" id="inp-note" type="text" placeholder="Enter note" autocomplete="off">
    </div>`,
    () => {
      const text = document.getElementById('inp-note').value.trim();
      if (!text) return alert('Please enter a note.');
      const d = getData();
      d.months[mKey].notes.push(text);
      saveData(d); refreshNotesSection(mKey);
    }
  );
  setTimeout(() => document.getElementById('inp-note')?.focus(), 80);
};

window.editNote = function(mKey, idx) {
  const d = getData();
  const notes = d.months[mKey].notes || [];
  const text = notes[idx];
  if (text === undefined) return;
  openModal('Edit Note', `
    <div class="field">
      <label class="field__label" for="inp-note">Note</label>
      <input class="field__input" id="inp-note" type="text" value="${esc(text)}" autocomplete="off">
    </div>`,
    () => {
      const newText = document.getElementById('inp-note').value.trim();
      if (!newText) return alert('Please enter a note.');
      const data = getData();
      if (data.months[mKey].notes[idx] !== undefined) {
        data.months[mKey].notes[idx] = newText;
      }
      saveData(data); refreshNotesSection(mKey);
    }
  );
  setTimeout(() => { const i = document.getElementById('inp-note'); if (i) { i.focus(); i.select(); } }, 80);
};

window.deleteNote = function(mKey, idx) {
  const d = getData();
  d.months[mKey].notes.splice(idx, 1);
  saveData(d); refreshNotesSection(mKey);
};

window.deleteMonth = function(key) {
  openConfirm(
    `Delete ${monthLabel(key)}?`,
    'All donations, distributions and notes for this report will be permanently removed.',
    () => {
      const d = getData();
      delete d.months[key];
      saveData(d);
      showReportsHome();
    },
    true,
    'Remove'
  );
};

// ── MODAL ────────────────────────────────────────────────────────────────────
let _onConfirm = null;
let _archivedModalType = null;

const overlay     = document.getElementById('overlay');
const modalTitle  = document.getElementById('modal-title');
const modalBody   = document.getElementById('modal-body');
const modalFooter = document.getElementById('modal-footer');

function openModal(title, bodyHTML, onConfirm, opts = {}) {
  _onConfirm = onConfirm;
  modalTitle.textContent  = title;
  modalBody.innerHTML     = bodyHTML;
  if (opts.viewOnly) {
    modalFooter.className = 'modal__footer';
    modalFooter.innerHTML = `<button type="button" class="btn btn--primary" id="btn-confirm">Done</button>`;
    document.getElementById('btn-confirm').addEventListener('click', closeModal);
  } else if (opts.onDelete) {
    modalFooter.className = 'modal__footer modal__footer--with-delete';
    modalFooter.innerHTML = `
      <button type="button" class="btn btn--danger" id="btn-delete">${esc(opts.deleteLabel || 'Delete')}</button>
      <div class="modal__footer-actions">
        <button type="button" class="btn btn--ghost" id="btn-cancel">Cancel</button>
        <button type="button" class="btn btn--primary" id="btn-confirm">Save</button>
      </div>`;
    document.getElementById('btn-delete').addEventListener('click', () => opts.onDelete());
    const confirmBtn = document.getElementById('btn-confirm');
    confirmBtn.disabled = false;
    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    confirmBtn.addEventListener('click', () => { _onConfirm && _onConfirm(); closeModal(); });
  } else {
    modalFooter.className = 'modal__footer';
    modalFooter.innerHTML = `
      <button type="button" class="btn btn--ghost" id="btn-cancel">Cancel</button>
      <button type="button" class="btn btn--primary" id="btn-confirm">Save</button>`;
    const confirmBtn = document.getElementById('btn-confirm');
    confirmBtn.disabled = false;
    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    confirmBtn.addEventListener('click', () => { _onConfirm && _onConfirm(); closeModal(); });
  }
  overlay.classList.add('overlay--open');
  document.body.style.overflow = 'hidden';
}

function openConfirm(title, message, onConfirm, isDanger = false, confirmLabel = null) {
  _onConfirm = onConfirm;
  modalTitle.textContent = title;
  modalBody.innerHTML    = `<p style="font-size:0.9rem;color:var(--muted);margin:0;">${esc(message)}</p>`;
  modalFooter.className  = 'modal__footer';
  const actionLabel = confirmLabel || (isDanger ? 'Delete' : 'Confirm');
  modalFooter.innerHTML  = `
    <button class="btn btn--ghost" id="btn-cancel">Cancel</button>
    <button class="btn ${isDanger ? 'btn--danger' : 'btn--primary'}" id="btn-confirm">${esc(actionLabel)}</button>`;
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-confirm').addEventListener('click', () => { _onConfirm && _onConfirm(); closeModal(); });
  overlay.classList.add('overlay--open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  overlay.classList.remove('overlay--open');
  document.body.style.overflow = '';
  _onConfirm = null;
  _archivedModalType = null;
}

window.openMonthRosterManage = function(mKey, kind) {
  const data = getData();
  const month = data.months[mKey];
  if (!month) return;
  ensureMonthHidden(month);
  const isRecipients = kind === 'recipients';
  const people = isRecipients ? activeRecipients(data) : activeDonors(data);
  const personKind = isRecipients ? 'recipient' : 'donor';
  const sectionLabel = isRecipients ? 'Recipients' : 'Donors';
  const title = `${sectionLabel} on ${monthLabel(mKey)}`;
  const listHtml = rosterPillsHtml(people, {
    isChecked: p => !isPersonHidden(month, personKind, p.id),
    emptyMessage: `No ${isRecipients ? 'recipients' : 'donors'} on the People tab yet.`,
  });

  openModal(title, `
    <p class="manage-roster-note">Selected names appear on this report.</p>
    <div class="manage-roster-list">${listHtml}</div>`,
    () => {
      const d = getData();
      const m = d.months[mKey];
      if (!m) return;
      applyMonthRosterFromCheckboxes(m, people, personKind, 'manage-roster-toggle');
      saveData(d);
      if (personKind === 'donor') refreshDonationsSection(mKey);
      else refreshDistributionsSection(mKey);
    }
  );
  const confirmBtn = document.getElementById('btn-confirm');
  if (confirmBtn) confirmBtn.textContent = 'Save';
};

document.getElementById('modal-close').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (overlay.classList.contains('overlay--open')) closeModal();
    else if (isMobileDrawerOpen()) closeMobileDrawer();
    else closeRowMenus();
  }
});

// ── LOAD / SAVE UI ───────────────────────────────────────────────────────────
function showLoadState(state, message) {
  const main = document.getElementById('main');
  const panels = main.querySelectorAll('.panel');
  let el = document.getElementById('load-state');
  if (state === 'loading') {
    panels.forEach(p => p.classList.add('hidden'));
    if (!el) {
      el = document.createElement('p');
      el.id = 'load-state';
      el.className = 'load-state';
      main.prepend(el);
    }
    el.className = 'load-state';
    el.textContent = 'Loading…';
    el.hidden = false;
    return;
  }
  if (state === 'error') {
    panels.forEach(p => p.classList.add('hidden'));
    if (!el) {
      el = document.createElement('p');
      el.id = 'load-state';
      main.prepend(el);
    }
    el.className = 'load-state load-state--error';
    el.textContent = message || 'Failed to load data.';
    el.hidden = false;
    return;
  }
  if (el) el.hidden = true;
}

const saveStatusEl = document.getElementById('save-status');
let saveStatusTimer = null;

setSaveStatusHandler((status, message) => {
  if (!saveStatusEl) return;
  clearTimeout(saveStatusTimer);
  if (status === 'saving') {
    saveStatusEl.textContent = 'Saving…';
    saveStatusEl.className = 'header__save-status';
    saveStatusEl.hidden = false;
    return;
  }
  if (status === 'saved') {
    saveStatusEl.textContent = 'Saved';
    saveStatusEl.className = 'header__save-status';
    saveStatusEl.hidden = false;
    saveStatusTimer = setTimeout(() => { saveStatusEl.hidden = true; }, 2000);
    return;
  }
  if (status === 'error') {
    saveStatusEl.textContent = message ? `Save failed` : 'Save failed';
    saveStatusEl.className = 'header__save-status header__save-status--error';
    saveStatusEl.hidden = false;
    saveStatusEl.title = message || '';
  }
});

// ── INIT (after passcode / session) ───────────────────────────────────────────
function runAdminInit() {
  injectArchiveButtonIcons();
  setDataChangeHandler(() => {
    if (!isDataReady()) return;
    invalidateDerivedCache();
    scheduleActivePanelRender();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    loadData({ background: true }).catch(() => {});
  });

  (async () => {
    if (!isDataReady()) showLoadState('loading');
    try {
      await loadData();
      showLoadState('ready');
      switchTab('months');
    } catch (e) {
      showLoadState('error', e.message);
    }
  })();
}

window.addEventListener('si-admin-ready', runAdminInit, { once: true });

})();
