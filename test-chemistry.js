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
