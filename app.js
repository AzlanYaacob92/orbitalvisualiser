'use strict';
/* Chemulate Orbitals: UI logic + Three.js viewer.

   Hints for styles.css (owned by the Style agent):
   - CSS custom properties read at runtime by the 3-D viewer (define per theme):
       --orbital-pos  colour of + lobes     --orbital-neg  colour of - lobes
       --axis-color   (optional) axis lines/labels; falls back to the text colour
   - span.electron[data-spin="up"] is the LEFT half of a box, [data-spin="down"] the RIGHT half.
   - Extra classes added by app.js: #config-status .status-line.is-ok|is-warn|is-error,
     .config-shorthand, .legend-chip.is-pos|is-neg (background uses the CSS vars inline),
     .legend-sign, .legend-name, .legend-state, .viewer-fallback, #qn-ms .ms-note.
   - #orbital-canvas needs a height (min ~320px); app.js sets 360px inline only if it is < 100px.
*/
(function () {
  const Chem = window.OrbitalChem;
  const Shapes = window.OrbitalShapes;
  const Motion = window.Motion;

  /* ---------------- theme toggle ---------------- */
  const root = document.documentElement;
  // effective theme: explicit data-theme, else the OS preference
  function isDark() {
    const t = root.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  (function () {
    const btn = document.getElementById('theme-toggle');
    const icon = document.getElementById('theme-toggle-icon');
    if (!btn) return;
    function reflect() {
      const dark = isDark();
      btn.setAttribute('aria-pressed', String(dark));
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      if (icon) icon.textContent = dark ? '☀️' : '🌙';
    }
    btn.addEventListener('click', function () {
      const next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ }
      reflect();
    });
    reflect();
  })();

  if (!Chem || !Shapes) {
    const diagram = document.getElementById('energy-diagram');
    if (diagram) diagram.textContent = 'The chemistry data failed to load (chemistry.js / shapes.js).';
    return;
  }

  /* ---------------- helpers ---------------- */
  const LETTERS = ['s', 'p', 'd', 'f'];
  const $ = (id) => document.getElementById(id);
  const SUB = '₀₁₂₃₄₅₆₇₈₉';
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmtMl(v) { return v > 0 ? '+' + v : v < 0 ? '−' + Math.abs(v) : '0'; }
  function fmtMs(v) { return v > 0 ? '+½' : '−½'; }
  function fmtList(arr, f) { return arr.map(f || String).join(', '); }
  function lText(l) { return l + ' (' + (LETTERS[l] || '?') + ')'; }
  function spinName(s) { return s === 'up' ? 'spin up' : 'spin down'; }
  function cleanLabel(o) { return o.label || o.id; }

  const SUBSHELLS_LOW_FIRST = Chem.SUBSHELLS.slice().sort((a, b) => a.rank - b.rank);

  /* ---------------- state ---------------- */
  const state = {
    sliceMode: 'orbital',
    clickMode: 'explore',     // 'explore' = box click selects; 'fill' = box click toggles an electron
    selection: { level: 'orbital', id: '2px' },
    focusOrbital: null,       // orbital picked inside a subshell view
    occupancy: Chem.emptyOccupancy(),
    theme: root.getAttribute('data-theme') || 'light',
    anchor: '2px',            // the single orbital that anchors re-resolution when mode changes
    lastElectron: null,       // {orbital, spin, removed}
    message: '',              // transient error (e.g. 54 cap)
    loadedZ: null,
    hidden: new Set(),        // orbitals switched off via the legend; cleared whenever the selection changes
    hiddenKey: ''
  };

  /* ---------------- selection logic ---------------- */
  function selectedOrbitalIds() {
    try { return Chem.selectionToOrbitals(state.selection.level, state.selection.id) || []; }
    catch (e) { return []; }
  }

  function firstOrbitalOfSubshell(subId) {
    const s = Chem.getSubshell(subId);
    return s && s.orbitalIds[0];
  }

  function firstOrbitalOfShell(n) {
    for (const s of SUBSHELLS_LOW_FIRST) if (s.n === n) return s.orbitalIds[0];
    return null;
  }

  function applyMode(mode) {
    const prev = state.selection.level;
    state.sliceMode = mode;
    const a = Chem.getOrbital(state.anchor);
    if (!a) return;
    state.lastElectron = null;
    state.message = '';
    if (mode === 'orbital') {
      state.selection = { level: 'orbital', id: a.id };
      state.focusOrbital = null;
    } else if (mode === 'subshell') {
      state.selection = { level: 'subshell', id: a.subshellId };
      state.focusOrbital = prev === 'orbital' ? a.id : null;
    } else {
      state.selection = { level: 'shell', id: a.n };
      state.focusOrbital = null;
    }
  }

  function selectBox(orbId) {
    const o = Chem.getOrbital(orbId);
    if (!o) return;
    state.anchor = orbId;
    if (state.sliceMode === 'orbital') {
      state.selection = { level: 'orbital', id: orbId };
      state.focusOrbital = null;
    } else if (state.sliceMode === 'subshell') {
      state.selection = { level: 'subshell', id: o.subshellId };
      state.focusOrbital = orbId;
    } else {
      state.selection = { level: 'shell', id: o.n };
      state.focusOrbital = null;
    }
  }

  function selectSubshell(subId) {
    const a = Chem.getOrbital(state.anchor);
    if (!a || a.subshellId !== subId) state.anchor = firstOrbitalOfSubshell(subId);
    state.sliceMode = 'subshell';
    state.selection = { level: 'subshell', id: subId };
    state.focusOrbital = null;
    state.lastElectron = null;
    state.message = '';
  }

  function selectShell(n) {
    const a = Chem.getOrbital(state.anchor);
    if (!a || a.n !== n) state.anchor = firstOrbitalOfShell(n);
    state.sliceMode = 'shell';
    state.selection = { level: 'shell', id: n };
    state.focusOrbital = null;
    state.lastElectron = null;
    state.message = '';
  }

  /* ---------------- energy diagram ---------------- */
  const diagramEl = $('energy-diagram');
  const boxEls = {};   // orbitalId -> button
  const rowEls = [];   // {sub, row, label, tag, boxes:[ids]}

  function buildDiagram() {
    diagramEl.textContent = '';
    const axis = el('div', 'energy-axis');
    axis.appendChild(el('span', 'energy-arrow', 'Energy ↑'));
    axis.appendChild(el('span', 'energy-note', Chem.ENERGY_NOTE || ''));
    diagramEl.appendChild(axis);

    const high = Chem.SUBSHELLS.slice().sort((a, b) => b.rank - a.rank);
    high.forEach(function (sub) {
      const row = el('div', 'subshell-row');
      row.dataset.subshell = sub.id;
      row.dataset.n = sub.n;
      row.dataset.l = sub.l;

      const label = el('button', 'subshell-label', sub.id);
      label.type = 'button';
      label.setAttribute('aria-label', sub.id + ' subshell: select all its ' + sub.orbitalIds.length + ' orbital' + (sub.orbitalIds.length > 1 ? 's' : ''));
      const tag = el('button', 'shell-tag', 'n=' + sub.n);
      tag.type = 'button';
      tag.dataset.shell = sub.n;
      tag.setAttribute('aria-label', 'Shell n = ' + sub.n + ': select the whole shell');
      const boxes = el('div', 'orbital-boxes');
      boxes.setAttribute('role', 'group');
      boxes.setAttribute('aria-label', sub.id + ' orbitals');

      sub.orbitalIds.forEach(function (oid) {
        const o = Chem.getOrbital(oid);
        const b = el('button', 'orbital-box');
        b.type = 'button';
        b.dataset.orbital = oid;
        b.dataset.ml = o.ml;
        b.appendChild(el('span', 'ml-tag', fmtMl(o.ml)));
        boxes.appendChild(b);
        boxEls[oid] = b;
      });

      row.appendChild(label);
      row.appendChild(tag);
      row.appendChild(boxes);
      diagramEl.appendChild(row);
      rowEls.push({ sub: sub, row: row, label: label, tag: tag, ids: sub.orbitalIds.slice() });
    });
  }

  function updateDiagram() {
    const sel = new Set(selectedOrbitalIds());
    const mode = state.selection.level;
    const anchorO = Chem.getOrbital(state.anchor);

    function isContext(o) {
      if (sel.has(o.id)) return false;
      if (mode === 'orbital') return sel.size === 1 && Chem.getOrbital([...sel][0]).subshellId === o.subshellId;
      if (mode === 'subshell') { const any = Chem.getOrbital([...sel][0]); return !!any && any.n === o.n; }
      return false;
    }

    Object.keys(boxEls).forEach(function (oid) {
      const b = boxEls[oid];
      const o = Chem.getOrbital(oid);
      const isSel = sel.has(oid);
      const ctx = isContext(o);
      b.classList.toggle('is-selected', isSel);
      b.classList.toggle('is-context', ctx);
      b.classList.toggle('is-dimmed', !isSel && !ctx);
      b.classList.toggle('is-focus', state.focusOrbital === oid && mode === 'subshell');
      b.setAttribute('aria-pressed', String(isSel));

      const occ = state.occupancy[oid] || { up: false, down: false };
      // rebuild electrons in place (button itself persists, so keyboard focus is kept)
      Array.from(b.querySelectorAll('.electron')).forEach((e) => e.remove());
      const tagEl = b.querySelector('.ml-tag');
      ['up', 'down'].forEach(function (spin) {
        if (!occ[spin]) return;
        const e = el('span', 'electron', spin === 'up' ? '↑' : '↓');
        e.dataset.spin = spin;
        e.setAttribute('aria-hidden', 'true');
        const last = state.lastElectron;
        if (last && !last.removed && last.orbital === oid && last.spin === spin) e.classList.add('is-new');
        b.insertBefore(e, tagEl);
      });
      b.setAttribute('aria-label',
        cleanLabel(o) + ' orbital, n=' + o.n + ', l=' + o.l + ', ml=' + fmtMl(o.ml) + '. ' +
        'Spin up ' + (occ.up ? 'occupied' : 'empty') + ', spin down ' + (occ.down ? 'occupied' : 'empty') + '. ' +
        (state.clickMode === 'fill' ? 'Press to add or remove an electron.' : 'Press to select.'));
    });

    rowEls.forEach(function (r) {
      const n = r.ids.filter((i) => sel.has(i)).length;
      const full = n === r.ids.length;
      const some = n > 0;
      const ctx = !some && ((mode === 'orbital' && false) || (mode === 'subshell' && sel.size && Chem.getOrbital([...sel][0]).n === r.sub.n));
      const ctxOrb = mode === 'orbital' && some;
      r.row.classList.toggle('is-selected', mode === 'orbital' ? false : full);
      r.row.classList.toggle('is-context', ctx || ctxOrb);
      r.row.classList.toggle('is-dimmed', !some && !ctx);
      r.label.setAttribute('aria-pressed', String(mode !== 'orbital' && full && state.selection.level === 'subshell'));
      r.tag.setAttribute('aria-pressed', String(state.selection.level === 'shell' && full));
      r.tag.classList.toggle('is-selected', state.selection.level === 'shell' && full);
      r.label.classList.toggle('is-selected', state.selection.level === 'subshell' && full);
    });
    void anchorO;
  }

  /* ---------------- info panel ---------------- */
  function updateInfo() {
    const sel = state.selection;
    const d = (function () { try { return Chem.describeSelection(sel.level, sel.id) || {}; } catch (e) { return {}; } })();
    const title = $('selection-title');
    const rules = $('qn-rules');
    rules.textContent = '';

    const le = state.lastElectron;
    if (le) {
      const o = Chem.getOrbital(le.orbital);
      const spinV = le.spin === 'up' ? 0.5 : -0.5;
      const qn = (Chem.quantumNumbersFor && Chem.quantumNumbersFor(le.orbital, le.spin)) || { n: o.n, l: o.l, ml: o.ml, ms: spinV };
      title.textContent = 'Electron ' + (le.removed ? 'just removed from ' : 'just added to ') + cleanLabel(o) + ' (' + spinName(le.spin) + ')';
      $('qn-n').textContent = String(qn.n);
      $('qn-l').textContent = lText(qn.l);
      $('qn-ml').textContent = fmtMl(qn.ml);
      $('qn-ms').textContent = fmtMs(qn.ms) + ' (' + spinName(le.spin) + ')';
      rules.appendChild(el('li', null, 'Four numbers (n, l, mₗ, mₛ) = (' + qn.n + ', ' + qn.l + ', ' + fmtMl(qn.ml) + ', ' + fmtMs(qn.ms) + ') identify this one electron.'));
      rules.appendChild(el('li', null, 'Pauli exclusion principle: no two electrons in an atom share all four numbers, so an orbital holds at most two electrons, with opposite mₛ.'));
    } else {
      if (sel.level === 'orbital') {
        const o = Chem.getOrbital(sel.id);
        title.textContent = cleanLabel(o) + ' orbital';
      } else if (sel.level === 'subshell') {
        title.textContent = sel.id + ' subshell' + (state.focusOrbital ? ' (focus: ' + cleanLabel(Chem.getOrbital(state.focusOrbital)) + ')' : '');
      } else {
        title.textContent = 'Shell n = ' + sel.id;
      }
      $('qn-n').textContent = fmtList(d.n || []);
      $('qn-l').textContent = fmtList(d.l || [], lText);
      $('qn-ml').textContent = fmtList(d.ml || [], fmtMl);
      const ms = $('qn-ms');
      ms.textContent = '±½ ';
      ms.appendChild(el('span', 'ms-note', '(+½ or −½; click an electron slot to see one electron’s four numbers)'));
      (d.rules || []).forEach((r) => rules.appendChild(el('li', null, r)));
    }
  }

  /* ---------------- configuration panel ---------------- */
  function updateConfig() {
    const total = Chem.totalElectrons(state.occupancy);
    $('electron-count').textContent = total + ' / ' + Chem.MAX_ELECTRONS;
    let a = {};
    try { a = Chem.assess(state.occupancy) || {}; } catch (e) { a = {}; }
    const nt = $('config-notation');
    nt.textContent = total ? (a.notation || '') : '(empty)';
    if (total && a.shorthand && a.shorthand !== a.notation) {
      nt.appendChild(el('span', 'config-shorthand', '  ·  ' + a.shorthand));
    }

    const st = $('config-status');
    st.textContent = '';
    function line(kind, text) { const p = el('p', 'status-line ' + kind, text); st.appendChild(p); }
    if (state.message) line('is-error', state.message);
    if (!total) {
      line('is-ok', 'No electrons yet. Click a box half to add one, or load an element.');
    } else {
      const RULE = { aufbau: 'Aufbau', hund: 'Hund', pauli: 'Pauli' };
      const viol = a.violations || [];
      viol.slice(0, 3).forEach(function (v) {
        const nm = RULE[v.rule] || v.rule;
        line('is-warn', v.message.toLowerCase().indexOf(String(nm).toLowerCase()) === 0 ? v.message : nm + ': ' + v.message);
      });
      if (viol.length > 3) line('is-warn', '…and ' + (viol.length - 3) + ' more rule problem' + (viol.length - 3 > 1 ? 's' : '') + '.');
      if (!(a.violations && a.violations.length)) {
        if (a.matchesElement) {
          const e = Chem.ELEMENTS.find((x) => x.Z === a.matchesElement);
          line('is-ok', 'Ground-state configuration of ' + (e ? e.name + ' (' + e.symbol + ', Z = ' + e.Z + ')' : 'Z = ' + a.matchesElement) + '.');
        } else if (a.isGroundState === false) {
          line('is-warn', 'Allowed by the rules, but not the ground-state arrangement for ' + total + ' electrons (an excited state).');
        } else if (a.isGroundState) {
          line('is-ok', 'Follows the Aufbau, Hund and Pauli rules.');
        }
      }
      if (a.matchesElement) {
        const an = Chem.anomalyOf(a.matchesElement);
        if (an) {
          line('is-warn', 'Anomaly: the Aufbau order predicts ' + an.expected + ', but the real ground state is ' + an.actual + '. ' + (an.reason || ''));
        }
      }
    }
  }

  /* ---------------- 3-D viewer ---------------- */
  const mount = $('orbital-canvas');
  const legendEl = $('viewer-legend');
  let viewer = null;   // set if WebGL works

  const DEFAULT_VIEW = { azimuth: Math.PI / 4, polar: 1.1 };
  /* default zoom, relative to the fit for the largest shell, n = 5 (×1.00 = a 5-shell orbital fills the view) */
  const DEFAULT_ZOOM = 0.7;

  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(root).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }
  function themeColors() {
    const dark = isDark();
    const text = getComputedStyle(document.body).color || (dark ? '#e6e6e6' : '#222222');
    return {
      pos: new THREE.Color(cssVar('--orbital-pos', dark ? '#4da3ff' : '#1f6feb')),
      neg: new THREE.Color(cssVar('--orbital-neg', dark ? '#ff8a5c' : '#e5484d')),
      axis: new THREE.Color(cssVar('--axis-color', text))
    };
  }

  function initViewer() {
    if (typeof THREE === 'undefined') { fallback('The 3-D library (three.js) could not be loaded. Check your connection and reload.'); return; }
    if (mount.clientHeight < 100) mount.style.height = '360px';
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) { fallback('WebGL is not available in this browser, so the 3-D view cannot be shown. The diagram and quantum numbers still work.'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const canvas = renderer.domElement;
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline-offset:2px;';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Orbital 3-D view. Arrow keys rotate, plus and minus zoom.');
    mount.textContent = '';
    mount.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    camera.up.set(0, 0, 1);
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const l1 = new THREE.DirectionalLight(0xffffff, 0.6); l1.position.set(3, 4, 5); scene.add(l1);
    const l2 = new THREE.DirectionalLight(0xffffff, 0.35); l2.position.set(-4, -3, -2); scene.add(l2);

    const v = {
      renderer, scene, camera, canvas,
      group: new THREE.Group(), axes: new THREE.Group(),
      azimuth: DEFAULT_VIEW.azimuth, polar: DEFAULT_VIEW.polar,
      dist: 6, fitDist: 6, maxR: 1, dirty: true, meshCache: {},
      items: new Map(),   // orbital id -> { mesh, size, mode, to, leaving } for everything on stage
      fade: null, camTween: null, framed: false, axisKey: ''
    };
    scene.add(v.group); scene.add(v.axes);

    v.requestRender = function () {
      updateZoomReadout();
      if (v.dirty) return;
      v.dirty = true;
      requestAnimationFrame(v.draw);
    };
    v.draw = function () {
      v.dirty = false;
      const sp = Math.sin(v.polar);
      camera.position.set(v.dist * sp * Math.cos(v.azimuth), v.dist * sp * Math.sin(v.azimuth), v.dist * Math.cos(v.polar));
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      updateZoomReadout();
    };
    function resize() {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      v.dirty = false; v.requestRender();
    }
    v.resize = resize;
    if (window.ResizeObserver) new ResizeObserver(resize).observe(mount);
    window.addEventListener('resize', resize);

    /* small orbit control: drag rotate, wheel / pinch zoom, keys */
    const ptrs = new Map();
    let pinch0 = 0, dist0 = 0;
    function clampDist() { v.dist = Math.min(v.fitDist * 3, Math.max(v.maxR * 1.4, v.dist)); }
    /* the student takes over: stop any camera move that is still playing */
    function holdCamera() { if (v.camTween) { v.camTween.cancel(); v.camTween = null; } }
    canvas.addEventListener('pointerdown', function (e) {
      holdCamera();
      canvas.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) {
        const p = [...ptrs.values()];
        pinch0 = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); dist0 = v.dist;
      }
    });
    canvas.addEventListener('pointermove', function (e) {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      if (ptrs.size === 1) {
        v.azimuth -= (e.clientX - p.x) * 0.008;
        v.polar = Math.min(Math.PI - 0.05, Math.max(0.05, v.polar - (e.clientY - p.y) * 0.008));
        p.x = e.clientX; p.y = e.clientY;
      } else if (ptrs.size === 2) {
        p.x = e.clientX; p.y = e.clientY;
        const q = [...ptrs.values()];
        const d = Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y);
        if (pinch0 > 0) { v.dist = dist0 * pinch0 / Math.max(d, 1); clampDist(); }
      }
      v.requestRender();
    });
    function up(e) { ptrs.delete(e.pointerId); pinch0 = 0; }
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      holdCamera();
      v.dist *= Math.exp(e.deltaY * 0.0012); clampDist(); v.requestRender();
    }, { passive: false });
    canvas.addEventListener('keydown', function (e) {
      const k = e.key; let used = true;
      if (k === 'ArrowLeft') v.azimuth += 0.12;
      else if (k === 'ArrowRight') v.azimuth -= 0.12;
      else if (k === 'ArrowUp') v.polar = Math.max(0.05, v.polar - 0.1);
      else if (k === 'ArrowDown') v.polar = Math.min(Math.PI - 0.05, v.polar + 0.1);
      else if (k === '+' || k === '=') { v.dist *= 0.9; clampDist(); }
      else if (k === '-' || k === '_') { v.dist *= 1.1; clampDist(); }
      else used = false;
      if (used) { e.preventDefault(); holdCamera(); v.requestRender(); }
    });

    viewer = v;
    resize();
  }

  function fallback(msg) {
    mount.textContent = '';
    mount.appendChild(el('p', 'viewer-fallback', msg));
  }

  function disposeObject(obj) {
    obj.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) { if (m.map) m.map.dispose(); m.dispose(); });
      }
    });
  }
  function clearGroup(g) {
    while (g.children.length) { const c = g.children[0]; g.remove(c); disposeObject(c); }
  }

  function labelSprite(text, color, size) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;   // drawn large so the letter stays crisp on a hi-DPI screen
    const ctx = c.getContext('2d');
    ctx.font = '600 88px ' + cssVar('--font-display', 'sans-serif');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#' + color.getHexString();
    ctx.fillText(text, 64, 68);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(size, size, 1);
    return sp;
  }

  function buildAxes(L, color) {
    clearGroup(viewer.axes);
    const dirs = [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]];
    dirs.forEach(function (d) {
      const dir = new THREE.Vector3(d[1][0], d[1][1], d[1][2]);
      const geo = new THREE.BufferGeometry().setFromPoints([dir.clone().multiplyScalar(-L * 0.6), dir.clone().multiplyScalar(L)]);
      viewer.axes.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.7 })));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(L * 0.03, L * 0.1, 12), new THREE.MeshBasicMaterial({ color: color }));
      cone.position.copy(dir.clone().multiplyScalar(L));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      viewer.axes.add(cone);
      const sp = labelSprite(d[0], color, L * 0.2);
      sp.position.copy(dir.clone().multiplyScalar(L * 1.14));
      viewer.axes.add(sp);
    });
    addAxisTicks(L, color);
  }

  /* axis scale: one unlabelled tick per unit, 1 unit = size of the n=1 orbital (radiusScale(1)) */
  function addAxisTicks(L, color) {
    const unit = Shapes.radiusScale(1);
    const t = L * 0.025;
    const perp = { x: [0, 1, 0], y: [1, 0, 0], z: [1, 0, 0] };
    const dirs = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    Object.keys(dirs).forEach(function (k) {
      const d = new THREE.Vector3().fromArray(dirs[k]);
      const p = new THREE.Vector3().fromArray(perp[k]);
      for (let i = 1; i * unit <= L; i++) {
        const c = d.clone().multiplyScalar(i * unit);
        const geo = new THREE.BufferGeometry().setFromPoints([c.clone().addScaledVector(p, -t * 1.6), c.clone().addScaledVector(p, t * 1.6)]);
        viewer.axes.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: color })));
      }
    });
  }

  function updateZoomReadout() {
    const z = viewer.fitDist / viewer.dist;
    const txt = '×' + z.toFixed(2);
    const zEl = $('zoom-readout'), nEl = $('zoom-note');
    if (zEl.textContent !== txt) zEl.textContent = txt;
    const note = Math.abs(z - DEFAULT_ZOOM) < 0.005 ? 'default' : (z > DEFAULT_ZOOM ? 'zoomed in' : 'zoomed out');
    if (nEl.textContent !== note) nEl.textContent = note;
  }

  function updateSizeReadout(plan) {
    const seen = {}, parts = [];
    plan.forEach(function (p) {
      const o = Chem.getOrbital(p.id);
      if (seen[o.n]) return;
      seen[o.n] = true;
      const shown = Shapes.radiusScale(o.n) / Shapes.radiusScale(1);
      const real = o.n * o.n;
      parts.push('n=' + o.n + ': ×' + shown.toFixed(2) + ' (true ≈ ×' + real + ')');
    });
    $('size-readout').textContent = parts.join(' · ');
  }

  function meshData(oid) {
    const c = viewer.meshCache;
    if (!c[oid]) c[oid] = Shapes.buildMesh(oid, { resolution: 56 });
    return c[oid];
  }

  /* How each selected orbital is drawn:
       solid - a lone orbital, or the orbital picked inside a subshell view;
       ghost - the siblings of a picked orbital (faint);
       clear - several orbitals with nothing picked (shell, or a whole subshell): translucent,
               so the orbitals nested inside one another can all be seen.
     p.hidden marks orbitals the student switched off in the legend. */
  function drawPlan() {
    const ids = selectedOrbitalIds();
    const key = state.selection.level + ':' + state.selection.id;
    if (state.hiddenKey !== key) { state.hidden.clear(); state.hiddenKey = key; }
    const picked = state.selection.level === 'subshell' && state.focusOrbital && ids.indexOf(state.focusOrbital) >= 0;
    return ids.map((id) => ({
      id: id,
      mode: ids.length === 1 ? 'solid' : picked ? (id === state.focusOrbital ? 'solid' : 'ghost') : 'clear',
      hidden: state.hidden.has(id)
    }));
  }

  const MODE_OPACITY = { solid: 1, clear: 0.32, ghost: 0.16 };

  function buildOrbitalMesh(id, colors) {
    const data = meshData(id);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    const col = new Float32Array(data.signs.length * 3);
    for (let i = 0; i < data.signs.length; i++) {
      const c = data.signs[i] < 0 ? colors.neg : colors.pos;
      col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false });
    return new THREE.Mesh(geo, mat);
  }

  /* Keeps what is already on stage and changes only what differs: new orbitals
     grow in, dropped ones fade out, and one that changes role (solid / clear /
     ghost) eases to its new opacity. The camera is left where the student put it. */
  function updateViewer() {
    const allPlan = drawPlan();
    updateLegend(allPlan);
    if (!viewer) return;
    const v = viewer;
    const plan = allPlan.filter((p) => !p.hidden);
    const colors = themeColors();
    const wanted = new Set();
    let maxR = 0.5;
    plan.forEach(function (p) {
      const o = Chem.getOrbital(p.id);
      const s = Shapes.radiusScale(o.n);
      if (s > maxR) maxR = s;
      wanted.add(p.id);
      let it = v.items.get(p.id);
      if (!it) {
        it = { mesh: buildOrbitalMesh(p.id, colors), size: s };
        it.mesh.scale.setScalar(s * 0.86);
        v.items.set(p.id, it);
        v.group.add(it.mesh);
      }
      it.mode = p.mode; it.to = MODE_OPACITY[p.mode]; it.leaving = false;
      /* translucent surfaces draw after solid ones; larger n first so nested smaller orbitals stay on top */
      it.mesh.renderOrder = p.mode === 'solid' ? 0 : 1 + (10 - o.n);
    });
    v.items.forEach(function (it, id) { if (!wanted.has(id)) { it.to = 0; it.leaving = true; } });
    v.maxR = maxR;
    /* camera and axes are fixed to the largest shell in scope (n = 5), not to what is drawn,
       so a smaller n really looks smaller at the default zoom */
    const refR = Shapes.radiusScale(Math.max.apply(null, Chem.SHELLS));
    v.fitDist = refR * 3.6;
    if (!v.framed) { v.dist = v.fitDist / DEFAULT_ZOOM; v.framed = true; }
    const axisKey = colors.axis.getHexString();
    if (v.axisKey !== axisKey) { buildAxes(refR * 1.25, colors.axis); v.axisKey = axisKey; }
    updateSizeReadout(plan);
    playFade();
  }

  function playFade() {
    const v = viewer;
    if (v.fade) { v.fade.cancel(); v.fade = null; }
    let changing = false;
    v.items.forEach(function (it) {
      const m = it.mesh.material;
      it.from = m.opacity; it.fromSize = it.mesh.scale.x;
      if (it.fromSize !== it.size) changing = true;
      /* a surface has to blend while its opacity is changing */
      if (it.from !== it.to) { changing = true; m.transparent = true; m.depthWrite = false; m.needsUpdate = true; }
    });
    /* nothing on stage differs (an electron was toggled, say): one repaint is enough */
    if (!changing) { v.dirty = false; v.requestRender(); return; }
    v.fade = Motion.tween({
      easing: 'ui',
      update: function (p) {
        v.items.forEach(function (it) {
          it.mesh.material.opacity = it.from + (it.to - it.from) * p;
          it.mesh.scale.setScalar(it.fromSize + (it.size - it.fromSize) * p);
        });
        v.requestRender();
      },
      done: function () {
        v.items.forEach(function (it, id) {
          if (it.leaving) { v.group.remove(it.mesh); disposeObject(it.mesh); v.items.delete(id); return; }
          const m = it.mesh.material, solid = it.mode === 'solid';
          m.opacity = it.to; m.transparent = !solid; m.depthWrite = solid; m.needsUpdate = true;
        });
        v.fade = null;
        v.dirty = false; v.requestRender();
      }
    });
  }

  /* the lobe colours are baked into each mesh, so a theme change rebuilds them in place */
  function recolourViewer() {
    if (!viewer) return;
    if (viewer.fade) { viewer.fade.cancel(); viewer.fade = null; }
    clearGroup(viewer.group);
    viewer.items.clear();
    updateViewer();
  }

  function updateLegend(plan) {
    const hadFocus = legendEl.contains(document.activeElement) && document.activeElement.getAttribute('data-orbital');
    legendEl.textContent = '';
    const shown = plan.filter((p) => !p.hidden).length;
    const head = el('p', 'legend-title', plan.length > 1
      ? 'Drawn orbitals (' + shown + ' of ' + plan.length + ') — click one to hide or show it'
      : 'Drawn orbital');
    legendEl.appendChild(head);
    plan.forEach(function (p) {
      const o = Chem.getOrbital(p.id);
      const kind = p.mode === 'solid' ? 'is-solid' : p.mode === 'ghost' ? 'is-ghost' : 'is-clear';
      const item = el('button', 'legend-item ' + kind + (p.hidden ? ' is-hidden' : ''));
      item.type = 'button';
      item.setAttribute('data-orbital', p.id);
      item.setAttribute('aria-pressed', p.hidden ? 'false' : 'true');
      item.setAttribute('aria-label', cleanLabel(o) + ': ' + (p.hidden ? 'hidden, press to show' : 'shown, press to hide'));
      item.addEventListener('click', function () {
        if (state.hidden.has(p.id)) state.hidden.delete(p.id); else state.hidden.add(p.id);
        updateViewer();
      });
      const chips = el('span', 'legend-chips');
      const a = el('span', 'legend-chip is-pos'); a.style.background = 'var(--orbital-pos)';
      const b = el('span', 'legend-chip is-neg'); b.style.background = 'var(--orbital-neg)';
      a.setAttribute('aria-hidden', 'true'); b.setAttribute('aria-hidden', 'true');
      chips.appendChild(a); chips.appendChild(b);
      item.appendChild(chips);
      item.appendChild(el('span', 'legend-name', cleanLabel(o)));
      item.appendChild(el('span', 'legend-state', p.hidden ? 'hidden' : p.mode === 'solid' ? 'solid' : p.mode === 'ghost' ? 'transparent' : 'translucent'));
      legendEl.appendChild(item);
    });
    if (hadFocus) {
      const again = legendEl.querySelector('[data-orbital="' + hadFocus + '"]');
      if (again) again.focus();
    }
    if (plan.length && plan.every((p) => p.hidden)) {
      legendEl.appendChild(el('p', 'legend-empty', 'Every orbital is hidden. Click one above to show it again.'));
    }
    const key = el('p', 'legend-sign');
    const kp = el('span', 'legend-chip is-pos'); kp.style.background = 'var(--orbital-pos)';
    const kn = el('span', 'legend-chip is-neg'); kn.style.background = 'var(--orbital-neg)';
    key.appendChild(kp); key.appendChild(document.createTextNode(' + lobe (positive wavefunction)   '));
    key.appendChild(kn); key.appendChild(document.createTextNode(' − lobe (negative)'));
    legendEl.appendChild(key);
  }

  /* ---------------- slicers & hint ---------------- */
  const HINTS = {
    orbital: 'Click a box to see one orbital; a subshell label or n tag switches level.',
    subshell: 'Click a box or a subshell label: the whole subshell is drawn translucent; a box you pick stays solid while its siblings turn transparent.',
    shell: 'Click any box or an n tag: every orbital in that shell is drawn translucent so you can see inside. Click an orbital under the 3-D view to hide or show it.'
  };

  function renderAll() {
    const radios = document.querySelectorAll('input[name="slice-mode"]');
    radios.forEach((r) => { r.checked = r.value === state.sliceMode; });
    $('slice-hint').textContent = HINTS[state.sliceMode] + (state.clickMode === 'fill'
      ? ' Fill mode: clicking a box half adds or removes an electron and does not change the selection.'
      : ' Explore mode: clicking a box never changes electrons.');
    document.querySelectorAll('input[name="click-mode"]').forEach((r) => { r.checked = r.value === state.clickMode; });
    updateDiagram();
    updateInfo();
    updateConfig();
    updateViewer();
  }

  // Lighter refresh when only the electrons changed
  function renderElectrons() {
    updateDiagram();
    updateInfo();
    updateConfig();
  }

  /* ---------------- events ---------------- */
  diagramEl.addEventListener('click', function (e) {
    const box = e.target.closest('.orbital-box');
    const label = e.target.closest('.subshell-label');
    const tag = e.target.closest('.shell-tag');
    if (label) {
      selectSubshell(label.closest('.subshell-row').dataset.subshell);
      renderAll(); return;
    }
    if (tag) {
      selectShell(Number(tag.dataset.shell));
      renderAll(); return;
    }
    if (!box) return;
    const oid = box.dataset.orbital;

    const eSpan = e.target.closest('.electron');
    const occ = state.occupancy[oid] || { up: false, down: false };
    const fill = state.clickMode === 'fill';

    if (!fill && !eSpan) {
      // explore: select only, never touch electrons
      const before = state.selection.level + ':' + state.selection.id + ':' + state.focusOrbital + ':' + state.anchor;
      selectBox(oid);
      state.lastElectron = null;
      state.message = '';
      renderAll();
      void before;
      return;
    }

    // which spin? clicked electron, else the clicked half; keyboard: first free slot
    let spin;
    if (eSpan) spin = eSpan.dataset.spin;
    else if (e.detail === 0 && !e.clientX && !e.clientY) spin = !occ.up ? 'up' : 'down';
    else {
      const r = box.getBoundingClientRect();
      spin = (e.clientX - r.left) < r.width / 2 ? 'up' : 'down';
    }

    state.message = '';
    const wasOn = !!occ[spin];
    let res;
    try { res = Chem.toggleElectron(state.occupancy, oid, spin); } catch (err) { res = { occ: state.occupancy, error: String(err.message || err) }; }
    if (res.error) {
      state.message = res.error;
      state.lastElectron = null;
    } else {
      state.occupancy = res.occ;
      state.lastElectron = { orbital: oid, spin: spin, removed: wasOn };
      state.loadedZ = null;
    }
    renderElectrons();
  });

  document.querySelectorAll('input[name="click-mode"]').forEach(function (r) {
    r.addEventListener('change', function () {
      if (!r.checked) return;
      state.clickMode = r.value;
      state.lastElectron = null;
      renderAll();
    });
  });

  document.querySelectorAll('input[name="slice-mode"]').forEach(function (r) {
    r.addEventListener('change', function () {
      if (!r.checked) return;
      applyMode(r.value);
      renderAll();
    });
  });

  $('btn-reset-view').addEventListener('click', function () {
    if (!viewer) return;
    const v = viewer, a0 = v.azimuth, p0 = v.polar, d0 = v.dist, d1 = v.fitDist / DEFAULT_ZOOM;
    /* swing back the short way round */
    let da = (DEFAULT_VIEW.azimuth - a0) % (2 * Math.PI);
    if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
    if (v.camTween) v.camTween.cancel();
    v.camTween = Motion.tween({
      update: function (p) {
        v.azimuth = a0 + da * p;
        v.polar = p0 + (DEFAULT_VIEW.polar - p0) * p;
        v.dist = d0 + (d1 - d0) * p;
        v.requestRender();
      },
      done: function () { v.azimuth = DEFAULT_VIEW.azimuth; v.camTween = null; }
    });
  });

  const elementSelect = $('element-select');
  Chem.ELEMENTS.forEach(function (e) {
    const opt = document.createElement('option');
    opt.value = e.Z; opt.textContent = e.Z + ' – ' + e.symbol + ' (' + e.name + ')';
    elementSelect.appendChild(opt);
  });
  elementSelect.value = '6';

  $('btn-load-element').addEventListener('click', function () {
    const Z = Number(elementSelect.value);
    const cfg = Chem.configOf(Z);
    const occ = Chem.emptyOccupancy();
    Object.keys(cfg || {}).forEach(function (k) { if (occ[k]) occ[k] = { up: !!cfg[k].up, down: !!cfg[k].down }; });
    state.occupancy = occ;
    state.loadedZ = Z;
    state.lastElectron = null;
    state.message = '';
    renderElectrons();
  });

  $('btn-clear').addEventListener('click', function () {
    state.occupancy = Chem.emptyOccupancy();
    state.loadedZ = null; state.lastElectron = null; state.message = '';
    renderElectrons();
  });

  // theme changes recolour the 3-D lobes
  new MutationObserver(function () {
    state.theme = root.getAttribute('data-theme') || 'light';
    recolourViewer();
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  /* ...and so does the OS flipping between light and dark while no explicit choice is stored */
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolourViewer); } catch (e) { /* older browser */ }

  /* ---------------- boot ---------------- */
  buildDiagram();
  $('axis-key').textContent = 'Axes: x, y, z (z is up)';
  initViewer();
  renderAll();
})();
