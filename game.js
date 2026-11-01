'use strict';
/* Scrabble · ChadGangGames
   - Règles françaises (102 jetons, plateau 15x15, bonus de 50 pts pour 7 lettres)
   - Multijoueur en ligne via le SDK du hub (état complet versionné envoyé avec keep)
   - Dictionnaire : fichier mots.txt (un mot par ligne). Sans lui : mode « contestation ». */

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Données du jeu ----------
const LETTERS = { A: [9, 1], B: [2, 3], C: [2, 3], D: [3, 2], E: [15, 1], F: [2, 4], G: [2, 2], H: [2, 4], I: [8, 1], J: [1, 8], K: [1, 10], L: [5, 1], M: [3, 2], N: [6, 1], O: [6, 1], P: [2, 3], Q: [1, 8], R: [6, 1], S: [6, 1], T: [6, 1], U: [6, 1], V: [2, 4], W: [1, 10], X: [1, 10], Y: [1, 10], Z: [1, 10], '*': [2, 0] };
const val = ch => (ch === '*' || ch !== ch.toUpperCase()) ? 0 : LETTERS[ch][1]; // minuscule = joker posé
const rackValue = s => [...s].reduce((a, c) => a + val(c), 0);
const COLS = ['#e0453a', '#2a7de1', '#1fa463', '#c04bff'];

const PREM = (() => {
  const g = Array.from({ length: 15 }, () => Array(15).fill(''));
  const set = (code, list) => list.forEach(([r, c]) => {
    [[r, c], [r, 14 - c], [14 - r, c], [14 - r, 14 - c], [c, r], [c, 14 - r], [14 - c, r], [14 - c, 14 - r]].forEach(([a, b]) => { g[a][b] = code; });
  });
  set('MT', [[0, 0], [0, 7]]);
  set('MD', [[1, 1], [2, 2], [3, 3], [4, 4], [7, 7]]);
  set('LT', [[1, 5], [5, 5]]);
  set('LD', [[0, 3], [2, 6], [3, 7], [6, 6]]);
  return g;
})();

// ---------- Dictionnaire ----------
let DICO = null;
async function loadDico() {
  try {
    const r = await fetch('mots.txt');
    if (!r.ok) throw 0;
    const t = (await r.text()).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const set = new Set(t.split(/[\s,;]+/));
    set.delete('');
    DICO = set.size > 1000 ? set : null;
  } catch (e) { DICO = null; }
  await refreshListe();
  $('#dicoInfo').textContent = DICO ? '📖 Dico : ' + DICO.size.toLocaleString('fr') + ' mots' : '⚖️ Sans dico : on peut contester un coup';
}
async function refreshListe() {
  if (!DICO || !CG.liste) return;
  try {
    const { items } = await CG.liste('mots').lire();
    items.filter(i => i.statut === 'ok').forEach(i => DICO.add(String(i.valeur).toUpperCase()));
  } catch (e) {}
}

// ---------- SDK du hub (ou version locale de secours) ----------
function mockSDK() {
  let id; try { id = sessionStorage.getItem('scr-id'); } catch (e) {}
  if (!id) { id = 'L' + Math.random().toString(36).slice(2, 6); try { sessionStorage.setItem('scr-id', id); } catch (e) {} }
  const name = 'Joueur ' + id.slice(1, 3).toUpperCase();
  return {
    me: async () => ({ id, name, avatar: null, isAdmin: false, isModo: false, roles: [] }),
    room: () => new URLSearchParams(location.search).get('room'),
    finPartie: async () => ({}),
    join(code) {
      const bc = new BroadcastChannel('scr-' + code), h = {}, peers = new Map();
      const self = { id, name, t: Date.now() + Math.random() };
      const ev = (n, ...a) => (h[n] || []).forEach(f => f(...a));
      const list = () => [...peers.values(), self].sort((a, b) => a.t - b.t).map(({ id, name }) => ({ id, name }));
      const key = 'scr-last-' + code;
      bc.onmessage = m => {
        const d = m.data;
        if (d.k === 'hello') { peers.set(d.p.id, d.p); if (!d.re) bc.postMessage({ k: 'hello', p: self, re: 1 }); ev('players', list()); }
        else if (d.k === 'bye') { peers.delete(d.id); ev('players', list()); }
        else if (d.k === 'msg') ev('message', d.data, { id: d.from.id, name: d.from.name });
      };
      addEventListener('pagehide', () => bc.postMessage({ k: 'bye', id }));
      setTimeout(() => {
        let last = null; try { last = JSON.parse(localStorage.getItem(key)); } catch (e) {}
        bc.postMessage({ k: 'hello', p: self });
        ev('ready', { me: id, players: list(), last });
      }, 60);
      return {
        on(n, f) { (h[n] = h[n] || []).push(f); },
        send(data, o) { if (o && o.keep) { try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {} } bc.postMessage({ k: 'msg', from: self, data }); ev('message', data, self); },
        leave() { bc.postMessage({ k: 'bye', id }); bc.close(); },
      };
    },
  };
}
const CG = window.ChadGang || mockSDK();

// ---------- État ----------
let me = { id: '', name: 'Joueur', avatar: null };
let room = null, roomCode = '', roomPlayers = [];
let S = null;                 // état partagé de la partie
let rack = [], pending = [], sel = null; // chevalet local, lettres posées en attente
let reportedGid = '';

const myIndex = () => S ? S.pl.findIndex(p => p.id === me.id) : -1;
const isHost = () => roomPlayers.length && roomPlayers[0].id === me.id;
const myTurn = () => S && S.phase === 'play' && myIndex() === S.turn;
const canEdit = () => S && S.phase === 'play' && myIndex() >= 0;
const cellFree = (r, c) => S.bd[r * 15 + c] === '.' && !pending.some(p => p.r === r && p.c === c);

// ---------- Règles ----------
function evalMove(bd, placed) {
  if (!placed.length) return { ok: false, err: '' };
  const ov = new Map(placed.map(p => [p.r * 15 + p.c, p.ch]));
  const at = (r, c) => {
    if (r < 0 || c < 0 || r > 14 || c > 14) return '.';
    const o = ov.get(r * 15 + c);
    return o !== undefined ? o : bd[r * 15 + c];
  };
  if (placed.some(p => bd[p.r * 15 + p.c] !== '.')) return { ok: false, err: 'Case déjà occupée' };
  const rows = new Set(placed.map(p => p.r)), cols = new Set(placed.map(p => p.c));
  if (rows.size > 1 && cols.size > 1) return { ok: false, err: 'Les lettres doivent être alignées' };
  const first = !/[A-Za-z]/.test(bd);
  let horiz;
  if (placed.length === 1) { const { r, c } = placed[0]; horiz = at(r, c - 1) !== '.' || at(r, c + 1) !== '.'; }
  else horiz = rows.size === 1;
  const [dr, dc] = horiz ? [0, 1] : [1, 0];
  // pas de trou entre la première et la dernière lettre posée
  const idx = placed.map(p => horiz ? p.c : p.r), lo = Math.min(...idx), hi = Math.max(...idx);
  for (let k = lo; k <= hi; k++) {
    const r = horiz ? placed[0].r : k, c = horiz ? k : placed[0].c;
    if (at(r, c) === '.') return { ok: false, err: 'Il y a un trou dans ton mot' };
  }
  if (first) {
    if (!ov.has(7 * 15 + 7)) return { ok: false, err: 'Le premier mot passe par l\'étoile ★' };
    if (placed.length < 2) return { ok: false, err: 'Un mot fait au moins 2 lettres' };
  } else {
    const B = (r, c) => (r < 0 || c < 0 || r > 14 || c > 14) ? '.' : bd[r * 15 + c];
    const touch = placed.some(p => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => B(p.r + a, p.c + b) !== '.'));
    if (!touch) return { ok: false, err: 'Le mot doit toucher des lettres déjà posées' };
  }
  const wordAt = (r, c, a, b) => {
    while (at(r - a, c - b) !== '.') { r -= a; c -= b; }
    const cells = [];
    while (at(r, c) !== '.') { cells.push([r, c]); r += a; c += b; }
    return cells;
  };
  const lists = [];
  const main = wordAt(placed[0].r, placed[0].c, dr, dc);
  if (main.length >= 2) lists.push(main);
  for (const p of placed) { const w = wordAt(p.r, p.c, dc, dr); if (w.length >= 2) lists.push(w); }
  if (!lists.length) return { ok: false, err: 'Un mot fait au moins 2 lettres' };
  let total = 0; const words = [];
  for (const cells of lists) {
    let s = 0, m = 1, str = '';
    for (const [r, c] of cells) {
      const ch = at(r, c); str += ch.toUpperCase();
      let v = val(ch);
      if (ov.has(r * 15 + c)) {
        const pr = PREM[r][c];
        if (pr === 'LD') v *= 2; else if (pr === 'LT') v *= 3; else if (pr === 'MD') m *= 2; else if (pr === 'MT') m *= 3;
      }
      s += v;
    }
    s *= m; total += s; words.push({ w: str, pts: s });
  }
  const bingo = placed.length === 7;
  if (bingo) total += 50;
  return { ok: true, words, total, bingo, main: words[0].w };
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; }
function freshBag() { const b = []; for (const k in LETTERS) for (let i = 0; i < LETTERS[k][0]; i++) b.push(k); return shuffle(b); }

function startGame() {
  const pl = roomPlayers.slice(0, 4).map(p => ({ id: p.id, name: p.name, score: 0 }));
  if (pl.length < 2) { FX.toast('Il faut au moins 2 joueurs'); return; }
  const bag = freshBag(), rk = {};
  pl.forEach(p => { rk[p.id] = bag.splice(0, 7).join(''); });
  S = null;
  publish({ v: (window.__lastV || 0) + 1, gid: roomCode + '-' + Date.now().toString(36), phase: 'play', pl, rk, bag: bag.join(''), bd: '.'.repeat(225), turn: (Math.random() * pl.length) | 0, ns: 0, log: [], last: null, prev: null, over: null });
}

// Envoie un nouvel état (et l'applique tout de suite chez moi)
function publish(st) {
  window.__lastV = st.v;
  room.send({ t: 'state', s: st }, { keep: true });
  onState(st);
}

function finishGame(st, emptier) {
  // pénalités : chacun perd la valeur de son chevalet ; celui qui a fini les récupère
  const pen = {}; let sum = 0;
  st.pl.forEach(p => { const v = rackValue(st.rk[p.id]); pen[p.id] = v; sum += v; p.score -= v; });
  if (emptier != null) { st.pl[emptier].score += sum; }
  const best = Math.max(...st.pl.map(p => p.score));
  st.phase = 'over';
  st.over = { win: st.pl.filter(p => p.score === best).map(p => p.id), pen };
}

async function doPlay() {
  if (!myTurn() || !pending.length) return;
  const placed = pending.map(p => ({ r: p.r, c: p.c, ch: p.ch === '*' ? p.as.toLowerCase() : p.ch }));
  const res = evalMove(S.bd, placed);
  if (!res.ok) return deny(res.err);
  if (DICO) {
    await refreshListe();
    const bad = res.words.filter(w => !DICO.has(w.w));
    if (bad.length) return deny('« ' + bad[0].w + ' » n\'est pas dans le dico');
  }
  const st = JSON.parse(JSON.stringify(S));
  const meI = st.turn, p = st.pl[meI];
  st.prev = { bd: S.bd, rk: S.rk, bag: S.bag, sc: S.pl.map(x => x.score), turn: S.turn, ns: S.ns };
  const r = st.rk[p.id].split('');
  pending.forEach(t => { const i = r.indexOf(t.ch); if (i >= 0) r.splice(i, 1); });
  const bag = st.bag.split('');
  while (r.length < 7 && bag.length) r.push(bag.pop());
  const bd = st.bd.split('');
  placed.forEach(t => { bd[t.r * 15 + t.c] = t.ch; });
  st.bd = bd.join(''); st.bag = bag.join(''); st.rk[p.id] = r.join('');
  p.score += res.total; st.ns = 0;
  st.log = st.log.concat([{ p: meI, t: 'play', w: res.main, pts: res.total, b: res.bingo ? 1 : 0 }]).slice(-30);
  st.last = { cells: placed.map(t => [t.r, t.c]), p: meI, pts: res.total, b: res.bingo ? 1 : 0, w: res.main };
  if (!r.length && !bag.length) { finishGame(st, meI); st.prev = null; }
  else st.turn = (st.turn + 1) % st.pl.length;
  st.v = S.v + 1;
  pending = []; sel = null;
  publish(st);
}

function doPass(forIdx) {
  if (!S || S.phase !== 'play') return;
  const idx = forIdx != null ? forIdx : S.turn;
  if (forIdx == null && !myTurn()) return;
  const st = JSON.parse(JSON.stringify(S));
  st.ns++; st.prev = null; st.last = null;
  st.log = st.log.concat([{ p: idx, t: forIdx != null ? 'away' : 'pass' }]).slice(-30);
  if (st.ns >= 6) finishGame(st, null); else st.turn = (st.turn + 1) % st.pl.length;
  st.v = S.v + 1;
  pending = []; sel = null;
  publish(st);
}

function doSwap(chars) {
  if (!myTurn() || !chars.length || S.bag.length < 7) return;
  const st = JSON.parse(JSON.stringify(S)), p = st.pl[st.turn];
  const r = st.rk[p.id].split(''), bag = st.bag.split('');
  const out = [];
  chars.forEach(c => { const i = r.indexOf(c); if (i >= 0) out.push(r.splice(i, 1)[0]); });
  while (r.length < 7 && bag.length) r.push(bag.pop());
  bag.push(...out); shuffle(bag);
  st.bag = bag.join(''); st.rk[p.id] = r.join('');
  st.ns++; st.prev = null; st.last = null;
  st.log = st.log.concat([{ p: st.turn, t: 'swap', n: out.length }]).slice(-30);
  if (st.ns >= 6) finishGame(st, null); else st.turn = (st.turn + 1) % st.pl.length;
  st.v = S.v + 1;
  pending = []; sel = null;
  publish(st);
}

// Sans dico : un adversaire conteste le dernier coup -> annulé, le joueur perd son tour
function doContest() {
  if (DICO || !S || !S.prev || S.phase !== 'play' || myIndex() < 0 || S.last == null || S.last.p === myIndex()) return;
  const pv = S.prev, st = JSON.parse(JSON.stringify(S));
  st.bd = pv.bd; st.rk = pv.rk; st.bag = pv.bag;
  st.pl.forEach((p, i) => { p.score = pv.sc[i]; });
  const culprit = S.last.p;
  st.turn = (culprit + 1) % st.pl.length; st.ns = pv.ns + 1;
  st.log = st.log.concat([{ p: myIndex(), t: 'contest', w: S.last.w, q: culprit }]).slice(-30);
  st.last = null; st.prev = null; st.v = S.v + 1;
  publish(st);
}

// ---------- Réception d'un état ----------
function onState(st) {
  if (!st || (S && st.v <= S.v)) return;
  const old = S;
  S = st;
  window.__lastV = st.v;
  syncRack();
  $('#lobby').classList.remove('on');
  render(old && old.v !== st.v ? old : null, !old);
}

function syncRack() {
  const mine = S && S.rk[me.id];
  if (mine === undefined) { rack = []; pending = []; return; }
  const a = [...rack].sort().join(''), b = [...mine].sort().join('');
  if (a !== b) {
    pending = [];
    const cnt = {}; for (const c of mine) cnt[c] = (cnt[c] || 0) + 1;
    const nr = [];
    for (const c of rack) if (cnt[c] > 0) { nr.push(c); cnt[c]--; }
    for (const c in cnt) for (let i = 0; i < cnt[c]; i++) nr.push(c);
    rack = nr;
  }
  pending = pending.filter(p => S.bd[p.r * 15 + p.c] === '.');
  sel = null;
}

// ---------- Affichage ----------
function tileHTML(ch, cls, slot, extra) {
  const up = ch.toUpperCase(), jk = ch !== up;
  return `<div class="${cls}${jk ? ' jk' : ''}"${slot != null ? ` data-slot="${slot}"` : ''}${extra || ''}>${up}<i>${jk ? '' : val(ch)}</i></div>`;
}

function renderBoard(popSet, golden) {
  const lastSet = new Set(S && S.last ? S.last.cells.map(([r, c]) => r * 15 + c) : []);
  const pend = new Map(pending.map(p => [p.r * 15 + p.c, p]));
  let h = '', k = 0;
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
    const i = r * 15 + c, ch = S ? S.bd[i] : '.', pr = PREM[r][c];
    let inner = '';
    if (ch !== '.') {
      const isLast = lastSet.has(i);
      const cls = 'tile' + (isLast ? ' last' : '') + (popSet && isLast ? ' pop' : '') + (golden && isLast ? ' golden' : '');
      inner = tileHTML(ch, cls, null, popSet && isLast ? ` style="animation-delay:${(k++) * 70}ms"` : '');
    } else if (pend.has(i)) {
      const p = pend.get(i);
      inner = tileHTML(p.ch === '*' ? p.as.toLowerCase() : p.ch, 'tile pend', p.slot);
    } else if (r === 7 && c === 7) inner = '<span class="lbl" style="font-size:1em">★</span>';
    else if (pr) inner = `<span class="lbl">${pr}</span>`;
    h += `<div class="cell ${pr ? 'p' + pr : ''}" data-r="${r}" data-c="${c}">${inner}</div>`;
  }
  $('#board').innerHTML = h;
}

function renderRack() {
  const el = $('#rack');
  if (myIndex() < 0) { el.innerHTML = '<span class="rack-empty">👀 Tu regardes la partie</span>'; return; }
  el.innerHTML = rack.map((ch, i) => {
    if (pending.some(p => p.slot === i)) return '<div class="rtile gone"></div>';
    const jk = ch === '*';
    return `<div class="rtile${i === sel ? ' sel' : ''}${jk ? ' jk' : ''}" data-slot="${i}">${jk ? '★' : ch}<i>${jk ? '' : val(ch)}</i></div>`;
  }).join('');
}

const away = p => !roomPlayers.some(x => x.id === p.id);
function avatarHTML(p, i) {
  if (p.id === me.id && me.avatar) return `<img class="av" src="${esc(me.avatar)}" data-chadgang-id="${esc(p.id)}" alt="">`;
  return `<span class="av" data-chadgang-id="${esc(p.id)}" style="background:${COLS[i % 4]}">${esc(p.name.trim().charAt(0).toUpperCase())}</span>`;
}
let lastScores = {};
function renderPlayers() {
  const list = S ? S.pl : roomPlayers.slice(0, 4).map(p => ({ ...p, score: 0 }));
  $('#players').innerHTML = list.map((p, i) => {
    const bump = lastScores[p.id] !== undefined && lastScores[p.id] !== p.score;
    return `<div class="pl${S && S.phase === 'play' && i === S.turn ? ' turn' : ''}${S && away(p) ? ' away' : ''}">${avatarHTML(p, i)}<div class="pn"><b>${esc(p.name)}${p.id === me.id ? ' (moi)' : ''}</b><span class="sc${bump ? ' bump' : ''}">${p.score}</span></div></div>`;
  }).join('');
  lastScores = Object.fromEntries(list.map(p => [p.id, p.score]));
}

function renderHist() {
  if (!S) { $('#hist').innerHTML = ''; return; }
  const nm = i => esc((S.pl[i] || { name: '?' }).name);
  $('#hist').innerHTML = S.log.slice().reverse().slice(0, 14).map(l => {
    if (l.t === 'play') return `<li>${nm(l.p)} : <b>${l.w}</b> (+${l.pts})${l.b ? ' 🎆 SCRABBLE' : ''}</li>`;
    if (l.t === 'pass') return `<li>${nm(l.p)} passe</li>`;
    if (l.t === 'away') return `<li>${nm(l.p)} est absent : tour passé</li>`;
    if (l.t === 'swap') return `<li>${nm(l.p)} échange ${l.n} lettre${l.n > 1 ? 's' : ''}</li>`;
    if (l.t === 'contest') return `<li>⚖️ ${nm(l.p)} conteste « ${l.w} » : coup annulé pour ${nm(l.q)}</li>`;
    return '';
  }).join('');
}

function setMsg(html, kind) { const m = $('#msg'); m.className = kind || ''; m.innerHTML = html; }

function updatePreview() {
  const play = $('#bPlay');
  play.disabled = true; play.textContent = 'Jouer';
  const spect = myIndex() < 0;
  const inGame = S && S.phase === 'play';
  $('#bPass').disabled = !myTurn(); $('#bSwap').disabled = !myTurn() || S.bag.length < 7;
  $('#bRecall').disabled = !pending.length; $('#bShuffle').disabled = spect || !inGame;
  if (!S) { setMsg('En attente du lancement…'); return; }
  $('#bagInfo').textContent = '🎒 Sac : ' + S.bag.length + ' lettre' + (S.bag.length > 1 ? 's' : '');
  if (S.phase === 'over') { setMsg('🏁 Partie terminée !', 'ok'); return; }
  const cur = S.pl[S.turn];
  if (!myTurn() && away(cur)) {
    setMsg(`👻 ${esc(cur.name)} a quitté la salle. <button class="btn sm" id="bAway">Passer son tour</button>`, 'warn');
    return;
  }
  if (!pending.length) {
    let t = myTurn() ? '🟢 <b>À toi de jouer !</b>' : `⏳ ${esc(cur.name)} réfléchit…`;
    if (!DICO && S.prev && S.last && S.last.p !== myIndex() && myIndex() >= 0) t += ` <button class="btn sm bad" id="bContest">⚖️ Contester « ${esc(S.last.w)} »</button>`;
    setMsg(t);
    return;
  }
  const res = evalMove(S.bd, pending.map(p => ({ r: p.r, c: p.c, ch: p.ch === '*' ? p.as.toLowerCase() : p.ch })));
  if (!res.ok) { setMsg(esc(res.err), 'warn'); return; }
  const bad = DICO ? res.words.filter(w => !DICO.has(w.w)) : [];
  const ws = res.words.map(w => `<span class="w">${w.w}</span> ${w.pts}`).join(' · ') + (res.bingo ? ' · 🎆 +50' : '');
  if (bad.length) {
    setMsg(`❌ « ${bad[0].w} » n'est pas dans le dico` + (CG.liste ? ` <button class="btn sm" id="bPropose" data-w="${bad[0].w}">Le proposer</button>` : ''), 'warn');
    return;
  }
  setMsg(ws + ` = <b>${res.total} pts</b>`, 'ok');
  if (myTurn()) { play.disabled = false; play.textContent = `Jouer (+${res.total})`; }
}

function renderEnd() {
  if (!S || S.phase !== 'over') { $('#endOv').classList.remove('on'); return; }
  const rows = S.pl.map((p, i) => ({ p, i })).sort((a, b) => b.p.score - a.p.score);
  $('#endRank').innerHTML = rows.map(({ p }) => `<div class="${S.over.win.includes(p.id) ? 'win' : ''}"><span>${S.over.win.includes(p.id) ? '👑 ' : ''}${esc(p.name)}</span><b>${p.score}</b></div>`).join('');
  const w = S.pl.filter(p => S.over.win.includes(p.id)).map(p => p.name).join(' & ');
  const iWon = S.over.win.includes(me.id);
  $('#endTitle').textContent = iWon ? '🏆 Victoire !' : (myIndex() < 0 ? 'Fin de partie' : 'Perdu… 😅');
  $('#endNote').textContent = w + (S.over.win.length > 1 ? ' gagnent' : ' gagne') + ' la partie ! (points des lettres restantes déduits)';
  $('#endAgain').style.display = isHost() ? '' : 'none';
  $('#endOv').classList.add('on');
}

function render(old, quiet) {
  if (S.phase !== 'over') $('#endOv').classList.remove('on');
  const justPlayed = !!(old && S.last && S.v !== old.v);
  const popSet = justPlayed;
  renderBoard(popSet, justPlayed && S.last.b);
  renderRack(); renderPlayers(); renderHist(); updatePreview();
  $('#roomTag').hidden = !roomCode; $('#roomTag').textContent = roomCode;
  $('#btnLeave').hidden = !roomCode;
  if (!old) {
    if (S.phase === 'over') { renderEnd(); reportEnd(); }
    else if (myTurn()) { FX.sfx.ding(); FX.toast('🟢 À toi de jouer !'); }
    return;
  }

  // effets du coup qui vient d'arriver
  if (justPlayed) {
    const bEl = $('#board').getBoundingClientRect();
    const [lr, lc] = S.last.cells[(S.last.cells.length / 2) | 0];
    const cs = bEl.width / 15;
    FX.scoreFx(S.last.pts, !!S.last.b, bEl.left + (lc + .5) * cs, bEl.top + (lr + .5) * cs);
    for (let k = 0; k < S.last.cells.length; k++) setTimeout(() => FX.sfx.place(), k * 70);
  } else if (S.log.length && S.log[S.log.length - 1].t === 'contest') {
    FX.sfx.err(); FX.shake(false); FX.toast('⚖️ Coup contesté et annulé !');
  }
  if (S.phase === 'over' && old.phase !== 'over') {
    setTimeout(() => {
      renderEnd(); reportEnd();
      FX.sfx.win(); FX.rain(260); FX.fireworks(8);
      if (S.over.win.includes(me.id)) FX.banner('VICTOIRE !<small>Bien joué 👑</small>', 'big', 3200);
      else FX.banner('Fin de partie', '', 2200);
    }, justPlayed && S.last.b ? 2400 : 900);
  } else if (S.phase === 'play' && myTurn() && old.turn !== S.turn) {
    setTimeout(() => { FX.sfx.ding(); FX.toast('🟢 À toi de jouer !'); }, justPlayed ? 700 : 0);
  }
}

// Classement all time : chaque joueur déclare son résultat une fois la partie finie
function reportEnd() {
  if (!S || S.phase !== 'over' || myIndex() < 0 || reportedGid === S.gid) return;
  reportedGid = S.gid;
  if (window.ChadGang && ChadGang.finPartie) {
    ChadGang.finPartie({ gagne: S.over.win.includes(me.id), partie: S.gid, score: Math.max(0, S.pl[myIndex()].score) }).catch(() => {});
  }
}

function deny(msg) {
  FX.sfx.err(); setMsg('❌ ' + esc(msg), 'warn');
  const b = $('#board'); b.classList.remove('deny'); void b.offsetWidth; b.classList.add('deny');
}

// ---------- Actions sur le chevalet ----------
function placeTile(slot, r, c) {
  if (!canEdit() || !cellFree(r, c) || rack[slot] === undefined) return;
  const put = as => {
    pending = pending.filter(p => p.slot !== slot);
    pending.push({ r, c, slot, ch: rack[slot], as });
    sel = null; FX.sfx.place();
    renderBoard(); renderRack(); updatePreview();
  };
  if (rack[slot] === '*') pickJoker(letter => put(letter)); else put(rack[slot]);
}
function recall(slot) {
  pending = pending.filter(p => p.slot !== slot); sel = null;
  FX.sfx.pick(); renderBoard(); renderRack(); updatePreview();
}
function recallAll() { pending = []; sel = null; renderBoard(); renderRack(); updatePreview(); }

function pickJoker(cb) {
  const g = $('#jokerGrid');
  g.innerHTML = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => `<button data-l="${l}">${l}</button>`).join('');
  g.onclick = e => { const b = e.target.closest('button'); if (!b) return; $('#jokerOv').classList.remove('on'); cb(b.dataset.l); };
  $('#jokerOv').classList.add('on');
}

// ---------- Glisser-déposer + clic ----------
let drag = null, suppress = false;
addEventListener('pointerdown', e => {
  FX.ac();
  const t = e.target.closest('[data-slot]');
  if (!t || (e.button || 0) > 0 || !canEdit() || t.closest('#swapRack')) return;
  drag = { slot: +t.dataset.slot, x: e.clientX, y: e.clientY, moved: false, ghost: null, from: t.classList.contains('pend') ? 'board' : 'rack', el: t };
});
addEventListener('pointermove', e => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) {
    drag.moved = true;
    const g = document.createElement('div'); g.className = 'ghost';
    const ch = rack[drag.slot]; g.textContent = ch === '*' ? '★' : ch;
    document.body.appendChild(g); drag.ghost = g; drag.el.classList.add('dragging');
    sel = null;
  }
  if (drag.moved) {
    drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = (e.clientY - 20) + 'px';
    document.querySelectorAll('.cell.hover').forEach(x => x.classList.remove('hover'));
    const el = document.elementFromPoint(e.clientX, e.clientY), cell = el && el.closest('.cell');
    if (cell) cell.classList.add('hover');
  }
});
function endDrag(e, cancel) {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.ghost) d.ghost.remove();
  document.querySelectorAll('.cell.hover').forEach(x => x.classList.remove('hover'));
  d.el.classList.remove('dragging');
  suppress = true; setTimeout(() => { suppress = false; }, 0);
  if (cancel) return;
  if (d.moved) {
    const el = document.elementFromPoint(e.clientX, e.clientY), cell = el && el.closest('.cell');
    if (cell) placeTile(d.slot, +cell.dataset.r, +cell.dataset.c);
    else if (d.from === 'board') recall(d.slot);
  } else if (d.from === 'rack') {
    sel = sel === d.slot ? null : d.slot; FX.sfx.pick(); renderRack();
  } else recall(d.slot);
}
addEventListener('pointerup', e => endDrag(e, false));
addEventListener('pointercancel', e => endDrag(e, true));

$('#board').addEventListener('click', e => {
  if (suppress) return;
  const cell = e.target.closest('.cell');
  if (!cell || sel === null) return;
  placeTile(sel, +cell.dataset.r, +cell.dataset.c);
});

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Enter') doPlay(); else if (e.key === 'Escape') recallAll();
});

// ---------- Boutons ----------
$('#bPlay').onclick = doPlay;
$('#bRecall').onclick = recallAll;
$('#bShuffle').onclick = () => { pending = []; shuffle(rack); sel = null; FX.sfx.pick(); renderBoard(); renderRack(); updatePreview(); };
$('#bPass').onclick = () => { if (myTurn()) doPass(); };
$('#bSwap').onclick = () => {
  if (!myTurn()) return;
  pending = []; renderBoard(); renderRack(); updatePreview();
  const chosen = new Set();
  const draw = () => {
    $('#swapRack').innerHTML = rack.map((ch, i) => `<div class="rtile${chosen.has(i) ? ' sel' : ''}${ch === '*' ? ' jk' : ''}" data-i="${i}">${ch === '*' ? '★' : ch}<i>${val(ch) || ''}</i></div>`).join('');
  };
  $('#swapRack').onclick = e => { const t = e.target.closest('[data-i]'); if (!t) return; const i = +t.dataset.i; chosen.has(i) ? chosen.delete(i) : chosen.add(i); FX.sfx.pick(); draw(); };
  $('#swapOk').onclick = () => { $('#swapOv').classList.remove('on'); doSwap([...chosen].map(i => rack[i])); };
  draw(); $('#swapOv').classList.add('on');
};
$('#swapCancel').onclick = () => $('#swapOv').classList.remove('on');
$('#jokerCancel').onclick = () => $('#jokerOv').classList.remove('on');
$('#msg').addEventListener('click', async e => {
  if (e.target.id === 'bAway') doPass(S.turn);
  else if (e.target.id === 'bContest') doContest();
  else if (e.target.id === 'bPropose') {
    try {
      const r = await CG.liste('mots').proposer(e.target.dataset.w);
      FX.toast(r.item && r.item.statut === 'ok' ? '✅ Mot ajouté au dico !' : '📨 Proposé aux modos');
      if (r.item && r.item.statut === 'ok') { DICO.add(e.target.dataset.w); updatePreview(); }
    } catch (err) { FX.toast('Déjà proposé ou impossible'); }
  }
});
$('#endClose').onclick = () => $('#endOv').classList.remove('on');
$('#endAgain').onclick = () => { $('#endOv').classList.remove('on'); startGame(); };
$('#btnSnd').onclick = () => { FX.setMuted(!FX.isMuted()); $('#btnSnd').textContent = FX.isMuted() ? '🔇' : '🔊'; FX.ac(); };
$('#btnSnd').textContent = FX.isMuted() ? '🔇' : '🔊';
$('#btnLeave').onclick = () => {
  try { localStorage.removeItem('scr-room'); } catch (e) {}
  if (room) room.leave();
  location.href = location.pathname;
};
let lastReact = 0;
$('#reacts').onclick = e => {
  const b = e.target.closest('button'); if (!b || !room || Date.now() - lastReact < 700) return;
  lastReact = Date.now(); room.send({ t: 'react', e: b.dataset.e });
};

// ---------- Salon ----------
function renderLobby() {
  $('#lbList').innerHTML = roomPlayers.map((p, i) => `<div>${avatarHTML(p, i)}<span>${esc(p.name)}${i === 0 ? ' 👑 hôte' : ''}${i >= 4 ? ' (spectateur)' : ''}</span></div>`).join('');
  const host = isHost(), n = roomPlayers.length;
  $('#bStart').style.display = host ? '' : 'none';
  $('#bStart').disabled = n < 2;
  $('#lbHint').textContent = host ? (n < 2 ? 'Attends au moins un ami…' : 'Tout le monde est là ? Lance !') : 'L\'hôte va lancer la partie…';
}

function connect(code, create) {
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) { $('#lbErr').textContent = 'Le code fait 4 à 12 caractères'; return; }
  $('#lbErr').textContent = '';
  roomCode = code;
  room = CG.join(code, { create });
  room.on('ready', info => {
    me.id = info.me || me.id; roomPlayers = info.players || [];
    try { localStorage.setItem('scr-room', code); } catch (e) {}
    $('#lbJoin').hidden = true; $('#lbWait').hidden = false; $('#lbCode').textContent = code;
    const last = info.last && (info.last.t ? info.last : info.last.data);
    if (last && last.t === 'state') onState(last.s);
    renderLobby(); renderPlayers(); $('#roomTag').hidden = false; $('#roomTag').textContent = code; $('#btnLeave').hidden = false;
    if (S) updatePreview();
  });
  room.on('players', list => {
    roomPlayers = list; renderLobby();
    if (S) { renderPlayers(); updatePreview(); renderEnd(); }
  });
  room.on('message', (d, from) => {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'state') onState(d.s);
    else if (d.t === 'react') { FX.floatEmoji(d.e, from && from.name); FX.sfx.react(); }
  });
  room.on('error', msg => {
    try { localStorage.removeItem('scr-room'); } catch (e) {}
    $('#lbJoin').hidden = false; $('#lbWait').hidden = true;
    $('#lbErr').textContent = typeof msg === 'string' ? msg : 'Salle introuvable'; roomCode = '';
  });
}

const randCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(Math.random() * 24) | 0]).join('');
$('#bCreate').onclick = () => { FX.ac(); connect($('#code').value.trim() || randCode(), true); };
$('#bJoin').onclick = () => { FX.ac(); connect($('#code').value.trim(), false); };
$('#code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#bJoin').click(); });
$('#bStart').onclick = () => { FX.ac(); startGame(); };

// ---------- Démarrage ----------
(async function init() {
  try { const m = await CG.me(); me = { id: m.id, name: m.name, avatar: m.avatar }; } catch (e) {}
  renderBoard(); renderRack(); renderPlayers(); updatePreview();
  loadDico();
  let code = null;
  try { code = CG.room(); } catch (e) {}
  if (code) { $('#code').value = code; connect(code, true); return; }
  let saved = null; try { saved = localStorage.getItem('scr-room'); } catch (e) {}
  if (saved) { $('#code').value = saved; connect(saved, false); }
})();
