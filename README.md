# Solid Bench

A basic 3D modeler for parts and small assemblies, with exact mass properties and STL export.

- Live (installable on iPad: Safari → Share → Add to Home Screen): https://bi0medengr.github.io/solid-bench/
- One self-contained HTML file, works offline. Units: mm, g, g/cm³.

## What it does
- Parametric primitives: box, cylinder, tube, sphere, cone/frustum, torus. Edit dimensions, position and rotation numerically or drag them with the move/rotate gizmo (grid snap, 15° rotation snap).
- Orbit/pan/zoom (mouse, trackpad, touch), Iso/Front/Top/Right views, orthographic toggle, edge display, axis triad, hover coordinate readout.
- Measure tool: distance and ΔX/ΔY/ΔZ between two picked points, corners snap.
- Per-part material (15 engineering metals and plastics, or a custom density).
- Mass properties of each part and the assembly: mass, volume, surface area, center of mass, inertia tensor about the center of mass, principal moments, bounding box. "Show the math" walks through every formula with your numbers.
- Import STL (binary or ASCII; watertightness check), export STL (all visible parts or the selected one), save/open model JSON, mass properties CSV, PNG of the view. Undo/redo and autosave.

## Method and validation
Primitive properties are closed form (cone/frustum by stacked disks, integrated exactly with 3-point Gauss–Legendre). Each part is rotated (R·I·Rᵀ, Euler X→Y→Z, the same convention as three.js) and the assembly is combined with the parallel-axis theorem. Imported meshes are integrated triangle by triangle with the divergence theorem (Eberly's polyhedral mass properties).

`node tests/test_core.js` (130 checks): every primitive against textbook formulas; faceted meshes converge to the exact values (<0.2 % at 256 facets) and are watertight; rotation matrices match three.js; the rotated-part pipeline matches direct integration of the transformed mesh; principal moments of a tilted plate equal its box values; every example against a hand calculation; STL round trip and an ASCII unit tetrahedron (V = 1/6).

## Limits
Primitives only: no booleans, fillets, chamfers or sketches yet. Overlapping parts are counted twice. Hidden parts are left out of mass properties and STL export. The bounding box comes from the display mesh. Densities are nominal handbook values.

## Files
- `core.js` — geometry and mass properties (pure, no DOM). `presets.js` — examples. `explain.js` — the math drawer. `app.js` — UI. `page.html` — layout and styles.
- `vendor/` — three.js r128 with OrbitControls and TransformControls (MIT, `vendor/LICENSE`), inlined at build time.
- `build.sh` — inlines everything into `solid-bench.html` (claude.ai artifact) and `docs/` (GitHub Pages web app).
- `tests/test_core.js` — checks against closed-form answers. `tests/browser_test.py` — UI test (light, dark, iPad, phone, clicks, downloads).
- `web/` — manifest, offline service worker, icon. `fonts/` — IBM Plex (SIL OFL, `fonts/OFL.txt`).
