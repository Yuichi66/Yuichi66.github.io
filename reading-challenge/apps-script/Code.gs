/**
 * @OnlyCurrentDoc
 * Half Term Challenge - shared storage. Only this spreadsheet can be touched.
 * Paste into Extensions > Apps Script of the Google Sheet, then
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 */

var KIDS = {
  taiga: { maths: true, target: 10, mathsTarget: 2500, practices: [] },
  leo: { maths: true, target: 10, mathsTarget: 2500, practices: [] },
  yudai: { maths: false, target: 18, mathsTarget: 0, practices: ["latin", "mymaths"] }
};
// Extra practice types and the name stored in the "site" column.
var PRACTICE_SITES = { latin: "Latin", mymaths: "MyMaths" };
var DAY_COUNT = 9;
var MAX_TITLE = 120;
var MAX_SCORE = 50;
var MAX_CORRECT = 2000;
var MAX_TARGET = 60;
var MIN_MATHS_TARGET = 10;
var MAX_MATHS_TARGET = 20000;
var MAX_DEX = 1025;
var MAX_FORM = 20000;
var READ_SITES = ["ReadnQuiz", "Free Book Quiz", "School AR", "No quiz"];
var MATHS_SITE = "Times Tables Rock Stars";
// "mon": national dex number of the Pokémon a record caught, saved once so it can never change later.
var ENTRY_HEADERS = ["id", "kid", "type", "day", "title", "site", "score", "total", "correct", "createdAt", "mon"];
var MON_COL = 11;
// Pages older than this may work out Pokémon differently, so their changes are refused.
var MIN_CLIENT_GEN = 1;

function doGet() {
  return json_(snapshot_());
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (!(Number(body.gen) >= MIN_CLIENT_GEN)) throw new Error("Old page: please reload");
    if (body.action === "add") addWithEvolve_(body.entry, body.evolve);
    else if (body.action === "freeze") freezeMons_(body.mons);
    else if (body.action === "delete") deleteEntry_(String(body.id || ""));
    else if (body.action === "settings") saveSettings_(String(body.kid || ""), body.settings);
    else if (body.action === "partner") savePartner_(String(body.kid || ""), Number(body.partner));
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
    var base = { id: String(r[0]), kid: String(r[1]), type: String(r[2]), day: Number(r[3]), site: String(r[5]), mon: Number(r[MON_COL - 1]) || 0 };
    if (base.type === "maths" || PRACTICE_SITES.hasOwnProperty(base.type)) base.correct = Number(r[8]);
    else if (base.type === "evolve") base.source = String(r[4]);
    else {
      base.title = String(r[4]);
      base.score = Number(r[6]);
      base.total = Number(r[7]);
    }
    return base;
  });
  return { ok: true, entries: entries, settings: readSettings_() };
}

// Saves a record, and the evolution it paid for, all or nothing. Sending the same record twice
// (a retry after a lost reply) does not make a copy.
function addWithEvolve_(entry, evolve) {
  if (!entry) throw new Error("Missing entry");
  var id = String(entry.id || "").slice(0, 40);
  if (!id) throw new Error("Missing id");
  if (rowOf_(id) > 0) return;
  if (evolve) {
    if (evolve.type !== "evolve" || Number(evolve.day) !== Number(entry.day) || !evolve.id) throw new Error("Bad evolution");
    var target = String(evolve.target || "").slice(0, 40);
    if (String(evolve.kid) !== String(entry.kid)) throw new Error("Bad evolution");
    if (String(evolve.source || "") !== id) throw new Error("Unknown reward for the evolution");
    if (!target || !hasEntry_(target, String(entry.kid))) throw new Error("Unknown Pokémon to evolve");
  }
  addEntry_(entry);
  if (evolve) addEntry_(evolve);
}

// Saves the caught Pokémon of older records (only where none is saved yet).
function freezeMons_(mons) {
  if (!mons || !mons.length) return;
  var want = {};
  mons.forEach(function (m) {
    var dex = Number(m && m.mon);
    if (m && m.id && isInt_(dex) && dex > 0 && dex <= MAX_FORM) want[String(m.id)] = dex;
  });
  var sheet = entriesSheet_();
  var rows = sheet.getRange(1, 1, sheet.getLastRow(), MON_COL).getValues();
  for (var i = 1; i < rows.length; i++) {
    var id = String(rows[i][0]);
    if (want.hasOwnProperty(id) && rows[i][MON_COL - 1] === "") sheet.getRange(i + 1, MON_COL).setValue(want[id]);
  }
}

function monOf_(x) {
  var dex = Number(x.mon);
  return isInt_(dex) && dex > 0 && dex <= MAX_FORM ? dex : "";
}

function addEntry_(x) {
  if (!x) throw new Error("Missing entry");
  var kid = String(x.kid || "");
  var day = Number(x.day);
  if (!KIDS.hasOwnProperty(kid)) throw new Error("Unknown kid");
  if (!isInt_(day) || day < 0 || day >= DAY_COUNT) throw new Error("Bad day");
  var id = String(x.id || Utilities.getUuid()).slice(0, 40);

  if (x.type === "maths") {
    var correct = Number(x.correct);
    if (!KIDS[kid].maths) throw new Error("No maths for this kid");
    if (!isInt_(correct) || correct < 0 || correct > MAX_CORRECT) throw new Error("Bad correct answers");
    entriesSheet_().appendRow([id, kid, "maths", day, "", MATHS_SITE, "", "", correct, new Date(), monOf_(x)]);
    return;
  }

  if (PRACTICE_SITES.hasOwnProperty(x.type)) {
    var n = Number(x.correct);
    if (KIDS[kid].practices.indexOf(x.type) < 0) throw new Error("No " + PRACTICE_SITES[x.type] + " for this kid");
    if (!isInt_(n) || n < 0 || n > MAX_CORRECT) throw new Error("Bad correct answers");
    entriesSheet_().appendRow([id, kid, x.type, day, "", PRACTICE_SITES[x.type], "", "", n, new Date(), monOf_(x)]);
    return;
  }

  // Evolution of one caught Pokémon: "site" holds the id of the record that caught it,
  // "title" the id of the record whose reward paid for it.
  if (x.type === "evolve") {
    var target = String(x.target || "").slice(0, 40);
    var source = String(x.source || "").slice(0, 40);
    if (!target || !hasEntry_(target, kid)) throw new Error("Unknown Pokémon to evolve");
    if (!source || !hasEntry_(source, kid)) throw new Error("Unknown reward for the evolution");
    entriesSheet_().appendRow([id, kid, "evolve", day, source, target, "", "", "", new Date(), ""]);
    return;
  }

  var title = String(x.title || "").replace(/\s+/g, " ").trim();
  var score = Number(x.score);
  var total = Number(x.total);
  var site = READ_SITES.indexOf(x.site) >= 0 ? x.site : READ_SITES[0];
  if (!title || title.length > MAX_TITLE) throw new Error("Bad title");
  if (!isInt_(total) || total < 1 || total > MAX_SCORE) throw new Error("Bad total");
  if (!isInt_(score) || score < 0 || score > total) throw new Error("Bad score");
  entriesSheet_().appendRow([id, kid, "read", day, asText_(title), site, score, total, "", new Date(), monOf_(x)]);
}

function rowOf_(id) {
  var sheet = entriesSheet_();
  var ids = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (var i = 1; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 1;
  return 0;
}

function hasEntry_(id, kid) {
  return entriesSheet_().getDataRange().getValues().slice(1).some(function (r) {
    return String(r[0]) === id && String(r[1]) === kid;
  });
}

function deleteEntry_(id) {
  if (!id) throw new Error("Missing id");
  var sheet = entriesSheet_();
  // Also removes the evolution paid for by this record.
  var rows = sheet.getRange(1, 1, sheet.getLastRow(), 5).getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === id || (rows[i][2] === "evolve" && String(rows[i][4]) === id)) sheet.deleteRow(i + 1);
  }
}

function saveSettings_(kid, s) {
  if (!KIDS.hasOwnProperty(kid)) throw new Error("Unknown kid");
  if (!s) throw new Error("Missing settings");
  var target = Number(s.target);
  var mathsTarget = KIDS[kid].maths ? Number(s.mathsTarget) : 0;
  if (!isInt_(target) || target < 1 || target > MAX_TARGET) throw new Error("Bad target");
  if (KIDS[kid].maths && (!isInt_(mathsTarget) || mathsTarget < MIN_MATHS_TARGET || mathsTarget > MAX_MATHS_TARGET)) throw new Error("Bad maths target");
  setSetting_(kid + ".target", target);
  setSetting_(kid + ".mathsTarget", mathsTarget);
}

// Partner Pokémon shown next to the trainer name (national dex number; 0 = default).
function savePartner_(kid, dexNo) {
  if (!KIDS.hasOwnProperty(kid)) throw new Error("Unknown kid");
  if (!isInt_(dexNo) || dexNo < 0 || dexNo > MAX_DEX) throw new Error("Bad partner");
  setSetting_(kid + ".partner", dexNo);
}

function readSettings_() {
  var out = {};
  Object.keys(KIDS).forEach(function (k) {
    out[k] = { target: KIDS[k].target, mathsTarget: KIDS[k].mathsTarget, partner: 0 };
  });
  settingsSheet_().getDataRange().getValues().slice(1).forEach(function (r) {
    var parts = String(r[0]).split(".");
    if (!out[parts[0]] || r[1] === "") return;
    if ((parts[1] === "target" || parts[1] === "mathsTarget" || parts[1] === "partner") && isInt_(Number(r[1]))) {
      out[parts[0]][parts[1]] = Number(r[1]);
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
  var sheet = sheet_("Entries", ENTRY_HEADERS);
  // Keep the header row in step with ENTRY_HEADERS after column changes.
  var header = sheet.getRange(1, 1, 1, ENTRY_HEADERS.length);
  if (header.getValues()[0].join() !== ENTRY_HEADERS.join()) header.setValues([ENTRY_HEADERS]);
  return sheet;
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
