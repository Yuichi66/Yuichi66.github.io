/**
 * @OnlyCurrentDoc
 * Half Term Challenge - shared storage. Only this spreadsheet can be touched.
 * Paste into Extensions > Apps Script of the Google Sheet, then
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 */

var KIDS = {
  taiga: { maths: true, target: 7, mathsTarget: 7 },
  leo: { maths: true, target: 7, mathsTarget: 7 },
  yudai: { maths: false, target: 5, mathsTarget: 0 }
};
var DAY_COUNT = 9;
var MAX_TITLE = 120;
var MAX_PRIZE = 80;
var MAX_SCORE = 50;
var MAX_MINUTES = 120;
var MAX_TARGET = 30;
var DEFAULT_PRIZE = "Mystery Prize!";
var READ_SITES = ["ReadnQuiz", "Free Book Quiz", "School AR"];
var MATHS_SITES = ["Times Tables Rock Stars", "Hit the Button"];
var ENTRY_HEADERS = ["id", "kid", "type", "day", "title", "site", "score", "total", "minutes", "createdAt"];

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
    else if (body.action === "settings") saveSettings_(String(body.kid || ""), body.settings);
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
    var base = { id: String(r[0]), kid: String(r[1]), type: String(r[2]), day: Number(r[3]), site: String(r[5]) };
    if (base.type === "maths") base.minutes = Number(r[8]);
    else {
      base.title = String(r[4]);
      base.score = Number(r[6]);
      base.total = Number(r[7]);
    }
    return base;
  });
  return { ok: true, entries: entries, settings: readSettings_() };
}

function addEntry_(x) {
  if (!x) throw new Error("Missing entry");
  var kid = String(x.kid || "");
  var day = Number(x.day);
  if (!KIDS.hasOwnProperty(kid)) throw new Error("Unknown kid");
  if (!isInt_(day) || day < 0 || day >= DAY_COUNT) throw new Error("Bad day");
  var id = String(x.id || Utilities.getUuid()).slice(0, 40);

  if (x.type === "maths") {
    var minutes = Number(x.minutes);
    if (!KIDS[kid].maths) throw new Error("No maths for this kid");
    if (!isInt_(minutes) || minutes < 1 || minutes > MAX_MINUTES) throw new Error("Bad minutes");
    var mSite = MATHS_SITES.indexOf(x.site) >= 0 ? x.site : MATHS_SITES[0];
    entriesSheet_().appendRow([id, kid, "maths", day, "", mSite, "", "", minutes, new Date()]);
    return;
  }

  var title = String(x.title || "").replace(/\s+/g, " ").trim();
  var score = Number(x.score);
  var total = Number(x.total);
  var site = READ_SITES.indexOf(x.site) >= 0 ? x.site : READ_SITES[0];
  if (!title || title.length > MAX_TITLE) throw new Error("Bad title");
  if (!isInt_(total) || total < 1 || total > MAX_SCORE) throw new Error("Bad total");
  if (!isInt_(score) || score < 0 || score > total) throw new Error("Bad score");
  entriesSheet_().appendRow([id, kid, "read", day, asText_(title), site, score, total, "", new Date()]);
}

function deleteEntry_(id) {
  var sheet = entriesSheet_();
  var ids = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (var i = ids.length - 1; i >= 1; i--) {
    if (String(ids[i][0]) === id) sheet.deleteRow(i + 1);
  }
}

function saveSettings_(kid, s) {
  if (!KIDS.hasOwnProperty(kid)) throw new Error("Unknown kid");
  if (!s) throw new Error("Missing settings");
  var target = Number(s.target);
  var mathsTarget = KIDS[kid].maths ? Number(s.mathsTarget) : 0;
  var prize = String(s.prize || "").trim().slice(0, MAX_PRIZE) || DEFAULT_PRIZE;
  if (!isInt_(target) || target < 1 || target > MAX_TARGET) throw new Error("Bad target");
  if (KIDS[kid].maths && (!isInt_(mathsTarget) || mathsTarget < 1 || mathsTarget > MAX_TARGET)) throw new Error("Bad maths target");
  setSetting_(kid + ".target", target);
  setSetting_(kid + ".mathsTarget", mathsTarget);
  setSetting_(kid + ".prize", asText_(prize));
}

function readSettings_() {
  var out = {};
  Object.keys(KIDS).forEach(function (k) {
    out[k] = { target: KIDS[k].target, mathsTarget: KIDS[k].mathsTarget, prize: DEFAULT_PRIZE };
  });
  settingsSheet_().getDataRange().getValues().slice(1).forEach(function (r) {
    var parts = String(r[0]).split(".");
    if (!out[parts[0]] || r[1] === "") return;
    if (parts[1] === "target" || parts[1] === "mathsTarget") {
      if (isInt_(Number(r[1]))) out[parts[0]][parts[1]] = Number(r[1]);
    } else if (parts[1] === "prize") {
      out[parts[0]].prize = String(r[1]);
    }
  });
  return out;
}

function setSetting_(key, value) {
  var sheet = settingsSheet_();
  var keys = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (var i = 1; i < keys.length; i++) {
    if (keys[i][0] === key) {
      sheet.getRange(i + 1, 2, 1, 1).setValues([[value]]);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function entriesSheet_() {
  return sheet_("Entries", ENTRY_HEADERS);
}

function settingsSheet_() {
  return sheet_("Settings", ["key", "value"]);
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
