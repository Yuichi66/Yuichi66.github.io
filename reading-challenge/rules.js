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
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  // Inside a holiday event (both dates included)?
  function inEvent(ms, ev) {
    if (!ev || !ev.start || !ev.end) return false;
    var k = dayKey(ms);
    return k >= ev.start && k <= ev.end;
  }
  return { MAX_RANK: MAX_RANK, booksForRank: booksForRank, rankFromBooks: rankFromBooks, booksToNextRank: booksToNextRank, dayKey: dayKey, inEvent: inEvent };
})();
if (typeof module !== "undefined") module.exports = Rules;
