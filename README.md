# Chemulate Orbitals

Interactive atomic-orbital visualiser for 1s to 5p (27 orbitals, 54 electrons, up to Xe).

- Orbital energy diagram you can slice by orbital, subshell or shell, showing the n, l, mₗ, mₛ that belong to the selection and why.
- Fill orbitals with electrons (Pauli, Hund and Aufbau feedback, 54-electron cap); load any ground state from H to Xe, including the Cr, Cu, Nb, Mo, Ru, Rh, Pd and Ag anomalies.
- 3-D x/y/z viewer: a shell or subshell draws all its orbitals as translucent surfaces so nested orbitals stay visible, and each drawn orbital can be hidden or shown from the legend; a lone orbital, or one picked inside a subshell, is solid with its siblings transparent. Size grows with n.

## Run

No build step. Serve the folder and open `index.html`:

    python -m http.server

Tests for the data layer: `node test-chemistry.js`

## Simplifications (also stated in the app)

- Shapes show the angular probability distribution only; radial nodes are not drawn.
- Real orbitals, not complex ones. mₗ labels on px/py/d orbitals are a labelling convention.
- Energy axis is schematic (many-electron Madelung order, approximate and reversed in ions).
- Size grows as n^0.75, not the true n², so 5p stays on screen.

`CONTRACT.md` records the file/API contract the app was built against.
