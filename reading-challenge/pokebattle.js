// Pokémon Battle: the week after a Beyblade Battle, the children's partner Pokémon battle instead. A full-screen
// canvas at the phone's full resolution (official artwork), moves drawn by their type, HP bars, music and sound made in
// the browser. The battle is a script made from the seed and the scores: the lowest faints first, the winner
// keeps some HP, so every phone shows the same battle and it always ends as the scores say. Needs battle.js.
// Each Pokémon uses its real moves (pokemoves.js; dex = its form, species = its species).
// PokeBattle.play({ fighters: [{ name, monName, level, type, dex, species, img, score, color }], seed, note, onEnd })
var PokeBattle = (function () {
  "use strict";
  var K = BeyBattle.kit, clamp = K.clamp, ease = K.ease, pop = K.pop;

  // ---------- moves by type: name, colours, how it looks ----------
  var MOVES = {
    Fire: ["Flamethrower", "#ff7a1a", "#ffd23f", "beam"], Water: ["Hydro Pump", "#2f8cff", "#bfe6ff", "beam"],
    Electric: ["Thunderbolt", "#ffe23d", "#fffbd0", "bolt"], Grass: ["Leaf Storm", "#3ccf5a", "#c8ff9e", "leaves"],
    Ice: ["Ice Beam", "#7fe7ff", "#ffffff", "beam"], Psychic: ["Psychic", "#ff5fb4", "#ffd0ec", "rings"],
    Ghost: ["Shadow Ball", "#7b4bd6", "#d2b8ff", "orb"], Dark: ["Dark Pulse", "#4b3a66", "#b49cff", "rings"],
    Dragon: ["Dragon Pulse", "#5a5cff", "#bdbaff", "orb"], Fairy: ["Moonblast", "#ff9ee0", "#fff0fa", "orb"],
    Poison: ["Sludge Bomb", "#a548d6", "#e7b8ff", "orb"], Fighting: ["Close Combat", "#e3350d", "#ffd0b0", "dash"],
    Normal: ["Hyper Beam", "#f2efe6", "#ffffff", "beam"], Rock: ["Rock Slide", "#b8915a", "#eed9b5", "rocks"],
    Ground: ["Earthquake", "#c8a24a", "#f3e1a8", "quake"], Steel: ["Flash Cannon", "#b9c6d6", "#ffffff", "beam"],
    Bug: ["X-Scissor", "#9bc53d", "#e8ffb0", "dash"], Flying: ["Air Slash", "#9fd4ff", "#ffffff", "slash"]
  };
  function moveOf(type) { return MOVES[type] || MOVES.Normal; }
  // Each Pokémon's real moves (pokemoves.js): own = [[name, type, 1 physical / 2 special, power], ...] strongest first;
  // big = the move for a critical hit or a knock-out (a Gigantamax form's G-Max move, else its strongest move).
  // A Pokémon with no attacking move uses Struggle, as in the games.
  function movesOf(f) {
    var P = typeof POKE_MOVES === "undefined" ? null : POKE_MOVES;
    if (!P) { var m = moveOf(f.type); return { own: [[m[0], MOVES[f.type] ? f.type : "Normal", 2, 90]], big: [m[0], MOVES[f.type] ? f.type : "Normal", 2, 90] }; }
    var own = (P.by[f.dex] || P.by[f.species] || []).map(function (i) { return P.list[i]; });
    if (!own.length) own = [["Struggle", "Normal", 1, 50]];
    return { own: own, big: P.gmax[f.dex] !== undefined ? P.list[P.gmax[f.dex]] : own[0] };
  }
  // Which move each turn (own random numbers from the seed, so the same on every phone): the big move for a critical
  // hit or a knock-out, otherwise one of its moves, not the same one twice in a row.
  function pickMoves(turns, sets, seed) {
    var mr = K.rng("poke-moves-" + String(seed || "battle")), last = {};
    return turns.map(function (tu) {
      var set = sets[tu.att], pick;
      if (tu.crit || tu.ko) pick = set.big;
      else {
        var c = set.own.filter(function (m) { return m !== last[tu.att]; });
        if (!c.length) c = set.own;
        pick = c[Math.floor(mr() * c.length)];
      }
      last[tu.att] = pick;
      return pick;
    });
  }
  // How a move looks: [name, colour, colour, look, type]; colours from its type, the look from its type and name.
  function looksOf(m) {
    var name = m[0], type = MOVES[m[1]] ? m[1] : "Normal", base = MOVES[type], look;
    if (type === "Electric") look = "bolt";
    else if (type === "Rock") look = "rocks";
    else if (type === "Ground") look = "quake";
    else if (type === "Grass" && !/Whip|Slam|Punch|Hammer|Horn|Drum|Knot/.test(name)) look = "leaves";
    else if (/Slash|Claw|Scissor|Blade|Cutter|Cut$|Wing|Fang|Bite|Crunch|Razor|Talon/.test(name)) look = "slash";
    else if (m[2] === 1 && !/^G-Max/.test(name)) look = "dash";
    else look = base[3];
    return [name, base[1], base[2], look, type];
  }

  // ---------- the script: who attacks whom, when, for how much ----------
  var START = 5.2, TURN = 1.45, HIT = 0.7;
  function script(fighters, res, r) {
    var n = fighters.length, hp = fighters.map(function () { return 100; }), turns = [];
    var losers = [], koTurn = {};
    res.kos.forEach(function (g) { g.forEach(function (i) { losers.push(i); }); });
    // knock-out turns: the lowest group first; each loser gets two turns of hits before
    var k = 3;
    losers.forEach(function (i) { koTurn[i] = k; k += 3; });
    var total = losers.length ? k - 1 : 6;
    var alive = function (i, t) { return koTurn[i] === undefined || koTurn[i] >= t; };
    for (var t = 0; t < total; t++) {
      var target = -1, dmg = 0;
      losers.forEach(function (i) { if (koTurn[i] === t) target = i; });
      var others = function (tg) { return fighters.map(function (f, i) { return i; }).filter(function (i) { return i !== tg && alive(i, t) && koTurn[i] !== t; }); };
      if (target >= 0) dmg = hp[target];
      else {
        var cand = fighters.map(function (f, i) { return i; }).filter(function (i) { return alive(i, t) && koTurn[i] !== t; });
        target = cand[Math.floor(r() * cand.length)];
        var isWinner = res.winners.indexOf(target) >= 0;
        var floor = isWinner ? 38 : 14;
        dmg = Math.round(Math.min(14 + r() * 18, hp[target] - floor));
        if (dmg < 4) dmg = 0;
      }
      var att = others(target);
      if (!att.length) continue;
      // the stronger one hits harder, so prefer high scores as attackers
      att.sort(function (a, b) { return fighters[b].score - fighters[a].score; });
      var a = r() < 0.6 ? att[0] : att[Math.floor(r() * att.length)];
      hp[target] = Math.max(0, hp[target] - dmg);
      turns.push({ at: START + t * TURN, att: a, tgt: target, dmg: dmg, hpAfter: hp[target], ko: hp[target] === 0, crit: dmg >= 26 });
    }
    var end = turns.length ? turns[turns.length - 1].at + TURN + 0.8 : START + 2;
    return { turns: turns, winAt: end };
  }

  // ---------- extra sounds on top of battle.js's ----------
  function cry(s, pitch) { s.tone("sawtooth", pitch, 0.12, 0.28, 0, pitch * 1.6); s.tone("square", pitch * 1.5, 0.06, 0.22, 0.08, pitch * 0.9); }
  function moveSound(s, look) {
    if (look === "bolt") { for (var i = 0; i < 6; i++) s.tone("square", 180 + Math.random() * 900, 0.08, 0.06, i * 0.05); s.hiss(4000, 0.8, 0.4, 0.35); }
    else if (look === "beam") s.hiss(600, 0.6, 0.55, 0.6, 2400);
    else if (look === "leaves" || look === "slash") { s.hiss(2500, 2, 0.35, 0.25); s.hiss(3500, 2, 0.3, 0.25); }
    else if (look === "quake" || look === "rocks") { s.tone("sine", 70, 0.8, 0.7, 0, 35); s.hiss(300, 0.5, 0.6, 0.6); }
    else if (look === "dash") s.whoosh();
    else s.tone("sine", 300, 0.3, 0.5, 0, 900);
  }
  function hitSound(s, big) { s.hiss(1200, 0.7, big ? 0.9 : 0.6, 0.18); s.tone("square", big ? 110 : 160, 0.5, 0.18, 0, 60); }
  function faintSound(s) { s.tone("square", 520, 0.18, 0.9, 0, 90); s.tone("triangle", 260, 0.25, 0.9, 0, 45); }
  // A short battle tune: bass and arpeggio, scheduled ahead on the audio clock.
  function Music(s) {
    this.s = s; this.on = false; this.step = 0; this.timer = 0;
  }
  Music.prototype.start = function () {
    var s = this.s;
    if (!s.ctx || this.on) return;
    this.on = true; this.next = s.ctx.currentTime + 0.05; this.step = 0;
    var self = this, bass = [110, 110, 131, 110, 147, 110, 131, 98], lead = [440, 523, 659, 523, 587, 698, 659, 494];
    var beat = 60 / 150 / 2;
    function tick() {
      if (!self.on) return;
      // after the phone paused the timer (app switched), carry on from now instead of playing every missed beat at once
      if (self.next < s.ctx.currentTime) self.next = s.ctx.currentTime + 0.05;
      while (self.next < s.ctx.currentTime + 0.3) {
        var i = self.step % 8, bar = Math.floor(self.step / 8) % 2;
        var when = self.next - s.ctx.currentTime;
        s.tone("triangle", bass[i] * (bar ? 1.122 : 1), 0.16, beat * 0.9, when);
        if (self.step % 2 === 0) s.tone("square", lead[(i + bar * 2) % 8], 0.035, beat * 1.6, when);
        if (i % 4 === 0) s.hiss(8000, 1, 0.08, 0.05);
        self.step++; self.next += beat;
      }
      self.timer = setTimeout(tick, 80);
    }
    tick();
  };
  Music.prototype.stop = function () { this.on = false; clearTimeout(this.timer); };

  function play(opts) {
    K.addStyle();
    var fighters = opts.fighters, n = fighters.length, res = BeyBattle.result(fighters.map(function (f) { return f.score; }));
    var root = document.createElement("div");
    root.className = "bb"; root.id = "pokeBattle";
    root.setAttribute("data-phase", "intro");
    root.setAttribute("data-fighters", fighters.map(function (f) { return f.name + ":" + (f.monName || "-"); }).join(" "));
    root.setAttribute("data-types", fighters.map(function (f) { return f.type; }).join(" "));
    var sets = fighters.map(movesOf);
    root.setAttribute("data-moves", fighters.map(function (f, i) {
      return f.name + ":" + sets[i].own.map(function (m) { return m[0]; }).join("/") + (sets[i].big !== sets[i].own[0] ? "+" + sets[i].big[0] : "");
    }).join(" | "));
    var canvas = document.createElement("canvas"), close = document.createElement("button"), end = document.createElement("div");
    close.className = "bb-x"; close.type = "button"; close.textContent = "✕"; close.setAttribute("aria-label", "Close");
    end.className = "bb-end";
    root.appendChild(canvas); root.appendChild(close); root.appendChild(end);
    document.body.appendChild(root);
    var g = canvas.getContext("2d"), sound = new K.Sound(), music = new Music(sound), font = getComputedStyle(document.body).fontFamily;
    var W = 0, H = 0, DPR = 1, raf = 0, done = false, bgCache = null;
    function size() {
      DPR = Math.min(window.devicePixelRatio || 1, 3);
      W = root.clientWidth; H = root.clientHeight;
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    }
    size();
    window.addEventListener("resize", size);
    // Official artwork (big and clear); the small sprite if that fails; a Poké Ball if nothing loads.
    var pics = fighters.map(function (f) {
      if (!f.img) return null;
      var im = new Image(), tries = [f.img].concat(f.img2 ? [f.img2] : []), i = 0;
      im.onerror = function () { i++; if (i < tries.length) im.src = tries[i]; };
      im.src = tries[0];
      return im;
    });
    function ready(im) { return im && im.complete && im.naturalWidth > 0; }

    var st;
    function reset() {
      var r = K.rng("poke-" + String(opts.seed || "battle"));
      var sc = script(fighters, res, r);
      var picks = pickMoves(sc.turns, sets, opts.seed);
      sc.turns.forEach(function (tu, k) { tu.mv = looksOf(picks[k]); });
      st = { t: 0, r: r, turns: sc.turns, winAt: sc.winAt, done: {}, hp: fighters.map(function () { return 100; }), shown: fighters.map(function () { return 100; }),
        fx: [], parts: [], shake: 0, flash: 0, msg: "", msgAt: 0, fainted: {}, won: false, sent: 0, confetti: [] };
      root.setAttribute("data-phase", "intro"); root.removeAttribute("data-out");
      end.className = "bb-end"; end.innerHTML = "";
      music.stop();
    }

    // ---------- layout: where each Pokémon stands (portrait: a triangle; wide: a row) ----------
    function spot(i) {
      var wide = W > H * 1.1, S = wide ? Math.min(W * 0.2, H * 0.34) : Math.min(W * 0.4, H * 0.21);
      var pos = n === 3 ? (wide ? [[0.2, 0.62], [0.5, 0.5], [0.8, 0.62]] : [[0.27, 0.66], [0.5, 0.42], [0.73, 0.66]]) : [[0.3, 0.6], [0.7, 0.6]];
      var p = pos[i] || [0.5, 0.5], back = !wide && i === 1;
      return { x: p[0] * W, y: p[1] * H, s: S * (back ? 0.86 : 1) };
    }
    function say(text) { st.msg = text; st.msgAt = st.t; }

    // ---------- simulation step ----------
    function step(dt) {
      var s = st, t = s.t;
      // send out: one Pokémon every 0.55 s from 1.4 s
      while (s.sent < n && t >= 1.4 + s.sent * 0.55) {
        var f = fighters[s.sent];
        say(f.name + " sends out " + (f.monName || "a Pokémon") + "!");
        sound.whoosh(); cry(sound, 260 + 90 * s.sent);
        s.sent++;
      }
      if (t >= START - 0.6 && !s.music) { s.music = true; music.start(); root.setAttribute("data-phase", "battle"); }
      s.turns.forEach(function (tu, k) {
        if (s.done[k] === undefined && t >= tu.at) {
          s.done[k] = 0;
          var mv = tu.mv;
          say(fighters[tu.att].name + "'s " + (fighters[tu.att].monName || "Pokémon") + " used " + mv[0] + "!");
          moveSound(sound, mv[3]);
          s.fx.push({ k: k, tu: tu, mv: mv, at: tu.at });
        }
        if (s.done[k] === 0 && t >= tu.at + HIT) {
          s.done[k] = 1;
          s.hp[tu.tgt] = tu.hpAfter;
          hitSound(sound, tu.crit || tu.ko);
          s.shake = Math.max(s.shake, tu.ko ? 0.05 : tu.crit ? 0.03 : 0.018);
          if (tu.mv[4] === "Electric" || tu.ko) s.flash = 1;
          burst(tu.tgt, tu.mv, tu.crit || tu.ko ? 46 : 26);
          if (tu.crit && !tu.ko) s.texts = (s.texts || []).concat([{ text: "Critical hit!", at: t, i: tu.tgt }]);
          if (tu.dmg === 0) say("It missed!");
        }
        if (s.done[k] === 1 && tu.ko && t >= tu.at + HIT + 0.55) {
          s.done[k] = 2;
          s.fainted[tu.tgt] = t;
          say(fighters[tu.tgt].name + "'s " + (fighters[tu.tgt].monName || "Pokémon") + " fainted!");
          faintSound(sound);
          root.setAttribute("data-out", Object.keys(s.fainted).map(function (i) { return fighters[i].name; }).join(" "));
        }
      });
      // HP bars slide down to the new HP
      s.shown = s.shown.map(function (v, i) { return v > s.hp[i] ? Math.max(s.hp[i], v - 70 * dt) : s.hp[i]; });
      s.parts.forEach(function (p) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt; p.rot += (p.vr || 0) * dt; });
      s.parts = s.parts.filter(function (p) { return p.age < p.life; });
      s.shake = Math.max(0, s.shake - dt * 0.15);
      s.flash = Math.max(0, s.flash - dt * 3);
      if (!s.won && t >= s.winAt) {
        s.won = true;
        music.stop(); sound.fanfare();
        root.setAttribute("data-phase", "end");
        var names = res.winners.map(function (i) { return fighters[i].name; });
        say(names.length === n ? "What a battle! Everyone wins!" : names.join(" & ") + (names.length > 1 ? " win" : " wins") + " the battle!");
        showEnd();
        for (var c = 0; c < 140; c++) s.confetti.push({ x: s.r(), y: -s.r() * 0.6, vx: (s.r() - 0.5) * 0.08, vy: 0.18 + s.r() * 0.25, rot: s.r() * 6, vr: (s.r() - 0.5) * 8, col: ["#ffcb05", "#e3350d", "#2a75bb", "#2fb36d", "#fff", "#7b3fe4"][c % 6] });
      }
      if (s.won) s.confetti.forEach(function (c2) { c2.x += c2.vx * dt; c2.y += c2.vy * dt; c2.rot += c2.vr * dt; if (c2.y > 1.1) { c2.y = -0.05; c2.x = s.r(); } });
    }
    // particles at the target when a move hits (positions in screen units, made at hit time)
    function burst(i, mv, count) {
      var p = spot(i);
      for (var k = 0; k < count; k++) {
        var a = st.r() * 6.283, sp = p.s * (0.8 + st.r() * 2.2);
        st.parts.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - p.s * 0.6, g: p.s * 2.2, age: 0, life: 0.45 + st.r() * 0.45,
          size: p.s * (0.03 + st.r() * 0.05), col: k % 3 ? mv[1] : mv[2], rot: st.r() * 6, vr: (st.r() - 0.5) * 12, star: mv[3] === "dash" || mv[3] === "rocks" });
      }
    }

    // ---------- drawing ----------
    function drawField() {
      var sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#5ec8ff"); sky.addColorStop(0.45, "#bdeaff"); sky.addColorStop(0.46, "#8fd16a"); sky.addColorStop(1, "#3f8f3a");
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      // sun glow and soft clouds
      var sun = g.createRadialGradient(W * 0.8, H * 0.08, 0, W * 0.8, H * 0.08, W * 0.5);
      sun.addColorStop(0, "rgba(255,255,220,.9)"); sun.addColorStop(1, "rgba(255,255,220,0)");
      g.fillStyle = sun; g.fillRect(0, 0, W, H * 0.46);
      g.fillStyle = "rgba(255,255,255,.85)";
      [[0.18, 0.12, 0.12], [0.3, 0.1, 0.09], [0.62, 0.2, 0.1], [0.72, 0.18, 0.08]].forEach(function (c) {
        g.beginPath(); g.ellipse(c[0] * W, c[1] * H, c[2] * W, c[2] * W * 0.42, 0, 0, 6.283); g.fill();
      });
      // grass stripes
      g.fillStyle = "rgba(255,255,255,.07)";
      for (var k = 0; k < 7; k++) { var y = H * (0.48 + k * 0.08); g.fillRect(0, y, W, H * 0.035); }
      // platforms under each Pokémon
      for (var i = 0; i < n; i++) {
        var p = spot(i), pw = p.s * 0.75;
        var pl = g.createRadialGradient(p.x, p.y + p.s * 0.42, pw * 0.1, p.x, p.y + p.s * 0.42, pw);
        pl.addColorStop(0, "#f4e6b3"); pl.addColorStop(0.7, "#d6bf78"); pl.addColorStop(1, "rgba(120,100,50,.0)");
        g.fillStyle = pl; g.beginPath(); g.ellipse(p.x, p.y + p.s * 0.42, pw, pw * 0.3, 0, 0, 6.283); g.fill();
        g.strokeStyle = "rgba(255,255,255,.6)"; g.lineWidth = Math.max(1.5, p.s * 0.012);
        g.beginPath(); g.ellipse(p.x, p.y + p.s * 0.42, pw * 0.8, pw * 0.24, 0, 0, 6.283); g.stroke();
      }
    }
    function drawBall(x, y, rr, ang) {
      g.save(); g.translate(x, y); g.rotate(ang);
      g.fillStyle = "#e3350d"; g.beginPath(); g.arc(0, 0, rr, Math.PI, 0); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(0, 0, rr, 0, Math.PI); g.fill();
      g.strokeStyle = "#111"; g.lineWidth = rr * 0.16;
      g.beginPath(); g.arc(0, 0, rr, 0, 6.283); g.stroke();
      g.beginPath(); g.moveTo(-rr, 0); g.lineTo(rr, 0); g.stroke();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(0, 0, rr * 0.3, 0, 6.283); g.fill(); g.stroke();
      g.restore();
    }
    function drawMon(i) {
      var s = st, t = s.t, f = fighters[i], p = spot(i), sendAt = 1.4 + i * 0.55;
      if (t < sendAt) return;
      var k = t - sendAt;
      // the Poké Ball flies in, opens with a flash, and the Pokémon grows out of the light
      if (k < 0.45) {
        var q = ease(k / 0.45), sx = W / 2 + (p.x - W / 2) * q, sy = H * 1.05 + (p.y - H * 1.05) * q - Math.sin(q * Math.PI) * p.s * 0.9;
        drawBall(sx, sy, p.s * 0.09, k * 14);
        return;
      }
      var grow = ease((k - 0.45) / 0.35), x = p.x, y = p.y, sz = p.s, alpha = 1;
      // attack lunge, being hit, fainting, winning
      s.fx.forEach(function (e) {
        var d = t - e.at;
        if (e.tu.att === i && d >= 0 && d < 0.4) { var tg = spot(e.tu.tgt), l = Math.sin(d / 0.4 * Math.PI) * (e.mv[3] === "dash" ? 0.55 : 0.12); x += (tg.x - p.x) * l; y += (tg.y - p.y) * l; }
        if (e.tu.tgt === i && d >= HIT && d < HIT + 0.45) { x += Math.sin(d * 70) * sz * 0.05 * (1 - (d - HIT) / 0.45); }
      });
      var fa = s.fainted[i];
      if (fa !== undefined) { var fk = clamp((t - fa) / 0.8, 0, 1); y += fk * sz * 0.5; alpha = 1 - fk; if (alpha <= 0) return; }
      if (s.won && res.winners.indexOf(i) >= 0) y -= Math.abs(Math.sin((t - s.winAt) * 5)) * sz * 0.12;
      var hitNow = s.fx.some(function (e) { var d = t - e.at; return e.tu.tgt === i && d >= HIT && d < HIT + 0.3 && Math.floor(d * 20) % 2 === 0; });
      g.save();
      g.globalAlpha = alpha;
      // shadow
      g.fillStyle = "rgba(0,0,0,.22)"; g.beginPath(); g.ellipse(p.x, p.y + sz * 0.42, sz * 0.4, sz * 0.1, 0, 0, 6.283); g.fill();
      var w = sz * grow, im = pics[i];
      g.translate(x, y - sz * 0.05);
      if (i === 1 && W <= H * 1.1) g.scale(-1, 1); // the one at the back faces the others
      if (ready(im)) {
        if (grow < 1) { g.shadowColor = "#fff"; g.shadowBlur = sz * 0.5 * (1 - grow); }
        g.drawImage(im, -w / 2, -w / 2, w, w);
        // blink when hit: the picture again, added on top (only the Pokémon lights up; its clear background adds nothing)
        if (hitNow) { g.globalCompositeOperation = "lighter"; g.globalAlpha = alpha * 0.85; g.drawImage(im, -w / 2, -w / 2, w, w); g.drawImage(im, -w / 2, -w / 2, w, w); }
      } else drawBall(0, 0, w * 0.3, 0);
      g.restore();
      if (k < 0.8) { // the white flash as it comes out
        g.save(); g.globalCompositeOperation = "lighter";
        var fl = 1 - clamp((k - 0.45) / 0.35, 0, 1), gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz * 0.7);
        gr.addColorStop(0, "rgba(255,255,255," + fl + ")"); gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, sz * 0.7, 0, 6.283); g.fill(); g.restore();
      }
    }
    // name, Pokémon, level and HP bar above each Pokémon
    function drawCard(i) {
      var s = st, f = fighters[i], p = spot(i);
      if (s.t < 1.4 + i * 0.55 + 0.6) return;
      var fa = s.fainted[i], a = fa !== undefined ? 1 - clamp((s.t - fa - 0.6) / 0.6, 0, 0.55) : 1;
      // three lines: child and level / Pokémon / HP bar
      var cw = Math.min(p.s * 1.15, W * 0.45), ch = cw * 0.5, x = p.x - cw / 2, y = p.y - p.s * 0.62 - ch;
      g.save(); g.globalAlpha = a;
      g.fillStyle = "rgba(255,255,255,.94)"; g.strokeStyle = "#1d1d1f"; g.lineWidth = Math.max(2, cw * 0.02);
      round(x, y, cw, ch, ch * 0.18); g.fill(); g.stroke();
      g.fillStyle = f.color; round(x, y, cw * 0.06, ch, ch * 0.18); g.fill();
      var fs = ch * 0.24;
      g.textBaseline = "top"; g.textAlign = "left";
      g.font = "bold " + fs + "px " + font; g.fillStyle = f.color;
      g.fillText(f.name, x + cw * 0.1, y + ch * 0.08);
      if (f.level) { g.textAlign = "right"; g.fillStyle = "#1d1d1f"; g.fillText("Lv." + f.level, x + cw * 0.94, y + ch * 0.08); }
      g.textAlign = "left"; g.fillStyle = "#1d1d1f";
      var ms = fs * 0.8;
      g.font = "bold " + ms + "px " + font;
      var mw = g.measureText(f.monName || "").width, room = cw * 0.84;
      if (mw > room) ms *= room / mw; // shrink a long name to fit instead of cutting it
      g.font = "bold " + ms + "px " + font;
      g.fillText(f.monName || "", x + cw * 0.1, y + ch * 0.38);
      // HP bar
      var bx = x + cw * 0.1, by = y + ch * 0.66, bw = cw * 0.84, bh = ch * 0.2, v = s.shown[i] / 100;
      g.fillStyle = "#3a3a3a"; round(bx, by, bw, bh, bh / 2); g.fill();
      g.fillStyle = v > 0.5 ? "#33d16b" : v > 0.2 ? "#ffcb05" : "#ff3b2f";
      if (v > 0) { round(bx + bh * 0.15, by + bh * 0.15, Math.max(bh * 0.7, (bw - bh * 0.3) * v), bh * 0.7, bh * 0.35); g.fill(); }
      g.font = "bold " + bh * 0.8 + "px " + font; g.fillStyle = "#fff"; g.textAlign = "left"; g.textBaseline = "middle";
      g.fillText("HP", bx + bh * 0.5, by + bh / 2);
      g.restore();
    }
    function fitText(text, maxW, size) {
      g.font = "bold " + size + "px " + font;
      if (g.measureText(text).width <= maxW) return text;
      while (text.length > 3 && g.measureText(text + "…").width > maxW) text = text.slice(0, -1);
      return text + "…";
    }
    function round(x, y, w, h, r) {
      g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }
    // the move on its way from attacker to target
    function drawMove(e) {
      var d = st.t - e.at, a = spot(e.tu.att), b = spot(e.tu.tgt), look = e.mv[3], c1 = e.mv[1], c2 = e.mv[2];
      if (d < 0.2 || d > HIT + 0.25) return;
      var q = clamp((d - 0.2) / (HIT - 0.2), 0, 1), x = a.x + (b.x - a.x) * q, y = a.y + (b.y - a.y) * q, S = a.s;
      g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round"; g.lineJoin = "round";
      if (look === "beam") {
        var fade = d > HIT ? 1 - (d - HIT) / 0.25 : 1;
        [[0.16, c1, 0.55], [0.08, c2, 0.9]].forEach(function (L) {
          g.strokeStyle = L[1]; g.globalAlpha = L[2] * fade; g.lineWidth = S * L[0] * (1 + 0.15 * Math.sin(d * 60));
          g.shadowColor = c1; g.shadowBlur = S * 0.2;
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(x, y); g.stroke();
        });
      } else if (look === "bolt") {
        g.strokeStyle = c1; g.shadowColor = c1; g.shadowBlur = S * 0.3; g.lineWidth = S * 0.05;
        for (var z = 0; z < 2; z++) {
          g.beginPath(); g.moveTo(a.x, a.y - S * 0.3);
          for (var j = 1; j <= 8; j++) { var u = j / 8 * q; g.lineTo(a.x + (b.x - a.x) * u + (Math.random() - 0.5) * S * 0.35, a.y - S * 0.3 + (b.y - a.y + S * 0.3) * u + (Math.random() - 0.5) * S * 0.2); }
          g.stroke();
        }
      } else if (look === "orb" || look === "rings") {
        var rr = S * (look === "orb" ? 0.16 : 0.1) * (1 + 0.2 * Math.sin(d * 30));
        var gr = g.createRadialGradient(x, y, 0, x, y, rr * 2.2);
        gr.addColorStop(0, "#fff"); gr.addColorStop(0.35, c2); gr.addColorStop(0.6, c1); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr * 2.2, 0, 6.283); g.fill();
        if (look === "rings") { g.strokeStyle = c1; g.lineWidth = S * 0.025; for (var k2 = 1; k2 <= 3; k2++) { var r2 = S * 0.14 * k2 * (1 + (d * 3 % 1)); g.globalAlpha = 0.7 / k2; g.beginPath(); g.arc(x, y, r2, 0, 6.283); g.stroke(); } }
      } else if (look === "leaves" || look === "slash") {
        for (var l = 0; l < 9; l++) {
          var u2 = clamp(q - l * 0.05, 0, 1), ang = d * 9 + l * 0.7, px = a.x + (b.x - a.x) * u2 + Math.cos(ang) * S * 0.18, py = a.y + (b.y - a.y) * u2 + Math.sin(ang) * S * 0.12;
          g.save(); g.translate(px, py); g.rotate(ang * 2); g.fillStyle = l % 2 ? c1 : c2;
          if (look === "leaves") { g.beginPath(); g.ellipse(0, 0, S * 0.07, S * 0.03, 0, 0, 6.283); g.fill(); }
          else { g.strokeStyle = c2; g.lineWidth = S * 0.02; g.beginPath(); g.arc(0, 0, S * 0.09, 0, 2.2); g.stroke(); }
          g.restore();
        }
      } else if (look === "rocks" || look === "quake") {
        if (look === "rocks") for (var m = 0; m < 6; m++) {
          var fall = clamp(q * 1.4 - m * 0.08, 0, 1), rx = b.x + (m - 2.5) * S * 0.14, ry = b.y - S * 1.4 + fall * S * 1.3;
          g.globalCompositeOperation = "source-over"; g.fillStyle = m % 2 ? c1 : "#8a6a3a";
          g.beginPath(); g.moveTo(rx, ry - S * 0.06); g.lineTo(rx + S * 0.07, ry); g.lineTo(rx + S * 0.02, ry + S * 0.07); g.lineTo(rx - S * 0.07, ry + S * 0.03); g.closePath(); g.fill();
        } else { st.shake = Math.max(st.shake, 0.012); g.globalCompositeOperation = "source-over"; g.strokeStyle = "rgba(90,60,20,.7)"; g.lineWidth = S * 0.02;
          g.beginPath(); g.moveTo(b.x - S * 0.6, b.y + S * 0.42); for (var c = 0; c < 6; c++) g.lineTo(b.x - S * 0.6 + c * S * 0.24, b.y + S * 0.42 + (c % 2 ? -1 : 1) * S * 0.05 * q); g.stroke(); }
      } else if (look === "dash") {
        g.strokeStyle = c2; g.lineWidth = S * 0.03; g.globalAlpha = 0.8;
        for (var s2 = 0; s2 < 5; s2++) { var off = (s2 - 2) * S * 0.08; g.beginPath(); g.moveTo(x - (b.x - a.x) * 0.2, y - (b.y - a.y) * 0.2 + off); g.lineTo(x, y + off); g.stroke(); }
      }
      g.restore();
    }
    function bigText(text, y, size, color, k) {
      g.save(); g.translate(W / 2, y); g.scale(k, k);
      g.font = "900 " + size + "px " + font; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = size * 0.16; g.strokeStyle = "#1b2a4a"; g.lineJoin = "round"; g.strokeText(text, 0, 0);
      g.shadowColor = color; g.shadowBlur = size * 0.35; g.fillStyle = color; g.fillText(text, 0, 0);
      g.restore();
    }
    function fit(text, max, wMax) { g.font = "900 " + max + "px " + font; var w = g.measureText(text).width; return w > wMax ? max * wMax / w : max; }
    // the message box at the bottom, typed out letter by letter
    function drawMessage() {
      if (!st.msg || st.won && st.t > st.winAt + 1) return;
      var bw = Math.min(W * 0.92, 560), bh = Math.max(56, H * 0.085), x = (W - bw) / 2, y = H - bh - Math.max(16, H * 0.03);
      g.save();
      g.fillStyle = "rgba(255,255,255,.96)"; g.strokeStyle = "#1b2a4a"; g.lineWidth = 4;
      round(x, y, bw, bh, 14); g.fill(); g.stroke();
      g.strokeStyle = "#e3350d"; g.lineWidth = 2; round(x + 5, y + 5, bw - 10, bh - 10, 10); g.stroke();
      var shown = st.msg.slice(0, Math.floor((st.t - st.msgAt) * 45));
      function wrap(text, size) {
        g.font = "bold " + size + "px " + font;
        var line = "", out = [];
        text.split(" ").forEach(function (w) { var test = line ? line + " " + w : w; if (g.measureText(test).width > bw - 36 && line) { out.push(line); line = w; } else line = test; });
        out.push(line);
        return out;
      }
      // smaller letters when the whole message (long names and moves) would need more than two lines
      var fs = Math.min(bh * 0.34, 22);
      while (fs > 12 && wrap(st.msg, fs).length > 2) fs *= 0.9;
      var lines = wrap(shown, fs);
      g.fillStyle = "#1d1d1f"; g.textAlign = "left"; g.textBaseline = "middle";
      lines.slice(0, 2).forEach(function (L, j) { g.fillText(L, x + 18, y + bh / 2 + (j - (Math.min(lines.length, 2) - 1) / 2) * fs * 1.2); });
      g.restore();
    }
    function draw() {
      var s = st, t = s.t;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (!bgCache || bgCache.width !== canvas.width || bgCache.height !== canvas.height) {
        bgCache = document.createElement("canvas"); bgCache.width = canvas.width; bgCache.height = canvas.height;
        var real = g; g = bgCache.getContext("2d"); g.setTransform(DPR, 0, 0, DPR, 0, 0); drawField(); g = real;
      }
      g.fillStyle = "#3f8f3a"; g.fillRect(0, 0, W, H);
      g.save();
      var sh = s.shake * Math.min(W, H);
      g.translate((Math.random() - 0.5) * sh * 2, (Math.random() - 0.5) * sh * 2);
      g.drawImage(bgCache, 0, 0, W, H);
      // back first, then the front two
      [1, 0, 2].slice(0, n).forEach(function (i) { if (i < n) drawMon(i); });
      s.fx.forEach(drawMove);
      // hit particles
      s.parts.forEach(function (p) {
        var k = 1 - p.age / p.life;
        g.save(); g.globalAlpha = k; g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.col;
        if (p.star) { g.beginPath(); for (var j = 0; j < 5; j++) { var a1 = j * 1.2566, a2 = a1 + 0.628; g.lineTo(Math.cos(a1) * p.size * 1.6, Math.sin(a1) * p.size * 1.6); g.lineTo(Math.cos(a2) * p.size * 0.7, Math.sin(a2) * p.size * 0.7); } g.closePath(); g.fill(); }
        else { g.beginPath(); g.arc(0, 0, p.size, 0, 6.283); g.fill(); }
        g.restore();
      });
      for (var i = 0; i < n; i++) drawCard(i);
      (s.texts || []).forEach(function (x2) {
        var d = t - x2.at; if (d > 1) return;
        var p = spot(x2.i);
        g.save(); g.globalAlpha = clamp(1 - d, 0, 1);
        g.font = "900 " + p.s * 0.16 + "px " + font; g.textAlign = "center"; g.lineWidth = p.s * 0.03; g.strokeStyle = "#1b2a4a";
        g.strokeText(x2.text, p.x, p.y - p.s * 0.1 - d * p.s * 0.3); g.fillStyle = "#ffcb05"; g.fillText(x2.text, p.x, p.y - p.s * 0.1 - d * p.s * 0.3);
        g.restore();
      });
      g.restore();
      if (s.flash > 0) { g.fillStyle = "rgba(255,255,255," + s.flash * 0.55 + ")"; g.fillRect(0, 0, W, H); }
      // title
      if (t < 1.6) {
        var a1 = clamp((1.6 - t) / 0.3, 0, 1), S = Math.min(W, H);
        g.save(); g.globalAlpha = a1;
        g.fillStyle = "rgba(10,20,50," + 0.55 * a1 + ")"; g.fillRect(0, 0, W, H);
        bigText("POKÉMON", H * 0.36, fit("POKÉMON", S * 0.17, W * 0.9), "#ffcb05", pop(t / 0.45));
        bigText("BATTLE!", H * 0.36 + S * 0.17, fit("BATTLE!", S * 0.17, W * 0.9), "#ffffff", pop((t - 0.2) / 0.45));
        g.restore();
      }
      if (t >= START - 0.6 && t < START + 0.5) {
        var a2 = clamp((START + 0.5 - t) / 0.3, 0, 1);
        g.save(); g.globalAlpha = a2; bigText("FIGHT!", H * 0.25, fit("FIGHT!", Math.min(W, H) * 0.2, W * 0.9), "#ff5a36", pop((t - START + 0.6) / 0.35)); g.restore();
      }
      if (s.won) {
        var names = res.winners.map(function (j) { return fighters[j].name; });
        var line = names.length === n ? "ALL WIN!" : names.join(" & ") + (names.length > 1 ? " WIN!" : " WINS!");
        var S2 = Math.min(W, H);
        bigText("🏆", H * 0.12, S2 * 0.14, "#ffcb05", pop((t - s.winAt) / 0.4));
        bigText(line, H * 0.12 + S2 * 0.16, fit(line, S2 * 0.12, W * 0.92), "#ffcb05", pop((t - s.winAt - 0.1) / 0.4));
        s.confetti.forEach(function (c2) { g.save(); g.translate(c2.x * W, c2.y * H); g.rotate(c2.rot); g.fillStyle = c2.col; g.fillRect(-5, -3, 10, 6); g.restore(); });
      }
      drawMessage();
    }

    function showEnd() {
      var order = fighters.map(function (f, i) { return i; }).sort(function (a, b) { return fighters[b].score - fighters[a].score; });
      var names = res.winners.map(function (i) { return fighters[i].name; });
      end.innerHTML = "";
      var b = document.createElement("b");
      b.textContent = "🏆 " + (names.length === n ? "Everyone wins!" : names.join(" & ") + (names.length > 1 ? " win!" : " wins!"));
      var sc = document.createElement("div"); sc.className = "bb-scores";
      sc.textContent = order.map(function (i) { return fighters[i].name + " " + fighters[i].score; }).join(" · ");
      var note = document.createElement("small"); note.textContent = opts.note || "";
      var again = document.createElement("button"); again.className = "bb-again"; again.type = "button"; again.textContent = "▶ Watch again";
      again.onclick = function () { reset(); };
      var ok = document.createElement("button"); ok.className = "bb-ok"; ok.type = "button"; ok.textContent = "OK!";
      ok.onclick = finish;
      end.appendChild(b); end.appendChild(sc); end.appendChild(note); end.appendChild(again); end.appendChild(ok);
      setTimeout(function () { if (st.won) end.className = "bb-end show"; }, 1600);
    }

    var last = 0, acc = 0, STEP = 1 / 120;
    function frame(now) {
      if (done) return;
      var el = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now; acc += el;
      while (acc >= STEP) { step(STEP); st.t += STEP; acc -= STEP; }
      draw();
      raf = requestAnimationFrame(frame);
    }
    function finish() {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
      music.stop(); sound.close();
      if (root.parentNode) root.parentNode.removeChild(root);
      if (opts.onEnd) opts.onEnd();
    }
    close.onclick = finish;
    reset();
    raf = requestAnimationFrame(frame);
    return { close: finish };
  }

  return { play: play, script: script, movesOf: movesOf, pickMoves: pickMoves, looksOf: looksOf };
})();
