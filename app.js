'use strict';
/* Chemulate Orbitals: UI logic + Three.js viewer.

   Hints for styles.css (owned by the Style agent):
   - CSS custom properties read at runtime by the 3-D viewer (define per theme):
       --orbital-pos  colour of + lobes     --orbital-neg  colour of - lobes
       --axis-color   (optional) axis lines/labels; falls back to the text colour
   - span.electron[data-spin="up"] is the LEFT half of a box, [data-spin="down"] the RIGHT half.
   - Extra classes added by app.js: #config-status .status-line.is-ok|is-warn (is-warn = the ground-state
     anomaly note), .config-shorthand, .legend-chip.is-pos|is-neg (background uses the CSS vars inline),
     .legend-sign, .legend-name, .legend-state, .viewer-fallback, .title-focus (in #selection-title),
     .orbital-name (small label with real <sub> inside every .orbital-box, aria-hidden).
   - Tooltips (see tip()): .tip-wrap > button.info-tip + span.tip-pop[hidden] (text in <p> blocks). The pop has no
     class by default = below the button, centred; JS adds .is-above (flip up), .is-left (right edges align, grows
     leftwards) or .is-right (left edges align, grows rightwards) to keep it on screen, and .tip-wrap.is-open
     while shown. As a last resort it also sets an inline `translate` on the pop.
   - data-shell="N" on #selection-title and the n value in #qn-panel, data-n="N" on .legend-item (shell colour hooks).
   - #orbital-canvas needs a height (min ~320px); app.js sets 360px inline only if it is < 100px.
   - Screens and modes: body[data-screen="start|table|app"] and body[data-mode="explore|atom"]; exactly one
     section.screen (#screen-start | #screen-table | #screen-app) is visible, the others carry [hidden]. During a
     change the old one has .is-leaving and the new one .is-entering (the fade itself runs through motion.js).
     #mode-switch is [hidden] outside the app view, #element-chip is [hidden] unless Real-atom mode shows an
     element (data-z), #config-panel is [hidden] in Explore mode. Summary parts: .element-title (.element-name,
     .element-symbol), .electron-count, .config-line.config-full|.config-short (.config-key + .config-val),
     .status-line.is-ok|is-warn, details#element-more.element-more (> summary, p.anomaly-reason, p.valence-note;
     [hidden] when it has nothing to say).
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
      if (icon) icon.innerHTML = Icons.svg(dark ? 'sun' : 'moon');
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

  /* ---------------- labels: real subscripts ---------------- */
  /* orbitalHTML(id) is safe, static markup built from chemistry.js data (never from user input):
       2s, 2p<sub>x</sub>, 3d<sub>z²</sub>, 3d<sub>x²−y²</sub>, 3d<sub>xy</sub> …
     Assign it with innerHTML on elements created here. short = true drops the n (p<sub>x</sub>).
     orbitalText(id) is the plain twin ('3dx²−y²') for aria-labels and title attributes. */
  function orbitalHTML(id, short) { return Chem.orbitalHTML(id, { short: !!short }); }
  function orbitalText(id, short) { return Chem.orbitalPlain(id, { short: !!short }); }
  function elHTML(tag, cls, markup) { const e = el(tag, cls); e.innerHTML = markup; return e; }

  /* the page may still spell the quantum-number names with Unicode subscripts (mₗ, mₛ): swap in real <sub> */
  function realSubscripts(rootEl) {
    if (!rootEl) return;
    const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    const todo = [];
    while (w.nextNode()) if (/m[ₗₛ]/.test(w.currentNode.nodeValue)) todo.push(w.currentNode);
    todo.forEach(function (t) {
      const frag = document.createDocumentFragment();
      t.nodeValue.split(/(m[ₗₛ])/).forEach(function (part) {
        if (/^m[ₗₛ]$/.test(part)) {
          frag.appendChild(document.createTextNode('m'));
          frag.appendChild(el('sub', null, part.charAt(1) === 'ₗ' ? 'l' : 's'));
        } else if (part) frag.appendChild(document.createTextNode(part));
      });
      t.parentNode.replaceChild(frag, t);
    });
  }

  /* ---------------- tooltips ---------------- */
  /* tip(label, html [, idHint]) -> <span class="tip-wrap"> button.info-tip + span.tip-pop[role=tooltip][hidden] </span>
     Hover (mouse), keyboard focus and click / tap open it; Esc, a click elsewhere or a second click close it;
     only one is open at a time; it flips / slides to stay inside the viewport. `html` must be static markup
     (Chem.subHTML output or literals): it is assigned with innerHTML. Nothing is visible until asked for. */
  const tipUsed = {};
  let tipOpen = null;               // the .tip-wrap that is currently shown
  let tipRaf = 0;

  function tipParts(wrap) { return { btn: wrap.querySelector('.info-tip'), pop: wrap.querySelector('.tip-pop') }; }

  function tip(label, content, idHint) {
    const slug = String(idHint || label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tip';
    let id = 'tip-' + slug, k = 1;
    while (tipUsed[id] || document.getElementById(id)) id = 'tip-' + slug + '-' + (++k);
    tipUsed[id] = true;

    const wrap = el('span', 'tip-wrap');
    const btn = el('button', 'info-tip', 'i');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'About ' + label);
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-describedby', id);
    const pop = el('span', 'tip-pop');
    pop.id = id;
    pop.setAttribute('role', 'tooltip');
    pop.hidden = true;
    pop.innerHTML = content || '';
    wrap.appendChild(btn);
    wrap.appendChild(pop);

    let leaveTimer = 0;
    wrap._pinned = false;   // opened by a click: stays until clicked again, Esc or an outside click
    wrap.addEventListener('pointerenter', function (e) {
      if (e.pointerType !== 'mouse') return;      // touch has no hover: a tap arrives as a click
      clearTimeout(leaveTimer);
      showTip(wrap);
    });
    wrap.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(function () {
        if (!wrap._pinned && !wrap.matches(':focus-within')) hideTip(wrap);
      }, 140);
    });
    wrap.addEventListener('focusin', function () { showTip(wrap); });
    wrap.addEventListener('focusout', function () {
      setTimeout(function () {
        if (!wrap._pinned && !wrap.matches(':focus-within') && !wrap.matches(':hover')) hideTip(wrap);
      }, 0);
    });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (wrap._pinned) hideTip(wrap);
      else { wrap._pinned = true; showTip(wrap); }
    });
    return wrap;
  }

  function setTipContent(wrap, content) {
    if (!wrap) return;
    const pop = tipParts(wrap).pop;
    if (pop.innerHTML !== content) pop.innerHTML = content;
    if (tipOpen === wrap) placeTip(wrap);
  }

  function showTip(wrap) {
    if (tipOpen === wrap) return;
    if (tipOpen) hideTip(tipOpen);
    const p = tipParts(wrap);
    p.pop.hidden = false;
    p.btn.setAttribute('aria-expanded', 'true');
    wrap.classList.add('is-open');
    tipOpen = wrap;
    placeTip(wrap);
  }

  function hideTip(wrap) {
    if (!wrap) return;
    const p = tipParts(wrap);
    p.pop.hidden = true;
    p.btn.setAttribute('aria-expanded', 'false');
    wrap.classList.remove('is-open');
    wrap._pinned = false;
    if (tipOpen === wrap) tipOpen = null;
  }

  /* default = below the button, centred. Flip up when there is more room above; grow leftwards / rightwards
     when it would cross a side edge; as a last resort nudge it with an inline `translate`. */
  function placeTip(wrap) {
    const p = tipParts(wrap), pop = p.pop, M = 8;
    pop.classList.remove('is-above', 'is-left', 'is-right');
    pop.style.translate = '';
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const b = p.btn.getBoundingClientRect();
    let r = pop.getBoundingClientRect();
    if (r.bottom > vh - M && b.top > vh - b.bottom) { pop.classList.add('is-above'); r = pop.getBoundingClientRect(); }
    if (r.left < M) { pop.classList.add('is-right'); r = pop.getBoundingClientRect(); }
    else if (r.right > vw - M) { pop.classList.add('is-left'); r = pop.getBoundingClientRect(); }
    let dx = 0;
    if (r.left < M) dx = M - r.left;
    else if (r.right > vw - M) dx = (vw - M) - r.right;
    if (dx) pop.style.translate = Math.round(dx) + 'px 0';
    /* where the button's centre sits along the pop, so a CSS arrow can point at it after a nudge */
    pop.style.setProperty('--tip-arrow-x', Math.round(b.left + b.width / 2 - (r.left + dx)) + 'px');
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && tipOpen) hideTip(tipOpen);   // focus stays on the button
  });
  document.addEventListener('pointerdown', function (e) {
    if (tipOpen && !tipOpen.contains(e.target)) hideTip(tipOpen);
  });
  function repositionTip() {
    if (!tipOpen || tipRaf) return;
    tipRaf = requestAnimationFrame(function () { tipRaf = 0; if (tipOpen) placeTip(tipOpen); });
  }
  window.addEventListener('resize', repositionTip);
  window.addEventListener('scroll', repositionTip, { passive: true });

  function tipBody(lines) {
    return (lines || []).map(function (s) { return '<p>' + Chem.subHTML(s) + '</p>'; }).join('');
  }

  const SUBSHELLS_LOW_FIRST = Chem.SUBSHELLS.slice().sort((a, b) => a.rank - b.rank);

  /* ---------------- state ---------------- */
  const state = {
    sliceMode: 'orbital',
    selection: { level: 'orbital', id: '2px' },
    focusOrbital: null,       // orbital picked inside a subshell view
    occupancy: Chem.emptyOccupancy(),   // read-only on screen: filled only by choosing an element (Real atom mode)
    theme: root.getAttribute('data-theme') || 'light',
    anchor: '2px',            // the single orbital that anchors re-resolution when mode changes
    mode: 'explore',          // 'explore' (orbitals only) | 'atom' (an element's electrons are drawn)
    loadedZ: null,            // element whose electrons are drawn (null = none, always so in Explore mode)
    lastZ: null,              // the last element chosen: Explore -> Real atom brings it back without the table
    started: false,           // true once the app view has been shown (the table's Back needs to know)
    electron: null,           // { orbital, spin }: the electron picked in the diagram (Real atom mode only)
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
  }

  function selectShell(n) {
    const a = Chem.getOrbital(state.anchor);
    if (!a || a.n !== n) state.anchor = firstOrbitalOfShell(n);
    state.sliceMode = 'shell';
    state.selection = { level: 'shell', id: n };
    state.focusOrbital = null;
  }

  /* ---------------- energy diagram ---------------- */
  const diagramEl = $('energy-diagram');
  const boxEls = {};   // orbitalId -> button
  const rowEls = [];   // {sub, row, label, tag, boxes:[ids]}

  function buildDiagram() {
    diagramEl.textContent = '';
    const axis = el('div', 'energy-axis');
    axis.appendChild(el('span', 'energy-arrow', 'Energy ↑'));
    /* the honest "schematic only" note lives in one tooltip instead of a paragraph */
    axis.appendChild(tip('the energy axis', '<p>' + Chem.subHTML(Chem.ENERGY_NOTE || '') + '</p>', 'energy'));
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
        const nm = elHTML('span', 'orbital-name', orbitalHTML(oid, true));   // p<sub>x</sub>, d<sub>xy</sub> …
        nm.setAttribute('aria-hidden', 'true');
        b.appendChild(nm);
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
    const pk = pickedElectron();

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
        e.classList.toggle('is-picked', !!pk && pk.orbital === oid && pk.spin === spin);
        e.setAttribute('aria-hidden', 'true');
        b.insertBefore(e, tagEl);
      });
      b.setAttribute('aria-label',
        orbitalText(oid) + ' orbital, n=' + o.n + ', l=' + o.l + ', ml=' + fmtMl(o.ml) + '. ' +
        'Spin up ' + (occ.up ? 'occupied' : 'empty') + ', spin down ' + (occ.down ? 'occupied' : 'empty') + '. Press to select.');
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
  /* The four quantum-number rows show the VALUES for the current selection. The reasons behind them
     (Chem.describeSelection(...).explain) live in one tooltip per row, created once next to the row's name. */
  const QN_KEYS = ['n', 'l', 'ml', 'ms'];
  const QN_TIP_LABEL = { n: 'n', l: 'l', ml: 'mₗ', ms: 'mₛ' };
  const qnTips = {};

  const QN_SYM = { n: 'n', l: 'l', ml: 'm<sub>l</sub>', ms: 'm<sub>s</sub>' };
  const QN_NAME = { n: 'shell', l: 'subshell', ml: 'orbital', ms: 'spin' };

  /* #qn-panel is an invisible table with one row per value: [symbol + name] [value] [label] [tooltip].
     rows = [{ val, label (static markup), shell }]. The symbol and tooltip sit on the first row of each group. */
  function qnGroup(panel, key, rows) {
    rows.forEach(function (r, i) {
      const row = el('div', 'qn-row' + (i === 0 ? ' qn-first' : ''));
      row.setAttribute('role', 'row');
      const sym = elHTML('span', 'qn-key', i === 0 ? '<span class="qn-sym">' + QN_SYM[key] + '</span><span class="qn-name">' + QN_NAME[key] + '</span>' : '');
      sym.setAttribute('role', 'rowheader');
      const val = el('span', 'qn-val', r.val);
      val.setAttribute('role', 'cell');
      if (key === 'n' && r.shell != null) val.setAttribute('data-shell', String(r.shell));
      const lab = elHTML('span', 'qn-label', r.label || '');
      lab.setAttribute('role', 'cell');
      const end = el('span', 'qn-end');
      end.setAttribute('role', 'cell');
      if (i === 0 && qnTips[key]) end.appendChild(qnTips[key]);
      [sym, val, lab, end].forEach(function (c) { row.appendChild(c); });
      panel.appendChild(row);
    });
  }

  function mountQnTips() {
    QN_KEYS.forEach(function (k) {
      if (!qnTips[k]) qnTips[k] = tip(QN_TIP_LABEL[k], '', k);          // ids tip-n, tip-l, tip-ml, tip-ms
    });
  }

  function setShellAttr(node, n) {
    if (!node) return;
    if (n == null) node.removeAttribute('data-shell'); else node.setAttribute('data-shell', String(n));
  }

  /* the picked electron, or null once it is gone (another element, Explore mode) */
  function pickedElectron() {
    const p = state.electron;
    if (!p || state.mode !== 'atom') return null;
    const occ = state.occupancy[p.orbital];
    return occ && occ[p.spin] ? p : null;
  }

  function updateInfo() {
    const sel = state.selection;
    const d = (function () { try { return Chem.describeSelection(sel.level, sel.id) || {}; } catch (e) { return {}; } })();
    const n1 = d.n && d.n.length === 1 ? d.n[0] : null;     // the shell colour hook: set when the selection has a single n

    const title = $('selection-title');
    const pk = pickedElectron();
    if (pk) {
      title.innerHTML = orbitalHTML(pk.orbital) + ' electron ' + (pk.spin === 'up' ? '↑' : '↓');
    } else if (sel.level === 'orbital') {
      title.innerHTML = orbitalHTML(sel.id) + ' orbital';
    } else if (sel.level === 'subshell') {
      title.innerHTML = Chem.subHTML(String(sel.id)) + ' subshell' +
        (state.focusOrbital ? ' <span class="title-focus">(focus: ' + orbitalHTML(state.focusOrbital) + ')</span>' : '');
    } else {
      title.textContent = 'Shell n = ' + sel.id;
    }
    setShellAttr(title, pk ? Chem.getOrbital(pk.orbital).n : n1);

    const panel = $('qn-panel');
    QN_KEYS.forEach(function (k) { if (qnTips[k] && qnTips[k].parentNode) qnTips[k].parentNode.removeChild(qnTips[k]); });
    panel.textContent = '';
    const picked = pickedElectron();
    $('qn-hint').hidden = state.mode !== 'atom';

    let nRows, lRows, mlRows, msRows, explain = d.explain || {};
    if (picked) {
      // one electron: exactly one value for each of the four quantum numbers
      const o = Chem.getOrbital(picked.orbital);
      nRows = [{ val: String(o.n), shell: o.n }];
      lRows = [{ val: String(o.l), label: LETTERS[o.l] }];
      mlRows = [{ val: fmtMl(o.ml), label: orbitalHTML(o.id, true) }];
      msRows = [{ val: picked.spin === 'up' ? '+½' : '−½', label: spinName(picked.spin) }];
      try { explain = Chem.describeSelection('orbital', o.id).explain || explain; } catch (e) { /* keep the selection's text */ }
    } else {
      const orbs = (d.orbitals || []).map(Chem.getOrbital);
      nRows = (d.n || []).map(function (n) { return { val: String(n), shell: n }; });
      lRows = (d.l || []).map(function (l) { return { val: String(l), label: LETTERS[l] }; });
      mlRows = (d.ml || []).map(function (m) {      // each mₗ with the boxes that carry it
        return { val: fmtMl(m), label: orbs.filter(function (o) { return o.ml === m; })
          .map(function (o) { return orbitalHTML(o.id, true); }).join(', ') };
      });
      msRows = [{ val: '+½', label: 'spin up' }, { val: '−½', label: 'spin down' }];
    }
    qnGroup(panel, 'n', nRows);
    qnGroup(panel, 'l', lRows);
    qnGroup(panel, 'ml', mlRows);
    qnGroup(panel, 'ms', msRows);
    const rules = $('qn-rules');           // no longer a visible list: the sentences are in the tooltips
    if (rules) rules.textContent = '';

    QN_KEYS.forEach(function (k) { setTipContent(qnTips[k], tipBody(explain[k])); });
  }

  /* ---------------- configuration panel ---------------- */
  /* Electrons are read-only here: they come from the chosen element and always show its ground state,
     so there is nothing to check, only the element, its configuration and any exception to the filling order.
     #config-panel is hidden in Explore mode. */

  /* everything the summary needs about element Z: chemistry.js elementDetails(), or the same fields
     assembled from the older API if that function is missing */
  function detailsOf(Z) {
    if (!Z) return null;
    if (typeof Chem.elementDetails === 'function') {
      try { const d = Chem.elementDetails(Z); if (d) return d; } catch (e) { /* fall through */ }
    }
    const e = Chem.elementOf(Z);
    if (!e) return null;
    const counts = Chem.configCounts(Z), an = Chem.anomalyOf(Z);
    return {
      Z: Z, symbol: e.symbol, name: e.name, period: e.period, group: e.group, block: e.block, electrons: Z,
      configuration: Chem.formatConfig(counts),
      shorthand: Chem.formatConfig(counts, { shorthand: true }),
      anomaly: an && { expected: an.expectedPretty || an.expected, actual: an.actualPretty || an.actual, reason: an.reason },
      valenceNote: ''
    };
  }

  function notationLine(parent, cls, key, value) {
    const p = el('p', 'config-line ' + cls);
    p.appendChild(el('span', 'config-key', key));
    p.appendChild(document.createTextNode(' '));
    p.appendChild(el('span', 'config-val', value));
    parent.appendChild(p);
  }

  function updateConfig() {
    const d = state.loadedZ ? detailsOf(state.loadedZ) : null;
    const nt = $('config-notation'), st = $('config-status'), vn = $('valence-note');
    const more = $('element-more'), why = $('anomaly-reason');
    $('config-panel').hidden = !d;
    nt.textContent = '';
    st.textContent = '';
    vn.textContent = ''; vn.hidden = true;
    why.textContent = ''; why.hidden = true;
    more.hidden = true;
    if (!d) {
      $('element-name').textContent = '';
      $('element-symbol').textContent = '';
      $('electron-count').textContent = '';
      more.open = false; moreZ = null;
      return;
    }
    if (moreZ !== d.Z) { more.open = false; moreZ = d.Z; }     // a new element starts collapsed; a click in the diagram keeps it as it was
    const total = Chem.totalElectrons(state.occupancy);
    $('element-name').textContent = d.name;
    $('element-symbol').textContent = d.symbol;
    $('electron-count').textContent = 'Z = ' + d.Z + ' · ' + total + (total === 1 ? ' electron' : ' electrons');
    notationLine(nt, 'config-full', 'Full', d.configuration);
    if (d.shorthand && d.shorthand !== d.configuration) notationLine(nt, 'config-short', 'Shorthand', d.shorthand);
    function line(kind, text) { st.appendChild(el('p', 'status-line ' + kind, text)); }
    const an = d.anomaly;
    if (an) {
      line('is-warn', 'Exception to the simple filling order. It predicts ' + an.expected + '; the real ground state is ' + an.actual + '.');
      if (an.reason) { why.textContent = an.reason; why.hidden = false; }
    } else {
      line('is-ok', 'Ground state, as the simple filling order predicts.');
    }
    if (d.valenceNote) { vn.textContent = d.valenceNote; vn.hidden = false; }
    $('element-more-summary').textContent = an ? 'Why the exception?' : 'More about this element';
    more.hidden = why.hidden && vn.hidden;       // the reason (exceptions) and the valence / ion note sit behind one click
  }
  let moreZ = null;                              // the element whose "more" details were last collapsed

  /* ---------------- 3-D viewer ---------------- */
  const mount = $('orbital-canvas');
  const legendEl = $('viewer-legend');
  let viewer = null;   // set if WebGL works

  const DEFAULT_VIEW = { azimuth: Math.PI / 4, polar: 1.1 };
  /* default zoom, relative to the fit for the largest shell, n = 5 (×1.00 = a 5-shell orbital fills the view) */
  const DEFAULT_ZOOM = 0.7;
  /* render layers (see v.draw): 0 is the scene as such, 1 holds the axis lines and cones once more,
     2 and up are one each for the solid orbitals that are fading, 31 is never drawn */
  const AXIS_LAYER = 1, FIRST_FADE_LAYER = 2, SPARE_LAYER = 31;

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
    if (typeof THREE === 'undefined') { fallback('The 3-D library (three.js) could not be loaded, so the 3-D view cannot be shown. The diagram and quantum numbers still work.'); return; }
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
    const amb = new THREE.AmbientLight(0xffffff, 0.75); scene.add(amb);
    const l1 = new THREE.DirectionalLight(0xffffff, 0.6); l1.position.set(3, 4, 5); scene.add(l1);
    const l2 = new THREE.DirectionalLight(0xffffff, 0.35); l2.position.set(-4, -3, -2); scene.add(l2);
    /* the scene is drawn in several passes (see v.draw), each showing only some layers: every pass needs the lights */
    [amb, l1, l2].forEach(function (light) { light.layers.enableAll(); });
    /* a pass does its own clearing, so that depth can be reset between orbitals */
    renderer.autoClear = false;

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
    /* Drawing, in passes. Layer 0 holds the scene as such: the axes, the settled orbitals and the
       translucent ones. A solid orbital that is fading in or out also has a depth-only twin (see
       setDepthPrepass), and the depth that twin writes must never hide anything but the orbital
       itself, so each such orbital gets a pass of its own, on its own layer (2, 3, ...), after
       the depth buffer has been reset. Layer 1 holds the axis lines and cones once more: drawn
       depth-only at the start of each of those passes, they let an axis that is really in front
       of the orbital stay in front of it. Orbitals are layered over each other in this order
       (the more opaque, the later), which for a cross-fade is as good as any depth order. */
    const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
    v.draw = function () {
      v.dirty = false;
      const sp = Math.sin(v.polar);
      camera.position.set(v.dist * sp * Math.cos(v.azimuth), v.dist * sp * Math.sin(v.azimuth), v.dist * Math.cos(v.polar));
      camera.lookAt(0, 0, 0);
      const fading = [];
      v.items.forEach(function (it) { if (it.depth) fading.push(it); });
      fading.sort(function (a, b) { return (a.to - b.to) || (b.n - a.n); });
      /* give every one its layer before anything is drawn, so no two of them share a pass;
         one that is all but invisible gets the spare layer, which is never drawn */
      const passes = [];
      fading.forEach(function (it) {
        const seen = it.mesh.material.opacity > 0.002;
        const layer = seen ? Math.min(FIRST_FADE_LAYER + passes.length, SPARE_LAYER - 1) : SPARE_LAYER;
        it.mesh.layers.set(layer); it.depth.layers.set(layer);
        if (seen) passes.push(layer);
      });
      try {
        renderer.clear();
        camera.layers.set(0);
        renderer.render(scene, camera);
        passes.forEach(function (layer) {
          renderer.clearDepth();
          scene.overrideMaterial = depthOnly; camera.layers.set(AXIS_LAYER); renderer.render(scene, camera); scene.overrideMaterial = null;
          camera.layers.set(layer); renderer.render(scene, camera);
        });
      } finally {
        scene.overrideMaterial = null; camera.layers.set(0);
      }
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
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.7 }));
      line.layers.enable(AXIS_LAYER);   // also on the axis layer, which re-draws their depth for the orbital passes (see v.draw)
      viewer.axes.add(line);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(L * 0.03, L * 0.1, 12), new THREE.MeshBasicMaterial({ color: color }));
      cone.position.copy(dir.clone().multiplyScalar(L));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      cone.layers.enable(AXIS_LAYER);
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

  /* the + and − lobes get the theme's two colours, one RGB triple per vertex */
  function paintLobes(col, signs, colors) {
    for (let i = 0; i < signs.length; i++) {
      const c = signs[i] < 0 ? colors.neg : colors.pos;
      col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b;
    }
  }

  function buildOrbitalMesh(id, colors) {
    const data = meshData(id);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    const col = new Float32Array(data.signs.length * 3);
    paintLobes(col, data.signs, colors);
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
        it = { mesh: buildOrbitalMesh(p.id, colors), size: s, n: o.n };
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

  /* A solid orbital fading in or out is drawn blended, and a blended surface that is seen from
     both sides shows its far side through its near side in whatever order the triangles happen to
     be drawn, so lobes look bent and protruding until the fade ends and the surface turns opaque.
     A depth-only twin drawn first (no colour) leaves just the nearest layer visible, so the shape
     is right from the first frame and nothing changes when the fade finishes. The translucent
     "clear" and "ghost" orbitals deliberately skip this: they are meant to be seen through.
     The twin writes real depth, though, and a surface that is mostly faded out must not hide
     anything behind it (the orbital that is fading in, say). So the pair, mesh and twin, is moved
     off the main layer and drawn on a layer of its own, after a depth reset, by v.draw: its depth
     reaches nothing but itself. Nothing is left over once the fade has ended. */
  function setDepthPrepass(it, on) {
    const v = viewer;
    if (on && !it.depth) {
      it.depth = new THREE.Mesh(it.mesh.geometry, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide }));
      it.mesh.layers.set(FIRST_FADE_LAYER); it.depth.layers.set(FIRST_FADE_LAYER);   // off the main layer at once; v.draw sorts out which pass
      v.group.add(it.depth);
    } else if (!on && it.depth) {
      v.group.remove(it.depth); it.depth.material.dispose(); it.depth = null;   /* geometry is shared with it.mesh */
      it.mesh.layers.set(0);
    }
    if (it.depth) it.depth.scale.copy(it.mesh.scale);
  }

  /* take an orbital off the stage for good */
  function dropItem(it, id) {
    setDepthPrepass(it, false);
    viewer.group.remove(it.mesh); disposeObject(it.mesh);
    viewer.items.delete(id);
  }

  /* an orbital at rest: the target opacity, opaque and depth-writing if solid, blended if translucent */
  function settleItem(it) {
    const m = it.mesh.material, solid = it.mode === 'solid';
    const flip = m.transparent === solid || m.depthWrite !== solid;
    m.opacity = it.to; m.transparent = !solid; m.depthWrite = solid;
    if (flip) m.needsUpdate = true;
    it.settled = it.mode;
  }

  function playFade() {
    const v = viewer;
    if (v.fade) { v.fade.cancel(); v.fade = null; }
    /* an orbital that was on its way out and has all but gone (a quick succession of clicks) is not worth fading any further */
    v.items.forEach(function (it, id) { if (it.leaving && it.mesh.material.opacity < 0.01) dropItem(it, id); });
    let changing = false;
    v.items.forEach(function (it) {
      const m = it.mesh.material;
      it.from = m.opacity; it.fromSize = it.mesh.scale.x;
      if (it.fromSize !== it.size) changing = true;
      const fading = it.from !== it.to;
      /* a surface has to blend while its opacity is changing */
      if (fading) {
        changing = true;
        if (!m.transparent || m.depthWrite) { m.transparent = true; m.depthWrite = false; m.needsUpdate = true; }
      } else {
        settleItem(it);
      }
      /* the nearest-layer look is kept from the moment an orbital is, was, or is still becoming solid
         until its fade ends (the twin can come and go only at the ends of a fade, never inside one) */
      setDepthPrepass(it, fading && (it.mode === 'solid' || it.settled === 'solid' || !!it.depth));
    });
    /* nothing on stage differs (an electron was toggled, say): one repaint is enough */
    if (!changing) { v.items.forEach(settleItem); v.dirty = false; v.requestRender(); return; }
    let finished = false;
    const tween = Motion.tween({
      easing: 'ui',
      update: function (p) {
        v.items.forEach(function (it) {
          it.mesh.material.opacity = it.from + (it.to - it.from) * p;
          it.mesh.scale.setScalar(it.fromSize + (it.size - it.fromSize) * p);
          if (it.depth) it.depth.scale.copy(it.mesh.scale);
        });
        v.requestRender();
      },
      done: function () {
        finished = true;
        v.items.forEach(function (it, id) {
          setDepthPrepass(it, false);
          if (it.leaving) { dropItem(it, id); return; }
          settleItem(it);
        });
        v.fade = null;
        v.dirty = false; v.requestRender();
      }
    });
    /* with reduced motion the tween has already finished, inside the call above */
    v.fade = finished ? null : tween;
  }

  /* the lobe colours are baked into each mesh, so a theme change repaints them in place: what is on
     stage (and how far a fade has got) stays as it is, and only the colours, and the axes, change */
  function recolourViewer() {
    if (!viewer) return;
    const colors = themeColors();
    viewer.items.forEach(function (it, id) {
      const attr = it.mesh.geometry.getAttribute('color');
      paintLobes(attr.array, meshData(id).signs, colors);
      attr.needsUpdate = true;
    });
    viewer.axisKey = '';   // the axis colour follows the theme as well
    updateViewer();
  }

  function updateLegend(plan) {
    const hadFocus = legendEl.contains(document.activeElement) && document.activeElement.getAttribute('data-orbital');
    legendEl.textContent = '';
    const shown = plan.filter((p) => !p.hidden).length;
    const head = el('p', 'legend-title', plan.length > 1
      ? 'Drawn orbitals (' + shown + ' of ' + plan.length + ') · click to hide or show'
      : 'Drawn orbital');
    legendEl.appendChild(head);
    plan.forEach(function (p) {
      const o = Chem.getOrbital(p.id);
      const kind = p.mode === 'solid' ? 'is-solid' : p.mode === 'ghost' ? 'is-ghost' : 'is-clear';
      const item = el('button', 'legend-item ' + kind + (p.hidden ? ' is-hidden' : ''));
      item.type = 'button';
      item.setAttribute('data-orbital', p.id);
      item.setAttribute('data-n', o.n);   // shell colour hook
      item.setAttribute('aria-pressed', p.hidden ? 'false' : 'true');
      item.setAttribute('aria-label', orbitalText(p.id) + ': ' + (p.hidden ? 'hidden, press to show' : 'shown, press to hide'));
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
      item.appendChild(elHTML('span', 'legend-name', orbitalHTML(p.id)));
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
    orbital: 'Click a box to see one orbital.',
    subshell: 'Click a box or a subshell label to see all its orbitals.',
    shell: 'Click a box or an n tag to see every orbital in that shell.'
  };

  function renderAll() {
    const radios = document.querySelectorAll('input[name="slice-mode"]');
    radios.forEach((r) => { r.checked = r.value === state.sliceMode; });
    $('slice-hint').textContent = HINTS[state.sliceMode];
    updateDiagram();
    updateInfo();
    updateConfig();
    updateViewer();
  }

  // Lighter refresh when only the electrons changed (a new element was picked)
  function renderElectrons() {
    updateDiagram();
    updateConfig();
  }

  /* ---------------- events ---------------- */
  /* Clicking in the diagram only ever selects. Electrons are never added or removed here. */
  // the electron arrow under the pointer, if any (arrows ignore pointer events, so test their rectangles)
  function electronAt(box, x, y) {
    return Array.from(box.querySelectorAll('.electron')).find(function (el2) {
      const r = el2.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }) || null;
  }

  diagramEl.addEventListener('click', function (e) {
    const box = e.target.closest('.orbital-box');
    const label = e.target.closest('.subshell-label');
    const tag = e.target.closest('.shell-tag');
    const prev = pickedElectron();
    state.electron = null;
    if (label) {
      selectSubshell(label.closest('.subshell-row').dataset.subshell);
      renderAll(); return;
    }
    if (tag) {
      selectShell(Number(tag.dataset.shell));
      renderAll(); return;
    }
    if (!box) return;
    const picked = state.mode === 'atom' ? electronAt(box, e.clientX, e.clientY) : null;
    selectBox(box.dataset.orbital);
    if (picked) {
      const same = prev && prev.orbital === box.dataset.orbital && prev.spin === picked.dataset.spin;
      state.electron = same ? null : { orbital: box.dataset.orbital, spin: picked.dataset.spin };
    }
    renderAll();
  });

  document.querySelectorAll('input[name="slice-mode"]').forEach(function (r) {
    r.addEventListener('change', function () {
      if (!r.checked) return;
      state.electron = null;
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

  /* ================================================================
     SCREENS, MODES AND THE ELEMENT
       start  -> "Explore orbitals" -> app view, no electrons
              -> "Real atoms" -> periodic table -> app view with that element's electrons
     In the app view #mode-switch flips Explore <-> Real atom, #element-chip re-opens the table.
     Where we are lives in location.hash, so a link or a reload lands on the same view:
       (none) start screen   #explore app view, Explore   #atom=26 app view, Fe   #atom the table
     Entering the table pushes a history entry (Back leaves it again); everything else that happens
     inside the app view, and choosing an element, replaces the current entry.
     Electrons only ever get into the boxes through setElement().
     ================================================================ */
  const SCREENS = ['start', 'table', 'app'];
  const HEADING_OF = { start: 'start-heading', table: 'table-heading', app: 'app-heading' };
  const LEAVE_MS = 100, ENTER_MS = 170;      // fade out, then fade in with a 10px lift: 270 ms in all, no sideways movement
  const screenEl = function (name) { return $('screen-' + name); };
  const DEFAULT_HINT = $('table-hint').textContent;

  let curScreen = null;       // the screen being shown, or about to be (set when a change starts)
  let shown = null;           // the screen that is on display right now
  let navToken = 0;           // a newer change cancels the unfinished steps of an older one
  let pendingFade = false;    // electrons went into the boxes while the diagram was out of sight
  let electronToken = 0;
  let viewerTried = false;
  let announceTimer = 0;
  let table = null;           // the PeriodicTable instance, mounted the first time the table opens
  let booted = false;

  /* ---- announcements (polite live region, screen readers only) ---- */
  function announce(msg) {
    const r = $('sr-status');
    if (!r) return;
    clearTimeout(announceTimer);
    r.textContent = '';                          // empty first, so the same sentence twice is read twice
    announceTimer = setTimeout(function () { r.textContent = msg; }, 60);
  }

  function announceFor(t) {
    if (t.screen === 'start') return 'Start screen. Choose Explore orbitals or Real atoms.';
    if (t.screen === 'table') return 'Periodic table selector. Choose an element from hydrogen to xenon.';
    if (t.mode !== 'atom') return 'Explore mode: orbitals shown without electrons.';
    const d = detailsOf(t.Z);
    if (!d) return '';
    return 'Real atom mode: ' + d.name.toLowerCase() + ' selected, ' + d.Z + ' electrons.' +
      (d.anomaly ? ' Its real configuration differs from the simple filling order.' : '');
  }

  /* ---- electrons fading in / out of the diagram ---- */
  function fadeInElectrons(delay) {
    if (Motion.reduced()) return;
    const order = {};                            // the lowest subshell first, so the atom seems to fill from the inside out
    rowEls.forEach(function (r, i) { order[r.sub.id] = rowEls.length - 1 - i; });
    diagramEl.querySelectorAll('.orbital-box .electron').forEach(function (e) {
      const row = e.closest('.subshell-row');
      Motion.animate(e, [{ opacity: 0 }, { opacity: 1 }], { duration: 'base', delay: (delay || 0) + (order[row && row.dataset.subshell] || 0) * 16 });
    });
  }

  function fadeOutElectrons() {
    const els = Array.from(diagramEl.querySelectorAll('.orbital-box .electron'));
    if (!els.length || Motion.reduced()) return Promise.resolve();
    return Promise.all(els.map(function (e) {
      return Motion.animate(e, [{ opacity: 1 }, { opacity: 0 }], { duration: 'fast', fill: 'forwards' });
    }));
  }

  /* ---- the element: the one place that puts electrons into (or takes them out of) the boxes ---- */
  function setElement(Z) {
    electronToken++;
    state.electron = null;
    const occ = Chem.emptyOccupancy();
    if (Z) {
      const cfg = Chem.configOf(Z);
      Object.keys(cfg || {}).forEach(function (k) { if (occ[k]) occ[k] = { up: !!cfg[k].up, down: !!cfg[k].down }; });
      state.lastZ = Z;
    }
    const hadElectrons = !!state.loadedZ;
    const visible = shown === 'app' && curScreen === 'app';
    state.loadedZ = Z || null;
    state.occupancy = occ;
    updateInfo();
    if (Z) {
      renderElectrons();
      if (visible) fadeInElectrons(0); else pendingFade = true;     // out of sight: fade them in once the view is back
    } else {
      pendingFade = false;
      updateConfig();
      if (visible && hadElectrons) {
        const tok = electronToken;
        fadeOutElectrons().then(function () { if (tok === electronToken) updateDiagram(); });
      } else {
        updateDiagram();
      }
    }
  }

  /* ---- the app bar and the hooks the stylesheet reads ---- */
  function updateChrome() {
    const onApp = shown === 'app';
    const d = state.mode === 'atom' ? detailsOf(state.loadedZ) : null;
    document.body.setAttribute('data-screen', shown || curScreen || 'start');
    document.body.setAttribute('data-mode', state.mode);
    $('mode-switch').hidden = !onApp;
    document.querySelectorAll('input[name="app-mode"]').forEach(function (r) { r.checked = r.value === state.mode; });
    const chip = $('element-chip');
    chip.hidden = !(onApp && d);
    if (d) {
      $('element-chip-text').textContent = d.symbol + ' · Z = ' + d.Z;
      chip.setAttribute('data-z', String(d.Z));
      chip.setAttribute('aria-label', d.symbol + ' · Z = ' + d.Z + ' (' + d.name + '). Change element.');
    } else {
      chip.removeAttribute('data-z');
    }
    $('app-heading').textContent = d ? 'Orbital explorer: real atom, ' + d.name.toLowerCase() : 'Orbital explorer: explore mode';
  }

  /* ---- the 3-D viewer is created when the app view is first on display (a hidden element has no size) ---- */
  function ensureViewer() {
    if (viewerTried) return;
    viewerTried = true;
    initViewer();
    if (viewer) updateViewer();
  }

  /* ---- the periodic table ---- */
  function elementReadout(Z) {
    const d = detailsOf(Z);
    return d ? d.name + ' (' + d.symbol + ') · Z = ' + d.Z + (d.shorthand ? ' · ' + d.shorthand : '') : '';
  }

  /* only used if periodic-table.js did not load: a plain list, so Real atoms still works */
  function fallbackPicker(host, Z) {
    host.textContent = '';
    const label = el('label', null, 'Element');
    label.setAttribute('for', 'table-fallback');
    const sel = el('select', 'select');
    sel.id = 'table-fallback';
    sel.appendChild(el('option', null, 'Choose an element…')).value = '';
    Chem.ELEMENTS.forEach(function (e) {
      const o = el('option', null, e.symbol + ' · ' + e.name + ' (Z = ' + e.Z + ')');
      o.value = String(e.Z);
      sel.appendChild(o);
    });
    sel.value = Z ? String(Z) : '';
    sel.addEventListener('change', function () { if (sel.value) onTablePick(Number(sel.value)); });
    host.appendChild(label);
    host.appendChild(document.createTextNode(' '));
    host.appendChild(sel);
    return { setSelected: function (z) { sel.value = z ? String(z) : ''; }, focus: function () { sel.focus(); } };
  }

  function ensureTable() {
    const Z = state.loadedZ || state.lastZ || null;
    $('table-hint').textContent = Z ? 'Selected: ' + elementReadout(Z) : DEFAULT_HINT;   // what the hint falls back to when nothing is hovered
    if (table) { table.setSelected(Z); return; }
    const host = $('table-mount');
    try {
      table = window.PeriodicTable ? window.PeriodicTable.mount(host, { selectedZ: Z, onSelect: onTablePick, chem: Chem }) : null;
    } catch (err) { table = null; }
    if (!table) table = fallbackPicker(host, Z);
  }

  function onTablePick(Z) {
    /* the same element again, with the table opened on top of it: that is just Back */
    if (Z === state.loadedZ && state.mode === 'atom' && history.state && history.state.pt) { history.back(); return; }
    go({ screen: 'app', mode: 'atom', Z: Z }, 'replace');
  }

  function tableBack() {
    if (history.state && history.state.pt) { history.back(); return; }      // we pushed this entry: step back out of it
    if (state.started) go({ screen: 'app', mode: state.mode, Z: state.loadedZ }, 'replace');
    else go({ screen: 'start' }, 'replace');                                // the table was opened by its link
  }

  /* ---- screen changes ----
     The old screen fades out (LEAVE_MS), then the new one fades in with a short lift (ENTER_MS): only one
     is ever visible, so nothing is laid out twice and nothing jumps. .is-leaving / .is-entering are
     state hooks while that runs. Reduced motion: both steps are skipped. */
  function showScreen(name, opts) {
    opts = opts || {};
    const token = ++navToken;
    const next = screenEl(name);
    const from = curScreen;
    curScreen = name;

    SCREENS.forEach(function (n) {               // settle whatever an earlier change left half-way
      const s = screenEl(n);
      try { s.getAnimations().forEach(function (a) { a.cancel(); }); } catch (e) { /* no Web Animations */ }
      s.classList.remove('is-entering', 'is-leaving');
      s.inert = false;
    });
    const quick = !!opts.instant || Motion.reduced();
    const leaving = SCREENS.map(screenEl).filter(function (s) { return s !== next && !s.hidden; });

    function afterShow(fresh) {
      if (tipOpen) hideTip(tipOpen);
      updateChrome();
      if (name === 'app') {
        ensureViewer();
        if (pendingFade) { pendingFade = false; fadeInElectrons(fresh && !quick ? Math.round(ENTER_MS / 2) : 0); }
      } else if (name === 'table') {
        ensureTable();
      }
      if (fresh && opts.focus !== false) {
        const h = $(HEADING_OF[name]);
        if (h) h.focus({ preventScroll: true });
      }
      if (opts.announce) announce(opts.announce);
    }

    function reveal(animate) {
      if (token !== navToken) return;            // a newer change took over
      leaving.forEach(function (s) { s.hidden = true; s.classList.remove('is-leaving'); s.inert = false; });
      const fresh = next.hidden;
      next.hidden = false;
      shown = name;
      if (fresh && from !== null) {
        try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch (e) { window.scrollTo(0, 0); }
      }
      afterShow(fresh);
      if (animate && fresh) {
        next.classList.add('is-entering');
        Motion.enter(next, { y: 10, duration: ENTER_MS }).then(function () {
          if (token === navToken) next.classList.remove('is-entering');
        });
      }
    }

    if (from === name && shown === name) { afterShow(false); return; }      // same screen: a mode / element change only
    if (quick || !leaving.length) { reveal(!quick); return; }
    leaving.forEach(function (s) { s.classList.add('is-leaving'); s.inert = true; });
    Promise.all(leaving.map(function (s) { return Motion.exit(s, { duration: LEAVE_MS, hide: false }); }))
      .then(function () { reveal(true); });
  }

  /* ---- where we are <-> location.hash ---- */
  function parseHash(h) {
    h = h || '';
    if (h === '#explore') return { screen: 'app', mode: 'explore', Z: null };
    const m = /^#atom=(\d+)$/.exec(h);
    if (m) {
      const Z = Number(m[1]);
      return Z >= 1 && Z <= Chem.MAX_ELECTRONS ? { screen: 'app', mode: 'atom', Z: Z } : { screen: 'table' };
    }
    if (h === '#atom') return { screen: 'table' };
    return { screen: 'start' };
  }

  function hashOf(t) {
    if (t.screen === 'table') return '#atom';
    if (t.screen === 'app') return t.mode === 'atom' && t.Z ? '#atom=' + t.Z : '#explore';
    return '';
  }

  /* how: 'push' (a new history entry), 'replace' (the current one is rewritten), 'none' (we got here by Back / Forward) */
  function writeHistory(t, how) {
    if (how === 'none') return;
    const url = location.href.split('#')[0] + hashOf(t);
    const st = t.screen === 'table' ? (how === 'push' ? { pt: 1 } : history.state) : null;   // pt: the entry that opened the table
    try {
      if (how === 'push' && url !== location.href) history.pushState(st, '', url);
      else if (url !== location.href || st !== history.state) history.replaceState(st, '', url);
    } catch (e) { /* file:// in some browsers: the address bar just does not follow */ }
  }

  function sameTarget(t) {
    if (t.screen !== curScreen) return false;
    return t.screen !== 'app' || (t.mode === state.mode && (t.mode !== 'atom' || t.Z === state.loadedZ));
  }

  /* t: { screen: 'start' } | { screen: 'table' } | { screen: 'app', mode: 'explore' } | { screen: 'app', mode: 'atom', Z } */
  function go(t, how, opts) {
    opts = opts || {};
    if (sameTarget(t)) { writeHistory(t, how === 'push' ? 'replace' : how); return; }
    if (t.screen === 'app') {
      state.mode = t.mode === 'atom' ? 'atom' : 'explore';
      state.started = true;
      const Z = state.mode === 'atom' ? t.Z : null;
      if (Z !== state.loadedZ) setElement(Z);
    }
    writeHistory(t, how);
    showScreen(t.screen, { instant: opts.instant, focus: opts.focus, announce: opts.silent ? '' : announceFor(t) });
  }

  function requestMode(mode) {
    if (mode === state.mode) return;
    if (mode === 'explore') { go({ screen: 'app', mode: 'explore' }, 'replace'); return; }
    if (state.lastZ) { go({ screen: 'app', mode: 'atom', Z: state.lastZ }, 'replace'); return; }
    updateChrome();                              // nothing chosen yet: the switch stays on Explore while the table is open
    go({ screen: 'table' }, 'push');
  }

  /* ---- wiring ---- */
  document.querySelectorAll('.mode-card').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.getAttribute('data-mode') === 'explore') go({ screen: 'app', mode: 'explore' }, 'push');
      else go({ screen: 'table' }, 'push');
    });
  });

  document.querySelectorAll('input[name="app-mode"]').forEach(function (r) {
    r.addEventListener('change', function () { if (r.checked) requestMode(r.value); });
  });

  $('element-chip').addEventListener('click', function () { go({ screen: 'table' }, 'push'); });
  $('table-back').addEventListener('click', tableBack);

  $('app-home').addEventListener('click', function (e) {          // the logo + title: back to the start screen
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (curScreen !== 'start') go({ screen: 'start' }, 'push');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !e.defaultPrevented && !tipOpen && curScreen === 'table' && shown === 'table') tableBack();
  });

  function onLocationChange() { if (booted) go(parseHash(location.hash), 'none'); }
  window.addEventListener('popstate', onLocationChange);
  window.addEventListener('hashchange', onLocationChange);

  // theme changes recolour the 3-D lobes
  new MutationObserver(function () {
    state.theme = root.getAttribute('data-theme') || 'light';
    recolourViewer();
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  /* ...and so does the OS flipping between light and dark while no explicit choice is stored */
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolourViewer); } catch (e) { /* older browser */ }

  /* ---------------- boot ---------------- */
  buildDiagram();
  mountQnTips();
  $('axis-key').textContent = 'Axes: x, y, z (z is up)';
  renderAll();            // the 3-D viewer itself is created when the app view first appears (ensureViewer)
  /* open straight into the view the URL names; the start screen only when there is no hash.
     index.html already revealed that screen before the first paint, so this is instant and keeps focus where it is */
  (function () {
    const t0 = parseHash(location.hash);
    go(t0, t0.screen === 'start' ? 'none' : 'replace', { instant: true, focus: false, silent: true });
    booted = true;
  })();
  /* the axis letters are drawn on a canvas: redraw them once the web fonts have arrived */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (viewer) { viewer.axisKey = ''; updateViewer(); } });
})();
