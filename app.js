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

  /* ---------------- theme toggle ---------------- */
  const root = document.documentElement;
  (function () {
    const btn = document.getElementById('theme-toggle');
    const icon = document.getElementById('theme-toggle-icon');
    if (!btn) return;
    function reflect() {
      const dark = root.getAttribute('data-theme') === 'dark';
      btn.setAttribute('aria-pressed', String(dark));
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      if (icon) icon.textContent = dark ? '☀️' : '🌙';
    }
    btn.addEventListener('click', function () {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
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
    loadedZ: null
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

  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(root).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }
  function themeColors() {
    const dark = root.getAttribute('data-theme') === 'dark';
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
      dist: 6, fitDist: 6, maxR: 1, dirty: true, meshCache: {}
    };
    scene.add(v.group); scene.add(v.axes);

    v.requestRender = function () {
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
    canvas.addEventListener('pointerdown', function (e) {
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
      if (used) { e.preventDefault(); v.requestRender(); }
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
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#' + color.getHexString();
    ctx.fillText(text, 32, 34);
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
  }

  function meshData(oid) {
    const c = viewer.meshCache;
    if (!c[oid]) c[oid] = Shapes.buildMesh(oid, { resolution: 56 });
    return c[oid];
  }

  /* which orbitals are drawn, solid or ghost, per the contract */
  function drawPlan() {
    const ids = selectedOrbitalIds();
    const plan = ids.map((id) => ({ id: id, solid: true }));
    if (state.selection.level === 'subshell' && state.focusOrbital && ids.indexOf(state.focusOrbital) >= 0) {
      plan.forEach((p) => { p.solid = p.id === state.focusOrbital; });
    }
    return plan;
  }

  function updateViewer() {
    const plan = drawPlan();
    updateLegend(plan);
    if (!viewer) return;
    const colors = themeColors();
    clearGroup(viewer.group);
    let maxR = 0.5;
    plan.forEach(function (p) {
      const o = Chem.getOrbital(p.id);
      const data = meshData(p.id);
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
      const mat = new THREE.MeshLambertMaterial({
        vertexColors: true, side: THREE.DoubleSide,
        transparent: !p.solid, opacity: p.solid ? 1 : 0.16, depthWrite: p.solid
      });
      const mesh = new THREE.Mesh(geo, mat);
      const s = Shapes.radiusScale(o.n);
      mesh.scale.set(s, s, s);
      mesh.renderOrder = p.solid ? 0 : 1;
      viewer.group.add(mesh);
      if (s > maxR) maxR = s;
    });
    viewer.maxR = maxR;
    viewer.fitDist = maxR * 3.6;
    viewer.dist = viewer.fitDist;
    buildAxes(maxR * 1.25, colors.axis);
    viewer.dirty = false; viewer.requestRender();
  }

  function updateLegend(plan) {
    legendEl.textContent = '';
    const head = el('p', 'legend-title', plan.length > 1 ? 'Drawn orbitals (' + plan.length + ')' : 'Drawn orbital');
    legendEl.appendChild(head);
    plan.forEach(function (p) {
      const o = Chem.getOrbital(p.id);
      const item = el('div', 'legend-item ' + (p.solid ? 'is-solid' : 'is-ghost'));
      const chips = el('span', 'legend-chips');
      const a = el('span', 'legend-chip is-pos'); a.style.background = 'var(--orbital-pos)';
      const b = el('span', 'legend-chip is-neg'); b.style.background = 'var(--orbital-neg)';
      a.setAttribute('aria-hidden', 'true'); b.setAttribute('aria-hidden', 'true');
      chips.appendChild(a); chips.appendChild(b);
      item.appendChild(chips);
      item.appendChild(el('span', 'legend-name', cleanLabel(o)));
      item.appendChild(el('span', 'legend-state', p.solid ? 'solid' : 'transparent'));
      legendEl.appendChild(item);
    });
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
    subshell: 'Click a box or a subshell label: the whole subshell is drawn, and the box you pick stays solid while its siblings turn transparent.',
    shell: 'Click any box or an n tag: every orbital in that shell is drawn.'
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
    viewer.azimuth = DEFAULT_VIEW.azimuth; viewer.polar = DEFAULT_VIEW.polar;
    viewer.dist = viewer.fitDist;
    viewer.requestRender();
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
    if (viewer) {
      const keep = { a: viewer.azimuth, p: viewer.polar, d: viewer.dist };
      updateViewer();
      viewer.azimuth = keep.a; viewer.polar = keep.p; viewer.dist = keep.d;
      viewer.requestRender();
    }
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  /* ---------------- boot ---------------- */
  buildDiagram();
  $('axis-key').textContent = 'Axes: x, y, z (z is up)';
  initViewer();
  renderAll();
})();
