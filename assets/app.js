/* =========================================================
   Spirtas Worldwide — Fleet Intake
   Front-end logic: bilingual UI, editable equipment table,
   CSV/XLSX import, and submission to Supabase.

   Connection settings live in assets/config.js. Submissions go
   to one Postgres function, submit_fleet_intake(), which
   validates the payload and writes the company plus all of its
   equipment rows in a single transaction. See supabase/schema.sql.
   ========================================================= */

/* ---------------------------------------------------------
   State
   --------------------------------------------------------- */
var EQ_COLS = ['brand', 'type', 'model', 'unitId', 'capacity', 'age', 'location', 'price', 'contact'];
var PLACEHOLDER_KEY = {
  brand: 'placeholderBrand', type: 'placeholderType', model: 'placeholderModel',
  unitId: 'placeholderId', capacity: 'placeholderCapacity', age: 'placeholderAge',
  location: 'placeholderLocation', price: 'placeholderPrice', contact: 'placeholderContact'
};

var state = { equipment: [] };
var currentLang = 'en';
var lastPayload = null;

function blankRow() {
  return { brand: '', type: '', model: '', unitId: '', capacity: '', age: '', location: '', price: '', contact: '' };
}

/* ---------------------------------------------------------
   Small helpers
   --------------------------------------------------------- */
function escAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function csvRow(arr) {
  return arr.map(function (v) {
    v = String(v == null ? '' : v);
    if (/["\r\n,]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
    return v;
  }).join(',');
}

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || '';
}

/* ---------------------------------------------------------
   i18n
   --------------------------------------------------------- */
function detectInitialLang() {
  try {
    var saved = localStorage.getItem('fleetIntakeLang');
    if (saved === 'en' || saved === 'es') return saved;
  } catch (e) { /* ignore */ }
  var nav = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  return nav.indexOf('es') === 0 ? 'es' : 'en';
}

function applyI18n() {
  document.documentElement.lang = currentLang;
  var nodes = document.querySelectorAll('[data-i18n]');
  for (var i = 0; i < nodes.length; i++) {
    nodes[i].innerHTML = t(nodes[i].getAttribute('data-i18n'));
  }
  document.getElementById('langEn').setAttribute('aria-pressed', String(currentLang === 'en'));
  document.getElementById('langEs').setAttribute('aria-pressed', String(currentLang === 'es'));
  updateFooterYear();
  renderEquipmentTable();
}

function updateFooterYear() {
  var el = document.getElementById('year');
  if (el) el.textContent = new Date().getFullYear();
}

function setLanguage(lang) {
  currentLang = lang === 'es' ? 'es' : 'en';
  try { localStorage.setItem('fleetIntakeLang', currentLang); } catch (e) { /* ignore */ }
  applyI18n();
}

/* ---------------------------------------------------------
   Equipment table
   --------------------------------------------------------- */
function rowTemplate(row, idx) {
  var cells = EQ_COLS.map(function (key) {
    var ph = t(PLACEHOLDER_KEY[key]);
    return '<td><input type="text" data-idx="' + idx + '" data-key="' + key +
      '" value="' + escAttr(row[key]) + '" placeholder="' + escAttr(ph) + '"></td>';
  }).join('');
  return '<tr>' + cells +
    '<td class="col-action"><button type="button" class="del-row-btn" data-idx="' + idx +
    '" aria-label="Delete row">&times;</button></td></tr>';
}

function renderEquipmentTable() {
  var tbody = document.getElementById('eqBody');
  if (!state.equipment.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="eq-empty">' + t('eqEmpty') + '</td></tr>';
  } else {
    tbody.innerHTML = state.equipment.map(rowTemplate).join('');
  }
  updateEqCount();
  updateSteps();
}

function updateEqCount() {
  var el = document.getElementById('eqCount');
  var n = state.equipment.length;
  if (!n) { el.textContent = ''; return; }
  el.textContent = n === 1 ? t('eqCount1') : t('eqCountN').replace('{n}', n);
}

function addRow() {
  state.equipment.push(blankRow());
  renderEquipmentTable();
  var inputs = document.querySelectorAll('#eqBody tr:last-child input');
  if (inputs.length) inputs[0].focus();
}

/* ---------------------------------------------------------
   File import (CSV / XLSX / XLS) via SheetJS
   --------------------------------------------------------- */
function normalizeHeader(s) {
  return String(s || '')
    .replace(/\(.*?\)/g, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/* A single header cell often carries both languages ("BRAND / MARCA") or
   trails a unit ("PRICE PER DAY (24 HR) USD"). normalizeHeader collapses
   those to one token, so try the whole thing first, then each side of the
   separator, then the same again with a trailing currency dropped. */
function headerCandidates(h) {
  var out = [];
  function push(v) { if (v && out.indexOf(v) === -1) out.push(v); }
  push(normalizeHeader(h));
  String(h || '').split(/[\/|]+/).forEach(function (part) { push(normalizeHeader(part)); });
  out.slice().forEach(function (v) { push(v.replace(/(usd|eur|ves)$/, '')); });
  return out;
}

function mapHeaders(headerRow) {
  var map = {};
  headerRow.forEach(function (h, idx) {
    var cands = headerCandidates(h);
    Object.keys(HEADER_ALIASES).forEach(function (key) {
      if (map[key] != null) return;
      var aliases = HEADER_ALIASES[key];
      for (var i = 0; i < aliases.length; i++) {
        if (cands.indexOf(aliases[i]) !== -1) { map[key] = idx; break; }
      }
    });
  });
  return map;
}

function setUploadStatus(msg, kind) {
  var el = document.getElementById('uploadStatus');
  el.textContent = msg;
  el.className = 'upload-status' + (kind ? ' ' + kind : '');
}

function handleFiles(fileList) {
  var file = fileList && fileList[0];
  if (!file) return;
  setUploadStatus('', '');
  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      var data = new Uint8Array(e.target.result);
      var wb = XLSX.read(data, { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
      if (!rows.length) { setUploadStatus(currentLang === 'es' ? 'El archivo está vacío.' : 'That file looks empty.', 'err'); return; }

      var colMap = mapHeaders(rows[0]);
      var added = 0;
      for (var i = 1; i < rows.length; i++) {
        var raw = rows[i];
        if (!raw || raw.every(function (c) { return String(c || '').trim() === ''; })) continue;
        var row = blankRow();
        Object.keys(colMap).forEach(function (key) {
          var idx = colMap[key];
          if (idx != null && raw[idx] != null) row[key] = String(raw[idx]).trim();
        });
        if (row.brand || row.model || row.type) {
          // drop the single starter blank row before the first real import
          if (state.equipment.length === 1 && !hasAnyValue(state.equipment[0])) state.equipment.length = 0;
          state.equipment.push(row);
          added++;
        }
      }
      renderEquipmentTable();
      setUploadStatus(
        added + ' ' + (currentLang === 'es' ? (added === 1 ? 'fila importada' : 'filas importadas') : (added === 1 ? 'row imported' : 'rows imported')),
        added ? 'ok' : 'err'
      );
    } catch (err) {
      if (window.console) console.error('Fleet Intake: file parse failed', err);
      setUploadStatus(currentLang === 'es' ? 'No se pudo leer ese archivo.' : 'Could not read that file.', 'err');
    }
  };
  reader.readAsArrayBuffer(file);
}

function hasAnyValue(row) {
  return EQ_COLS.some(function (k) { return row[k] && String(row[k]).trim(); });
}

/* ---------------------------------------------------------
   Tabs (manual vs upload)
   --------------------------------------------------------- */
function switchTab(mode) {
  var isUpload = mode === 'upload';
  document.getElementById('tabManual').setAttribute('aria-selected', String(!isUpload));
  document.getElementById('tabUpload').setAttribute('aria-selected', String(isUpload));
  document.getElementById('uploadPane').classList.toggle('hidden', !isUpload);
}

/* ---------------------------------------------------------
   Validation + submit
   --------------------------------------------------------- */
function validateCompany() {
  var ok = true;
  ['companyName', 'contactPerson', 'email', 'phone'].forEach(function (id) {
    var input = document.getElementById(id);
    var fieldEl = document.getElementById('field-' + id);
    var value = input.value.trim();
    var valid = value.length > 0;
    if (id === 'email' && valid) valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    fieldEl.classList.toggle('invalid', !valid);
    if (!valid) ok = false;
  });
  return ok;
}

function hasUsableEquipment() {
  return state.equipment.some(function (r) { return (r.brand && r.brand.trim()) || (r.model && r.model.trim()); });
}

function isCompanyComplete() {
  return ['companyName', 'contactPerson', 'email', 'phone'].every(function (id) {
    var v = document.getElementById(id).value.trim();
    if (!v) return false;
    if (id === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    return true;
  });
}

function setStepDone(n, done) {
  var el = document.querySelector('.step[data-step="' + n + '"]');
  if (el) el.classList.toggle('done', !!done);
}

function updateSteps() {
  var companyOk = isCompanyComplete();
  setStepDone(1, companyOk);
  setStepDone(2, companyOk && hasUsableEquipment());
}

function showSuccess(submissionId) {
  document.getElementById('intakeForm').classList.add('hidden');
  document.querySelector('.steps').classList.add('hidden');
  document.querySelector('.hero').classList.add('hidden');
  document.getElementById('successPanel').classList.add('show');

  // The reference is the real database id, shortened. It gives the company
  // something concrete to quote back to us, and it is searchable in the
  // admin dashboard.
  var refEl = document.getElementById('successRef');
  if (refEl) {
    if (submissionId) {
      refEl.textContent = t('successRef') + ': ' + String(submissionId).slice(0, 8).toUpperCase();
      refEl.classList.remove('hidden');
    } else {
      refEl.classList.add('hidden');
    }
  }
  setStepDone(3, true);
}

function resetForm() {
  document.getElementById('intakeForm').reset();
  state.equipment = [blankRow()];
  renderEquipmentTable();
  ['companyName', 'contactPerson', 'email', 'phone'].forEach(function (id) {
    document.getElementById('field-' + id).classList.remove('invalid');
  });
  document.getElementById('intakeForm').classList.remove('hidden');
  document.querySelector('.steps').classList.remove('hidden');
  document.querySelector('.hero').classList.remove('hidden');
  document.getElementById('successPanel').classList.remove('show');
  switchTab('manual');
  setStepDone(3, false);
}

function downloadCopy() {
  if (!lastPayload) return;
  var header = ['Company', 'Contact Person', 'Email', 'Phone'].concat(EQ_COLS);
  var lines = [csvRow(header)];
  lastPayload.equipment.forEach(function (r) {
    lines.push(csvRow(
      [lastPayload.company.name, lastPayload.company.contactPerson, lastPayload.company.email, lastPayload.company.phone]
        .concat(EQ_COLS.map(function (c) { return r[c] || ''; }))
    ));
  });
  var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'fleet-intake-' + (lastPayload.company.name || 'submission').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}

function onSubmit(e) {
  e.preventDefault();
  var statusEl = document.getElementById('submitStatus');
  statusEl.className = '';
  statusEl.textContent = '';

  if (!validateCompany()) {
    statusEl.className = 'err';
    statusEl.textContent = t('submitErrCompany');
    return;
  }
  if (!hasUsableEquipment()) {
    statusEl.className = 'err';
    statusEl.textContent = t('submitErrEquip');
    return;
  }
  if (!window.SUPABASE_CONFIG || !window.SUPABASE_CONFIG.isConfigured()) {
    statusEl.className = 'err';
    statusEl.textContent = t('submitErrOffline');
    return;
  }

  var payload = {
    language: currentLang,
    submittedAt: new Date().toISOString(),
    company: {
      name: document.getElementById('companyName').value.trim(),
      contactPerson: document.getElementById('contactPerson').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim()
    },
    equipment: state.equipment.filter(function (r) { return (r.brand && r.brand.trim()) || (r.model && r.model.trim()); })
  };
  lastPayload = payload;

  statusEl.className = 'pending';
  statusEl.textContent = t('submitting');
  var submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;

  // Supabase exposes Postgres functions over HTTP with permissive CORS, so a
  // plain fetch works from GitHub Pages and we get a real answer back —
  // success is only shown once the database confirms the write.
  var cfg = window.SUPABASE_CONFIG;
  fetch(cfg.url.replace(/\/+$/, '') + '/rest/v1/rpc/submit_fleet_intake', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': cfg.anonKey,
      'Authorization': 'Bearer ' + cfg.anonKey
    },
    body: JSON.stringify({ payload: payload })
  })
    .then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }
        if (!res.ok) {
          // PostgREST surfaces our raise exception text in `message`.
          var msg = (body && (body.message || body.hint || body.details)) || ('HTTP ' + res.status);
          var err = new Error(msg);
          err.isServer = true;
          throw err;
        }
        return body;
      });
    })
    .then(function (submissionId) {
      submitBtn.disabled = false;
      statusEl.className = '';
      statusEl.textContent = '';
      showSuccess(submissionId);
    })
    .catch(function (err) {
      submitBtn.disabled = false;
      statusEl.className = 'err';
      statusEl.textContent = err && err.isServer
        ? t('submitErrServer').replace('{msg}', err.message)
        : t('submitErrNetwork');
      // The typed list is still on screen and lastPayload is set, so the
      // company can fix the problem and press submit again, or download
      // their CSV copy, without retyping anything.
    });
}

/* ---------------------------------------------------------
   Wire everything up
   --------------------------------------------------------- */
function init() {
  state.equipment.push(blankRow());
  currentLang = detectInitialLang();
  applyI18n();
  switchTab('manual');

  document.getElementById('langEn').addEventListener('click', function () { setLanguage('en'); });
  document.getElementById('langEs').addEventListener('click', function () { setLanguage('es'); });

  document.getElementById('tabManual').addEventListener('click', function () { switchTab('manual'); });
  document.getElementById('tabUpload').addEventListener('click', function () { switchTab('upload'); });

  document.getElementById('addRowBtn').addEventListener('click', addRow);

  document.getElementById('eqBody').addEventListener('input', function (e) {
    var input = e.target.closest && e.target.closest('input[data-idx]');
    if (!input) return;
    var idx = parseInt(input.getAttribute('data-idx'), 10);
    var key = input.getAttribute('data-key');
    if (state.equipment[idx]) state.equipment[idx][key] = input.value;
  });
  document.getElementById('eqBody').addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.del-row-btn');
    if (!btn) return;
    var idx = parseInt(btn.getAttribute('data-idx'), 10);
    state.equipment.splice(idx, 1);
    renderEquipmentTable();
  });

  document.getElementById('browseBtn').addEventListener('click', function () {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', function (e) {
    handleFiles(e.target.files);
    e.target.value = '';
  });

  var dropZone = document.getElementById('dropZone');
  ['dragenter', 'dragover'].forEach(function (evt) {
    dropZone.addEventListener(evt, function (e) { e.preventDefault(); dropZone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    dropZone.addEventListener(evt, function (e) { e.preventDefault(); dropZone.classList.remove('dragover'); });
  });
  dropZone.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  });

  document.getElementById('intakeForm').addEventListener('submit', onSubmit);
  document.getElementById('intakeForm').addEventListener('input', updateSteps);
  document.getElementById('submitAnotherBtn').addEventListener('click', resetForm);
  document.getElementById('downloadCopyBtn').addEventListener('click', downloadCopy);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
