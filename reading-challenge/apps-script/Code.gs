/**
 * @OnlyCurrentDoc
 * Trainer Academy - shared storage. Only this spreadsheet can be touched.
 * Paste into Extensions > Apps Script of the Google Sheet, then
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 */

var KIDS = {
  taiga: { maths: true, target: 7, mathsTarget: 2500, practices: [], practiceGoals: {} },
  leo: { maths: true, target: 7, mathsTarget: 2500, practices: [], practiceGoals: {} },
  yudai: { maths: false, target: 10, mathsTarget: 0, practices: ["latin", "mymaths", "french"],
    practiceGoals: { latin: 10000, mymaths: 1500, french: 5000 } }
};
// Extra practice types and the name stored in the "site" column.
var PRACTICE_SITES = { latin: "Latin", mymaths: "MyMaths", french: "French" };
// Practice goals (correct answers), saved as "<kid>.<type>Goal". Only shown as progress, not used for prizes.
var MIN_PRACTICE_GOAL = 10;
var MAX_PRACTICE_GOAL = 100000;
// Day numbers count from Sat 24 Oct 2026 and have no end (about 10 years allowed).
var MAX_DAY = 3650;
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
var MIN_CLIENT_GEN = 9;
// Tells pages that this sheet code knows trades (2) and levels, level-up evolutions and Mega Stones (3), the Poké Ball meter (4), all 1,025 Pokémon and regions (5), shiny Pokémon (6), French (7), prize Pokémon (8), no end date, holiday events (9; the parent PIN was dropped on 14 Nov), prize balls from books again (10), school awards (11), gym badges (12).
var SERVER_GEN = 12;
var EVENT_BOOKS = 5;
// Prize Pokémon (type "prize"), one per ball per child once the ball is reached (the books goal, and for children
// with times tables the lower of the two goals): "title" = ball (1-3), "mon" = the legendary chosen (Great and
// Ultra Ball), "score" = the prize record made shiny (Master Ball). They are never caught the normal way and are
// not offered as event Pokémon. The same as TIERS and PRIZE_MONS in index.html.
var PRIZE_PCTS = [100, 150, 200];
var PRIZE_MONS = { 1: [144, 145, 146], 2: [150, 151] };
var SHINY_PRIZE_TIER = 3;
// School awards (type "award"), added by the child and given at once (no grown-up check): "title" = what for,
// "site" = the kind (Certificate for TAIGA and LEO, Positive incident for YUDAI), "score" = the subject,
// "mon" = the Pokémon chosen. At most AWARDS_PER_DAY a day per child, so a double tap cannot add many.
var AWARD_KINDS = { taiga: "Certificate", leo: "Certificate", yudai: "Positive incident" };
var AWARDS_PER_DAY = 3;
var MAX_AWARD_TEXT = 120, MAX_AWARD_SUBJECT = 30;
// Gym badges (type "badge"): one every BADGE_STEPS correct answers in a subject, each with a Pokémon the child
// chooses. "title" = subject, "score" = which badge (1, 2, ...). The same as BADGES in index.html.
var BADGE_STEPS = { maths: 5000, latin: 5000, french: 5000, mymaths: 1000 };
var BADGE_NAMES = { maths: "Times tables", latin: "Latin", french: "French", mymaths: "MyMaths" };
var PASS_RATE = 0.8;
var NO_QUIZ = "No quiz";
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
    else if (body.action === "parentCheck") { /* no parent PIN any more: an old page asking is just told OK */ }
    else if (body.action === "event") saveEvent_(String(body.start || ""), String(body.end || ""));
    else if (body.action === "eventmon") addEventMon_(body.entry);
    else if (body.action === "prize") addPrize_(body.prize);
    else if (body.action === "award") addAward_(body.entry);
    else if (body.action === "badge") addBadge_(body.entry);
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
    else if (base.type === "prize") {
      base.tier = Number(r[4]) || 0;
      base.target = String(r[6] || "");
    }
    else if (base.type === "badge") {
      // Sent as a "gift" marked badge: 1 (like awards), so older pages show it as a prize badge.
      base.type = "gift";
      base.badge = 1;
      base.subject = String(r[4]);
      base.n = Number(r[6]) || 0;
      base.title = "Gym badge: " + (BADGE_NAMES[base.subject] || base.subject) + " " + String(base.n * (BADGE_STEPS[base.subject] || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    else if (base.type === "award") {
      // Sent as a "gift" marked award: 1, so pages from before awards (gen 9-10) show it as a prize badge with its
      // Pokémon instead of filing it with the books.
      base.type = "gift";
      base.award = 1;
      base.title = String(r[4]);
      base.subject = String(r[6]);
    }
    else if (base.type === "trade") {
      base.source = String(r[4]);
      base.get = String(r[6]);
      base.with = String(r[7]);
      base.ticket = Number(r[8]) || 0;
    }
    else {
      base.title = cellDay_(r[4], base.type);
      base.score = Number(r[6]);
      base.total = Number(r[7]);
      base.partner = String(r[PARTNER_COL - 1] || "");
      base.shiny = r[SHINY_COL - 1] === 1 || r[SHINY_COL - 1] === "1" ? 1 : 0;
    }
    return base;
  });
  var settings = readSettings_();
  settings.event = readEvent_();
  settings.eventPast = readEventPast_();
  return { ok: true, gen: SERVER_GEN, entries: entries, settings: settings };
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
  if (!isInt_(day) || day < 0 || day > MAX_DAY) throw new Error("Bad day");
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
  if (!isInt_(day) || day < 0 || day > MAX_DAY) throw new Error("Bad day");
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
  var goals = s.practiceGoals || {};
  KIDS[kid].practices.forEach(function (type) {
    if (goals[type] === undefined) return;
    var n = Number(goals[type]);
    if (!isInt_(n) || n < MIN_PRACTICE_GOAL || n > MAX_PRACTICE_GOAL) throw new Error("Bad " + PRACTICE_SITES[type] + " goal");
  });
  setSetting_(kid + ".target", target);
  setSetting_(kid + ".mathsTarget", mathsTarget);
  KIDS[kid].practices.forEach(function (type) {
    if (goals[type] !== undefined) setSetting_(kid + "." + type + "Goal", Number(goals[type]));
  });
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

// Holiday event dates (YYYY-MM-DD, both included). Two empty dates end the event.
function saveEvent_(start, end) {
  var ok = /^\d{4}-\d{2}-\d{2}$/;
  if (start || end) {
    if (!ok.test(start) || !ok.test(end) || start > end) throw new Error("Bad event dates");
  }
  var today = dayKey_(Date.now());
  var cur = readEvent_(), past = readEventPast_();
  var started = !!cur.start && cur.start <= today;
  if (start && past.some(function (w) { return w.start === start; })) throw new Error("That event start was already used");
  if (start && start === cur.start) {
    // Same event, new dates: days already passed stay inside it.
    var floor = started ? (cur.end < today ? cur.end : today) : "";
    if (end < floor) throw new Error("Bad event dates: days already passed stay in the event");
    setSetting_("event.end", end);
    return;
  }
  if (started) {
    // Ending or replacing: the old window stops after today (today is still part of it, so records
    // logged today keep their 2x), or at its own last day if that has gone already.
    var closeAt = cur.end < today ? cur.end : today;
    past.push({ start: cur.start, end: closeAt });
    setSetting_("event.past", JSON.stringify(past));
  }
  setSetting_("event.start", start);
  setSetting_("event.end", end);
}

// Earlier event windows, as [{start,end}] (text dates). Date-like values are turned back into text.
function readEventPast_() {
  var raw = "";
  settingsSheet_().getDataRange().getValues().slice(1).forEach(function (r) { if (r[0] === "event.past") raw = r[1]; });
  var list = [];
  try { list = JSON.parse(String(raw || "[]")); } catch (e) { list = []; }
  if (!Array.isArray(list)) return [];
  function day(v) { return v instanceof Date ? dayKey_(v.getTime()) : String(v || "").slice(0, 10); }
  var ok = /^\d{4}-\d{2}-\d{2}$/;
  return list.map(function (w) { return { start: day(w && w.start), end: day(w && w.end) }; })
    .filter(function (w) { return ok.test(w.start) && ok.test(w.end); });
}

// The family's day is the UK day, whatever time zone the script project is set to.
var DAY_ZONE = "Europe/London";
function dayKey_(ms) {
  return Utilities.formatDate(new Date(ms), DAY_ZONE, "yyyy-MM-dd");
}

// The event Pokémon: once per child per event, after EVENT_BOOKS books passed during it.
// The page picks the species (the sheet has no Pokémon data); the sheet keeps prize legendaries out.
function addEventMon_(x) {
  if (!x) throw new Error("Missing entry");
  var id = String(x.id || "").slice(0, MAX_ID), kid = String(x.kid || ""), mon = Number(x.mon), day = Number(x.day);
  if (!id) throw new Error("Missing id");
  if (rowOf_(id) > 0) return;
  if (!KIDS.hasOwnProperty(kid)) throw new Error("Unknown kid");
  if (!isInt_(day) || day < 0 || day > MAX_DAY) throw new Error("Bad day");
  if (!isInt_(mon) || mon <= 0 || mon > MAX_FORM || PRIZE_MONS[1].concat(PRIZE_MONS[2]).indexOf(mon) >= 0) throw new Error("Bad Pokémon");
  var ev = readEvent_();
  var today = dayKey_(Date.now());
  if (!ev.start || today < ev.start || today > ev.end) throw new Error("Not possible: no holiday event now.");
  var rows = entriesSheet_().getDataRange().getValues().slice(1);
  if (rows.some(function (r) { return r[2] === "event" && String(r[1]) === kid && cellDay_(r[4], "event") === ev.start; })) throw new Error("Not possible: the event Pokémon was already chosen.");
  var books = rows.filter(function (r) {
    if (r[2] !== "read" || String(r[1]) !== kid) return false;
    // The time the sheet wrote the row (the "createdAt" column), not the id the page chose.
    if (!(r[9] instanceof Date)) return false;
    var k = dayKey_(r[9].getTime());
    var passed = r[5] === NO_QUIZ || (Number(r[7]) > 0 && Number(r[6]) / Number(r[7]) >= PASS_RATE);
    return passed && k >= ev.start && k <= ev.end;
  }).length;
  if (books < EVENT_BOOKS) throw new Error("Not possible: " + (EVENT_BOOKS - books) + " more books first.");
  entriesSheet_().appendRow([id, kid, "event", day, ev.start, "Event", "", "", "", new Date(), mon, "", ""]);
}


// A school award the child added: saved at once with the Pokémon they chose. Same id twice = one row.
function addAward_(x) {
  if (!x) throw new Error("Missing entry");
  var id = String(x.id || "").slice(0, MAX_ID), kid = String(x.kid || ""), mon = Number(x.mon), day = Number(x.day);
  if (!id) throw new Error("Missing id");
  if (rowOf_(id) > 0) return;
  if (!KIDS.hasOwnProperty(kid)) throw new Error("Unknown kid");
  if (!isInt_(day) || day < 0 || day > MAX_DAY) throw new Error("Bad day");
  if (String(x.kind || "") !== AWARD_KINDS[kid]) throw new Error("Bad award");
  var subject = String(x.subject || "").trim(), text = String(x.title || "").trim();
  if (!subject || subject.length > MAX_AWARD_SUBJECT || !text || text.length > MAX_AWARD_TEXT) throw new Error("Bad award");
  if (!isInt_(mon) || mon <= 0 || mon > MAX_FORM || PRIZE_MONS[1].concat(PRIZE_MONS[2]).indexOf(mon) >= 0) throw new Error("Bad Pokémon");
  var today = dayKey_(Date.now());
  var rows = entriesSheet_().getDataRange().getValues().slice(1);
  var todays = rows.filter(function (r) { return r[2] === "award" && String(r[1]) === kid && r[9] instanceof Date && dayKey_(r[9].getTime()) === today; }).length;
  if (todays >= AWARDS_PER_DAY) throw new Error("Not possible: " + AWARDS_PER_DAY + " awards a day at most. Ask a grown-up.");
  entriesSheet_().appendRow([id, kid, "award", day, asText_(text), AWARD_KINDS[kid], asText_(subject), "", "", new Date(), mon, "", ""]);
}


// The subjects a child earns gym badges in: times tables if they do them, and their practices.
function badgeSubjects_(kid) {
  return (KIDS[kid].maths ? ["maths"] : []).concat(KIDS[kid].practices).filter(function (t) { return BADGE_STEPS.hasOwnProperty(t); });
}
// A gym badge Pokémon. Same id twice = one row; each badge once, and only once its correct answers are reached.
function addBadge_(x) {
  if (!x) throw new Error("Missing entry");
  var id = String(x.id || "").slice(0, MAX_ID), kid = String(x.kid || ""), mon = Number(x.mon), day = Number(x.day), n = Number(x.n);
  var subject = String(x.subject || "");
  if (!id) throw new Error("Missing id");
  if (rowOf_(id) > 0) return;
  if (!KIDS.hasOwnProperty(kid)) throw new Error("Unknown kid");
  if (!isInt_(day) || day < 0 || day > MAX_DAY) throw new Error("Bad day");
  if (badgeSubjects_(kid).indexOf(subject) < 0 || !isInt_(n) || n < 1) throw new Error("Bad badge");
  if (!isInt_(mon) || mon <= 0 || mon > MAX_FORM || PRIZE_MONS[1].concat(PRIZE_MONS[2]).indexOf(mon) >= 0) throw new Error("Bad Pokémon");
  var rows = entriesSheet_().getDataRange().getValues().slice(1);
  var correct = rows.filter(function (r) { return String(r[1]) === kid && r[2] === subject; }).reduce(function (sum, r) { return sum + (Number(r[8]) || 0); }, 0);
  if (n > Math.floor(correct / BADGE_STEPS[subject])) throw new Error("Not possible: that badge is not reached yet.");
  if (rows.some(function (r) { return r[2] === "badge" && String(r[1]) === kid && String(r[4]) === subject && Number(r[6]) === n; })) throw new Error("Not possible: that badge Pokémon was already chosen.");
  entriesSheet_().appendRow([id, kid, "badge", day, subject, "Badge", n, "", "", new Date(), mon, "", ""]);
}

// A prize Pokémon. Same id twice = one row; each ball once per child, and only once it is reached.
function addPrize_(p) {
  if (!p || p.type !== "prize") throw new Error("Bad prize");
  var id = String(p.id || "").slice(0, MAX_ID);
  if (!id) throw new Error("Missing id");
  if (rowOf_(id) > 0) return;
  var kid = String(p.kid || ""), tier = Number(p.tier), day = Number(p.day);
  if (!KIDS.hasOwnProperty(kid)) throw new Error("Unknown kid");
  if (!isInt_(day) || day < 0 || day > MAX_DAY) throw new Error("Bad day");
  if (!isInt_(tier) || tier < 1 || tier > PRIZE_PCTS.length) throw new Error("Bad prize");
  var rows = entriesSheet_().getDataRange().getValues().slice(1);
  function isPrize(r) { return r[2] === "prize" && String(r[1]) === kid; }
  if (rows.some(function (r) { return isPrize(r) && Number(r[4]) === tier; })) throw new Error("Not possible: that prize was already chosen.");
  if (prizeTier_(kid, rows) < tier) throw new Error("Not possible: that ball is not reached yet.");
  var mon = "", target = "";
  if (tier === SHINY_PRIZE_TIER) {
    // The Master Ball makes one of the child's own prize Pokémon shiny, while it is in their box.
    target = String(p.target || "").slice(0, MAX_ID);
    var won = rows.some(function (r) { return isPrize(r) && String(r[0]) === target && r[MON_COL - 1] !== ""; });
    if (!won || owners_()[target] !== kid) throw new Error(NOT_POSSIBLE);
  } else {
    mon = Number(p.mon);
    if (PRIZE_MONS[tier].indexOf(mon) < 0) throw new Error("Bad prize");
  }
  entriesSheet_().appendRow([id, kid, "prize", day, tier, "Prize", target, "", "", new Date(), mon, "", ""]);
}

// The highest ball a child has reached (0 = none), worked out like the page: books passed, and for
// children with times tables the lower of the two goals.
function prizeTier_(kid, rows) {
  var s = readSettings_()[kid];
  var mine = rows.filter(function (r) { return String(r[1]) === kid; });
  var books = mine.filter(function (r) {
    return r[2] === "read" && (r[5] === NO_QUIZ || (Number(r[7]) > 0 && Number(r[6]) / Number(r[7]) >= PASS_RATE));
  }).length;
  var pct = Math.floor(books / s.target * 100);
  if (KIDS[kid].maths) {
    var correct = mine.filter(function (r) { return r[2] === "maths"; }).reduce(function (sum, r) { return sum + (Number(r[8]) || 0); }, 0);
    pct = Math.min(pct, Math.floor(correct / s.mathsTarget * 100));
  }
  var tier = 0;
  PRIZE_PCTS.forEach(function (need, i) { if (pct >= need) tier = i + 1; });
  return tier;
}

// Sheets may turn a typed YYYY-MM-DD into a Date; give event dates back as text.
function cellDay_(v, type) {
  if (type === "event" && v instanceof Date) return dayKey_(v.getTime());
  return String(v === null || v === undefined ? "" : v);
}

function readEvent_() {
  var out = { start: "", end: "" };
  settingsSheet_().getDataRange().getValues().slice(1).forEach(function (r) {
    var v = cellDay_(r[1], "event");
    if (r[0] === "event.start") out.start = v;
    if (r[0] === "event.end") out.end = v;
  });
  return out;
}

function readSettings_() {
  var out = {};
  Object.keys(KIDS).forEach(function (k) {
    var goals = {};
    KIDS[k].practices.forEach(function (type) { goals[type] = KIDS[k].practiceGoals[type]; });
    out[k] = { target: KIDS[k].target, mathsTarget: KIDS[k].mathsTarget, practiceGoals: goals, partnerId: "", ticketBase: "", peak: "", stoneBase: "" };
  });
  settingsSheet_().getDataRange().getValues().slice(1).forEach(function (r) {
    var parts = String(r[0]).split(".");
    if (!out.hasOwnProperty(parts[0]) || r[1] === "") return;
    if (["target", "mathsTarget", "ticketBase", "peak", "stoneBase"].indexOf(parts[1]) >= 0 && isInt_(Number(r[1]))) {
      out[parts[0]][parts[1]] = Number(r[1]);
    }
    if (parts[1] === "partnerId") out[parts[0]].partnerId = String(r[1]).slice(0, MAX_ID);
    var type = /^(\w+)Goal$/.exec(parts[1]);
    var n = Number(r[1]);
    if (type && KIDS[parts[0]].practices.indexOf(type[1]) >= 0 && isInt_(n) && n >= MIN_PRACTICE_GOAL && n <= MAX_PRACTICE_GOAL) {
      out[parts[0]].practiceGoals[type[1]] = n;
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
