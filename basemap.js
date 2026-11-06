// 背景地図。国土地理院の最適化ベクトルタイルを、不動産の相場確認用に独自の配色で描く。
// 「見やすい地図」＝オリジナル（道路の種類・駅・町名が読みやすく、データの円が目立つ淡い配色）
'use strict';
const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>';
const VT_URL = 'https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/{z}/{x}/{y}.pbf';
const FONT = ['NotoSansJP-Regular'];

// 注記（地名）の種類コード（高知のタイルを解析して確認：110=市町村 210=町名 220=小字 422=駅 322=川 6xx/53x=施設）
const ANNO = {
  city: [100, 110, 120, 130, 140],
  town: [210],
  small: [220],
  station: [422],
  river: [322],
  facility: [531, 534, 621, 631, 632, 633, 634, 673],
};

function originalStyle() {
  const rd = (ctg) => ['==', ['get', 'vt_rdctg'], ctg];
  const w = (z10, z14, z17) => ['interpolate', ['exponential', 1.6], ['zoom'], 10, z10, 14, z14, 17, z17];
  const isRoadKind = ['in', ['get', 'vt_code'], ['literal', [2701, 2702, 2703, 2711, 2712, 2713, 2721, 2722, 2723, 2731, 2732, 2733]]];
  return {
    version: 8,
    glyphs: 'https://gsi-cyberjapan.github.io/optimal_bvmap/glyphs/{fontstack}/{range}.pbf',
    sources: { v: { type: 'vector', tiles: [VT_URL], minzoom: 4, maxzoom: 16, attribution: '国土地理院ベクトルタイル（独自配色）' } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#f3f1ea' } },
      { id: 'water', type: 'fill', source: 'v', 'source-layer': 'WA', paint: { 'fill-color': '#c6dbee' } },
      { id: 'water-line', type: 'line', source: 'v', 'source-layer': 'WL', paint: { 'line-color': '#9fc0de', 'line-width': 1 } },
      { id: 'river', type: 'line', source: 'v', 'source-layer': 'RvrCL', paint: { 'line-color': '#9fc0de', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 2] } },
      { id: 'coast', type: 'line', source: 'v', 'source-layer': 'Cstline', paint: { 'line-color': '#8fb3d6', 'line-width': 1 } },
      { id: 'bldg', type: 'fill', source: 'v', 'source-layer': 'BldA', minzoom: 14, paint: { 'fill-color': '#e3dfd5', 'fill-outline-color': '#cfc9bb' } },
      { id: 'adm', type: 'line', source: 'v', 'source-layer': 'AdmBdry', paint: { 'line-color': '#8a7fa8', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 14, 2], 'line-dasharray': [4, 2] } },
      // 道路：縁取り → 中身。高速・国道・県道・市町村道を色で区別
      { id: 'rd-case', type: 'line', source: 'v', 'source-layer': 'RdCL', minzoom: 12, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#c9c2b2', 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'],
          12, ['match', ['get', 'vt_rdctg'], ['高速自動車国道等', '国道'], 4, '都道府県道', 3.4, 1.6],
          14, ['match', ['get', 'vt_rdctg'], ['高速自動車国道等', '国道'], 7, '都道府県道', 6, 3],
          17, ['match', ['get', 'vt_rdctg'], ['高速自動車国道等', '国道'], 16, '都道府県道', 14, 9]] } },
      { id: 'rd-minor', type: 'line', source: 'v', 'source-layer': 'RdCL', minzoom: 12, filter: ['!', ['in', ['get', 'vt_rdctg'], ['literal', ['高速自動車国道等', '国道', '都道府県道']]]],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': w(0.3, 2, 7) } },
      { id: 'rd-pref', type: 'line', source: 'v', 'source-layer': 'RdCL', filter: rd('都道府県道'), layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#f6d98a', 'line-width': w(1, 4.5, 11) } },
      { id: 'rd-nat', type: 'line', source: 'v', 'source-layer': 'RdCL', filter: rd('国道'), layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#f2b65a', 'line-width': w(1.5, 5.5, 13) } },
      { id: 'rd-exp', type: 'line', source: 'v', 'source-layer': 'RdCL', filter: rd('高速自動車国道等'), layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#d9822b', 'line-width': w(1.5, 5, 12) } },
      // 鉄道：濃い線＋白い破線（昔ながらの鉄道表記）
      { id: 'rail', type: 'line', source: 'v', 'source-layer': 'RailCL', paint: { 'line-color': '#4d4d4d', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 16, 4] } },
      { id: 'rail-dash', type: 'line', source: 'v', 'source-layer': 'RailCL', minzoom: 12, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 2.2], 'line-dasharray': [3, 3] } },
      // 地名：市町村名＞駅名＞町名の順に目立たせる。小さな施設名などは出さない
      { id: 'lbl-town', type: 'symbol', source: 'v', 'source-layer': 'Anno', minzoom: 13,
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['in', ['get', 'vt_code'], ['literal', ANNO.town]]],
        layout: { 'text-field': ['get', 'vt_text'], 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 11, 16, 14], 'text-padding': 4 },
        paint: { 'text-color': '#5b5547', 'text-halo-color': '#f3f1ea', 'text-halo-width': 2 } },
      { id: 'lbl-small', type: 'symbol', source: 'v', 'source-layer': 'Anno', minzoom: 15,
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['in', ['get', 'vt_code'], ['literal', ANNO.small.concat(ANNO.facility)]]],
        layout: { 'text-field': ['get', 'vt_text'], 'text-font': FONT, 'text-size': 11, 'text-padding': 4 },
        paint: { 'text-color': '#7a7466', 'text-halo-color': '#f3f1ea', 'text-halo-width': 1.5 } },
      { id: 'lbl-river', type: 'symbol', source: 'v', 'source-layer': 'Anno', minzoom: 12,
        filter: ['in', ['get', 'vt_code'], ['literal', ANNO.river]],
        layout: { 'text-field': ['get', 'vt_text'], 'text-font': FONT, 'text-size': 12 },
        paint: { 'text-color': '#3f74a8', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } },
      { id: 'lbl-other', type: 'symbol', source: 'v', 'source-layer': 'Anno', minzoom: 11,
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['in', ['get', 'vt_code'], ['literal', ANNO.station]]],
        layout: { 'text-field': ['get', 'vt_text'], 'text-font': FONT, 'text-size': 13, 'text-padding': 2 },
        paint: { 'text-color': '#1d1d1b', 'text-halo-color': '#ffffff', 'text-halo-width': 2.5 } },
      { id: 'lbl-city', type: 'symbol', source: 'v', 'source-layer': 'Anno',
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['in', ['get', 'vt_code'], ['literal', ANNO.city]]],
        layout: { 'text-field': ['get', 'vt_text'], 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 12, 13, 17] },
        paint: { 'text-color': '#3b3550', 'text-halo-color': '#ffffff', 'text-halo-width': 2.5 } },
    ],
  };
}

const BASEMAPS = {
  original: { name: '見やすい地図', make: () => L.maplibreGL({ style: originalStyle(), attribution: GSI_ATTR + '（独自配色）' }) },
  std: { name: '標準地図', make: () => L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', { attribution: GSI_ATTR, maxZoom: 18 }) },
  photo: { name: '航空写真', make: () => L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', { attribution: GSI_ATTR, maxZoom: 18 }) },
};
// MapLibreが使えない環境（古い端末など）では標準地図に切り替える
function makeBase(key) {
  try { if (key === 'original' && !(window.maplibregl && maplibregl.supported?.() !== false)) key = 'std'; return BASEMAPS[key].make(); }
  catch (e) { return BASEMAPS.std.make(); }
}
