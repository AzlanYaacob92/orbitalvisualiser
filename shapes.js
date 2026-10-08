/*
 * shapes.js - OrbitalShapes
 * Pure math for orbital angular shapes. No Three.js, no DOM. Chemistry coordinates:
 * z is the polar axis (theta measured from +z), phi is measured from +x toward +y.
 *
 * Angular functions are the REAL spherical harmonics (standard normalisation):
 *   s      1/(2 sqrt(pi))
 *   px,py,pz       sqrt(3/4pi) * x, y, z
 *   dz2            sqrt(5/16pi) * (3z^2 - 1)
 *   dxz, dyz       sqrt(15/4pi) * xz, yz
 *   dx2-y2         sqrt(15/16pi) * (x^2 - y^2)
 *   dxy            sqrt(15/4pi) * xy
 * with x = sin(t)cos(p), y = sin(t)sin(p), z = cos(t).  Lobe sign = sign of the value.
 * Only the ANGULAR part is drawn (radial nodes of 2s, 3s, 3p ... are not shown), and the
 * surface is the polar plot of the angular probability distribution r ~ |Y|^2 (boundary-surface style: the familiar dumbbell p and clover d shapes), with radial nodes ignored. angular() itself returns the signed Y.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrbitalShapes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PI = Math.PI;
  var C_S = 1 / (2 * Math.sqrt(PI));
  var C_P = Math.sqrt(3 / (4 * PI));
  var C_D0 = Math.sqrt(5 / (16 * PI));
  var C_D1 = Math.sqrt(15 / (4 * PI));
  var C_D2 = Math.sqrt(15 / (16 * PI));

  // [function(x,y,z), analytic max |value|]
  var TABLE = {
    s:       [function () { return C_S; }, C_S],
    px:      [function (x) { return C_P * x; }, C_P],
    py:      [function (x, y) { return C_P * y; }, C_P],
    pz:      [function (x, y, z) { return C_P * z; }, C_P],
    dz2:     [function (x, y, z) { return C_D0 * (3 * z * z - 1); }, 2 * C_D0],        // at the poles
    dxz:     [function (x, y, z) { return C_D1 * x * z; }, C_D1 / 2],                  // theta=45deg
    dyz:     [function (x, y, z) { return C_D1 * y * z; }, C_D1 / 2],
    'dx2-y2':[function (x, y) { return C_D2 * (x * x - y * y); }, C_D2],               // on the x/y axes
    dxy:     [function (x, y) { return C_D1 * x * y; }, C_D1 / 2]
  };

  // orbital id such as '2px', '3dx2-y2', '1s' -> key into TABLE
  function keyOf(orbitalId) {
    var m = /^[1-9]([spd])(.*)$/.exec(String(orbitalId));
    var k = m && (m[1] === 's' ? (m[2] === '' ? 's' : null) : m[1] + m[2]);
    if (!k || !TABLE[k] || (m[1] === 'p' && k.length !== 2) || (m[1] === 'd' && k.length < 3)) {
      throw new Error('Unknown orbital id: ' + orbitalId);
    }
    return k;
  }

  /*
   * radiusScale(n): display radius multiplier for shell n.
   * Physically <r> for a hydrogen-like orbital grows ~ n^2 (1s : 5p would be roughly 1 : 25
   * and 1s would shrink to a dot). We compress with a power law
   *     radiusScale(n) = n ^ 0.75        -> 1.00, 1.68, 2.28, 2.83, 3.34 for n = 1..5
   * which is strictly increasing, keeps 1s clearly visible next to 5p (ratio ~3.3 instead of 25)
   * and keeps 5p within a modest camera distance. It preserves the ORDER of sizes, not the
   * true ratios.
   */
  function radiusScale(n) {
    if (!(n >= 1)) throw new RangeError('n must be >= 1');
    return Math.pow(n, 0.75);
  }

  function angular(orbitalId, theta, phi) {
    var st = Math.sin(theta);
    return TABLE[keyOf(orbitalId)][0](st * Math.cos(phi), st * Math.sin(phi), Math.cos(theta));
  }

  /*
   * buildMesh(orbitalId, {resolution}) - resolution = number of latitude bands N (default 48,
   * min 4); longitude has 2N segments. Vertices: one at each pole, N-1 rings of 2N vertices.
   * The longitude seam is closed by index wrap-around and each pole is a single shared vertex,
   * so there are no cracks. Triangles wind counter-clockwise seen from outside.
   * r = (|angular| / analytic max |angular|)^2 = |Y|^2 / max|Y|^2, so the largest lobe reaches 1 (exactly 1 whenever the
   * grid contains the lobe tip, e.g. the default resolution; never above 1).
   * signs[i] = +1 / -1 from the sign of Y (phase; the radius uses Y^2) at that vertex (0-value -> +1). Vertices
   * on a nodal surface sit at the origin (r = 0), so + and - lobes meet only at the centre.
   */
  function buildMesh(orbitalId, opts) {
    var entry = TABLE[keyOf(orbitalId)];
    var f = entry[0], fmax = entry[1];
    var N = Math.max(4, Math.floor((opts && opts.resolution) || 48));
    var M = 2 * N;
    var V = 2 + (N - 1) * M;
    var positions = new Float32Array(V * 3);
    var signs = new Int8Array(V);
    var indices = new Uint32Array(3 * (2 * M + 2 * (N - 2) * M));

    function put(vi, theta, phi) {
      var st = Math.sin(theta), x = st * Math.cos(phi), y = st * Math.sin(phi), z = Math.cos(theta);
      if (theta === 0) { x = 0; y = 0; z = 1; } else if (theta === PI) { x = 0; y = 0; z = -1; }
      var v = f(x, y, z);
      var r = Math.abs(v) / fmax; r = r * r;
      if (r > 1) r = 1;
      positions[3 * vi] = r * x; positions[3 * vi + 1] = r * y; positions[3 * vi + 2] = r * z;
      signs[vi] = v < 0 ? -1 : 1;
    }

    put(0, 0, 0);
    for (var i = 1; i < N; i++) {
      for (var j = 0; j < M; j++) put(1 + (i - 1) * M + j, PI * i / N, 2 * PI * j / M);
    }
    put(V - 1, PI, 0);

    function ring(i, j) { return 1 + (i - 1) * M + ((j % M) + M) % M; }
    var t = 0;
    function tri(a, b, c) { indices[t++] = a; indices[t++] = b; indices[t++] = c; }

    for (var j2 = 0; j2 < M; j2++) tri(0, ring(1, j2), ring(1, j2 + 1));
    for (var i2 = 1; i2 < N - 1; i2++) {
      for (var k = 0; k < M; k++) {
        var a = ring(i2, k), b = ring(i2, k + 1), c = ring(i2 + 1, k), d = ring(i2 + 1, k + 1);
        tri(a, c, b); tri(b, c, d);
      }
    }
    for (var j3 = 0; j3 < M; j3++) tri(ring(N - 1, j3), V - 1, ring(N - 1, j3 + 1));

    return { positions: positions, indices: indices, signs: signs };
  }

  return {
    radiusScale: radiusScale, angular: angular, buildMesh: buildMesh,
    // additions
    maxAbs: function (id) { return TABLE[keyOf(id)][1]; }
  };
});
