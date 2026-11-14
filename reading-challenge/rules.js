// Rank steps and holiday events. No page code here, so it can be tested on its own.
var Rules = (function () {
  "use strict";
  var MAX_RANK = 20;
  // Books needed to reach rank r from rank r - 1: 3 at first, 10 for the last step.
  function booksForRank(r) { return Math.max(3, Math.ceil(r / 2)); }
  // Rank after `books` passed books in all, counting on from where the child was when the rule started.
  function rankFromBooks(start, books) {
    var rank = start.rank, left = books - start.books;
    while (rank < MAX_RANK && left >= booksForRank(rank + 1)) {
      left -= booksForRank(rank + 1);
      rank++;
    }
    return rank;
  }
  function booksToNextRank(start, books) {
    var rank = rankFromBooks(start, books);
    if (rank >= MAX_RANK) return null;
    var used = 0;
    for (var r = start.rank + 1; r <= rank; r++) used += booksForRank(r);
    return booksForRank(rank + 1) - (books - start.books - used);
  }
  // The calendar day in the UK (the family's day), whatever zone the device is set to: YYYY-MM-DD.
  var londonDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
  function dayKey(ms) {
    var p = {};
    londonDay.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return p.year + "-" + p.month + "-" + p.day;
  }
  var DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;
  // Inside a holiday event (both dates included)? Dates must be YYYY-MM-DD text.
  function inEvent(ms, ev) {
    if (!ev || !DATE_TEXT.test(ev.start) || !DATE_TEXT.test(ev.end)) return false;
    var k = dayKey(ms);
    return k >= ev.start && k <= ev.end;
  }
  // Next target for a running total, in steps of `step` (the child's goal): 9344 in steps of 2500 -> next 10000, 656 left.
  // The bar shows how far the total is through the current step (0-100).
  function nextTarget(done, step) {
    done = Math.max(0, Number(done) || 0);
    step = Math.max(1, Number(step) || 1);
    var next = (Math.floor(done / step) + 1) * step;
    return { done: done, next: next, left: next - done, pct: Math.floor((done - (next - step)) / step * 100) };
  }
  // How far a child is from their current rank to the next one, in books: { have, need } (need 0 at the top rank).
  function rankStep(start, books) {
    var rank = rankFromBooks(start, books);
    if (rank >= MAX_RANK) return { have: 0, need: 0 };
    var need = booksForRank(rank + 1);
    return { have: need - booksToNextRank(start, books), need: need };
  }
  // Inside any of several holiday event windows (the current one and every past one)?
  function inAnyEvent(ms, windows) {
    for (var i = 0; i < (windows || []).length; i++) if (inEvent(ms, windows[i])) return true;
    return false;
  }
  return { MAX_RANK: MAX_RANK, booksForRank: booksForRank, rankFromBooks: rankFromBooks, booksToNextRank: booksToNextRank, nextTarget: nextTarget, rankStep: rankStep, dayKey: dayKey, inEvent: inEvent, inAnyEvent: inAnyEvent };
})();
if (typeof module !== "undefined") module.exports = Rules;
