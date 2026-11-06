// 自社の成約実績：査定結果を記録し、実際の成約価格と比べて査定のずれを集計・補正する。
// 保存先はこの端末のブラウザ（localStorage）。端末間の移動・バックアップはCSVで行う。
'use strict';
(() => {
  const KEY = 'kochi_records', CFG = 'kochi_cfg', CORR = 'kochi_corr_on';
  const load = () => store.get(KEY, []);
  const save = list => store.set(KEY, list);
  const MIN_N = 5;

  // 査定結果を記録（補正前の査定額を保存して、補正が補正を呼ぶループを防ぐ）
  window.addRecord = run => {
    const { res, p, input, at } = run;
    const list = load();
    list.unshift({
      id: Date.now().toString(36), date: at.toISOString().slice(0, 10), addr: p.title.replace(/^高知県/, ''), lat: p.lat, lng: p.lng,
      kind: res.kind, est: res.raw ?? res.final, low: res.low, high: res.high,
      spec: res.kind === 'mansion' ? `${input.area}㎡・${input.built}年築` : `土地${input.land}㎡${input.floor > 0 ? `・延床${input.floor}㎡・${input.built}年築` : ''}`,
      sold: null, soldMonth: '',
    });
    save(list);
  };

  // 種別ごとの補正値（成約価格 ÷ 査定額 の中央値）。種別で5件未満なら全体で
  const stats = list => {
    const done = list.filter(r => r.sold > 0 && r.est > 0);
    const ratios = done.map(r => r.sold / r.est);
    return { n: done.length, factor: median(ratios), mae: median(ratios.map(x => Math.abs(x - 1))), within10: ratios.filter(x => Math.abs(x - 1) <= 0.1).length };
  };
  window.recordCorrection = kind => {
    const list = load();
    const group = k => k === 'mansion' ? 'mansion' : 'house';
    let s = stats(list.filter(r => group(r.kind) === group(kind)));
    if (s.n < MIN_N) s = stats(list);
    if (s.n < MIN_N || !Number.isFinite(s.factor)) return s.n ? { n: s.n, factor: s.factor, on: false } : null;
    return { n: s.n, factor: s.factor, on: !!store.get(CORR, false) };
  };

  window.renderRecords = () => {
    const list = load(), s = stats(list);
    const on = !!store.get(CORR, false);
    $('#recSummary').innerHTML = `
      <div class="stat">
        <div><span>記録した査定</span><b>${list.length}件</b></div>
        <div><span>成約価格を入力済み</span><b>${s.n}件</b></div>
        <div><span>成約÷査定（中央値）</span><b>${s.n ? pct(s.factor - 1) : '—'}</b></div>
        <div><span>ずれの大きさ（中央値）</span><b>${s.n ? Math.round(s.mae * 100) + '%' : '—'}</b></div>
      </div>
      ${s.n >= MIN_N
        ? `<label class="chk"><input type="checkbox" id="corrOn" ${on ? 'checked' : ''}> 査定額を自社の成約実績で補正する（成約価格が査定額の中央値で ${pct(s.factor - 1)}）</label>
           <div class="sub">土地・戸建とマンションは別々に集計し、片方が${MIN_N}件未満のときは全体の値を使います。</div>`
        : `<div class="sub">成約価格が${MIN_N}件以上入ると、査定額を自社の実績で補正できるようになります（あと${MIN_N - s.n}件）。</div>`}`;
    const corr = $('#corrOn');
    if (corr) corr.onchange = () => store.set(CORR, corr.checked);

    $('#recTable').innerHTML = list.length ? `<thead><tr><th>査定日</th><th>所在地</th><th>種別</th><th>内容</th><th class="n">査定額</th><th>成約価格（万円）</th><th>成約月</th><th class="n">差</th><th></th></tr></thead>
      <tbody>${list.map(r => {
        const diff = r.sold > 0 ? r.sold / r.est - 1 : null;
        return `<tr data-id="${r.id}"><td>${r.date}</td><td>${esc(r.addr)}</td><td>${KIND_NAME[r.kind] || r.kind}</td><td>${esc(r.spec)}</td><td class="n">${man(r.est)}</td>
          <td><input type="number" inputmode="numeric" min="0" step="10" data-f="sold" value="${r.sold > 0 ? Math.round(r.sold / 1e4) : ''}" placeholder="例 2500"></td>
          <td><input type="month" data-f="soldMonth" value="${esc(r.soldMonth)}"></td>
          <td class="n">${diff == null ? '—' : pct(diff)}</td><td><button type="button" data-del title="削除">削除</button></td></tr>`;
      }).join('')}</tbody>`
      : '<tbody><tr><td class="empty">まだ記録がありません。査定結果の「成約実績に記録」から登録できます。</td></tr></tbody>';
    document.querySelectorAll('#recTable input').forEach(inp => inp.onchange = () => {
      const id = inp.closest('tr').dataset.id, list = load(), r = list.find(x => x.id === id);
      if (inp.dataset.f === 'sold') r.sold = inp.value ? Number(inp.value) * 1e4 : null; else r.soldMonth = inp.value;
      save(list); renderRecords();
    });
    document.querySelectorAll('#recTable [data-del]').forEach(b => b.onclick = () => {
      const id = b.closest('tr').dataset.id;
      if (!confirm('この記録を削除しますか？')) return;
      save(load().filter(x => x.id !== id)); renderRecords();
    });
  };

  // CSVの書き出し・読み込み
  const COLS = ['id', 'date', 'addr', 'lat', 'lng', 'kind', 'est', 'low', 'high', 'spec', 'sold', 'soldMonth'];
  const csvCell = v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
  $('#recExport').onclick = () => {
    const text = '﻿' + [COLS.join(','), ...load().map(r => COLS.map(c => csvCell(r[c])).join(','))].join('\n');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: `成約実績_${new Date().toISOString().slice(0, 10)}.csv` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  function parseCsv(text) {
    const rows = [[]]; let cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { rows.at(-1).push(cur); cur = ''; }
      else if (c === '\n') { rows.at(-1).push(cur); rows.push([]); cur = ''; } else if (c !== '\r') cur += c;
    }
    rows.at(-1).push(cur);
    return rows.filter(r => r.length > 1);
  }
  $('#recImport').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const [head, ...body] = parseCsv((await file.text()).replace(/^﻿/, ''));
    const idx = Object.fromEntries(head.map((h, i) => [h, i]));
    if (!('id' in idx && 'est' in idx)) { alert('このアプリで書き出したCSVを選んでください。'); return; }
    const list = load(), byId = new Map(list.map(r => [r.id, r]));
    let added = 0, updated = 0;
    for (const row of body) {
      const r = Object.fromEntries(COLS.map(c => [c, row[idx[c]] ?? '']));
      for (const k of ['lat', 'lng', 'est', 'low', 'high', 'sold']) r[k] = r[k] === '' ? null : Number(r[k]);
      if (byId.has(r.id)) { Object.assign(byId.get(r.id), r); updated++; } else { list.push(r); added++; }
    }
    save(list); renderRecords(); e.target.value = '';
    alert(`読み込みました（追加${added}件・更新${updated}件）。`);
  };

  // 査定書の設定（会社名など）
  const cfg = store.get(CFG, {});
  for (const [id, key] of [['cfgCompany', 'company'], ['cfgStaff', 'staff'], ['cfgContact', 'contact']]) {
    const el = $('#' + id); el.value = cfg[key] || '';
    el.onchange = () => { const c = store.get(CFG, {}); c[key] = el.value.trim(); store.set(CFG, c); };
  }
})();
