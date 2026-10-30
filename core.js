// Solid Bench — engineering core. Pure functions only: no DOM, no three.js, so node tests can run it directly.
// Units: length mm, density g/cm³ (stored per part), mass g, inertia g·mm². Y is up (the grid is the X–Z plane).
// Every primitive has its local origin at the center of its bounding box; its axis of revolution is local Y.
const Core = (() => {
  'use strict';
  const PI = Math.PI;

  // ---------- primitives ----------
  // dims are in mm. `seg` = facets around a revolved part (display / STL / mesh check only; exact props ignore it).
  const TYPES = {
    box:      { label: 'Box',      dims: [['w', 'Width X', 40], ['h', 'Height Y', 20], ['d', 'Depth Z', 30]] },
    cylinder: { label: 'Cylinder', dims: [['r', 'Radius', 15], ['h', 'Height', 40]] },
    tube:     { label: 'Tube',     dims: [['ro', 'Outer radius', 15], ['ri', 'Inner radius', 10], ['h', 'Height', 30]] },
    sphere:   { label: 'Sphere',   dims: [['r', 'Radius', 15]] },
    cone:     { label: 'Cone',     dims: [['r1', 'Bottom radius', 15], ['r2', 'Top radius', 0], ['h', 'Height', 30]] },
    torus:    { label: 'Torus',    dims: [['R', 'Ring radius', 20], ['r', 'Tube radius', 5]] },
    mesh:     { label: 'Mesh',     dims: [] },
  };
  function defaultDims(type) { const o = {}; for (const [k, , v] of TYPES[type].dims) o[k] = v; return o; }

  // Plain-language problems with a part's dimensions ('' when fine).
  function dimProblem(p) {
    const d = p.dims || {};
    for (const [k, label] of TYPES[p.type].dims) if (!(d[k] >= 0) || !isFinite(d[k])) return `${label} must be a number ≥ 0`;
    switch (p.type) {
      case 'box': return d.w > 0 && d.h > 0 && d.d > 0 ? '' : 'Box sides must be > 0';
      case 'cylinder': return d.r > 0 && d.h > 0 ? '' : 'Radius and height must be > 0';
      case 'tube': return d.h > 0 && d.ro > d.ri ? '' : 'Outer radius must exceed inner radius';
      case 'sphere': return d.r > 0 ? '' : 'Radius must be > 0';
      case 'cone': return d.h > 0 && (d.r1 > 0 || d.r2 > 0) ? '' : 'Height and at least one radius must be > 0';
      case 'torus': return d.r > 0 && d.R > d.r ? '' : 'Ring radius must exceed tube radius';
    }
    return '';
  }

  // ---------- exact (closed-form) properties, density 1 ----------
  // Returns volume V (mm³), area A (mm²), centroid c (local, mm), and the inertia tensor about the centroid per unit
  // density, I (mm⁵) — multiply by density for g·mm². Products of inertia enter the tensor with a minus sign.
  function diag(a, b, c) { return [[a, 0, 0], [0, b, 0], [0, 0, c]]; }
  // 3-point Gauss–Legendre on [0, h]: exact for polynomials up to degree 5 (the cone integrands are degree ≤ 4).
  function gauss3(f, h) {
    const x = Math.sqrt(3 / 5), w = [5 / 9, 8 / 9, 5 / 9], t = [-x, 0, x];
    let s = 0; for (let i = 0; i < 3; i++) s += w[i] * f(h * (t[i] + 1) / 2);
    return s * h / 2;
  }
  function exactProps(p) {
    const d = p.dims;
    switch (p.type) {
      case 'box': {
        const V = d.w * d.h * d.d;
        return { V, A: 2 * (d.w * d.h + d.h * d.d + d.w * d.d), c: [0, 0, 0],
          I: diag(V * (d.h ** 2 + d.d ** 2) / 12, V * (d.w ** 2 + d.d ** 2) / 12, V * (d.w ** 2 + d.h ** 2) / 12) };
      }
      case 'cylinder': {
        const V = PI * d.r ** 2 * d.h, t = V * (3 * d.r ** 2 + d.h ** 2) / 12;
        return { V, A: 2 * PI * d.r ** 2 + 2 * PI * d.r * d.h, c: [0, 0, 0], I: diag(t, V * d.r ** 2 / 2, t) };
      }
      case 'tube': {
        const s = d.ro ** 2 + d.ri ** 2, V = PI * (d.ro ** 2 - d.ri ** 2) * d.h, t = V * (3 * s + d.h ** 2) / 12;
        return { V, A: 2 * PI * (d.ro ** 2 - d.ri ** 2) + 2 * PI * (d.ro + d.ri) * d.h, c: [0, 0, 0], I: diag(t, V * s / 2, t) };
      }
      case 'sphere': {
        const V = 4 / 3 * PI * d.r ** 3, t = 0.4 * V * d.r ** 2;
        return { V, A: 4 * PI * d.r ** 2, c: [0, 0, 0], I: diag(t, t, t) };
      }
      case 'cone': {
        // Frustum by stacked disks: radius ρ(s) = r1 + (r2 − r1)s/h at height s above the base (base at y = −h/2).
        const { r1, r2, h } = d, rho = s => r1 + (r2 - r1) * s / h;
        const V = gauss3(s => PI * rho(s) ** 2, h);
        const sy = gauss3(s => PI * rho(s) ** 2 * s, h) / V;            // centroid height above the base
        const Iy = gauss3(s => PI * rho(s) ** 4 / 2, h);                 // about the axis
        const Ib = gauss3(s => PI * rho(s) ** 2 * (rho(s) ** 2 / 4 + s * s), h);  // about a diameter of the base
        const Ix = Ib - V * sy * sy;                                     // parallel axis to the centroid
        return { V, A: PI * (r1 + r2) * Math.hypot(r1 - r2, h) + PI * r1 * r1 + PI * r2 * r2, c: [0, sy - h / 2, 0], I: diag(Ix, Iy, Ix) };
      }
      case 'torus': {
        const V = 2 * PI * PI * d.R * d.r ** 2;
        return { V, A: 4 * PI * PI * d.R * d.r, c: [0, 0, 0],
          I: diag(V * (d.R ** 2 / 2 + 5 / 8 * d.r ** 2), V * (d.R ** 2 + 0.75 * d.r ** 2), V * (d.R ** 2 / 2 + 5 / 8 * d.r ** 2)) };
      }
    }
    return null;
  }

  // ---------- meshes ----------
  // A mesh is { pos, nrm }: flat arrays, 9 numbers per triangle, counterclockwise seen from outside.
  function boxMesh(w, h, d) {
    const x = w / 2, y = h / 2, z = d / 2, pos = [], nrm = [];
    const quad = (a, b, c, e, n) => { for (const v of [a, b, c, a, c, e]) { pos.push(...v); nrm.push(...n); } };
    quad([x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z], [1, 0, 0]);
    quad([-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], [-1, 0, 0]);
    quad([-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z], [0, 1, 0]);
    quad([-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], [0, -1, 0]);
    quad([-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], [0, 0, 1]);
    quad([x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], [0, 0, -1]);
    return { pos, nrm };
  }
  // Revolve a closed profile of {r, y, n?} points about Y. A point with `n` ([nr, ny]) is on a smooth curve and uses
  // that normal; elsewhere each profile edge is a sharp facet with its own normal. Points on the axis (r = 0) close
  // the profile without needing a facet there.
  function lathe(prof, seg) {
    let area2 = 0;
    for (let i = 0; i < prof.length; i++) { const a = prof[i], b = prof[(i + 1) % prof.length]; area2 += a.r * b.y - b.r * a.y; }
    const sgn = area2 >= 0 ? 1 : -1, pos = [], nrm = [];
    const cs = Array.from({ length: seg + 1 }, (_, k) => [Math.cos(2 * PI * k / seg), Math.sin(2 * PI * k / seg)]);
    for (let i = 0; i < prof.length; i++) {
      const a = prof[i], b = prof[(i + 1) % prof.length];
      if (a.r === 0 && b.r === 0) continue;
      const dr = b.r - a.r, dy = b.y - a.y, L = Math.hypot(dr, dy) || 1, ne = [sgn * dy / L, -sgn * dr / L];
      const na = a.n && b.n ? a.n : ne, nb = a.n && b.n ? b.n : ne;
      for (let k = 0; k < seg; k++) {
        const P = (p, c) => [p.r * c[0], p.y, -p.r * c[1]], N = (n, c) => [n[0] * c[0], n[1], -n[0] * c[1]];
        const v = [P(a, cs[k]), P(b, cs[k]), P(b, cs[k + 1]), P(a, cs[k + 1])], n = [N(na, cs[k]), N(nb, cs[k]), N(nb, cs[k + 1]), N(na, cs[k + 1])];
        for (const t of [[0, 1, 2], [0, 2, 3]]) {
          if (triArea(v[t[0]], v[t[1]], v[t[2]]) < 1e-12) continue;
          const o = sgn > 0 ? [t[0], t[2], t[1]] : t;
          for (const j of o) { pos.push(...v[j]); nrm.push(...n[j]); }
        }
      }
    }
    return { pos, nrm };
  }
  function triArea(a, b, c) { return 0.5 * norm(cross(sub(b, a), sub(c, a))); }
  function arc(cx, cy, rad, t0, t1, n) {   // smooth profile points on a circle, angle t measured from +r toward +y
    return Array.from({ length: n + 1 }, (_, i) => { const t = t0 + (t1 - t0) * i / n; return { r: Math.max(0, cx + rad * Math.cos(t)), y: cy + rad * Math.sin(t), n: [Math.cos(t), Math.sin(t)] }; });
  }
  function partMesh(p, seg, meshes) {
    const d = p.dims; seg = Math.max(8, Math.round(seg || 48));
    switch (p.type) {
      case 'box': return boxMesh(d.w, d.h, d.d);
      case 'cylinder': return lathe([{ r: 0, y: -d.h / 2 }, { r: d.r, y: -d.h / 2 }, { r: d.r, y: d.h / 2 }, { r: 0, y: d.h / 2 }], seg);
      case 'tube': return lathe([{ r: d.ri, y: -d.h / 2 }, { r: d.ro, y: -d.h / 2 }, { r: d.ro, y: d.h / 2 }, { r: d.ri, y: d.h / 2 }], seg);
      case 'cone': return lathe([{ r: 0, y: -d.h / 2 }, { r: d.r1, y: -d.h / 2 }, { r: d.r2, y: d.h / 2 }, { r: 0, y: d.h / 2 }].filter((q, i, a) => !(q.r === 0 && i > 0 && a[i - 1].r === 0)), seg);
      case 'sphere': { const s = arc(0, 0, d.r, -PI / 2, PI / 2, Math.max(4, seg / 2)); s[0].r = 0; s[s.length - 1].r = 0; return lathe(s, seg); }
      case 'torus': return lathe(arc(d.R, 0, d.r, 0, 2 * PI, seg).slice(0, -1), seg);
      case 'mesh': { const m = meshes && meshes[p.mesh]; return m ? { pos: m.pos, nrm: null } : { pos: [], nrm: null }; }
    }
    return { pos: [], nrm: [] };
  }

  // ---------- mass properties of a closed triangle mesh (divergence theorem) ----------
  // Eberly, "Polyhedral Mass Properties (Revisited)": each triangle contributes exact surface integrals of
  // 1, x, y, z, x², y², z², xy, yz, zx; for a closed, outward-wound mesh they equal the volume integrals.
  function meshProps(pos) {
    const g = new Float64Array(10); let A = 0;
    const sub3 = (w0, w1, w2) => {
      const t0 = w0 + w1, f1 = t0 + w2, t1 = w0 * w0, t2 = t1 + w1 * t0, f2 = t2 + w2 * f1, f3 = w0 * t1 + w1 * t2 + w2 * f2;
      return [f1, f2, f3, f2 + w0 * (f1 + w0), f2 + w1 * (f1 + w1), f2 + w2 * (f1 + w2)];
    };
    for (let i = 0; i + 8 < pos.length; i += 9) {
      const x0 = pos[i], y0 = pos[i + 1], z0 = pos[i + 2], x1 = pos[i + 3], y1 = pos[i + 4], z1 = pos[i + 5], x2 = pos[i + 6], y2 = pos[i + 7], z2 = pos[i + 8];
      const a1 = x1 - x0, b1 = y1 - y0, c1 = z1 - z0, a2 = x2 - x0, b2 = y2 - y0, c2 = z2 - z0;
      const d0 = b1 * c2 - b2 * c1, d1 = a2 * c1 - a1 * c2, d2 = a1 * b2 - a2 * b1;
      A += 0.5 * Math.hypot(d0, d1, d2);
      const X = sub3(x0, x1, x2), Y = sub3(y0, y1, y2), Z = sub3(z0, z1, z2);
      g[0] += d0 * X[0]; g[1] += d0 * X[1]; g[2] += d1 * Y[1]; g[3] += d2 * Z[1];
      g[4] += d0 * X[2]; g[5] += d1 * Y[2]; g[6] += d2 * Z[2];
      g[7] += d0 * (y0 * X[3] + y1 * X[4] + y2 * X[5]); g[8] += d1 * (z0 * Y[3] + z1 * Y[4] + z2 * Y[5]); g[9] += d2 * (x0 * Z[3] + x1 * Z[4] + x2 * Z[5]);
    }
    const k = [1 / 6, 1 / 24, 1 / 24, 1 / 24, 1 / 60, 1 / 60, 1 / 60, 1 / 120, 1 / 120, 1 / 120];
    for (let i = 0; i < 10; i++) g[i] *= k[i];
    const V = g[0];
    if (!(Math.abs(V) > 1e-15)) return { V: 0, A, c: [0, 0, 0], I: diag(0, 0, 0) };
    const c = [g[1] / V, g[2] / V, g[3] / V];
    const Ixx = g[5] + g[6] - V * (c[1] ** 2 + c[2] ** 2), Iyy = g[4] + g[6] - V * (c[2] ** 2 + c[0] ** 2), Izz = g[4] + g[5] - V * (c[0] ** 2 + c[1] ** 2);
    const Ixy = -(g[7] - V * c[0] * c[1]), Iyz = -(g[8] - V * c[1] * c[2]), Ixz = -(g[9] - V * c[2] * c[0]);
    return { V, A, c, I: [[Ixx, Ixy, Ixz], [Ixy, Iyy, Iyz], [Ixz, Iyz, Izz]] };
  }

  // Watertightness: every edge (vertices welded at 1e-4 mm) must be shared by exactly two triangles.
  function meshCheck(pos) {
    const key = i => Math.round(pos[i] * 1e4) + ',' + Math.round(pos[i + 1] * 1e4) + ',' + Math.round(pos[i + 2] * 1e4);
    const edges = new Map(); let degenerate = 0;
    for (let i = 0; i + 8 < pos.length; i += 9) {
      const k = [key(i), key(i + 3), key(i + 6)];
      if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) { degenerate++; continue; }
      for (let j = 0; j < 3; j++) { const a = k[j], b = k[(j + 1) % 3], e = a < b ? a + '|' + b : b + '|' + a; edges.set(e, (edges.get(e) || 0) + 1); }
    }
    let open = 0, nonManifold = 0;
    for (const n of edges.values()) { if (n === 1) open++; else if (n > 2) nonManifold++; }
    return { tris: pos.length / 9, open, nonManifold, degenerate, closed: open === 0 && nonManifold === 0 };
  }

  // ---------- linear algebra ----------
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { return Math.hypot(a[0], a[1], a[2]); }
  function mulMV(M, v) { return [0, 1, 2].map(i => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]); }
  function mulMM(A, B) { return [0, 1, 2].map(i => [0, 1, 2].map(j => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j])); }
  function T(A) { return [0, 1, 2].map(i => [0, 1, 2].map(j => A[j][i])); }
  // Rotation from Euler angles in degrees, applied in X, then Y, then Z intrinsic order: R = Rx·Ry·Rz
  // (the same convention as three.js's default 'XYZ' Euler, so the picture and the numbers agree).
  function rotMatrix(rot) {
    const [x, y, z] = (rot || [0, 0, 0]).map(t => t * PI / 180);
    const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
    return [[c * e, -c * f, d], [a * f + b * e * d, a * e - b * f * d, -b * c], [b * f - a * e * d, b * e + a * f * d, a * c]];
  }
  function transformPos(pos, R, t) {
    const out = new Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      out[i] = R[0][0] * x + R[0][1] * y + R[0][2] * z + t[0];
      out[i + 1] = R[1][0] * x + R[1][1] * y + R[1][2] * z + t[1];
      out[i + 2] = R[2][0] * x + R[2][1] * y + R[2][2] * z + t[2];
    }
    return out;
  }
  // Parallel-axis shift of an inertia tensor by offset d for mass m: I + m(|d|²E − d dᵀ).
  function shift(I, m, d) {
    const dd = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
    return [0, 1, 2].map(i => [0, 1, 2].map(j => I[i][j] + m * ((i === j ? dd : 0) - d[i] * d[j])));
  }
  // Symmetric 3×3 eigenvalues/vectors by cyclic Jacobi. Returns ascending values; vectors as columns of V.
  function eigSym(S) {
    const A = S.map(r => r.slice()), V = diag(1, 1, 1);
    for (let sweep = 0; sweep < 50; sweep++) {
      const off = A[0][1] ** 2 + A[0][2] ** 2 + A[1][2] ** 2, scale = A[0][0] ** 2 + A[1][1] ** 2 + A[2][2] ** 2;
      if (off <= 1e-30 * Math.max(scale, 1e-300)) break;
      for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
        for (let k = 0; k < 3; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
      }
    }
    const idx = [0, 1, 2].sort((i, j) => A[i][i] - A[j][j]);
    return { values: idx.map(i => A[i][i]), vectors: idx.map(i => [V[0][i], V[1][i], V[2][i]]) };
  }

  // ---------- materials (density g/cm³, nominal handbook values) ----------
  const MATERIALS = [
    ['al6061', 'Aluminum 6061', 2.70], ['al7075', 'Aluminum 7075', 2.81], ['steel1018', 'Steel 1018', 7.87],
    ['ss304', 'Stainless 304', 8.00], ['ss316', 'Stainless 316', 8.00], ['ti64', 'Titanium Ti-6Al-4V', 4.43],
    ['brass360', 'Brass C360', 8.50], ['copper', 'Copper C110', 8.89], ['peek', 'PEEK', 1.30], ['acetal', 'Acetal (Delrin)', 1.41],
    ['abs', 'ABS', 1.05], ['nylon66', 'Nylon 6/6', 1.14], ['pc', 'Polycarbonate', 1.20], ['pla', 'PLA', 1.24], ['uhmw', 'UHMW-PE', 0.93],
    ['custom', 'Custom density', null],
  ];
  const MAT = Object.fromEntries(MATERIALS.map(([k, n, r]) => [k, { name: n, rho: r }]));
  function density(p) { return p.mat && p.mat !== 'custom' && MAT[p.mat] ? MAT[p.mat].rho : +p.rho || 0; }

  // ---------- one part, in the world ----------
  // Local props (exact for primitives, mesh-integrated for imported meshes), then rotation and translation.
  function partInfo(p, model) {
    const problem = dimProblem(p);
    if (problem) return { problem };
    const local = p.type === 'mesh' ? meshProps(partMesh(p, 0, model.meshes).pos) : exactProps(p);
    const rho = density(p) / 1000;                 // g/mm³
    const R = rotMatrix(p.rot), t = p.pos || [0, 0, 0];
    const Il = local.I.map(r => r.map(v => v * rho));
    return { local, rho, R, m: rho * local.V, V: local.V, A: local.A, c: mulMV(R, local.c).map((v, i) => v + t[i]), Ilocal: Il, I: mulMM(mulMM(R, Il), T(R)) };
  }

  // ---------- the assembly ----------
  // Visible parts only. Overlapping parts are summed as if separate (no boolean union).
  function solve(model) {
    const parts = [], warnings = [];
    let M = 0, V = 0, A = 0; const mc = [0, 0, 0];
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of model.parts || []) {
      const info = partInfo(p, model); parts.push(info);
      if (info.problem) { warnings.push(`${p.name}: ${info.problem}`); continue; }
      if (p.type === 'mesh' && info.V < 0) warnings.push(`${p.name}: mesh is wound inside-out (negative volume)`);
      if (p.visible === false) continue;
      M += info.m; V += info.V; A += info.A; for (let i = 0; i < 3; i++) mc[i] += info.m * info.c[i];
      const w = transformPos(partMesh(p, model.seg, model.meshes).pos, info.R, p.pos || [0, 0, 0]);
      for (let i = 0; i < w.length; i++) { const k = i % 3; if (w[i] < lo[k]) lo[k] = w[i]; if (w[i] > hi[k]) hi[k] = w[i]; }
    }
    const C = M > 0 ? mc.map(v => v / M) : [0, 0, 0];
    let I = diag(0, 0, 0);
    (model.parts || []).forEach((p, i) => {
      const q = parts[i]; if (q.problem || p.visible === false) return;
      const s = shift(q.I, q.m, sub(q.c, C));
      I = I.map((r, a) => r.map((v, b) => v + s[a][b]));
    });
    const count = (model.parts || []).filter((p, i) => p.visible !== false && !parts[i].problem).length;
    const principal = eigSym(I);
    return { parts, warnings, count, M, V, A, C, I, principal, bbox: isFinite(lo[0]) ? { lo, hi, size: sub(hi, lo) } : null };
  }

  // ---------- world triangles (for STL and measuring) ----------
  function worldTriangles(model, onlyIds) {
    const out = [];
    for (const p of model.parts || []) {
      if (p.visible === false || dimProblem(p) || (onlyIds && !onlyIds.includes(p.id))) continue;
      const w = transformPos(partMesh(p, model.seg, model.meshes).pos, rotMatrix(p.rot), p.pos || [0, 0, 0]);
      for (let i = 0; i < w.length; i++) out.push(w[i]);
    }
    return out;
  }

  // ---------- STL ----------
  function stlBinary(pos, header) {
    const n = Math.floor(pos.length / 9), buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
    const h = (header || 'Solid Bench STL, units mm').slice(0, 79);
    for (let i = 0; i < h.length; i++) dv.setUint8(i, h.charCodeAt(i) & 127);
    dv.setUint32(80, n, true);
    for (let t = 0, o = 84; t < n; t++, o += 50) {
      const i = 9 * t, a = [pos[i], pos[i + 1], pos[i + 2]], b = [pos[i + 3], pos[i + 4], pos[i + 5]], c = [pos[i + 6], pos[i + 7], pos[i + 8]];
      const nv = cross(sub(b, a), sub(c, a)), L = norm(nv) || 1;
      const vals = [nv[0] / L, nv[1] / L, nv[2] / L, ...a, ...b, ...c];
      for (let k = 0; k < 12; k++) dv.setFloat32(o + 4 * k, vals[k], true);
      dv.setUint16(o + 48, 0, true);
    }
    return buf;
  }
  // Binary or ASCII. Returns a flat triangle array; normals in the file are ignored (winding is trusted).
  function parseSTL(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    if (u8.length >= 84) {
      const n = dv.getUint32(80, true);
      if (84 + 50 * n === u8.length) {
        const pos = new Array(9 * n);
        for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) pos[9 * t + k] = dv.getFloat32(84 + 50 * t + 12 + 4 * k, true);
        return pos;
      }
    }
    const txt = typeof TextDecoder !== 'undefined' ? new TextDecoder().decode(u8) : Buffer.from(u8).toString('latin1');
    const pos = [], re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g; let m;
    while ((m = re.exec(txt))) pos.push(+m[1], +m[2], +m[3]);
    if (!pos.length || pos.length % 9) throw new Error('Not a readable STL file');
    return pos;
  }
  // Recenter an imported mesh on its bounding-box center; returns the local mesh and where that center was.
  function centerMesh(pos) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) { const k = i % 3; lo[k] = Math.min(lo[k], pos[i]); hi[k] = Math.max(hi[k], pos[i]); }
    const c = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2);
    return { pos: pos.map((v, i) => Math.round((v - c[i % 3]) * 1e5) / 1e5), center: c };
  }

  return { TYPES, MATERIALS, MAT, defaultDims, dimProblem, exactProps, partMesh, meshProps, meshCheck, rotMatrix, transformPos, shift, eigSym,
    mulMV, mulMM, T, density, partInfo, solve, worldTriangles, stlBinary, parseSTL, centerMesh, gauss3 };
})();
if (typeof module !== 'undefined') module.exports = Core;
