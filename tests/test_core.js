// Checks: every property against a closed-form or hand answer. Run: node tests/test_core.js
const C = require('../core.js'), P = require('../presets.js'), THREE = require('../vendor/three.min.js');
const PI = Math.PI;
let fails = 0;
const near = (a, b, tol, msg) => { const ok = Math.abs(a - b) <= tol; if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + `  got ${(+a).toPrecision(8)} want ${(+b).toPrecision(8)}`); };
const rel = (a, b, r, msg) => near(a, b, Math.abs(b) * r, msg);
const prim = (type, dims) => ({ type, dims });

// ---- exact props vs textbook (Roark / Gere, solids of revolution) ----
{ const p = C.exactProps(prim('box', { w: 40, h: 20, d: 30 })), V = 40 * 20 * 30;
  near(p.V, 24000, 1e-9, 'box volume'); near(p.A, 2 * (800 + 600 + 1200), 1e-9, 'box area');
  near(p.I[0][0], V * (20 ** 2 + 30 ** 2) / 12, 1e-6, 'box Ixx = m(h²+d²)/12'); near(p.I[2][2], V * (40 ** 2 + 20 ** 2) / 12, 1e-6, 'box Izz = m(w²+h²)/12'); }
{ const p = C.exactProps(prim('cylinder', { r: 15, h: 40 })), V = PI * 225 * 40;
  near(p.V, V, 1e-8, 'cylinder volume πr²h'); near(p.I[1][1], V * 225 / 2, 1e-5, 'cylinder axial mr²/2'); near(p.I[0][0], V * (3 * 225 + 1600) / 12, 1e-5, 'cylinder transverse m(3r²+h²)/12'); }
{ const p = C.exactProps(prim('tube', { ro: 15, ri: 10, h: 30 })), V = PI * (225 - 100) * 30;
  near(p.V, V, 1e-8, 'tube volume'); near(p.A, 2 * PI * 125 + 2 * PI * 25 * 30, 1e-8, 'tube area'); near(p.I[1][1], V * (325) / 2, 1e-5, 'tube axial m(ro²+ri²)/2'); }
{ const p = C.exactProps(prim('sphere', { r: 15 })), V = 4 / 3 * PI * 3375;
  near(p.V, V, 1e-8, 'sphere volume 4/3πr³'); near(p.A, 4 * PI * 225, 1e-8, 'sphere area 4πr²'); near(p.I[0][0], 0.4 * V * 225, 1e-5, 'sphere 2/5 mr²'); }
{ // solid cone (r2 = 0): V = πr²h/3, centroid h/4 above the base, Iaxis = 3/10 mr², Itrans(centroid) = 3/80 m(4r²+h²)
  const r = 15, h = 30, p = C.exactProps(prim('cone', { r1: r, r2: 0, h })), V = PI * r * r * h / 3;
  near(p.V, V, 1e-8, 'cone volume πr²h/3'); near(p.c[1], h / 4 - h / 2, 1e-12, 'cone centroid h/4 above base');
  near(p.I[1][1], 0.3 * V * r * r, 1e-5, 'cone axial 3/10 mr²'); near(p.I[0][0], 3 / 80 * V * (4 * r * r + h * h), 1e-5, 'cone transverse 3/80 m(4r²+h²)');
  near(p.A, PI * r * Math.hypot(r, h) + PI * r * r, 1e-8, 'cone area πr·slant + πr²'); }
{ // frustum with r1 = r2 must equal the cylinder; frustum volume πh/3(r1²+r1r2+r2²)
  const a = C.exactProps(prim('cone', { r1: 12, r2: 12, h: 20 })), b = C.exactProps(prim('cylinder', { r: 12, h: 20 }));
  near(a.I[0][0], b.I[0][0], 1e-6, 'frustum r1=r2 → cylinder transverse');
  const f = C.exactProps(prim('cone', { r1: 10, r2: 4, h: 25 }));
  near(f.V, PI * 25 / 3 * (100 + 40 + 16), 1e-8, 'frustum volume');
  near(f.c[1] + 12.5, 25 * (100 + 2 * 40 + 3 * 16) / (4 * (100 + 40 + 16)), 1e-12, 'frustum centroid h(r1²+2r1r2+3r2²)/4(r1²+r1r2+r2²)');
  near(f.I[1][1], 0.3 * f.V * (10 ** 5 - 4 ** 5) / (10 ** 3 - 4 ** 3), 1e-5, 'frustum axial 3m(r1⁵−r2⁵)/10(r1³−r2³)'); }
{ const R = 20, r = 5, p = C.exactProps(prim('torus', { R, r })), V = 2 * PI * PI * R * r * r;
  near(p.V, V, 1e-8, 'torus volume 2π²Rr²'); near(p.A, 4 * PI * PI * R * r, 1e-8, 'torus area 4π²Rr');
  near(p.I[1][1], V * (R * R + 0.75 * r * r), 1e-4, 'torus axial m(R²+3r²/4)'); near(p.I[0][0], V * (R * R / 2 + 5 / 8 * r * r), 1e-4, 'torus diametral m(R²/2+5r²/8)'); }

// ---- mesh integration (divergence theorem) vs exact ----
{ const pr = prim('box', { w: 40, h: 20, d: 30 }), m = C.meshProps(C.partMesh(pr).pos), e = C.exactProps(pr);
  near(m.V, e.V, 1e-8, 'box mesh volume is exact'); near(m.I[0][0], e.I[0][0], 1e-4, 'box mesh Ixx is exact'); near(m.I[0][1], 0, 1e-6, 'box mesh Ixy = 0'); near(m.A, e.A, 1e-8, 'box mesh area'); }
const shapes = [prim('cylinder', { r: 15, h: 40 }), prim('tube', { ro: 15, ri: 10, h: 30 }), prim('sphere', { r: 15 }), prim('cone', { r1: 15, r2: 5, h: 30 }), prim('cone', { r1: 15, r2: 0, h: 30 }), prim('cone', { r1: 0, r2: 8, h: 20 }), prim('torus', { R: 20, r: 5 })];
for (const s of shapes) {
  const e = C.exactProps(s), m = C.meshProps(C.partMesh(s, 256).pos), m2 = C.meshProps(C.partMesh(s, 64).pos), tag = `${s.type} ${JSON.stringify(s.dims)}`;
  rel(m.V, e.V, 2e-3, `${tag} mesh volume (256 seg) within 0.2%`);
  rel(m.I[1][1], e.I[1][1], 3e-3, `${tag} mesh axial inertia within 0.3%`);
  rel(m.I[0][0], e.I[0][0], 3e-3, `${tag} mesh transverse inertia within 0.3%`);
  near(m.c[1], e.c[1], 0.02, `${tag} mesh centroid y`);
  near(Math.abs(m.V - e.V) < Math.abs(m2.V - e.V) ? 1 : 0, 1, 0, `${tag} mesh error shrinks with more facets`);
  near(C.meshCheck(C.partMesh(s, 48).pos).closed ? 1 : 0, 1, 0, `${tag} mesh is watertight`);
}
near(C.meshCheck(C.partMesh(prim('box', { w: 1, h: 1, d: 1 })).pos.slice(9)).open, 3, 0, 'box with one triangle removed → 3 open edges');

// ---- rotation matches three.js (picture and numbers agree) ----
for (const r of [[30, 0, 20], [10, -50, 75], [90, 45, -30]]) {
  const R = C.rotMatrix(r), m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...r.map(t => t * PI / 180), 'XYZ')).elements;
  let err = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) err = Math.max(err, Math.abs(R[i][j] - m[i + 4 * j]));
  near(err, 0, 1e-12, `Euler ${r} matches three.js`);
}

// ---- world transform: R I Rᵀ + parallel axis vs integrating the transformed mesh directly ----
{ const p = { id: 'a', name: 'a', type: 'box', dims: { w: 80, h: 6, d: 40 }, pos: [12, 40, -7], rot: [30, 0, 20], mat: 'custom', rho: 1000, visible: true };
  const info = C.partInfo(p, { parts: [p] }), w = C.meshProps(C.transformPos(C.partMesh(p).pos, C.rotMatrix(p.rot), p.pos));
  for (let i = 0; i < 3; i++) near(info.c[i], w.c[i], 1e-9, `rotated box centroid[${i}]`);
  for (const [i, j] of [[0, 0], [1, 1], [2, 2], [0, 1], [1, 2], [0, 2]]) near(info.I[i][j], w.I[i][j], 1e-3, `rotated box I[${i}][${j}] (ρ=1 g/mm³)`);
  const ev = C.eigSym(info.I).values, V = 80 * 6 * 40;
  const want = [V * (80 ** 2 + 6 ** 2) / 12, V * (6 ** 2 + 40 ** 2) / 12, V * (80 ** 2 + 40 ** 2) / 12].sort((a, b) => a - b);
  for (let i = 0; i < 3; i++) rel(ev[i], want[i], 1e-10, `principal moment ${i} of rotated box = box diagonal`); }

// ---- assembly (examples) vs hand answers ----
{ const s = C.solve(P.list.cube()), m = 2.7e-3 * 1e6;
  near(s.M, m, 1e-9, 'cube: mass 2700 g'); near(s.I[0][0], m * 2 * 1e4 / 12, 1e-3, 'cube: I = m·2a²/12 g·mm²'); near(s.C[1], 50, 1e-12, 'cube: centroid height 50 mm');
  near(s.bbox.size[0], 100, 1e-9, 'cube: bounding box 100 mm'); }
{ const s = C.solve(P.list.dumbbell()), rho = 7.87e-3, mb = rho * PI * 16 * 100, ms = rho * 4 / 3 * PI * 15 ** 3;
  near(s.M, mb + 2 * ms, 1e-9, 'dumbbell: mass');
  // about the vertical axis through the center: bar mL²/12 + mr²/4 term, spheres 2/5mr² + m·65²
  near(s.I[1][1], mb * (3 * 16 + 100 ** 2) / 12 + 2 * (0.4 * ms * 225 + ms * 65 ** 2), 1e-3, 'dumbbell: Iyy parallel axis');
  near(s.I[0][0], mb * 16 / 2 + 2 * 0.4 * ms * 225, 1e-4, 'dumbbell: Ixx along the bar');
  near(s.C[0], 0, 1e-9, 'dumbbell: centroid on center'); near(s.bbox.size[0], 160, 1e-6, 'dumbbell: 160 mm long'); }
{ const s = C.solve(P.list.bushing()), rho = 8.5e-3, m1 = rho * PI * (144 - 25) * 3, m2 = rho * PI * (64 - 25) * 12;
  near(s.M, m1 + m2, 1e-9, 'bushing: mass'); near(s.C[1], (m1 * 1.5 + m2 * 9) / (m1 + m2), 1e-9, 'bushing: centroid height'); }
{ const s = C.solve(P.list.bracket()), m1 = 2.7e-3 * 60 * 5 * 40, m2 = 2.7e-3 * 5 * 40 * 40;
  near(s.C[0], (m2 * -27.5) / (m1 + m2), 1e-9, 'bracket: centroid x'); near(s.C[1], (m1 * 2.5 + m2 * 25) / (m1 + m2), 1e-9, 'bracket: centroid y');
  near(s.bbox.size[1], 45, 1e-9, 'bracket: 45 mm tall'); }
{ const s = C.solve(P.list.pulley()), rho = 1.41e-3, parts = [[8, 4, 20], [30, 8, 5], [35, 30, 14]];
  near(s.M, parts.reduce((a, [o, i, h]) => a + rho * PI * (o * o - i * i) * h, 0), 1e-9, 'pulley: mass');
  near(s.I[1][1], parts.reduce((a, [o, i, h]) => a + rho * PI * (o * o - i * i) * h * (o * o + i * i) / 2, 0), 1e-4, 'pulley: polar inertia'); }
{ const s = C.solve(P.list.shaft()), rho = 7.87e-3, m = [rho * PI * 36 * 20, rho * PI * 64 * 60, rho * PI * 36 * 20];
  near(s.I[0][0], (m[0] + m[2]) * 36 / 2 + m[1] * 64 / 2, 1e-4, 'shaft: polar inertia about X');
  near(s.I[1][1], 2 * (m[0] * (3 * 36 + 400) / 12 + m[0] * 1600) + m[1] * (3 * 64 + 3600) / 12, 1e-3, 'shaft: transverse inertia'); }
{ const s = C.solve(P.list.oring()), mr = 1.85e-3 * 2 * PI * PI * 11.5 * 2.25, msh = 8e-3 * PI * 100 * 60;
  near(s.M, mr + msh, 1e-9, 'O-ring: custom density mass'); }
{ const s = C.solve(P.list.rocket()), mb = 1.2e-3 * PI * 100 * 80, mn = 1.05e-3 * PI * 100 * 30 / 3, mf = 1.24e-3 * 18 * 25 * 1.5;
  near(s.M, mb + mn + 3 * mf, 1e-9, 'rocket: mass'); near(s.C[1], (mb * 40 + mn * (80 + 7.5) + 3 * mf * 12.5) / (mb + mn + 3 * mf), 1e-9, 'rocket: CG height');
  near(Math.hypot(s.C[0], s.C[2]), 0, 1e-9, 'rocket: CG on axis (3 fins at 120°)'); near(s.I[0][0] - s.I[2][2], 0, 1e-6, 'rocket: Ixx = Izz (3-fold symmetry)'); }
{ const s = C.solve(P.list.tilted()); near(s.principal.values[0] > 0 ? 1 : 0, 1, 0, 'tilted plate: principal moments positive'); }
// hidden parts drop out
{ const m = P.list.dumbbell(); m.parts[1].visible = false; m.parts[2].visible = false;
  near(C.solve(m).M, 7.87e-3 * PI * 16 * 100, 1e-9, 'hidden parts excluded from mass'); }
// bad dimensions give a warning, not NaN
{ const m = P.list.bushing(); m.parts[0].dims.ri = 20; const s = C.solve(m);
  near(s.warnings.length, 1, 0, 'tube with ri > ro → plain warning'); near(isFinite(s.M) ? 1 : 0, 1, 0, 'mass stays finite'); }

// ---- STL round trip and ASCII import ----
{ const m = P.list.pulley(), tris = C.worldTriangles(m), buf = C.stlBinary(tris), back = C.parseSTL(buf);
  near(buf.byteLength, 84 + 50 * tris.length / 9, 0, 'binary STL size 84 + 50n');
  rel(C.meshProps(back).V, C.meshProps(tris).V, 1e-6, 'STL round trip keeps volume');
  near(C.meshCheck(back).closed ? 1 : 0, 1, 0, 'exported pulley STL is watertight'); }
{ const tet = `solid t
facet normal 0 0 -1 outer loop vertex 0 0 0 vertex 0 1 0 vertex 1 0 0 endloop endfacet
facet normal 0 -1 0 outer loop vertex 0 0 0 vertex 1 0 0 vertex 0 0 1 endloop endfacet
facet normal -1 0 0 outer loop vertex 0 0 0 vertex 0 0 1 vertex 0 1 0 endloop endfacet
facet normal 1 1 1 outer loop vertex 1 0 0 vertex 0 1 0 vertex 0 0 1 endloop endfacet
endsolid t`;
  const pos = C.parseSTL(new TextEncoder().encode(tet).buffer), mp = C.meshProps(pos);
  near(mp.V, 1 / 6, 1e-12, 'ASCII STL unit tetrahedron volume 1/6'); near(mp.c[0], 0.25, 1e-12, 'tetrahedron centroid 1/4');
  near(mp.I[0][0], 1 / 30 - (1 / 6) * 2 * 0.0625, 1e-12, 'tetrahedron Ixx (∫(y²+z²) = 1/30, shifted)'); }

for (const k of Object.keys(P.list)) { const s = C.solve(P.list[k]()); near(isFinite(s.M) && s.M > 0 && !s.warnings.length ? 1 : 0, 1, 0, `example ${k} solves cleanly (${s.M.toFixed(2)} g)`); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exitCode = fails ? 1 : 0;
