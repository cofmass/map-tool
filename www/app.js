/**
 * 沿途最顺路 · 地图工具 前端逻辑
 * 设计依据：docs/设计文档/map-tool/地图网页工具设计方案.md
 *
 * KEY 策略：Web 服务 KEY 用于 fetch 调高德 REST（geocode/direction/place），
 *          JS API KEY 用于加载 AMap JS SDK 显示地图与路线。
 *          两者可填同一个（需同时开通两类服务）。
 */
(function () {
  'use strict';

  // ---------- 常量 ----------
  const LS_KEYS = {
    web: 'maptool.key.web',
    js: 'maptool.key.js',
    mode: 'maptool.travel.mode'
  };
  const REST_HOST = 'https://restapi.amap.com';
  const REST_BASE = REST_HOST + '/v3';
  // 高德控制台已有 KEY（账号：高德JPI入门应用；2026-11-24 从已登录浏览器读取并实测通过）
  const DEFAULT_KEYS = {
    web: '6c5b817b24bce82746c3c53c270c3892',
    js: '07030115396a7f18744a1836e9e2b8d7'
  };
  const MAX_WAYPOINTS = 10;          // 页面允许的最大途经点数；驾车高德上限更高，此处统一限制
  const MODES = {
    driving: { label: '驾车', hint: '驾车支持原生多途经点与多方案对比。' },
    cycling: { label: '骑行', hint: '高德骑行接口不支持途经点；有 C 点时自动拆成多段骑行路线拼接。' },
    walking: { label: '步行', hint: '高德步行接口不支持途经点；有 C 点时自动拆成多段步行路线拼接。' },
    transit: { label: '公交', hint: '公交接口不支持途经点；有 C 点时逐段换乘拼接。公交路线按预估用时排序，「绕行」以距离差与用时差估算。' }
  };
  const MAX_POI_SAMPLES = 30;        // 走廊采样点上限，控制配额
  const CANDIDATE_FETCH_LIMIT = 20;  // 粗筛后进入精确打分的候选数（每组要凑 5 个）
  const DETAIL_TOP_N = 20;           // 精确二次规划取前 N（每候选 1 次请求）
  const GROUP_TOP_N = 5;             // 每个锚点分组展示 Top N
  const ANCHOR_POOL_N = 10;          // 每个锚点先取最近 N 个候选再按绕行排序

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const dom = {
    keyWarning: $('key-warning'),
    btnSettings: $('btn-settings'),
    btnTheme: $('btn-theme'),
    modal: $('settings-modal'),
    keyWeb: $('key-web'),
    keyJs: $('key-js'),
    btnSaveSettings: $('btn-settings-save'),
    btnClearSettings: $('btn-settings-clear'),
    tabs: Array.from(document.querySelectorAll('.tab')),
    modeBtns: Array.from(document.querySelectorAll('.mode-btn')),
    modeHint: $('mode-hint'),
    tabNavigate: $('tab-navigate'),
    tabAlong: $('tab-along'),
    inputA: $('input-a'),
    btnLocate: $('btn-locate'),
    inputB: $('input-b'),
    inputKeyword: $('input-keyword'),
    inputRadius: $('input-radius'),
    inputInterval: $('input-interval'),
    waypointList: $('waypoint-list'),
    btnAddWaypoint: $('btn-add-waypoint'),
    btnRoute: $('btn-route'),
    btnAlong: $('btn-along'),
    routeSection: $('route-section'),
    routeCount: $('route-count'),
    routeList: $('route-list'),
    poiSection: $('poi-section'),
    poiCount: $('poi-count'),
    poiStatus: $('poi-status'),
    poiFilters: $('poi-filters'),
    poiList: $('poi-list'),
    mapContainer: $('map-container'),
    mapPlaceholder: $('map-placeholder'),
    mapWrap: document.querySelector('.map-wrap'),
    toast: $('toast')
  };

  // ---------- 状态 ----------
  const state = {
    keys: { web: '', js: '' },
    mode: 'driving',
    map: null,
    AMap: null,
    picking: null,               // 'a' | 'b' | 'wp-<idx>' | null
    currentPosition: null,       // 当前定位 { lng, lat }，用于输入提示按距离排序
    currentMarker: null,         // 当前位置标记
    locatedOnce: false,
    markers: [],
    polylines: [],
    origin: null,                // { lng, lat, name }
    destination: null,
    waypoints: [],               // [{ lng, lat, name }]
    routeData: [],               // 高德 driving paths
    baseRouteGeo: null,          // 基础路线经纬度串（用于 F3 采样，含途经点）
    baseRouteDistance: null,
    baseRouteDuration: null,
    baseWaypoints: [],           // 基础路线已解析的途经点（F3 打分基线）
    activePathIndex: 0,
    candidatePois: [],           // 沿途候选（含 detour 结果）
    activePoiGroup: 'all',       // 当前候选分组：'all' | 'A' | 'B' | 'C0' ...
    displayedPois: [],           // 当前显示的候选（分组 + Top5 后）
    poiMarkers: [],
    selectedPoiIndex: -1,        // 沿途搜索当前选中的 POI 下标
    routePolylineObjs: [],
    routePathObjsByIndex: [],
    mapLoaded: false
  };

  // ---------- 工具函数 ----------
  function toast(msg, ms = 2600) {
    dom.toast.textContent = msg;
    dom.toast.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => dom.toast.classList.add('hidden'), ms);
  }

  function fmtDistance(m) {
    if (m == null || isNaN(m)) return '-';
    return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
  }
  function fmtDuration(s) {
    if (s == null || isNaN(s)) return '-';
    const sign = s < 0 ? '-' : '+';
    const a = Math.abs(s);
    return sign + (a >= 3600 ? (a / 3600).toFixed(1) + ' h' : Math.round(a / 60) + ' min');
  }
  function fmtCoord(p) {
    return p ? `${p.lng.toFixed(5)},${p.lat.toFixed(5)}` : '';
  }
  function parseCoord(str) {
    if (!str) return null;
    const parts = str.split(/[,，\s]+/).map(Number);
    if (parts.length >= 2 && parts.every(n => !isNaN(n))) {
      return { lng: parts[0], lat: parts[1] };
    }
    return null;
  }

  function loadKeys() {
    state.keys.web = localStorage.getItem(LS_KEYS.web) || DEFAULT_KEYS.web;
    state.keys.js = localStorage.getItem(LS_KEYS.js) || DEFAULT_KEYS.js;
    dom.keyWeb.value = state.keys.web;
    dom.keyJs.value = state.keys.js;
    updateKeyWarning();
  }
  function saveKeys() {
    state.keys.web = dom.keyWeb.value.trim();
    state.keys.js = dom.keyJs.value.trim();
    localStorage.setItem(LS_KEYS.web, state.keys.web);
    localStorage.setItem(LS_KEYS.js, state.keys.js);
    updateKeyWarning();
  }
  function updateKeyWarning() {
    const missing = !state.keys.web || !state.keys.js;
    dom.keyWarning.classList.toggle('hidden', !missing);
  }
  function requireKeys() {
    if (!state.keys.web || !state.keys.js) {
      toast('请先配置高德 Web 服务 KEY 与 JS API KEY');
      openModal();
      return false;
    }
    return true;
  }

  // ---------- 设置弹窗 ----------
  function openModal() {
    dom.keyWeb.value = state.keys.web;
    dom.keyJs.value = state.keys.js;
    dom.modal.classList.remove('hidden');
  }
  function closeModal() { dom.modal.classList.add('hidden'); }

  dom.btnSettings.addEventListener('click', openModal);
  dom.modal.querySelectorAll('[data-close-modal]').forEach(el => el.addEventListener('click', closeModal));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  dom.btnClearSettings.addEventListener('click', () => {
    localStorage.removeItem(LS_KEYS.web);
    localStorage.removeItem(LS_KEYS.js);
    state.keys.web = '';
    state.keys.js = '';
    dom.keyWeb.value = '';
    dom.keyJs.value = '';
    updateKeyWarning();
    toast('已清除本地 KEY');
  });

  dom.btnSaveSettings.addEventListener('click', () => {
    const oldJs = state.keys.js;
    saveKeys();
    closeModal();
    toast('KEY 已保存到本浏览器');
    if (state.keys.js !== oldJs || !state.map) {
      initMap();
    }
  });

  // ---------- Tab 切换 ----------
  dom.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      dom.tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      dom.tabNavigate.classList.toggle('hidden', target !== 'navigate');
      dom.tabAlong.classList.toggle('hidden', target !== 'along');
    });
  });

  // ---------- 出行方式切换 ----------
  function applyModeUI() {
    dom.modeBtns.forEach(btn => {
      const active = btn.dataset.mode === state.mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    const hint = MODES[state.mode].hint;
    dom.modeHint.textContent = hint;
    dom.modeHint.classList.toggle('hidden', !hint);
  }
  function setMode(mode, autoReplan = true) {
    if (!MODES[mode] || mode === state.mode) return;
    state.mode = mode;
    try { localStorage.setItem(LS_KEYS.mode, mode); } catch (e) {}
    applyModeUI();
    if (autoReplan && state.origin && state.destination && state.routeData.length) handleRoute();
  }
  dom.modeBtns.forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // ---------- 途经点动态输入 ----------
  function addWaypointInput(value = '') {
    if (state.waypoints.length >= MAX_WAYPOINTS) {
      toast(`最多支持 ${MAX_WAYPOINTS} 个途经点`);
      return;
    }
    const idx = state.waypoints.length;
    const wrap = document.createElement('div');
    wrap.className = 'autocomplete-wrap waypoint-ac';
    const inner = document.createElement('div');
    inner.className = 'waypoint-item';
    inner.innerHTML = `
      <input type="text" placeholder="途经点 C${idx + 1}" value="${escapeHtml(value)}" autocomplete="off">
      <button type="button" class="wp-pick" data-pick="wp-${idx}" title="在地图上选点">◎</button>
      <button type="button" class="wp-del" title="删除">×</button>`;
    const list = document.createElement('div');
    list.className = 'autocomplete-list hidden';
    wrap.appendChild(inner);
    wrap.appendChild(list);
    const input = inner.querySelector('input');
    bindAutocomplete(input, list);
    const currentIdx = () => Array.from(dom.waypointList.children).indexOf(wrap);
    input.addEventListener('input', () => {
      const i = currentIdx();
      if (i >= 0) state.waypoints[i] = { text: input.value, selected: input._selected };
    });
    input.addEventListener('autoselect', (e) => {
      const i = currentIdx();
      if (i >= 0) state.waypoints[i] = { text: input.value, selected: e.detail };
    });
    const pickBtn = inner.querySelector('.wp-pick');
    bindPickButton(pickBtn);
    inner.querySelector('.wp-del').addEventListener('click', () => {
      const i = currentIdx();
      if (i >= 0) state.waypoints.splice(i, 1);
      wrap.remove();
      rerenderWaypointIndices();
    });
    dom.waypointList.appendChild(wrap);
    state.waypoints.push({ text: value });
  }
  function rerenderWaypointIndices() {
    Array.from(dom.waypointList.children).forEach((wrap, i) => {
      wrap.querySelector('input').placeholder = `途经点 C${i + 1}`;
      wrap.querySelector('.wp-pick').dataset.pick = `wp-${i}`;
    });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  dom.btnAddWaypoint.addEventListener('click', () => addWaypointInput());

  // ---------- 输入提示下拉 ----------
  function bindAutocomplete(input, listEl, onSelected) {
    let timer = null, seq = 0;
    const close = () => { listEl.classList.add('hidden'); listEl.innerHTML = ''; };
    input.addEventListener('input', () => {
      input._selected = null; // 文本变化即作废旧选择
      clearTimeout(timer);
      const kw = input.value.trim();
      const mySeq = ++seq;
      if (!kw || parseCoord(kw)) { close(); return; }
      timer = setTimeout(async () => {
        try {
          const tips = await inputTips(kw);
          if (mySeq !== seq || input.value.trim() !== kw) return;
          if (!tips.length) {
            listEl.innerHTML = '<div class="autocomplete-empty">无匹配地址，可直接输入或地图选点</div>';
            listEl.classList.remove('hidden');
            return;
          }
          listEl.innerHTML = tips.map((t, i) => `
            <div class="autocomplete-item" data-i="${i}">
              <div class="ac-name">${escapeHtml(t.name)}</div>
              <div class="ac-addr">${escapeHtml(t.address || t.district || '')}</div>
            </div>`).join('');
          listEl.classList.remove('hidden');
          listEl.querySelectorAll('.autocomplete-item').forEach(el => {
            el.addEventListener('mousedown', (e) => {
              e.preventDefault();
              const t = tips[Number(el.dataset.i)];
              const loc = t.location.split(',');
              const addr = Array.isArray(t.address) ? t.address.join(' ') : (t.address || '');
              const picked = {
                lng: parseFloat(loc[0]), lat: parseFloat(loc[1]),
                name: t.name, formatted: addr || t.name, id: t.id,
                city: t.city, citycode: t.citycode, adcode: t.adcode
              };
              input.value = t.name;
              input._selected = picked;
              close();
              input.dispatchEvent(new CustomEvent('autoselect', { detail: picked }));
              if (onSelected) onSelected(picked);
            });
          });
        } catch (e) {
          // 输入提示失败不打断用户，静默关闭
          close();
        }
      }, 300);
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
    input.addEventListener('focus', () => {
      if (listEl.children.length) listEl.classList.remove('hidden');
    });
  }

  bindAutocomplete(dom.inputA, $('suggest-a'));
  bindAutocomplete(dom.inputB, $('suggest-b'));

  // ---------- 地图点选 ----------
  function bindPickButton(btn) {
    btn.addEventListener('click', () => {
      if (!requireKeys()) return;
      if (!state.map) { toast('地图尚未加载完成'); return; }
      const type = btn.dataset.pick;
      state.picking = type;
      dom.mapWrap.classList.add('picking');
      document.querySelectorAll('[data-pick]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      toast('请点击地图选择位置');
    });
  }
  document.querySelectorAll('[data-pick]').forEach(bindPickButton);

  // ---------- 高德 REST 封装 ----------
  // 全局串行队列 + 节流：所有 REST 请求都排队，避免 POI 搜索/路线规划叠加触发 QPS 限流
  let restQueue = Promise.resolve();
  let restLastAt = 0;
  const REST_MIN_INTERVAL = 420; // ms，高德 Web 服务常见 QPS 限制 ~3/s，留余量

  function restGet(path, params) {
    const run = async () => {
      const wait = REST_MIN_INTERVAL - (Date.now() - restLastAt);
      if (wait > 0) await sleep(wait);
      return restGetOnce(path, params);
    };
    const result = restQueue.then(run, run);
    restQueue = result.catch(() => {});
    return result;
  }

  async function restGetOnce(path, params) {
    const isBicycling = path === '/v4/direction/bicycling';
    const target = /^https?:\/\//.test(path) ? path
      : (path.startsWith('/v4/') ? REST_HOST + path : REST_BASE + path);
    const url = new URL(target);
    url.searchParams.set('key', state.keys.web);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v != null && v !== '') url.searchParams.set(k, v);
    });
    let json;
    const isQpsLimit = (j) =>
      j.infocode === '10021' || String(j.info || '').includes('CUQPS_HAS_EXCEEDED_THE_LIMIT') ||
      j.infocode === '10020' || String(j.info || '').includes('CUQPS_HAS_EXCEEDED_THE_QPS') ||
      (isBicycling && j.errcode === 10021);
    for (let attempt = 0; attempt < 5; attempt++) {
      let res;
      try {
        res = await fetch(url.toString());
      } catch (e) {
        if (attempt === 4) throw new Error('网络请求失败：' + e.message);
        await sleep(600 * (attempt + 1));
        continue;
      }
      try { json = await res.json(); }
      catch (e) { throw new Error('高德返回非 JSON 数据'); }
      restLastAt = Date.now();
      if (isQpsLimit(json)) {
        if (attempt === 4) throw new Error('请求过于频繁，请稍后重试');
        // 限流退避：2s 起递增，串行队列下不会影响其它请求
        await sleep(2000 * (attempt + 1));
        continue;
      }
      break;
    }
    if (isBicycling) {
      if (json.errcode !== 0) throw new Error(json.errdetail || json.errmsg || '骑行路线规划失败');
      return json;
    }
    if (json.status !== '1') {
      const info = json.info || '未知错误';
      const hintMap = {
        INVALID_USER_KEY: 'KEY 无效，请检查 Web 服务 KEY',
        USERKEY_PLAT_NOMATCH: 'KEY 类型不匹配，请使用 Web 服务类型 KEY',
        CUQ_NOT_MINUTE_ZERO: '配额超限（每分钟），请稍后重试',
        CUQ_NOT_DAY_ZERO: '配额超限（每日），请明天重试',
        OVER_QUOTA: '配额已用完，请检查高德控制台'
      };
      throw new Error(hintMap[json.infocode] || `${info}（infocode=${json.infocode}）`);
    }
    return json;
  }

  async function geocode(address, selected) {
    if (!address || !address.trim()) throw new Error('地址不能为空');
    if (selected) return { ...selected };
    const coord = parseCoord(address);
    if (coord) return { ...coord, name: address };
    // 优先输入提示（更贴合中文 POI/地名习惯），失败再退回地理编码
    try {
      const tips = await inputTips(address);
      if (tips.length) {
        const t = tips[0], loc = t.location.split(',');
        const addr = Array.isArray(t.address) ? t.address.join(' ') : (t.address || '');
        return {
          lng: parseFloat(loc[0]), lat: parseFloat(loc[1]),
          name: address, formatted: addr || address, id: t.id,
          city: t.city, citycode: t.citycode, adcode: t.adcode
        };
      }
    } catch (e) { /* 退回 geocode */ }
    const json = await restGet('/geocode/geo', { address });
    const geocodes = json.geocodes || [];
    if (!geocodes.length) throw new Error(`未找到地址：${address}`);
    const loc = geocodes[0].location.split(',');
    return {
      lng: parseFloat(loc[0]),
      lat: parseFloat(loc[1]),
      name: address,
      formatted: geocodes[0].formatted_address || address,
      adcode: geocodes[0].adcode
    };
  }

  // 输入提示：返回 [{ name, address, location, id }]
  // 传入当前位置（或已设起点）作为 location，让高德优先返回附近的同名地点
  async function inputTips(keyword) {
    if (!keyword || !keyword.trim()) return [];
    const params = { keywords: keyword, offset: 8 };
    const anchor = state.currentPosition || state.origin;
    if (anchor) params.location = coordStr(anchor);
    const json = await restGet('/assistant/inputtips', params);
    const tips = (json.tips || []).filter(t => t.location && t.location.includes(','));
    if (anchor) {
      tips.sort((a, b) => {
        const [al, at] = a.location.split(',').map(Number);
        const [bl, bt] = b.location.split(',').map(Number);
        return haversine(anchor, { lng: al, lat: at }) - haversine(anchor, { lng: bl, lat: bt });
      });
    }
    return tips;
  }

  function coordStr(p) { return `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`; }

  async function driving(origin, destination, waypoints = []) {
    const params = {
      origin: coordStr(origin),
      destination: coordStr(destination),
      extensions: 'base'
    };
    if (waypoints.length) params.waypoints = waypoints.map(w => (w.lng != null ? coordStr(w) : w.text)).join(';');
    const json = await restGet('/direction/driving', params);
    const paths = (json.route && json.route.paths) || [];
    if (!paths.length) throw new Error('未找到可行驾车路线');
    return paths;
  }

  async function walkingLeg(origin, destination) {
    const json = await restGet('/direction/walking', {
      origin: coordStr(origin), destination: coordStr(destination)
    });
    const paths = (json.route && json.route.paths) || [];
    if (!paths.length) throw new Error('未找到可行步行路线');
    return paths.map(p => ({ ...p, strategy: '步行推荐' }));
  }

  async function cyclingLeg(origin, destination) {
    const json = await restGet('/v4/direction/bicycling', {
      origin: coordStr(origin), destination: coordStr(destination)
    });
    const paths = (json.data && json.data.paths) || [];
    if (!paths.length) throw new Error('未找到可行骑行路线');
    return paths.map(p => ({ ...p, strategy: '骑行推荐' }));
  }

  async function resolveCity(p) {
    if (!p) return '';
    if (p._city) return p._city;
    if (p.citycode) p._city = p.citycode;
    else if (p.city) p._city = p.city;
    else if (p.adcode) p._city = String(p.adcode);
    else {
      const json = await restGet('/georegeo/regeo', { location: coordStr(p), extensions: 'base' });
      const comp = (json.regeocode && json.regeocode.addressComponent) || {};
      p._city = comp.citycode || comp.city || comp.adcode || '';
    }
    return p._city;
  }

  function normalizeTransit(t, route) {
    const steps = [];
    const lines = [];
    let distance = 0;
    (t.segments || []).forEach(seg => {
      if (seg.walking) {
        distance += Number(seg.walking.distance || 0);
        (seg.walking.steps || []).forEach(s => { if (s.polyline) steps.push(s); });
      }
      if (seg.bus) {
        (seg.bus.buslines || []).forEach(line => {
          distance += Number(line.distance || 0);
          const name = line.name || '公交线路';
          lines.push(name);
          if (line.polyline) steps.push({ polyline: line.polyline, road: name });
        });
      }
      if (seg.railway) {
        distance += Number(seg.railway.distance || 0);
        const name = seg.railway.name || '火车';
        lines.push(name);
        const from = seg.railway.departure_stop && seg.railway.departure_stop.location;
        const to = seg.railway.arrival_stop && seg.railway.arrival_stop.location;
        if (from && to) steps.push({ polyline: `${from};${to}`, road: name });
      }
    });
    return {
      distance: distance || Number(route.distance || 0),
      duration: Number(t.duration || 0),
      strategy: '公交换乘',
      summary: lines.join(' → ') || '公交路线',
      cost: t.cost,
      walking_distance: t.walking_distance,
      steps,
      transit: true
    };
  }

  async function transitLeg(origin, destination) {
    const [city, cityd] = await Promise.all([resolveCity(origin), resolveCity(destination)]);
    const params = {
      origin: coordStr(origin), destination: coordStr(destination),
      city, extensions: 'base', strategy: 0
    };
    if (cityd && cityd !== city) params.cityd = cityd;
    const json = await restGet('/direction/transit/integrated', params);
    const route = json.route || {};
    const transits = route.transits || [];
    if (!transits.length) throw new Error('未找到可行公交路线');
    // 公交方案按预估用时排序，只取最快方案，避免把不同换乘拼成一段。
    const fastest = transits.slice().sort((a, b) => Number(a.duration || 0) - Number(b.duration || 0))[0];
    return [normalizeTransit(fastest, route)];
  }

  // 多段拼接：骑行/步行/公交接口本身不支持途经点，按 A→C1→…→B 逐段规划后合并。
  async function planLegs(nodes, legFn, mode) {
    const legs = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      legs.push(await legFn(nodes[i], nodes[i + 1]));
    }
    const variants = legs[0].length;
    const combined = [];
    for (let v = 0; v < variants; v++) {
      let distance = 0, duration = 0;
      const steps = [], summaries = [];
      legs.forEach(paths => {
        const p = paths[Math.min(v, paths.length - 1)];
        distance += Number(p.distance || 0);
        duration += Number(p.duration || 0);
        (p.steps || []).forEach(s => steps.push(s));
        if (p.summary) summaries.push(p.summary);
      });
      combined.push({
        distance, duration, steps,
        strategy: mode === 'transit' ? '公交换乘' : (mode === 'cycling' ? '骑行推荐' : '步行推荐'),
        summary: summaries.join(' / ')
      });
    }
    return combined;
  }

  async function planRoute(mode, origin, destination, waypoints = []) {
    if (mode === 'driving') return driving(origin, destination, waypoints);
    const nodes = [origin, ...waypoints, destination];
    if (mode === 'transit') return planLegs(nodes, transitLeg, 'transit');
    if (mode === 'cycling') return planLegs(nodes, cyclingLeg, 'cycling');
    return planLegs(nodes, walkingLeg, 'walking');
  }

  async function textSearch(keyword, location, radius) {
    const json = await restGet('/place/text', {
      keywords: keyword,
      location: coordStr(location),
      radius: radius,
      offset: 25,
      page: 1,
      extensions: 'base'
    });
    return json.pois || [];
  }

  // ---------- 地图初始化 ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('高德 JS API 脚本加载失败'));
      document.head.appendChild(s);
    });
  }

  async function initMap() {
    if (!state.keys.js) return;
    dom.mapPlaceholder.querySelector('p').textContent = '正在加载地图…';
    try {
      if (!window.AMap) {
        await loadScript(`https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(state.keys.js)}&plugin=AMap.Polyline,AMap.Geolocation`);
      }
      state.AMap = window.AMap;
      if (!state.map) {
        state.map = new AMap.Map('map-container', {
          zoom: 11,
          center: [116.397428, 39.90923],
          viewMode: '2D'
        });
        state.map.on('click', onMapClick);
      }
      state.mapLoaded = true;
      dom.mapPlaceholder.classList.add('hidden');
      // 地图底图跟随当前主题
      if (state.map.setMapStyle) {
        state.map.setMapStyle(document.body.classList.contains('theme-dark') ? 'amap://styles/dark' : 'amap://styles/normal');
      }
      if (!state.locatedOnce) locateCurrent();
    } catch (e) {
      dom.mapPlaceholder.querySelector('p').textContent = '地图加载失败，请检查 JS API KEY';
      toast(e.message);
    }
  }

  // 在地图上显示当前位置（蓝点 + 半透明精度圈）
  function showCurrentPosition(lng, lat, accuracy) {
    if (!state.map || !state.AMap) return;
    if (state.currentMarker) { state.map.remove(state.currentMarker); state.currentMarker = null; }
    const A = state.AMap;
    const dot = new A.CircleMarker({
      center: [lng, lat], radius: 8,
      fillColor: '#2563eb', fillOpacity: 1,
      strokeColor: '#ffffff', strokeWeight: 3, strokeOpacity: 1,
      zIndex: 200, title: '当前位置'
    });
    const overlays = [dot];
    if (accuracy && accuracy > 0) {
      overlays.push(new A.Circle({
        center: [lng, lat], radius: accuracy,
        fillColor: '#2563eb', fillOpacity: 0.12, strokeColor: '#2563eb', strokeOpacity: 0.3, strokeWeight: 1
      }));
    }
    state.map.add(overlays);
    state.currentMarker = overlays;
  }

  // IP 定位兜底：非 HTTPS（如局域网 http://192.168.x.x）下浏览器 Geolocation 不可用时使用
  async function ipLocate() {
    const json = await restGet('/ip', {});
    // /v3/ip 返回 province/city/adcode/rectangle（"lng1,lat1;lng2,lat2"），取矩形中心
    const rect = String(json.rectangle || '');
    const parts = rect.split(';').map(s => s.split(',').map(Number)).filter(a => a.length === 2 && a.every(Number.isFinite));
    if (!parts.length) throw new Error('IP 定位失败');
    const lng = (parts[0][0] + parts[parts.length - 1][0]) / 2;
    const lat = (parts[0][1] + parts[parts.length - 1][1]) / 2;
    const name = [json.province, json.city].filter(Boolean).join(' ') || 'IP 定位位置';
    return { lng, lat, name, citycode: json.citycode || '', city: json.city || '', adcode: json.adcode || '' };
  }

  // 定位当前位置并填入起点（逆地理编码取地址文字）
  function locateCurrent() {
    if (!state.map || !state.AMap) return;
    dom.btnLocate.textContent = '定位中…';
    let done = false;
    const finish = () => { if (!done) { done = true; dom.btnLocate.textContent = '⌖ 当前位置'; } };
    setTimeout(finish, 11000); // 回调不触发时兜底恢复按钮
    // 非安全上下文（http 且非 localhost）：浏览器 Geolocation 直接不可用，改走高德 IP 定位
    if (!window.isSecureContext) {
      applyLocateByIp();
      return;
    }
    let geoloc = new AMap.Geolocation({ enableHighAccuracy: true, timeout: 10000, noGeoLocation: 0 });
    geoloc.getCurrentPosition((status, result) => {
      finish();
      if (status !== 'complete' || !result.position) {
        applyLocateByIp();
        return;
      }
      state.locatedOnce = true;
      const lng = result.position.getLng(), lat = result.position.getLat();
      state.currentPosition = { lng, lat };
      const p = { lng, lat, name: '当前位置', formatted: result.formattedAddress || '当前位置' };
      state.origin = p;
      dom.inputA.value = result.formattedAddress || `${lng.toFixed(5)},${lat.toFixed(5)}`;
      dom.inputA._selected = p;
      state.map.setCenter([lng, lat]);
      state.map.setZoom(14);
      showCurrentPosition(lng, lat, result.accuracy);
      toast('已定位到当前位置并填入起点');
    });
  }

  // 用高德 IP 定位填起点（精度到城市级，提示用户可手动修正）
  async function applyLocateByIp() {
    try {
      const p = await ipLocate();
      state.locatedOnce = true;
      state.currentPosition = { lng: p.lng, lat: p.lat };
      const full = { ...p, formatted: p.name };
      state.origin = full;
      dom.inputA.value = p.name;
      dom.inputA._selected = full;
      state.map.setCenter([p.lng, p.lat]);
      state.map.setZoom(12);
      showCurrentPosition(p.lng, p.lat, 0);
      dom.btnLocate.textContent = '⌖ 当前位置';
      toast('浏览器定位不可用，已用 IP 定位到城市级位置，可手动修正起点');
    } catch (e) {
      dom.btnLocate.textContent = '⌖ 当前位置';
      toast('定位失败（浏览器定位不可用且 IP 定位失败），可手动输入起点或在地图选点');
    }
  }
  dom.btnLocate.addEventListener('click', () => {
    if (!state.mapLoaded) { toast('地图尚未加载完成'); return; }
    locateCurrent();
  });

  async function onMapClick(e) {
    if (!state.picking) return;
    const p = { lng: e.lnglat.getLng(), lat: e.lnglat.getLat(), name: '', citycode: '', city: '', adcode: '' };
    let target;
    if (state.picking === 'a') {
      state.origin = p;
      dom.inputA.value = fmtCoord(p);
      dom.inputA._selected = p;
      target = dom.inputA;
    } else if (state.picking === 'b') {
      state.destination = p;
      dom.inputB.value = fmtCoord(p);
      dom.inputB._selected = p;
      target = dom.inputB;
    } else if (state.picking.startsWith('wp-')) {
      const idx = Number(state.picking.split('-')[1]);
      const wp = { ...p, text: fmtCoord(p), name: fmtCoord(p), formatted: fmtCoord(p) };
      state.waypoints[idx] = wp;
      const wrap = dom.waypointList.children[idx];
      if (wrap) {
        const input = wrap.querySelector('input');
        input.value = fmtCoord(p);
        input._selected = wp;
        target = input;
      }
    }
    state.picking = null;
    dom.mapWrap.classList.remove('picking');
    document.querySelectorAll('[data-pick]').forEach(b => b.classList.remove('active'));
    toast('已选择位置');
    if (target) target.focus();
  }

  // ---------- 绘制 ----------
  function clearMapOverlays() {
    if (!state.map) return;
    try { state.map.remove(state.markers); } catch (e) {}
    try { state.map.remove(state.polylines); } catch (e) {}
    try { state.map.remove(state.poiMarkers); } catch (e) {}
    state.markers = [];
    state.polylines = [];
    state.poiMarkers = [];
  }

  function pathSegments(path) {
    return (path.steps || [])
      .map(step => (step.polyline || '').split(';').filter(Boolean).map(s => {
        const [lng, lat] = s.split(',').map(Number);
        return [lng, lat];
      }))
      .filter(points => points.length >= 2);
  }

  function drawRoutePaths(paths, activeIndex) {
    if (!state.map) return;
    try { state.map.remove(state.routePolylineObjs); } catch (e) {}
    state.routePolylineObjs = [];
    state.routePathObjsByIndex = [];
    paths.forEach((path, i) => {
      const objs = [];
      pathSegments(path).forEach(points => {
        const line = new AMap.Polyline({
          path: points,
          strokeColor: i === activeIndex ? '#2563eb' : '#94a3b8',
          strokeWeight: i === activeIndex ? 6 : 4,
          strokeOpacity: 0.9,
          strokeStyle: 'solid',
          zIndex: i === activeIndex ? 20 : 10
        });
        state.map.add(line);
        state.routePolylineObjs.push(line);
        objs.push(line);
      });
      state.routePathObjsByIndex.push(objs);
    });
    const activeObjs = state.routePathObjsByIndex[activeIndex] || [];
    if (activeObjs.length) state.map.setFitView(activeObjs, false, [40, 40, 40, 40]);
  }

  function pointName(p, fallback) {
    return (p && (p.name || p.formatted)) ? (p.name || p.formatted) : fallback;
  }

  function drawPointMarkers(extraPoi) {
    if (!state.map) return;
    try { state.map.remove(state.markers); } catch (e) {}
    state.markers = [];
    const pts = [
      { p: state.origin, title: pointName(state.origin, '起点'), color: '#16a34a' },
      { p: state.destination, title: pointName(state.destination, '终点'), color: '#dc2626' }
    ];
    state.waypoints.forEach((w, i) => pts.push({ p: w, title: pointName(w, `途经点 ${i + 1}`), color: '#f59e0b' }));
    if (extraPoi) {
      const poi = extraPoi.p || extraPoi;
      pts.push({ p: poi, title: pointName(poi, '顺路点'), color: '#7c3aed', selected: true });
    }
    pts.forEach(item => {
      if (!item.p || item.p.lng == null) return;
      const label = item.title.length > 18 ? item.title.slice(0, 18) + '…' : item.title;
      const marker = new AMap.Marker({
        position: [item.p.lng, item.p.lat],
        title: item.title,
        label: {
          content: `<div class="map-marker-label${item.selected ? ' selected-poi' : ''}">${escapeHtml(label)}</div>`,
          direction: 'top'
        },
        zIndex: item.selected ? 150 : 100
      });
      state.map.add(marker);
      state.markers.push(marker);
      if (item.selected) {
        const halo = new AMap.CircleMarker({
          center: [item.p.lng, item.p.lat], radius: 16,
          strokeColor: '#7c3aed', strokeWeight: 3, strokeOpacity: 0.9,
          fillColor: '#7c3aed', fillOpacity: 0.15, zIndex: 140
        });
        state.map.add(halo);
        state.markers.push(halo);
      }
    });
  }

  function drawPoiMarkers(pois) {
    if (!state.map) return;
    try { state.map.remove(state.poiMarkers); } catch (e) {}
    state.poiMarkers = [];
    pois.forEach((poi, i) => {
      const loc = (poi.location || '').split(',');
      if (loc.length < 2) return;
      const active = i === state.selectedPoiIndex;
      const name = poi.name || '候选点';
      const short = name.length > 12 ? name.slice(0, 12) + '…' : name;
      const m = new AMap.Marker({
        position: [parseFloat(loc[0]), parseFloat(loc[1])],
        title: name,
        label: { content: `<div class="poi-marker-label${active ? ' active' : ''}">${active ? '★ ' : ''}${escapeHtml(short)}</div>`, direction: 'top' },
        zIndex: active ? 130 : 50
      });
      m.on('click', () => selectPoiInDisplay(i));
      state.map.add(m);
      state.poiMarkers.push(m);
    });
  }

  // ---------- F1/F2：路线规划 ----------
  async function handleRoute() {
    if (!requireKeys()) return;
    const btn = dom.btnRoute;
    btn.disabled = true;
    btn.textContent = '规划中…';
    try {
      const [a, b] = await Promise.all([
        geocode(dom.inputA.value, dom.inputA._selected),
        geocode(dom.inputB.value, dom.inputB._selected)
      ]);
      state.origin = a;
      state.destination = b;
      state.waypoints = await resolveWaypoints();
      const paths = await planRoute(state.mode, a, b, state.waypoints);
      state.routeData = paths;
      state.baseRouteGeo = paths[0].steps.map(s => s.polyline || '').join(';');
      state.baseRouteDistance = Number(paths[0].distance);
      state.baseRouteDuration = Number(paths[0].duration);
      state.baseWaypoints = state.waypoints.slice();  // 保存含途经点的基线
      state.activePathIndex = 0;
      renderRouteList(paths);
      drawPointMarkers();
      drawRoutePaths(paths, 0);
      clearPoiResults();
      toast(`${MODES[state.mode].label}路线规划完成，共 ${paths.length} 个方案`);
    } catch (e) {
      toast('规划失败：' + e.message, 4000);
    } finally {
      btn.disabled = false;
      btn.textContent = '规划路线';
    }
  }

  async function resolveWaypoints() {
    const resolved = [];
    for (const w of state.waypoints) {
      if (w.lng != null) { resolved.push(w); continue; }
      if (w.selected) { resolved.push(w.selected); continue; }
      const text = (w.text || '').trim();
      if (!text) continue;
      resolved.push(await geocode(text));
    }
    return resolved;
  }

  function renderRouteList(paths) {
    dom.routeSection.classList.remove('hidden');
    dom.routeCount.textContent = String(paths.length);
    dom.routeList.innerHTML = '';
    const modeLabel = MODES[state.mode].label;
    paths.forEach((path, i) => {
      const card = document.createElement('div');
      card.className = 'route-card' + (i === state.activePathIndex ? ' active' : '');
      const strategy = path.strategy ? String(path.strategy).replace(/_/g, ' ') : modeLabel;
      const detail = path.summary ? ` · ${escapeHtml(path.summary)}` : '';
      const cost = path.cost != null ? ` · ¥${escapeHtml(String(path.cost))}` : '';
      card.innerHTML = `
        <div class="route-card-title">
          <span>方案 ${i + 1}${i === 0 ? ' · 推荐' : ''}</span>
          <span class="route-card-meta">${fmtDistance(Number(path.distance))}</span>
        </div>
        <div class="route-card-meta">约 ${fmtDuration(Number(path.duration))} · ${escapeHtml(strategy)}${cost}${detail}</div>
        <div class="route-card-addr">A ${escapeHtml(state.origin.formatted || state.origin.name)} → B ${escapeHtml(state.destination.formatted || state.destination.name)}${state.waypoints.length ? " · 途经 " + escapeHtml(state.waypoints.map(w => w.formatted || w.name).join(" → ")) : ""}</div>`;
      card.addEventListener('click', () => {
        state.activePathIndex = i;
        renderRouteList(paths);
        drawRoutePaths(paths, i);
      });
      dom.routeList.appendChild(card);
    });
  }

  // ---------- F3：沿途搜索 ----------
  function haversine(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const s = Math.sin(dLat/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function samplePolyline(polylineStr, intervalMeters) {
    const pts = polylineStr.split(';').filter(Boolean).map(s => {
      const [lng, lat] = s.split(',').map(Number);
      return { lng, lat };
    });
    if (!pts.length) return [];
    const samples = [];
    let acc = 0;
    samples.push(pts[0]);
    for (let i = 1; i < pts.length; i++) {
      const d = haversine(pts[i-1], pts[i]);
      acc += d;
      if (acc >= intervalMeters) {
        samples.push(pts[i]);
        acc = 0;
      }
    }
    if (samples[samples.length-1] !== pts[pts.length-1]) samples.push(pts[pts.length-1]);
    return samples.slice(0, MAX_POI_SAMPLES);
  }

  // 粗筛：用直线段估算绕行（点到线段的最近距离）
  function pointToSegment(p, a, b) {
    const dx = b.lng - a.lng, dy = b.lat - a.lat;
    if (dx === 0 && dy === 0) return haversine(p, a);
    const t = Math.max(0, Math.min(1, ((p.lng - a.lng)*dx + (p.lat - a.lat)*dy) / (dx*dx + dy*dy)));
    const proj = { lng: a.lng + t*dx, lat: a.lat + t*dy };
    return haversine(p, proj);
  }
  function quickDetourEstimate(poi, routePts) {
    const loc = (poi.location || '').split(',');
    const p = { lng: parseFloat(loc[0]), lat: parseFloat(loc[1]) };
    let min = Infinity;
    for (let i = 1; i < routePts.length; i++) {
      min = Math.min(min, pointToSegment(p, routePts[i-1], routePts[i]));
    }
    return min; // 离路线越近，预估绕行越小
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /**
   * 候选 P 插入含途经点路线的最佳位置打分（每候选 1 次路线请求）。
   * 基础节点序列：[A, C1, …, Cn, B]；用点到节点段的直线距离选最近段作为插入位置，
   * 再用完整路线（含 P）算真实绕行。同时记录到各锚点的直线距离用于分组筛选。
   * 返回 { detour, detourDur, waypoints, insertAfter, anchorDist }
   */
  async function scoreCandidateWithWaypoints(p) {
    const nodes = [state.origin, ...state.baseWaypoints, state.destination];
    // 选插入段：P 离哪一段最近
    let bestSeg = 0, bestD = Infinity;
    for (let seg = 0; seg < nodes.length - 1; seg++) {
      const d = pointToSegment(p, nodes[seg], nodes[seg + 1]);
      if (d < bestD) { bestD = d; bestSeg = seg; }
    }
    // 各锚点到 P 的直线距离
    const anchorDist = nodes.map(n => haversine(p, n));
    // 1 次请求：完整路线（含 P 插入最佳段）
    const wps = state.baseWaypoints.slice();
    wps.splice(bestSeg, 0, p);
    const full = await planRoute(state.mode, state.origin, state.destination, wps);
    const detour = Number(full[0].distance) - state.baseRouteDistance;
    const detourDur = Number(full[0].duration) - state.baseRouteDuration;
    return { detour, detourDur, via: p, waypoints: wps, insertAfter: bestSeg, anchorDist };
  }

  async function handleAlong() {
    if (!requireKeys()) return;
    const keyword = dom.inputKeyword.value.trim();
    if (!keyword) { toast('请输入关键词'); return; }
    if (!state.baseRouteGeo) {
      toast('请先规划 A→B 基础路线');
      dom.tabs[0].click();
      return;
    }
    const radius = Number(dom.inputRadius.value);
    const interval = Number(dom.inputInterval.value);
    const btn = dom.btnAlong;
    btn.disabled = true;
    btn.textContent = '搜索中…';
    try {
      dom.poiSection.classList.remove('hidden');
      dom.poiStatus.textContent = '正在沿路线采样并搜索 POI…';
      dom.poiList.innerHTML = '';
      const routePts = state.baseRouteGeo.split(';').filter(Boolean).map(s => {
        const [lng, lat] = s.split(',').map(Number);
        return { lng, lat };
      });
      const samples = samplePolyline(state.baseRouteGeo, interval);
      const seen = new Set();
      const pois = [];
      for (let i = 0; i < samples.length; i++) {
        const batch = await textSearch(keyword, samples[i], radius);
        batch.forEach(poi => {
          if (!seen.has(poi.id)) { seen.add(poi.id); pois.push(poi); }
        });
        dom.poiStatus.textContent = `已采样 ${i+1}/${samples.length}，找到 ${pois.length} 个候选…`;
      }
      if (!pois.length) {
        dom.poiStatus.textContent = `沿途 ${radius} m 内未找到「${keyword}」，可尝试扩大半径。`;
        dom.poiCount.textContent = '0';
        dom.poiFilters.classList.add('hidden');
        dom.poiFilters.innerHTML = '';
        state.displayedPois = [];
        drawPoiMarkers([]);
        toast('沿途未找到相关 POI');
        return;
      }

      // 粗筛：按离基础路线的距离排序，取前 CANDIDATE_FETCH_LIMIT 个
      pois.forEach(p => { p._quick = quickDetourEstimate(p, routePts); });
      pois.sort((a, b) => a._quick - b._quick);
      const shortlist = pois.slice(0, CANDIDATE_FETCH_LIMIT);

      dom.poiStatus.textContent = `粗筛完成，对 ${Math.min(shortlist.length, DETAIL_TOP_N)} 个候选做精确绕行计算…`;
      // 精确打分：把 P 插入含途经点路线的最佳位置，detour = 新路线总距离 - 基础距离
      const scored = [];
      for (let i = 0; i < Math.min(shortlist.length, DETAIL_TOP_N); i++) {
        const poi = shortlist[i];
        const loc = (poi.location || '').split(',');
        const p = { lng: parseFloat(loc[0]), lat: parseFloat(loc[1]), name: poi.name };
        try {
          const result = await scoreCandidateWithWaypoints(p);
          if (result) scored.push({ poi, ...result });
        } catch (e) {
          // 单点规划失败不影响整体；限流错误直接抛出停止整批
          if (String(e.message).includes('频繁')) throw e;
        }
      }
      if (!scored.length) {
        dom.poiStatus.textContent = '候选点路线规划均失败，请稍后重试。';
        return;
      }
      scored.sort((a, b) => a.detour - b.detour);
      state.candidatePois = scored;
      state.activePoiGroup = 'all';
      renderPoiFilters();
      const display = applyPoiGroup('all');
      dom.poiCount.textContent = String(display.length);
      dom.poiStatus.textContent = `找到 ${scored.length} 个候选，可按锚点筛选（每组展示绕行最小的 ${GROUP_TOP_N} 个）：`;
      // 自动展示最顺路那条路线
      if (display.length) await selectPoiInDisplay(0, true);
    } catch (e) {
      dom.poiStatus.textContent = '搜索失败：' + e.message;
      toast('搜索失败：' + e.message, 4000);
    } finally {
      btn.disabled = false;
      btn.textContent = '搜索沿途最顺路';
    }
  }

  // 锚点列表：[{ key, label, nodeIndex }]
  function poiAnchorDefs() {
    const defs = [
      { key: 'A', label: '靠近起点 A', nodeIndex: 0 }
    ];
    state.baseWaypoints.forEach((w, i) => {
      defs.push({ key: 'C' + i, label: '靠近途经点 C' + (i + 1), nodeIndex: i + 1 });
    });
    defs.push({ key: 'B', label: '靠近终点 B', nodeIndex: state.baseWaypoints.length + 1 });
    return defs;
  }

  function renderPoiFilters() {
    const defs = poiAnchorDefs();
    dom.poiFilters.innerHTML = '';
    dom.poiFilters.classList.remove('hidden');
    const opts = [{ key: 'all', label: '全部(最顺路)' }].concat(defs.map(d => ({ key: d.key, label: d.label })));
    opts.forEach(opt => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'poi-filter-btn' + (state.activePoiGroup === opt.key ? ' active' : '');
      b.textContent = opt.label;
      b.addEventListener('click', () => {
        state.activePoiGroup = opt.key;
        renderPoiFilters();
        const display = applyPoiGroup(opt.key);
        dom.poiCount.textContent = String(display.length);
      });
      dom.poiFilters.appendChild(b);
    });
  }

  // 按锚点筛选并取绕行最小的 GROUP_TOP_N 个，渲染列表 + 地图标记
  function applyPoiGroup(key) {
    const scored = state.candidatePois;
    let pool = scored;
    if (key !== 'all') {
      const def = poiAnchorDefs().find(d => d.key === key);
      if (def) {
        // 先按离该锚点的距离取前 CANDIDATE_FETCH_LIMIT 个，再按绕行排序
        pool = scored.slice().sort((a, b) => a.anchorDist[def.nodeIndex] - b.anchorDist[def.nodeIndex])
                        .slice(0, ANCHOR_POOL_N);
      }
    }
    // pool 已按 detour 全局排序（slice 保留相对顺序时）；对锚点池再确认一次 detour 排序
    const display = pool.slice().sort((a, b) => a.detour - b.detour).slice(0, GROUP_TOP_N);
    state.displayedPois = display;
    renderPoiList(display, key);
    drawPoiMarkers(display.map(x => x.poi));
    return display;
  }

  function renderPoiList(display, groupKey) {
    dom.poiList.innerHTML = '';
    display.forEach((item, i) => {
      const card = document.createElement('div');
      card.className = 'poi-card' + (i === state.selectedPoiIndex ? ' active' : '');
      const segLabel = item.insertAfter === 0 ? 'A→下一站' : `C${item.insertAfter}→下一站`;
      const tag = (groupKey === 'all' && i === 0) ? '<span class="poi-card-tag">最顺路</span>' : '';
      const selectedTag = i === state.selectedPoiIndex ? '<span class="poi-card-selected">当前选择</span>' : '';
      card.innerHTML = `
        <div class="poi-card-title">
          <span>${i + 1}. ${escapeHtml(item.poi.name)}</span>
          ${tag}${selectedTag}
        </div>
        <div class="poi-card-meta">绕行 ${item.detour < 0 ? '-' : '+'}${fmtDistance(Math.abs(item.detour))} · 用时 ${fmtDuration(item.detourDur)} · 插入 ${escapeHtml(segLabel)} · ${escapeHtml(item.poi.address || '')}</div>`;
      card.addEventListener('click', () => selectPoiInDisplay(i));
      dom.poiList.appendChild(card);
    });
  }

  async function selectPoiInDisplay(index, silent = false) {
    const item = state.displayedPois[index];
    if (!item) return;
    state.selectedPoiIndex = index;
    renderPoiList(state.displayedPois, state.activePoiGroup);
    // 地图候选标记同步高亮
    drawPoiMarkers(state.displayedPois.map(x => x.poi));
    // 显示含途经点 + P 的路线
    try {
      const paths = await planRoute(state.mode, state.origin, state.destination, item.waypoints || [item.via]);
      state.routeData = paths;
      state.activePathIndex = 0;
      renderRouteList(paths);
      drawRoutePaths(paths, 0);
      drawPointMarkers(item.via);
      if (!silent) toast(`已选择：${item.poi.name}`);
    } catch (e) {
      if (!silent) toast('路线规划失败：' + e.message);
    }
  }

  function clearPoiResults() {
    state.candidatePois = [];
    state.displayedPois = [];
    state.selectedPoiIndex = -1;
    dom.poiSection.classList.add('hidden');
    dom.poiList.innerHTML = '';
    dom.poiFilters.innerHTML = '';
    dom.poiFilters.classList.add('hidden');
    try { state.map && state.map.remove(state.poiMarkers); } catch (e) {}
    state.poiMarkers = [];
  }

  // ---------- 主题（明/暗） ----------
  const THEME_KEY = 'maptool.theme';
  function applyTheme(theme) {
    const dark = theme === 'dark';
    document.body.classList.toggle('theme-dark', dark);
    dom.btnTheme.textContent = dark ? '☀️' : '🌙';
    dom.btnTheme.title = dark ? '切换明亮模式' : '切换暗黑模式';
    dom.btnTheme.setAttribute('aria-label', dom.btnTheme.title);
    const settingsLabel = $('settings-theme-label');
    if (settingsLabel) settingsLabel.textContent = dark ? '暗色' : '亮色';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0a0f1c' : '#0f172a');
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch (e) {}
    if (state.map && state.map.setMapStyle) {
      state.map.setMapStyle(dark ? 'amap://styles/dark' : 'amap://styles/normal');
    }
  }
  function initTheme() {
    let saved = 'light';
    try { saved = localStorage.getItem(THEME_KEY) || 'light'; } catch (e) {}
    applyTheme(saved);
  }
  dom.btnTheme.addEventListener('click', () => {
    applyTheme(document.body.classList.contains('theme-dark') ? 'light' : 'dark');
  });
  const settingsThemeToggle = $('settings-theme-toggle');
  if (settingsThemeToggle) {
    settingsThemeToggle.addEventListener('click', () => {
      applyTheme(document.body.classList.contains('theme-dark') ? 'light' : 'dark');
    });
  }

  // ---------- 事件绑定 ----------
  dom.btnRoute.addEventListener('click', handleRoute);
  dom.btnAlong.addEventListener('click', handleAlong);

  // ---------- 启动 ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  initTheme();
  loadKeys();
  try {
    const savedMode = localStorage.getItem(LS_KEYS.mode);
    if (MODES[savedMode]) state.mode = savedMode;
  } catch (e) {}
  applyModeUI();
  if (state.keys.js) initMap();
})();
