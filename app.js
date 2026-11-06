// 高知 不動産相場・査定（試作）
'use strict';
const TSUBO = 3.30579; // 1坪 = 3.30579㎡
const D = window.KOCHI_DATA;
const ROWS = D.rows.map(r => Object.fromEntries(D.cols.map((c, i) => [c, r[i]])));
const LATEST_Q = Math.max(...ROWS.map(r => r.q || 0));
const COLORS = ['#b7d3f6', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'];

// ---------- 共通 ----------
const $ = s => document.querySelector(s);
const median = a => quantile(a, 0.5);
function quantile(arr, p) {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}
function wMedian(items) { // [{v,w}]
  const a = items.filter(x => Number.isFinite(x.v)).sort((x, y) => x.v - y.v);
  const tot = a.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (const x of a) { acc += x.w; if (acc >= tot / 2) return x.v; }
  return NaN;
}
const man = v => Number.isFinite(v) ? Math.round(v / 1e4).toLocaleString() + '万円' : '—';
const manT = v => Number.isFinite(v) ? (v / 1e4).toFixed(1) + '万円/坪' : '—';
const qLabel = q => q ? `${Math.floor(q)}年${Math.round((q % 1) * 4) + 1}Q` : '';
const pct = v => (v > 0 ? '+' : '') + Math.round(v * 100) + '%';
function distKm(a, b, c, d) {
  const R = 6371, r = Math.PI / 180;
  const x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 地図用の指標（土地=坪単価、戸建=総額、マンション=坪単価）
function metric(r) {
  if (r.t === 'L') return r.area >= 30 && r.area <= 2000 ? r.price / r.area * TSUBO : NaN;
  if (r.t === 'H') return r.price;
  if (r.t === 'M') return r.area >= 15 ? r.price / r.area * TSUBO : NaN;
}
const fmtMetric = (t, v) => t === 'H' ? man(v) : manT(v);
const METRIC_NAME = { L: '土地の坪単価', H: '戸建の取引価格', M: 'マンションの坪単価' };

$('#srcNote').innerHTML = `出典：${esc(D.source)}<br>データ作成日 ${esc(D.built_at)}・地区の位置は代表点`;

// ---------- タブ ----------
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === b.dataset.view));
  setTimeout(() => { map.invalidateSize(); apMap && apMap.invalidateSize(); }, 50);
  if (b.dataset.view === 'records') window.renderRecords?.();
});

// ---------- 相場マップ ----------
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };
let baseKey = store.get('kochi_base', 'original');
const map = L.map('map', { zoomControl: true, preferCanvas: false, tap: true }).setView([33.45, 133.35], 9);
let baseLayer = makeBase(baseKey).addTo(map);
document.querySelectorAll('#baseSeg button').forEach(b => {
  b.classList.toggle('on', b.dataset.b === baseKey);
  b.onclick = () => {
    document.querySelectorAll('#baseSeg button').forEach(x => x.classList.toggle('on', x === b));
    map.removeLayer(baseLayer); baseKey = b.dataset.b; store.set('kochi_base', baseKey);
    baseLayer = makeBase(baseKey).addTo(map); baseLayer.bringToBack?.();
  };
});
const layer = L.layerGroup().addTo(map);
const state = { t: 'L', p: 2, level: 'dist', selected: null };

function bindSeg(id, key, attr, parse = v => v) {
  document.querySelectorAll(`#${id} button`).forEach(b => b.onclick = () => {
    document.querySelectorAll(`#${id} button`).forEach(x => x.classList.toggle('on', x === b));
    state[key] = parse(b.dataset[attr]); state.selected = null; render();
  });
}
bindSeg('typeSeg', 't', 't');
bindSeg('periodSeg', 'p', 'p', Number);
bindSeg('levelSeg', 'level', 'l');

function groups() {
  const minQ = state.p === 2 ? LATEST_Q - 2 + 0.25 : 0;
  const g = new Map();
  for (const r of ROWS) {
    if (r.t !== state.t || r.q < minQ) continue;
    const v = metric(r); if (!Number.isFinite(v)) continue;
    const key = state.level === 'city' ? r.city : r.city + '|' + r.dist;
    if (!g.has(key)) g.set(key, { key, city: r.city, dist: state.level === 'city' ? '' : r.dist, rows: [], pts: new Map() });
    const o = g.get(key); o.rows.push(r); o.pts.set(r.lat + ',' + r.lng, [r.lat, r.lng]);
  }
  for (const o of g.values()) {
    const vs = o.rows.map(metric);
    o.med = median(vs); o.q1 = quantile(vs, .25); o.q3 = quantile(vs, .75); o.n = vs.length;
    const pts = [...o.pts.values()];
    o.lat = pts.reduce((s, p) => s + p[0], 0) / pts.length; o.lng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  }
  return [...g.values()];
}

function niceBreaks(vals) {
  const raw = [1, 2, 3, 4, 5].map(i => quantile(vals, i / 6));
  const round = v => { const m = 10 ** Math.floor(Math.log10(v)) ; return Math.round(v / (m / 2)) * (m / 2); };
  return [...new Set(raw.map(round))];
}
const colorOf = (v, br) => COLORS[Math.min(br.filter(b => v >= b).length, COLORS.length - 1)];

let current = [];
function render() {
  current = groups();
  const br = niceBreaks(current.map(g => g.med));
  layer.clearLayers();
  const maxN = Math.max(...current.map(g => g.n));
  for (const g of current.sort((a, b) => b.n - a.n)) {
    const rad = state.level === 'city' ? 10 + 22 * Math.sqrt(g.n / maxN) : 5 + 13 * Math.sqrt(g.n / maxN);
    const c = L.circleMarker([g.lat, g.lng], {
      radius: rad, color: '#ffffff', weight: 2, fillColor: colorOf(g.med, br), fillOpacity: g.n < 3 ? 0.55 : 0.92,
    }).addTo(layer);
    c.bindTooltip(`<b>${esc(g.city)} ${esc(g.dist)}</b><br>${METRIC_NAME[state.t]} 中央値 <b>${fmtMetric(state.t, g.med)}</b><br>${g.n}件${g.n < 3 ? '（件数が少なく参考値）' : ''}`, { sticky: true });
    c.on('click', e => { L.DomEvent.stopPropagation(e); state.selected = g.key; showDetail(g); });
  }
  // 凡例
  const ranges = COLORS.slice(0, br.length + 1).map((col, i) => {
    const lo = i === 0 ? null : br[i - 1], hi = br[i];
    const f = v => state.t === 'H' ? Math.round(v / 1e4).toLocaleString() + '万' : (v / 1e4).toFixed(0) + '万';
    return `<div class="row"><span class="sw" style="background:${col}"></span>${lo == null ? f(hi) + '未満' : hi == null ? f(lo) + '以上' : f(lo) + '〜' + f(hi)}</div>`;
  }).reverse().join('');
  $('#legend').innerHTML = `<div class="t">${METRIC_NAME[state.t]}（中央値）${state.t === 'H' ? '' : '<br><span class="sub">単位：円/坪</span>'}</div>${ranges}<div class="note">円の大きさ＝取引件数。薄い円は3件未満。</div>
    <div class="lpLeg"><div class="row"><span class="lp-pt" style="transform:rotate(45deg) scale(.8)"></span>地価公示・調査（住宅地）</div><div class="row"><span class="lp-pt c" style="transform:rotate(45deg) scale(.8)"></span>地価公示・調査（商業地）</div></div>`;
  $('#distList').innerHTML = current.filter(g => g.dist).map(g => `<option value="${esc(g.city)} ${esc(g.dist)}">`).join('');
  const sel = current.find(g => g.key === state.selected);
  sel ? showDetail(sel) : showRanking();
}

function showRanking() {
  const minQ = state.p === 2 ? LATEST_Q - 2 + 0.25 : 0;
  const byCity = new Map();
  for (const r of ROWS) {
    if (r.t !== state.t || r.q < minQ) continue;
    const v = metric(r); if (!Number.isFinite(v)) continue;
    (byCity.get(r.city) || byCity.set(r.city, []).get(r.city)).push(v);
  }
  const list = [...byCity].map(([c, vs]) => ({ c, med: median(vs), n: vs.length })).sort((a, b) => b.med - a.med);
  const total = list.reduce((s, x) => s + x.n, 0);
  $('#side').innerHTML = `
    <h2>${METRIC_NAME[state.t]} 市町村ランキング</h2>
    <div class="sub">${state.p === 2 ? '直近2年' : '2021年〜'}・${total.toLocaleString()}件・地図の円をクリックすると地区の詳細</div>
    <table style="margin-top:12px"><thead><tr><th>#</th><th>市町村</th><th class="n">中央値</th><th class="n">件数</th></tr></thead>
    <tbody>${list.map((x, i) => `<tr class="click" data-city="${esc(x.c)}"><td>${i + 1}</td><td>${esc(x.c)}</td><td class="n">${fmtMetric(state.t, x.med)}</td><td class="n">${x.n}${x.n < 5 ? '*' : ''}</td></tr>`).join('')}</tbody></table>
    <div class="sub" style="margin-top:8px">* 5件未満は参考値。競売・関係者間などの特殊な取引は除外済み。</div>`;
  document.querySelectorAll('#side tr.click').forEach(tr => tr.onclick = () => {
    const pts = ROWS.filter(r => r.city === tr.dataset.city).map(r => [r.lat, r.lng]);
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.1));
  });
}

function showDetail(g) {
  const years = {};
  for (const r of g.rows) (years[Math.floor(r.q)] ||= []).push(metric(r));
  const ys = Object.keys(years).sort();
  const yMed = ys.map(y => median(years[y]));
  const maxY = Math.max(...yMed);
  const recent = [...g.rows].sort((a, b) => b.q - a.q).slice(0, 15);
  const areaMed = median(g.rows.map(r => r.area));
  $('#side').innerHTML = `
    <div class="sub"><a href="#" id="back">← ランキングに戻る</a></div>
    <h2 style="margin-top:8px">${esc(g.city)} ${esc(g.dist)}</h2>
    <div class="sub">${METRIC_NAME[state.t]}・${state.p === 2 ? '直近2年' : '2021年〜'}</div>
    <div class="hero">${fmtMetric(state.t, g.med)}<small>中央値</small></div>
    <dl class="kv">
      <dt>取引件数</dt><dd>${g.n}件${g.n < 3 ? '（少なく参考値）' : ''}</dd>
      <dt>中間の50%</dt><dd>${fmtMetric(state.t, g.q1)} 〜 ${fmtMetric(state.t, g.q3)}</dd>
      <dt>${state.t === 'M' ? '専有面積' : '土地面積'}の中央値</dt><dd>${Math.round(areaMed)}㎡（${(areaMed / TSUBO).toFixed(1)}坪）</dd>
    </dl>
    <h3>年別の中央値</h3>
    <div class="bars">${ys.map((y, i) => `<div class="b" title="${y}年 ${fmtMetric(state.t, yMed[i])}（${years[y].length}件）"><span class="v">${state.t === 'H' ? Math.round(yMed[i] / 1e4) : (yMed[i] / 1e4).toFixed(0)}</span><i style="height:${Math.max(2, yMed[i] / maxY * 60)}px"></i>${String(y).slice(2)}年</div>`).join('')}</div>
    <div class="sub">単位：${state.t === 'H' ? '万円' : '万円/坪'}。件数が少ない年は振れが大きい。</div>
    <h3>直近の取引</h3>
    <table><thead><tr><th>時期</th>${g.dist ? '' : '<th>地区</th>'}<th class="n">価格</th><th class="n">面積</th>${state.t === 'L' ? '<th class="n">坪単価</th>' : '<th class="n">築年</th>'}</tr></thead>
    <tbody>${recent.map(r => `<tr><td>${qLabel(r.q)}</td>${g.dist ? '' : `<td>${esc(r.dist)}</td>`}<td class="n">${man(r.price)}</td><td class="n">${Math.round(r.area)}㎡</td>${state.t === 'L' ? `<td class="n">${manT(metric(r))}</td>` : `<td class="n">${r.built || '—'}</td>`}</tr>`).join('')}</tbody></table>
    ${g.dist ? `<div style="margin-top:14px"><button class="btn ghost" id="toAp">この地区で${state.t === 'M' ? 'マンションを' : ''}査定する</button></div>` : ''}`;
  $('#back').onclick = e => { e.preventDefault(); state.selected = null; showRanking(); };
  const ap = $('#toAp');
  if (ap) ap.onclick = () => goAppraise({ addr: g.city.replace(/^.+?郡/, '') + g.dist, kind: state.t === 'M' ? 'mansion' : 'house' });
}

// 査定画面へ移る（地図で選んだ地点なら座標も渡す）
function goAppraise({ addr, kind, lat, lng }) {
  const f = $('#apForm');
  f.addr.value = addr; f.pickedAddr.value = lat ? addr : ''; f.lat.value = lat ?? ''; f.lng.value = lng ?? '';
  $('#pickedNote').textContent = lat ? '地図で選んだ地点で査定します（住所を書き換えると、住所で検索し直します）' : '';
  setKind(kind || 'house');
  document.querySelector('[data-view=appraisal]').click();
  window.scrollTo(0, 0);
  setTimeout(() => (kind === 'mansion' ? f.mArea : f.land).focus({ preventScroll: true }), 100);
}

// 地図をタップ → その場所の住所を調べて査定へ
const pickPopup = L.popup({ maxWidth: 240 });
map.on('click', async e => {
  const { lat, lng } = e.latlng;
  pickPopup.setLatLng(e.latlng).setContent('<div class="pick">住所を調べています…</div>').openOn(map);
  let addr = '';
  try {
    const r = await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lng}`).then(r => r.json());
    const near = ROWS.reduce((b, r) => { const d = distKm(lat, lng, r.lat, r.lng); return d < b.d ? { d, r } : b; }, { d: Infinity }).r;
    if (r.results && near) addr = near.city.replace(/^.+?郡/, '') + (r.results.lv01Nm || '');
  } catch { }
  if (!addr) { pickPopup.setContent('<div class="pick">この場所の住所を取得できませんでした（高知県外や海上の可能性があります）。</div>'); return; }
  pickPopup.setContent(`<div class="pick"><b>${esc(addr)}</b>
    <button class="btn" data-k="house">ここで土地・戸建を査定</button>
    <button class="btn ghost" data-k="mansion">ここでマンションを査定</button></div>`);
  pickPopup.getElement()?.querySelectorAll('button').forEach(b => b.onclick = () => { map.closePopup(); goAppraise({ addr, kind: b.dataset.k, lat, lng }); });
});

$('#search').addEventListener('change', e => {
  const v = e.target.value.trim();
  const g = current.find(x => (x.city + ' ' + x.dist) === v) || current.find(x => x.dist && v.includes(x.dist));
  if (g) { map.setView([g.lat, g.lng], 14); state.selected = g.key; showDetail(g); }
});
render();

// ---------- 査定 ----------
// 建物の建築費の目安（円/㎡）と、築年数ごとの価値の残り方。
// 残り方は高知県内の戸建取引（2021〜2026年）から「価格−近隣の土地価格」を築年数別に集計して決めた（scripts/calibrate参照）。
const BUILD = {
  W: { name: '木造', unit: 200000, curve: [[0, 1], [7.5, .85], [12.5, .7], [17.5, .5], [22.5, .37], [27.5, .3], [32.5, .13], [37.5, .1], [42.5, .05], [50, 0]] },
  LS: { name: '軽量鉄骨造', unit: 220000, curve: [[0, 1], [12.5, .55], [22.5, .38], [27.5, .22], [32.5, .12], [37.5, .09], [45, .03], [55, 0]] },
  S: { name: '鉄骨造', unit: 250000, curve: [[0, 1], [12.5, .55], [22.5, .38], [27.5, .22], [32.5, .12], [37.5, .09], [45, .03], [55, 0]] },
  RC: { name: '鉄筋コンクリート造', unit: 280000, curve: [[0, 1], [12.5, .6], [22.5, .3], [32.5, .2], [40, .05], [50, 0]] },
};
function residual(curve, age) {
  for (let i = 1; i < curve.length; i++) {
    const [a0, v0] = curve[i - 1], [a1, v1] = curve[i];
    if (age <= a1) return v0 + (v1 - v0) * (age - a0) / (a1 - a0);
  }
  return 0;
}
const RADII = [0.8, 1.5, 2.5, 4, 6, 10, 15];
// 土地事例の重みづけ（距離の効き方km・1年ごとの減衰・面積差の効き方・同じ地区の倍率）
const W = { dist: 1.0, decay: 0.9, area: 1.0, same: 3, lp: 1, lpNear: 2, rosen: 0.7 }; // rosen=路線価・固定資産税評価からの値の比重（取引データに路線価がないため検証できず、目安値） // 過去取引での検証で最も誤差が小さかった値（lp=公示・調査を使った値の比重）

// ---------- 地価公示・地価調査 ----------
const LP = ((window.LANDPRICE || {}).points || []).filter(x => ['住宅地', '商業地', '宅地見込地'].includes(x.use));
const useOf = r => r.zone === '商業地' ? '商業地' : '住宅地';
const lpCache = new Map();
function nearLP(lat, lng, use, k = 5, maxKm = 8) {
  const key = `${lat},${lng},${use},${k}`;
  if (lpCache.has(key)) return lpCache.get(key);
  const pool = LP.filter(x => use === '商業地' ? x.use === '商業地' : x.use !== '商業地');
  const res = pool.map(pt => ({ pt, d: distKm(lat, lng, pt.lat, pt.lng) })).filter(x => x.d <= maxKm)
    .sort((a, b) => a.d - b.d).slice(0, k);
  lpCache.set(key, res);
  return res;
}
// 公示・調査地点の価格（円/㎡）を距離で重みづけして補間（対数平均）
function lpSurface(lat, lng, use) {
  const ns = nearLP(lat, lng, use);
  if (!ns.length) return null;
  let sw = 0, s = 0;
  for (const n of ns) { const w = 1 / Math.max(n.d, 0.15) ** 2; sw += w; s += w * Math.log(n.pt.p); }
  return { v: Math.exp(s / sw), ns };
}
// 時点q（例 2023.5）の価格を2026年水準に直す倍率
function lpIndex(lat, lng, use, q) {
  const rs = nearLP(lat, lng, use, 5, 10).map(({ pt }) => {
    const y = Math.floor(q), f = q - y, a = pt.h[y], b = pt.h[y + 1] ?? a;
    return a && b ? pt.p / (a + (b - a) * f) : NaN;
  });
  const m = median(rs);
  return Number.isFinite(m) ? m : 1;
}
let apMap = null;

async function geocode(addr) {
  const q = addr.startsWith('高知県') ? addr : '高知県' + addr;
  const res = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q)).then(r => r.json());
  const hit = res.find(f => f.properties.title.includes('高知県')) || null;
  if (!hit) throw new Error('住所が見つかりませんでした。市町村名から入力してください（例：高知市桟橋通3丁目）。');
  return { lng: hit.geometry.coordinates[0], lat: hit.geometry.coordinates[1], title: hit.properties.title };
}

function findComps(pool, p, minN) {
  for (const R of RADII) {
    const c = pool.map(r => ({ r, d: distKm(p.lat, p.lng, r.lat, r.lng) })).filter(x => x.d <= R);
    if (c.length >= minN) return { comps: c, R };
  }
  return { comps: pool.map(r => ({ r, d: distKm(p.lat, p.lng, r.lat, r.lng) })).filter(x => x.d <= RADII.at(-1)), R: RADII.at(-1) };
}
// 極端な事例を外す（価格は倍率でばらつくので対数で判定）
const trimIQR = (arr, f) => {
  const g = x => Math.log(f(x));
  const q1 = quantile(arr.map(g), .25), q3 = quantile(arr.map(g), .75), k = (q3 - q1) * 1.5;
  return arr.filter(x => g(x) >= q1 - k && g(x) <= q3 + k);
};

function appraise(input, p) {
  const why = [], warns = [];
  // 1) 土地：近くの土地取引の坪単価から
  const landPool = ROWS.filter(r => r.t === 'L' && r.area >= 30 && r.area <= 2000);
  let { comps, R } = findComps(landPool, p, 10);
  // 時点修正：取引時点の価格を、近くの公示・調査地点の値動きで2026年水準に直す
  comps.forEach(x => {
    x.use = useOf(x.r);
    x.tadj = lpIndex(x.r.lat, x.r.lng, x.use, x.r.q);
    x.raw = x.r.price / x.r.area * TSUBO;
    x.tsubo = x.raw * x.tadj;
  });
  const before = comps.length;
  comps = trimIQR(comps, x => x.tsubo);
  // 同じ地区か（「朝倉」と「朝倉丙」は別扱い。丁目・番地が続く場合は同じ地区）
  const sameDist = r => {
    const t = p.title.replace(/\s/g, ''), key = r.city.replace(/^.+?郡/, '') + r.dist;
    const i = t.indexOf(key);
    return i >= 0 && (i + key.length === t.length || /^[0-9０-９一二三四五六七八九十丁番-]/.test(t.slice(i + key.length)));
  };
  comps.forEach(x => {
    const age = LATEST_Q - x.r.q;
    x.same = sameDist(x.r);
    x.w = Math.exp(-x.d / W.dist) * W.decay ** age * Math.exp(-W.area * Math.abs(Math.log(x.r.area / input.land))) * (x.same ? W.same : 1);
  });
  const nSame = comps.filter(x => x.same).length;
  if (!comps.length) throw new Error('周辺に土地の取引事例が見つかりませんでした。');
  const direct = wMedian(comps.map(x => ({ v: x.tsubo, w: x.w })));
  // 位置補正：公示・調査地点から査定地点の地価水準を補間し、「周辺の取引は公示水準の何倍で売れているか」を掛ける
  const surfT = lpSurface(p.lat, p.lng, input.use);
  let base = direct, lpInfo = null;
  if (surfT && W.lp > 0) {
    const rs = comps.map(x => { const s = lpSurface(x.r.lat, x.r.lng, x.use); return s ? { v: x.tsubo / (s.v * TSUBO), w: x.w } : null; }).filter(Boolean);
    if (rs.length >= 3) {
      const ratio = wMedian(rs);
      const viaLp = surfT.v * TSUBO * ratio;
      // 最寄りの公示・調査地点が遠い（郊外など）ほど比重を下げる
      const lpW = W.lp * Math.min(1, Math.max(0.3, 1 - (surfT.ns[0].d - W.lpNear) / 4));
      base = Math.exp(lpW * Math.log(viaLp) + (1 - lpW) * Math.log(direct));
      lpInfo = { surfT, ratio, viaLp, lpW };
    }
  }
  const plain = median(comps.map(x => x.tsubo));
  const q1 = quantile(comps.map(x => x.tsubo), .25), q3 = quantile(comps.map(x => x.tsubo), .75);
  const compArea = median(comps.map(x => x.r.area));
  why.push(`所在地から半径${R}km以内の土地取引 <b>${comps.length}件</b>（2021年〜、極端な値${before - comps.length}件を除外）を使用。坪単価の中央値は <b>${manT(plain)}</b>、中間の50%は ${manT(q1)}〜${manT(q3)}。`);
  const tAvg = median(comps.map(x => x.tadj));
  if (Math.abs(tAvg - 1) >= 0.005) why.push(`取引時点から現在までの地価の動きを、近くの公示・調査地点の推移で補正（事例の中央値で <span class="adj">${pct(tAvg - 1)}</span>）。上の数字は補正後。`);
  why.push(`${nSame ? `同じ地区の事例（${nSame}件）を特に重視し、` : ''}距離が近い・取引が新しい・面積が近い事例ほど重く扱うと、取引事例からの坪単価は <b>${manT(direct)}</b>。`);
  if (lpInfo) {
    const near = lpInfo.surfT.ns.slice(0, 3).map(n => `${n.pt.k}「${esc(n.pt.addr.replace(/^高知県\s*/, ''))}」${manT(n.pt.p * TSUBO)}（${n.d.toFixed(1)}km）`).join('、');
    why.push(`査定地点に近い地価公示・地価調査の地点（${near}）から、この場所の公的な地価水準を <b>${manT(lpInfo.surfT.v * TSUBO)}</b> と推定。周辺の取引は公的な水準の <b>${lpInfo.ratio.toFixed(2)}倍</b> で取引されているため、位置を考慮した坪単価は <b>${manT(lpInfo.viaLp)}</b>。`);
    why.push(lpInfo.lpW >= 0.99
      ? `位置まで考慮できる、公示・調査を使った値を基準の坪単価 <b>${manT(base)}</b> とした（過去の取引で検証して最も誤差が小さかった方法）。`
      : `最寄りの公示・調査地点が遠いため、取引事例からの値と公示・調査を使った値を ${Math.round((1 - lpInfo.lpW) * 100)}:${Math.round(lpInfo.lpW * 100)} で合わせ、基準の坪単価を <b>${manT(base)}</b> とした。`);
  } else {
    why.push(`近くに使える公示・調査地点がないため、取引事例からの値をそのまま基準の坪単価 <b>${manT(base)}</b> とした。`);
  }
  if (comps.length < 5 || R >= 6) warns.push(`近くの土地取引が少ないため、半径${R}kmまで広げています。精度は低めです。`);
  if (lpInfo && (lpInfo.ratio < 0.5 || lpInfo.ratio > 2)) warns.push(`周辺の取引価格が公示・調査の価格の${lpInfo.ratio.toFixed(2)}倍と大きくかけ離れています。売れにくい地域で実際に安く取引されている可能性と、古家付き・特殊な事情の取引が混ざっている可能性があります。取引事例の一覧を確認し、現地の相場感で判断してください。`);

  // 路線価・固定資産税評価額：その道路・その土地の公的評価。公示価格に対して路線価は約80%、固定資産税評価は約70%の水準で決められている
  const hasRosen = input.rosenka > 0, hasKotei = !hasRosen && input.kotei > 0;
  if (hasRosen || hasKotei) {
    const pub = hasRosen ? input.rosenka * 1000 / 0.8 : input.kotei / input.land / 0.7; // 公示価格に相当する円/㎡
    const ratio = lpInfo ? lpInfo.ratio : null;
    const viaPub = pub * TSUBO * (ratio ?? 1);
    const before = base;
    base = Math.exp(W.rosen * Math.log(viaPub) + (1 - W.rosen) * Math.log(base));
    why.push(hasRosen
      ? `入力された前面道路の路線価 ${input.rosenka}千円/㎡ は公示価格の約80%で決められているため、この道路の公示価格相当は <b>${manT(pub * TSUBO)}</b>。`
      : `入力された固定資産税評価額 ${man(input.kotei)}（${(input.kotei / input.land).toLocaleString(undefined, { maximumFractionDigits: 0 })}円/㎡）は公示価格の約70%で決められているため、この土地の公示価格相当は <b>${manT(pub * TSUBO)}</b>。`);
    why.push(`${ratio ? `周辺の取引の水準（公示の${ratio.toFixed(2)}倍）を掛けると ${manT(viaPub)}。` : `周辺の取引と公示の比率が出せないため、そのまま ${manT(viaPub)} とした。`}${hasRosen ? '路線価は道路ごとの価格で、' : '固定資産税評価は1筆ごとの評価で、'}地区単位の取引事例より位置の精度が高いため、これを ${Math.round(W.rosen * 100)}%、上の値（${manT(before)}）を ${Math.round((1 - W.rosen) * 100)}% として基準の坪単価を <b>${manT(base)}</b> とした。`);
    const gap = viaPub / before - 1;
    if (Math.abs(gap) > 0.3) warns.push(`${hasRosen ? '路線価' : '固定資産税評価額'}からの値が取引事例・公示からの値と${Math.round(Math.abs(gap) * 100)}%ずれています。入力値（単位：${hasRosen ? '千円/㎡' : '土地全体の円'}）と、路線価なら正しい道路を見ているか確認してください。`);
  } else {
    why.push('前面道路の路線価（または固定資産税評価額）を入れると、道路単位の位置まで反映できます。');
  }

  // 個別要因の補正
  const adj = [];
  if (input.noRebuild) adj.push(['再建築不可', -0.5]);
  else if (Number.isFinite(input.road) && !(hasRosen && input.road >= 4)) { // 道路の広さは路線価に含まれているので、路線価入力時はセットバック分だけ補正
    if (input.road < 2) adj.push([`前面道路${input.road}m（2m未満：建築に制限）`, -0.3]);
    else if (input.road < 4) adj.push([`前面道路${input.road}m（4m未満：セットバックが必要）`, -0.1]);
    else if (input.road >= 6) adj.push([`前面道路${input.road}m（6m以上：広い）`, 0.03]);
  }
  if (input.shape) adj.push([({ '-0.05': 'やや不整形', '-0.15': '不整形', '-0.2': '旗竿地' })[String(input.shape)], input.shape]);
  if (input.corner) adj.push(['角地', 0.05]);
  if (input.land > compArea * 2.5 && input.land > 500) adj.push([`面積が周辺事例（中央値${Math.round(compArea)}㎡）より大幅に広い：分割や造成の費用がかかる`, -0.1]);
  // ハザード：周辺事例とのハザードの「差」だけ補正する（事例の価格には、その地域のハザードがすでに織り込まれている）
  let hzInfo = null;
  if (input.hz) {
    const tgt = hzLogEffect(input.hz);
    const sw = comps.reduce((s, x) => s + x.w, 0);
    const compE = comps.reduce((s, x) => s + hzLogEffect(hzOfRow(x.r) || { t: 0, f: 0, s: 0 }) * x.w, 0) / sw;
    const scale = hasRosen || hasKotei ? 1 - W.rosen : 1; // 路線価等にはその場所のハザードが一部反映済み
    const diff = Math.exp((tgt - compE) * scale) - 1;
    const share = comps.filter(x => hzLogEffect(hzOfRow(x.r) || { t: 0, f: 0, s: 0 }) < 0).length / comps.length;
    hzInfo = { diff, share, tgt };
    if (Math.abs(diff) >= 0.01) adj.push([`ハザード（${hzText(input.hz)}）が周辺事例より${diff < 0 ? '厳しい' : '軽い'}（事例の${Math.round(share * 100)}%が価格に効くハザード区域内）`, diff]);
  }
  const adjSum = Math.max(-0.7, adj.reduce((s, a) => s + a[1], 0));
  const unit = base * (1 + adjSum);
  const landVal = unit * input.land / TSUBO;
  if (adj.length) why.push(`土地の個別条件で補正：${adj.map(a => `${a[0]} <span class="adj">${pct(a[1])}</span>`).join('、')}。補正後の坪単価 <b>${manT(unit)}</b>。`);
  why.push(`土地価格 = ${manT(unit)} × ${(input.land / TSUBO).toFixed(1)}坪（${input.land}㎡）= <b>${man(landVal)}</b>。`);

  // 2) 建物：原価法（建て直し費用 × 残りの耐用年数の割合）
  let bldVal = 0, cost = landVal, market = null, houseComps = [];
  const hasBld = input.floor > 0 && input.built > 0;
  if (hasBld) {
    const b = BUILD[input.st];
    const age = Math.max(0, Math.floor(LATEST_Q) - input.built);
    let remain = residual(b.curve, age);
    let reformNote = '';
    if (input.reform && remain < 0.25) { remain = 0.25; reformNote = '（リフォーム済みのため残りの価値を25%とした）'; }
    bldVal = b.unit * input.floor * remain;
    cost = landVal + bldVal;
    why.push(`建物は「今建て直すといくらか」から古くなった分を引く方法で計算。${b.name}の建築費の目安 ${(b.unit / 1e4).toFixed(0)}万円/㎡ × ${input.floor}㎡ × 残り${Math.round(remain * 100)}%（築${age}年。高知県内の戸建取引から求めた築年数ごとの残り方）${reformNote} = <b>${man(bldVal)}</b>。`);
    if (remain === 0) why.push(`築年数が古く、建物の価値はほぼ0と見なした（高知の取引でも土地値で売れている）。`);

    // 3) 周辺の戸建の取引価格と照らし合わせる
    const pool = ROWS.filter(r => r.t === 'H' && r.floor && r.built && Math.abs(r.built - input.built) <= 12
      && r.floor / input.floor > 0.6 && r.floor / input.floor < 1.6 && r.area / input.land > 0.5 && r.area / input.land < 2);
    const fc = findComps(pool, p, 6);
    houseComps = trimIQR(fc.comps, x => x.r.price);
    houseComps.forEach(x => {
      // 土地面積と延床の差を、上で求めた単価で調整して「この物件だったらいくらか」に直す
      x.adjPrice = x.r.price * lpIndex(x.r.lat, x.r.lng, '住宅地', x.r.q) + (input.land - x.r.area) / TSUBO * base
        + (input.floor - x.r.floor) * b.unit * remain;
      x.w = Math.exp(-x.d / W.dist) * W.decay ** (LATEST_Q - x.r.q) * Math.exp(-Math.abs(x.r.built - input.built) / 10) * (sameDist(x.r) ? W.same : 1);
    });
    if (houseComps.length >= 2) {
      market = wMedian(houseComps.map(x => ({ v: x.adjPrice, w: x.w })));
      why.push(`周辺（半径${fc.R}km）で条件が近い戸建（築年±12年、広さが近いもの）の取引 <b>${houseComps.length}件</b> を、土地・建物の広さの違いを調整して比べると <b>${man(market)}</b>。`);
    } else {
      warns.push('条件が近い戸建の取引事例が少ないため、市場価格との照合はしていません。');
    }
  }

  // 4) 最終
  let final = cost, mix = '';
  if (market != null) {
    const wm = houseComps.length >= 5 ? 0.5 : 0.3;
    final = cost * (1 - wm) + market * wm;
    mix = `積み上げ（土地＋建物）${man(cost)} と取引事例 ${man(market)} を ${Math.round((1 - wm) * 100)}:${Math.round(wm * 100)} で合わせた。`;
    if (Math.abs(market / cost - 1) > 0.3) warns.push(`積み上げと取引事例の差が30%以上あります。立地や建物の状態を現地で確認してください。`);
  }
  final = Math.round(final / 1e5) * 1e5;
  const lowR = Math.min(0.95, Math.max(0.8, q1 / plain)), highR = Math.max(1.05, Math.min(1.2, q3 / plain));
  if (mix) why.push(mix);
  if (input.noRebuild) warns.push('再建築不可は買い手が限られ、金融機関の融資もつきにくいため、価格の振れが大きくなります。');
  if (!input.hz) warns.push('ハザード情報を取得できなかったため、ハザードは反映していません。');
  else if (input.hz.s === 2) warns.push('土砂災害特別警戒区域内です。建築に構造の制限がかかり、売りにくくなる可能性があります。重要事項説明の対象です。');
  if (input.hz && (input.hz.t >= 3 || input.hz.f >= 3)) warns.push('想定浸水深が3m以上（1階の天井付近以上）です。買い手の層が限られる可能性があります。');
  warns.push('高低差、上下水道、越境、建物の傷み具合などは反映していません。');
  return { kind: hasBld ? 'house' : 'land', final, low: Math.round(final * lowR / 1e5) * 1e5, high: Math.round(final * highR / 1e5) * 1e5, landVal, bldVal, market, hasBld, why, warns,
    landComps: comps.sort((a, b) => b.w - a.w), houseComps: houseComps.sort((a, b) => b.w - a.w), unit, lpInfo, hzInfo, hz: input.hz };
}

// ---------- マンション査定 ----------
// 高知市の中古マンション取引（761件）では、築年数が1年増えるごとに㎡単価が約3.0%下がる（scripts/build_data後に集計）
const M_AGE_SLOPE = -0.0305;
function appraiseMansion(input, p) {
  const why = [], warns = [];
  const nowY = Math.floor(LATEST_Q);
  const pool = ROWS.filter(r => r.t === 'M' && r.built && r.area >= 15 && r.area <= 200 && Math.abs(r.built - input.built) <= 15);
  let { comps, R } = findComps(pool, p, 8);
  if (!comps.length) throw new Error('周辺にマンションの取引事例が見つかりませんでした（高知県内のマンション取引はほぼ高知市に限られます）。');
  comps.forEach(x => {
    x.raw = x.r.price / x.r.area;
    const ageC = Math.floor(x.r.q) - x.r.built, ageT = nowY - input.built;
    x.ageAdj = Math.exp(M_AGE_SLOPE * (ageT - ageC)); // 築年の差を調整
    x.unit = x.raw * x.ageAdj;
    x.w = Math.exp(-x.d / W.dist) * W.decay ** (LATEST_Q - x.r.q) * Math.exp(-Math.abs(x.r.built - input.built) / 8)
      * Math.exp(-0.7 * Math.abs(Math.log(x.r.area / input.area)));
  });
  const before = comps.length;
  comps = trimIQR(comps, x => x.unit);
  const unit = wMedian(comps.map(x => ({ v: x.unit, w: x.w })));
  const q1 = quantile(comps.map(x => x.unit), .25), q3 = quantile(comps.map(x => x.unit), .75), med = median(comps.map(x => x.unit));
  const age = nowY - input.built;
  why.push(`所在地から半径${R}km以内で、築年が±15年以内のマンション取引 <b>${comps.length}件</b>（2021年〜、極端な値${before - comps.length}件を除外）を使用。`);
  why.push(`高知市のマンション取引では、築年数が1年増えるごとに㎡単価が約3%下がる（761件から算出）。この関係で、各事例を築${age}年（${input.built}年築）だった場合の単価に直した。`);
  why.push(`距離が近い・取引が新しい・築年と広さが近い事例ほど重く扱い、㎡単価を <b>${(unit / 1e4).toFixed(1)}万円/㎡</b>（坪 ${manT(unit * TSUBO)}）とした。直した後の中間の50%は ${(q1 / 1e4).toFixed(1)}〜${(q3 / 1e4).toFixed(1)}万円/㎡。`);
  let final = unit * input.area;
  why.push(`査定額 = ${(unit / 1e4).toFixed(1)}万円/㎡ × ${input.area}㎡ = <b>${man(final)}</b>。`);
  if (input.reform && age >= 15) { final *= 1.05; why.push('室内リフォーム済みのため +5%。'); }
  if (comps.length < 5 || R >= 4) warns.push(`近くのマンション取引が少ないため、半径${R}kmまで広げています。精度は低めです。`);
  if (input.hz && (input.hz.t >= 3 || input.hz.f >= 3)) warns.push('想定浸水深が3m以上です。低層階は浸水の影響を直接受けます。所在階・電気設備の位置を確認してください。');
  warns.push('所在階・向き・眺望・管理状態・修繕積立金の残高は反映していません（公開データに階数がないため）。');
  final = Math.round(final / 1e5) * 1e5;
  const lowR = Math.min(0.95, Math.max(0.8, q1 / med)), highR = Math.max(1.05, Math.min(1.2, q3 / med));
  return { kind: 'mansion', final, raw: final, low: Math.round(final * lowR / 1e5) * 1e5, high: Math.round(final * highR / 1e5) * 1e5,
    unit, why, warns, mComps: comps.sort((a, b) => b.w - a.w), hz: input.hz, landComps: [], houseComps: [] };
}

// ---------- 自社実績による補正 ----------
function applyCorrection(res) {
  res.raw = res.final;
  const c = window.recordCorrection?.(res.kind);
  if (!c) return res;
  if (c.on) {
    res.final = Math.round(res.final * c.factor / 1e5) * 1e5;
    res.low = Math.round(res.low * c.factor / 1e5) * 1e5; res.high = Math.round(res.high * c.factor / 1e5) * 1e5;
    res.why.push(`自社の成約実績${c.n}件では、成約価格が査定額に対して中央値で <span class="adj">${pct(c.factor - 1)}</span> だったため、その分を補正した（補正前 ${man(res.raw)}）。`);
  } else if (c.n >= 5) {
    res.why.push(`参考：自社の成約実績${c.n}件では、成約価格が査定額の中央値で ${pct(c.factor - 1)}。成約実績の画面で補正をオンにすると反映されます。`);
  }
  return res;
}

// ---------- 結果の表示 ----------
const KIND_NAME = { house: '土地・戸建', land: '土地', mansion: 'マンション' };
function hazardHtml(hz) {
  return hz ? `<h3>この地点のハザード（国土地理院 ハザードマップポータル）</h3>
    <dl class="kv"><dt>津波浸水想定</dt><dd>${DEPTH_LABEL[hz.t]}</dd><dt>洪水浸水想定（想定最大規模）</dt><dd>${DEPTH_LABEL_F[hz.f]}</dd><dt>土砂災害</dt><dd>${['区域外', '警戒区域', '特別警戒区域'][hz.s]}</dd></dl>
    <div class="sub">住所の代表点で判定。敷地の端や、番地まで入れていない場合はずれることがあります。</div>` : '';
}
let lastRun = null;
function showResult(res, p, input) {
  lastRun = { res, p, input, at: new Date() };
  const isM = res.kind === 'mansion';
  const split = isM
    ? `<div><span>㎡単価</span><b>${(res.unit / 1e4).toFixed(1)}万円</b><span>坪 ${manT(res.unit * TSUBO)}</span></div>
       <div><span>専有面積</span><b>${input.area}㎡</b><span>${input.built}年築</span></div>
       <div><span>比べた取引</span><b>${res.mComps.length}件</b><span>周辺のマンション</span></div>`
    : `<div><span>土地</span><b>${man(res.landVal)}</b><span>${manT(res.unit)}</span></div>
       <div><span>建物</span><b>${res.hasBld ? man(res.bldVal) : '—'}</b><span>${res.hasBld ? '原価法' : '土地のみ'}</span></div>
       <div><span>周辺の取引事例</span><b>${res.market != null ? man(res.market) : '—'}</b><span>${res.houseComps.length}件で比較</span></div>`;
  const comps = isM
    ? `<h3>比べたマンションの取引事例（重視した順・上位12件）</h3>
       <div class="tableScroll"><table><thead><tr><th>地区</th><th>時期</th><th class="n">価格</th><th class="n">面積</th><th class="n">築年</th><th class="n">㎡単価</th><th class="n">築年調整後</th><th class="n">距離</th></tr></thead>
       <tbody>${res.mComps.slice(0, 12).map(x => `<tr><td>${esc(x.r.dist)}</td><td>${qLabel(x.r.q)}</td><td class="n">${man(x.r.price)}</td><td class="n">${Math.round(x.r.area)}㎡</td><td class="n">${x.r.built}</td><td class="n">${(x.raw / 1e4).toFixed(1)}万</td><td class="n">${(x.unit / 1e4).toFixed(1)}万</td><td class="n">${x.d.toFixed(1)}km</td></tr>`).join('')}</tbody></table></div>`
    : `${res.lpInfo ? `<h3>近くの地価公示・地価調査（2026年）</h3>
       <div class="tableScroll"><table><thead><tr><th>種類</th><th>所在</th><th class="n">坪単価</th><th class="n">前年比</th><th class="n">距離</th></tr></thead>
       <tbody>${res.lpInfo.surfT.ns.map(n => `<tr><td>${n.pt.k}</td><td>${esc(n.pt.addr.replace(/^高知県\s*/, ''))}</td><td class="n">${manT(n.pt.p * TSUBO)}</td><td class="n">${n.pt.chg > 0 ? '+' : ''}${n.pt.chg}%</td><td class="n">${n.d.toFixed(1)}km</td></tr>`).join('')}</tbody></table></div>` : ''}
       <h3>使った土地の取引事例（重視した順・上位12件）</h3>
       <div class="tableScroll"><table><thead><tr><th>地区</th><th>時期</th><th class="n">面積</th><th class="n">坪単価</th><th class="n">時点修正後</th><th class="n">距離</th></tr></thead>
       <tbody>${res.landComps.slice(0, 12).map(x => `<tr><td>${esc(x.r.dist)}</td><td>${qLabel(x.r.q)}</td><td class="n">${Math.round(x.r.area)}㎡</td><td class="n">${manT(x.raw)}</td><td class="n">${manT(x.tsubo)}</td><td class="n">${x.d.toFixed(1)}km</td></tr>`).join('')}</tbody></table></div>
       ${res.houseComps.length ? `<h3>比べた戸建の取引事例（上位10件）</h3>
       <div class="tableScroll"><table><thead><tr><th>地区</th><th>時期</th><th class="n">価格</th><th class="n">土地/延床</th><th class="n">築年</th><th class="n">調整後</th></tr></thead>
       <tbody>${res.houseComps.slice(0, 10).map(x => `<tr><td>${esc(x.r.dist)}</td><td>${qLabel(x.r.q)}</td><td class="n">${man(x.r.price)}</td><td class="n">${Math.round(x.r.area)}/${Math.round(x.r.floor)}㎡</td><td class="n">${x.r.built}</td><td class="n">${man(x.adjPrice)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  $('#apResult').innerHTML = `
    <div class="sub">${esc(p.title)}・${KIND_NAME[res.kind]}</div>
    <div class="price">${man(res.final)}</div>
    <div class="range">想定レンジ ${man(res.low)} 〜 ${man(res.high)}</div>
    <div class="split">${split}</div>
    <div class="actions">
      <input id="custName" placeholder="お客様名（査定書の宛名・任意）">
      <button class="btn" type="button" id="printBtn">査定書を印刷・PDF保存</button>
      <button class="btn ghost" type="button" id="recBtn">成約実績に記録</button>
    </div>
    ${hazardHtml(res.hz)}
    <h3>査定の理由</h3>
    <ol class="why">${res.why.map(w => `<li>${w}</li>`).join('')}</ol>
    ${res.warns.map(w => `<div class="warn">${w}</div>`).join('')}
    <div id="apMap"></div>
    ${comps}
    <div class="sub" style="margin-top:12px">機械的な試算です。正式な価格査定や鑑定評価ではありません。事例の位置は地区の代表点です。</div>`;
  $('#printBtn').onclick = () => printReport($('#custName').value.trim());
  $('#recBtn').onclick = e => { window.addRecord?.(lastRun); e.target.disabled = true; e.target.textContent = '記録しました'; };
  if (apMap) apMap.remove();
  apMap = L.map('apMap', { scrollWheelZoom: false });
  makeBase(baseKey === 'photo' ? 'std' : baseKey).addTo(apMap);
  const pts = [[p.lat, p.lng]];
  for (const x of (isM ? res.mComps : res.landComps).slice(0, 30)) {
    L.circleMarker([x.r.lat, x.r.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#2a78d6', fillOpacity: .85 })
      .bindTooltip(`${esc(x.r.dist)} ${isM ? (x.unit / 1e4).toFixed(1) + '万円/㎡' : manT(x.tsubo)}`).addTo(apMap);
    pts.push([x.r.lat, x.r.lng]);
  }
  L.circleMarker([p.lat, p.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#d03b3b', fillOpacity: 1 }).bindTooltip('査定物件').addTo(apMap);
  apMap.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 15 });
}

// ---------- 査定書（印刷・PDF） ----------
function printReport(customer) {
  const { res, p, input, at } = lastRun;
  const cfg = { company: store.get('kochi_cfg', {}).company || '', staff: store.get('kochi_cfg', {}).staff || '', contact: store.get('kochi_cfg', {}).contact || '' };
  const isM = res.kind === 'mansion';
  const strip = s => String(s).replace(/<[^>]+>/g, '');
  const rows = isM
    ? [['種別', 'マンション'], ['専有面積', `${input.area}㎡（${(input.area / TSUBO).toFixed(1)}坪）`], ['建築年', `${input.built}年（築${Math.floor(LATEST_Q) - input.built}年）`], ['間取り', input.madori || '—']]
    : [['種別', res.hasBld ? '土地・建物' : '土地'], ['土地面積', `${input.land}㎡（${(input.land / TSUBO).toFixed(1)}坪）`],
       ['前面道路', Number.isFinite(input.road) ? input.road + 'm' : '—'], ['形状', ({ 0: '整形', '-0.05': 'やや不整形', '-0.15': '不整形', '-0.2': '旗竿地' })[String(input.shape)]],
       ...(res.hasBld ? [['建物', `${BUILD[input.st].name}・延床${input.floor}㎡・${input.built}年築`]] : []),
       ...(input.rosenka > 0 ? [['路線価', `${input.rosenka}千円/㎡`]] : [])];
  const comps = isM
    ? `<table><tr><th>地区</th><th>時期</th><th>価格</th><th>面積</th><th>築年</th></tr>${res.mComps.slice(0, 8).map(x => `<tr><td>${esc(x.r.dist)}</td><td>${qLabel(x.r.q)}</td><td>${man(x.r.price)}</td><td>${Math.round(x.r.area)}㎡</td><td>${x.r.built}</td></tr>`).join('')}</table>`
    : `<table><tr><th>地区</th><th>時期</th><th>面積</th><th>坪単価（時点修正後）</th><th>距離</th></tr>${res.landComps.slice(0, 8).map(x => `<tr><td>${esc(x.r.dist)}</td><td>${qLabel(x.r.q)}</td><td>${Math.round(x.r.area)}㎡</td><td>${manT(x.tsubo)}</td><td>${x.d.toFixed(1)}km</td></tr>`).join('')}</table>`;
  $('#report').innerHTML = `
    <div class="rhead"><div><h1>不動産査定書</h1>${customer ? `<div class="to">${esc(customer)} 様</div>` : ''}</div>
      <div class="co">${at.getFullYear()}年${at.getMonth() + 1}月${at.getDate()}日<br>${esc(cfg.company)}${cfg.staff ? `<br>担当：${esc(cfg.staff)}` : ''}${cfg.contact ? `<br>${esc(cfg.contact)}` : ''}</div></div>
    <div class="box"><div>物件所在地：${esc(p.title)}</div>
      <div class="big">査定価格 ${man(res.final)}</div><div>想定価格帯 ${man(res.low)} 〜 ${man(res.high)}</div>
      ${isM ? '' : `<div class="grid3" style="margin-top:6px"><div>土地 ${man(res.landVal)}</div><div>建物 ${res.hasBld ? man(res.bldVal) : '—'}</div><div>周辺の戸建事例 ${res.market != null ? man(res.market) : '—'}</div></div>`}</div>
    <h2>物件の概要</h2><table>${rows.map(([k, v]) => `<tr><th style="width:30%">${k}</th><td>${esc(v)}</td></tr>`).join('')}</table>
    ${res.hz ? `<h2>災害リスク（国土地理院 ハザードマップポータル）</h2><table><tr><th style="width:30%">津波浸水想定</th><td>${DEPTH_LABEL[res.hz.t]}</td></tr><tr><th>洪水浸水想定（想定最大規模）</th><td>${DEPTH_LABEL_F[res.hz.f]}</td></tr><tr><th>土砂災害</th><td>${['区域外', '警戒区域', '特別警戒区域'][res.hz.s]}</td></tr></table>` : ''}
    <h2>査定の根拠</h2><ol>${res.why.map(w => `<li>${strip(w)}</li>`).join('')}</ol>
    <h2>主な取引事例</h2>${comps}
    <h2>留意事項</h2><ol class="note">${res.warns.map(w => `<li>${strip(w)}</li>`).join('')}
      <li>本書は公開データ（国土交通省 不動産情報ライブラリの取引価格・成約価格、地価公示・地価調査、国土地理院の地図・ハザード情報）にもとづく価格の目安であり、不動産鑑定評価書ではありません。</li>
      <li>実際の売出価格・成約価格は、現地の状況、権利関係、市場動向、売却時期により変動します。</li></ol>`;
  window.print();
}

// ---------- 入力フォーム ----------
function setKind(k) {
  $('#apForm').classList.toggle('is-mansion', k === 'mansion');
  $('#apForm').dataset.kind = k;
  document.querySelectorAll('#kindSeg button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
}
document.querySelectorAll('#kindSeg button').forEach(b => b.onclick = () => setKind(b.dataset.k));
setKind('house');

$('#apForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, num = v => v === '' ? NaN : Number(v);
  const kind = f.dataset.kind;
  const input = kind === 'mansion'
    ? { addr: f.addr.value.trim(), area: num(f.mArea.value), built: num(f.mBuilt.value), madori: f.madori.value.trim(), reform: f.mReform.checked }
    : {
      addr: f.addr.value.trim(), use: f.use.value, land: num(f.land.value),
      rosenka: num(f.rosenka.value), kotei: num(f.kotei.value), road: num(f.road.value), shape: Number(f.shape.value),
      corner: f.corner.checked, noRebuild: f.noRebuild.checked,
      floor: num(f.floor.value), built: num(f.built.value), st: f.st.value, reform: f.reform.checked,
    };
  $('#apErr').textContent = '';
  if (kind === 'mansion' && !(input.area > 0 && input.built > 0)) { $('#apErr').textContent = '専有面積と建築年を入れてください。'; return; }
  if (kind !== 'mansion' && !(input.land > 0)) { $('#apErr').textContent = '土地面積を入れてください。'; return; }
  if (kind !== 'mansion' && (input.floor > 0) !== (input.built > 0)) { $('#apErr').textContent = '建物を査定する場合は延床面積と建築年の両方を入れてください。'; return; }
  $('#apResult').innerHTML = '<div class="empty">計算中…</div>';
  try {
    const picked = f.lat.value && f.pickedAddr.value === input.addr;
    const p = picked ? { lat: Number(f.lat.value), lng: Number(f.lng.value), title: '高知県' + input.addr } : await geocode(input.addr);
    input.hz = await hazardAt(p.lat, p.lng).catch(() => null);
    const res = kind === 'mansion' ? appraiseMansion(input, p) : Object.assign(appraise(input, p), { kind: input.floor > 0 ? 'house' : 'land' });
    showResult(applyCorrection(res), p, input);
    if (window.innerWidth <= 860) $('#apResult').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    $('#apResult').innerHTML = '<div class="empty">査定できませんでした。</div>';
    $('#apErr').textContent = err.message;
  }
});
$('#sample').onclick = () => {
  const f = $('#apForm');
  f.lat.value = ''; f.pickedAddr.value = ''; $('#pickedNote').textContent = '';
  if (f.dataset.kind === 'mansion') { f.addr.value = '高知市本町'; f.mArea.value = 75; f.mBuilt.value = 2008; f.madori.value = '3LDK'; }
  else { f.addr.value = '高知市朝倉丙'; f.land.value = 165; f.road.value = 4; f.floor.value = 105; f.built.value = 2008; f.st.value = 'W'; }
};

// ---------- 地図：公示・調査地点の表示 ----------
const lpLayer = L.layerGroup();
for (const pt of LP) {
  L.marker([pt.lat, pt.lng], { icon: L.divIcon({ className: '', html: `<div class="lp-pt${pt.use === '商業地' ? ' c' : ''}"></div>`, iconSize: [12, 12] }) })
    .bindTooltip(`<b>${pt.k === '公示' ? '地価公示' : '地価調査'}（${pt.use}）</b><br>${esc(pt.addr.replace(/^高知県\s*/, ''))}<br><b>${manT(pt.p * TSUBO)}</b>（${pt.p.toLocaleString()}円/㎡）<br>前年比 ${pt.chg > 0 ? '+' : ''}${pt.chg}%・${esc(pt.now)}・${pt.area}㎡`, { sticky: true })
    .addTo(lpLayer);
}
$('#lpToggle').onclick = e => {
  const on = !map.hasLayer(lpLayer);
  on ? lpLayer.addTo(map) : map.removeLayer(lpLayer);
  e.target.classList.toggle('on', on);
  document.body.classList.toggle('lp-on', on);
  
};

// ---------- ハザード（国土地理院ハザードマップポータルのタイル） ----------
const HZ = window.HAZARD || {};
const HZ_LAYERS = {
  tsunami: { path: '04_tsunami_newlegend_data', name: '津波浸水想定' },
  flood: { path: '01_flood_l2_shinsuishin_data', name: '洪水浸水想定（想定最大規模）' },
  dosekiryu: { path: '05_dosekiryukeikaikuiki', name: '土砂災害警戒区域（土石流）' },
  kyukeisha: { path: '05_kyukeishakeikaikuiki', name: '土砂災害警戒区域（急傾斜地）' },
  jisuberi: { path: '05_jisuberikeikaikuiki', name: '土砂災害警戒区域（地すべり）' },
};
const HZ_URL = p => `https://disaportaldata.gsi.go.jp/raster/${p}/{z}/{x}/{y}.png`;
const DEPTH_T = [[[255, 255, 179], 0.01], [[247, 245, 169], 0.3], [[248, 225, 166], 0.5], [[255, 216, 192], 1], [[255, 183, 183], 3], [[255, 145, 145], 5], [[242, 133, 201], 10], [[220, 122, 220], 20]];
const DEPTH_F = [[[247, 245, 169], 0.01], [[255, 216, 192], 0.5], [[255, 183, 183], 3], [[255, 145, 145], 5], [[242, 133, 201], 10], [[220, 122, 220], 20]];
const DEPTH_LABEL = { 0: 'なし', 0.01: '0.3m未満', 0.3: '0.3〜0.5m', 0.5: '0.5〜1m', 1: '1〜3m', 3: '3〜5m', 5: '5〜10m', 10: '10〜20m', 20: '20m以上' };
const DEPTH_LABEL_F = { 0: 'なし', 0.01: '0.5m未満', 0.5: '0.5〜3m', 3: '3〜5m', 5: '5〜10m', 10: '10〜20m', 20: '20m以上' };
const dist2 = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
function depthOf(table, px) {
  if (!px || px[3] < 128) return 0;
  const best = table.reduce((b, row) => dist2(row[0], px) < dist2(b[0], px) ? row : b);
  return dist2(best[0], px) < 300 ? best[1] : 0;
}
const tileImgCache = new Map();
function tilePixel(path, lat, lng, z = 15) {
  const n = 2 ** z, fx = (lng + 180) / 360 * n;
  const fy = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
  const tx = Math.floor(fx), ty = Math.floor(fy), url = `https://disaportaldata.gsi.go.jp/raster/${path}/${z}/${tx}/${ty}.png`;
  if (!tileImgCache.has(url)) tileImgCache.set(url, new Promise(res => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); res(g); };
    img.onerror = () => res(null); // タイルがない＝区域外
    img.src = url;
  }));
  return tileImgCache.get(url).then(g => g ? [...g.getImageData(Math.floor((fx - tx) * 256), Math.floor((fy - ty) * 256), 1, 1).data] : null);
}
async function hazardAt(lat, lng) {
  const [t, f, a, b, c] = await Promise.all(['tsunami', 'flood', 'dosekiryu', 'kyukeisha', 'jisuberi'].map(k => tilePixel(HZ_LAYERS[k].path, lat, lng)));
  let s = 0;
  for (const px of [a, b, c]) if (px && px[3] >= 128) s = Math.max(s, dist2([250, 40, 0], px) < 300 ? 2 : 1);
  return { t: depthOf(DEPTH_T, t), f: depthOf(DEPTH_F, f), s };
}
const hzOfRow = r => HZ[`${r.lat},${r.lng}`] || null;

// 地図：ハザードの重ね表示
const hzLayers = {
  tsunami: L.tileLayer(HZ_URL(HZ_LAYERS.tsunami.path), { opacity: .6, maxNativeZoom: 17, maxZoom: 18 }),
  flood: L.tileLayer(HZ_URL(HZ_LAYERS.flood.path), { opacity: .6, maxNativeZoom: 17, maxZoom: 18 }),
  dosha: L.layerGroup(['dosekiryu', 'kyukeisha', 'jisuberi'].map(k => L.tileLayer(HZ_URL(HZ_LAYERS[k].path), { opacity: .7, maxNativeZoom: 17, maxZoom: 18 }))),
};
document.querySelectorAll('#hzSeg button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#hzSeg button').forEach(x => x.classList.toggle('on', x === b));
  Object.values(hzLayers).forEach(l => map.removeLayer(l));
  if (hzLayers[b.dataset.h]) hzLayers[b.dataset.h].addTo(map);
  const leg = { tsunami: DEPTH_T.map(([c, v]) => [c, DEPTH_LABEL[v]]), flood: DEPTH_F.map(([c, v]) => [c, DEPTH_LABEL_F[v]]),
    dosha: [[[250, 230, 0], '警戒区域'], [[250, 40, 0], '特別警戒区域']] }[b.dataset.h];
  let el = document.querySelector('#hzLeg');
  if (!el) { el = document.createElement('div'); el.id = 'hzLeg'; document.querySelector('#legend').after(el); }
  el.className = 'legend hzLeg';
  el.style.display = leg ? '' : 'none';
  if (leg) el.innerHTML = `<div class="t">${{ tsunami: '津波 浸水深', flood: '洪水 浸水深', dosha: '土砂災害' }[b.dataset.h]}</div>` +
    leg.map(([c, l]) => `<div class="row"><span class="sw" style="border-radius:3px;background:rgb(${c})"></span>${l}</div>`).join('');
  map.attributionControl.addAttribution('<a href="https://disaportal.gsi.go.jp/" target="_blank">ハザードマップポータルサイト</a>');
});

// ハザードが価格に効く大きさ（対数）。scripts/hazard_effect.py で高知の取引・公示を検証して決めた値
// 検証結果（近所の取引との差）：津波3〜5m −11%（76件）、5m以上 −28%（66件）、3m未満は差なし／洪水は差なし／
// 土砂の警戒区域は差なし（65件）、特別警戒区域 −45%（7件と少ないため控えめに −25%）
const HZ_COEF = {
  t: [[5, Math.log(0.72)], [3, Math.log(0.89)], [1, 0], [0.01, 0]], // 津波：深さの下限(m) → 効果
  f: [[3, 0], [0.5, 0], [0.01, 0]],                                    // 洪水：高知の取引では価格差が見られない
  s: [0, 0, Math.log(0.75)],                                           // 土砂：区域外・警戒・特別警戒
};
const coefOf = (rows, v) => (rows.find(([th]) => v >= th) || [0, 0])[1];
// 津波と洪水は「浸水」として重い方だけを数え、土砂は別に足す
const hzLogEffect = h => Math.min(coefOf(HZ_COEF.t, h.t), coefOf(HZ_COEF.f, h.f)) + HZ_COEF.s[h.s];
const hzText = h => [h.t ? `津波${DEPTH_LABEL[h.t]}` : '', h.f ? `洪水${DEPTH_LABEL_F[h.f]}` : '', h.s ? ['', '土砂警戒区域', '土砂特別警戒区域'][h.s] : ''].filter(Boolean).join('・') || 'なし';
