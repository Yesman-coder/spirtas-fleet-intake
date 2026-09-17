/* =========================================================
   Spirtas Worldwide — Fleet Intake Admin

   Reads registrations out of Supabase and renders them as a
   filterable table with CSV / Excel export.

   Access control lives in the database, not here. Every query
   below runs against row-level security policies that require
   the signed-in user to appear in public.admins — hiding the
   dashboard behind this login is convenience, the policies are
   the actual protection. See supabase/schema.sql.
   ========================================================= */

(function () {
  'use strict';

  var PAGE_SIZE = 100;
  var SEARCH_DEBOUNCE_MS = 250;

  var EQ_COLS = [
    { key: 'brand',    label: 'Brand' },
    { key: 'type',     label: 'Type' },
    { key: 'model',    label: 'Model' },
    { key: 'unit_id',  label: 'Unit ID' },
    { key: 'capacity', label: 'Capacity' },
    { key: 'age',      label: 'Age' },
    { key: 'location', label: 'Location' },
    { key: 'price',    label: 'Price/Day' },
    { key: 'contact',  label: 'Contact' }
  ];

  var STATUSES = ['new', 'reviewed', 'archived'];

  var client = null;
  var state = {
    rows: [],
    offset: 0,
    hasMore: false,
    total: 0,
    search: '',
    status: 'all',
    days: 'all',
    sortKey: 'submitted_at',
    sortAsc: false,
    expanded: {},      // submission id -> true
    equipment: {},     // submission id -> array (cached after first fetch)
    loading: false
  };

  /* -------------------------------------------------------
     Tiny helpers
     ------------------------------------------------------- */
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function refOf(id) { return String(id || '').slice(0, 8).toUpperCase(); }

  function fmtNum(n) { return Number(n || 0).toLocaleString('en-US'); }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  var toastTimer = null;
  function toast(msg, isErr) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 4200);
  }

  /* -------------------------------------------------------
     CSV / Excel
     ------------------------------------------------------- */
  function csvCell(v) {
    v = String(v == null ? '' : v);
    // A leading =, @, + or - makes Excel treat the cell as a formula, which is
    // how a hostile submission could run something on a reviewer's machine.
    // Prefixing with a quote defuses it. The exception is a value that is only
    // digits and phone punctuation after the sign: "+57 300 555 0101" cannot
    // call anything, and quoting it would put a stray apostrophe in the export.
    var looksLikePhone = /^[+\-][\d\s().\-]*$/.test(v);
    if (/^[=@]/.test(v) || (/^[+\-]/.test(v) && !looksLikePhone)) v = "'" + v;
    if (/["\r\n,]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  function toCsv(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function stamp() {
    return new Date().toISOString().slice(0, 10);
  }

  /* -------------------------------------------------------
     Auth
     ------------------------------------------------------- */
  function showAuth(message, isErr) {
    $('authView').classList.remove('hidden');
    $('dashView').classList.add('hidden');
    $('sessionBar').classList.add('hidden');
    if (message) {
      var s = $('authStatus');
      s.className = isErr ? 'err' : '';
      s.textContent = message;
    }
  }

  function showDash(email) {
    $('authView').classList.add('hidden');
    $('dashView').classList.remove('hidden');
    $('sessionBar').classList.remove('hidden');
    $('userEmail').textContent = email || '';
  }

  function onSignIn(e) {
    e.preventDefault();
    var status = $('authStatus');
    var email = $('authEmail').value.trim();
    var password = $('authPassword').value;

    if (!email || !password) {
      status.className = 'err';
      status.textContent = 'Enter your email and password.';
      return;
    }

    var btn = $('signInBtn');
    btn.disabled = true;
    status.className = 'pending';
    status.textContent = 'Signing in…';

    client.auth.signInWithPassword({ email: email, password: password })
      .then(function (res) {
        btn.disabled = false;
        if (res.error) {
          status.className = 'err';
          status.textContent = res.error.message || 'Sign in failed.';
          return;
        }
        $('authPassword').value = '';
        status.textContent = '';
        enterDashboard(res.data.user);
      })
      .catch(function (err) {
        btn.disabled = false;
        status.className = 'err';
        status.textContent = 'Could not reach the server. ' + (err && err.message ? err.message : '');
      });
  }

  function onSignOut() {
    client.auth.signOut().then(function () {
      state.rows = [];
      state.offset = 0;
      state.expanded = {};
      state.equipment = {};
      showAuth('Signed out.', false);
    });
  }

  // Being signed in is not the same as being allowed. The policies would
  // simply return an empty list to a non-admin, which reads like "no data"
  // rather than "no access" — so ask explicitly and say which it is.
  function enterDashboard(user) {
    client.from('admins').select('user_id').eq('user_id', user.id).maybeSingle()
      .then(function (res) {
        if (res.error) {
          showAuth('Could not verify your access: ' + res.error.message, true);
          return;
        }
        if (!res.data) {
          client.auth.signOut();
          showAuth('That account is signed in but not on the admin list. Ask an administrator to add you.', true);
          return;
        }
        showDash(user.email);
        reload();
      });
  }

  /* -------------------------------------------------------
     Queries
     ------------------------------------------------------- */

  // PostgREST parses commas and parentheses inside an `or` filter, so strip
  // the characters that would change the meaning of the query.
  function safeTerm(s) {
    return String(s || '').replace(/[,()*\\]/g, ' ').trim();
  }

  function applyFilters(q) {
    if (state.status !== 'all') q = q.eq('status', state.status);
    if (state.days !== 'all') {
      var since = new Date(Date.now() - Number(state.days) * 86400000).toISOString();
      q = q.gte('submitted_at', since);
    }
    var term = safeTerm(state.search);
    if (term) {
      var like = '*' + term + '*';
      q = q.or([
        'company_name.ilike.' + like,
        'contact_person.ilike.' + like,
        'email.ilike.' + like,
        'phone.ilike.' + like,
        'ref.ilike.' + like
      ].join(','));
    }
    return q;
  }

  function fetchPage(append) {
    if (state.loading) return;
    state.loading = true;

    if (!append) {
      state.offset = 0;
      $('loadingState').classList.remove('hidden');
      $('emptyState').classList.add('hidden');
    }

    var q = client
      .from('submissions')
      .select('id,ref,submitted_at,language,company_name,contact_person,email,phone,equipment_count,status,notes', { count: 'exact' });

    q = applyFilters(q)
      .order(state.sortKey, { ascending: state.sortAsc })
      .range(state.offset, state.offset + PAGE_SIZE - 1);

    q.then(function (res) {
      state.loading = false;
      $('loadingState').classList.add('hidden');

      if (res.error) {
        toast('Could not load registrations: ' + res.error.message, true);
        return;
      }

      var batch = res.data || [];
      state.rows = append ? state.rows.concat(batch) : batch;
      state.offset = state.rows.length;
      state.total = res.count == null ? state.rows.length : res.count;
      state.hasMore = state.rows.length < state.total;

      render();
    });
  }

  function loadStats() {
    client.rpc('fleet_intake_stats').then(function (res) {
      if (res.error || !res.data) return;
      var s = res.data;

      $('statCompanies').textContent = fmtNum(s.companies);
      $('statMachines').textContent = fmtNum(s.machines);
      $('statWeek').textContent = fmtNum(s.last7);

      $('statCompaniesFoot').textContent =
        s.awaiting > 0 ? fmtNum(s.awaiting) + ' awaiting review' : 'All reviewed';

      var avg = s.companies > 0 ? Math.round(s.machines / s.companies) : 0;
      $('statMachinesFoot').textContent = avg > 0 ? avg + ' per company on average' : ' ';

      var delta = Number(s.last7) - Number(s.prev7);
      $('statWeekFoot').textContent = Number(s.prev7) === 0
        ? (Number(s.last7) > 0 ? 'First registrations in 2 weeks' : 'None in the last 7 days')
        : (delta === 0 ? 'Same as the week before'
          : (delta > 0 ? '+' : '') + delta + ' vs the week before');

      drawSparkline(s.weekly || []);
    });
  }

  /* -------------------------------------------------------
     Sparkline — one series, so no legend and no color coding;
     the tile label names it and hover gives the exact value.
     ------------------------------------------------------- */
  // Postgres hands back a plain calendar date ("2026-09-14"). Building the
  // matching key with toISOString() would shift it by a day for anyone east
  // of UTC — local Monday 00:00 is the previous Sunday in UTC — and every
  // bucket would miss. Read the local parts directly instead.
  function dateKey(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function drawSparkline(weekly) {
    var svg = $('sparkline');
    var W = 320, H = 64, PAD = 4;

    // Fill in the weeks with no registrations so the gaps read as zero
    // rather than being skipped, which would flatten the shape.
    var buckets = [];
    var monday = new Date();
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    for (var i = 11; i >= 0; i--) {
      var d = new Date(monday);
      d.setDate(d.getDate() - i * 7);
      var key = dateKey(d);
      var hit = null;
      for (var j = 0; j < weekly.length; j++) {
        if (String(weekly[j].week).slice(0, 10) === key) { hit = weekly[j]; break; }
      }
      buckets.push({ week: d, n: hit ? Number(hit.n) : 0 });
    }

    var max = Math.max(1, Math.max.apply(null, buckets.map(function (b) { return b.n; })));
    var stepX = (W - PAD * 2) / (buckets.length - 1);

    var pts = buckets.map(function (b, idx) {
      return {
        x: PAD + idx * stepX,
        y: H - PAD - (b.n / max) * (H - PAD * 2),
        b: b
      };
    });

    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
    var area = line + ' L' + pts[pts.length - 1].x.toFixed(1) + ' ' + (H - PAD) +
               ' L' + pts[0].x.toFixed(1) + ' ' + (H - PAD) + ' Z';

    var last = pts[pts.length - 1];
    var parts = [
      '<defs><linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">',
      '<stop offset="0%" stop-color="var(--brand-green)" stop-opacity="0.28"/>',
      '<stop offset="100%" stop-color="var(--brand-green)" stop-opacity="0"/>',
      '</linearGradient></defs>',
      '<path d="' + area + '" fill="url(#sparkFill)"/>',
      '<path d="' + line + '" fill="none" stroke="var(--brand-green)" stroke-width="2" ',
      'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>',
      // 2px surface ring keeps the end marker legible where it sits on the line
      '<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="3.5" ',
      'fill="var(--brand-green)" stroke="var(--surface)" stroke-width="2"/>'
    ];

    // Invisible full-height hit targets: easier to hover than a 2px line.
    pts.forEach(function (p, idx) {
      parts.push(
        '<rect class="spark-hit" data-idx="' + idx + '" x="' + (p.x - stepX / 2).toFixed(1) +
        '" y="0" width="' + stepX.toFixed(1) + '" height="' + H + '" fill="transparent"/>'
      );
    });

    svg.innerHTML = parts.join('');

    var tip = $('sparkTip');
    svg.addEventListener('mousemove', function (e) {
      var hit = e.target.closest ? e.target.closest('.spark-hit') : null;
      if (!hit) return;
      var p = pts[Number(hit.getAttribute('data-idx'))];
      var box = svg.getBoundingClientRect();
      tip.textContent = p.b.n + (p.b.n === 1 ? ' registration' : ' registrations') +
        ' · week of ' + fmtDate(p.b.week.toISOString());
      tip.style.left = (p.x / W * box.width) + 'px';
      tip.style.top = (p.y / H * box.height) + 'px';
      tip.classList.remove('hidden');
    });
    svg.addEventListener('mouseleave', function () { tip.classList.add('hidden'); });
  }

  /* -------------------------------------------------------
     Table rendering
     ------------------------------------------------------- */
  function statusBadge(status) {
    var s = STATUSES.indexOf(status) === -1 ? 'new' : status;
    return '<span class="badge-status status-' + s + '">' + s + '</span>';
  }

  function rowHtml(r) {
    var telHref = 'tel:' + String(r.phone || '').replace(/[^\d+]/g, '');
    return '' +
      '<tr class="row-main' + (state.expanded[r.id] ? ' open' : '') + '" data-id="' + esc(r.id) + '">' +
        '<td class="col-expand"><button type="button" class="expand-btn" aria-label="Show equipment" ' +
          'aria-expanded="' + (state.expanded[r.id] ? 'true' : 'false') + '">&#9654;</button></td>' +
        '<td><span class="cell-company">' + esc(r.company_name) + '</span>' +
          '<span class="cell-ref">' + esc(r.ref || refOf(r.id)) + ' · ' + esc((r.language || 'en').toUpperCase()) + '</span></td>' +
        '<td>' + esc(r.contact_person) + '</td>' +
        '<td><a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a></td>' +
        '<td><a href="' + esc(telHref) + '">' + esc(r.phone) + '</a></td>' +
        '<td class="num">' + fmtNum(r.equipment_count) + '</td>' +
        '<td class="cell-date">' + fmtDate(r.submitted_at) + '<small>' + fmtTime(r.submitted_at) + '</small></td>' +
        '<td>' + statusBadge(r.status) + '</td>' +
      '</tr>' +
      (state.expanded[r.id] ? detailHtml(r) : '');
  }

  function detailHtml(r) {
    var eq = state.equipment[r.id];
    var body;

    if (eq === undefined) {
      body = '<p class="detail-loading"><span class="spinner"></span>Loading equipment…</p>';
    } else if (!eq.length) {
      body = '<p class="detail-empty">No equipment rows were saved with this registration.</p>';
    } else {
      body = '<table class="eq-table"><thead><tr><th class="eq-idx">#</th>' +
        EQ_COLS.map(function (c) { return '<th>' + c.label + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        eq.map(function (row, i) {
          return '<tr><td class="eq-idx">' + (i + 1) + '</td>' +
            EQ_COLS.map(function (c) { return '<td>' + esc(row[c.key] || '') + '</td>'; }).join('') +
            '</tr>';
        }).join('') +
        '</tbody></table>';
    }

    var options = STATUSES.map(function (s) {
      return '<option value="' + s + '"' + (r.status === s ? ' selected' : '') + '>' +
        s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
    }).join('');

    return '' +
      '<tr class="row-detail" data-detail-for="' + esc(r.id) + '"><td colspan="8"><div class="detail-inner">' +
        '<div class="detail-head">' +
          '<h3 class="detail-title">' + esc(r.company_name) + ' · ' + fmtNum(r.equipment_count) +
            (Number(r.equipment_count) === 1 ? ' machine' : ' machines') + '</h3>' +
          '<div class="detail-tools">' +
            '<select class="status-select" data-id="' + esc(r.id) + '" aria-label="Change status">' + options + '</select>' +
            '<button type="button" class="btn btn-sm" data-row-csv="' + esc(r.id) + '">Download this list</button>' +
          '</div>' +
        '</div>' + body +
      '</div></td></tr>';
  }

  function render() {
    var body = $('rowsBody');
    body.innerHTML = state.rows.map(rowHtml).join('');

    var any = state.rows.length > 0;
    $('emptyState').classList.toggle('hidden', any || state.loading);

    if (any) {
      var shown = state.rows.length;
      $('resultNote').textContent = shown === state.total
        ? 'Showing all ' + fmtNum(state.total) + (state.total === 1 ? ' registration' : ' registrations')
        : 'Showing ' + fmtNum(shown) + ' of ' + fmtNum(state.total) + ' registrations';
    } else {
      $('resultNote').textContent = '';
      if (!state.loading && (state.search || state.status !== 'all' || state.days !== 'all')) {
        $('emptyState').innerHTML =
          '<p class="empty-title">No matches</p>' +
          '<p class="empty-body">No registrations match these filters. Try clearing the search or widening the date range.</p>';
      } else if (!state.loading) {
        $('emptyState').innerHTML =
          '<p class="empty-title">No registrations yet</p>' +
          '<p class="empty-body">Submissions from the intake form will appear here the moment they arrive.</p>';
      }
    }

    $('loadMoreBtn').classList.toggle('hidden', !state.hasMore);

    // Reflect the active sort in the header
    var ths = document.querySelectorAll('.admin-table th.sortable');
    for (var i = 0; i < ths.length; i++) {
      var key = ths[i].getAttribute('data-sort');
      if (key === state.sortKey) ths[i].setAttribute('aria-sort', state.sortAsc ? 'ascending' : 'descending');
      else ths[i].removeAttribute('aria-sort');
    }
  }

  function reload() {
    loadStats();
    fetchPage(false);
  }

  /* -------------------------------------------------------
     Expanding a row
     ------------------------------------------------------- */
  function toggleRow(id) {
    if (state.expanded[id]) {
      delete state.expanded[id];
      render();
      return;
    }
    state.expanded[id] = true;
    render();

    if (state.equipment[id] !== undefined) return;

    client.from('equipment')
      .select('row_index,brand,type,model,unit_id,capacity,age,location,price,contact')
      .eq('submission_id', id)
      .order('row_index', { ascending: true })
      .then(function (res) {
        if (res.error) {
          toast('Could not load equipment: ' + res.error.message, true);
          delete state.expanded[id];
        } else {
          state.equipment[id] = res.data || [];
        }
        render();
      });
  }

  function changeStatus(id, status) {
    client.from('submissions').update({ status: status }).eq('id', id).select('id,status')
      .then(function (res) {
        if (res.error) {
          toast('Could not update status: ' + res.error.message, true);
          return;
        }
        for (var i = 0; i < state.rows.length; i++) {
          if (state.rows[i].id === id) { state.rows[i].status = status; break; }
        }
        // The status filter may no longer match this row, so re-run the
        // query rather than leaving a row on screen that the filter excludes.
        if (state.status !== 'all' && state.status !== status) {
          toast('Marked ' + status + ' — removed from this filter');
          fetchPage(false);
        } else {
          toast('Marked ' + status);
          render();
        }
        loadStats();
      });
  }

  /* -------------------------------------------------------
     Export
     ------------------------------------------------------- */
  var COMPANY_HEADERS = ['Reference', 'Submitted', 'Company', 'Contact Person', 'Email', 'Phone', 'Machines', 'Language', 'Status'];

  function companyRow(s) {
    return [
      s.ref || refOf(s.id),
      new Date(s.submitted_at).toISOString(),
      s.company_name, s.contact_person, s.email, s.phone,
      s.equipment_count, (s.language || 'en').toUpperCase(), s.status
    ];
  }

  // Export follows the filters on screen, so "what I am looking at" and
  // "what I downloaded" are always the same set.
  function fetchAllFiltered(withEquipment) {
    var cols = 'id,ref,submitted_at,language,company_name,contact_person,email,phone,equipment_count,status' +
      (withEquipment ? ',equipment(row_index,brand,type,model,unit_id,capacity,age,location,price,contact)' : '');

    var q = client.from('submissions').select(cols);
    return applyFilters(q)
      .order(state.sortKey, { ascending: state.sortAsc })
      .limit(10000);
  }

  function exportCompanies() {
    toast('Preparing CSV…');
    fetchAllFiltered(false).then(function (res) {
      if (res.error) { toast('Export failed: ' + res.error.message, true); return; }
      var rows = [COMPANY_HEADERS].concat((res.data || []).map(companyRow));
      download(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8;' }),
        'fleet-intake-companies-' + stamp() + '.csv');
      toast(fmtNum(rows.length - 1) + ' companies exported');
    });
  }

  function equipmentRows(data) {
    var headers = ['Reference', 'Submitted', 'Company', 'Contact Person', 'Email', 'Phone']
      .concat(EQ_COLS.map(function (c) { return c.label; }));
    var out = [headers];

    (data || []).forEach(function (s) {
      var eq = (s.equipment || []).slice().sort(function (a, b) { return a.row_index - b.row_index; });
      var lead = [
        s.ref || refOf(s.id),
        new Date(s.submitted_at).toISOString(),
        s.company_name, s.contact_person, s.email, s.phone
      ];
      if (!eq.length) {
        out.push(lead.concat(EQ_COLS.map(function () { return ''; })));
        return;
      }
      eq.forEach(function (row) {
        out.push(lead.concat(EQ_COLS.map(function (c) { return row[c.key] || ''; })));
      });
    });
    return out;
  }

  function exportEquipment() {
    toast('Preparing CSV…');
    fetchAllFiltered(true).then(function (res) {
      if (res.error) { toast('Export failed: ' + res.error.message, true); return; }
      var rows = equipmentRows(res.data);
      download(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8;' }),
        'fleet-intake-equipment-' + stamp() + '.csv');
      toast(fmtNum(rows.length - 1) + ' machines exported');
    });
  }

  function exportCombined() {
    if (typeof XLSX === 'undefined') {
      toast('The spreadsheet library did not load — try the CSV options instead.', true);
      return;
    }
    toast('Preparing workbook…');
    fetchAllFiltered(true).then(function (res) {
      if (res.error) { toast('Export failed: ' + res.error.message, true); return; }
      var data = res.data || [];
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,
        XLSX.utils.aoa_to_sheet([COMPANY_HEADERS].concat(data.map(companyRow))), 'Companies');
      XLSX.utils.book_append_sheet(wb,
        XLSX.utils.aoa_to_sheet(equipmentRows(data)), 'Equipment');
      XLSX.writeFile(wb, 'fleet-intake-' + stamp() + '.xlsx');
      toast(fmtNum(data.length) + ' registrations exported');
    });
  }

  function exportSingle(id) {
    var row = null;
    for (var i = 0; i < state.rows.length; i++) {
      if (state.rows[i].id === id) { row = state.rows[i]; break; }
    }
    if (!row) return;
    var eq = state.equipment[id] || [];
    var rows = equipmentRows([{
      id: row.id, ref: row.ref, submitted_at: row.submitted_at,
      company_name: row.company_name, contact_person: row.contact_person,
      email: row.email, phone: row.phone, equipment: eq
    }]);
    download(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8;' }),
      'fleet-intake-' + String(row.company_name || 'company').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv');
  }

  /* -------------------------------------------------------
     Wiring
     ------------------------------------------------------- */
  function wireDashboard() {
    $('refreshBtn').addEventListener('click', function () {
      state.equipment = {};
      reload();
    });

    var searchTimer = null;
    $('searchInput').addEventListener('input', function (e) {
      var v = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.search = v;
        fetchPage(false);
      }, SEARCH_DEBOUNCE_MS);
    });

    document.querySelectorAll('.seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.status = btn.getAttribute('data-status');
        document.querySelectorAll('.seg-btn').forEach(function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        fetchPage(false);
      });
    });

    $('rangeSelect').addEventListener('change', function (e) {
      state.days = e.target.value;
      fetchPage(false);
    });

    $('loadMoreBtn').addEventListener('click', function () { fetchPage(true); });

    document.querySelectorAll('.admin-table th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (state.sortKey === key) state.sortAsc = !state.sortAsc;
        else { state.sortKey = key; state.sortAsc = (key !== 'submitted_at' && key !== 'equipment_count'); }
        fetchPage(false);
      });
    });

    // One delegated listener for the table: rows are re-rendered constantly,
    // so per-element listeners would have to be rebound every time.
    $('rowsBody').addEventListener('click', function (e) {
      var csvBtn = e.target.closest('[data-row-csv]');
      if (csvBtn) { exportSingle(csvBtn.getAttribute('data-row-csv')); return; }

      if (e.target.closest('a') || e.target.closest('select')) return;

      var row = e.target.closest('tr.row-main');
      if (row) toggleRow(row.getAttribute('data-id'));
    });

    $('rowsBody').addEventListener('change', function (e) {
      var sel = e.target.closest('.status-select');
      if (sel) changeStatus(sel.getAttribute('data-id'), sel.value);
    });

    var exportBtn = $('exportBtn');
    var exportMenu = $('exportMenu');
    exportBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = exportMenu.classList.toggle('hidden');
      exportBtn.setAttribute('aria-expanded', String(!open));
    });
    exportMenu.addEventListener('click', function (e) {
      var b = e.target.closest('[data-export]');
      if (!b) return;
      exportMenu.classList.add('hidden');
      exportBtn.setAttribute('aria-expanded', 'false');
      var kind = b.getAttribute('data-export');
      if (kind === 'companies') exportCompanies();
      else if (kind === 'equipment') exportEquipment();
      else exportCombined();
    });
    document.addEventListener('click', function () {
      if (!exportMenu.classList.contains('hidden')) {
        exportMenu.classList.add('hidden');
        exportBtn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        exportMenu.classList.add('hidden');
        exportBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* -------------------------------------------------------
     Boot
     ------------------------------------------------------- */
  function init() {
    var yearEl = $('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    $('signInForm').addEventListener('submit', onSignIn);
    $('signOutBtn').addEventListener('click', onSignOut);

    if (!window.SUPABASE_CONFIG || !window.SUPABASE_CONFIG.isConfigured()) {
      showAuth('This dashboard is not connected yet. Fill in assets/config.js with your Supabase project URL and anon key.', true);
      $('signInBtn').disabled = true;
      return;
    }
    if (typeof window.supabase === 'undefined') {
      showAuth('The Supabase library did not load. Check your network connection and reload.', true);
      $('signInBtn').disabled = true;
      return;
    }

    client = window.supabase.createClient(
      window.SUPABASE_CONFIG.url,
      window.SUPABASE_CONFIG.anonKey
    );

    wireDashboard();

    // Restore an existing session so a refresh does not force a new login.
    client.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      if (session && session.user) enterDashboard(session.user);
      else showAuth('');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
