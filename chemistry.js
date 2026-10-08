/*
 * chemistry.js - OrbitalChem
 * Pure data + rules for the orbital visualiser (subshells 1s..5p, Z = 1..54).
 * No DOM, no Three.js.  Works as a browser global (window.OrbitalChem) and in node.
 *
 * ---------------------------------------------------------------------------
 * ml LABELLING CONVENTION (important, chemically subtle)
 * ---------------------------------------------------------------------------
 * The true eigenfunctions of Lz carry complex phase factors exp(i*ml*phi). The
 * familiar shapes (px, py, dxy ...) are REAL combinations of the +ml and -ml
 * functions, e.g. px ~ (Y(1,-1) - Y(1,+1)), py ~ i(Y(1,-1) + Y(1,+1)).  So px and
 * py are NOT individually "ml = +1" or "ml = -1" states; each is an equal mixture
 * of both.  The ml tag on a box is therefore only a labelling convention that
 * keeps the count of orbitals per subshell equal to 2l+1.  The convention used:
 *   cosine-type (phi) functions get +|ml|, sine-type get -|ml|:
 *     p:  pz = 0,  px = +1,  py = -1
 *     d:  dz2 = 0, dxz = +1, dyz = -1, dx2-y2 = +2, dxy = -2
 * (Textbooks differ; the set of ml values per subshell is what is physical.)
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrbitalChem = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_ELECTRONS = 54;
  var SHELLS = [1, 2, 3, 4, 5];
  var LETTERS = ['s', 'p', 'd', 'f'];
  var SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  var MINUS = '−';

  function sup(n) {
    return String(n).split('').map(function (c) { return SUP.charAt(+c); }).join('');
  }
  function signed(m) { return m > 0 ? '+' + m : (m < 0 ? MINUS + (-m) : '0'); }

  /* ---------------- subshells & orbitals ---------------- */

  var defs = [[1,0],[2,0],[2,1],[3,0],[3,1],[3,2],[4,0],[4,1],[4,2],[5,0],[5,1]];
  // Madelung: lower n+l first; ties -> lower n.
  defs.sort(function (a, b) { return (a[0] + a[1]) - (b[0] + b[1]) || a[0] - b[0]; });

  // [id suffix, ml (convention above), pretty suffix]
  var TEMPLATES = {
    0: [['', 0, '']],
    1: [['x', 1, 'x'], ['y', -1, 'y'], ['z', 0, 'z']],
    2: [['z2', 0, 'z²'], ['xz', 1, 'xz'], ['yz', -1, 'yz'],
        ['x2-y2', 2, 'x²' + MINUS + 'y²'], ['xy', -2, 'xy']]
  };

  var SUBSHELLS = [];
  var ORBITALS = [];
  defs.forEach(function (d, rank) {
    var n = d[0], l = d[1], letter = LETTERS[l];
    var sid = n + letter;
    var sub = { id: sid, n: n, l: l, letter: letter, capacity: 2 * (2 * l + 1), orbitalIds: [], rank: rank };
    TEMPLATES[l].forEach(function (t) {
      var oid = sid + t[0];
      sub.orbitalIds.push(oid);
      ORBITALS.push({
        id: oid, subshellId: sid, n: n, l: l, ml: t[1],
        label: sid + t[2], shortLabel: letter + t[2]
      });
    });
    SUBSHELLS.push(sub);
  });

  var subById = {}, orbById = {};
  SUBSHELLS.forEach(function (s) { subById[s.id] = s; });
  ORBITALS.forEach(function (o) { orbById[o.id] = o; });
  function getSubshell(id) { return subById[id] || null; }
  function getOrbital(id) { return orbById[id] || null; }

  /* ---------------- elements ---------------- */

  var NAMES = ('H Hydrogen,He Helium,Li Lithium,Be Beryllium,B Boron,C Carbon,N Nitrogen,O Oxygen,F Fluorine,' +
    'Ne Neon,Na Sodium,Mg Magnesium,Al Aluminium,Si Silicon,P Phosphorus,S Sulfur,Cl Chlorine,Ar Argon,' +
    'K Potassium,Ca Calcium,Sc Scandium,Ti Titanium,V Vanadium,Cr Chromium,Mn Manganese,Fe Iron,Co Cobalt,' +
    'Ni Nickel,Cu Copper,Zn Zinc,Ga Gallium,Ge Germanium,As Arsenic,Se Selenium,Br Bromine,Kr Krypton,' +
    'Rb Rubidium,Sr Strontium,Y Yttrium,Zr Zirconium,Nb Niobium,Mo Molybdenum,Tc Technetium,Ru Ruthenium,' +
    'Rh Rhodium,Pd Palladium,Ag Silver,Cd Cadmium,In Indium,Sn Tin,Sb Antimony,Te Tellurium,I Iodine,Xe Xenon')
    .split(',');
  var ELEMENTS = NAMES.map(function (s, i) {
    var p = s.split(' ');
    return { Z: i + 1, symbol: p[0], name: p[1] };
  });
  function elementOf(Z) { return ELEMENTS[Z - 1] || null; }

  /* ---------------- configurations ---------------- */

  function madelungCounts(Z) {
    var counts = {}, left = Z;
    SUBSHELLS.forEach(function (s) {
      var k = Math.min(s.capacity, left);
      counts[s.id] = k; left -= k;
    });
    return counts;
  }

  // Honest wording: these are measured (spectroscopic) ground states.  "Half/full shell
  // stability" is a rule of thumb about exchange energy and repulsion, not a law.
  var ANOMALY_DEFS = {
    24: { set: { '4s': 1, '3d': 5 },
      reason: 'Observed ground state. The 4s and 3d energies are very close, and moving one electron into 3d gives a half-filled 3d subshell (five parallel spins), which lowers the total electron-electron repulsion/exchange balance enough to win. "Half-filled is stable" is a useful rule of thumb, not an exact law.' },
    29: { set: { '4s': 1, '3d': 10 },
      reason: 'Observed ground state. With 4s and 3d so close in energy, a completely filled 3d subshell (3d¹⁰) plus one 4s electron has lower total energy than 4s² 3d⁹. A full subshell is a helpful rule of thumb here, but the real cause is the detailed balance of repulsion and orbital energies.' },
    41: { set: { '5s': 1, '4d': 4 },
      reason: 'Measured result. In the 4d series the 5s and 4d energies are very close, so one 5s electron moves to 4d. There is no neat half-full or full subshell to point to, so this one is best learned as an empirical exception.' },
    42: { set: { '5s': 1, '4d': 5 },
      reason: 'Observed ground state. Same pattern as chromium: the 5s and 4d energies are close, and 5s¹ 4d⁵ gives a half-filled 4d subshell. "Half-filled is stable" is a rule of thumb, not an exact explanation.' },
    44: { set: { '5s': 1, '4d': 7 },
      reason: 'Measured result. The small 5s/4d energy gap lets one electron move into 4d. It does not give a half-filled or full subshell, so it is an empirical exception rather than something a simple rule predicts.' },
    45: { set: { '5s': 1, '4d': 8 },
      reason: 'Measured result. The small 5s/4d energy gap lets one electron move into 4d. No half-filled or full subshell is reached, so this is an empirical exception that simple rules do not predict.' },
    46: { set: { '5s': 0, '4d': 10 },
      reason: 'Measured result: palladium is the only atom in this range with no outer s electron. A full 4d¹⁰ subshell is lower in energy than 5s² 4d⁸, but that is the experimental finding, not something "full shells are stable" proves by itself.' },
    47: { set: { '5s': 1, '4d': 10 },
      reason: 'Observed ground state. As with copper, a full 4d¹⁰ subshell plus one 5s electron has lower total energy than 5s² 4d⁹. Full subshells are a helpful rule of thumb, not a complete explanation.' }
  };

  function configCounts(Z) {
    Z = Math.round(Z);
    if (!(Z >= 1 && Z <= MAX_ELECTRONS)) throw new RangeError('Z must be 1..54');
    var c = madelungCounts(Z);
    var a = ANOMALY_DEFS[Z];
    if (a) Object.keys(a.set).forEach(function (k) { c[k] = a.set[k]; });
    return c;
  }

  var CORES = [ // largest first
    { Z: 36, symbol: 'Kr', ids: ['1s','2s','2p','3s','3p','4s','3d','4p'] },
    { Z: 18, symbol: 'Ar', ids: ['1s','2s','2p','3s','3p'] },
    { Z: 10, symbol: 'Ne', ids: ['1s','2s','2p'] },
    { Z: 2,  symbol: 'He', ids: ['1s'] }
  ];

  function sumCounts(counts) {
    return SUBSHELLS.reduce(function (t, s) { return t + (counts[s.id] || 0); }, 0);
  }

  // Subshells written in Madelung/Aufbau order (same order as the diagram), e.g. "[Ar] 4s¹ 3d⁵".
  function formatConfig(counts, opts) {
    opts = opts || {};
    var useSup = opts.superscript !== false;
    var total = sumCounts(counts);
    var skip = {}, prefix = '';
    if (opts.shorthand) {
      for (var i = 0; i < CORES.length; i++) {
        var c = CORES[i];
        if (c.Z < total && c.ids.every(function (id) { return counts[id] === subById[id].capacity; })) {
          prefix = '[' + c.symbol + ']';
          c.ids.forEach(function (id) { skip[id] = true; });
          break;
        }
      }
    }
    var parts = [];
    if (prefix) parts.push(prefix);
    SUBSHELLS.forEach(function (s) {
      var k = counts[s.id] || 0;
      if (k > 0 && !skip[s.id]) parts.push(s.id + (useSup ? sup(k) : String(k)));
    });
    return parts.join(' ');
  }

  function emptyOccupancy() {
    var o = {};
    ORBITALS.forEach(function (orb) { o[orb.id] = { up: false, down: false }; });
    return o;
  }

  function cloneOcc(occ) {
    var r = {};
    ORBITALS.forEach(function (orb) {
      var e = occ && occ[orb.id];
      r[orb.id] = { up: !!(e && e.up), down: !!(e && e.down) };
    });
    return r;
  }

  // Hund-style filling: one electron (spin up) in each orbital first, then pair with spin down.
  function countsToOccupancy(counts) {
    var occ = emptyOccupancy();
    SUBSHELLS.forEach(function (s) {
      var k = counts[s.id] || 0, nOrb = s.orbitalIds.length;
      for (var i = 0; i < nOrb && i < k; i++) occ[s.orbitalIds[i]].up = true;
      for (var j = 0; j < k - nOrb; j++) occ[s.orbitalIds[j]].down = true;
    });
    return occ;
  }

  function configOf(Z) { return countsToOccupancy(configCounts(Z)); }

  function anomalyOf(Z) {
    var a = ANOMALY_DEFS[Z];
    if (!a) return null;
    var e = madelungCounts(Z), act = configCounts(Z);
    return {
      Z: Z, symbol: elementOf(Z).symbol,
      expected: formatConfig(e, { shorthand: true, superscript: false }),
      actual: formatConfig(act, { shorthand: true, superscript: false }),
      expectedPretty: formatConfig(e, { shorthand: true }),
      actualPretty: formatConfig(act, { shorthand: true }),
      reason: a.reason
    };
  }

  /* ---------------- occupancy ---------------- */

  function subshellCounts(occ) {
    var o = cloneOcc(occ), c = {};
    SUBSHELLS.forEach(function (s) {
      c[s.id] = s.orbitalIds.reduce(function (t, id) { return t + (o[id].up ? 1 : 0) + (o[id].down ? 1 : 0); }, 0);
    });
    return c;
  }
  function totalElectrons(occ) { return sumCounts(subshellCounts(occ)); }

  // Pauli exclusion is enforced by the data model: an orbital has exactly one "up" and one
  // "down" slot, so two electrons can never share all four quantum numbers.
  function toggleElectron(occ, orbitalId, spin) {
    var orb = getOrbital(orbitalId);
    if (!orb) return { occ: cloneOcc(occ), error: 'Unknown orbital: ' + orbitalId };
    if (spin !== 'up' && spin !== 'down') return { occ: cloneOcc(occ), error: 'Spin must be "up" or "down".' };
    var next = cloneOcc(occ);
    if (next[orbitalId][spin]) { next[orbitalId][spin] = false; return { occ: next, error: null }; }
    if (totalElectrons(next) >= MAX_ELECTRONS) {
      return { occ: next, error: 'This app stops at 54 electrons (xenon, the end of 5p). Remove an electron before adding another.' };
    }
    next[orbitalId][spin] = true;
    return { occ: next, error: null };
  }

  /* ---------------- assessment ---------------- */

  function assess(occ) {
    var o = cloneOcc(occ);
    var counts = subshellCounts(o);
    var total = sumCounts(counts);
    var violations = [], notes = [];

    // Pauli (the data model prevents it; only malformed input can trip this)
    if (occ) {
      Object.keys(occ).forEach(function (k) {
        var e = occ[k];
        if (!orbById[k]) return;
        if (e && ((typeof e.up === 'number' && e.up > 1) || (typeof e.down === 'number' && e.down > 1))) {
          violations.push({ rule: 'pauli', message: 'Pauli exclusion principle: ' + k + ' has two electrons with the same spin. An orbital holds at most two electrons, and they must have opposite spins.' });
        }
      });
    }

    // Hund (within each subshell)
    SUBSHELLS.forEach(function (s) {
      if (s.orbitalIds.length < 2 || counts[s.id] === 0) return;
      var per = s.orbitalIds.map(function (id) { return (o[id].up ? 1 : 0) + (o[id].down ? 1 : 0); });
      if (per.indexOf(2) >= 0 && per.indexOf(0) >= 0) {
        violations.push({ rule: 'hund', message: 'Hund’s rule: in ' + s.id + ', an orbital holds a pair while another ' + s.id + ' orbital is empty. Electrons spread out one per orbital (all with the same spin) before any of them pair up.' });
      } else {
        var hasUp = false, hasDown = false;
        s.orbitalIds.forEach(function (id, i) {
          if (per[i] === 1) { if (o[id].up) hasUp = true; else hasDown = true; }
        });
        if (hasUp && hasDown) {
          violations.push({ rule: 'hund', message: 'Hund’s rule: in ' + s.id + ', the single (unpaired) electrons have opposite spins. In the lowest-energy arrangement, unpaired electrons in the same subshell all have the same spin.' });
        }
      }
    });

    // Match against ground state of the element with Z = total
    var matchesElement = null;
    if (total >= 1 && total <= MAX_ELECTRONS) {
      var gc = configCounts(total);
      if (SUBSHELLS.every(function (s) { return gc[s.id] === counts[s.id]; })) matchesElement = total;
    }
    var anomaly = total >= 1 && total <= MAX_ELECTRONS ? anomalyOf(total) : null;

    // Aufbau (relative to the Madelung order)
    var aufbau = [];
    SUBSHELLS.forEach(function (s, i) {
      if (counts[s.id] === 0) return;
      for (var j = 0; j < i; j++) {
        if (counts[SUBSHELLS[j].id] < SUBSHELLS[j].capacity) { aufbau.push({ hi: s, lo: SUBSHELLS[j] }); return; }
      }
    });
    var excusedByAnomaly = matchesElement !== null && anomaly !== null;
    if (aufbau.length && !excusedByAnomaly) {
      aufbau.forEach(function (p) {
        var msg = 'Aufbau principle: ' + p.hi.id + ' has electrons but ' + p.lo.id + ' (lower in energy) is not full yet. Fill ' + p.lo.id + ' first.';
        if (p.lo.l === 0 && p.hi.l === 2) msg += ' (Neutral atoms follow this order; a few real exceptions exist, and positive ions lose their s electrons first.)';
        violations.push({ rule: 'aufbau', message: msg });
      });
    }
    if (excusedByAnomaly) {
      notes.push('Real exception: ' + elementOf(total).name + ' is ' + anomaly.actual + ', not ' + anomaly.expected + '. ' + anomaly.reason);
    }

    var hasViolation = violations.length > 0;
    var isGroundState = total === 0 ? null : (matchesElement !== null && !hasViolation);

    var groundState = null;
    if (total >= 1 && total <= MAX_ELECTRONS) {
      var el = elementOf(total);
      groundState = { Z: el.Z, symbol: el.symbol, name: el.name,
        shorthand: formatConfig(configCounts(total), { shorthand: true }) };
    }

    var summary;
    if (total === 0) summary = 'No electrons yet. Click an empty half of a box to add one.';
    else if (isGroundState) {
      summary = 'This is the ground state of ' + elementOf(total).name + ' (' + elementOf(total).symbol + ', Z = ' + total + ').';
    } else if (matchesElement !== null) {
      summary = 'Right number of electrons in each subshell for ' + elementOf(total).name + ', but the arrangement inside a subshell is not the lowest-energy one.';
    } else if (hasViolation) {
      summary = 'Not a ground state: ' + violations.length + ' rule problem' + (violations.length > 1 ? 's' : '') + ' found.';
    } else if (groundState) {
      summary = 'Follows the simple filling rules, but the real ground state of ' + groundState.name + ' is different' +
        (anomaly ? ' (' + anomaly.actual + ').' : '.');
      if (anomaly) notes.push(anomaly.reason);
    } else {
      summary = '';
    }

    return {
      total: total,
      matchesElement: matchesElement,
      isGroundState: isGroundState,
      violations: violations,
      notes: notes,
      summary: summary,
      groundState: groundState,
      notation: formatConfig(counts),
      shorthand: formatConfig(counts, { shorthand: true })
    };
  }

  /* ---------------- quantum numbers & selections ---------------- */

  function quantumNumbersFor(orbitalId, spin) {
    var orb = getOrbital(orbitalId);
    if (!orb) return null;
    return { n: orb.n, l: orb.l, ml: orb.ml, ms: spin === 'up' ? 0.5 : (spin === 'down' ? -0.5 : null) };
  }

  function selectionToOrbitals(level, id) {
    if (level === 'orbital') return orbById[id] ? [id] : [];
    if (level === 'subshell') return subById[id] ? subById[id].orbitalIds.slice() : [];
    if (level === 'shell') {
      var n = +id;
      return ORBITALS.filter(function (o) { return o.n === n; }).map(function (o) { return o.id; });
    }
    throw new Error('Unknown selection level: ' + level);
  }

  var RULES = {
    n: 'n (principal quantum number) is a whole number 1, 2, 3, … and labels the shell; higher n means a bigger, higher-energy orbital on average.',
    l: 'l (subshell) can be any whole number from 0 up to n' + MINUS + '1 (l = 0, 1, 2 → s, p, d).',
    ml: 'mₗ can be any whole number from ' + MINUS + 'l to +l, giving 2l + 1 orbitals in a subshell.',
    ms: 'mₛ (spin) is +½ or ' + MINUS + '½, so one orbital holds at most 2 electrons with opposite spins (Pauli exclusion principle).',
    shellCapacity: 'A full shell holds 2n² electrons (n² orbitals × 2 spins).',
    subshellCapacity: 'A full subshell holds 2(2l + 1) electrons.',
    pauli: 'Pauli exclusion: no two electrons in an atom share the same four quantum numbers (n, l, mₗ, mₛ).',
    hund: 'Hund’s rule: orbitals of the same subshell fill one electron each (same spin) before any pair up.',
    aufbau: 'Aufbau/Madelung: fill subshells in order of increasing n + l, and for equal n + l the lower n first.',
    shapeNote: 'Each surface is the angular probability distribution |Y|² (boundary-surface style); the + / − colours show the sign (phase) of the wavefunction Y. Radial nodes are ignored.',
    realOrbitals: 'The drawn orbitals are the REAL combinations (pₓ, p_y, d_xy …). pₓ and p_y are each mixtures of the mₗ = +1 and ' + MINUS + '1 states, so the mₗ tag on a box is a labelling convention (here: pₓ = +1, p_y = ' + MINUS + '1, p_z = 0), not a literal property of that shape.'
  };

  function uniqSorted(arr) {
    return arr.filter(function (v, i) { return arr.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
  }
  function listLetters(ls) { return ls.map(function (l) { return l + ' (' + LETTERS[l] + ')'; }).join(', '); }

  function describeSelection(level, id) {
    var ids = selectionToOrbitals(level, id);
    var orbs = ids.map(getOrbital);
    var ns = uniqSorted(orbs.map(function (o) { return o.n; }));
    var ls = uniqSorted(orbs.map(function (o) { return o.l; }));
    var mls = uniqSorted(orbs.map(function (o) { return o.ml; }));
    var rules = [], title, capacity = orbs.length * 2, fullCapacity = capacity;
    var hasReal = orbs.some(function (o) { return o.l >= 1; });

    if (level === 'shell') {
      var n = +id;
      title = 'Shell n = ' + n;
      fullCapacity = 2 * n * n;
      var allL = []; for (var q = 0; q < n; q++) allL.push(q);
      rules.push('n = ' + n + ' is the shell (principal quantum number). It can be any whole number 1, 2, 3, … and sets the size and the energy scale.');
      rules.push('l runs from 0 to n' + MINUS + '1, so n = ' + n + ' allows l = ' + listLetters(allL) + '.');
      rules.push('For each l, mₗ runs from ' + MINUS + 'l to +l (2l + 1 values): ' +
        ls.map(function (l) { return LETTERS[l] + ' has ' + (2 * l + 1); }).join(', ') + ' orbital' + (orbs.length === 1 ? '' : 's') + ' here, ' + orbs.length + ' in total.');
      rules.push('A full shell holds 2n² = ' + fullCapacity + ' electrons (n² = ' + n * n + ' orbitals × 2 spins); here ' + capacity + ' electrons fit in the orbitals shown.');
      if (ls.length < n) rules.push('Scope note: this app only draws 1s to 5p, so the ' + LETTERS.slice(ls.length, n).join(', ') + ' subshell' + (n - ls.length > 1 ? 's' : '') + ' of n = ' + n + ' (d, f … or higher) are not shown.');
    } else if (level === 'subshell') {
      var sub = getSubshell(id);
      title = 'Subshell ' + sub.id;
      rules.push('n = ' + sub.n + ': this subshell sits in shell ' + sub.n + '.');
      rules.push('l = ' + sub.l + ' (' + sub.letter + ') is allowed because l can be 0 up to n' + MINUS + '1 = ' + (sub.n - 1) + '.');
      rules.push('mₗ runs from ' + MINUS + sub.l + ' to +' + sub.l + ', which is ' + (2 * sub.l + 1) + ' value' + (sub.l ? 's' : '') + ' (' + mls.map(signed).join(', ') + ') → ' + (2 * sub.l + 1) + ' orbital' + (sub.l ? 's' : '') + ' of equal energy.');
      rules.push('A full subshell holds 2(2l + 1) = ' + sub.capacity + ' electrons.');
    } else {
      var orb = orbs[0];
      title = 'Orbital ' + orb.label;
      rules.push('n = ' + orb.n + ' (shell ' + orb.n + ').');
      rules.push('l = ' + orb.l + ' (' + LETTERS[orb.l] + ') is allowed because l can be 0 up to n' + MINUS + '1 = ' + (orb.n - 1) + '.');
      rules.push('mₗ = ' + signed(orb.ml) + ' lies in the allowed range ' + MINUS + orb.l + ' to +' + orb.l + '.');
      rules.push('This orbital holds at most 2 electrons.');
    }
    rules.push(RULES.ms);
    if (hasReal) rules.push(RULES.realOrbitals);

    return {
      title: title, level: level,
      n: ns, l: ls, ml: mls, rules: rules, count: orbs.length,
      orbitals: ids, capacity: capacity, fullCapacity: fullCapacity,
      ms: [0.5, -0.5]
    };
  }

  var ENERGY_NOTE = 'Schematic only: boxes are ordered by energy for a neutral many-electron atom (Madelung order: lower n + l first, ties go to lower n), but the vertical gaps are not to scale. In hydrogen all subshells of one n have the same energy; with several electrons repulsion separates s, p and d. Orbitals in one subshell (same n and l) stay equal in energy. The 4s/3d (and 5s/4d) order is only approximate and reverses in many ions.';

  return {
    SUBSHELLS: SUBSHELLS, ORBITALS: ORBITALS, SHELLS: SHELLS, MAX_ELECTRONS: MAX_ELECTRONS,
    ELEMENTS: ELEMENTS, RULES: RULES, ENERGY_NOTE: ENERGY_NOTE,
    getOrbital: getOrbital, getSubshell: getSubshell,
    emptyOccupancy: emptyOccupancy, configOf: configOf, anomalyOf: anomalyOf,
    toggleElectron: toggleElectron, totalElectrons: totalElectrons, assess: assess,
    quantumNumbersFor: quantumNumbersFor, selectionToOrbitals: selectionToOrbitals,
    describeSelection: describeSelection,
    // additions
    elementOf: elementOf, configCounts: configCounts, subshellCounts: subshellCounts,
    formatConfig: formatConfig, superscript: sup
  };
});
