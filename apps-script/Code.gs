/**
 * Half Term Reading Challenge - shared storage.
 * Paste into Extensions > Apps Script of the Google Sheet, then
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 */

var KIDS = ["taiga", "leo"];
var DAY_COUNT = 9;
var MAX_TITLE = 120;
var MAX_PRIZE = 80;
var MAX_SCORE = 50;
var ENTRY_HEADERS = ["id", "kid", "day", "title", "site", "score", "total", "createdAt"];
var SITES = ["ReadnQuiz", "Free Book Quiz", "School AR"];
var DEFAULT_SETTINGS = { target: 7, prize: "Mystery Prize!" };

function doGet() {
  return json_(snapshot_());
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (body.action === "add") addEntry_(body.entry);
    else if (body.action === "delete") deleteEntry_(String(body.id || ""));
    else if (body.action === "settings") saveSettings_(body.settings);
    else throw new Error("Unknown action");
    return json_(snapshot_());
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function snapshot_() {
  var rows = entriesSheet_().getDataRange().getValues().slice(1);
  var entries = rows.filter(function (r) { return r[0] !== ""; }).map(function (r) {
    return {
      id: String(r[0]), kid: String(r[1]), day: Number(r[2]), title: String(r[3]),
      site: String(r[4]), score: Number(r[5]), total: Number(r[6])
    };
  });
  return { ok: true, entries: entries, settings: readSettings_() };
}

function addEntry_(x) {
  if (!x) throw new Error("Missing entry");
  var kid = String(x.kid || "");
  var day = Number(x.day);
  var title = String(x.title || "").replace(/\s+/g, " ").trim();
  var score = Number(x.score);
  var total = Number(x.total);
  var site = SITES.indexOf(x.site) >= 0 ? x.site : SITES[0];
  if (KIDS.indexOf(kid) < 0) throw new Error("Unknown kid");
  if (!isInt_(day) || day < 0 || day >= DAY_COUNT) throw new Error("Bad day");
  if (!title || title.length > MAX_TITLE) throw new Error("Bad title");
  if (!isInt_(total) || total < 1 || total > MAX_SCORE) throw new Error("Bad total");
  if (!isInt_(score) || score < 0 || score > total) throw new Error("Bad score");
  var id = String(x.id || Utilities.getUuid()).slice(0, 40);
  entriesSheet_().appendRow([id, kid, day, asText_(title), site, score, total, new Date()]);
}

function deleteEntry_(id) {
  var sheet = entriesSheet_();
  var ids = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (var i = ids.length - 1; i >= 1; i--) {
    if (String(ids[i][0]) === id) sheet.deleteRow(i + 1);
  }
}

function saveSettings_(s) {
  if (!s) throw new Error("Missing settings");
  var target = Number(s.target);
  var prize = String(s.prize || "").trim().slice(0, MAX_PRIZE) || DEFAULT_SETTINGS.prize;
  if (!isInt_(target) || target < 1 || target > 30) throw new Error("Bad target");
  var sheet = settingsSheet_();
  sheet.getRange(2, 1, 2, 2).setValues([["target", target], ["prize", asText_(prize)]]);
}

function readSettings_() {
  var values = settingsSheet_().getDataRange().getValues();
  var out = { target: DEFAULT_SETTINGS.target, prize: DEFAULT_SETTINGS.prize };
  values.slice(1).forEach(function (r) {
    if (r[0] === "target" && isInt_(Number(r[1]))) out.target = Number(r[1]);
    if (r[0] === "prize" && r[1] !== "") out.prize = String(r[1]);
  });
  return out;
}

function entriesSheet_() {
  return sheet_("Entries", ENTRY_HEADERS);
}

function settingsSheet_() {
  var sheet = sheet_("Settings", ["key", "value"]);
  if (sheet.getLastRow() < 3) {
    sheet.getRange(2, 1, 2, 2).setValues([["target", DEFAULT_SETTINGS.target], ["prize", DEFAULT_SETTINGS.prize]]);
  }
  return sheet;
}

function sheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// A leading "=" (or +, -, @) would be read as a formula by Sheets; "'" keeps it as text.
function asText_(text) {
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function isInt_(n) {
  return typeof n === "number" && isFinite(n) && Math.floor(n) === n;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
