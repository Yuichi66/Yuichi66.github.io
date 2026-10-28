/**
 * @OnlyCurrentDoc
 * Half Term Challenge - shared storage. Only this spreadsheet can be touched.
 * Paste into Extensions > Apps Script of the Google Sheet, then
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 */

var KIDS = {
  taiga: { maths: true, target: 7, mathsTarget: 2500, practices: [] },
  leo: { maths: true, target: 7, mathsTarget: 2500, practices: [] },
  yudai: { maths: false, target: 10, mathsTarget: 0, practices: ["latin", "mymaths"] }
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
var MAX_FORM = 20000;
var MAX_RANK = 20;
var READ_SITES = ["ReadnQuiz", "Free Book Quiz", "School AR", "No quiz"];
var MATHS_SITE = "Times Tables Rock Stars";
// "mon": national dex number of the Pokémon a record caught, saved once so it can never change later.
// "partner": the Pokémon (id of the record that caught it) that got the experience of a study record.
// "shiny": 1 when the Pokémon a record caught is shiny (saved once, like "mon").
var ENTRY_HEADERS = ["id", "kid", "type", "day", "title", "site", "score", "total", "correct", "createdAt", "mon", "partner", "shiny"];
var MON_COL = 11;
var PARTNER_COL = 12;
var SHINY_COL = 13;
var MAX_ID = 40;
// Pages older than this may work out Pokémon differently, so their changes are refused.
var MIN_CLIENT_GEN = 6;
// Tells pages that this sheet code knows trades (2) and levels, level-up evolutions and Mega Stones (3), the Poké Ball meter (4), all 1,025 Pokémon and regions (5), shiny Pokémon (6).
var SERVER_GEN = 6;
// Evolutions from a level or a Mega Stone: "title" holds this word instead of the record that paid for it.
var GROWTH_KINDS = ["level", "stone"];

function doGet() {
  return json_(snapshot_());
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (!(Number(body.gen) >= MIN_CLIENT_GEN)) throw new Error("Old page: please reload");
    if (body.action === "add") addWithReward_(body.entry, body.evolve, body.trade);
    else if (body.action === "trade") addTicketTrade_(body.trade);
    else if (body.action === "evolve") addGrowthEvolve_(body.evolve);
    else if (body.action === "peak") savePeak_(String(body.kid || ""), Number(body.rank));
    else if (body.action === "freeze") freezeMons_(body.mons);
    else if (body.action === "delete") deleteEntry_(String(body.id || ""));
    else if (body.action === "settings") saveSettings_(String(body.kid || ""), body.settings);
    else if (body.action === "partner") savePartner_(String(body.kid || ""), String(body.partnerId || ""));
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
    if (base.type === "maths" || PRACTICE_SITES.hasOwnProperty(base.type)) {
      base.correct = Number(r[8]);
      base.partner = String(r[PARTNER_COL - 1] || "");
      base.shiny = r[SHINY_COL - 1] === 1 || r[SHINY_COL - 1] === "1" ? 1 : 0;
    }
    else if (base.type === "evolve") {
      var kind = String(r[4]);
      if (GROWTH_KINDS.indexOf(kind) >= 0) {
        base.kind = kind;
        base.source = "";
        base.to = Number(r[6]) || 0;
        base.from = Number(r[7]) || 0;
        base.stone = Number(r[8]) || 0;
      } else {
        base.kind = "old";
        base.source = kind;
      }
    }
    else if (base.type === "trade") {
      base.source = String(r[4]);
      base.get = String(r[6]);
      base.with = String(r[7]);
      base.ticket = Number(r[8]) || 0;
    }
    else {
      base.title = String(r[4]);
      base.score = Number(r[6]);
      base.total = Number(r[7]);
      base.partner = String(r[PARTNER_COL - 1] || "");
      base.shiny = r[SHINY_COL - 1] === 1 || r[SHINY_COL - 1] === "1" ? 1 : 0;
    }
    return base;
  });
  return { ok: true, gen: SERVER_GEN, entries: entries, settings: readSettings_() };
}

// Saves a record, and the evolution or trade it paid for, all or nothing. Sending the same record twice
// (a retry after a lost reply) does not make a copy.
function addWithReward_(entry, evolve, trade) {
  if (!entry) throw new Error("Missing entry");
  var id = String(entry.id || "").slice(0, 40);
  if (!id) throw new Error("Missing id");
  if (rowOf_(id) > 0) return;
  // A win no longer evolves a Pokémon (evolutions now come from levels and Mega Stones).
  if (evolve) throw new Error("Bad evolution");
  checkPartner_(entry);
  if (trade) {
    if (trade.type !== "trade" || Number(trade.day) !== Number(entry.day) || !trade.id) throw new Error("Bad trade");
    if (String(trade.kid) !== String(entry.kid)) throw new Error("Bad trade");
    if (String(trade.source || "") !== id) throw new Error("Unknown reward for the trade");
    checkTrade_(trade);
  }
  addEntry_(entry);
  if (trade) addEntry_(trade);
}

// The partner saved with a study record must be in that child's box now (empty = no experience).
function checkPartner_(x) {
  var partner = String(x.partner || "");
  if (!partner) return;
  if (partner.length > MAX_ID || owners_()[partner] !== String(x.kid)) throw new Error(NOT_POSSIBLE);
}
function partnerOf_(x) { return String(x.partner || "").slice(0, MAX_ID); }
// Only a record that caught a Pokémon can be shiny.
function shinyOf_(x) { return x.shiny === 1 && monOf_(x) !== "" ? 1 : ""; }

function isGrowthRow_(r) { return r[2] === "evolve" && GROWTH_KINDS.indexOf(String(r[4])) >= 0; }

// An evolution from reaching a level, or from a Mega Stone. The page checks the level and the species
// (the sheet has no Pokémon data); the sheet checks the box, the order of evolutions and the stones.
// "site" = the Pokémon (record that caught it), "score" = new form, "total" = form before, "correct" = stone number.
function addGrowthEvolve_(ev) {
  if (!ev || ev.type !== "evolve" || GROWTH_KINDS.indexOf(ev.kind) < 0) throw new Error("Bad evolution");
  var id = String(ev.id || "").slice(0, MAX_ID);
  var kid = String(ev.kid || "");
  var target = String(ev.target || "").slice(0, MAX_ID);
  var to = Number(ev.to), from = Number(ev.from), day = Number(ev.day);
  if (!id || !KIDS.hasOwnProperty(kid) || !target) throw new Error("Bad evolution");
  if (!isInt_(to) || to <= 0 || to > MAX_FORM || !isInt_(from) || from <= 0 || from > MAX_FORM || to === from) throw new Error("Bad evolution");
  if (!isInt_(day) || day < 0 || day >= DAY_COUNT) throw new Error("Bad day");
  if (ev.kind === "level" && id !== "lv-" + target + "-" + from) throw new Error("Bad evolution");
  var rows = entriesSheet_().getDataRange().getValues().slice(1);
  var same = rows.filter(function (r) { return String(r[0]) === id; })[0];
  if (same) {
    // A retry of the same evolution is fine; the same Pokémon evolved differently on another phone is not.
    if (isGrowthRow_(same) && Number(same[6]) === to) return;
    throw new Error(NOT_POSSIBLE);
  }
  if (owners_()[target] !== kid) throw new Error(NOT_POSSIBLE);
  // Evolutions of one Pokémon (saved by any child) follow each other: this one starts where the last one ended.
  var last = rows.filter(function (r) { return isGrowthRow_(r) && String(r[5]) === target; }).pop();
  if (last && Number(last[6]) !== from) throw new Error(NOT_POSSIBLE);
  var stone = "";
  if (ev.kind === "stone") {
    var used = stonesUsed_(kid, rows);
    if (Number(ev.stone) !== used + 1) throw new Error("Not possible: that Mega Stone was already used.");
    if (used >= stonesEarned_(kid)) throw new Error("Not possible: no Mega Stone left.");
    stone = used + 1;
  }
  entriesSheet_().appendRow([id, kid, "evolve", day, ev.kind, target, to, from, stone, new Date(), "", ""]);
}

function stonesUsed_(kid, rows) {
  return rows.filter(function (r) { return isGrowthRow_(r) && String(r[1]) === kid && String(r[4]) === "stone"; }).length;
}
// One Mega Stone for each rank reached after Mega Stones started.
function stonesEarned_(kid) {
  var s = readSettings_()[kid];
  if (s.stoneBase === "" || s.peak === "") return 0;
  return Math.max(0, s.peak - s.stoneBase);
}

// A trade paid with a trade ticket (the page counts the tickets). Same id twice = one row.
function addTicketTrade_(trade) {
  if (!trade || trade.type !== "trade") throw new Error("Bad trade");
  var id = String(trade.id || "").slice(0, 40);
  if (!id) throw new Error("Missing id");
  if (rowOf_(id) > 0) return;
  if (String(trade.source || "") !== "ticket") throw new Error("Bad trade");
  var kid = String(trade.kid || "");
  if (!KIDS.hasOwnProperty(kid)) throw new Error("Unknown kid");
  // Each ticket number once: a ticket used on another phone (or a retry of a saved trade) is refused.
  if (Number(trade.ticket) !== ticketsUsed_(kid) + 1) throw new Error("Not possible: that trade ticket was already used.");
  checkTrade_(trade);
  addEntry_(trade);
}

var NOT_POSSIBLE = "Not possible: the Pokémon boxes changed on another phone. Please choose again.";

// The initiator must have the Pokémon they give, and the other child the one they give back, right now.
function checkTrade_(t) {
  var kid = String(t.kid || ""), other = String(t.with || "");
  var give = String(t.give || "").slice(0, 40);
  var get = String(t.get || "").slice(0, 40);
  if (!KIDS.hasOwnProperty(kid) || !KIDS.hasOwnProperty(other) || kid === other) throw new Error("Bad trade");
  if (!give || !get || give === get) throw new Error("Bad trade");
  var owner = owners_();
  if (owner[give] !== kid || owner[get] !== other) throw new Error(NOT_POSSIBLE);
}

// Who has each caught Pokémon now (catch record id -> kid): each record's own child,
// then the trades in sheet order. The page works it out the same way.
function owners_() {
  var owner = {};
  entriesSheet_().getDataRange().getValues().slice(1).forEach(function (r) {
    var type = r[2];
    if (type === "trade") {
      var kid = String(r[1]), give = String(r[5]), get = String(r[6]), other = String(r[7]);
      if (owner[give] === kid && owner[get] === other) {
        owner[give] = other;
        owner[get] = kid;
      }
    } else if (type !== "evolve" && r[MON_COL - 1] !== "") owner[String(r[0])] = String(r[1]);
  });
  return owner;
}

function ticketsUsed_(kid) {
  return entriesSheet_().getDataRange().getValues().slice(1).filter(function (r) {
    return r[2] === "trade" && String(r[1]) === kid && String(r[4]) === "ticket";
  }).length;
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
    entriesSheet_().appendRow([id, kid, "maths", day, "", MATHS_SITE, "", "", correct, new Date(), monOf_(x), partnerOf_(x), shinyOf_(x)]);
    return;
  }

  if (PRACTICE_SITES.hasOwnProperty(x.type)) {
    var n = Number(x.correct);
    if (KIDS[kid].practices.indexOf(x.type) < 0) throw new Error("No " + PRACTICE_SITES[x.type] + " for this kid");
    if (!isInt_(n) || n < 0 || n > MAX_CORRECT) throw new Error("Bad correct answers");
    entriesSheet_().appendRow([id, kid, x.type, day, "", PRACTICE_SITES[x.type], "", "", n, new Date(), monOf_(x), partnerOf_(x), shinyOf_(x)]);
    return;
  }

  // Trade: "site" holds the record id of the Pokémon given, "score" the one received, "total" the other child,
  // "correct" the ticket number, "title" the record that paid for it ("ticket" = a trade ticket).
  // checkTrade_ has already been run by the caller.
  if (x.type === "trade") {
    var src = String(x.source || "").slice(0, 40);
    if (src !== "ticket" && !hasEntry_(src, kid)) throw new Error("Unknown reward for the trade");
    var ticket = src === "ticket" ? Number(x.ticket) : "";
    entriesSheet_().appendRow([id, kid, "trade", day, src, String(x.give).slice(0, 40), String(x.get).slice(0, 40), String(x.with), ticket, new Date(), ""]);
    return;
  }

  var title = String(x.title || "").replace(/\s+/g, " ").trim();
  var score = Number(x.score);
  var total = Number(x.total);
  var site = READ_SITES.indexOf(x.site) >= 0 ? x.site : READ_SITES[0];
  if (!title || title.length > MAX_TITLE) throw new Error("Bad title");
  if (!isInt_(total) || total < 1 || total > MAX_SCORE) throw new Error("Bad total");
  if (!isInt_(score) || score < 0 || score > total) throw new Error("Bad score");
  entriesSheet_().appendRow([id, kid, "read", day, asText_(title), site, score, total, "", new Date(), monOf_(x), partnerOf_(x), shinyOf_(x)]);
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
  var rows = sheet.getRange(1, 1, sheet.getLastRow(), 7).getValues();
  // A record a trade depends on stays: one that paid for a trade, caught a traded Pokémon, or paid for an
  // evolution of a traded Pokémon. Deleting it would change a Pokémon in another child's box.
  var traded = {};
  rows.forEach(function (r) {
    if (r[2] !== "trade") return;
    traded[String(r[5])] = traded[String(r[6])] = true;
    if (String(r[4]) === id) traded[id] = true;
  });
  var paysTraded = rows.some(function (r) { return r[2] === "evolve" && String(r[4]) === id && traded[String(r[5])]; });
  if (traded[id] || paysTraded) throw new Error("Not possible: this record was used in a trade, so it cannot be deleted.");
  // An old evolution under a later level-up or Mega Stone evolution stays (the later one starts from its form).
  var grown = {};
  rows.forEach(function (r) { if (isGrowthRow_(r)) grown[String(r[5])] = true; });
  if (rows.some(function (r) { return r[2] === "evolve" && String(r[4]) === id && grown[String(r[5])]; })) {
    throw new Error("Not possible: this record evolved a Pokémon that has grown since, so it cannot be deleted.");
  }
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

// Highest trainer rank reached. The first one saved is also where trade tickets start.
function savePeak_(kid, rank) {
  if (!KIDS.hasOwnProperty(kid)) throw new Error("Unknown kid");
  if (!isInt_(rank) || rank < 0 || rank > MAX_RANK) throw new Error("Bad rank");
  var s = readSettings_()[kid];
  if (s.ticketBase === "") setSetting_(kid + ".ticketBase", rank);
  // Mega Stones count from the peak saved before the first rank this sheet code saves.
  if (s.stoneBase === "") setSetting_(kid + ".stoneBase", s.peak === "" ? rank : s.peak);
  if (s.peak === "" || rank > s.peak) setSetting_(kid + ".peak", rank);
}

// Partner Pokémon shown next to the trainer name, which gets the experience (id of the record that caught it).
function savePartner_(kid, partnerId) {
  if (!KIDS.hasOwnProperty(kid)) throw new Error("Unknown kid");
  if (!partnerId || partnerId.length > MAX_ID || owners_()[partnerId] !== kid) throw new Error(NOT_POSSIBLE);
  setSetting_(kid + ".partnerId", partnerId);
}

function readSettings_() {
  var out = {};
  Object.keys(KIDS).forEach(function (k) {
    out[k] = { target: KIDS[k].target, mathsTarget: KIDS[k].mathsTarget, partnerId: "", ticketBase: "", peak: "", stoneBase: "" };
  });
  settingsSheet_().getDataRange().getValues().slice(1).forEach(function (r) {
    var parts = String(r[0]).split(".");
    if (!out[parts[0]] || r[1] === "") return;
    if (["target", "mathsTarget", "ticketBase", "peak", "stoneBase"].indexOf(parts[1]) >= 0 && isInt_(Number(r[1]))) {
      out[parts[0]][parts[1]] = Number(r[1]);
    }
    if (parts[1] === "partnerId") out[parts[0]].partnerId = String(r[1]).slice(0, MAX_ID);
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
