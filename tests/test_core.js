// Checks: every property against a closed-form or hand answer. Run: node tests/test_core.js
const C = require('../core.js'), P = require('../presets.js'), THREE = require('../vendor/three.min.js'), IM = require('../importers.js'), zlib = require('zlib');
const PI = Math.PI;
let fails = 0;
const near = (a, b, tol, msg) => { const ok = Math.abs(a - b) <= tol; if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + `  got ${(+a).toPrecision(8)} want ${(+b).toPrecision(8)}`); };
const rel = (a, b, r, msg) => near(a, b, Math.abs(b) * r, msg);
const prim = (type, dims) => ({ type, dims });
C.setTriangulator((c, hs) => THREE.ShapeUtils.triangulateShape(c.map(p => new THREE.Vector2(p[0], p[1])), hs.map(h => h.map(p => new THREE.Vector2(p[0], p[1])))));
const skp = (type, plane, ents, dims, extra) => Object.assign({ id: 's', name: 's', type, sketch: { plane, offset: 0, ents }, dims, base: [0, 0, 0], pos: [0, 0, 0], rot: [0, 0, 0], mat: 'custom', rho: 1000, visible: true }, extra || {});
const meshAgrees = (p, tag, seg = 192, tol = 3e-3) => {
  const e = C.exactProps(p), m = C.meshProps(C.partMesh(p, seg).pos), ck = C.meshCheck(C.partMesh(p, 48).pos);
  rel(m.V, e.V, tol, `${tag}: mesh volume agrees with exact`);
  for (let i = 0; i < 3; i++) near(m.c[i], e.c[i], 0.02 + 1e-3 * Math.abs(e.c[i]), `${tag}: mesh centroid[${i}]`);
  rel(m.I[0][0] + m.I[1][1] + m.I[2][2], e.I[0][0] + e.I[1][1] + e.I[2][2], tol, `${tag}: mesh inertia trace`);
  near(ck.closed ? 1 : 0, 1, 0, `${tag}: mesh is watertight (${ck.open} open, ${ck.nonManifold} non-manifold)`);
};

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
{ const s = C.solve(P.list.plate()), Ar = 80 * 50 - (4 - PI) * 36 - 4 * PI * 3.25 ** 2 - PI * 121;
  rel(s.M, 2.7e-3 * Ar * 6, 1e-6, 'mounting plate: mass from filleted outline minus five holes'); near(s.C[1], 3, 1e-9, 'mounting plate: centroid at half thickness');
  near(s.C[0], 0, 1e-6, 'mounting plate: symmetric about X'); meshAgrees(P.list.plate().parts[0], 'mounting plate'); }
{ const s = C.solve(P.list.turned()), Vsteps = PI * (100 * 20 + 49 * 40 + 25 * 15);
  rel(s.V, Vsteps, 5e-3, 'turned shaft: volume close to the sharp-cornered steps (fillets change it slightly)');
  near(Math.hypot(s.C[0], s.C[2]), 0, 1e-9, 'turned shaft: centroid on its axis'); meshAgrees(P.list.turned().parts[0], 'turned shaft'); }
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

// ---- sketches: extrude and revolve vs closed forms ----
{ // rectangle on the front plane extruded 30 → a 40 × 20 × 30 box from (5, 2, 0)
  const p = skp('extrude', 'front', [{ kind: 'rect', x: 5, y: 2, w: 40, h: 20 }], { d: 30 }), e = C.exactProps(p), V = 24000;
  near(e.V, V, 1e-6, 'extruded rectangle: volume'); near(e.A, 2 * (800 + 600 + 1200), 1e-6, 'extruded rectangle: area');
  near(e.c[0], 25, 1e-9, 'extruded rectangle: centroid x'); near(e.c[1], 12, 1e-9, 'extruded rectangle: centroid y'); near(e.c[2], 15, 1e-9, 'extruded rectangle: centroid z');
  near(e.I[0][0], V * (20 ** 2 + 30 ** 2) / 12, 1e-3, 'extruded rectangle: Ixx = box'); near(e.I[2][2], V * (40 ** 2 + 20 ** 2) / 12, 1e-3, 'extruded rectangle: Izz = box'); near(e.I[0][1], 0, 1e-3, 'extruded rectangle: Ixy = 0');
  meshAgrees(p, 'extruded rectangle', 48, 1e-9);
  const q = skp('extrude', 'front', [{ kind: 'rect', x: 5, y: 2, w: 40, h: 20 }], { d: -30 });
  near(C.exactProps(q).c[2], -15, 1e-9, 'negative distance extrudes the other way'); meshAgrees(q, 'negative extrude', 48, 1e-9); }
{ // circle on the ground plane extruded up → cylinder about Y
  const r = 15, h = 40, p = skp('extrude', 'ground', [{ kind: 'circle', x: 0, y: 0, r }], { d: h }), e = C.exactProps(p), V = PI * r * r * h;
  rel(e.V, V, 1e-6, 'extruded circle: volume πr²h'); rel(e.A, 2 * PI * r * r + 2 * PI * r * h, 1e-6, 'extruded circle: area');
  near(e.c[1], h / 2, 1e-9, 'extruded circle: centroid at mid-height (Y)');
  rel(e.I[1][1], V * r * r / 2, 1e-6, 'extruded circle: Iyy = mr²/2'); rel(e.I[0][0], V * (3 * r * r + h * h) / 12, 1e-6, 'extruded circle: Ixx = m(3r²+h²)/12');
  meshAgrees(p, 'extruded circle'); }
{ // 60 × 40 plate, 5 thick, with a Ø16 hole 10 mm off center: (plate) − (hole) by parallel axis
  const p = skp('extrude', 'ground', [{ kind: 'rect', x: -30, y: -20, w: 60, h: 40 }, { kind: 'circle', x: 10, y: 0, r: 8 }], { d: 5 }), e = C.exactProps(p);
  const Vp = 60 * 40 * 5, Vh = PI * 64 * 5, V = Vp - Vh, cx = (0 - Vh * 10) / V;
  rel(e.V, V, 1e-6, 'plate with hole: volume'); near(e.c[0], cx, 1e-5, 'plate with hole: centroid shifts away from the hole');
  rel(e.A, 2 * (2400 - PI * 64) + (200 + 2 * PI * 8) * 5, 1e-6, 'plate with hole: area includes the bore');
  const Iyy = Vp * (60 ** 2 + 40 ** 2) / 12 + Vp * cx * cx - (Vh * 64 / 2 + Vh * (10 - cx) ** 2);
  rel(e.I[1][1], Iyy, 1e-6, 'plate with hole: Iyy (plate − hole, parallel axis)');
  meshAgrees(p, 'plate with hole'); }
{ // corner radius 5 on a 40 × 20 rectangle: area 800 − (4 − π)·25, perimeter 120 − 40 + 10π
  const p = skp('extrude', 'front', [{ kind: 'rect', x: 0, y: 0, w: 40, h: 20, rr: 5 }], { d: 10 }), e = C.exactProps(p), Ar = 800 - (4 - PI) * 25;
  rel(e.V, Ar * 10, 1e-6, 'filleted rectangle: volume'); rel(e.A, 2 * Ar + (80 + 10 * PI) * 10, 1e-6, 'filleted rectangle: area');
  meshAgrees(p, 'filleted rectangle');
  const f = skp('extrude', 'front', [{ kind: 'poly', pts: [[0, 0], [20, 0], [20, 20], [0, 20]], f: [0, 0, 6, 0] }], { d: 1 });
  rel(C.exactProps(f).V, 400 - (1 - PI / 4) * 36, 1e-6, 'one filleted corner removes (1 − π/4)r²');
  const full = skp('extrude', 'front', [{ kind: 'rect', x: 0, y: 0, w: 20, h: 20, rr: 10 }], { d: 1 });
  rel(C.exactProps(full).V, PI * 100, 1e-6, 'square with corner radius = half side is a circle'); meshAgrees(full, 'fully rounded square');
  near(C.dimProblem(skp('extrude', 'front', [{ kind: 'rect', x: 0, y: 0, w: 20, h: 10, rr: 6 }], { d: 1 })) ? 1 : 0, 1, 0, 'fillet larger than the side → plain warning'); }
{ // revolve: rectangle 10 ≤ u ≤ 15, 0 ≤ v ≤ 30 about the v axis → tube
  const ri = 10, ro = 15, h = 30, p = skp('revolve', 'front', [{ kind: 'rect', x: ri, y: 0, w: ro - ri, h }], { angle: 360 }), e = C.exactProps(p), V = PI * (ro * ro - ri * ri) * h;
  rel(e.V, V, 1e-9, 'revolved rectangle: tube volume (Pappus)'); rel(e.A, 2 * PI * (ro * ro - ri * ri) + 2 * PI * (ro + ri) * h, 1e-9, 'revolved rectangle: tube area');
  near(e.c[1], h / 2, 1e-9, 'revolved rectangle: centroid height'); near(Math.hypot(e.c[0], e.c[2]), 0, 1e-9, 'revolved rectangle: centroid on axis');
  rel(e.I[1][1], V * (ro * ro + ri * ri) / 2, 1e-9, 'revolved rectangle: axial m(ro²+ri²)/2'); rel(e.I[0][0], V * (3 * (ro * ro + ri * ri) + h * h) / 12, 1e-9, 'revolved rectangle: transverse');
  meshAgrees(p, 'revolved tube');
  // 90° of it: a quarter tube, centroid at 4(ro³−ri³)/(3π(ro²−ri²)) along each in-plane axis
  const q = skp('revolve', 'front', [{ kind: 'rect', x: ri, y: 0, w: ro - ri, h }], { angle: 90 }), eq = C.exactProps(q), xbar = 4 * (ro ** 3 - ri ** 3) / (3 * PI * (ro * ro - ri * ri));
  rel(eq.V, V / 4, 1e-9, 'quarter revolve: volume'); near(eq.c[0], xbar, 1e-9, 'quarter revolve: centroid x'); near(eq.c[2], -xbar, 1e-9, 'quarter revolve: centroid z (turns toward −Z)');
  rel(eq.A, (2 * PI * (ro * ro - ri * ri) + 2 * PI * (ro + ri) * h) / 4 + 2 * (ro - ri) * h, 1e-9, 'quarter revolve: area incl. two caps');
  meshAgrees(q, 'quarter revolve');
  const n = skp('revolve', 'front', [{ kind: 'rect', x: -ro, y: 0, w: ro - ri, h }], { angle: 90 }), en = C.exactProps(n);
  near(en.c[0], -xbar, 1e-9, 'profile left of the axis revolves where it was drawn'); meshAgrees(n, 'left-side quarter revolve');
  const u = skp('revolve', 'front', [{ kind: 'rect', x: 0, y: ri, w: h, h: ro - ri }], { angle: 360 }, { axis: 'u' }), eu = C.exactProps(u);
  rel(eu.I[0][0], V * (ro * ro + ri * ri) / 2, 1e-9, 'revolve about the U axis: tube along world X'); near(eu.c[0], h / 2, 1e-9, 'revolve about U: centroid along X');
  meshAgrees(u, 'revolve about U');
  near(C.dimProblem(skp('revolve', 'front', [{ kind: 'rect', x: -5, y: 0, w: 10, h: 10 }], { angle: 360 })) ? 1 : 0, 1, 0, 'profile across the axis → plain warning'); }
{ // revolve a circle → torus;  revolve a filleted profile about the axis
  const R = 20, r = 5, p = skp('revolve', 'right', [{ kind: 'circle', x: R, y: 10, r }], { angle: 360 }), e = C.exactProps(p), V = 2 * PI * PI * R * r * r;
  rel(e.V, V, 1e-6, 'revolved circle: torus volume'); rel(e.A, 4 * PI * PI * R * r, 1e-6, 'revolved circle: torus area');
  rel(e.I[1][1], V * (R * R + 0.75 * r * r), 1e-6, 'revolved circle on the right plane (V axis = world Y): axial inertia Iyy');
  meshAgrees(p, 'revolved torus');
  const g = skp('revolve', 'ground', [{ kind: 'poly', pts: [[0, 0], [12, 0], [12, 8], [6, 8], [6, 20], [0, 20]], f: [0, 2, 0, 1.5, 0, 0] }], { angle: 360 });
  const ring = skp('revolve', 'front', [{ kind: 'rect', x: 10, y: 0, w: 10, h: 10 }, { kind: 'circle', x: 15, y: 5, r: 2 }], { angle: 270 });
  rel(C.exactProps(ring).V, 1.5 * PI * (15 * 100 - 15 * PI * 4), 1e-6, 'revolved profile with a hole: Pappus with r̄ = 15 for both'); meshAgrees(ring, 'revolve with an internal hole, 270°');
  near(C.dimProblem(g), '', 0, 'stepped turned profile with fillets is valid'); meshAgrees(g, 'turned part with fillets (ground plane)'); }
near(C.dimProblem(skp('extrude', 'front', [{ kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { kind: 'rect', x: 5, y: 5, w: 10, h: 10 }], { d: 1 })) ? 1 : 0, 1, 0, 'crossing loops → plain warning');
// a placed, rotated extrude: R·I·Rᵀ + parallel axis vs integrating the moved mesh directly
{ const p = skp('extrude', 'ground', [{ kind: 'rect', x: -10, y: -5, w: 30, h: 12, rr: 3 }, { kind: 'circle', x: 8, y: 1, r: 2 }], { d: 7 }, { pos: [4, 5, -6], rot: [20, 35, -10] });
  p.base = C.sketchCenter(p); const info = C.partInfo(p, { parts: [p] }), w = C.meshProps(C.transformPos(C.partMesh(p, 256).pos, C.rotMatrix(p.rot), p.pos));
  for (let i = 0; i < 3; i++) near(info.c[i], w.c[i], 0.01, `placed extrude centroid[${i}]`);
  rel(info.I[0][0], w.I[0][0], 2e-3, 'placed extrude Ixx (world)'); near(info.I[0][2], w.I[0][2], 2e-3 * Math.abs(info.I[0][0]), 'placed extrude Ixz (world)'); }

// ---- 3MF / OBJ import ----
function zipOf(files) {   // minimal zip writer: { name: [text, deflate?] }
  const locals = [], cents = []; let off = 0;
  for (const [name, [text, deflate]] of Object.entries(files)) {
    const raw = Buffer.from(text), data = deflate ? zlib.deflateRawSync(raw) : raw, nm = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(deflate ? 8 : 0, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(deflate ? 8 : 0, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, data); cents.push(ch, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(cents), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(cents.length / 2, 8); e.writeUInt16LE(cents.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  const b = Buffer.concat([...locals, cd, e]); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}
const boxXML = (id, name, a, b, c) => {   // a × b × c box with outward triangles, corner at origin (3MF frame, Z up)
  const v = [[0, 0, 0], [a, 0, 0], [a, b, 0], [0, b, 0], [0, 0, c], [a, 0, c], [a, b, c], [0, b, c]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return `<object id="${id}" name="${name}" type="model"><mesh><vertices>${v.map(p => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices><triangles>${f.map(t => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('')}</triangles></mesh></object>`;
};
const imports = (async () => {
  const xml = `<?xml version="1.0"?><model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${boxXML(1, 'Tall block', 1, 2, 3)}${boxXML(2, 'Cube', 1, 1, 1)}
    <object id="3" name="Pair"><components><component objectid="2" transform="1 0 0 0 1 0 0 0 1 5 0 0"/><component objectid="2" transform="1 0 0 0 1 0 0 0 1 0 5 0"/></components></object></resources>
    <build><item objectid="1"/><item objectid="3" transform="1 0 0 0 1 0 0 0 1 0 0 10"/></build></model>`;
  for (const deflate of [false, true]) {
    const r = await IM.parse3MF(zipOf({ '_rels/.rels': ['<Relationships><Relationship Target="/3D/3dmodel.model" Id="r0" Type="x"/></Relationships>', deflate], '3D/3dmodel.model': [xml, deflate] }));
    const tag = deflate ? '3MF (deflated)' : '3MF (stored)', mp = r.bodies.map(b => C.meshProps(b.pos));
    near(r.bodies.length, 3, 0, `${tag}: 3 bodies (1 item + 2 components)`); near(r.bodies[0].name === 'Tall block' ? 1 : 0, 1, 0, `${tag}: body names kept`);
    rel(mp[0].V, 6 * 25.4 ** 3, 1e-9, `${tag}: inch units → mm³ (1×2×3 in)`);
    near(mp[0].c[1], 1.5 * 25.4, 1e-9, `${tag}: Z-up file → 3 in height lands on Y`); near(mp[0].c[2], -1 * 25.4, 1e-9, `${tag}: file +Y → −Z`);
    near(mp[1].c[0], 5.5 * 25.4, 1e-9, `${tag}: component transform moves x`); near(mp[2].c[2], -5.5 * 25.4, 1e-9, `${tag}: second component (file +Y 5 in → −Z)`);
    near(mp[1].c[1], 10.5 * 25.4, 1e-9, `${tag}: item transform lifts the pair 10 in`);
    near(C.meshCheck(r.bodies[0].pos).closed ? 1 : 0, 1, 0, `${tag}: body is watertight`);
  }
  const obj = `# two bodies\no Plate\nv 0 0 0\nv 10 0 0\nv 10 0 -10\nv 0 0 -10\nv 0 2 0\nv 10 2 0\nv 10 2 -10\nv 0 2 -10\n` +
    `f 1 4 3 2\nf 5 6 7 8\nf 1 2 6 5\nf 2 3 7 6\nf 3 4 8 7\nf 4 1 5 8\ng Tet\nv 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf -4 -2 -3\nf -4 -3/1 -1/1\nf -4//1 -1//1 -2//1\nf -3 -2 -1\n`;
  const o = IM.parseOBJ(obj), ov = o.bodies.map(b => C.meshProps(b.pos));
  near(o.bodies.length, 2, 0, 'OBJ: o/g start bodies'); near(ov[0].V, 200, 1e-9, 'OBJ: quads fan-triangulate (10×2×10 plate)');
  near(Math.abs(ov[1].V), 1 / 6, 1e-12, 'OBJ: negative indices and v/vt/vn forms'); near(C.meshCheck(o.bodies[0].pos).closed ? 1 : 0, 1, 0, 'OBJ: plate watertight');
  let threw = false; try { IM.parseOBJ('v 0 0 0\nf 1 2 3\n'); } catch (e) { threw = true; } near(threw ? 1 : 0, 1, 0, 'OBJ with a bad index → plain error');
})();

for (const k of Object.keys(P.list)) { const s = C.solve(P.list[k]()); near(isFinite(s.M) && s.M > 0 && !s.warnings.length ? 1 : 0, 1, 0, `example ${k} solves cleanly (${s.M.toFixed(2)} g)`); }
imports.catch(e => { fails++; console.log('FAIL import tests threw: ' + e.message); }).then(() => {
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exitCode = fails ? 1 : 0;
});
