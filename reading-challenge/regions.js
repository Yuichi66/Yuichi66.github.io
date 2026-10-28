// Regions open one after another: the next one opens when a child has half the families of the last open one.
// Uses DEX_DATA (dex-data.js) and EVO_DATA (evo-data.js). No page code here, so it can be tested on its own.
var Regions = (function () {
  "use strict";
  var DEX = typeof DEX_DATA !== "undefined" ? DEX_DATA : require("./dex-data.js");
  var EVO = typeof EVO_DATA !== "undefined" ? EVO_DATA : require("./evo-data.js");
  var NAMES = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];
  var OPEN_SHARE = 0.5;

  // Family (evolution chain) -> { region: earliest region of its members, members: non-legendary species, first stage first }
  var FAMILIES = (function () {
    var out = {};
    Object.keys(DEX).forEach(function (k) {
      var d = DEX[k], f = d[2];
      if (!out[f]) out[f] = { region: d[3], members: [] };
      out[f].region = Math.min(out[f].region, d[3]);
      if (!d[5]) out[f].members.push(+k);
    });
    Object.keys(out).forEach(function (f) {
      out[f].members.sort(function (a, b) { return DEX[a][4] - DEX[b][4] || a - b; });
      // A family of only legendary or mythical Pokémon is not counted or caught yet.
      if (!out[f].members.length) delete out[f];
    });
    return out;
  })();

  // Family of any form in a box (a Mega or regional form counts as its species).
  function familyOf(form) {
    var species = EVO[form] ? EVO[form][1] : form;
    return DEX[species] ? DEX[species][2] : null;
  }
  // owned: family -> true. Returns [{ name, have, total }] for every region, and how many are open.
  function progress(owned) {
    var rows = NAMES.map(function (n) { return { name: n, have: 0, total: 0 }; });
    Object.keys(FAMILIES).forEach(function (f) {
      var r = rows[FAMILIES[f].region];
      r.total++;
      if (owned[f]) r.have++;
    });
    var open = 1;
    while (open < NAMES.length && toOpen(rows[open - 1]) === 0) open++;
    return { rows: rows, open: open };
  }
  // How many more families a region row needs before the next region opens (0 = open).
  function toOpen(row) { return Math.max(0, Math.ceil(row.total * OPEN_SHARE) - row.have); }
  // Pokémon that can be caught now: for each family in an open region the child does not have,
  // its earliest stage that lives in an open region. Every open family again once all are owned.
  function candidates(owned) {
    var open = progress(owned).open;
    function pickable(skipOwned) {
      var list = [];
      Object.keys(FAMILIES).forEach(function (f) {
        var fam = FAMILIES[f];
        if (fam.region >= open || (skipOwned && owned[f])) return;
        for (var i = 0; i < fam.members.length; i++) {
          if (DEX[fam.members[i]][3] < open) { list.push(fam.members[i]); return; }
        }
      });
      return list.sort(function (a, b) { return a - b; });
    }
    var fresh = pickable(true);
    return fresh.length ? fresh : pickable(false);
  }
  // Legendary and mythical Pokémon of the open regions that start their family, and whose family the child does not have.
  function legends(owned) {
    var open = progress(owned).open;
    return Object.keys(DEX).map(Number).filter(function (d) {
      var x = DEX[d];
      return x[5] && x[4] === 0 && x[3] < open && !owned[x[2]];
    }).sort(function (a, b) { return a - b; });
  }
  // How common a species is (PokeAPI catch rate: 3 rare ... 255 common).
  function rate(dex) { return DEX[dex] ? DEX[dex][6] || 1 : 1; }
  // [name, type, dex] of a species, for Pokémon that are not in the first 100.
  function info(dex) { var d = DEX[dex]; return d ? [d[0], d[1], dex] : null; }

  return { NAMES: NAMES, familyOf: familyOf, progress: progress, toOpen: toOpen, candidates: candidates, legends: legends, rate: rate, info: info };
})();
if (typeof module !== "undefined") module.exports = Regions;
