/*
 * periodic-table.js - PeriodicTable
 * The element selector for the orbital visualiser: periods 1-5 (H ... Xe, Z = 1-54) in the
 * standard 18-column layout.  No lanthanide / actinide rows.
 *
 *   var t = PeriodicTable.mount(container, { selectedZ, onSelect(Z), onHover(Z|null), chem, hint });
 *   t.setSelected(Z | null)   t.getSelected()   t.focus(focusOptions)   t.destroy()
 *
 * Needs window.OrbitalChem (chemistry.js): ELEMENTS[i] {Z, symbol, name, period, group, block},
 * anomalyOf(Z), and (optionally) elementDetails(Z).shorthand for the hover readout.
 *
 * DOM (all strings are written with textContent / setAttribute; nothing is parsed as HTML):
 *   div.pt                                   scroll box (overflows sideways only when very narrow)
 *     div.pt-table[role=grid]                CSS grid: column 1 = period labels, columns 2-19 = groups 1-18
 *       div.pt-row[role=row]  (display: contents)
 *         div.pt-corner | div.pt-colhead[data-group] | div.pt-rowhead[data-period]
 *         div.pt-slot[role=gridcell]         grid-row = period + 1, grid-column = group + 1
 *           button.pt-cell[data-z data-symbol data-period data-group data-block (data-anomaly)]
 *             span.pt-num  span.pt-sym  span.pt-block  (span.pt-flag)       all aria-hidden
 *     ul.pt-legend > li.pt-key > span.pt-key-swatch[data-block] / span.pt-flag
 *
 * Selected element: aria-pressed="true", aria-current="true", class is-selected.
 * The base layout rules are injected once as zero-specificity :where() rules, so any rule in
 * styles.css overrides them without needing !important.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.PeriodicTable = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var MAX_Z = 54;
  var PERIODS = 5;
  var GROUPS = 18;
  var FLAG = '◆';                       // black diamond
  var SEP = ' · ';                      // middle dot
  var ANOMALY_TEXT = 'real configuration differs from the simple filling order';
  var STYLE_ID = 'pt-base-styles';

  /* ---------------- small DOM helpers ---------------- */

  function make(doc, tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function attrs(n, map) {
    Object.keys(map).forEach(function (k) { n.setAttribute(k, String(map[k])); });
    return n;
  }
  function place(n, row, col) { n.style.gridRow = String(row); n.style.gridColumn = String(col); }

  function ensureStyles(doc) {
    if (doc.getElementById(STYLE_ID) || !doc.head) return;
    var s = doc.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      ':where(.pt){box-sizing:border-box;max-width:100%;overflow-x:auto;padding:3px}',
      ':where(.pt *){box-sizing:border-box}',
      ':where(.pt-table){display:grid;grid-template-columns:var(--pt-label-w,1.5rem) repeat(18,minmax(0,1fr));' +
        'grid-template-rows:auto repeat(5,minmax(2rem,1fr));gap:var(--pt-gap,2px);min-width:var(--pt-min-width,40rem)}',
      ':where(.pt-row){display:contents}',
      ':where(.pt-colhead,.pt-rowhead){display:flex;align-items:center;justify-content:center;font-size:.75rem}',
      ':where(.pt-slot){display:flex;min-width:0;min-height:0}',
      ':where(.pt-cell){position:relative;display:flex;flex:1 1 auto;flex-direction:column;align-items:center;' +
        'justify-content:center;min-width:0;min-height:2rem;margin:0;padding:0;font:inherit;color:inherit;' +
        'background:transparent;border:1px solid currentColor;border-radius:4px;cursor:pointer}',
      ':where(.pt-cell:focus-visible){outline:3px solid;outline-offset:1px;z-index:1}',
      ':where(.pt-cell[aria-pressed="true"]){outline:3px solid Highlight;outline-offset:1px;z-index:1}',
      ':where(.pt-num){font-size:.6875rem;line-height:1}',
      ':where(.pt-sym){font-size:1rem;font-weight:600;line-height:1.1}',
      ':where(.pt-block){position:absolute;left:.25em;bottom:.1em;font-size:.6875rem;line-height:1}',
      ':where(.pt-flag){position:absolute;right:.25em;top:.1em;font-size:.6875rem;line-height:1}',
      ':where(.pt-legend){display:flex;flex-wrap:wrap;gap:.25rem 1.25rem;margin:.5rem 0 0;padding:0;list-style:none;font-size:.8125rem}',
      ':where(.pt-key){display:inline-flex;align-items:center;gap:.4em}',
      ':where(.pt-key-swatch){position:relative;display:inline-flex;align-items:center;justify-content:center;' +
        'inline-size:1.5rem;block-size:1.5rem;border:1px solid currentColor;border-radius:4px;font-size:.75rem}',
      ':where(.pt-key .pt-flag){position:static}'
    ].join('\n');
    doc.head.appendChild(s);
  }

  /* ---------------- mount ---------------- */

  function mount(container, opts) {
    opts = opts || {};
    if (!container || container.nodeType !== 1) throw new TypeError('PeriodicTable.mount: container must be an element');
    var chem = opts.chem || root.OrbitalChem;
    if (!chem || !chem.ELEMENTS) throw new Error('PeriodicTable.mount: OrbitalChem (chemistry.js) is not loaded');
    var doc = container.ownerDocument;
    ensureStyles(doc);

    /* ---- element table ---- */
    var items = chem.ELEMENTS.filter(function (e) { return e.Z >= 1 && e.Z <= MAX_Z; }).map(function (e) {
      if (typeof e.period !== 'number' || typeof e.group !== 'number' || !e.block) {
        throw new Error('PeriodicTable.mount: OrbitalChem.ELEMENTS[' + (e.Z - 1) + '] has no period/group/block');
      }
      return {
        Z: e.Z, symbol: e.symbol, name: e.name,
        period: e.period, group: e.group, block: e.block,
        anomaly: typeof chem.anomalyOf === 'function' && chem.anomalyOf(e.Z) != null,
        cell: null
      };
    });
    var byZ = {};
    var byPos = {};
    var rows = [];                                   // rows[period] = items sorted by group
    for (var p = 1; p <= PERIODS; p++) rows[p] = [];
    items.forEach(function (it) {
      byZ[it.Z] = it;
      byPos[it.period + '/' + it.group] = it;
      rows[it.period].push(it);
    });
    rows.forEach(function (r) { r.sort(function (a, b) { return a.group - b.group; }); });
    var first = byZ[1] || items[0];
    var last = rows[PERIODS][rows[PERIODS].length - 1];

    /* ---- state ---- */
    var selectedZ = null;
    var currentZ = first ? first.Z : null;           // the roving-tabindex stop
    var hoverZ = null;
    var focusZ = null;
    var reportedZ = null;
    var hintHost = null;
    var hintIdle = '';
    var hintActive = false;
    var destroyed = false;

    /* ---- build ---- */
    container.textContent = '';
    var wrap = make(doc, 'div', 'pt');
    var grid = attrs(make(doc, 'div', 'pt-table'), {
      role: 'grid',
      'aria-label': 'Periodic table, periods 1 to 5. Columns are groups 1 to 18.',
      'aria-rowcount': PERIODS + 1,
      'aria-colcount': GROUPS + 1
    });

    var headRow = attrs(make(doc, 'div', 'pt-row'), { role: 'row', 'aria-rowindex': 1 });
    var corner = make(doc, 'div', 'pt-corner');
    corner.setAttribute('aria-hidden', 'true');
    place(corner, 1, 1);
    headRow.appendChild(corner);
    for (var g = 1; g <= GROUPS; g++) {
      var ch = attrs(make(doc, 'div', 'pt-colhead', String(g)), {
        role: 'columnheader', 'aria-colindex': g + 1, 'aria-label': 'Group ' + g, 'data-group': g
      });
      place(ch, 1, g + 1);
      headRow.appendChild(ch);
    }
    grid.appendChild(headRow);

    for (var per = 1; per <= PERIODS; per++) {
      var row = attrs(make(doc, 'div', 'pt-row'), { role: 'row', 'aria-rowindex': per + 1, 'data-period': per });
      var rh = attrs(make(doc, 'div', 'pt-rowhead', String(per)), {
        role: 'rowheader', 'aria-colindex': 1, 'aria-label': 'Period ' + per, 'data-period': per
      });
      place(rh, per + 1, 1);
      row.appendChild(rh);
      rows[per].forEach(function (it) {
        var slot = attrs(make(doc, 'div', 'pt-slot'), { role: 'gridcell', 'aria-colindex': it.group + 1 });
        place(slot, it.period + 1, it.group + 1);
        var btn = attrs(make(doc, 'button', 'pt-cell'), {
          type: 'button',
          'data-z': it.Z, 'data-symbol': it.symbol, 'data-period': it.period,
          'data-group': it.group, 'data-block': it.block,
          'aria-label': it.name + ', atomic number ' + it.Z + ', group ' + it.group + ', period ' + it.period +
            ', ' + it.block + '-block' + (it.anomaly ? ', ' + ANOMALY_TEXT : ''),
          'aria-pressed': 'false',
          tabindex: '-1'
        });
        if (it.anomaly) btn.setAttribute('data-anomaly', 'true');
        [['pt-num', String(it.Z)], ['pt-sym', it.symbol], ['pt-block', it.block]].forEach(function (s) {
          btn.appendChild(attrs(make(doc, 'span', s[0], s[1]), { 'aria-hidden': 'true' }));
        });
        if (it.anomaly) btn.appendChild(attrs(make(doc, 'span', 'pt-flag', FLAG), { 'aria-hidden': 'true' }));
        slot.appendChild(btn);
        row.appendChild(slot);
        it.cell = btn;
      });
      grid.appendChild(row);
    }
    wrap.appendChild(grid);

    /* legend: shapes/letters, not colour alone */
    var legend = attrs(make(doc, 'ul', 'pt-legend'), { 'aria-label': 'Key' });
    [['s', 's-block'], ['p', 'p-block'], ['d', 'd-block']].forEach(function (b) {
      var li = make(doc, 'li', 'pt-key');
      var sw = attrs(make(doc, 'span', 'pt-key-swatch'), { 'data-block': b[0], 'aria-hidden': 'true' });
      sw.appendChild(make(doc, 'span', 'pt-block', b[0]));
      li.appendChild(sw);
      li.appendChild(make(doc, 'span', 'pt-key-text', b[1]));
      legend.appendChild(li);
    });
    var fl = make(doc, 'li', 'pt-key pt-key-flag');
    fl.appendChild(attrs(make(doc, 'span', 'pt-flag', FLAG), { 'aria-hidden': 'true' }));
    fl.appendChild(make(doc, 'span', 'pt-key-text', 'Real configuration differs from the simple filling order'));
    legend.appendChild(fl);
    legend.appendChild(make(doc, 'li', 'pt-key pt-key-axes', 'Group 1–18 across, period 1–5 down'));
    wrap.appendChild(legend);
    container.appendChild(wrap);

    /* ---------------- hint / readout ---------------- */

    function hintEl() {
      if (opts.hint === false) return null;
      if (opts.hint && opts.hint.nodeType === 1) return opts.hint;
      return doc.getElementById('table-hint');
    }
    function shorthandOf(Z) {
      try {
        if (typeof chem.elementDetails === 'function') {
          var d = chem.elementDetails(Z);
          if (d && d.shorthand) return d.shorthand;
        }
        if (typeof chem.formatConfig === 'function' && typeof chem.configCounts === 'function') {
          return chem.formatConfig(chem.configCounts(Z), { shorthand: true });
        }
      } catch (err) { /* readout is a nicety; never break the table */ }
      return '';
    }
    function readout(Z) {
      var it = byZ[Z];
      if (!it) return '';
      var s = it.name + ' (' + it.symbol + ')' + SEP + 'Z = ' + it.Z;
      var cfg = shorthandOf(Z);
      if (cfg) s += SEP + cfg;
      if (it.anomaly) s += SEP + FLAG + ' differs from the simple filling order';
      return s;
    }
    function refreshHint() {
      if (destroyed) return;
      var Z = hoverZ || focusZ || null;
      var h = hintEl();
      if (h) {
        if (Z) {
          if (!hintActive || hintHost !== h) { hintHost = h; hintIdle = h.textContent; hintActive = true; }
          h.textContent = readout(Z);
        } else if (hintActive) {
          if (hintHost) hintHost.textContent = hintIdle;
          hintActive = false; hintHost = null;
        }
      }
      if (Z !== reportedZ) {
        reportedZ = Z;
        if (typeof opts.onHover === 'function') opts.onHover(Z);
      }
    }

    /* ---------------- selection + roving tabindex ---------------- */

    function normZ(Z) {
      Z = Math.round(Number(Z));
      return byZ[Z] ? Z : null;
    }
    function setCurrent(Z) {
      if (Z == null || !byZ[Z]) return;
      if (currentZ != null && byZ[currentZ]) byZ[currentZ].cell.tabIndex = -1;
      currentZ = Z;
      byZ[Z].cell.tabIndex = 0;
    }
    function setSelected(Z) {
      if (destroyed) return;
      selectedZ = normZ(Z);
      items.forEach(function (it) {
        var on = it.Z === selectedZ;
        it.cell.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on) it.cell.setAttribute('aria-current', 'true'); else it.cell.removeAttribute('aria-current');
        it.cell.classList.toggle('is-selected', on);
      });
      if (selectedZ != null) setCurrent(selectedZ);
    }
    function focusItem(it, options) {
      if (!it) return;
      setCurrent(it.Z);
      it.cell.focus(options);
    }

    /* ---------------- keyboard ---------------- */

    function stepRow(it, dir) {
      var r = rows[it.period];
      return r[r.indexOf(it) + dir] || null;
    }
    function stepColumn(it, dir) {
      var r = rows[it.period + dir];
      if (!r || !r.length) return null;
      var exact = byPos[(it.period + dir) + '/' + it.group];
      if (exact) return exact;
      var best = null, bestD = Infinity;                   // gap in this column: nearest element in that period
      r.forEach(function (c) {
        var d = Math.abs(c.group - it.group);
        if (d < bestD) { best = c; bestD = d; }
      });
      return best;
    }
    function itemOf(target) {
      var btn = target && target.closest ? target.closest('.pt-cell') : null;
      return btn && wrap.contains(btn) ? byZ[Number(btn.getAttribute('data-z'))] || null : null;
    }

    function onKeyDown(e) {
      if (e.altKey || e.metaKey) return;
      var it = itemOf(e.target);
      if (!it) return;
      var next;
      switch (e.key) {
        case 'ArrowLeft': next = stepRow(it, -1); break;
        case 'ArrowRight': next = stepRow(it, 1); break;
        case 'ArrowUp': next = stepColumn(it, -1); break;
        case 'ArrowDown': next = stepColumn(it, 1); break;
        case 'Home': next = e.ctrlKey ? first : rows[it.period][0]; break;
        case 'End': next = e.ctrlKey ? last : rows[it.period][rows[it.period].length - 1]; break;
        default: return;
      }
      e.preventDefault();
      if (next && next !== it) focusItem(next);
    }

    /* ---------------- pointer / focus events ---------------- */

    function onClick(e) {
      var it = itemOf(e.target);
      if (!it) return;
      setCurrent(it.Z);
      setSelected(it.Z);
      if (typeof opts.onSelect === 'function') opts.onSelect(it.Z);
    }
    function onFocusIn(e) {
      var it = itemOf(e.target);
      if (!it) return;
      focusZ = it.Z;
      setCurrent(it.Z);
      var h = hintEl();
      if (h && h.id) it.cell.setAttribute('aria-describedby', h.id);
      refreshHint();
    }
    function onFocusOut(e) {
      var it = itemOf(e.target);
      if (it) it.cell.removeAttribute('aria-describedby');
      var to = e.relatedTarget;
      if (!to || !wrap.contains(to)) { focusZ = null; refreshHint(); }
    }
    function onMouseOver(e) {
      var it = itemOf(e.target);
      hoverZ = it ? it.Z : null;
      refreshHint();
    }
    function onMouseLeave() { hoverZ = null; refreshHint(); }

    wrap.addEventListener('click', onClick);
    wrap.addEventListener('keydown', onKeyDown);
    wrap.addEventListener('focusin', onFocusIn);
    wrap.addEventListener('focusout', onFocusOut);
    wrap.addEventListener('mouseover', onMouseOver);
    wrap.addEventListener('mouseleave', onMouseLeave);

    if (first) first.cell.tabIndex = 0;
    setSelected(opts.selectedZ);

    /* ---------------- api ---------------- */

    return {
      setSelected: setSelected,
      getSelected: function () { return selectedZ; },
      focus: function (options) {
        if (destroyed) return;
        var it = byZ[selectedZ] || byZ[currentZ] || first;
        focusItem(it, options);
      },
      destroy: function () {
        if (destroyed) return;
        hoverZ = null; focusZ = null;
        refreshHint();
        destroyed = true;
        wrap.removeEventListener('click', onClick);
        wrap.removeEventListener('keydown', onKeyDown);
        wrap.removeEventListener('focusin', onFocusIn);
        wrap.removeEventListener('focusout', onFocusOut);
        wrap.removeEventListener('mouseover', onMouseOver);
        wrap.removeEventListener('mouseleave', onMouseLeave);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      }
    };
  }

  return { mount: mount };
});
