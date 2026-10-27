// Experience, levels, level-up evolutions and Mega Stones. No page code here, so it can be tested on its own.
// Uses EVO_DATA from evo-data.js.
var Growth = (function () {
  "use strict";
  var DATA = typeof EVO_DATA !== "undefined" ? EVO_DATA : require("./evo-data.js");
  var EXP_PER_LEVEL = 100;
  var MAX_LEVEL = 100;
  var BOOK_PASS_RATE = 0.8;
  // Experience for each kind of record (times tables count most, to make them worth doing).
  var EXP = { maths: 2, book: 300, latin: 0.5, mymaths: 1 };

  // Experience one record gives to the partner saved with it (0 for a book that was not passed).
  function expOf(x) {
    if (x.type === "maths") return Math.floor(x.correct * EXP.maths);
    if (x.type === "latin") return Math.floor(x.correct * EXP.latin);
    if (x.type === "mymaths") return Math.floor(x.correct * EXP.mymaths);
    if (x.type === "read") return x.total && x.score / x.total >= BOOK_PASS_RATE ? EXP.book : 0;
    return 0;
  }

  function info(form) { return DATA[form] || null; }
  // Lowest level a Pokémon of this form can be (5 for a first stage).
  function minLevel(form) { var d = info(form); return d ? d[2] : 5; }
  function nameOf(form) { var d = info(form); return d ? d[0] : ""; }

  // startForm: the form before any level-up or Mega Stone evolution. exp: all experience it was given.
  function levelOf(startForm, exp) {
    return Math.min(MAX_LEVEL, minLevel(startForm) + Math.floor(exp / EXP_PER_LEVEL));
  }
  // Experience gained inside the current level, and how much the level needs (null at the top level).
  function progress(startForm, exp) {
    if (levelOf(startForm, exp) >= MAX_LEVEL) return null;
    return { have: exp % EXP_PER_LEVEL, need: EXP_PER_LEVEL };
  }

  // Evolutions of this form: [{ to, name, level }]. Empty for a final form, a Mega or a special form.
  function nextOf(form) {
    var d = info(form);
    if (!d) return [];
    return d[3].map(function (n) { return { to: n[0], name: n[1], level: n[2] }; });
  }
  // Evolutions it can take now at this level.
  function readyOf(form, level) {
    return nextOf(form).filter(function (n) { return level >= n.level; });
  }
  // The lowest level at which it can evolve next (null if it never evolves by level).
  function evolvesAt(form) {
    var n = nextOf(form);
    return n.length ? Math.min.apply(null, n.map(function (x) { return x.level; })) : null;
  }
  // Mega / Gigantamax forms a Mega Stone can turn it into: [{ to, name }].
  function stoneOf(form) {
    var d = info(form);
    if (!d) return [];
    return d[4].map(function (n) { return { to: n[0], name: n[1] }; });
  }

  return {
    EXP: EXP, EXP_PER_LEVEL: EXP_PER_LEVEL, MAX_LEVEL: MAX_LEVEL,
    expOf: expOf, minLevel: minLevel, nameOf: nameOf, levelOf: levelOf, progress: progress,
    nextOf: nextOf, readyOf: readyOf, evolvesAt: evolvesAt, stoneOf: stoneOf
  };
})();
if (typeof module !== "undefined") module.exports = Growth;
