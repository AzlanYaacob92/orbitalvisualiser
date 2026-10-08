# Orbital Visualiser — build contract

Static, no-build web app (open `index.html`; no bundler). Folder:
`...\Differentiation Strategy Through Apps\orbitalvisualiser\`

Purpose: let a student SEE how n, l, mₗ, mₛ relate to an orbital's energy
ordering, its shape/size and where an electron sits, using one linked screen.

## Ownership (one agent per file — do not edit another agent's file)

| File | Owner | Role |
|---|---|---|
| `chemistry.js`, `shapes.js`, `test-chemistry.js` | **Chemistry agent** | data, rules, pure math. No DOM, no Three.js. |
| `index.html`, `app.js` | **Logic agent** | UI state, diagram rendering, slicers, filling, 3-D scene |
| `styles.css` | **Style agent** | all visuals; matches existing Chemculate apps |

Both `chemistry.js` and `shapes.js` expose a browser global AND
`module.exports` (so `node test-chemistry.js` works). Script order in
index.html: three.js (r128, vendored as vendor/three.min.js) → chemistry.js → shapes.js → motion.js → app.js.

## Scope (fixed by the brief)

- Orbitals 1s … 5p only: subshells **1s 2s 2p 3s 3p 4s 3d 4p 5s 4d 5p** (11 subshells,
  27 orbitals, **54 electrons max** = Xe). No f orbitals, no 6s.
- Orbital diagram = boxes. Subshells stacked **vertically by energy** (lowest at bottom).
  Order is the multi-electron (Madelung, n+l then n) order; the vertical spacing is
  schematic and must say so. Same-energy orbitals of a subshell sit side by side.
- Three slicing levels: **orbital**, **subshell**, **shell**. Selecting something shows
  the n, l, mₗ (and mₛ when an electron is chosen) that belong to the selection.
- Students fill orbitals with electrons (spin up/down), cap 54 total.
  Include ground-state anomalies **Cr (4s¹3d⁵), Cu (4s¹3d¹⁰)**, plus the other real ones
  in range: Nb, Mo, Ru, Rh, Pd, Ag.
- 3-D viewer on an x/y/z cartesian frame (z up, labelled axes).
  - subshell selected → every orbital of that subshell drawn **solid**, overlapping at the origin
    (2p → 2pₓ, 2p_y, 2p_z).
  - shell selected → every orbital of that shell, solid.
  - single orbital selected → only that one solid.
  - orbital picked from within a subshell view → the picked orbital solid, its siblings
    **transparent**.
  - size follows n (monotonic increasing; document the scaling used).
  - lobes coloured by wavefunction sign (+/−).
- Honest simplifications to state in the UI: angular shape only (radial nodes of 2s, 3s,
  3p… not drawn); real (not complex) orbitals; energy axis schematic.

## `OrbitalChem` API (chemistry.js)

```
SUBSHELLS   : [{id:'1s', n, l, letter, capacity, orbitalIds:[...], rank}]   // rank 0 = lowest energy, in Aufbau order
ORBITALS    : [{id:'2px', subshellId:'2p', n, l, ml, label, shortLabel}]    // ids: 1s 2s 2px 2py 2pz ... 3dz2 3dxz 3dyz 3dx2-y2 3dxy
SHELLS      : [1,2,3,4,5]
MAX_ELECTRONS = 54
ELEMENTS    : [{Z, symbol, name}]  Z=1..54
getOrbital(id), getSubshell(id)
emptyOccupancy()                     -> { [orbitalId]: {up:false, down:false} }
configOf(Z)                          -> occupancy for the ground state of element Z (anomalies applied)
anomalyOf(Z)                         -> null | {expected:'[Ar] 4s2 3d4', actual:'[Ar] 4s1 3d5', reason:'...'}
toggleElectron(occ, orbitalId, spin) -> {occ: newOcc, error: null|string}   // spin 'up'|'down'; does not mutate; refuses >54
totalElectrons(occ)
assess(occ)                          -> {total, matchesElement: Z|null, isGroundState: bool|null,
                                         violations:[{rule:'aufbau'|'hund'|'pauli', message}],
                                         notation, shorthand}      // notation e.g. "1s² 2s² 2p⁶"
quantumNumbersFor(orbitalId, spin?)  -> {n,l,ml,ms:null|+0.5|-0.5}
selectionToOrbitals(level, id)       -> orbitalId[]            // level: 'orbital'|'subshell'|'shell'; shell id is a number
describeSelection(level, id)         -> {n:[..], l:[..], ml:[..], rules:[strings explaining WHY those values are allowed], count}
ENERGY_NOTE                          -> string shown beside the diagram
```

## `OrbitalShapes` API (shapes.js) — pure math, chemistry coordinates (z = polar axis)

```
radiusScale(n)                       -> number (document the law; must increase with n)
angular(orbitalId, theta, phi)       -> signed real-harmonic value
buildMesh(orbitalId, {resolution})   -> {positions:Float32Array, indices:Uint32Array, signs:Int8Array}
                                        // unit-size surface r=|angular| normalised so max extent = 1; app multiplies by radiusScale(n)
```

## DOM contract (index.html by Logic agent; styles.css by Style agent)

Page chrome — same family as the other Chemculate apps:
`.site-header` (`.eyebrow`, `h1.site-title`), `a.back-link` (portal link), `#theme-toggle.theme-toggle`
(`data-theme` on `<html>`, `localStorage('theme')`), `.site-footer`.

```
main.viz-layout
  section#panel-diagram.card            // left / top
    div.slice-bar
      fieldset#slice-mode               // radios name="slice-mode": orbital | subshell | shell
      .slice-hint                       // one-line instruction
    div#energy-diagram
      div.energy-axis                   // arrow labelled "Energy ↑" + ENERGY_NOTE
      div.subshell-row[data-subshell][data-n][data-l]   // one per subshell, DOM order = high energy first
        button.subshell-label           // "3d" ; click selects at subshell level
        button.shell-tag[data-shell]    // "n=3" ; click selects at shell level
        div.orbital-boxes
          button.orbital-box[data-orbital][data-ml]
            span.electron[data-spin="up|down"]   // arrow glyph, only when occupied
            span.ml-tag                  // mₗ value under the box
      states on rows/boxes: .is-selected  .is-context (sibling/same-shell, shown dimmed)  .is-dimmed  .is-focus (picked orbital in subshell view)
  section#panel-viewer.card
    div#orbital-canvas                  // three.js canvas mount
    div#axis-key                        // x y z legend
    div#viewer-legend                   // list of drawn orbitals w/ colour chips; .legend-item.is-solid / .is-ghost
    button#btn-reset-view
  aside#panel-info.card
    #selection-title
    dl#qn-panel   (#qn-n #qn-l #qn-ml #qn-ms)
    ul#qn-rules                         // WHY-those-values explanations
    #config-panel
      #electron-count                   // "12 / 54"
      #config-notation                  // 1s² 2s² …
      #config-status                    // ground-state / violations / anomaly message (role="status")
      select#element-select             // Z 1..54
      button#btn-load-element
      button#btn-clear
    #simplifications                    // honest-simplifications note
```

Electron interaction: click an empty half of a box adds an electron; clicking an electron
removes it. Keyboard accessible (`button`s, focus ring, aria-pressed/aria-label with n,l,mₗ,mₛ).
