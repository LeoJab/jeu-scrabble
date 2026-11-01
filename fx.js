'use strict';
/* Effets spéciaux : sons (WebAudio), confettis, feux d'artifice, bannières, secousses */

const FX = (() => {
  // ---------- Sons ----------
  let AC = null, muted = false;
  try { muted = localStorage.getItem('scr-mute') === '1'; } catch (e) {}
  function ac() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(f, t0, dur, type, vol, slide) {
    const a = ac(); if (!a || muted) return;
    const t = a.currentTime + t0, o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  const N = { C: 523.25, D: 587.33, E: 659.25, G: 783.99, A: 880, B: 987.77, C2: 1046.5, E2: 1318.5, G2: 1568 };
  const sfx = {
    pick() { tone(700, 0, 0.05, 'square', 0.05); },
    place() { tone(520, 0, 0.07, 'triangle', 0.14, 260); },
    err() { tone(200, 0, 0.28, 'sawtooth', 0.12, 80); },
    ding() { tone(N.A, 0, 0.16, 'sine', 0.16); tone(N.E2, 0.11, 0.3, 'sine', 0.14); },
    react() { tone(900, 0, 0.1, 'sine', 0.08, 1400); },
    score(pts) {
      const notes = pts >= 80 ? [N.C, N.E, N.G, N.C2, N.E2, N.G2] : pts >= 50 ? [N.C, N.E, N.G, N.C2, N.E2] : pts >= 30 ? [N.C, N.E, N.G, N.C2] : pts >= 15 ? [N.C, N.G, N.C2] : [N.G, N.C2];
      notes.forEach((f, i) => tone(f, i * 0.07, 0.22, 'triangle', 0.14));
    },
    bingo() {
      [N.C, N.E, N.G, N.C2, N.G, N.C2, N.E2, N.G2].forEach((f, i) => { tone(f, i * 0.09, 0.3, 'square', 0.08); tone(f / 2, i * 0.09, 0.3, 'triangle', 0.12); });
      tone(N.C2, 0.8, 0.9, 'sawtooth', 0.07); tone(N.E2, 0.8, 0.9, 'triangle', 0.1); tone(N.G2, 0.8, 0.9, 'triangle', 0.08);
    },
    win() {
      [N.G, N.G, N.G, N.C2, N.E2, N.C2, N.E2, N.G2].forEach((f, i) => tone(f, i * 0.16, 0.3, 'square', 0.09));
      tone(N.C2, 1.4, 1.2, 'triangle', 0.14); tone(N.E2, 1.4, 1.2, 'triangle', 0.1);
    },
    boom() { tone(120, 0, 0.35, 'sawtooth', 0.12, 40); tone(1800, 0, 0.12, 'square', 0.04, 300); },
  };
  function setMuted(m) { muted = m; try { localStorage.setItem('scr-mute', m ? '1' : '0'); } catch (e) {} }

  // ---------- Particules ----------
  const cv = document.getElementById('fx'), cx = cv.getContext('2d');
  let parts = [], raf = 0;
  const COLORS = ['#ffd426', '#ff5a5f', '#3ddc84', '#2433f2', '#ff8a00', '#ffffff', '#c04bff', '#2fd6ff'];
  function fit() { cv.width = innerWidth; cv.height = innerHeight; }
  addEventListener('resize', fit); fit();
  const rnd = (a, b) => a + Math.random() * (b - a);

  function burst(x, y, n, o) {
    o = o || {};
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), s = rnd(2, o.speed || 9);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (o.up || 2), g: o.g == null ? 0.18 : o.g, life: rnd(50, 100), max: 100, col: o.col || COLORS[i % COLORS.length], sz: rnd(4, 9), rot: rnd(0, 6), vr: rnd(-.3, .3), shape: o.shape || (Math.random() < .5 ? 'rect' : 'circle'), fade: o.fade });
    }
    start();
  }
  function rain(n) {
    for (let i = 0; i < n; i++) parts.push({ x: rnd(0, cv.width), y: rnd(-cv.height * .4, -10), vx: rnd(-1.5, 1.5), vy: rnd(2, 6), g: 0.04, life: rnd(120, 220), max: 220, col: COLORS[i % COLORS.length], sz: rnd(5, 11), rot: rnd(0, 6), vr: rnd(-.25, .25), shape: 'rect' });
    start();
  }
  function fireworks(count) {
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const x = rnd(cv.width * .15, cv.width * .85), y = rnd(cv.height * .12, cv.height * .5), c = COLORS[(Math.random() * COLORS.length) | 0];
        sfx.boom();
        burst(x, y, 60, { speed: 8, g: 0.06, col: c, shape: 'circle', up: 0, fade: true });
        burst(x, y, 20, { speed: 5, g: 0.06, col: '#fff', shape: 'circle', up: 0, fade: true });
      }, i * 350);
    }
  }
  function loop() {
    cx.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.99; p.rot += p.vr; p.life--;
      cx.globalAlpha = p.fade ? Math.max(0, p.life / p.max) : Math.min(1, p.life / 25);
      cx.fillStyle = p.col;
      if (p.shape === 'circle') { cx.beginPath(); cx.arc(p.x, p.y, p.sz / 2, 0, 7); cx.fill(); }
      else { cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.fillRect(-p.sz / 2, -p.sz / 3, p.sz, p.sz * .6); cx.restore(); }
    }
    cx.globalAlpha = 1;
    parts = parts.filter(p => p.life > 0 && p.y < cv.height + 30);
    raf = parts.length ? requestAnimationFrame(loop) : 0;
    if (!raf) cx.clearRect(0, 0, cv.width, cv.height);
  }
  function start() { if (!raf) raf = requestAnimationFrame(loop); }

  // ---------- Habillage ----------
  function banner(html, cls, ms) {
    const d = document.createElement('div');
    d.className = 'banner ' + (cls || ''); d.innerHTML = html;
    document.getElementById('banners').appendChild(d);
    setTimeout(() => d.remove(), ms || 2000);
  }
  function shake(strong) {
    const a = document.getElementById('app'), c = strong ? 'shake2' : 'shake';
    a.classList.remove('shake', 'shake2'); void a.offsetWidth; a.classList.add(c);
    setTimeout(() => a.classList.remove(c), 950);
  }
  function pointsPop(x, y, pts) {
    const d = document.createElement('div');
    d.className = 'pts-pop'; d.textContent = '+' + pts; d.style.left = x + 'px'; d.style.top = y + 'px';
    if (pts >= 50) d.style.fontSize = '72px';
    document.body.appendChild(d); setTimeout(() => d.remove(), 1600);
  }
  function toast(t) {
    const d = document.createElement('div'); d.className = 'toast'; d.textContent = t;
    document.getElementById('toasts').appendChild(d); setTimeout(() => d.remove(), 2700);
  }
  function floatEmoji(e, name) {
    const d = document.createElement('div'); d.className = 'react-f';
    d.style.left = rnd(10, 80) + '%';
    d.innerHTML = e + '<small></small>'; d.querySelector('small').textContent = name || '';
    document.body.appendChild(d); setTimeout(() => d.remove(), 2500);
  }

  // Réaction d'un coup selon les points
  function scoreFx(pts, bingo, cx0, cy0) {
    pointsPop(cx0, cy0, pts);
    sfx.score(pts);
    if (bingo) {
      sfx.bingo();
      banner('SCRABBLE !<small>+50 de bonus · ' + pts + ' points</small>', 'big', 2600);
      shake(true); rain(180); fireworks(5);
      burst(cx0, cy0, 120, { speed: 12 });
    } else if (pts >= 80) {
      banner('ÉPIQUE !!!<small>' + pts + ' points</small>', 'big', 2300);
      shake(true); fireworks(3); burst(cx0, cy0, 100, { speed: 11 });
    } else if (pts >= 50) {
      banner('ÉNORME !<small>' + pts + ' points</small>', '', 2000);
      shake(false); rain(80); burst(cx0, cy0, 60);
    } else if (pts >= 30) {
      banner('Joli coup !', '', 1600);
      burst(cx0, cy0, 40);
    } else if (pts >= 15) {
      burst(cx0, cy0, 18, { speed: 6 });
    }
  }

  return { sfx, ac, setMuted, isMuted: () => muted, burst, rain, fireworks, banner, shake, toast, floatEmoji, scoreFx };
})();
