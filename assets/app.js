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

/* Above this many rows the editable table gets heavy enough to be worth
   warning about (nine inputs per row). The submission itself is unaffected. */
var RENDER_WARN_ROWS = 300;
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
  // Placeholders are a hint for an empty row someone is about to type into.
  // On an imported row they read as demands: 577 machines with no price
  // column turns into 577 cells whispering "$450 / day". A row that already
  // carries data gets none.
  var isBlank = !hasAnyValue(row);
  var cells = EQ_COLS.map(function (key) {
    var ph = isBlank ? escAttr(t(PLACEHOLDER_KEY[key])) : '';
    return '<td><input type="text" data-idx="' + idx + '" data-key="' + key +
      '" value="' + escAttr(row[key]) + '" placeholder="' + ph + '"></td>';
  }).join('');
  return '<tr>' + cells +
    '<td class="col-action"><button type="button" class="del-row-btn" data-idx="' + idx +
    '" aria-label="Delete row">&times;</button></td></tr>';
}

/* A long imported list does not want to be 577 rows of editable inputs: it is
   slow, and it looks like a form demanding to be filled in. Show what arrived,
   say it is ready, and keep editing one click away. */
var COMPACT_THRESHOLD = 40;
var COMPACT_PREVIEW = 8;
var forceFullTable = false;

function compactHtml() {
  var n = state.equipment.length;
  var filled = {};
  EQ_COLS.forEach(function (k) {
    filled[k] = state.equipment.filter(function (r) { return r[k] && String(r[k]).trim(); }).length;
  });
  var present = EQ_COLS.filter(function (k) { return filled[k] > 0; });
  var missing = EQ_COLS.filter(function (k) { return filled[k] === 0; });

  var head = present.map(function (k) { return '<th>' + escAttr(colLabel(k)) + '</th>'; }).join('');
  var body = state.equipment.slice(0, COMPACT_PREVIEW).map(function (r) {
    return '<tr>' + present.map(function (k) {
      return '<td>' + escAttr(String(r[k] || '').slice(0, 30)) + '</td>';
    }).join('') + '</tr>';
  }).join('');

  return '' +
    '<div class="compact-head">' +
      '<p class="compact-count"><strong>' + n + '</strong> ' + t('compactReady') + '</p>' +
      '<button type="button" class="btn btn-sm" id="expandTableBtn">' + t('compactEdit') + '</button>' +
    '</div>' +
    '<div class="compact-scroll"><table class="compact-table">' +
      '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>' +
    '</table></div>' +
    (n > COMPACT_PREVIEW
      ? '<p class="compact-more">' + t('compactMore').replace('{n}', n - COMPACT_PREVIEW) + '</p>'
      : '') +
    (missing.length
      ? '<p class="compact-missing">' + t('compactMissing').replace('{cols}',
          missing.map(colLabel).join(', ')) + '</p>'
      : '');
}

function colLabel(key) {
  var map = {
    brand: 'colBrand', type: 'colType', model: 'colModel', unitId: 'colId',
    capacity: 'colCapacity', age: 'colAge', location: 'colLocation',
    price: 'colPrice', contact: 'colContact'
  };
  return t(map[key]) || key;
}

function renderEquipmentTable() {
  var tbody = document.getElementById('eqBody');
  var compact = document.getElementById('compactView');
  var tableWrap = document.querySelector('.eq-table-wrap');
  var big = state.equipment.length > COMPACT_THRESHOLD && !forceFullTable;

  if (compact) {
    compact.classList.toggle('hidden', !big);
    if (tableWrap) tableWrap.classList.toggle('hidden', big);
    if (big) {
      compact.innerHTML = compactHtml();
      var btn = document.getElementById('expandTableBtn');
      if (btn) btn.addEventListener('click', function () {
        forceFullTable = true;
        renderEquipmentTable();
      });
      updateEqCount();
      updateSteps();
      renderScopeSummary();
      return;   // the editable table stays unrendered, which is the point
    }
  }

  if (!state.equipment.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="eq-empty">' + t('eqEmpty') + '</td></tr>';
  } else {
    tbody.innerHTML = state.equipment.map(rowTemplate).join('');
  }
  updateEqCount();
  updateSteps();
  renderScopeSummary();
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

   Real files from real companies do not arrive in our shape. They
   have a title row and a division row above the headers, several
   sheets where the first one is a summary with no equipment in it,
   and column names nobody agreed on. So instead of assuming, this
   reads every sheet, works out where each one's header row is,
   scores them, picks the most likely, and then SHOWS that guess as
   an editable mapping the person can correct before importing.

   Anything we cannot map is kept as an extra column rather than
   dropped, so cleaning up later is possible.
   --------------------------------------------------------- */
function normalizeHeader(s) {
  return String(s || '')
    .replace(/\(.*?\)/g, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/* A single header cell often carries two labels ("MODELO / MARCA",
   "TIPO / DESCRIPCIÓN") or trails a unit ("PRICE PER DAY (24 HR) USD").
   Try the whole thing, then each side of the separator, then again with a
   trailing currency dropped. */
function headerCandidates(h) {
  var out = [];
  function push(v) { if (v && out.indexOf(v) === -1) out.push(v); }
  push(normalizeHeader(h));
  String(h || '').split(/[\/|]+/).forEach(function (part) { push(normalizeHeader(part)); });
  out.slice().forEach(function (v) { push(v.replace(/(usd|eur|ves)$/, '')); });
  return out;
}

function matchField(header) {
  var cands = headerCandidates(header);
  var keys = Object.keys(HEADER_ALIASES);
  for (var k = 0; k < keys.length; k++) {
    var aliases = HEADER_ALIASES[keys[k]];
    for (var i = 0; i < aliases.length; i++) {
      if (cands.indexOf(aliases[i]) !== -1) return keys[k];
    }
  }
  return null;
}

/* Score a candidate header row: how many of our fields it matches, and how
   many non-empty cells it has. A title row like ["ACME S.A.", "", "", ""]
   scores 0 and loses to the real header row further down. */
function scoreHeaderRow(row) {
  if (!row) return { hits: 0, filled: 0, score: -1 };
  var filled = 0, hits = 0, seen = {};
  for (var i = 0; i < row.length; i++) {
    var cell = String(row[i] == null ? '' : row[i]).trim();
    if (!cell) continue;
    filled++;
    var f = matchField(cell);
    if (f && !seen[f]) { seen[f] = 1; hits++; }
  }
  return { hits: hits, filled: filled, score: hits * 10 + Math.min(filled, 12) };
}

function countDataRows(rows, headerIdx) {
  var n = 0;
  for (var i = headerIdx + 1; i < rows.length; i++) {
    var r = rows[i];
    if (r && r.some(function (c) { return String(c == null ? '' : c).trim(); })) n++;
  }
  return n;
}

/* Look at every sheet, find its best header row, and rank them. */
function analyzeWorkbook(wb) {
  var HEADER_SCAN_DEPTH = 25;
  var sheets = [];
  wb.SheetNames.forEach(function (name) {
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    if (!rows.length) return;
    var best = { idx: 0, score: -1, hits: 0 };
    var depth = Math.min(HEADER_SCAN_DEPTH, rows.length);
    for (var i = 0; i < depth; i++) {
      var s = scoreHeaderRow(rows[i]);
      if (s.score > best.score) best = { idx: i, score: s.score, hits: s.hits };
    }
    var dataRows = countDataRows(rows, best.idx);
    sheets.push({
      name: name,
      rows: rows,
      headerIdx: best.idx,
      hits: best.hits,
      dataRows: dataRows,
      // A sheet only wins on volume once it has proven it has real headers.
      score: best.hits * 1000 + Math.min(dataRows, 999)
    });
  });
  sheets.sort(function (a, b) { return b.score - a.score; });
  return sheets;
}

/* ---------------------------------------------------------
   Import review panel
   --------------------------------------------------------- */
var importState = null;   // { sheets, sheetIdx, headerIdx, map }

function setUploadStatus(msg, kind) {
  var el = document.getElementById('uploadStatus');
  el.textContent = msg;
  el.className = 'upload-status' + (kind ? ' ' + kind : '');
}

function currentSheet() {
  return importState && importState.sheets[importState.sheetIdx];
}

function headerRowCells() {
  var sh = currentSheet();
  if (!sh) return [];
  return (sh.rows[importState.headerIdx] || []).map(function (c, i) {
    var label = String(c == null ? '' : c).trim();
    return { idx: i, label: label || ('Column ' + (i + 1)) };
  });
}

function autoMap() {
  var map = {};
  headerRowCells().forEach(function (col) {
    var f = matchField(col.label);
    if (f && map[f] == null) map[f] = col.idx;
  });
  return map;
}

function renderImportPanel() {
  var panel = document.getElementById('importPanel');
  var sh = currentSheet();
  if (!sh) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  // Sheet picker — only worth showing when the file has more than one.
  var sheetWrap = document.getElementById('importSheetWrap');
  if (importState.sheets.length > 1) {
    sheetWrap.classList.remove('hidden');
    document.getElementById('importSheet').innerHTML = importState.sheets.map(function (s, i) {
      return '<option value="' + i + '"' + (i === importState.sheetIdx ? ' selected' : '') + '>' +
        escAttr(s.name) + ' (' + s.dataRows + ' ' + t('importRowsWord') + ')</option>';
    }).join('');
  } else {
    sheetWrap.classList.add('hidden');
  }

  // Header row picker
  var opts = [];
  for (var i = 0; i < Math.min(25, sh.rows.length); i++) {
    var preview = (sh.rows[i] || []).slice(0, 5)
      .map(function (c) { return String(c == null ? '' : c).trim(); })
      .filter(Boolean).join(' · ').slice(0, 58);
    opts.push('<option value="' + i + '"' + (i === importState.headerIdx ? ' selected' : '') + '>' +
      t('importRowWord') + ' ' + (i + 1) + (preview ? ' — ' + escAttr(preview) : '') + '</option>');
  }
  document.getElementById('importHeaderRow').innerHTML = opts.join('');

  // One dropdown per field we store
  var cols = headerRowCells();
  var fieldLabels = {
    brand: t('thBrand'), type: t('thType'), model: t('thModel'), unitId: t('thId'),
    capacity: t('thCapacity'), age: t('thAge'), location: t('thLocation'),
    price: t('thPrice'), contact: t('thContact')
  };
  document.getElementById('importMap').innerHTML = EQ_COLS.map(function (key) {
    var sel = importState.map[key];
    return '<label class="map-row">' +
      '<span class="map-field">' + escAttr(fieldLabels[key] || key) + '</span>' +
      '<select data-field="' + key + '">' +
      '<option value="">' + t('importIgnore') + '</option>' +
      cols.map(function (c) {
        return '<option value="' + c.idx + '"' + (sel === c.idx ? ' selected' : '') + '>' +
          escAttr(c.label) + '</option>';
      }).join('') +
      '</select></label>';
  }).join('');

  renderImportPreview();
}

function importRowsFromMapping() {
  var sh = currentSheet();
  var cols = headerRowCells();
  var mapped = {};
  Object.keys(importState.map).forEach(function (k) {
    if (importState.map[k] != null) mapped[importState.map[k]] = k;
  });

  var out = [];
  for (var i = importState.headerIdx + 1; i < sh.rows.length; i++) {
    var raw = sh.rows[i];
    if (!raw || !raw.some(function (c) { return String(c == null ? '' : c).trim(); })) continue;

    var row = blankRow();
    var extras = {};
    for (var c = 0; c < cols.length; c++) {
      var val = String(raw[c] == null ? '' : raw[c]).trim();
      if (!val || val === 'N/D' || val === 'N/A' || val === '-') continue;
      if (mapped[c]) row[mapped[c]] = val;
      else extras[cols[c].label] = val;   // keep it rather than lose it
    }
    if (Object.keys(extras).length) row.extras = extras;
    if (hasAnyValue(row)) out.push(row);
  }
  return out;
}

function renderImportPreview() {
  var rows = importRowsFromMapping();
  var el = document.getElementById('importPreview');
  if (!rows.length) {
    el.innerHTML = '<p class="import-warn">' + t('importNoRows') + '</p>';
    document.getElementById('importConfirm').disabled = true;
    return;
  }
  document.getElementById('importConfirm').disabled = false;

  var show = rows.slice(0, 3);
  var extraKeys = [];
  rows.forEach(function (r) {
    Object.keys(r.extras || {}).forEach(function (k) {
      if (extraKeys.indexOf(k) === -1) extraKeys.push(k);
    });
  });

  el.innerHTML =
    '<table class="import-preview-table"><thead><tr>' +
      EQ_COLS.map(function (k) { return '<th>' + escAttr(k) + '</th>'; }).join('') +
    '</tr></thead><tbody>' +
      show.map(function (r) {
        return '<tr>' + EQ_COLS.map(function (k) {
          return '<td>' + escAttr(String(r[k] || '')).slice(0, 26) + '</td>';
        }).join('') + '</tr>';
      }).join('') +
    '</tbody></table>' +
    (extraKeys.length
      ? '<p class="import-extra">' + t('importExtraKept').replace('{cols}', extraKeys.slice(0, 8).join(', ')) + '</p>'
      : '');

  document.getElementById('importCount').textContent =
    t('importWillAdd').replace('{n}', rows.length);
}

function handleFiles(fileList) {
  var file = fileList && fileList[0];
  if (!file) return;
  setUploadStatus(t('importReading'), '');

  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      var sheets = analyzeWorkbook(wb);

      if (!sheets.length || !sheets[0].dataRows) {
        setUploadStatus(t('importEmpty'), 'err');
        document.getElementById('importPanel').classList.add('hidden');
        return;
      }

      importState = {
        sheets: sheets, sheetIdx: 0, headerIdx: sheets[0].headerIdx,
        map: {}, fileName: file.name, startIdx: null
      };
      importState.map = autoMap();

      // Apply it straight away. Making the rows wait behind a confirm button
      // meant a file could look imported, sit there unapplied, and then fail
      // submission with "add at least one machine". The panel below is for
      // correcting the guess, not for granting permission.
      applyImport();
      renderImportPanel();
    } catch (err) {
      if (window.console) console.error('Fleet Intake: file parse failed', err);
      setUploadStatus(t('importFailed'), 'err');
      document.getElementById('importPanel').classList.add('hidden');
    }
  };
  reader.readAsArrayBuffer(file);
}

/* What of this list we would actually register, shown before submitting so
   nobody is surprised later. Nothing is removed from their list: out-of-scope
   machines still go with the submission and are simply not counted as fleet. */
function renderScopeSummary() {
  var el = document.getElementById('scopeSummary');
  if (!el || typeof FleetScope === 'undefined') return;

  var rows = state.equipment.filter(hasAnyValue);
  if (!rows.length) { el.classList.add('hidden'); return; }

  var s = FleetScope.summarize(rows);
  el.classList.remove('hidden');

  if (!s.in && !s.review) {
    el.className = 'scope-summary err';
    el.innerHTML = '<p>' + t('scopeSummaryNone') + '</p>';
    return;
  }

  var parts = ['<p class="ss-in">' + t('scopeSummaryIn').replace('{n}', s.in) + '</p>'];
  if (s.out) {
    parts.push('<p class="ss-out">' + t('scopeSummaryOut').replace('{n}', s.out) +
      (s.outSamples.length
        ? ' <span class="ss-eg">' + t('scopeWhatOut').replace('{list}', escAttr(s.outSamples.join(', '))) + '</span>'
        : '') + '</p>');
  }
  if (s.review) {
    parts.push('<p class="ss-review">' + t('scopeSummaryReview').replace('{n}', s.review) + '</p>');
  }
  el.className = 'scope-summary';
  el.innerHTML = parts.join('');
}

/* Put the imported rows into the list, replacing whatever a previous pass of
   this same file put there. Called on load and again on every mapping change,
   so what is on screen is always what would be submitted. */
function applyImport() {
  if (!importState) return;

  if (importState.startIdx === null) {
    // Drop the single empty starter row the first time real data arrives.
    if (state.equipment.length === 1 && !hasAnyValue(state.equipment[0])) state.equipment.length = 0;
    importState.startIdx = state.equipment.length;
  } else {
    // Re-mapping: throw away this file's previous rows, keep anything typed
    // by hand before the upload.
    state.equipment.length = importState.startIdx;
  }

  var rows = importRowsFromMapping();
  rows.forEach(function (r) { state.equipment.push(r); });
  importState.appliedCount = rows.length;

  renderEquipmentTable();

  setUploadStatus(
    rows.length
      ? t('importFound')
          .replace('{file}', importState.fileName)
          .replace('{sheet}', currentSheet().name)
          .replace('{row}', String(importState.headerIdx + 1)) +
        ' ' + t('importDone').replace('{n}', rows.length)
      : t('importNoRows'),
    rows.length ? 'ok' : 'err'
  );
}

/* The panel's button only dismisses it — the rows are already in. */
function confirmImport() {
  document.getElementById('importPanel').classList.add('hidden');
  importState = null;
  switchTab('manual');
  var target = document.getElementById('compactView');
  if (!target || target.classList.contains('hidden')) target = document.querySelector('.eq-table-wrap');
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelImport() {
  // The rows are already in the list, so cancelling has to take them back
  // out again, leaving anything typed by hand before the upload.
  if (importState && importState.startIdx !== null) {
    state.equipment.length = importState.startIdx;
    if (!state.equipment.length) state.equipment.push(blankRow());
    renderEquipmentTable();
  }
  importState = null;
  document.getElementById('importPanel').classList.add('hidden');
  setUploadStatus('', '');
  document.getElementById('fileInput').value = '';
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
  // Matches the submit filter: a row counts if anything at all is filled in.
  // Many real lists identify a machine by description and serial with no
  // separate brand or model column.
  return state.equipment.some(hasAnyValue);
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
    // Any row with something in it counts. Requiring a brand or a model
    // would silently drop machines from lists that identify a unit by
    // description and serial alone, which plenty of them do.
    equipment: state.equipment.filter(hasAnyValue).map(function (r) {
      // The classifier's verdict rides with each machine so the database
      // stores the same decision the company was shown.
      if (typeof FleetScope !== 'undefined') {
        var v = FleetScope.classify(r);
        r.scope = v.scope;
        r.scopeReason = v.reason;
      }
      return r;
    })
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
function showScopeModal() {
  var m = document.getElementById('scopeModal');
  if (!m) return;
  // Shown once per browser: a returning company does not need telling twice.
  var seen = false;
  try { seen = localStorage.getItem('fleetScopeSeen') === '1'; } catch (e) { /* ignore */ }
  if (seen) { m.classList.add('hidden'); return; }
  m.classList.add('show');
  document.getElementById('scopeAccept').addEventListener('click', function () {
    m.classList.remove('show');
    m.classList.add('hidden');
    try { localStorage.setItem('fleetScopeSeen', '1'); } catch (e) { /* ignore */ }
  });
}

function init() {
  state.equipment.push(blankRow());
  currentLang = detectInitialLang();
  showScopeModal();
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
  document.getElementById('importConfirm').addEventListener('click', confirmImport);
  document.getElementById('importCancel').addEventListener('click', cancelImport);

  document.getElementById('importSheet').addEventListener('change', function (e) {
    importState.sheetIdx = Number(e.target.value);
    // A different sheet has its own header row and its own columns, so the
    // guess has to be made again rather than carried over.
    importState.headerIdx = currentSheet().headerIdx;
    importState.map = autoMap();
    applyImport();
    renderImportPanel();
  });

  document.getElementById('importHeaderRow').addEventListener('change', function (e) {
    importState.headerIdx = Number(e.target.value);
    importState.map = autoMap();
    applyImport();
    renderImportPanel();
  });

  document.getElementById('importMap').addEventListener('change', function (e) {
    var sel = e.target.closest('select[data-field]');
    if (!sel) return;
    var field = sel.getAttribute('data-field');
    var val = sel.value === '' ? null : Number(sel.value);
    // One spreadsheet column cannot feed two of our fields, so assigning it
    // here takes it away from whichever field had it.
    if (val != null) {
      Object.keys(importState.map).forEach(function (k) {
        if (k !== field && importState.map[k] === val) importState.map[k] = null;
      });
    }
    importState.map[field] = val;
    applyImport();
    renderImportPanel();
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
