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
      $('statMachines').textContent = fmtNum(s.units != null ? s.units : s.machines);
      $('statWeek').textContent = fmtNum(s.last7);

      $('statCompaniesFoot').textContent =
        s.awaiting > 0 ? fmtNum(s.awaiting) + ' awaiting review' : 'All reviewed';

      var avg = s.companies > 0 ? Math.round(s.machines / s.companies) : 0;
      // Two different counts: rows in the submitted lists, and actual machines
      // once a row saying 'qty 5' is expanded. Saying both stops them looking
      // like a contradiction.
      $('statMachinesFoot').textContent = (s.units != null && s.units !== s.machines)
        ? fmtNum(s.machines) + ' line items · ' + avg + ' per company'
        : (avg > 0 ? avg + ' per company on average' : ' ');

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
    var ths = document.querySelectorAll('#companiesView th.sortable');
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

  // Exports exactly the rows the machine filters are showing, in both
  // languages, so a filtered view is something you can hand to someone.
  var MACHINE_HEADERS = [
    'Company', 'Ref', 'Brand', 'Type (EN)', 'Type (ES)', 'Model', 'Unit ID',
    'Family (EN)', 'Family (ES)', 'Year', 'Qty', 'Capacity', 'Age',
    'Location (EN)', 'Location (ES)', 'Price/Day', 'Condition', 'Contact'
  ];

  function machineAoa() {
    return [MACHINE_HEADERS].concat(mState.filtered.map(function (r) {
      return [
        r.company_name, r.source_ref || '', r.brand || '', r.type || '', r.type_es || '',
        r.model || '', r.unit_id || '', r.machine_family || '', r.machine_family_es || '',
        r.year || '', r.qty || 1, r.capacity || '', r.age || '',
        r.location || '', r.location_es || '', r.price || '', r.condition || '', r.contact || ''
      ];
    }));
  }

  function exportMachineView(kind) {
    if (!mState.filtered.length) { toast('Nothing to export with these filters.', true); return; }
    var rows = machineAoa();

    if (kind === 'combined' && typeof XLSX !== 'undefined') {
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Machines');
      XLSX.writeFile(wb, 'fleet-machines-' + stamp() + '.xlsx');
    } else {
      download(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8;' }),
        'fleet-machines-' + stamp() + '.csv');
    }
    toast(fmtNum(rows.length - 1) + ' machines exported');
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

  /* =======================================================
     Machines view

     The whole equipment set is pulled once and filtered in the
     browser. At this size (~1,100 rows, well under a megabyte)
     that makes every filter instant with no round trip, and lets
     a search match across the company join without the server
     having to model it. Past roughly 20,000 rows this should move
     back to the server — see the note in 002-master-import-schema.sql.
     ======================================================= */

  var mState = {
    all: null,          // every machine, loaded once
    filtered: [],
    shown: 0,
    search: '', company: '', family: '', brand: '', year: '', scope: 'in',
    sortKey: 'company_name', sortAsc: true
  };
  var M_PAGE = 200;

  // Accent-insensitive compare, so "BOGOTA" finds "Bogotá" and
  // "ANTIGUEDAD" finds "ANTIGÜEDAD". The data comes from ten companies
  // typing in two languages, so this matters.
  function fold(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }

  function loadAllEquipment() {
    if (mState.all) { renderMachines(); return; }
    $('mLoading').classList.remove('hidden');

    // PostgREST caps a response at 1000 rows, so page until it runs dry.
    var acc = [];
    function page(from) {
      client.from('equipment')
        .select('id,row_index,brand,type,type_es,model,unit_id,capacity,age,location,location_es,price,contact,machine_family,machine_family_es,condition,year,qty,scope,scope_reason,submission_id,submissions!inner(company_name,status,source)')
        .order('id', { ascending: true })
        .range(from, from + 999)
        .then(function (res) {
          if (res.error) {
            $('mLoading').classList.add('hidden');
            toast('Could not load machines: ' + res.error.message, true);
            return;
          }
          var batch = res.data || [];
          acc = acc.concat(batch);
          if (batch.length === 1000) { page(from + 1000); return; }

          mState.all = acc.map(function (r) {
            var s = r.submissions || {};
            r.company_name = s.company_name || '';
            r.company_status = s.status || '';
            r.source = s.source || 'web';
            r._hay = fold([
              r.company_name, r.brand, r.type, r.type_es, r.model, r.unit_id,
              r.machine_family, r.machine_family_es, r.location, r.location_es, r.condition
            ].join(' '));
            return r;
          });
          $('mLoading').classList.add('hidden');
          buildMachineFilters();
          renderMachines();
        });
    }
    page(0);
  }

  function buildMachineFilters() {
    function fill(id, values, label) {
      var sel = $(id);
      var keep = sel.value;
      sel.innerHTML = '<option value="">' + label + '</option>' +
        values.map(function (v) {
          return '<option value="' + esc(v.k) + '">' + esc(v.k) + ' (' + fmtNum(v.n) + ')</option>';
        }).join('');
      sel.value = keep;
    }
    function tally(key) {
      var m = {};
      mState.all.forEach(function (r) {
        var v = r[key];
        if (v == null || v === '') return;
        m[v] = (m[v] || 0) + 1;
      });
      return Object.keys(m).map(function (k) { return { k: k, n: m[k] }; })
        .sort(function (a, b) { return b.n - a.n || a.k.localeCompare(b.k); });
    }
    fill('mCompany', tally('company_name'), 'All companies');
    fill('mFamily',  tally('machine_family'), 'All families');
    fill('mBrand',   tally('brand'), 'All brands');

    var years = {};
    mState.all.forEach(function (r) { if (r.year) years[r.year] = (years[r.year] || 0) + 1; });
    var ys = Object.keys(years).sort(function (a, b) { return b - a; });
    $('mYear').innerHTML = '<option value="">Any year</option>' +
      ys.map(function (y) { return '<option value="' + y + '">' + y + ' (' + years[y] + ')</option>'; }).join('');
  }

  function applyMachineFilters() {
    var term = fold(mState.search).trim();
    mState.filtered = mState.all.filter(function (r) {
      // Default view is the fleet: what we are actually looking for.
      if (mState.scope !== 'all' && (r.scope || 'review') !== mState.scope) return false;
      if (mState.company && r.company_name !== mState.company) return false;
      if (mState.family  && r.machine_family !== mState.family) return false;
      if (mState.brand   && r.brand !== mState.brand) return false;
      if (mState.year    && String(r.year) !== mState.year) return false;
      if (term && r._hay.indexOf(term) === -1) return false;
      return true;
    });

    var k = mState.sortKey, asc = mState.sortAsc ? 1 : -1;
    mState.filtered.sort(function (a, b) {
      var x = a[k], y = b[k];

      // Missing values sort last in BOTH directions. Two thirds of these
      // machines have no year, so letting blanks lead on an ascending sort
      // would bury every row that actually has one.
      if (k === 'year' || k === 'qty') {
        var hasX = x != null && x !== '', hasY = y != null && y !== '';
        if (!hasX && !hasY) return 0;
        if (!hasX) return 1;
        if (!hasY) return -1;
        return (x - y) * asc;
      }

      x = fold(x); y = fold(y);
      if (x === y) return fold(a.company_name).localeCompare(fold(b.company_name)) ||
                          (a.row_index - b.row_index);
      if (!x) return 1;
      if (!y) return -1;
      return x.localeCompare(y) * asc;
    });
    mState.shown = Math.min(M_PAGE, mState.filtered.length);
  }

  function machineRowHtml(r) {
    // Show the Spanish label under the English one when they differ, so one
    // table serves both languages without a toggle.
    function bi(en, es) {
      if (!en && !es) return '';
      if (!es || fold(es) === fold(en)) return esc(en || es);
      return esc(en) + '<small class="bi-es">' + esc(es) + '</small>';
    }
    return '<tr>' +
      '<td class="cell-company-sm">' + esc(r.company_name) + '</td>' +
      '<td>' + esc(r.brand || '') + '</td>' +
      '<td>' + bi(r.type, r.type_es) + '</td>' +
      '<td>' + esc(r.model || '') + '</td>' +
      '<td class="mono-sm">' + esc(r.unit_id || '') + '</td>' +
      '<td>' + bi(r.machine_family, r.machine_family_es) + '</td>' +
      '<td class="num">' + (r.year || '') + '</td>' +
      '<td class="num">' + (r.qty || 1) + '</td>' +
      '<td>' + bi(r.location, r.location_es) + '</td>' +
      '<td>' + esc(r.condition || '') + '</td>' +
      '</tr>';
  }

  function renderMachines() {
    if (!mState.all) return;
    applyMachineFilters();

    $('mBody').innerHTML = mState.filtered.slice(0, mState.shown).map(machineRowHtml).join('');

    var any = mState.filtered.length > 0;
    $('mEmpty').classList.toggle('hidden', any);
    $('mMore').classList.toggle('hidden', mState.shown >= mState.filtered.length);

    renderAnswer();

    $('mNote').textContent = any && mState.shown < mState.filtered.length
      ? 'Showing the first ' + fmtNum(mState.shown) + ' rows below'
      : '';

    var ths = document.querySelectorAll('.machines-table th.sortable');
    for (var i = 0; i < ths.length; i++) {
      var key = ths[i].getAttribute('data-msort');
      if (key === mState.sortKey) ths[i].setAttribute('aria-sort', mState.sortAsc ? 'ascending' : 'descending');
      else ths[i].removeAttribute('aria-sort');
    }
  }

  /* The headline answer. "How many excavators do we have?" should be one
     number, large, without reading a sentence to find it. Units rather than
     rows, because a row that says qty 6 is six machines. */
  function renderAnswer() {
    var rows = mState.filtered;
    var units = rows.reduce(function (n, r) { return n + (r.qty || 1); }, 0);

    $('mAnswerNum').textContent = fmtNum(units);
    $('mAnswerUnit').textContent = units === 1 ? 'unit' : 'units';

    // Say what was asked, in the words of the filters that are set.
    var bits = [];
    if (mState.family)  bits.push(mState.family);
    if (mState.brand)   bits.push(mState.brand);
    if (mState.year)    bits.push(mState.year);
    if (mState.search)  bits.push('“' + mState.search + '”');
    var SCOPE_LABEL = { in: 'Fleet', review: 'Awaiting review', out: 'Set aside', all: 'Everything submitted' };
    var what = bits.length ? bits.join(' · ') : SCOPE_LABEL[mState.scope];
    if (bits.length && mState.scope !== 'in') what = SCOPE_LABEL[mState.scope] + ' · ' + what;
    if (mState.company) what += (bits.length ? ' — ' : '') + mState.company;
    $('mAnswerWhat').textContent = what;

    var companies = {};
    rows.forEach(function (r) {
      companies[r.company_name] = (companies[r.company_name] || 0) + (r.qty || 1);
    });
    var names = Object.keys(companies);

    $('mAnswerSub').textContent = rows.length
      ? fmtNum(rows.length) + (rows.length === 1 ? ' listing' : ' listings') +
        ' across ' + names.length + (names.length === 1 ? ' company' : ' companies')
      : 'Nothing matches these filters';

    // Who actually has them — the question that always comes next.
    var top = names.map(function (n) { return { n: n, v: companies[n] }; })
      .sort(function (a, b) { return b.v - a.v; })
      .slice(0, 6);
    $('mAnswerBy').innerHTML = top.length > 1
      ? top.map(function (c) {
          return '<span class="answer-chip"><b>' + fmtNum(c.v) + '</b> ' +
            esc(c.n.length > 26 ? c.n.slice(0, 24) + '…' : c.n) + '</span>';
        }).join('') +
        (names.length > 6 ? '<span class="answer-chip muted">+' + (names.length - 6) + ' more</span>' : '')
      : '';
  }

  /* =======================================================
     Our fleet

     Machines Spirtas already controls, kept apart from the
     subcontractor registrations. The question here is not "who owns
     this" but "have we got enough of it", so the table leads with
     available, needed and the gap between them.
     ======================================================= */

  var fState = {
    all: null, filtered: [],
    search: '', equipment: '', shortOnly: false,
    sortKey: 'qty_required', sortAsc: false
  };

  function loadFleet() {
    if (fState.all) { renderFleet(); return; }
    $('fLoading').classList.remove('hidden');

    client.from('fleet_items')
      .select('id,ref,owner,equipment,make,model,qty_available,qty_required,intended_use,notes,capacity_t,capacity_source,location')
      .order('qty_required', { ascending: false })
      .limit(2000)
      .then(function (res) {
        $('fLoading').classList.add('hidden');
        if (res.error) {
          // The tables only exist once migration 005 has been run.
          $('fEmpty').classList.remove('hidden');
          $('fEmpty').innerHTML =
            '<p class="empty-title">Fleet tables not found</p>' +
            '<p class="empty-body">Run supabase/005-own-fleet.sql in the SQL editor, then reload.</p>';
          return;
        }
        fState.all = (res.data || []).map(function (r) {
          r._hay = fold([r.equipment, r.make, r.model, r.intended_use, r.notes, r.ref].join(' '));
          r._gap = Math.max((r.qty_required || 0) - (r.qty_available || 0), 0);
          return r;
        });
        buildFleetFilters();
        loadFleetStats();
        renderFleet();
      });
  }

  function loadFleetStats() {
    client.rpc('own_fleet_stats').then(function (res) {
      if (res.error || !res.data) return;
      var s = res.data;
      $('fAvail').textContent = fmtNum(s.available);
      $('fReq').textContent = fmtNum(s.required);
      $('fShort').textContent = fmtNum(s.shortfall);
      $('fUnits').textContent = fmtNum(s.units);
      $('fAvailFoot').textContent = fmtNum(s.types) + ' equipment types';
      $('fReqFoot').textContent = s.available >= s.required
        ? 'Covered by what we hold' : 'More than we currently hold';
      $('fShortFoot').textContent = Number(s.shortfall) === 0
        ? 'Nothing short' : 'Units still to source';
      $('fUnitsFoot').textContent = 'Individually listed';
    });
  }

  function buildFleetFilters() {
    var m = {};
    fState.all.forEach(function (r) {
      if (r.equipment) m[r.equipment] = (m[r.equipment] || 0) + (r.qty_available || 0);
    });
    var vals = Object.keys(m).sort();
    $('fEquip').innerHTML = '<option value="">All equipment</option>' +
      vals.map(function (v) {
        return '<option value="' + esc(v) + '">' + esc(v) + ' (' + fmtNum(m[v]) + ')</option>';
      }).join('');
  }

  function renderFleet() {
    if (!fState.all) return;
    var term = fold(fState.search).trim();

    fState.filtered = fState.all.filter(function (r) {
      if (fState.equipment && r.equipment !== fState.equipment) return false;
      if (fState.shortOnly && r._gap <= 0) return false;
      if (term && r._hay.indexOf(term) === -1) return false;
      return true;
    });

    var k = fState.sortKey, asc = fState.sortAsc ? 1 : -1;
    fState.filtered.sort(function (a, b) {
      var x = a[k], y = b[k];
      if (k === 'qty_available' || k === 'qty_required' || k === 'capacity_t') {
        var hx = x != null && x !== '', hy = y != null && y !== '';
        if (!hx && !hy) return 0;
        if (!hx) return 1;
        if (!hy) return -1;
        return (Number(x) - Number(y)) * asc;
      }
      x = fold(x); y = fold(y);
      if (!x) return 1;
      if (!y) return -1;
      return x.localeCompare(y) * asc;
    });

    $('fBody').innerHTML = fState.filtered.map(function (r) {
      var gap = r._gap;
      // A capacity read off the model number is marked, so an estimate is
      // never mistaken for something the supplier actually stated.
      var cap = r.capacity_t != null
        ? fmtNum(r.capacity_t) + ' t' +
          (r.capacity_source === 'model' ? '<abbr class="est" title="Estimated from the model number">≈</abbr>' : '')
        : '';
      return '<tr>' +
        '<td class="cell-company-sm">' + esc(r.equipment) + '</td>' +
        '<td>' + esc(r.make || '') + '</td>' +
        '<td>' + esc(r.model || '') + '</td>' +
        '<td class="num">' + cap + '</td>' +
        '<td class="num">' + fmtNum(r.qty_available) + '</td>' +
        '<td class="num">' + fmtNum(r.qty_required) + '</td>' +
        '<td class="num">' + (gap > 0
          ? '<span class="gap-short">-' + fmtNum(gap) + '</span>'
          : '<span class="gap-ok">ok</span>') + '</td>' +
        '<td class="fleet-use">' + esc(r.intended_use || '') + '</td>' +
        '</tr>';
    }).join('');

    var any = fState.filtered.length > 0;
    $('fEmpty').classList.toggle('hidden', any);

    var avail = fState.filtered.reduce(function (n, r) { return n + (r.qty_available || 0); }, 0);
    var req = fState.filtered.reduce(function (n, r) { return n + (r.qty_required || 0); }, 0);
    $('fNote').textContent = any
      ? fmtNum(fState.filtered.length) + ' equipment types · ' + fmtNum(avail) +
        ' available · ' + fmtNum(req) + ' needed'
      : '';

    var ths = document.querySelectorAll('.fleet-table th.sortable');
    for (var i = 0; i < ths.length; i++) {
      var key = ths[i].getAttribute('data-fsort');
      if (key === fState.sortKey) ths[i].setAttribute('aria-sort', fState.sortAsc ? 'ascending' : 'descending');
      else ths[i].removeAttribute('aria-sort');
    }
  }

  function exportFleet(kind) {
    if (!fState.filtered.length) { toast('Nothing to export.', true); return; }
    var head = ['Ref', 'Equipment', 'Make', 'Model', 'Capacity (t)', 'Capacity source',
                'Available', 'Needed', 'Gap', 'Intended use', 'Notes', 'Location'];
    var rows = [head].concat(fState.filtered.map(function (r) {
      return [r.ref || '', r.equipment, r.make || '', r.model || '',
              r.capacity_t != null ? r.capacity_t : '', r.capacity_source || '',
              r.qty_available, r.qty_required, r._gap > 0 ? -r._gap : 0,
              r.intended_use || '', r.notes || '', r.location || ''];
    }));
    if (kind === 'combined' && typeof XLSX !== 'undefined') {
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Our fleet');
      XLSX.writeFile(wb, 'our-fleet-' + stamp() + '.xlsx');
    } else {
      download(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8;' }),
        'our-fleet-' + stamp() + '.csv');
    }
    toast(fmtNum(rows.length - 1) + ' rows exported');
  }

  function wireFleetView() {
    var t = null;
    $('fSearch').addEventListener('input', function (e) {
      var v = e.target.value;
      clearTimeout(t);
      t = setTimeout(function () { fState.search = v; renderFleet(); }, 150);
    });
    $('fEquip').addEventListener('change', function (e) {
      fState.equipment = e.target.value; renderFleet();
    });
    $('fShortOnly').addEventListener('change', function (e) {
      fState.shortOnly = e.target.checked; renderFleet();
    });
    document.querySelectorAll('.fleet-table th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-fsort');
        var numeric = (key === 'qty_available' || key === 'qty_required' || key === 'capacity_t');
        if (fState.sortKey === key) fState.sortAsc = !fState.sortAsc;
        else { fState.sortKey = key; fState.sortAsc = !numeric; }
        renderFleet();
      });
    });
  }

  var VIEW_TITLES = { companies: 'Registrations', machines: 'Machines', fleet: 'Our fleet' };

  function setView(view) {
    state.view = view;
    $('companiesView').classList.toggle('hidden', view !== 'companies');
    $('machinesView').classList.toggle('hidden', view !== 'machines');
    $('fleetView').classList.toggle('hidden', view !== 'fleet');
    $('viewTitle').textContent = VIEW_TITLES[view] || 'Registrations';

    // The KPI tiles describe the subcontractor data, so they belong with
    // those views. Our fleet carries its own.
    $('statRow').classList.toggle('hidden', view === 'fleet');

    document.querySelectorAll('.view-btn').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === view));
    });

    if (view === 'machines') loadAllEquipment();
    if (view === 'fleet') loadFleet();
  }

  function wireMachinesView() {
    document.querySelectorAll('.view-btn').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
    });

    var t = null;
    $('mSearch').addEventListener('input', function (e) {
      var v = e.target.value;
      clearTimeout(t);
      t = setTimeout(function () { mState.search = v; renderMachines(); }, 150);
    });

    [['mCompany', 'company'], ['mFamily', 'family'], ['mBrand', 'brand'], ['mYear', 'year']]
      .forEach(function (pair) {
        $(pair[0]).addEventListener('change', function (e) {
          mState[pair[1]] = e.target.value;
          renderMachines();
        });
      });

    document.querySelectorAll('#machinesView .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        mState.scope = b.getAttribute('data-scope');
        document.querySelectorAll('#machinesView .seg-btn').forEach(function (x) {
          x.setAttribute('aria-pressed', String(x === b));
        });
        renderMachines();
      });
    });

    $('mClear').addEventListener('click', function () {
      mState.search = mState.company = mState.family = mState.brand = mState.year = '';
      $('mSearch').value = '';
      ['mCompany', 'mFamily', 'mBrand', 'mYear'].forEach(function (id) { $(id).value = ''; });
      renderMachines();
    });

    $('mMore').addEventListener('click', function () {
      mState.shown = Math.min(mState.shown + M_PAGE, mState.filtered.length);
      $('mBody').innerHTML = mState.filtered.slice(0, mState.shown).map(machineRowHtml).join('');
      $('mMore').classList.toggle('hidden', mState.shown >= mState.filtered.length);
      renderMachines();
    });

    document.querySelectorAll('.machines-table th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-msort');
        if (mState.sortKey === key) mState.sortAsc = !mState.sortAsc;
        else { mState.sortKey = key; mState.sortAsc = (key !== 'year' && key !== 'qty'); }
        renderMachines();
      });
    });
  }

  /* =======================================================
     Bulk import

     The public form registers one company per submission, which is
     correct: a company is registering itself. A consolidated master
     file holds many, so splitting one file across companies belongs
     here, on the admin side, where a column of company names can be
     turned into one registration each.

     Sheet and header-row detection is the same approach the public
     form uses, and HEADER_ALIASES is shared via i18n.js.
     ======================================================= */

  // The nine fields the public form collects, plus the ones only a master
  // file tends to carry. All of them are real columns, so mapping one here
  // is better than letting it fall into extras.
  var IMPORT_FIELDS = [
    { key: 'brand',     label: 'Brand' },
    { key: 'type',      label: 'Type / Description' },
    { key: 'model',     label: 'Model' },
    { key: 'unitId',    label: 'Unit ID / Serial' },
    { key: 'capacity',  label: 'Capacity' },
    { key: 'age',       label: 'Age' },
    { key: 'year',      label: 'Year' },
    { key: 'location',  label: 'Location' },
    { key: 'price',     label: 'Price per day' },
    { key: 'contact',   label: 'Contact' },
    { key: 'family',    label: 'Machine family' },
    { key: 'condition', label: 'Condition / Status' },
    { key: 'qty',       label: 'Quantity' },
    { key: 'ref',       label: 'Source reference' }
  ];

  // Fields the public form has no column for, so their spellings live here
  // rather than in the shared HEADER_ALIASES.
  var ADMIN_ALIASES = {
    year:      ['year', 'ano', 'anio', 'anofabricacion', 'anomodelo', 'modelyear'],
    family:    ['machinefamily', 'familia', 'familiademaquina', 'family', 'grupo', 'group', 'linea'],
    condition: ['status', 'estatus', 'estado', 'condition', 'condicion', 'disponibilidad', 'operatividad'],
    qty:       ['qty', 'cant', 'cantidad', 'quantity', 'unidades', 'units', 'nrounidades'],
    ref:       ['ref', 'referencia', 'sourceref', 'codigoreferencia']
  };

  // Column names that mean "this row belongs to company X".
  var COMPANY_ALIASES = ['company', 'empresa', 'compania', 'companyname', 'razonsocial',
                         'cliente', 'proveedor', 'contratista', 'subcontratista', 'firma'];

  var imp = null;   // { fileName, sheets, sheetIdx, headerIdx, map, companyCol }
  var importMode = 'companies';   // or 'fleet'

  // The own-fleet file is a different shape: quantities per equipment type
  // rather than one row per machine.
  var FLEET_FIELDS = [
    { key: 'equipment',    label: 'Equipment' },
    { key: 'make',         label: 'Make' },
    { key: 'model',        label: 'Model' },
    { key: 'qtyAvailable', label: 'Qty available' },
    { key: 'qtyRequired',  label: 'Qty needed' },
    { key: 'intendedUse',  label: 'Intended use' },
    { key: 'ref',          label: 'Reference' },
    { key: 'notes',        label: 'Notes' }
  ];

  var FLEET_ALIASES = {
    equipment:    ['equipment', 'equipo', 'maquina', 'tipo', 'type', 'descripcion', 'description'],
    make:         ['make', 'marca', 'brand', 'fabricante', 'manufacturer'],
    model:        ['model', 'modelo', 'modelcapacityknown', 'modelocapacidad'],
    qtyAvailable: ['qtyavailable', 'ansadqtyavailable', 'available', 'disponible', 'cantidaddisponible',
                   'qtyactuallyavailablecommitted', 'existencia', 'stock'],
    qtyRequired:  ['qtyrequired', 'qtyspirtasrequireforvenezuela', 'qtyspirtasrequire', 'required',
                   'requerido', 'necesario', 'cantidadrequerida', 'need'],
    intendedUse:  ['intendeduse', 'intendedvenezuelause', 'uso', 'usoprevisto', 'purpose', 'aplicacion'],
    ref:          ['ref', 'referencia', 'reference', 'codigo', 'code'],
    notes:        ['notes', 'notas', 'comments', 'comentarios', 'observaciones', 'remarks']
  };

  function normHeader(s) {
    return String(s || '')
      .replace(/\(.*?\)/g, ' ')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function headerCands(h) {
    var out = [];
    function push(v) { if (v && out.indexOf(v) === -1) out.push(v); }
    push(normHeader(h));
    String(h || '').split(/[\/|]+/).forEach(function (p) { push(normHeader(p)); });
    out.slice().forEach(function (v) { push(v.replace(/(usd|eur|ves)$/, '')); });
    return out;
  }

  function fieldFor(header) {
    var cands = headerCands(header);

    // In fleet mode only the fleet vocabulary applies — the two files mean
    // different things by the same words ("model" is a machine model in both,
    // but "qty" is a stock level here and a line multiplier there).
    if (importMode === 'fleet') {
      var fkeys = Object.keys(FLEET_ALIASES);
      for (var f = 0; f < fkeys.length; f++) {
        for (var a = 0; a < FLEET_ALIASES[fkeys[f]].length; a++) {
          if (cands.indexOf(FLEET_ALIASES[fkeys[f]][a]) !== -1) return fkeys[f];
        }
      }
      return null;
    }

    // The admin-only fields are checked first because they are the more
    // specific reading: a column called YEAR is a year, not an age, and
    // QTY is a quantity rather than anything the form collects.
    var sets = [ADMIN_ALIASES, window.HEADER_ALIASES || {}];
    for (var s = 0; s < sets.length; s++) {
      var keys = Object.keys(sets[s]);
      for (var k = 0; k < keys.length; k++) {
        for (var i = 0; i < sets[s][keys[k]].length; i++) {
          if (cands.indexOf(sets[s][keys[k]][i]) !== -1) return keys[k];
        }
      }
    }
    return null;
  }

  function isCompanyHeader(header) {
    var cands = headerCands(header);
    for (var i = 0; i < COMPANY_ALIASES.length; i++) {
      if (cands.indexOf(COMPANY_ALIASES[i]) !== -1) return true;
    }
    return false;
  }

  function scoreRow(row) {
    if (!row) return -1;
    var filled = 0, hits = 0, seen = {};
    for (var i = 0; i < row.length; i++) {
      var c = String(row[i] == null ? '' : row[i]).trim();
      if (!c) continue;
      filled++;
      var f = fieldFor(c);
      if (f && !seen[f]) { seen[f] = 1; hits++; }
      if (isCompanyHeader(c)) hits++;
    }
    return hits * 10 + Math.min(filled, 12);
  }

  function analyzeBook(wb) {
    var sheets = [];
    wb.SheetNames.forEach(function (name) {
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
      if (!rows.length) return;
      var bestIdx = 0, best = -1;
      for (var i = 0; i < Math.min(25, rows.length); i++) {
        var s = scoreRow(rows[i]);
        if (s > best) { best = s; bestIdx = i; }
      }
      var data = 0;
      for (var j = bestIdx + 1; j < rows.length; j++) {
        if (rows[j] && rows[j].some(function (c) { return String(c == null ? '' : c).trim(); })) data++;
      }
      var hits = Math.floor(best / 10);
      sheets.push({ name: name, rows: rows, headerIdx: bestIdx, dataRows: data,
                    score: hits * 1000 + Math.min(data, 999) });
    });
    sheets.sort(function (a, b) { return b.score - a.score; });
    return sheets;
  }

  function impSheet() { return imp && imp.sheets[imp.sheetIdx]; }

  function impCols() {
    var sh = impSheet();
    if (!sh) return [];
    return (sh.rows[imp.headerIdx] || []).map(function (c, i) {
      var label = String(c == null ? '' : c).trim();
      return { idx: i, label: label || ('Column ' + (i + 1)) };
    });
  }

  function impAutoMap() {
    var map = {}, companyCol = null;
    impCols().forEach(function (col) {
      if (companyCol === null && isCompanyHeader(col.label)) { companyCol = col.idx; return; }
      var f = fieldFor(col.label);
      if (f && map[f] == null) map[f] = col.idx;
    });
    return { map: map, companyCol: companyCol };
  }

  // Group the sheet's rows by whatever the company column says.
  function impGroups() {
    var sh = impSheet();
    if (!sh) return [];
    var cols = impCols();
    var mapped = {};
    Object.keys(imp.map).forEach(function (k) {
      if (imp.map[k] != null) mapped[imp.map[k]] = k;
    });

    var order = [], byName = {};
    for (var i = imp.headerIdx + 1; i < sh.rows.length; i++) {
      var raw = sh.rows[i];
      if (!raw || !raw.some(function (c) { return String(c == null ? '' : c).trim(); })) continue;

      var company = imp.companyCol == null
        ? (imp.fallbackName || 'Unnamed company')
        : String(raw[imp.companyCol] == null ? '' : raw[imp.companyCol]).trim();
      if (!company) company = '(no company named)';

      var item = {}, extras = {}, any = false;
      for (var c = 0; c < cols.length; c++) {
        if (c === imp.companyCol) continue;
        var v = String(raw[c] == null ? '' : raw[c]).trim();
        if (!v || v === 'N/D' || v === 'N/A' || v === '-') continue;
        if (mapped[c]) { item[mapped[c]] = v; any = true; }
        else { extras[cols[c].label] = v; any = true; }
      }
      if (!any) continue;
      if (Object.keys(extras).length) item.extras = extras;
      // Plenty of files put a four-digit year in the age column. Keep it as a
      // year as well so the year filter and sort have something to work with.
      if (!item.year && item.age && /^(19|20)\d{2}$/.test(item.age)) item.year = item.age;
      // Guard the numeric columns: anything that is not a clean number is
      // better dropped here than rejected by the database mid-import.
      if (item.year && !/^(19|20)\d{2}$/.test(String(item.year).trim())) delete item.year;
      if (item.qty && !/^\d{1,6}$/.test(String(item.qty).trim())) delete item.qty;

      if (!byName[company]) { byName[company] = []; order.push(company); }
      byName[company].push(item);
    }
    return order.map(function (n) { return { name: n, items: byName[n] }; });
  }

  function renderImportPanel() {
    var sh = impSheet();
    if (!sh) return;
    $('admPanel').classList.remove('hidden');

    var sheetWrap = $('admSheetWrap');
    if (imp.sheets.length > 1) {
      sheetWrap.classList.remove('hidden');
      $('admSheet').innerHTML = imp.sheets.map(function (s, i) {
        return '<option value="' + i + '"' + (i === imp.sheetIdx ? ' selected' : '') + '>' +
          esc(s.name) + ' (' + s.dataRows + ' rows)</option>';
      }).join('');
    } else { sheetWrap.classList.add('hidden'); }

    var hopts = [];
    for (var i = 0; i < Math.min(25, sh.rows.length); i++) {
      var prev = (sh.rows[i] || []).slice(0, 5)
        .map(function (c) { return String(c == null ? '' : c).trim(); })
        .filter(Boolean).join(' · ').slice(0, 52);
      hopts.push('<option value="' + i + '"' + (i === imp.headerIdx ? ' selected' : '') + '>Row ' +
        (i + 1) + (prev ? ' — ' + esc(prev) : '') + '</option>');
    }
    $('admHeaderRow').innerHTML = hopts.join('');

    var cols = impCols();
    $('admCompanyCol').innerHTML =
      '<option value="">— all one company —</option>' +
      cols.map(function (c) {
        return '<option value="' + c.idx + '"' + (imp.companyCol === c.idx ? ' selected' : '') + '>' +
          esc(c.label) + '</option>';
      }).join('');

    var fields = importMode === 'fleet' ? FLEET_FIELDS : IMPORT_FIELDS;
    $('admMap').innerHTML = fields.map(function (f) {
      return '<label class="map-row"><span class="map-field">' + esc(f.label) + '</span>' +
        '<select data-impfield="' + f.key + '"><option value="">— not in my file —</option>' +
        cols.map(function (c) {
          return '<option value="' + c.idx + '"' + (imp.map[f.key] === c.idx ? ' selected' : '') + '>' +
            esc(c.label) + '</option>';
        }).join('') + '</select></label>';
    }).join('');

    renderImportSummary();
  }

  // Fleet files are read as one row per equipment type, no company grouping.
  function fleetRows() {
    var sh = impSheet();
    if (!sh) return [];
    var cols = impCols();
    var mapped = {};
    Object.keys(imp.map).forEach(function (k) {
      if (imp.map[k] != null) mapped[imp.map[k]] = k;
    });

    var out = [];
    for (var i = imp.headerIdx + 1; i < sh.rows.length; i++) {
      var raw = sh.rows[i];
      if (!raw || !raw.some(function (c) { return String(c == null ? '' : c).trim(); })) continue;
      var item = {}, any = false;
      for (var c = 0; c < cols.length; c++) {
        var v = String(raw[c] == null ? '' : raw[c]).trim();
        if (!v || /^(n\/d|n\/a|-|to confirm)$/i.test(v)) continue;
        if (mapped[c]) { item[mapped[c]] = v; any = true; }
      }
      if (!any || !item.equipment) continue;
      // Quantities arrive as things like "4 total" or "16 of 50".
      ['qtyAvailable', 'qtyRequired'].forEach(function (k) {
        if (item[k]) {
          var m = String(item[k]).match(/\d+/);
          item[k] = m ? m[0] : '';
        }
      });
      out.push(item);
    }
    return out;
  }

  function renderFleetSummary() {
    var rows = fleetRows();
    imp.fleetRows = rows;
    var avail = rows.reduce(function (n, r) { return n + (parseInt(r.qtyAvailable, 10) || 0); }, 0);
    var need  = rows.reduce(function (n, r) { return n + (parseInt(r.qtyRequired, 10) || 0); }, 0);

    if (!rows.length) {
      $('admSummary').innerHTML = '<p class="import-warn">No equipment rows found with these settings. Check the sheet and header row.</p>';
      $('admPreview').innerHTML = '';
      $('admCount').textContent = '';
      $('admConfirm').disabled = true;
      return;
    }
    $('admConfirm').disabled = false;

    $('admSummary').innerHTML =
      '<p class="adm-found"><strong>' + fmtNum(rows.length) + '</strong> equipment types · <strong>' +
      fmtNum(avail) + '</strong> available · <strong>' + fmtNum(need) + '</strong> needed</p>';

    $('admPreview').innerHTML =
      '<table class="import-preview-table"><thead><tr><th>Equipment</th><th>Make</th><th>Model</th>' +
      '<th class="num">Avail</th><th class="num">Need</th></tr></thead><tbody>' +
      rows.slice(0, 10).map(function (r) {
        return '<tr><td>' + esc(r.equipment) + '</td><td>' + esc(r.make || '') + '</td><td>' +
          esc(r.model || '') + '</td><td class="num">' + esc(r.qtyAvailable || '0') +
          '</td><td class="num">' + esc(r.qtyRequired || '0') + '</td></tr>';
      }).join('') +
      (rows.length > 10 ? '<tr><td colspan="5" class="muted-cell">…and ' + (rows.length - 10) + ' more</td></tr>' : '') +
      '</tbody></table>';

    $('admCount').textContent = 'Ready: ' + fmtNum(rows.length) + ' equipment types';
  }

  function renderImportSummary() {
    if (importMode === 'fleet') { renderFleetSummary(); return; }

    var groups = impGroups();
    imp.groups = groups;
    var machines = groups.reduce(function (n, g) { return n + g.items.length; }, 0);

    if (!machines) {
      $('admSummary').innerHTML = '<p class="import-warn">Nothing to import with these settings. Try a different sheet or header row.</p>';
      $('admPreview').innerHTML = '';
      $('admCount').textContent = '';
      $('admConfirm').disabled = true;
      return;
    }
    $('admConfirm').disabled = false;

    $('admSummary').innerHTML =
      '<p class="adm-found"><strong>' + fmtNum(groups.length) + '</strong> ' +
      (groups.length === 1 ? 'company' : 'companies') + ' · <strong>' +
      fmtNum(machines) + '</strong> machines</p>' +
      (imp.companyCol == null
        ? '<p class="import-warn">No company column chosen, so everything imports as one company. If this file covers several, pick the column that holds their names.</p>'
        : '');

    $('admPreview').innerHTML =
      '<table class="import-preview-table"><thead><tr><th>Company</th><th class="num">Machines</th><th>First machine</th></tr></thead><tbody>' +
      groups.slice(0, 12).map(function (g) {
        var f = g.items[0] || {};
        return '<tr><td>' + esc(g.name) + '</td><td class="num">' + fmtNum(g.items.length) + '</td><td>' +
          esc([f.brand, f.type, f.model].filter(Boolean).join(' · ').slice(0, 44)) + '</td></tr>';
      }).join('') +
      (groups.length > 12 ? '<tr><td colspan="3" class="muted-cell">…and ' + (groups.length - 12) + ' more</td></tr>' : '') +
      '</tbody></table>';

    $('admCount').textContent = 'Ready: ' + fmtNum(groups.length) + ' ' +
      (groups.length === 1 ? 'registration' : 'registrations');
  }

  // Same guard as the public form: drag and drop ignores the picker's accept
  // list, so an unsupported file arrives either way and should say so.
  var ADMIN_SUPPORTED = ['csv', 'xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'tsv', 'txt'];
  var ADMIN_FORMATS = {
    pdf: 'PDF', doc: 'Word', docx: 'Word', rtf: 'Word', odt: 'Word',
    jpg: 'image', jpeg: 'image', png: 'image', heic: 'image', tif: 'image', tiff: 'image',
    ppt: 'PowerPoint', pptx: 'PowerPoint', zip: 'ZIP', rar: 'RAR',
    msg: 'email', eml: 'email', pages: 'Pages', numbers: 'Numbers'
  };

  function handleImportFile(fileList) {
    var file = fileList && fileList[0];
    if (!file) return;

    var m = String(file.name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    var ext = m ? m[1] : '';
    if (!ext || ADMIN_SUPPORTED.indexOf(ext) === -1) {
      var friendly = ADMIN_FORMATS[ext] || (ext ? '.' + ext : 'that kind of');
      $('admStatus').textContent =
        'Cannot read ' + friendly + ' files. Upload Excel (.xlsx, .xls) or CSV.';
      $('admStatus').className = 'upload-status err';
      $('admPanel').classList.add('hidden');
      $('admFile').value = '';
      $('admConfirm').disabled = true;
      return;
    }

    $('admStatus').textContent = 'Reading ' + file.name + '…';
    $('admStatus').className = 'upload-status';

    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        var sheets = analyzeBook(wb);
        if (!sheets.length || !sheets[0].dataRows) {
          $('admStatus').textContent = 'No rows found in that file.';
          $('admStatus').className = 'upload-status err';
          $('admPanel').classList.add('hidden');
          return;
        }
        imp = {
          fileName: file.name, sheets: sheets, sheetIdx: 0,
          headerIdx: sheets[0].headerIdx, map: {}, companyCol: null,
          fallbackName: file.name.replace(/\.[^.]+$/, '')
        };
        var guess = impAutoMap();
        imp.map = guess.map;
        imp.companyCol = guess.companyCol;

        $('admStatus').textContent =
          'Read ' + file.name + ' — sheet "' + sheets[0].name + '", headers on row ' + (sheets[0].headerIdx + 1) + '.';
        $('admStatus').className = 'upload-status ok';
        renderImportPanel();
      } catch (err) {
        if (window.console) console.error('admin import parse failed', err);
        $('admStatus').textContent = 'Could not read that file.';
        $('admStatus').className = 'upload-status err';
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Companies go in one at a time so a failure names the company it failed
  // on and everything before it is already saved.
  function runFleetImport() {
    var rows = imp.fleetRows || [];
    if (!rows.length) return;

    $('admConfirm').disabled = true;
    $('admCancel').disabled = true;
    $('admProgress').classList.remove('hidden');
    $('admBarFill').style.width = '40%';
    $('admProgressText').textContent = 'Importing ' + rows.length + ' equipment types…';

    client.rpc('import_own_fleet', {
      payload: { owner: 'ANSAD', items: rows, units: [] }
    }).then(function (res) {
      $('admBarFill').style.width = '100%';
      $('admCancel').disabled = false;
      if (res.error) {
        $('admProgressText').textContent = 'Import failed';
        toast('Fleet import failed: ' + res.error.message, true);
        return;
      }
      var r = res.data || {};
      $('admProgressText').textContent = 'Imported ' + (r.items || rows.length) + ' equipment types';
      toast((r.items || rows.length) + ' equipment types imported');
      fState.all = null;
      if (state.view === 'fleet') loadFleet(); else setView('fleet');
      setTimeout(closeImport, 1200);
    });
  }

  function runImport() {
    if (importMode === 'fleet') { runFleetImport(); return; }

    var groups = imp.groups || [];
    if (!groups.length) return;

    $('admConfirm').disabled = true;
    $('admCancel').disabled = true;
    $('admProgress').classList.remove('hidden');

    var done = 0, failed = [];

    function step(i) {
      if (i >= groups.length) {
        $('admProgressText').textContent =
          'Imported ' + done + ' of ' + groups.length + ' companies' +
          (failed.length ? ' · ' + failed.length + ' failed' : '');
        $('admCancel').disabled = false;
        toast(failed.length
          ? done + ' imported, ' + failed.length + ' failed: ' + failed[0]
          : done + ' companies imported', failed.length > 0);
        mState.all = null;
        reload();
        if (state.view === 'machines') loadAllEquipment();
        if (!failed.length) setTimeout(closeImport, 1200);
        return;
      }

      var g = groups[i];
      $('admBarFill').style.width = Math.round(i / groups.length * 100) + '%';
      $('admProgressText').textContent = 'Importing ' + (i + 1) + ' of ' + groups.length + ' — ' + g.name;

      client.rpc('import_master_company', {
        payload: {
          language: 'es',
          company: { name: g.name, sourceFile: imp.fileName },
          equipment: g.items
        }
      }).then(function (res) {
        if (res.error) failed.push(g.name + ': ' + res.error.message);
        else done++;
        step(i + 1);
      });
    }
    step(0);
  }

  function openImport() {
    $('importModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeImport() {
    $('importModal').classList.add('hidden');
    document.body.style.overflow = '';
    imp = null;
    $('admPanel').classList.add('hidden');
    $('admProgress').classList.add('hidden');
    $('admBarFill').style.width = '0%';
    $('admStatus').textContent = '';
    $('admCount').textContent = '';
    $('admFile').value = '';
    $('admConfirm').disabled = true;
    $('admCancel').disabled = false;
  }

  function wireImport() {
    $('importOpenBtn').addEventListener('click', openImport);

    document.querySelectorAll('input[name="importMode"]').forEach(function (r) {
      r.addEventListener('change', function () {
        importMode = r.value;
        // The company column only means something for a subcontractor file.
        $('admCompanyCol').closest('.import-ctl').classList.toggle('hidden', importMode === 'fleet');
        if (imp) {
          var g = impAutoMap();
          imp.map = g.map;
          imp.companyCol = importMode === 'fleet' ? null : g.companyCol;
          renderImportPanel();
        }
      });
    });
    $('importClose').addEventListener('click', closeImport);
    $('admCancel').addEventListener('click', closeImport);
    $('admConfirm').addEventListener('click', runImport);

    $('admBrowse').addEventListener('click', function () { $('admFile').click(); });
    $('admFile').addEventListener('change', function (e) { handleImportFile(e.target.files); });

    ['dragenter', 'dragover'].forEach(function (ev) {
      $('admDrop').addEventListener(ev, function (e) { e.preventDefault(); $('admDrop').classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      $('admDrop').addEventListener(ev, function (e) { e.preventDefault(); $('admDrop').classList.remove('dragover'); });
    });
    $('admDrop').addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) handleImportFile(e.dataTransfer.files);
    });

    $('admSheet').addEventListener('change', function (e) {
      imp.sheetIdx = Number(e.target.value);
      imp.headerIdx = impSheet().headerIdx;
      var g = impAutoMap();
      imp.map = g.map; imp.companyCol = g.companyCol;
      renderImportPanel();
    });

    $('admHeaderRow').addEventListener('change', function (e) {
      imp.headerIdx = Number(e.target.value);
      var g = impAutoMap();
      imp.map = g.map; imp.companyCol = g.companyCol;
      renderImportPanel();
    });

    $('admCompanyCol').addEventListener('change', function (e) {
      imp.companyCol = e.target.value === '' ? null : Number(e.target.value);
      // A column used for company names must not also feed a machine field.
      Object.keys(imp.map).forEach(function (k) {
        if (imp.map[k] === imp.companyCol) imp.map[k] = null;
      });
      renderImportPanel();
    });

    $('admMap').addEventListener('change', function (e) {
      var sel = e.target.closest('select[data-impfield]');
      if (!sel) return;
      var field = sel.getAttribute('data-impfield');
      var val = sel.value === '' ? null : Number(sel.value);
      if (val != null) {
        Object.keys(imp.map).forEach(function (k) {
          if (k !== field && imp.map[k] === val) imp.map[k] = null;
        });
        if (imp.companyCol === val) imp.companyCol = null;
      }
      imp.map[field] = val;
      renderImportPanel();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('importModal').classList.contains('hidden')) closeImport();
    });
  }

  /* -------------------------------------------------------
     Wiring
     ------------------------------------------------------- */
  function wireDashboard() {
    wireMachinesView();
    wireFleetView();
    wireImport();
    $('refreshBtn').addEventListener('click', function () {
      state.equipment = {};
      mState.all = null;              // force the machine set to reload too
      reload();
      if (state.view === 'machines') loadAllEquipment();
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

    document.querySelectorAll('#companiesView th.sortable').forEach(function (th) {
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
      // In the machines view, export what the machine filters are showing
      // rather than the company list behind them.
      if (state.view === 'fleet' && fState.all) { exportFleet(kind); return; }
      if (state.view === 'machines' && mState.all) { exportMachineView(kind); return; }
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
