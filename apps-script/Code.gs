/**
 * Spirtas Worldwide — Fleet Intake backend
 *
 * Paste this whole file into the Apps Script project bound to your
 * Google Sheet (Extensions > Apps Script), then deploy it as a Web App.
 * Full step-by-step instructions are in the project README.
 *
 * WHAT IT DOES
 *  - Receives each form submission as a POST from the website.
 *  - Appends one row per company to a "Companies" sheet tab.
 *  - Appends one row per piece of equipment to an "Equipment" sheet tab,
 *    tagged with the same Submission ID so the two tabs can be joined.
 *  - Optionally emails a notification (via Resend) every time someone
 *    registers. This is entirely optional — the sheet works fine without it.
 *
 * SECRETS
 *  Nothing secret lives in this file. Configure the Resend API key and
 *  notification email as *Script Properties* instead (Project Settings >
 *  Script Properties, in the Apps Script editor) — never paste an API key
 *  directly into this file, since this file is meant to be readable /
 *  shareable without exposing credentials.
 *    RESEND_API_KEY   — your Resend API key
 *    NOTIFY_EMAIL     — where to send the "new registration" email
 *    RESEND_FROM_EMAIL (optional) — defaults to onboarding@resend.dev,
 *      which works immediately but is rate-limited / sandboxed by Resend.
 *      For reliable production delivery, verify your own domain in Resend
 *      and set this to an address on it, e.g. notifications@spirtasworldwide.com
 */

var SHEET_COMPANIES = 'Companies';
var SHEET_EQUIPMENT = 'Equipment';
var SHEET_ERRORS = 'Errors';

var COMPANY_HEADERS = ['Submission ID', 'Timestamp', 'Language', 'Company Name', 'Contact Person', 'Email', 'Phone', 'Units Submitted'];
var EQUIPMENT_HEADERS = ['Submission ID', 'Timestamp', 'Company Name', 'Brand', 'Type', 'Model', 'ID', 'Capacity', 'Age', 'Location', 'Price Per Day (24h)', 'Contact'];

function doGet(e) {
  return ContentService
    .createTextOutput('Fleet Intake endpoint is live. This URL only accepts POST submissions from the registration form.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    var raw = (e.parameter && e.parameter.payload) ||
              (e.postData && e.postData.contents) || '{}';
    var data = JSON.parse(raw);
    data.company = data.company || {};
    var equipment = Array.isArray(data.equipment) ? data.equipment : [];

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var submissionId = Utilities.getUuid();
    var timestamp = new Date();

    var companiesSheet = getOrCreateSheet(ss, SHEET_COMPANIES, COMPANY_HEADERS);
    companiesSheet.appendRow([
      submissionId,
      timestamp,
      data.language || '',
      data.company.name || '',
      data.company.contactPerson || '',
      data.company.email || '',
      data.company.phone || '',
      equipment.length
    ]);

    if (equipment.length) {
      var equipmentSheet = getOrCreateSheet(ss, SHEET_EQUIPMENT, EQUIPMENT_HEADERS);
      var rows = equipment.map(function (row) {
        return [
          submissionId, timestamp, data.company.name || '',
          row.brand || '', row.type || '', row.model || '', row.unitId || '',
          row.capacity || '', row.age || '', row.location || '', row.price || '', row.contact || ''
        ];
      });
      // one batched write instead of one appendRow per unit
      equipmentSheet.getRange(equipmentSheet.getLastRow() + 1, 1, rows.length, EQUIPMENT_HEADERS.length).setValues(rows);
    }

    sendNotificationEmail(data, equipment, submissionId);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, submissionId: submissionId }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    logError('doPost failed: ' + err);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Sends a "new registration" email via Resend. Reads its configuration
 * from Script Properties (see the file header) and does nothing —
 * silently — if RESEND_API_KEY isn't set, so notifications are opt-in.
 * A failure here never blocks the actual sheet write above; it's logged
 * to the Errors tab instead.
 */
function sendNotificationEmail(data, equipment, submissionId) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('RESEND_API_KEY');
  if (!apiKey) return;

  var toAddress = props.getProperty('NOTIFY_EMAIL') || 'luis.alejandro@spirtasworldwide.com';
  var fromAddress = props.getProperty('RESEND_FROM_EMAIL') || 'onboarding@resend.dev';
  var company = data.company || {};

  var rowsHtml = equipment.map(function (r) {
    return '<tr>' +
      '<td style="padding:4px 8px;border:1px solid #ddd">' + escapeHtml(r.brand) + '</td>' +
      '<td style="padding:4px 8px;border:1px solid #ddd">' + escapeHtml(r.type) + '</td>' +
      '<td style="padding:4px 8px;border:1px solid #ddd">' + escapeHtml(r.model) + '</td>' +
      '<td style="padding:4px 8px;border:1px solid #ddd">' + escapeHtml(r.unitId) + '</td>' +
      '<td style="padding:4px 8px;border:1px solid #ddd">' + escapeHtml(r.capacity) + '</td>' +
      '<td style="padding:4px 8px;border:1px solid #ddd">' + escapeHtml(r.age) + '</td>' +
      '<td style="padding:4px 8px;border:1px solid #ddd">' + escapeHtml(r.location) + '</td>' +
      '<td style="padding:4px 8px;border:1px solid #ddd">' + escapeHtml(r.price) + '</td>' +
      '<td style="padding:4px 8px;border:1px solid #ddd">' + escapeHtml(r.contact) + '</td>' +
      '</tr>';
  }).join('');

  var html =
    '<h2 style="font-family:sans-serif">New Fleet Intake registration</h2>' +
    '<p style="font-family:sans-serif">' +
      '<b>Company:</b> ' + escapeHtml(company.name) + '<br>' +
      '<b>Contact person:</b> ' + escapeHtml(company.contactPerson) + '<br>' +
      '<b>Email:</b> ' + escapeHtml(company.email) + '<br>' +
      '<b>Phone:</b> ' + escapeHtml(company.phone) + '<br>' +
      '<b>Language:</b> ' + escapeHtml(data.language) +
    '</p>' +
    '<p style="font-family:sans-serif"><b>' + equipment.length + ' unit(s) submitted</b></p>' +
    (equipment.length
      ? '<table style="border-collapse:collapse;font-family:sans-serif;font-size:13px">' +
        '<tr style="background:#f2f2f2">' +
        ['Brand', 'Type', 'Model', 'ID', 'Capacity', 'Age', 'Location', 'Price/Day', 'Contact']
          .map(function (h) { return '<th style="padding:4px 8px;border:1px solid #ddd;text-align:left">' + h + '</th>'; }).join('') +
        '</tr>' + rowsHtml + '</table>'
      : '') +
    '<p style="font-family:sans-serif;color:#888;font-size:12px">Submission ID: ' + submissionId + '</p>';

  var payload = {
    from: fromAddress,
    to: [toAddress],
    subject: 'New machinery registration — ' + (company.name || 'Unknown company'),
    html: html
  };

  try {
    var resp = UrlFetchApp.fetch('https://api.resend.com/emails', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() >= 300) {
      logError('Resend notification returned ' + resp.getResponseCode() + ': ' + resp.getContentText());
    }
  } catch (err) {
    logError('Resend notification failed: ' + err);
  }
}

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logError(message) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getOrCreateSheet(ss, SHEET_ERRORS, ['Timestamp', 'Error']);
    sheet.appendRow([new Date(), message]);
  } catch (e2) {
    // if even error logging fails, there's nothing more we can do
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Run this once manually from the Apps Script editor (select it in the
 * function dropdown and click Run) to send yourself a test email using
 * whatever RESEND_API_KEY / NOTIFY_EMAIL you've set in Script Properties.
 * Confirms your Resend setup works before you go live.
 */
function testNotificationEmail() {
  sendNotificationEmail(
    {
      language: 'en',
      company: { name: 'Test Company S.A.', contactPerson: 'Jane Doe', email: 'jane@example.com', phone: '+1 555 0100' }
    },
    [{ brand: 'Caterpillar', type: 'Excavator', model: '320 GC', unitId: 'CAT-0417', capacity: '20 t', age: '3 yrs', location: 'Test City', price: '$450', contact: '' }],
    'TEST-' + new Date().getTime()
  );
}
