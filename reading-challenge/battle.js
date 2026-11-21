// Beyblade Battle: a full-screen battle of the children's Beyblades, drawn on a canvas at the phone's full
// resolution, with sound made in the browser (no files). The child with the most points wins; the others are
// knocked out of the stadium, the lowest first. The same seed and scores give the same battle on every phone.
// BeyBattle.play({ fighters: [{ name, beyName, img, score, color }], seed, title, note, scoreLabel })
// BeyBattle.result(scores) -> { kos: [[i, ...], ...] (lowest group first), winners: [i, ...] }
var BeyBattle = (function () {
  "use strict";

  // ---------- result: who is knocked out when, and who wins ----------
  function result(scores) {
    var groups = {};
    scores.forEach(function (s, i) { (groups[s] = groups[s] || []).push(i); });
    var keys = Object.keys(groups).map(Number).sort(function (a, b) { return a - b; });
    var top = keys.pop();
    return { kos: keys.map(function (k) { return groups[k]; }), winners: groups[top] };
  }

  // ---------- small helpers ----------
  function rng(seedText) {
    var h = 1779033703;
    for (var i = 0; i < seedText.length; i++) { h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    var a = h >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function pop(t) { t = clamp(t, 0, 1); return t < 0.6 ? ease(t / 0.6) * 1.15 : 1.15 - 0.15 * ease((t - 0.6) / 0.4); }

  // ---------- sound (Web Audio; started from the button tap so iPhone plays it) ----------
  function Sound() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = null;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx();
      this.out = this.ctx.createDynamicsCompressor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.out);
      this.out.connect(this.ctx.destination);
      var len = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, len, len), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch (e) { this.ctx = null; }
  }
  Sound.prototype.env = function (node, t, peak, decay) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    node.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  };
  Sound.prototype.tone = function (type, freq, peak, decay, when, toFreq) {
    if (!this.ctx) return;
    var t = this.ctx.currentTime + (when || 0), o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + decay);
    this.env(g, t, peak, decay);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + decay + 0.05);
  };
  Sound.prototype.hiss = function (freq, q, peak, decay, toFreq) {
    if (!this.ctx) return;
    var t = this.ctx.currentTime, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noise;
    f.type = "bandpass"; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (toFreq) f.frequency.exponentialRampToValueAtTime(toFreq, t + decay);
    this.env(g, t, peak, decay);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + decay + 0.05);
  };
  // A metal clash: a few out-of-tune partials (like struck metal) and a bright click.
  Sound.prototype.clang = function (power) {
    if (!this.ctx) return;
    var p = clamp(power, 0.15, 1), base = 480 + Math.random() * 160;
    [[1, "triangle", 0.5], [2.76, "sine", 0.32], [4.4, "sine", 0.22], [6.9, "sine", 0.12]].forEach(function (h) {
      this.tone(h[1], base * h[0] * (0.97 + Math.random() * 0.06), h[2] * p, 0.16 + 0.32 * p);
    }, this);
    this.hiss(3600, 1.2, 0.5 * p, 0.07);
  };
  Sound.prototype.boom = function () {
    this.clang(1);
    this.tone("sine", 140, 0.9, 0.55, 0, 38);
    this.hiss(900, 0.7, 0.5, 0.45, 200);
  };
  Sound.prototype.whoosh = function () { this.hiss(400, 1.5, 0.6, 0.7, 3200); };
  Sound.prototype.beep = function (high) { this.tone("square", high ? 988 : 660, 0.22, high ? 0.45 : 0.14); };
  Sound.prototype.fanfare = function () {
    var notes = [523, 659, 784, 1047], self = this;
    notes.forEach(function (f, i) {
      self.tone("square", f, 0.16, i === 3 ? 0.9 : 0.16, i * 0.15);
      self.tone("triangle", f / 2, 0.22, i === 3 ? 0.9 : 0.16, i * 0.15);
    });
  };
  // The spinning hum while the Beyblades are in the stadium.
  Sound.prototype.hum = function (on) {
    if (!this.ctx) return;
    var t = this.ctx.currentTime;
    if (on && !this.humNode) {
      var g = this.ctx.createGain(), f = this.ctx.createBiquadFilter(), lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
      f.type = "lowpass"; f.frequency.value = 520;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.4);
      lfo.frequency.value = 14; lg.gain.value = 0.025; lfo.connect(lg); lg.connect(g.gain); lfo.start(t);
      var oscs = [72, 109, 146].map(function (fr) { var o = this.ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = fr; o.connect(f); o.start(t); return o; }, this);
      f.connect(g); g.connect(this.master);
      this.humNode = { g: g, oscs: oscs.concat([lfo]) };
    } else if (!on && this.humNode) {
      var h = this.humNode;
      this.humNode = null;
      h.g.gain.cancelScheduledValues(t);
      h.g.gain.setValueAtTime(Math.max(h.g.gain.value, 0.0001), t);
      h.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      h.oscs.forEach(function (o) { o.stop(t + 0.7); });
    }
  };
  Sound.prototype.close = function () { this.hum(false); if (this.ctx && this.ctx.close) { var c = this.ctx; setTimeout(function () { c.close(); }, 800); } };

  // ---------- styles and screen ----------
  var CSS = ".bb{position:fixed;top:0;left:0;right:0;bottom:0;z-index:30;background:#04070f;color:#fff;font-family:inherit;touch-action:none}" +
    ".bb canvas{position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;display:block}" +
    ".bb-x{position:absolute;top:12px;top:max(12px,env(safe-area-inset-top));right:12px;z-index:2;width:44px;height:44px;border-radius:50%;border:2px solid rgba(255,255,255,.6);background:rgba(0,0,0,.45);color:#fff;font-family:inherit;font-weight:bold;font-size:20px;line-height:1;cursor:pointer}" +
    ".bb-end{position:absolute;left:50%;bottom:18px;bottom:max(18px,env(safe-area-inset-bottom));transform:translate(-50%,30px);opacity:0;transition:opacity .5s,transform .5s;z-index:2;width:min(92vw,440px);" +
    "background:rgba(10,16,34,.86);border:3px solid #ffcb05;border-radius:20px;padding:14px 16px;text-align:center;box-shadow:0 0 30px rgba(255,203,5,.35)}" +
    ".bb-end.show{opacity:1;transform:translate(-50%,0)}" +
    ".bb-end b{display:block;font-size:24px;color:#ffcb05;margin-bottom:6px}" +
    ".bb-end .bb-scores{font-size:17px;font-weight:bold;line-height:1.5}" +
    ".bb-end small{display:block;opacity:.75;margin:4px 0 10px}" +
    ".bb-end button{font-family:inherit;font-weight:bold;font-size:17px;border:3px solid #000;border-radius:14px;padding:8px 18px;margin:0 4px;cursor:pointer;box-shadow:0 3px 0 #000}" +
    ".bb-again{background:#fff;color:#000}.bb-ok{background:#e3350d;color:#fff}";
  function addStyle() {
    if (document.getElementById("bbStyle")) return;
    var s = document.createElement("style");
    s.id = "bbStyle"; s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ---------- timing (seconds) ----------
  var INTRO = 2.6, COUNT = [2.8, 3.4, 4.0], RIP = 4.6, KO_TIMES = [10.5, 15.5], WIN_AFTER = 2.0;
  var STEP = 1 / 120;

  function play(opts) {
    addStyle();
    var fighters = opts.fighters, res = result(fighters.map(function (f) { return f.score; }));
    var root = document.createElement("div");
    root.className = "bb";
    root.id = "beyBattle";
    root.setAttribute("data-phase", "intro");
    root.setAttribute("data-fighters", fighters.map(function (f) { return f.name + ":" + (f.img || "-"); }).join(" "));
    var canvas = document.createElement("canvas");
    var close = document.createElement("button");
    close.className = "bb-x"; close.type = "button"; close.textContent = "✕"; close.setAttribute("aria-label", "Close");
    var end = document.createElement("div");
    end.className = "bb-end";
    root.appendChild(canvas); root.appendChild(close); root.appendChild(end);
    document.body.appendChild(root);
    var g = canvas.getContext("2d"), sound = new Sound(), font = getComputedStyle(document.body).fontFamily;
    var W = 0, H = 0, DPR = 1, raf = 0, done = false, bgCache = null;

    function size() {
      DPR = Math.min(window.devicePixelRatio || 1, 3);
      W = root.clientWidth; H = root.clientHeight;
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    }
    size();
    window.addEventListener("resize", size);

    // Pictures of the Beyblades (a drawn one if there is no photo or it does not load).
    var pics = fighters.map(function (f) {
      if (!f.img) return null;
      var im = new Image();
      im.src = f.img;
      return im;
    });

    var state;
    function reset() {
      var r = rng(String(opts.seed || "battle"));
      var tops = fighters.map(function (f, i) {
        var a = -Math.PI / 2 + i * 2 * Math.PI / fighters.length;
        return { i: i, f: f, x: Math.cos(a) * 1.9, y: Math.sin(a) * 1.9, vx: 0, vy: 0, ang: r() * 6.28, spin: 13 + r() * 3,
          m: 1 + 0.08 * (res.winners.indexOf(i) >= 0 ? 1 : 0), alive: true, out: false, gone: 0, wob: 0, hunt: null, hitAt: -9, flash: 0, launchA: a };
      });
      var plan = [];
      res.kos.forEach(function (group, gi) {
        var at = res.kos.length === 1 ? 12 : KO_TIMES[gi];
        // 2.1 s apart: longer than a hunt can last (1.8 s), so one knock-out ends before the next starts
        group.forEach(function (loser, j) { plan.push({ at: at + j * 2.1, loser: loser }); });
      });
      var lastKo = plan.length ? plan[plan.length - 1].at : 11;
      state = { r: r, t: 0, tops: tops, plan: plan, sparks: [], texts: [], confetti: [], shake: 0, slow: 0, flashes: [],
        winAt: lastKo + WIN_AFTER, won: false, beeps: 0, ripped: false, nextAttack: RIP + 1.2, pairHit: {} };
      root.setAttribute("data-phase", "intro"); root.removeAttribute("data-out");
      end.className = "bb-end";
      end.innerHTML = "";
    }

    // ---------- physics (the stadium has radius 1; a Beyblade has radius BR) ----------
    var BR = 0.2;
    function alive() { return state.tops.filter(function (b) { return b.alive && !b.out; }); }
    function hit(a, b, nx, ny, power, cx, cy) {
      var key = a.i < b.i ? a.i + "-" + b.i : b.i + "-" + a.i;
      if (state.t - (state.pairHit[key] || -9) < 0.12) return;
      state.pairHit[key] = state.t;
      var n = Math.round(10 + 26 * power);
      for (var k = 0; k < n; k++) {
        var ang = Math.atan2(ny, nx) + (state.r() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (state.r() - 0.5) * 1.6, sp = 1.2 + state.r() * 2.6 * (0.5 + power);
        state.sparks.push({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0.25 + state.r() * 0.35, age: 0 });
      }
      state.flashes.push({ x: cx, y: cy, age: 0, size: 0.18 + 0.3 * power });
      state.shake = Math.max(state.shake, 0.012 + 0.035 * power);
      a.flash = b.flash = 1;
      sound.clang(power);
    }
    function knockOut(loser, attacker, nx, ny) {
      if (loser.out) return;
      loser.out = true; loser.hunt = null;
      root.setAttribute("data-out", state.tops.filter(function (b) { return b.out; }).map(function (b) { return b.f.name; }).join(" "));
      var sp = 4.2;
      loser.vx = nx * sp; loser.vy = ny * sp;
      attacker.vx = -nx * 1.4; attacker.vy = -ny * 1.4;
      attacker.hunt = null;
      state.slow = 0.55;
      state.shake = 0.07;
      state.texts.push({ text: loser.f.name + " OUT!", x: loser.x, y: loser.y, age: 0, color: loser.f.color });
      var cx = (loser.x + attacker.x) / 2, cy = (loser.y + attacker.y) / 2;
      for (var k = 0; k < 60; k++) {
        var ang = state.r() * 6.283, s2 = 1 + state.r() * 4;
        state.sparks.push({ x: cx, y: cy, vx: Math.cos(ang) * s2, vy: Math.sin(ang) * s2, life: 0.35 + state.r() * 0.5, age: 0 });
      }
      state.flashes.push({ x: cx, y: cy, age: 0, size: 0.7 });
      sound.boom();
    }
    function step(dt) {
      var s = state, t = s.t;
      // countdown sounds and the launch
      while (s.beeps < COUNT.length && t >= COUNT[s.beeps]) { sound.beep(false); s.beeps++; }
      if (!s.ripped && t >= RIP) {
        s.ripped = true;
        sound.beep(true); sound.whoosh(); sound.hum(true);
        root.setAttribute("data-phase", "battle");
        s.tops.forEach(function (b) {
          var a = b.launchA, tang = a + Math.PI / 2;
          b.vx = -Math.cos(a) * 2.6 + Math.cos(tang) * 1.4; b.vy = -Math.sin(a) * 2.6 + Math.sin(tang) * 1.4;
        });
      }
      if (!s.ripped) return;
      // knock-outs: the strongest Beyblade left goes for the loser
      s.plan.forEach(function (p) {
        if (p.started || t < p.at) return;
        p.started = true;
        var loser = s.tops[p.loser];
        var others = alive().filter(function (b) { return b !== loser && s.plan.every(function (q) { return q.loser !== b.i || q.at > p.at + 5; }); });
        var att = others.sort(function (a, b) { return b.f.score - a.f.score; })[0] || alive().filter(function (b) { return b !== loser; })[0];
        if (att && att.hunt && !att.hunt.out) {
          // still going for someone else: finish that knock-out first, so nobody who lost stays in
          var ox = att.hunt.x - att.x, oy = att.hunt.y - att.y, od = Math.hypot(ox, oy) || 1;
          knockOut(att.hunt, att, ox / od, oy / od);
        }
        if (att) { att.hunt = loser; att.huntFrom = t; } else knockOut(loser, loser, 1, 0);
      });
      // random attacks so the Beyblades keep clashing
      if (t >= s.nextAttack && !s.won) {
        var live = alive();
        if (live.length > 1) {
          var a = live[Math.floor(s.r() * live.length)], others2 = live.filter(function (b) { return b !== a; }), tg = others2[Math.floor(s.r() * others2.length)];
          if (!a.hunt) { var dx = tg.x - a.x, dy = tg.y - a.y, d = Math.hypot(dx, dy) || 1; a.vx += dx / d * 1.9; a.vy += dy / d * 1.9; }
        }
        s.nextAttack = t + 0.45 + s.r() * 0.6;
      }
      s.tops.forEach(function (b) {
        b.ang += b.spin * dt * (b.out ? 0.6 : 1);
        b.flash = Math.max(0, b.flash - dt * 5);
        if (b.out) {
          b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.995; b.vy *= 0.995;
          if (Math.hypot(b.x, b.y) > 1.05) b.gone = Math.min(1, b.gone + dt * 1.6);
          if (b.gone >= 1) b.alive = false;
          return;
        }
        var r = Math.hypot(b.x, b.y) || 0.0001, ux = b.x / r, uy = b.y / r;
        if (b.hunt && b.hunt.alive && !b.hunt.out) {
          var hx = b.hunt.x - b.x, hy = b.hunt.y - b.y, hd = Math.hypot(hx, hy) || 1, sp = 3.4;
          b.vx += (hx / hd * sp - b.vx) * Math.min(1, dt * 7); b.vy += (hy / hd * sp - b.vy) * Math.min(1, dt * 7);
          if (t - b.huntFrom > 1.8) { knockOut(b.hunt, b, (b.hunt.x - b.x) / hd, (b.hunt.y - b.y) / hd); }
        } else {
          // the bowl pulls to the middle and the spin makes them circle
          var pull = r > 0.05 ? 2.2 * r : 0;
          b.vx += (-ux * pull - uy * 1.25) * dt; b.vy += (-uy * pull + ux * 1.25) * dt;
          b.vx *= 1 - 0.35 * dt; b.vy *= 1 - 0.35 * dt;
        }
        // a Beyblade that is about to lose wobbles
        var doomed = s.plan.some(function (p) { return p.loser === b.i && t > p.at - 2.5; });
        b.wob += ((doomed ? 1 : 0.15) - b.wob) * dt * 2;
        b.x += b.vx * dt; b.y += b.vy * dt;
        r = Math.hypot(b.x, b.y);
        if (s.ripped && t > RIP + 0.6 && r > 1 - BR) {
          // the stadium wall
          ux = b.x / r; uy = b.y / r;
          var vn = b.vx * ux + b.vy * uy;
          if (vn > 0) { b.vx -= 1.75 * vn * ux; b.vy -= 1.75 * vn * uy; if (vn > 1.2) hit(b, b, -ux, -uy, Math.min(0.5, vn / 6), b.x + ux * BR, b.y + uy * BR); }
          b.x = ux * (1 - BR); b.y = uy * (1 - BR);
        }
      });
      // Beyblades hitting each other
      var live2 = alive();
      for (var i = 0; i < live2.length; i++) for (var j = i + 1; j < live2.length; j++) {
        var a2 = live2[i], b2 = live2[j], dx2 = b2.x - a2.x, dy2 = b2.y - a2.y, d2 = Math.hypot(dx2, dy2);
        if (d2 >= 2 * BR || d2 === 0) continue;
        var nx = dx2 / d2, ny = dy2 / d2;
        if ((a2.hunt === b2 || b2.hunt === a2)) {
          var hunter = a2.hunt === b2 ? a2 : b2, prey = hunter === a2 ? b2 : a2, sgn = hunter === a2 ? 1 : -1;
          knockOut(prey, hunter, nx * sgn, ny * sgn);
          continue;
        }
        var rel = (b2.vx - a2.vx) * nx + (b2.vy - a2.vy) * ny;
        var overlap = 2 * BR - d2;
        a2.x -= nx * overlap / 2; a2.y -= ny * overlap / 2; b2.x += nx * overlap / 2; b2.y += ny * overlap / 2;
        if (rel < 0) {
          var jimp = -(1 + 0.95) * rel / (1 / a2.m + 1 / b2.m) + 0.6;
          a2.vx -= jimp * nx / a2.m; a2.vy -= jimp * ny / a2.m; b2.vx += jimp * nx / b2.m; b2.vy += jimp * ny / b2.m;
          hit(a2, b2, nx, ny, clamp(-rel / 4, 0.15, 1), a2.x + nx * BR, a2.y + ny * BR);
        }
      }
      // the winner
      if (!s.won && t >= s.winAt) {
        s.won = true;
        root.setAttribute("data-phase", "end");
        sound.fanfare();
        showEnd();
        for (var c = 0; c < 140; c++) s.confetti.push({ x: s.r(), y: -s.r() * 0.6, vx: (s.r() - 0.5) * 0.08, vy: 0.18 + s.r() * 0.25, rot: s.r() * 6, vr: (s.r() - 0.5) * 8, col: ["#ffcb05", "#e3350d", "#2a75bb", "#2fb36d", "#fff", "#7b3fe4"][c % 6] });
      }
      if (s.won) {
        alive().forEach(function (b) { b.vx *= 1 - 1.5 * dt; b.vy *= 1 - 1.5 * dt; if (res.winners.length === 1) { b.x *= 1 - dt * 0.8; b.y *= 1 - dt * 0.8; } });
        s.confetti.forEach(function (c2) { c2.x += c2.vx * dt; c2.y += c2.vy * dt; c2.rot += c2.vr * dt; if (c2.y > 1.1) { c2.y = -0.05; c2.x = s.r(); } });
      }
      s.sparks.forEach(function (p2) { p2.age += dt; p2.x += p2.vx * dt; p2.y += p2.vy * dt; p2.vx *= 0.96; p2.vy *= 0.96; });
      s.sparks = s.sparks.filter(function (p2) { return p2.age < p2.life; });
      s.flashes.forEach(function (f2) { f2.age += dt; });
      s.flashes = s.flashes.filter(function (f2) { return f2.age < 0.18; });
      s.texts.forEach(function (x2) { x2.age += dt; });
      s.shake = Math.max(0, s.shake - dt * 0.12);
    }

    // ---------- drawing ----------
    function drawBey(b, R, cx, cy) {
      var px = cx + b.x * R, py = cy + b.y * R * 0.78, rr = BR * R * (1 - 0.6 * b.gone), alpha = 1 - b.gone;
      if (alpha <= 0) return;
      var wx = Math.sin(state.t * 9) * b.wob * rr * 0.08, wy = Math.cos(state.t * 9) * b.wob * rr * 0.08;
      g.save();
      g.globalAlpha = alpha;
      // shadow
      g.fillStyle = "rgba(0,0,0,.45)";
      g.beginPath(); g.ellipse(px + rr * 0.12, py + rr * 0.38, rr * 1.02, rr * 0.5, 0, 0, 6.283); g.fill();
      g.translate(px + wx, py + wy - rr * 0.1);
      g.scale(1, 0.86);
      // glow ring in the child's colour
      g.shadowColor = b.f.color; g.shadowBlur = rr * (0.5 + b.flash);
      g.fillStyle = b.f.color;
      g.beginPath(); g.arc(0, 0, rr * 1.08, 0, 6.283); g.fill();
      g.shadowBlur = 0;
      var im = pics[b.i];
      var ok = im && im.complete && im.naturalWidth > 0;
      // the photo turning, with two faint copies behind it so it looks fast
      for (var k = 2; k >= 0; k--) {
        g.save();
        g.globalAlpha = alpha * (k === 0 ? 1 : 0.28 / k);
        g.rotate(b.ang - k * 0.22);
        g.beginPath(); g.arc(0, 0, rr, 0, 6.283); g.clip();
        if (ok) g.drawImage(im, -rr * 1.04, -rr * 1.04, rr * 2.08, rr * 2.08);
        else drawnBey(rr, b.f.color);
        g.restore();
      }
      // speed streaks and shine
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = Math.max(1.5, rr * 0.05);
      for (var s2 = 0; s2 < 3; s2++) {
        var a0 = b.ang * 1.7 + s2 * 2.094;
        g.beginPath(); g.arc(0, 0, rr * 0.9, a0, a0 + 0.9); g.stroke();
      }
      if (b.flash > 0) { g.fillStyle = "rgba(255,240,180," + (0.6 * b.flash) + ")"; g.beginPath(); g.arc(0, 0, rr, 0, 6.283); g.fill(); }
      g.restore();
      // name under it
      if (!b.out) {
        g.save();
        var fs = Math.max(12, R * 0.07);
        g.font = "bold " + fs + "px " + font;
        var tw = g.measureText(b.f.name).width + fs;
        g.fillStyle = b.f.color; g.globalAlpha = 0.92;
        roundRect(px - tw / 2, py + rr * 0.62, tw, fs * 1.4, fs * 0.7); g.fill();
        g.globalAlpha = 1; g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(b.f.name, px, py + rr * 0.62 + fs * 0.72);
        g.restore();
      }
    }
    function drawnBey(rr, color) {
      var gr = g.createRadialGradient(0, 0, rr * 0.1, 0, 0, rr);
      gr.addColorStop(0, "#fff"); gr.addColorStop(0.35, "#bbb"); gr.addColorStop(1, "#333");
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rr, 0, 6.283); g.fill();
      g.fillStyle = color;
      for (var k = 0; k < 3; k++) {
        g.save(); g.rotate(k * 2.094);
        g.beginPath(); g.moveTo(0, -rr * 0.2); g.quadraticCurveTo(rr * 0.9, -rr * 0.8, rr * 0.95, 0); g.quadraticCurveTo(rr * 0.5, -rr * 0.1, 0, rr * 0.2); g.fill();
        g.restore();
      }
      g.fillStyle = "#222"; g.beginPath(); g.arc(0, 0, rr * 0.22, 0, 6.283); g.fill();
    }
    function roundRect(x, y, w, h, r) {
      g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }
    function drawStadium(R, cx, cy) {
      // spotlight
      var bg = g.createRadialGradient(cx, cy - R * 0.9, R * 0.1, cx, cy, Math.max(W, H));
      bg.addColorStop(0, "#1d3566"); bg.addColorStop(0.45, "#0b1530"); bg.addColorStop(1, "#02040a");
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.save();
      g.translate(cx, cy); g.scale(1, 0.78);
      // outer wall (metal)
      var wall = g.createLinearGradient(-R, -R, R, R);
      wall.addColorStop(0, "#e9eef7"); wall.addColorStop(0.3, "#7f8aa3"); wall.addColorStop(0.55, "#f4f7ff"); wall.addColorStop(1, "#4a536b");
      g.fillStyle = wall; g.beginPath(); g.arc(0, 0, R * 1.12, 0, 6.283); g.fill();
      g.fillStyle = "#11182b"; g.beginPath(); g.arc(0, 0, R * 1.03, 0, 6.283); g.fill();
      // floor (a bowl: lighter in the middle)
      var fl = g.createRadialGradient(0, -R * 0.2, R * 0.05, 0, 0, R);
      fl.addColorStop(0, "#5b7fc4"); fl.addColorStop(0.55, "#2a4378"); fl.addColorStop(1, "#0f1a36");
      g.fillStyle = fl; g.beginPath(); g.arc(0, 0, R, 0, 6.283); g.fill();
      g.strokeStyle = "rgba(160,200,255,.22)"; g.lineWidth = Math.max(1, R * 0.008);
      [0.3, 0.55, 0.8].forEach(function (k) { g.beginPath(); g.arc(0, 0, R * k, 0, 6.283); g.stroke(); });
      g.strokeStyle = "rgba(255,203,5,.35)"; g.lineWidth = Math.max(2, R * 0.02);
      g.beginPath(); g.moveTo(-R * 0.14, -R * 0.14); g.lineTo(R * 0.14, R * 0.14); g.moveTo(R * 0.14, -R * 0.14); g.lineTo(-R * 0.14, R * 0.14); g.stroke();
      // rim light
      g.strokeStyle = "rgba(108,204,255,.55)"; g.lineWidth = Math.max(2, R * 0.015);
      g.shadowColor = "#6cf"; g.shadowBlur = R * 0.06;
      g.beginPath(); g.arc(0, 0, R * 1.01, 0, 6.283); g.stroke();
      g.restore();
    }
    function bigText(text, y, size, color, k) {
      g.save();
      g.translate(W / 2, y); g.scale(k, k);
      g.font = "900 " + size + "px " + font;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = size * 0.16; g.strokeStyle = "#000"; g.lineJoin = "round";
      g.strokeText(text, 0, 0);
      g.shadowColor = color; g.shadowBlur = size * 0.4;
      g.fillStyle = color; g.fillText(text, 0, 0);
      g.shadowBlur = 0; g.fillStyle = "#fff"; g.globalAlpha = 0.35; g.fillText(text, 0, -size * 0.04);
      g.restore();
    }
    function fitSize(text, max, wMax) {
      g.font = "900 " + max + "px " + font;
      var w = g.measureText(text).width;
      return w > wMax ? max * wMax / w : max;
    }
    function draw() {
      var s = state, t = s.t;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      var R = Math.min(W * 0.46, H * 0.36), cx = W / 2, cy = H * 0.52;
      var sh = s.shake * R;
      g.fillStyle = "#02040a"; g.fillRect(0, 0, W, H);
      g.save();
      // Math.random here, not the seeded one: drawing happens a different number of times on each phone.
      g.translate((Math.random() - 0.5) * sh * 2, (Math.random() - 0.5) * sh * 2);
      // The stadium does not move: drawn once per screen size, then copied each frame.
      if (!bgCache || bgCache.width !== canvas.width || bgCache.height !== canvas.height) {
        bgCache = document.createElement("canvas");
        bgCache.width = canvas.width; bgCache.height = canvas.height;
        var real = g;
        g = bgCache.getContext("2d");
        g.setTransform(DPR, 0, 0, DPR, 0, 0);
        drawStadium(R, cx, cy);
        g = real;
      }
      g.drawImage(bgCache, 0, 0, W, H);
      if (s.ripped) {
        s.tops.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (b) { drawBey(b, R, cx, cy); });
      }
      // sparks and flashes
      g.save();
      g.globalCompositeOperation = "lighter";
      s.flashes.forEach(function (f) {
        var k = 1 - f.age / 0.18, fx = cx + f.x * R, fy = cy + f.y * R * 0.78, fr = f.size * R * (0.6 + 0.6 * (1 - k));
        var gr = g.createRadialGradient(fx, fy, 0, fx, fy, fr);
        gr.addColorStop(0, "rgba(255,255,255," + k + ")"); gr.addColorStop(0.4, "rgba(255,220,120," + (0.6 * k) + ")"); gr.addColorStop(1, "rgba(255,150,40,0)");
        g.fillStyle = gr; g.beginPath(); g.arc(fx, fy, fr, 0, 6.283); g.fill();
      });
      g.lineCap = "round";
      s.sparks.forEach(function (p) {
        var k = 1 - p.age / p.life, x = cx + p.x * R, y = cy + p.y * R * 0.78;
        g.strokeStyle = "rgba(255," + Math.round(200 + 55 * k) + "," + Math.round(80 + 150 * k) + "," + k + ")";
        g.lineWidth = Math.max(1.5, R * 0.012 * k + 1);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - p.vx * R * 0.03, y - p.vy * R * 0.03 * 0.78); g.stroke();
      });
      g.restore();
      // OUT! texts
      s.texts.forEach(function (x2) {
        if (x2.age > 1.6) return;
        g.save(); g.globalAlpha = clamp(1.6 - x2.age, 0, 1);
        bigText(x2.text, cy - R * 0.15 - x2.age * R * 0.12, fitSize(x2.text, R * 0.3, W * 0.9), x2.color, pop(x2.age / 0.35));
        g.restore();
      });
      g.restore();
      // titles
      if (t < INTRO + 0.4) {
        var k1 = pop(t / 0.5), a1 = clamp((INTRO + 0.4 - t) / 0.4, 0, 1);
        // darken the stadium so the title and the three fighters stand out
        g.fillStyle = "rgba(2,4,10," + (0.6 * a1) + ")"; g.fillRect(0, 0, W, H);
        g.save(); g.globalAlpha = a1;
        bigText("BEYBLADE", H * 0.2, fitSize("BEYBLADE", R * 0.32, W * 0.9), "#ffcb05", k1);
        bigText("BATTLE!", H * 0.2 + R * 0.34, fitSize("BATTLE!", R * 0.32, W * 0.9), "#e3350d", pop((t - 0.25) / 0.5));
        g.restore();
        drawLineup(R, clamp((t - 0.6) / 0.6, 0, 1) * a1);
      }
      for (var c = 0; c < COUNT.length; c++) {
        var dt2 = t - COUNT[c];
        if (dt2 >= 0 && dt2 < 0.6) bigText(String(3 - c), cy, R * 0.6, "#fff", pop(dt2 / 0.3));
      }
      if (t >= RIP && t < RIP + 1.2) {
        var k2 = clamp((RIP + 1.2 - t) / 0.3, 0, 1);
        g.save(); g.globalAlpha = k2;
        bigText("LET IT RIP!", cy - R * 0.1, fitSize("LET IT RIP!", R * 0.3, W * 0.92), "#ffcb05", pop((t - RIP) / 0.3));
        g.restore();
      }
      if (s.won) {
        var names = res.winners.map(function (i) { return fighters[i].name; });
        var line = names.length === fighters.length ? "ALL WIN!" : names.join(" & ") + (names.length > 1 ? " WIN!" : " WINS!");
        bigText("🏆", H * 0.13, R * 0.28, "#ffcb05", pop((t - s.winAt) / 0.4));
        bigText(line, H * 0.13 + R * 0.34, fitSize(line, R * 0.24, W * 0.92), "#ffcb05", pop((t - s.winAt - 0.1) / 0.4));
        s.confetti.forEach(function (c2) {
          g.save(); g.translate(c2.x * W, c2.y * H); g.rotate(c2.rot);
          g.fillStyle = c2.col; g.fillRect(-5, -3, 10, 6);
          g.restore();
        });
      }
    }
    // The three fighters before the battle: photo, name and Beyblade.
    function drawLineup(R, k) {
      if (k <= 0) return;
      var n = fighters.length, w = Math.min(W * 0.3, R * 0.75), y = H * 0.56;
      fighters.forEach(function (f, i) {
        var x = W / 2 + (i - (n - 1) / 2) * (w + W * 0.02), kk = ease(k * 1.4 - i * 0.2), rr = w * 0.36;
        if (kk <= 0) return;
        g.save();
        g.globalAlpha = kk; g.translate(x, y + (1 - kk) * R * 0.4);
        g.shadowColor = f.color; g.shadowBlur = rr * 0.6;
        g.fillStyle = f.color; g.beginPath(); g.arc(0, 0, rr * 1.1, 0, 6.283); g.fill();
        g.shadowBlur = 0;
        g.save(); g.beginPath(); g.arc(0, 0, rr, 0, 6.283); g.clip();
        g.rotate(state.t * 2);
        var im = pics[i];
        if (im && im.complete && im.naturalWidth > 0) g.drawImage(im, -rr * 1.04, -rr * 1.04, rr * 2.08, rr * 2.08); else drawnBey(rr, f.color);
        g.restore();
        var fs = Math.max(13, w * 0.15);
        g.font = "bold " + fs + "px " + font; g.textAlign = "center"; g.textBaseline = "top"; g.fillStyle = "#fff";
        g.fillText(f.name, 0, rr * 1.25);
        if (f.beyName) {
          var fs2 = Math.max(11, w * 0.1);
          g.font = fs2 + "px " + font; g.globalAlpha = kk * 0.8;
          wrap(f.beyName, 0, rr * 1.25 + fs * 1.2, w, fs2);
        }
        g.restore();
      });
    }
    function wrap(text, x, y, maxW, lh) {
      var words = text.split(" "), line = "";
      words.forEach(function (wd) {
        var test = line ? line + " " + wd : wd;
        if (g.measureText(test).width > maxW && line) { g.fillText(line, x, y); y += lh * 1.15; line = wd; } else line = test;
      });
      if (line) g.fillText(line, x, y);
    }

    // ---------- the end card ----------
    function showEnd() {
      var order = fighters.map(function (f, i) { return i; }).sort(function (a, b) { return fighters[b].score - fighters[a].score; });
      var names = res.winners.map(function (i) { return fighters[i].name; });
      end.innerHTML = "";
      var b = document.createElement("b");
      b.textContent = "🏆 " + (names.length === fighters.length ? "Everyone wins!" : names.join(" & ") + (names.length > 1 ? " win!" : " wins!"));
      var sc = document.createElement("div");
      sc.className = "bb-scores";
      sc.textContent = order.map(function (i) { return fighters[i].name + " " + fighters[i].score; }).join(" · ");
      var note = document.createElement("small");
      note.textContent = opts.note || "";
      var again = document.createElement("button");
      again.className = "bb-again"; again.type = "button"; again.textContent = "▶ Watch again";
      again.onclick = function () { sound.hum(false); reset(); };
      var ok = document.createElement("button");
      ok.className = "bb-ok"; ok.type = "button"; ok.textContent = "OK!";
      ok.onclick = finish;
      end.appendChild(b); end.appendChild(sc); end.appendChild(note); end.appendChild(again); end.appendChild(ok);
      setTimeout(function () { end.className = "bb-end show"; }, 900);
    }

    // ---------- loop ----------
    var last = 0, acc = 0;
    function frame(now) {
      if (done) return;
      var el = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      acc += el * (state.slow > 0 ? 0.35 : 1);
      state.slow = Math.max(0, state.slow - el);
      while (acc >= STEP) { step(STEP); state.t += STEP; acc -= STEP; }
      draw();
      raf = requestAnimationFrame(frame);
    }
    function finish() {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
      sound.close();
      if (root.parentNode) root.parentNode.removeChild(root);
      if (opts.onEnd) opts.onEnd();
    }
    close.onclick = finish;
    reset();
    raf = requestAnimationFrame(frame);
    return { close: finish };
  }

  // kit: the parts pokebattle.js shares (seeded random, sound, the screen's styles, easing).
  return { play: play, result: result, kit: { rng: rng, Sound: Sound, addStyle: addStyle, clamp: clamp, ease: ease, pop: pop } };
})();
