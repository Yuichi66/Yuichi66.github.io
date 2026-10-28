// Parent dashboard: who studied how much, per subject and per day. Read only: it never changes or sends records.
// The page passes plain records: { date (the study day, midnight), at (time logged in ms, or null), subject, amount, tried, text }.
// amount: correct answers, or 1 for a passed book (0 if not passed). tried: 1 for every book. The counting can be tested on its own.
var Parent = (function () {
  "use strict";
  var SUBJECTS = {
    book: { name: "Books", unit: "books", color: "#eda100" },
    maths: { name: "TTRS", unit: "correct", color: "#2a78d6" },
    latin: { name: "Latin", unit: "correct", color: "#eb6834" },
    mymaths: { name: "MyMaths", unit: "correct", color: "#1baf7a" },
    french: { name: "French", unit: "correct", color: "#e87ba4" }
  };
  var CHART_DAYS = 14;
  var WEEK_DAYS = 7;
  var RECENT_COUNT = 20;
  var IDLE_DAYS = 2;
  var DAY_MS = 86400000;
  var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---------- counting (no page code) ----------
  function dayKey(d) { return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function midnight(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  // The day a record counts for: the half-term day the child picked (start + day, kept inside the half term).
  // A record logged after the half term (its day is stuck on the last one) counts on the day it was logged.
  // loggedMs is the time in the record's id; ids that are not real times (<= 1e12) give no time.
  function studyDay(loggedMs, day, start, dayCount) {
    var at = loggedMs > 1e12 ? loggedMs : null;
    var last = new Date(start.getFullYear(), start.getMonth(), start.getDate() + dayCount - 1);
    if (at && midnight(new Date(at)) > last) return { date: midnight(new Date(at)), at: at };
    var i = Math.max(0, Math.min(Number(day) || 0, dayCount - 1));
    return { date: new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), at: at };
  }
  // The last n days, oldest first, ending today.
  function lastDays(now, n) {
    var out = [], today = midnight(now);
    for (var i = n - 1; i >= 0; i--) out.push(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i));
    return out;
  }
  // A record shows study: some correct answers, or a book (passed or not).
  function counts(r) { return r.amount > 0 || r.tried > 0; }
  // { "2026-10-28": { book: 1, bookTried: 2, maths: 120, any: true } } for one child's records.
  function byDay(records) {
    var out = {};
    records.forEach(function (r) {
      var k = dayKey(r.date), x = out[k] = out[k] || {};
      x[r.subject] = (x[r.subject] || 0) + r.amount;
      if (r.subject === "book") x.bookTried = (x.bookTried || 0) + (r.tried || 0);
      if (counts(r)) x.any = true;
    });
    return out;
  }
  // Newest first: by study day, then by the time it was logged.
  function newer(a, b) { return (b.date - a.date) || ((b.at || 0) - (a.at || 0)); }
  function newestFirst(records, n) { return records.slice().sort(newer).slice(0, n); }
  // Totals for one child: today, the last 7 days, days with records in the last 7, the last record,
  // days since each subject was last done, and whether nothing was recorded today or yesterday.
  function kidStats(records, subjects, now) {
    var days = byDay(records);
    var sum = function (dates) {
      var o = { bookTried: 0 };
      subjects.forEach(function (s) { o[s] = 0; });
      dates.forEach(function (d) {
        var x = days[dayKey(d)] || {};
        subjects.forEach(function (s) { o[s] += x[s] || 0; });
        o.bookTried += x.bookTried || 0;
      });
      return o;
    };
    var week = lastDays(now, WEEK_DAYS);
    var since = {};
    subjects.forEach(function (s) {
      var last = newestFirst(records.filter(function (r) { return r.subject === s && counts(r); }), 1)[0];
      since[s] = last ? Math.round((midnight(now) - midnight(last.date)) / DAY_MS) : null;
    });
    var shown = records.filter(counts);
    return {
      today: sum([now]),
      week: sum(week),
      studiedDays: week.filter(function (d) { return (days[dayKey(d)] || {}).any; }).length,
      since: since,
      last: newestFirst(shown, 1)[0] || null,
      idle: shown.length > 0 && !lastDays(now, IDLE_DAYS).some(function (d) { return (days[dayKey(d)] || {}).any; })
    };
  }
  // Bars for one subject over the last CHART_DAYS days: [{ date, value }].
  function series(records, subject, now) {
    var days = byDay(records);
    return lastDays(now, CHART_DAYS).map(function (d) { return { date: d, value: (days[dayKey(d)] || {})[subject] || 0 }; });
  }

  // ---------- drawing ----------
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function dot(color) { var i = make("i", "pd-dot"); i.style.background = color; return i; }
  function shortDate(d) { return DAY_NAMES[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()]; }
  function clock(ms) { var d = new Date(ms); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  function when(r) { return shortDate(r.date) + (r.at ? " " + clock(r.at) : ""); }
  function num(n) { return Math.round(n).toLocaleString("en-GB"); }
  function daysAgo(n) { return n === null ? "never" : n === 0 ? "today" : n === 1 ? "yesterday" : n + " days ago"; }

  function amountText(s, totals) {
    var t = SUBJECTS[s].name + " " + num(totals[s]);
    if (s === "book" && totals.bookTried > totals.book) t += " (+" + (totals.bookTried - totals.book) + " not passed)";
    return t;
  }
  function statLine(label, totals, subjects) {
    var row = make("div", "pd-line");
    row.appendChild(make("span", "pd-label", label));
    subjects.forEach(function (s) {
      var cell = make("span", "pd-val");
      cell.appendChild(dot(SUBJECTS[s].color));
      cell.appendChild(document.createTextNode(amountText(s, totals)));
      row.appendChild(cell);
    });
    return row;
  }
  function card(kid, now, fresh) {
    var st = kidStats(kid.records, kid.subjects, now);
    var c = make("div", "pd-card");
    var head = make("div", "pd-head");
    head.appendChild(make("b", "", kid.name));
    head.appendChild(make("span", "pd-muted", st.last ? "Last record: " + when(st.last) : "No records yet"));
    c.appendChild(head);
    if (fresh && st.idle) c.appendChild(make("div", "pd-alert", "⚠ No records for " + IDLE_DAYS + " days"));
    c.appendChild(statLine("Today", st.today, kid.subjects));
    c.appendChild(statLine("Last 7 days", st.week, kid.subjects));
    c.appendChild(make("div", "pd-muted", "Studied on " + st.studiedDays + " of the last " + WEEK_DAYS + " days · " +
      kid.subjects.map(function (s) { return "Last " + SUBJECTS[s].name + ": " + daysAgo(st.since[s]); }).join(" · ")));
    kid.goals.forEach(function (g) { c.appendChild(make("div", "pd-goal", "🎯 " + g)); });
    return c;
  }
  // One subject's bars for one child: a single series on one axis from 0. Hover, focus or tap a bar for its day and value.
  function chart(kid, subject, now, tip) {
    var data = series(kid.records, subject, now);
    var max = Math.max.apply(null, data.map(function (p) { return p.value; }));
    var box = make("div", "pd-chart");
    var title = make("div", "pd-chart-title");
    title.appendChild(dot(SUBJECTS[subject].color));
    title.appendChild(document.createTextNode(SUBJECTS[subject].name + " · " + SUBJECTS[subject].unit + " per day · top " + num(max)));
    box.appendChild(title);
    var plot = make("div", "pd-plot");
    data.forEach(function (p) {
      var col = make("div", "pd-col");
      var label = shortDate(p.date) + ": " + num(p.value) + " " + SUBJECTS[subject].unit;
      col.setAttribute("tabindex", "0");
      col.setAttribute("role", "img");
      col.setAttribute("aria-label", label);
      var bar = make("div", "pd-bar");
      bar.style.height = max ? Math.max(p.value ? 3 : 0, p.value / max * 100) + "%" : "0";
      bar.style.background = SUBJECTS[subject].color;
      col.appendChild(bar);
      var show = function () { tip(col, label); };
      col.onmouseenter = show; col.onfocus = show; col.onclick = show;
      col.onmouseleave = col.onblur = function () { tip(null); };
      plot.appendChild(col);
    });
    box.appendChild(plot);
    var axis = make("div", "pd-axis");
    axis.appendChild(make("span", "", shortDate(data[0].date)));
    axis.appendChild(make("span", "", "Today"));
    box.appendChild(axis);
    return box;
  }
  function recentTable(kids) {
    var all = [];
    kids.forEach(function (k) { k.records.forEach(function (r) { all.push({ r: r, name: k.name }); }); });
    all.sort(function (a, b) { return newer(a.r, b.r); });
    var t = make("table", "pd-table");
    var hr = make("tr");
    ["Who", "Day", "What", "Amount"].forEach(function (h) { hr.appendChild(make("th", "", h)); });
    t.appendChild(hr);
    all.slice(0, RECENT_COUNT).forEach(function (x) {
      var tr = make("tr");
      tr.appendChild(make("td", "", x.name));
      tr.appendChild(make("td", "", when(x.r)));
      tr.appendChild(make("td", "", SUBJECTS[x.r.subject].name + (x.r.text ? " · " + x.r.text : "")));
      tr.appendChild(make("td", "pd-num", x.r.subject === "book" ? (x.r.amount ? "passed" : "not passed") : num(x.r.amount)));
      t.appendChild(tr);
    });
    return t;
  }
  // kids: [{ name, subjects, records, goals }]. sync: the page's "Shared · updated" text. fresh: records came from the sheet.
  function render(root, kids, now, sync, fresh) {
    root.innerHTML = "";
    var tipEl = make("div", "pd-tip");
    var tip = function (anchor, text) {
      if (!anchor) { tipEl.style.display = "none"; return; }
      tipEl.textContent = text;
      tipEl.style.display = "block";
      var a = anchor.getBoundingClientRect(), r = root.getBoundingClientRect();
      tipEl.style.left = Math.max(0, Math.min(r.width - tipEl.offsetWidth, a.left - r.left + a.width / 2 - tipEl.offsetWidth / 2)) + "px";
      tipEl.style.top = (a.top - r.top - 34) + "px";
    };
    root.appendChild(make("div", fresh ? "pd-muted" : "pd-alert", fresh ? sync : "⚠ Not loaded from the sheet yet: numbers may be missing. " + sync));
    var cards = make("div", "pd-cards");
    kids.forEach(function (k) { cards.appendChild(card(k, now, fresh)); });
    root.appendChild(cards);
    kids.forEach(function (k) {
      root.appendChild(make("h4", "pd-h", k.name + " · last " + CHART_DAYS + " days"));
      k.subjects.forEach(function (s) { root.appendChild(chart(k, s, now, tip)); });
    });
    root.appendChild(make("h4", "pd-h", "Latest " + RECENT_COUNT + " records"));
    root.appendChild(recentTable(kids));
    root.appendChild(tipEl);
    // A tap anywhere that is not a bar hides the day's number.
    root.onclick = function (ev) { if (!ev.target.closest || !ev.target.closest(".pd-col")) tip(null); };
  }

  return { SUBJECTS: SUBJECTS, studyDay: studyDay, dayKey: dayKey, lastDays: lastDays, byDay: byDay, kidStats: kidStats, series: series, newestFirst: newestFirst, render: render };
})();
if (typeof module !== "undefined") module.exports = Parent;
