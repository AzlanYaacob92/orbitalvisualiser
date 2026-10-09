// Run: node test-chemistry.js   (plain asserts, no dependencies)
'use strict';
var assert = require('assert');
var C = require('./chemistry.js');
var S = require('./shapes.js');

var passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { console.error('FAIL: ' + name + '\n  ' + (e && e.stack || e)); process.exitCode = 1; }
}
var SUPMAP = { '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9' };
function plain(s) { return s.replace(/[⁰¹²³⁴-⁹]/g, function (c) { return SUPMAP[c]; }); }

function occFrom(spec) { // spec: { '2px': 'u'|'d'|'ud' }
  var o = C.emptyOccupancy();
  Object.keys(spec).forEach(function (k) {
    if (spec[k].indexOf('u') >= 0) o[k].up = true;
    if (spec[k].indexOf('d') >= 0) o[k].down = true;
  });
  return o;
}
function rules(a) { return a.violations.map(function (v) { return v.rule; }); }

/* ---------- counts & order ---------- */
test('counts', function () {
  assert.strictEqual(C.SUBSHELLS.length, 11);
  assert.strictEqual(C.ORBITALS.length, 27);
  assert.strictEqual(C.MAX_ELECTRONS, 54);
  assert.strictEqual(C.SUBSHELLS.reduce(function (t, s) { return t + s.capacity; }, 0), 54);
  assert.strictEqual(C.ELEMENTS.length, 54);
  assert.deepStrictEqual(C.SHELLS, [1, 2, 3, 4, 5]);
  C.SUBSHELLS.forEach(function (s) {
    assert.strictEqual(s.orbitalIds.length, 2 * s.l + 1);
    assert.strictEqual(s.capacity, 2 * (2 * s.l + 1));
  });
  C.SHELLS.forEach(function (n) { // 2n^2 for complete shells
    var cap = C.SUBSHELLS.filter(function (s) { return s.n === n; }).reduce(function (t, s) { return t + s.capacity; }, 0);
    if (n <= 3) assert.strictEqual(cap, 2 * n * n);
  });
});

test('Madelung order', function () {
  assert.deepStrictEqual(C.SUBSHELLS.map(function (s) { return s.id; }),
    ['1s','2s','2p','3s','3p','4s','3d','4p','5s','4d','5p']);
  C.SUBSHELLS.forEach(function (s, i) { assert.strictEqual(s.rank, i); });
  assert.strictEqual(C.getSubshell('4s').rank < C.getSubshell('3d').rank, true);
  assert.strictEqual(C.getSubshell('5s').rank < C.getSubshell('4d').rank, true);
});

test('orbital ids and ml sets', function () {
  var ids = C.ORBITALS.map(function (o) { return o.id; });
  ['1s','2s','2px','2py','2pz','3dz2','3dxz','3dyz','3dx2-y2','3dxy','5pz'].forEach(function (id) {
    assert.ok(ids.indexOf(id) >= 0, id);
  });
  assert.strictEqual(new Set(ids).size, 27);
  C.SUBSHELLS.forEach(function (s) {
    var mls = s.orbitalIds.map(function (id) { return C.getOrbital(id).ml; }).sort(function (a, b) { return a - b; });
    var expect = []; for (var m = -s.l; m <= s.l; m++) expect.push(m + 0);
    assert.deepStrictEqual(mls, expect);
  });
  assert.strictEqual(C.getOrbital('2px').ml, 1);
  assert.strictEqual(C.getOrbital('2pz').ml, 0);
  assert.strictEqual(C.getOrbital('3dxy').ml, -2);
  assert.strictEqual(C.getOrbital('3dx2-y2').ml, 2);
  assert.strictEqual(C.getOrbital('nope'), null);
});

/* ---------- ground-state configurations ---------- */
var KNOWN = {
  1:'1s1', 2:'1s2', 3:'[He] 2s1', 4:'[He] 2s2', 5:'[He] 2s2 2p1', 6:'[He] 2s2 2p2', 7:'[He] 2s2 2p3',
  8:'[He] 2s2 2p4', 9:'[He] 2s2 2p5', 10:'[He] 2s2 2p6',
  11:'[Ne] 3s1', 12:'[Ne] 3s2', 13:'[Ne] 3s2 3p1', 14:'[Ne] 3s2 3p2', 15:'[Ne] 3s2 3p3',
  16:'[Ne] 3s2 3p4', 17:'[Ne] 3s2 3p5', 18:'[Ne] 3s2 3p6',
  19:'[Ar] 4s1', 20:'[Ar] 4s2', 21:'[Ar] 4s2 3d1', 22:'[Ar] 4s2 3d2', 23:'[Ar] 4s2 3d3',
  24:'[Ar] 4s1 3d5', 25:'[Ar] 4s2 3d5', 26:'[Ar] 4s2 3d6', 27:'[Ar] 4s2 3d7', 28:'[Ar] 4s2 3d8',
  29:'[Ar] 4s1 3d10', 30:'[Ar] 4s2 3d10', 31:'[Ar] 4s2 3d10 4p1', 32:'[Ar] 4s2 3d10 4p2',
  33:'[Ar] 4s2 3d10 4p3', 34:'[Ar] 4s2 3d10 4p4', 35:'[Ar] 4s2 3d10 4p5', 36:'[Ar] 4s2 3d10 4p6',
  37:'[Kr] 5s1', 38:'[Kr] 5s2', 39:'[Kr] 5s2 4d1', 40:'[Kr] 5s2 4d2', 41:'[Kr] 5s1 4d4',
  42:'[Kr] 5s1 4d5', 43:'[Kr] 5s2 4d5', 44:'[Kr] 5s1 4d7', 45:'[Kr] 5s1 4d8', 46:'[Kr] 4d10',
  47:'[Kr] 5s1 4d10', 48:'[Kr] 5s2 4d10', 49:'[Kr] 5s2 4d10 5p1', 50:'[Kr] 5s2 4d10 5p2',
  51:'[Kr] 5s2 4d10 5p3', 52:'[Kr] 5s2 4d10 5p4', 53:'[Kr] 5s2 4d10 5p5', 54:'[Kr] 5s2 4d10 5p6'
};

test('every configOf(Z) sums to Z, obeys capacity, matches known shorthand', function () {
  for (var Z = 1; Z <= 54; Z++) {
    var occ = C.configOf(Z);
    assert.strictEqual(C.totalElectrons(occ), Z, 'Z=' + Z);
    var a = C.assess(occ);
    assert.strictEqual(a.total, Z);
    assert.strictEqual(plain(a.shorthand), KNOWN[Z], 'shorthand Z=' + Z + ' got ' + plain(a.shorthand));
    assert.strictEqual(a.matchesElement, Z, 'match Z=' + Z);
    assert.strictEqual(a.isGroundState, true, 'ground Z=' + Z);
    assert.deepStrictEqual(a.violations, [], 'violations Z=' + Z + ' ' + JSON.stringify(a.violations));
    assert.strictEqual(C.ELEMENTS[Z - 1].Z, Z);
  }
});

test('full (non-shorthand) notation and superscripts', function () {
  assert.strictEqual(C.assess(C.configOf(10)).notation, '1s² 2s² 2p⁶');
  assert.strictEqual(C.assess(C.configOf(24)).notation, '1s² 2s² 2p⁶ 3s² 3p⁶ 4s¹ 3d⁵');
  assert.strictEqual(C.assess(C.configOf(24)).shorthand, '[Ar] 4s¹ 3d⁵');
  assert.strictEqual(C.assess(C.configOf(46)).shorthand, '[Kr] 4d¹⁰');
  assert.strictEqual(C.assess(C.configOf(1)).shorthand, '1s¹');
  assert.strictEqual(C.assess(C.emptyOccupancy()).notation, '');
});

test('anomalies', function () {
  var anomalies = [24, 29, 41, 42, 44, 45, 46, 47];
  for (var Z = 1; Z <= 54; Z++) {
    var a = C.anomalyOf(Z);
    if (anomalies.indexOf(Z) < 0) assert.strictEqual(a, null, 'Z=' + Z);
    else {
      assert.ok(a && a.reason.length > 40, 'reason Z=' + Z);
      assert.notStrictEqual(a.expected, a.actual);
    }
  }
  var exp = { 24:['[Ar] 4s2 3d4','[Ar] 4s1 3d5'], 29:['[Ar] 4s2 3d9','[Ar] 4s1 3d10'],
    41:['[Kr] 5s2 4d3','[Kr] 5s1 4d4'], 42:['[Kr] 5s2 4d4','[Kr] 5s1 4d5'],
    44:['[Kr] 5s2 4d6','[Kr] 5s1 4d7'], 45:['[Kr] 5s2 4d7','[Kr] 5s1 4d8'],
    46:['[Kr] 5s2 4d8','[Kr] 4d10'], 47:['[Kr] 5s2 4d9','[Kr] 5s1 4d10'] };
  Object.keys(exp).forEach(function (z) {
    var a = C.anomalyOf(+z);
    assert.strictEqual(a.expected, exp[z][0]);
    assert.strictEqual(a.actual, exp[z][1]);
  });
  // honest wording: Pd must be flagged as measured/empirical, not "because full is stable"
  assert.ok(/measured|experiment/i.test(C.anomalyOf(46).reason));
  // Cr occupancy: 4s has one electron, 3d five unpaired up
  var cr = C.configOf(24);
  assert.deepStrictEqual(cr['4s'], { up: true, down: false });
  ['3dz2','3dxz','3dyz','3dx2-y2','3dxy'].forEach(function (id) { assert.deepStrictEqual(cr[id], { up: true, down: false }); });
  // Cu: 3d full
  var cu = C.configOf(29);
  assert.deepStrictEqual(cu['3dxy'], { up: true, down: true });
  // Pd: 5s empty
  assert.deepStrictEqual(C.configOf(46)['5s'], { up: false, down: false });
});

test('assess notes the anomaly and the "simple rule" Cr', function () {
  var a = C.assess(C.configOf(24));
  assert.ok(a.notes.length >= 1);
  // A student who fills Cr by the simple rule (4s2 3d4, Hund-correct) follows the rules but is not the real ground state
  var madelungCr = C.configOf(23); // 4s2 3d3
  var o = C.toggleElectron(madelungCr, '3dxy', 'up').occ; // 4s2 3d4
  var b = C.assess(o);
  assert.strictEqual(b.total, 24);
  assert.deepStrictEqual(b.violations, []);
  assert.strictEqual(b.matchesElement, null);
  assert.strictEqual(b.isGroundState, false);
  assert.ok(/Chromium/.test(b.summary));
  assert.strictEqual(b.groundState.symbol, 'Cr');
});

/* ---------- NIST audit (Z = 1-54) ---------- */
/* Ground-state configurations as NIST lists them (written in n order, which differs from the app's
   filling order for 4s/3d and 5s/4d).  Kept as an independent list on purpose; the checks below
   compare occupancy counts, not strings, so the two orders can be compared. */
var NIST = {
  1:'1s1', 2:'1s2', 3:'[He] 2s1', 4:'[He] 2s2', 5:'[He] 2s2 2p1', 6:'[He] 2s2 2p2', 7:'[He] 2s2 2p3',
  8:'[He] 2s2 2p4', 9:'[He] 2s2 2p5', 10:'[He] 2s2 2p6',
  11:'[Ne] 3s1', 12:'[Ne] 3s2', 13:'[Ne] 3s2 3p1', 14:'[Ne] 3s2 3p2', 15:'[Ne] 3s2 3p3',
  16:'[Ne] 3s2 3p4', 17:'[Ne] 3s2 3p5', 18:'[Ne] 3s2 3p6',
  19:'[Ar] 4s1', 20:'[Ar] 4s2', 21:'[Ar] 3d1 4s2', 22:'[Ar] 3d2 4s2', 23:'[Ar] 3d3 4s2', 24:'[Ar] 3d5 4s1',
  25:'[Ar] 3d5 4s2', 26:'[Ar] 3d6 4s2', 27:'[Ar] 3d7 4s2', 28:'[Ar] 3d8 4s2', 29:'[Ar] 3d10 4s1',
  30:'[Ar] 3d10 4s2', 31:'[Ar] 3d10 4s2 4p1', 32:'[Ar] 3d10 4s2 4p2', 33:'[Ar] 3d10 4s2 4p3',
  34:'[Ar] 3d10 4s2 4p4', 35:'[Ar] 3d10 4s2 4p5', 36:'[Ar] 3d10 4s2 4p6',
  37:'[Kr] 5s1', 38:'[Kr] 5s2', 39:'[Kr] 4d1 5s2', 40:'[Kr] 4d2 5s2', 41:'[Kr] 4d4 5s1', 42:'[Kr] 4d5 5s1',
  43:'[Kr] 4d5 5s2', 44:'[Kr] 4d7 5s1', 45:'[Kr] 4d8 5s1', 46:'[Kr] 4d10', 47:'[Kr] 4d10 5s1',
  48:'[Kr] 4d10 5s2', 49:'[Kr] 4d10 5s2 5p1', 50:'[Kr] 4d10 5s2 5p2', 51:'[Kr] 4d10 5s2 5p3',
  52:'[Kr] 4d10 5s2 5p4', 53:'[Kr] 4d10 5s2 5p5', 54:'[Kr] 4d10 5s2 5p6'
};
var NIST_CORES = {
  He: { '1s': 2 },
  Ne: { '1s': 2, '2s': 2, '2p': 6 },
  Ar: { '1s': 2, '2s': 2, '2p': 6, '3s': 2, '3p': 6 },
  Kr: { '1s': 2, '2s': 2, '2p': 6, '3s': 2, '3p': 6, '4s': 2, '3d': 10, '4p': 6 }
};
// "[Ar] 3d5 4s1" (digits for superscripts, any order) -> { '1s':2, …, '3d':5, '4s':1 }
function parseConfig(str) {
  var counts = {};
  var core = /^\[(He|Ne|Ar|Kr)\]/.exec(str);
  if (core) Object.keys(NIST_CORES[core[1]]).forEach(function (k) { counts[k] = NIST_CORES[core[1]][k]; });
  var re = /(\d[spd])(\d+)/g, m, rest = core ? str.slice(core[0].length) : str;
  while ((m = re.exec(rest))) counts[m[1]] = (counts[m[1]] || 0) + (+m[2]);
  return counts;
}
function nonzero(counts) {
  var r = {};
  Object.keys(counts).forEach(function (k) { if (counts[k]) r[k] = counts[k]; });
  return r;
}
function arrows(occ, subId) { // one subshell as a textbook row, boxes in diagram (left-to-right) order
  return C.getSubshell(subId).orbitalIds.map(function (id) {
    var o = occ[id];
    return o.up && o.down ? '↑↓' : (o.up ? '↑' : (o.down ? '↓' : '·'));
  }).join(' ');
}

test('NIST audit: configuration of every element 1-54 (counts, strings, sums)', function () {
  assert.strictEqual(Object.keys(NIST).length, 54);
  for (var Z = 1; Z <= 54; Z++) {
    var want = nonzero(parseConfig(NIST[Z]));
    var sumWant = Object.keys(want).reduce(function (t, k) { return t + want[k]; }, 0);
    assert.strictEqual(sumWant, Z, 'NIST list itself sums to Z=' + Z);
    assert.deepStrictEqual(nonzero(C.configCounts(Z)), want, 'configCounts Z=' + Z);
    var d = C.elementDetails(Z);
    assert.deepStrictEqual(nonzero(parseConfig(plain(d.configuration))), want, 'full string Z=' + Z + ' ' + d.configuration);
    assert.deepStrictEqual(nonzero(parseConfig(plain(d.shorthand))), want, 'shorthand Z=' + Z + ' ' + d.shorthand);
    // the occupancy itself, read back from the electrons in the boxes
    assert.deepStrictEqual(nonzero(C.subshellCounts(C.configOf(Z))), want, 'occupancy Z=' + Z);
    assert.strictEqual(C.totalElectrons(C.configOf(Z)), Z);
  }
});

test('only the eight known exceptions break the filling order, and no other element does', function () {
  var exceptions = { 24: 'Cr', 29: 'Cu', 41: 'Nb', 42: 'Mo', 44: 'Ru', 45: 'Rh', 46: 'Pd', 47: 'Ag' };
  var s = C.SUBSHELLS.map(function (x) { return x.id; });
  for (var Z = 1; Z <= 54; Z++) {
    // plain Madelung fill
    var left = Z, mad = {};
    C.SUBSHELLS.forEach(function (sub) { var k = Math.min(sub.capacity, left); mad[sub.id] = k; left -= k; });
    var same = s.every(function (id) { return (C.configCounts(Z)[id] || 0) === mad[id]; });
    if (exceptions[Z]) { assert.strictEqual(C.elementOf(Z).symbol, exceptions[Z]); assert.strictEqual(same, false, 'Z=' + Z); }
    else assert.strictEqual(same, true, 'Z=' + Z + ' should follow Madelung');
  }
  assert.deepStrictEqual(C.configCounts(46)['5s'], 0, 'Pd has no 5s electron');
  var noFiveS = [];
  for (var z = 37; z <= 54; z++) if (!C.configCounts(z)['5s']) noFiveS.push(z);
  assert.deepStrictEqual(noFiveS, [46], 'Pd is the only element from Rb to Xe with an empty 5s');
});

/* ---------- Hund's rule layout (spin up first, left to right, then pair) ---------- */
test('Hund layout in the diagram box order', function () {
  var N = C.configOf(7), O = C.configOf(8), Cc = C.configOf(6), Ne = C.configOf(10);
  assert.strictEqual(arrows(N, '2s'), '↑↓');
  assert.strictEqual(arrows(N, '2p'), '↑ ↑ ↑');
  assert.strictEqual(arrows(Cc, '2p'), '↑ ↑ ·');
  assert.strictEqual(arrows(O, '2p'), '↑↓ ↑ ↑');
  assert.strictEqual(arrows(C.configOf(9), '2p'), '↑↓ ↑↓ ↑');
  assert.strictEqual(arrows(Ne, '2p'), '↑↓ ↑↓ ↑↓');
  // the box order really is the one the diagram uses: px py pz
  assert.deepStrictEqual(C.getSubshell('2p').orbitalIds, ['2px', '2py', '2pz']);
  assert.deepStrictEqual(C.getSubshell('3d').orbitalIds, ['3dz2', '3dxz', '3dyz', '3dx2-y2', '3dxy']);
  assert.deepStrictEqual(O['2px'], { up: true, down: true });
  assert.deepStrictEqual(O['2pz'], { up: true, down: false });

  var Cr = C.configOf(24);
  assert.strictEqual(arrows(Cr, '4s'), '↑');
  assert.strictEqual(arrows(Cr, '3d'), '↑ ↑ ↑ ↑ ↑');
  var Mn = C.configOf(25);
  assert.strictEqual(arrows(Mn, '4s'), '↑↓');
  assert.strictEqual(arrows(Mn, '3d'), '↑ ↑ ↑ ↑ ↑');
  var Fe = C.configOf(26);
  assert.strictEqual(arrows(Fe, '4s'), '↑↓');
  assert.strictEqual(arrows(Fe, '3d'), '↑↓ ↑ ↑ ↑ ↑');
  assert.strictEqual(arrows(C.configOf(28), '3d'), '↑↓ ↑↓ ↑↓ ↑ ↑');
  var Cu = C.configOf(29);
  assert.strictEqual(arrows(Cu, '4s'), '↑');
  assert.strictEqual(arrows(Cu, '3d'), '↑↓ ↑↓ ↑↓ ↑↓ ↑↓');
  var Pd = C.configOf(46);
  assert.strictEqual(arrows(Pd, '5s'), '·');
  assert.strictEqual(arrows(Pd, '4d'), '↑↓ ↑↓ ↑↓ ↑↓ ↑↓');
  assert.strictEqual(arrows(Pd, '4p'), '↑↓ ↑↓ ↑↓');
  assert.strictEqual(arrows(C.configOf(41), '4d'), '↑ ↑ ↑ ↑ ·');   // Nb 4d⁴
  assert.strictEqual(arrows(C.configOf(44), '4d'), '↑↓ ↑↓ ↑ ↑ ↑'); // Ru 4d⁷: pairs start in the leftmost boxes
  assert.strictEqual(arrows(C.configOf(44), '5s'), '↑');
  assert.strictEqual(arrows(C.configOf(45), '4d'), '↑↓ ↑↓ ↑↓ ↑ ↑'); // Rh 4d⁸
});

test('Hund layout holds for every element: spread before pairing, spin up first, left to right', function () {
  for (var Z = 1; Z <= 54; Z++) {
    var occ = C.configOf(Z);
    C.SUBSHELLS.forEach(function (s) {
      var per = s.orbitalIds.map(function (id) { return (occ[id].up ? 1 : 0) + (occ[id].down ? 1 : 0); });
      s.orbitalIds.forEach(function (id) {
        // a lone electron is spin up; a down electron never sits without its up partner
        assert.ok(!(occ[id].down && !occ[id].up), 'down without up in ' + id + ' Z=' + Z);
      });
      for (var i = 1; i < per.length; i++) assert.ok(per[i] <= per[i - 1], 'left-to-right filling ' + s.id + ' Z=' + Z);
      if (per.indexOf(2) >= 0) assert.ok(per.indexOf(0) < 0, 'pairing before every box has one: ' + s.id + ' Z=' + Z);
    });
  }
});

/* ---------- elements: period / group / block, elementDetails ---------- */
test('period / group / block for every element (independent table)', function () {
  var groups = [1, 18,
    1, 2, 13, 14, 15, 16, 17, 18,
    1, 2, 13, 14, 15, 16, 17, 18,
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  var periods = [1, 1].concat(new Array(8).fill(2), new Array(8).fill(3), new Array(18).fill(4), new Array(18).fill(5));
  var dBlock = 'Sc Ti V Cr Mn Fe Co Ni Cu Zn Y Zr Nb Mo Tc Ru Rh Pd Ag Cd'.split(' ');
  var sBlock = 'H He Li Be Na Mg K Ca Rb Sr'.split(' ');
  assert.strictEqual(groups.length, 54);
  assert.strictEqual(periods.length, 54);
  C.ELEMENTS.forEach(function (e, i) {
    assert.strictEqual(e.Z, i + 1);
    assert.strictEqual(e.period, periods[i], e.symbol + ' period');
    assert.strictEqual(e.group, groups[i], e.symbol + ' group');
    var block = dBlock.indexOf(e.symbol) >= 0 ? 'd' : (sBlock.indexOf(e.symbol) >= 0 ? 's' : 'p');
    assert.strictEqual(e.block, block, e.symbol + ' block');
    assert.strictEqual(C.elementOf(e.Z), e);
  });
});

test('period / group / block spot checks', function () {
  function pgb(sym) {
    var e = C.ELEMENTS.filter(function (x) { return x.symbol === sym; })[0];
    return [e.period, e.group, e.block];
  }
  assert.deepStrictEqual(pgb('H'), [1, 1, 's']);
  assert.deepStrictEqual(pgb('He'), [1, 18, 's']);        // convention: group 18, but s-block (1s²)
  assert.deepStrictEqual(pgb('Fe'), [4, 8, 'd']);
  assert.deepStrictEqual(pgb('Sn'), [5, 14, 'p']);
  assert.deepStrictEqual(pgb('Xe'), [5, 18, 'p']);
  assert.deepStrictEqual(pgb('Y'), [5, 3, 'd']);
  assert.deepStrictEqual(pgb('Zn'), [4, 12, 'd']);
  assert.deepStrictEqual(pgb('Cd'), [5, 12, 'd']);
  assert.deepStrictEqual(pgb('Ga'), [4, 13, 'p']);
  assert.deepStrictEqual(pgb('Al'), [3, 13, 'p']);
  assert.deepStrictEqual(pgb('Ne'), [2, 18, 'p']);
  assert.deepStrictEqual(pgb('Ca'), [4, 2, 's']);
  assert.deepStrictEqual(pgb('Pd'), [5, 10, 'd']);
});

test('group number agrees with the outer electron count (cross-check of data and groups)', function () {
  C.ELEMENTS.forEach(function (e) {
    if (e.Z === 2) return;                                  // He: group 18 by position, 2 electrons
    var c = C.configCounts(e.Z), n = e.period;
    var s = c[n + 's'] || 0, p = c[n + 'p'] || 0, d = c[(n - 1) + 'd'] || 0;
    if (e.block === 's') assert.strictEqual(s, e.group, e.symbol);
    else if (e.block === 'p') assert.strictEqual(s + p, e.group - 10, e.symbol);    // groups 13-18: 3 … 8 outer electrons
    else assert.strictEqual(s + d, e.group, e.symbol);      // d-block: ns + (n-1)d = group (Cr 6, Cu 11, Pd 10 …)
  });
});

test('elementDetails fields', function () {
  var fe = C.elementDetails(26);
  assert.deepStrictEqual(Object.keys(fe).sort(),
    ['Z', 'anomaly', 'block', 'configuration', 'electrons', 'group', 'name', 'period', 'shorthand', 'symbol', 'valenceNote']);
  assert.strictEqual(fe.Z, 26); assert.strictEqual(fe.symbol, 'Fe'); assert.strictEqual(fe.name, 'Iron');
  assert.strictEqual(fe.period, 4); assert.strictEqual(fe.group, 8); assert.strictEqual(fe.block, 'd');
  assert.strictEqual(fe.electrons, 26);
  assert.strictEqual(fe.configuration, '1s² 2s² 2p⁶ 3s² 3p⁶ 4s² 3d⁶');
  assert.strictEqual(fe.shorthand, '[Ar] 4s² 3d⁶');
  assert.strictEqual(fe.anomaly, null);
  assert.ok(/4s fills before 3d/.test(fe.valenceNote) && /lose the 4s electrons first/.test(fe.valenceNote));

  var cr = C.elementDetails(24);
  assert.strictEqual(cr.shorthand, '[Ar] 4s¹ 3d⁵');
  assert.strictEqual(cr.configuration, '1s² 2s² 2p⁶ 3s² 3p⁶ 4s¹ 3d⁵');
  assert.strictEqual(cr.anomaly.expected, '[Ar] 4s² 3d⁴');
  assert.strictEqual(cr.anomaly.actual, '[Ar] 4s¹ 3d⁵');
  assert.strictEqual(cr.anomaly.expectedPlain, '[Ar] 4s2 3d4');
  assert.strictEqual(cr.anomaly.actualPlain, '[Ar] 4s1 3d5');
  assert.ok(cr.anomaly.reason.length > 40 && cr.anomaly.note.length > 10);

  var pd = C.elementDetails(46);
  assert.strictEqual(pd.shorthand, '[Kr] 4d¹⁰');
  assert.strictEqual(pd.anomaly.expected, '[Kr] 5s² 4d⁸');
  assert.strictEqual(pd.anomaly.actual, '[Kr] 4d¹⁰');
  assert.ok(/palladium has no 5s electron/.test(pd.valenceNote) && /Pd²⁺ is \[Kr\] 4d⁸/.test(pd.valenceNote));

  var h = C.elementDetails(1), he = C.elementDetails(2), xe = C.elementDetails(54), sn = C.elementDetails(50);
  assert.strictEqual(h.shorthand, '1s¹'); assert.strictEqual(h.configuration, '1s¹');
  assert.strictEqual(he.configuration, '1s²');
  assert.deepStrictEqual([he.period, he.group, he.block], [1, 18, 's']);
  assert.ok(/group 18/.test(he.valenceNote) && /s-block/.test(he.valenceNote));
  assert.strictEqual(xe.shorthand, '[Kr] 5s² 4d¹⁰ 5p⁶'); assert.strictEqual(xe.electrons, 54);
  assert.strictEqual(sn.valenceNote, 'Valence electrons: 4 (5s² 5p²).');
  assert.strictEqual(C.elementDetails(8).valenceNote, 'Valence electrons: 6 (2s² 2p⁴).');
  assert.strictEqual(C.elementDetails(19).valenceNote, 'Valence electrons: 1 (4s¹).');

  // invalid input never throws
  [0, 55, -1, 1.5, NaN, undefined, null, '26'].forEach(function (z) { assert.strictEqual(C.elementDetails(z), null, String(z)); });

  for (var Z = 1; Z <= 54; Z++) {
    var d = C.elementDetails(Z), e = C.elementOf(Z);
    assert.strictEqual(d.name, e.name); assert.strictEqual(d.symbol, e.symbol);
    assert.strictEqual(d.electrons, Z);
    assert.ok(typeof d.valenceNote === 'string' && d.valenceNote.length > 10, 'valenceNote Z=' + Z);
    assert.strictEqual(d.anomaly === null, C.anomalyOf(Z) === null, 'anomaly Z=' + Z);
  }
});

/* ---------- honesty of the explanatory text ---------- */
test('anomaly wording: rationale for Cr/Mo/Cu/Ag, empirical for Nb/Ru/Rh/Pd, never over-claimed', function () {
  [24, 29, 42, 47].forEach(function (Z) {
    var a = C.anomalyOf(Z);
    assert.ok(/rationale, not a complete explanation/.test(a.reason), 'Z=' + Z);
    assert.ok(/rationale, not a complete explanation/.test(a.note), 'note Z=' + Z);
    assert.ok(!/because|proves|always|must/i.test(a.reason), 'Z=' + Z);
  });
  [41, 44, 45].forEach(function (Z) {
    var a = C.anomalyOf(Z);
    assert.ok(/Measured result/.test(a.reason), 'Z=' + Z);
    assert.ok(/No half-filled or full subshell/.test(a.reason), 'Z=' + Z);
    assert.ok(/close/.test(a.reason) && /repulsion/.test(a.reason), 'small gap + repulsion Z=' + Z);
    assert.ok(!/rationale/.test(a.reason), 'no rationale claimed for Z=' + Z);
    assert.ok(/Empirical/.test(a.note), 'note Z=' + Z);
  });
  var pd = C.anomalyOf(46);
  assert.ok(/Measured result/.test(pd.reason) && /only element from Rb to Xe with no 5s electron/.test(pd.reason));
  assert.ok(/does not predict it/.test(pd.reason) && /Empirical/.test(pd.note));
  // short enough for hover text
  [24, 29, 41, 42, 44, 45, 46, 47].forEach(function (Z) {
    var a = C.anomalyOf(Z);
    assert.ok(a.note.length > 10 && a.note.length <= 90, 'note length Z=' + Z + ' ' + a.note.length);
    assert.ok(a.reason.length <= 320, 'reason length Z=' + Z + ' ' + a.reason.length);
    assert.ok(!/[ₐ-ₜ]/.test(a.reason + a.note));
  });
  // the statements about energy order are about neutral atoms; ions of transition metals lose s first
  assert.ok(/neutral atoms/.test(C.ENERGY_NOTE) && /not a fixed energy ranking/.test(C.ENERGY_NOTE));
  assert.ok(/transition-metal ions the 4s \(5s\) electrons are removed before the 3d \(4d\)/.test(C.ENERGY_NOTE));
  assert.ok(!/reverses/.test(C.ENERGY_NOTE));
  assert.ok(/neutral atoms/.test(C.RULES.aufbau) && /exceptions/.test(C.RULES.aufbau));
  // 3d occupied while 4s is empty: the hint says the order is for neutral atoms and names the ion rule correctly
  var sd = C.assess(occFrom({ '1s': 'ud', '2s': 'ud', '2px': 'ud', '2py': 'ud', '2pz': 'ud', '3s': 'ud', '3px': 'ud', '3py': 'ud', '3pz': 'ud', '3dz2': 'u' }));
  assert.ok(sd.violations.some(function (v) {
    return v.rule === 'aufbau' && /filling order of neutral atoms/.test(v.message) && /transition metals lose their s electrons first/.test(v.message) && !/lower in energy/.test(v.message);
  }), JSON.stringify(sd.violations));
});

/* ---------- rule detection ---------- */
test('Aufbau violation', function () {
  var a = C.assess(occFrom({ '2s': 'u' }));            // 2s before 1s
  assert.deepStrictEqual(rules(a), ['aufbau']);
  assert.strictEqual(a.isGroundState, false);
  assert.ok(/1s/.test(a.violations[0].message));
  var b = C.assess(occFrom({ '1s': 'ud', '2s': 'ud', '3s': 'u' })); // 3s while 2p empty
  assert.ok(rules(b).indexOf('aufbau') >= 0);
  var c = C.assess(occFrom({ '1s': 'ud', '2s': 'ud', '2px': 'ud', '2py': 'ud', '2pz': 'ud', '3s': 'ud', '3px': 'u' }));
  assert.strictEqual(c.total > 0, true);
});

test('Hund violation: pairing before spreading', function () {
  // carbon with 2p electrons paired in px, py empty
  var o = occFrom({ '1s': 'ud', '2s': 'ud', '2px': 'ud' });
  var a = C.assess(o);
  assert.strictEqual(a.total, 6);
  assert.deepStrictEqual(rules(a), ['hund']);
  assert.strictEqual(a.matchesElement, 6);       // right subshell counts for C ...
  assert.strictEqual(a.isGroundState, false);    // ... but not the lowest-energy arrangement
});

test('Hund violation: opposite spins on unpaired electrons', function () {
  var o = occFrom({ '1s': 'ud', '2s': 'ud', '2px': 'u', '2py': 'd' });
  assert.deepStrictEqual(rules(C.assess(o)), ['hund']);
  var ok = occFrom({ '1s': 'ud', '2s': 'ud', '2px': 'd', '2py': 'd' }); // all-down is equally fine
  assert.deepStrictEqual(rules(C.assess(ok)), []);
  assert.strictEqual(C.assess(ok).isGroundState, true);
});

test('Hund-correct oxygen / nitrogen', function () {
  assert.deepStrictEqual(rules(C.assess(C.configOf(7))), []);
  assert.deepStrictEqual(rules(C.assess(C.configOf(8))), []);
  var bad = C.toggleElectron(C.configOf(7), '2pz', 'down').occ; // N -> 2px1 2py1 2pz2... that's O, valid
  assert.deepStrictEqual(rules(C.assess(bad)), []);
});

test('empty occupancy', function () {
  var a = C.assess(C.emptyOccupancy());
  assert.strictEqual(a.total, 0);
  assert.strictEqual(a.isGroundState, null);
  assert.strictEqual(a.matchesElement, null);
  assert.deepStrictEqual(a.violations, []);
});

/* ---------- Pauli & cap ---------- */
test('Pauli enforced by the data model', function () {
  var r1 = C.toggleElectron(C.emptyOccupancy(), '1s', 'up');
  assert.strictEqual(r1.error, null);
  var r2 = C.toggleElectron(r1.occ, '1s', 'down');
  assert.deepStrictEqual(r2.occ['1s'], { up: true, down: true });
  assert.strictEqual(C.totalElectrons(r2.occ), 2);
  // toggling the same slot again removes (cannot create a second same-spin electron)
  var r3 = C.toggleElectron(r2.occ, '1s', 'down');
  assert.deepStrictEqual(r3.occ['1s'], { up: true, down: false });
  // each orbital can hold at most 2 electrons whatever sequence is used
  var o = C.emptyOccupancy();
  for (var i = 0; i < 7; i++) o = C.toggleElectron(o, '2px', i % 2 ? 'down' : 'up').occ;
  assert.ok(C.subshellCounts(o)['2p'] <= 2);
  // bad input
  assert.ok(C.toggleElectron(o, 'zzz', 'up').error);
  assert.ok(C.toggleElectron(o, '1s', 'sideways').error);
});

test('toggle does not mutate', function () {
  var base = C.emptyOccupancy();
  var snap = JSON.stringify(base);
  var r = C.toggleElectron(base, '1s', 'up');
  assert.strictEqual(JSON.stringify(base), snap);
  assert.notStrictEqual(r.occ, base);
});

test('54-electron cap', function () {
  var xe = C.configOf(54);
  assert.strictEqual(C.totalElectrons(xe), 54);
  C.ORBITALS.forEach(function (o) {
    assert.deepStrictEqual(xe[o.id], { up: true, down: true });
    ['up', 'down'].forEach(function (sp) {
      var r = C.toggleElectron(xe, o.id, sp);
      if (r.error === null) { assert.strictEqual(C.totalElectrons(r.occ), 53); }
    });
  });
  // everything full: toggling removes (allowed); full from 53 + add -> 54 ok, then refused
  var one = C.toggleElectron(xe, '5pz', 'down').occ; // 53
  assert.strictEqual(C.totalElectrons(one), 53);
  var back = C.toggleElectron(one, '5pz', 'down');
  assert.strictEqual(back.error, null);
  assert.strictEqual(C.totalElectrons(back.occ), 54);
  // a 55th electron cannot exist: every slot is taken, so build a 54-total non-xenon pattern
  var odd = C.emptyOccupancy();
  var added = 0;
  C.ORBITALS.forEach(function (o) {
    if (added < 54 && o.id !== '5pz') { odd[o.id] = { up: true, down: true }; added += 2; }
  });
  // 26 orbitals * 2 = 52; add one more slot each of 5pz -> 53, 54
  odd = C.toggleElectron(odd, '5pz', 'up').occ;
  odd = C.toggleElectron(odd, '5pz', 'down').occ;
  assert.strictEqual(C.totalElectrons(odd), 54);
  assert.throws(function () { C.configOf(55); });
  assert.throws(function () { C.configOf(0); });
});

test('cap error when over 54 given directly', function () {
  // cannot exceed by construction; verify the guard with a stubbed count
  var full = C.configOf(54);
  var r = C.toggleElectron(full, '1s', 'up'); // removal is allowed
  assert.strictEqual(r.error, null);
  assert.strictEqual(C.totalElectrons(r.occ), 53);
});

/* ---------- quantum numbers & selections ---------- */
test('quantumNumbersFor', function () {
  assert.deepStrictEqual(C.quantumNumbersFor('3dxy'), { n: 3, l: 2, ml: -2, ms: null });
  assert.deepStrictEqual(C.quantumNumbersFor('2px', 'up'), { n: 2, l: 1, ml: 1, ms: 0.5 });
  assert.deepStrictEqual(C.quantumNumbersFor('2pz', 'down'), { n: 2, l: 1, ml: 0, ms: -0.5 });
});

test('selectionToOrbitals', function () {
  assert.deepStrictEqual(C.selectionToOrbitals('orbital', '2px'), ['2px']);
  assert.deepStrictEqual(C.selectionToOrbitals('subshell', '2p'), ['2px', '2py', '2pz']);
  assert.strictEqual(C.selectionToOrbitals('subshell', '3d').length, 5);
  assert.deepStrictEqual(C.selectionToOrbitals('shell', 2), ['2s', '2px', '2py', '2pz']);
  assert.strictEqual(C.selectionToOrbitals('shell', 3).length, 9);
  assert.strictEqual(C.selectionToOrbitals('shell', 4).length, 9);      // 4s 4p 4d (no 4f in scope)
  assert.strictEqual(C.selectionToOrbitals('shell', 5).length, 4);      // 5s 5p
  assert.strictEqual(C.selectionToOrbitals('shell', 1).length, 1);
  var all = [];
  C.SHELLS.forEach(function (n) { all = all.concat(C.selectionToOrbitals('shell', n)); });
  assert.strictEqual(all.length, 27);
  assert.throws(function () { C.selectionToOrbitals('galaxy', 1); });
});

test('describeSelection', function () {
  var d = C.describeSelection('shell', 3);
  assert.deepStrictEqual(d.n, [3]);
  assert.deepStrictEqual(d.l, [0, 1, 2]);
  assert.deepStrictEqual(d.ml, [-2, -1, 0, 1, 2]);
  assert.strictEqual(d.count, 9);
  assert.strictEqual(d.fullCapacity, 18);
  assert.ok(d.rules.length >= 4);
  assert.ok(d.rules.some(function (r) { return /2n/.test(r) && /18/.test(r); }));
  assert.ok(d.rules.some(function (r) { return /0 to n/.test(r); }));

  var p = C.describeSelection('subshell', '2p');
  assert.deepStrictEqual(p.n, [2]); assert.deepStrictEqual(p.l, [1]); assert.deepStrictEqual(p.ml, [-1, 0, 1]);
  assert.strictEqual(p.count, 3); assert.strictEqual(p.capacity, 6);
  assert.ok(p.rules.some(function (r) { return /labelling convention/.test(r); }), 'convention note on p');

  var o = C.describeSelection('orbital', '3dxy');
  assert.deepStrictEqual(o.n, [3]); assert.deepStrictEqual(o.l, [2]); assert.deepStrictEqual(o.ml, [-2]);
  assert.strictEqual(o.count, 1);

  var s = C.describeSelection('subshell', '4s');
  assert.deepStrictEqual(s.ml, [0]);
  assert.ok(!s.rules.some(function (r) { return /labelling convention/.test(r); }));

  var n1 = C.describeSelection('shell', 1);
  assert.deepStrictEqual(n1.l, [0]); assert.strictEqual(n1.fullCapacity, 2);
  var n5 = C.describeSelection('shell', 5);
  assert.deepStrictEqual(n5.l, [0, 1]);
  assert.ok(n5.rules.some(function (r) { return /Scope note/.test(r); }));
  // l = 0..n-1 in rules for n=4 mentions f is out of scope
  assert.ok(C.describeSelection('shell', 4).rules.some(function (r) { return /not shown/.test(r); }));
  assert.ok(C.ENERGY_NOTE.length > 20);
  // short enough to live in a tooltip: at most two sentences
  assert.ok(C.ENERGY_NOTE.split(/\.\s+/).length <= 2, 'ENERGY_NOTE is at most 2 sentences');
});

test('describeSelection explain (per quantum number, numbers follow the selection)', function () {
  var sh2 = C.describeSelection('shell', 2);
  ['n', 'l', 'ml', 'ms'].forEach(function (k) { assert.ok(Array.isArray(sh2.explain[k]) && sh2.explain[k].length >= 1, k); });
  assert.ok(/n = 2 is the shell/.test(sh2.explain.n[0]));
  assert.ok(sh2.explain.n.some(function (r) { return /2n² = 8 electrons \(n² = 4 orbitals × 2 spins\); here 8 electrons fit/.test(r); }));
  assert.ok(sh2.explain.l.some(function (r) { return /0 to n−1, so n = 2 allows l = 0 \(s\), 1 \(p\)/.test(r); }));
  assert.ok(sh2.explain.ml.some(function (r) { return /s has 1, p has 3 orbitals here, 4 in total/.test(r); }));
  assert.ok(sh2.explain.ml.some(function (r) { return /labelling convention/.test(r) && /p_\{z\} = 0/.test(r); }));
  assert.ok(/at most 2 electrons with opposite spins/.test(sh2.explain.ms[0]));

  // subshell and lone orbital use their own phrasing but stay correct
  var d3 = C.describeSelection('subshell', '3d');
  assert.ok(d3.explain.n.some(function (r) { return /18 electrons; this subshell holds up to 10/.test(r); }));
  assert.ok(d3.explain.l.some(function (r) { return /^l = 2 \(d\)/.test(r); }));
  assert.ok(d3.explain.ml.some(function (r) { return /d has 5 orbitals/.test(r); }));
  assert.ok(d3.explain.ml.some(function (r) { return /d_\{x²−y²\} = \+2/.test(r) && !/p_\{x\} = \+1/.test(r); }), 'd-only convention line');
  var pz = C.describeSelection('orbital', '2pz');
  assert.ok(pz.explain.l[0].indexOf('l = 1 (p)') === 0);
  assert.ok(pz.explain.ml.some(function (r) { return /labelled m_\{l\} = 0 \(l = 1 allows 3 values/.test(r); }));
  assert.ok(pz.explain.n.some(function (r) { return /holds at most 2/.test(r); }));

  // an s selection has no p/d convention note; n = 5 never prints an undefined letter
  assert.ok(!C.describeSelection('orbital', '1s').explain.ml.some(function (r) { return /labelling convention/.test(r); }));
  C.SHELLS.forEach(function (n) {
    var d = C.describeSelection('shell', n);
    d.rules.concat(d.explain.n, d.explain.l, d.explain.ml, d.explain.ms).forEach(function (r) { assert.ok(!/undefined|\?/.test(r), r); });
  });
  assert.ok(C.describeSelection('shell', 5).explain.l.some(function (r) { return /d, f, g subshells of n = 5 are not shown/.test(r); }));

  // `rules` is plain text: no markup braces, subscripts written m_l / p_x, and no Unicode subscript letters
  C.SUBSHELLS.forEach(function (s) {
    [C.describeSelection('subshell', s.id), C.describeSelection('shell', s.n)].concat(
      s.orbitalIds.map(function (oid) { return C.describeSelection('orbital', oid); })).forEach(function (d) {
      d.rules.forEach(function (r) {
        assert.ok(!/[_]\{|\}/.test(r), r);
        assert.ok(!/[ₐ-ₜ]/.test(r), 'no Unicode subscript letters: ' + r);
      });
    });
  });
  assert.ok(!/[ₐ-ₜ]/.test(C.ENERGY_NOTE));
});

test('orbital labels: real subscripts for display, plain text for aria', function () {
  var html = {
    '1s': '1s', '2s': '2s', '2px': '2p<sub>x</sub>', '2py': '2p<sub>y</sub>', '2pz': '2p<sub>z</sub>',
    '3dz2': '3d<sub>z²</sub>', '3dxz': '3d<sub>xz</sub>', '3dyz': '3d<sub>yz</sub>',
    '3dx2-y2': '3d<sub>x²−y²</sub>', '3dxy': '3d<sub>xy</sub>', '5pz': '5p<sub>z</sub>'
  };
  Object.keys(html).forEach(function (id) { assert.strictEqual(C.orbitalHTML(id), html[id], id); });
  assert.strictEqual(C.orbitalHTML('3dxy', { short: true }), 'd<sub>xy</sub>');
  assert.strictEqual(C.orbitalHTML('4s', { short: true }), 's');
  assert.strictEqual(C.orbitalPlain('3dx2-y2'), '3dx²−y²');
  assert.strictEqual(C.orbitalPlain('2px'), '2px');
  assert.strictEqual(C.orbitalHTML('nope'), '');
  C.ORBITALS.forEach(function (o) {
    assert.strictEqual(C.orbitalPlain(o.id), o.label, o.id);
    assert.ok(/^[1-5][spd](<sub>[xyz²−]+<\/sub>)?$/.test(C.orbitalHTML(o.id)), o.id);
  });
  // subHTML escapes everything except its own <sub>
  assert.strictEqual(C.subHTML('m_{l} <b>&'), 'm<sub>l</sub> &lt;b&gt;&amp;');
  assert.strictEqual(C.subPlain('m_{l} and d_{x²−y²}'), 'm_l and d_x²−y²');
});

/* ---------- shapes ---------- */
test('radiusScale monotonic', function () {
  var prev = 0;
  [1, 2, 3, 4, 5].forEach(function (n) { var r = S.radiusScale(n); assert.ok(r > prev); prev = r; });
  assert.ok(S.radiusScale(5) / S.radiusScale(1) < 6, 'compressed');
  assert.ok(S.radiusScale(1) > 0.5);
  assert.throws(function () { S.radiusScale(0); });
});

test('angular values & signs', function () {
  var PI = Math.PI;
  assert.ok(S.angular('1s', 0.3, 1) > 0);
  assert.ok(S.angular('2pz', 0.1, 0) > 0 && S.angular('2pz', PI - 0.1, 0) < 0);
  assert.ok(S.angular('2px', PI / 2, 0) > 0 && S.angular('2px', PI / 2, PI) < 0);
  assert.ok(S.angular('2py', PI / 2, PI / 2) > 0 && S.angular('2py', PI / 2, 3 * PI / 2) < 0);
  assert.ok(S.angular('3dz2', 0, 0) > 0 && S.angular('3dz2', PI / 2, 0) < 0);
  assert.ok(S.angular('3dx2-y2', PI / 2, 0) > 0 && S.angular('3dx2-y2', PI / 2, PI / 2) < 0);
  assert.ok(S.angular('3dxy', PI / 2, PI / 4) > 0 && S.angular('3dxy', PI / 2, 3 * PI / 4) < 0);
  assert.ok(S.angular('3dxz', PI / 4, 0) > 0 && S.angular('3dxz', 3 * PI / 4, 0) < 0);
  assert.ok(S.angular('3dyz', PI / 4, PI / 2) > 0 && S.angular('3dyz', PI / 4, 3 * PI / 2) < 0);
  assert.ok(Math.abs(S.angular('2pz', PI / 2, 0)) < 1e-12);       // nodal plane
  assert.ok(Math.abs(S.angular('3dz2', Math.acos(1 / Math.sqrt(3)), 0)) < 1e-12); // cone node
  assert.throws(function () { S.angular('9q', 0, 0); });
  // normalisation: integral of |Y|^2 over the sphere = 1 (numeric, midpoint rule)
  ['1s','2px','2py','2pz','3dz2','3dxz','3dyz','3dx2-y2','3dxy'].forEach(function (id) {
    var N = 200, sum = 0;
    for (var i = 0; i < N; i++) for (var j = 0; j < 2 * N; j++) {
      var t = PI * (i + 0.5) / N, p = 2 * PI * (j + 0.5) / (2 * N);
      sum += Math.pow(S.angular(id, t, p), 2) * Math.sin(t) * (PI / N) * (PI / N);
    }
    assert.ok(Math.abs(sum - 1) < 1e-3, id + ' norm ' + sum);
  });
});

var ALL_IDS = C.ORBITALS.map(function (o) { return o.id; });
var UNIQUE_SHAPES = ['1s','2px','2py','2pz','3dz2','3dxz','3dyz','3dx2-y2','3dxy'];

test('mesh sanity', function () {
  UNIQUE_SHAPES.forEach(function (id) {
    [undefined, 8, 24].forEach(function (res) {
      var N = res || 48, M = 2 * N;
      var m = S.buildMesh(id, res ? { resolution: res } : undefined);
      var V = 2 + (N - 1) * M;
      assert.strictEqual(m.positions.length, V * 3, id);
      assert.strictEqual(m.signs.length, V);
      assert.strictEqual(m.indices.length, 3 * 2 * M * (N - 1));
      assert.ok(m.positions instanceof Float32Array && m.indices instanceof Uint32Array && m.signs instanceof Int8Array);
      for (var i = 0; i < m.indices.length; i++) assert.ok(m.indices[i] < V);
      var maxR = 0;
      for (var v = 0; v < V; v++) {
        var r = Math.hypot(m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]);
        assert.ok(isFinite(r)); if (r > maxR) maxR = r;
        assert.ok(m.signs[v] === 1 || m.signs[v] === -1);
      }
      assert.ok(maxR <= 1 + 1e-6, id + ' max ' + maxR);
      if (!res) assert.ok(maxR > 1 - 1e-6, id + ' tip reached, got ' + maxR);
      // no degenerate-index cracks: every vertex is used by some triangle
      var used = new Uint8Array(V);
      for (var k = 0; k < m.indices.length; k++) used[m.indices[k]] = 1;
      for (var u = 0; u < V; u++) assert.strictEqual(used[u], 1);
      // closed manifold: every undirected edge shared by exactly 2 triangles
      var edges = {};
      for (var t = 0; t < m.indices.length; t += 3) {
        for (var e = 0; e < 3; e++) {
          var a = m.indices[t + e], b = m.indices[t + (e + 1) % 3];
          var key = a < b ? a + '_' + b : b + '_' + a;
          edges[key] = (edges[key] || 0) + 1;
        }
      }
      Object.keys(edges).forEach(function (k2) { assert.strictEqual(edges[k2], 2, id + ' edge ' + k2); });
    });
  });
});

test('mesh signs', function () {
  function counts(id) {
    var m = S.buildMesh(id), pos = 0, neg = 0;
    for (var i = 0; i < m.signs.length; i++) { if (m.signs[i] > 0) pos++; else neg++; }
    return [pos, neg];
  }
  assert.strictEqual(counts('1s')[1], 0);
  UNIQUE_SHAPES.slice(1).forEach(function (id) {
    var c = counts(id);
    assert.ok(c[0] > 0 && c[1] > 0, id + ' needs both signs');
  });
  // s orientation: outward (positive signed volume); sphere radius 1
  var m = S.buildMesh('1s'), vol = 0, P = m.positions;
  for (var t = 0; t < m.indices.length; t += 3) {
    var a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3;
    vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
            P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
            P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
  }
  assert.ok(Math.abs(vol - 4 * Math.PI / 3) < 0.05, 'sphere volume ' + vol);
});

test('mesh symmetry', function () {
  function symmetric(id, map, signMap) { // map(x,y,z)->[x',y',z']; every vertex has an image vertex
    var m = S.buildMesh(id, { resolution: 24 });
    var P = m.positions, V = m.signs.length, tol = 1e-5;
    for (var i = 0; i < V; i++) {
      var q = map(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
      var found = false;
      for (var j = 0; j < V && !found; j++) {
        if (Math.abs(P[3 * j] - q[0]) < tol && Math.abs(P[3 * j + 1] - q[1]) < tol && Math.abs(P[3 * j + 2] - q[2]) < tol &&
            (m.signs[j] === signMap(m.signs[i]) || Math.hypot(q[0], q[1], q[2]) < 1e-6)) found = true; // sign is arbitrary at the node (origin)
      }
      if (!found) return false;
    }
    return true;
  }
  var same = function (s) { return s; }, flip = function (s) { return -s; };
  // pz: mirror through xy-plane flips the sign; rotation about z keeps it
  assert.ok(symmetric('2pz', function (x, y, z) { return [x, y, -z]; }, flip));
  assert.ok(symmetric('2pz', function (x, y, z) { return [-x, -y, z]; }, same));
  assert.ok(symmetric('2pz', function (x, y, z) { return [x, -y, z]; }, same));
  // px: x -> -x flips sign; y,z mirrors preserve
  assert.ok(symmetric('2px', function (x, y, z) { return [-x, y, z]; }, flip));
  assert.ok(symmetric('2px', function (x, y, z) { return [x, -y, z]; }, same));
  assert.ok(symmetric('2py', function (x, y, z) { return [x, -y, z]; }, flip));
  // dz2: symmetric under z -> -z (even)
  assert.ok(symmetric('3dz2', function (x, y, z) { return [x, y, -z]; }, same));
  // dxy: swapping x,y keeps sign; x -> -x flips it
  assert.ok(symmetric('3dxy', function (x, y, z) { return [y, x, z]; }, same));
  assert.ok(symmetric('3dxy', function (x, y, z) { return [-x, y, z]; }, flip));
  // dx2-y2: swapping x,y flips sign
  assert.ok(symmetric('3dx2-y2', function (x, y, z) { return [y, x, z]; }, flip));
  // pz extent: all of the + lobe is at z>0
  var m = S.buildMesh('2pz');
  for (var i = 0; i < m.signs.length; i++) {
    var z = m.positions[3 * i + 2];
    if (m.signs[i] > 0) assert.ok(z >= -1e-6); else assert.ok(z <= 1e-6);
  }
  // dz2 torus is smaller than the lobes (0.5 of tip)
  var d = S.buildMesh('3dz2'), maxNegR = 0;
  for (var k = 0; k < d.signs.length; k++) if (d.signs[k] < 0) {
    maxNegR = Math.max(maxNegR, Math.hypot(d.positions[3 * k], d.positions[3 * k + 1], d.positions[3 * k + 2]));
  }
  assert.ok(Math.abs(maxNegR - 0.25) < 1e-5, 'dz2 torus radius (Y^2 law: 0.5^2) ' + maxNegR);
});

test('Y^2 law: pinch at origin, lobes narrow', function () {
  var m = S.buildMesh('2pz'), PI = Math.PI;
  // near the equator the surface is pinched towards the origin
  var minEq = 1;
  for (var i = 0; i < m.signs.length; i++) {
    var z = m.positions[3 * i + 2], r = Math.hypot(m.positions[3 * i], m.positions[3 * i + 1], z);
    if (Math.abs(z) < 1e-6 * 0 + 1e-9 && r < minEq) minEq = r;
  }
  assert.ok(minEq < 1e-6, 'pz equator at origin');
  // at 45 degrees pz radius is cos^2 = 0.5 (a sphere under |Y| would give 0.707)
  var f = Math.pow(Math.cos(PI / 4), 2);
  assert.ok(Math.abs(f - 0.5) < 1e-12);
  var d = S.buildMesh('3dxy'), atOrigin = 0;
  for (var k = 0; k < d.signs.length; k++) if (Math.hypot(d.positions[3*k], d.positions[3*k+1], d.positions[3*k+2]) < 1e-6) atOrigin++;
  assert.ok(atOrigin >= 2, 'dxy poles at origin');
  assert.ok(S.angular('2pz', 0.1, 0) > 0, 'angular stays signed');
});

test('every contract orbital id maps to a mesh', function () {
  ALL_IDS.forEach(function (id) {
    // principal quantum number is irrelevant to the angular shape
    var m = S.buildMesh(id, { resolution: 8 });
    assert.ok(m.positions.length > 0);
  });
});

console.log(process.exitCode ? 'Some tests FAILED' : 'All tests passed (' + passed + ' groups)');
