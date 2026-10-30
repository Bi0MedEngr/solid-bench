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
    body:     { label: 'Body',     dims: [] },
    extrude:  { label: 'Extrude',  dims: [['d', 'Distance', 10]] },
    revolve:  { label: 'Revolve',  dims: [['angle', 'Angle', 360, '°']] },
  };
  function defaultDims(type) { const o = {}; for (const [k, , v] of TYPES[type].dims) o[k] = v; return o; }

  // Plain-language problems with a part's dimensions ('' when fine).
  function dimProblem(p) {
    const d = p.dims || {};
    for (const [k, label] of TYPES[p.type].dims) if (typeof d[k] !== 'number' || !isFinite(d[k])) return `${label} must be a number`;
    switch (p.type) {
      case 'body': { for (const c of p.children || []) { const q = dimProblem(c.part); if (q) return `${c.part.name}: ${q}`; } return (p.children || []).length ? '' : 'This body has no features'; }
      case 'extrude': return d.d !== 0 ? sketchProblem(p) : 'Extrude distance must not be 0';
      case 'revolve': return d.angle > 0 && d.angle <= 360 ? sketchProblem(p) : 'Revolve angle must be between 0 and 360°';
      case 'box': return d.w > 0 && d.h > 0 && d.d > 0 ? '' : 'Box sides must be > 0';
      case 'cylinder': return d.r > 0 && d.h > 0 ? '' : 'Radius and height must be > 0';
      case 'tube': return d.h > 0 && d.ri >= 0 && d.ro > d.ri ? '' : 'Outer radius must exceed inner radius';
      case 'sphere': return d.r > 0 ? '' : 'Radius must be > 0';
      case 'cone': return d.h > 0 && d.r1 >= 0 && d.r2 >= 0 && (d.r1 > 0 || d.r2 > 0) ? '' : 'Height and at least one radius must be > 0';
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
      case 'extrude': case 'revolve': return sketchProps(p);
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
  // Revolve a closed profile of {r, y, n?, smooth?} points about Y, from angle phi0 through theta (radians). A point
  // with `n` ([nr, ny]) uses that normal; a `smooth` point averages its two edge normals; elsewhere each profile edge
  // is a sharp facet. Edges on the axis (r = 0) close the profile without a facet. Surfaces face out of the loop's own
  // interior; pass hole = true for a hole loop, whose surface must face into the hole instead.
  function lathe(prof, seg, phi0 = 0, theta = 2 * PI, hole = false) {
    const L = loopNormals(prof.map(p => [p.r, p.y]), prof.map(p => !!p.smooth), hole), sgn = L.sgn, pos = [], nrm = [];
    const n = Math.max(1, Math.ceil(seg * theta / (2 * PI) - 1e-9));
    const cs = Array.from({ length: n + 1 }, (_, k) => { const t = phi0 + theta * k / n; return [Math.cos(t), Math.sin(t)]; });
    for (let i = 0; i < prof.length; i++) {
      const a = prof[i], b = prof[(i + 1) % prof.length];
      if (a.r === 0 && b.r === 0) continue;
      const na = a.n && b.n ? a.n : L.start[i], nb = a.n && b.n ? b.n : L.end[i];
      for (let k = 0; k < n; k++) {
        const P = (p, c) => [p.r * c[0], p.y, -p.r * c[1]], N = (q, c) => [q[0] * c[0], q[1], -q[0] * c[1]];
        const v = [P(a, cs[k]), P(b, cs[k]), P(b, cs[k + 1]), P(a, cs[k + 1])], nn = [N(na, cs[k]), N(nb, cs[k]), N(nb, cs[k + 1]), N(na, cs[k + 1])];
        for (const t of [[0, 1, 2], [0, 2, 3]]) {
          if (triArea(v[t[0]], v[t[1]], v[t[2]]) < 1e-12) continue;
          const o = sgn > 0 ? [t[0], t[2], t[1]] : t;
          for (const j of o) { pos.push(...v[j]); nrm.push(...nn[j]); }
        }
      }
    }
    return { pos, nrm };
  }
  // Per-edge normals of a closed 2D loop, pointing out of the loop's interior (into it for a hole loop); smooth
  // vertices share an averaged normal.
  function loopNormals(pts, smooth, hole) {
    const m = pts.length; let a2 = 0;
    for (let i = 0; i < m; i++) { const p = pts[i], q = pts[(i + 1) % m]; a2 += p[0] * q[1] - q[0] * p[1]; }
    const sgn = (a2 >= 0 ? 1 : -1) * (hole ? -1 : 1);
    const e = pts.map((p, i) => { const q = pts[(i + 1) % m], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1; return [sgn * dy / l, -sgn * dx / l]; });
    const vn = pts.map((_, i) => { const a = e[(i - 1 + m) % m], b = e[i], x = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; });
    return { sgn, start: e.map((n, i) => smooth[i] ? vn[i] : n), end: e.map((n, i) => smooth[(i + 1) % m] ? vn[(i + 1) % m] : n) };
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
      case 'extrude': case 'revolve': return sketchMesh(p, seg);
      case 'body': return bodyMesh(p, seg, meshes);
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


  // ---------- sketches: profiles of lines, rectangles, circles and fillets ----------
  // A sketch lives on a plane with its own (u, v) axes and normal w. P maps sketch (u, v, w) to world; every P is a
  // proper rotation, so windings and handedness carry over. The plane sits at w = offset.
  const PLANES = {
    ground: { label: 'Ground (X–Z)', P: [[1, 0, 0], [0, 0, 1], [0, -1, 0]] },   // u → +X, v → −Z, w → +Y
    front:  { label: 'Front (X–Y)',  P: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },    // u → +X, v → +Y, w → +Z
    right:  { label: 'Right (Z–Y)',  P: [[0, 0, 1], [0, 1, 0], [-1, 0, 0]] },   // u → −Z, v → +Y, w → +X
  };
  const EXACT_N = 4096;   // chords per full turn when integrating curved edges (relative error ≈ (2π/N)²/6 ≈ 4e-7)

  // Round the corners of a closed polygon. radii[i] is the fillet radius at vertex i (0 = sharp). Returns
  // { pts, smooth } with each arc sampled at nTurn points per full turn, or { problem }.
  function filletPolygon(pts, radii, nTurn) {
    const m = pts.length, out = [], smooth = [], cut = new Array(m).fill(0), geo = [];
    for (let i = 0; i < m; i++) {
      const r = +(radii && radii[i]) || 0, B = pts[i];
      if (r <= 0) { geo.push(null); continue; }
      const A = pts[(i - 1 + m) % m], C = pts[(i + 1) % m];
      const a = [A[0] - B[0], A[1] - B[1]], c = [C[0] - B[0], C[1] - B[1]], la = Math.hypot(...a), lc = Math.hypot(...c);
      if (!la || !lc) return { problem: 'A corner has a zero-length side' };
      const ua = [a[0] / la, a[1] / la], uc = [c[0] / lc, c[1] / lc], cosT = Math.max(-1, Math.min(1, ua[0] * uc[0] + ua[1] * uc[1])), th = Math.acos(cosT);
      if (th < 1e-6 || PI - th < 1e-6) { geo.push(null); continue; }     // straight-through vertex: nothing to round
      const t = r / Math.tan(th / 2), bis = [ua[0] + uc[0], ua[1] + uc[1]], lb = Math.hypot(...bis);
      const ctr = [B[0] + bis[0] / lb * r / Math.sin(th / 2), B[1] + bis[1] / lb * r / Math.sin(th / 2)];
      const T1 = [B[0] + ua[0] * t, B[1] + ua[1] * t], T2 = [B[0] + uc[0] * t, B[1] + uc[1] * t];
      cut[i] = t; geo.push({ T1, T2, ctr, r });
    }
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m, L = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
      if (cut[i] + cut[j] > L * (1 + 1e-9)) return { problem: 'A fillet radius is too large for the sides next to it' };
    }
    for (let i = 0; i < m; i++) {
      const g = geo[i];
      if (!g) { out.push(pts[i]); smooth.push(false); continue; }
      let a0 = Math.atan2(g.T1[1] - g.ctr[1], g.T1[0] - g.ctr[0]), a1 = Math.atan2(g.T2[1] - g.ctr[1], g.T2[0] - g.ctr[0]), da = a1 - a0;
      while (da > PI) da -= 2 * PI; while (da < -PI) da += 2 * PI;
      const k = Math.max(2, Math.ceil(Math.abs(da) / (2 * PI) * nTurn));
      for (let s = 0; s <= k; s++) { const t = a0 + da * s / k; out.push([g.ctr[0] + g.r * Math.cos(t), g.ctr[1] + g.r * Math.sin(t)]); smooth.push(true); }
    }
    // a fillet that uses up a whole side leaves its end exactly on the next one's start: keep one point
    const P = [], S = [];
    out.forEach((q, i) => { const last = P[P.length - 1]; if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 1e-9) { S[S.length - 1] = S[S.length - 1] || smooth[i]; return; } P.push(q); S.push(smooth[i]); });
    if (P.length > 1 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1e-9) { S[0] = S[0] || S[S.length - 1]; P.pop(); S.pop(); }
    return { pts: P, smooth: S };
  }
  // One sketch entity → one closed loop.
  function entLoop(e, nTurn) {
    if (e.kind === 'circle') {
      if (!(e.r > 0)) return { problem: 'Circle radius must be > 0' };
      const n = Math.max(8, nTurn);
      return { pts: Array.from({ length: n }, (_, i) => [e.x + e.r * Math.cos(2 * PI * i / n), e.y + e.r * Math.sin(2 * PI * i / n)]), smooth: new Array(n).fill(true), perim: 2 * PI * e.r };
    }
    let pts, radii;
    if (e.kind === 'rect') {
      if (!e.w || !e.h) return { problem: 'Rectangle sides must not be 0' };
      const x0 = Math.min(e.x, e.x + e.w), x1 = Math.max(e.x, e.x + e.w), y0 = Math.min(e.y, e.y + e.h), y1 = Math.max(e.y, e.y + e.h);
      pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; radii = new Array(4).fill(Math.max(0, +e.rr || 0));
    } else {
      pts = e.pts || []; radii = e.f || [];
      if (pts.length < 3) return { problem: 'A line loop needs at least 3 points' };
    }
    const f = filletPolygon(pts, radii, nTurn);
    if (f.problem) return f;
    let perim = 0;   // exact perimeter: straight runs plus true arc lengths
    { const g = filletPolygon(pts, radii, EXACT_N * 4); for (let i = 0; i < g.pts.length; i++) { const p = g.pts[i], q = g.pts[(i + 1) % g.pts.length]; perim += Math.hypot(q[0] - p[0], q[1] - p[1]); } }
    return { pts: f.pts, smooth: f.smooth, perim };
  }
  function signedArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  function inside(pt, pts) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  function segsCross(p, q, r, s) {
    const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d1 = d(r, s, p), d2 = d(r, s, q), d3 = d(p, q, r), d4 = d(p, q, s), eps = 1e-12;
    return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
  }
  // All loops of a sketch with nesting depth (even depth = material, odd = hole), or { problem }.
  function sketchLoops(sk, nTurn) {
    const ents = (sk && sk.ents) || [];
    if (!ents.length) return { problem: 'The sketch is empty' };
    const loops = [];
    for (const e of ents) { const l = entLoop(e, nTurn); if (l.problem) return l; if (Math.abs(signedArea(l.pts)) < 1e-12) return { problem: 'A loop has no area' }; loops.push(l); }
    const segs = loops.map(l => l.pts.map((p, i) => [p, l.pts[(i + 1) % l.pts.length]]));
    const total = segs.reduce((a, s) => a + s.length, 0);
    if (total <= 6000) {
      for (let a = 0; a < segs.length; a++) for (let b = a; b < segs.length; b++)
        for (let i = 0; i < segs[a].length; i++) for (let j = (a === b ? i + 2 : 0); j < segs[b].length; j++) {
          if (a === b && i === 0 && j === segs[a].length - 1) continue;
          if (segsCross(segs[a][i][0], segs[a][i][1], segs[b][j][0], segs[b][j][1])) return { problem: a === b ? 'A loop crosses itself' : 'Two loops cross; keep each loop inside or outside the others' };
        }
    }
    loops.forEach((l, i) => { l.depth = loops.filter((o, j) => j !== i && Math.abs(signedArea(o.pts)) > Math.abs(signedArea(l.pts)) && inside(l.pts[0], o.pts)).length; });
    return { loops };
  }
  function sketchProblem(p) { const r = sketchLoops(p.sketch, 32); if (r.problem) return r.problem; if (p.type === 'revolve') return revolveFrame(p, r.loops).problem || ''; return ''; }

  // Region integral of u^a·v^b over the material, by Green's theorem: ∬ u^a v^b dA = ∮ u^(a+1) v^b/(a+1) dv.
  // Each straight edge is integrated exactly with 3-point Gauss–Legendre (integrands here are degree ≤ 5).
  function regionMoment(loops, a, b) {
    const x = Math.sqrt(3 / 5), gt = [(1 - x) / 2, 0.5, (1 + x) / 2], gw = [5 / 18, 8 / 18, 5 / 18];
    let total = 0;
    for (const l of loops) {
      let g = 0; const P = l.pts, m = P.length;
      for (let i = 0; i < m; i++) {
        const p = P[i], q = P[(i + 1) % m], du = q[0] - p[0], dv = q[1] - p[1];
        if (!dv) continue;
        for (let k = 0; k < 3; k++) { const u = p[0] + gt[k] * du, v = p[1] + gt[k] * dv; g += gw[k] * u ** (a + 1) * v ** b / (a + 1) * dv; }
      }
      total += (l.depth % 2 ? -1 : 1) * Math.sign(signedArea(P)) * g;
    }
    return total;
  }
  // Inertia about the centroid from volume and second moments about the origin (all per unit density).
  function inertiaFrom(V, c, S) {
    const [x, y, z] = c;
    return [[S.yy + S.zz - V * (y * y + z * z), -(S.xy - V * x * y), -(S.xz - V * x * z)],
            [-(S.xy - V * x * y), S.xx + S.zz - V * (x * x + z * z), -(S.yz - V * y * z)],
            [-(S.xz - V * x * z), -(S.yz - V * y * z), S.xx + S.yy - V * (x * x + y * y)]];
  }
  // Revolve axis: 'v' turns the profile about the sketch's v axis (radius = u), 'u' about its u axis (radius = v).
  // A profile entirely on the negative side is turned from 180° so the solid lands where it was drawn.
  function revolveFrame(p, loops) {
    const ax = p.axis === 'u' ? 'u' : 'v', ri = ax === 'v' ? 0 : 1;
    let lo = Infinity, hi = -Infinity;
    for (const l of loops) for (const q of l.pts) { lo = Math.min(lo, q[ri]); hi = Math.max(hi, q[ri]); }
    if (lo < -1e-9 && hi > 1e-9) return { problem: `The profile crosses the revolve axis (${ax === 'v' ? 'V' : 'U'}); keep it on one side` };
    const flip = hi <= 1e-9 ? -1 : 1;
    // axis frame (x, y, z) = (r cosφ, a, −r sinφ) → sketch frame
    const M = ax === 'v' ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : [[0, 1, 0], [1, 0, 0], [0, 0, -1]];
    const toRA = l => ({ pts: l.pts.map(q => [flip * q[ri], q[1 - ri]]), smooth: l.smooth, depth: l.depth, perim: l.perim });
    return { M, flip, phi0: flip < 0 ? PI : 0, toRA };
  }
  function planeOf(sk) { return PLANES[sk.plane] || PLANES.ground; }

  // Exact properties of an extrude or revolve, in the part's local frame (sketch geometry minus p.base).
  function sketchProps(p) {
    const L = sketchLoops(p.sketch, EXACT_N); if (L.problem) return null;
    const P = planeOf(p.sketch).P, off = +p.sketch.offset || 0, base = p.base || [0, 0, 0];
    let V, A, cS, IS, T, shiftW;
    if (p.type === 'extrude') {
      const loops = L.loops, d = p.dims.d, w0 = off + Math.min(0, d), w1 = off + Math.max(0, d), h = w1 - w0;
      const Ar = regionMoment(loops, 0, 0), Su = regionMoment(loops, 1, 0), Sv = regionMoment(loops, 0, 1);
      const Suu = regionMoment(loops, 2, 0), Svv = regionMoment(loops, 0, 2), Suv = regionMoment(loops, 1, 1);
      V = Ar * h; A = 2 * Ar + loops.reduce((s, l) => s + l.perim, 0) * h;
      cS = [Su / Ar, Sv / Ar, (w0 + w1) / 2];
      const W2 = (w1 * w1 - w0 * w0) / 2;
      IS = inertiaFrom(V, cS, { xx: Suu * h, yy: Svv * h, zz: Ar * (w1 ** 3 - w0 ** 3) / 3, xy: Suv * h, xz: Su * W2, yz: Sv * W2 });
      T = P; shiftW = [0, 0, 0];
    } else {
      const F = revolveFrame(p, L.loops); if (F.problem) return null;
      const loops = L.loops.map(F.toRA), th = p.dims.angle * PI / 180, f0 = F.phi0, f1 = f0 + th;
      const R1 = regionMoment(loops, 1, 0), R2 = regionMoment(loops, 2, 0), R3 = regionMoment(loops, 3, 0);
      const RY = regionMoment(loops, 1, 1), RY2 = regionMoment(loops, 1, 2), R2Y = regionMoment(loops, 2, 1), Ar = regionMoment(loops, 0, 0);
      const C = Math.sin(f1) - Math.sin(f0), S = Math.cos(f0) - Math.cos(f1);          // ∫cosφ, ∫sinφ
      const CC = th / 2 + (Math.sin(2 * f1) - Math.sin(2 * f0)) / 4, SS = th / 2 - (Math.sin(2 * f1) - Math.sin(2 * f0)) / 4, SC = (Math.sin(f1) ** 2 - Math.sin(f0) ** 2) / 2;
      V = th * R1;   // Pappus
      // lateral area by Pappus on the boundary (∫ r ds; edges on the axis add nothing), plus the two caps of a partial turn
      let rds = 0;
      for (const l of loops) { const g = l.perim / loopLen(l.pts); for (let i = 0; i < l.pts.length; i++) { const a = l.pts[i], b = l.pts[(i + 1) % l.pts.length]; rds += g * Math.hypot(b[0] - a[0], b[1] - a[1]) * (a[0] + b[0]) / 2; } }
      A = th * rds + (th < 2 * PI - 1e-12 ? 2 * Ar : 0);
      cS = [C * R2 / V, RY / R1, -S * R2 / V];
      IS = inertiaFrom(V, cS, { xx: R3 * CC, yy: th * RY2, zz: R3 * SS, xy: C * R2Y, yz: -S * R2Y, xz: -R3 * SC });
      T = Core_mulMM(P, F.M); shiftW = [0, 0, off];
    }
    // sketch-frame → world: T·x (+ plane offset for revolves, already inside w for extrudes), then minus base
    const cW = Core_mulMV(P, shiftW).map((v, i) => v + Core_mulMV(T, cS)[i] - base[i]);
    return { V, A, c: cW, I: Core_mulMM(Core_mulMM(T, IS), Core_T(T)) };
  }
  function loopLen(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; }

  // Mesh of an extrude or revolve (local frame). Caps need a polygon-with-holes triangulator, supplied by the app
  // (three.js ShapeUtils) through setTriangulator: (contour, holes) → [[i, j, k], …] into contour.concat(...holes).
  let triangulator = null;
  function setTriangulator(fn) { triangulator = fn; }
  function regions(loops) {
    return loops.filter(l => l.depth % 2 === 0).map(o => ({ outer: o, holes: loops.filter(h => h.depth === o.depth + 1 && inside(h.pts[0], o.pts)) }));
  }
  function capTris(reg) {   // triangles of one region, counterclockwise in its own 2D frame
    const all = reg.outer.pts.concat(...reg.holes.map(h => h.pts));
    const tris = triangulator(reg.outer.pts, reg.holes.map(h => h.pts));
    return tris.map(t => { const [a, b, c] = t.map(i => all[i]); return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= 0 ? [a, b, c] : [a, c, b]; });
  }
  function sketchMesh(p, seg) {
    const L = sketchLoops(p.sketch, seg); if (L.problem || !triangulator) return { pos: [], nrm: [] };
    const P = planeOf(p.sketch).P, off = +p.sketch.offset || 0, base = p.base || [0, 0, 0], pos = [], nrm = [];
    let T, add;
    if (p.type === 'extrude') {
      const d = p.dims.d, w0 = off + Math.min(0, d), w1 = off + Math.max(0, d);
      for (const reg of regions(L.loops)) for (const [a, b, c] of capTris(reg)) {
        pos.push(a[0], a[1], w1, b[0], b[1], w1, c[0], c[1], w1); nrm.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
        pos.push(a[0], a[1], w0, c[0], c[1], w0, b[0], b[1], w0); nrm.push(0, 0, -1, 0, 0, -1, 0, 0, -1);
      }
      for (const l of L.loops) {
        const N = loopNormals(l.pts, l.smooth, l.depth % 2 === 1), m = l.pts.length;
        for (let i = 0; i < m; i++) {
          const p0 = l.pts[i], q0 = l.pts[(i + 1) % m], ns = [...N.start[i], 0], ne = [...N.end[i], 0];
          let v = [[p0[0], p0[1], w0], [q0[0], q0[1], w0], [q0[0], q0[1], w1], [p0[0], p0[1], w1]], nn = [ns, ne, ne, ns];
          if (N.sgn < 0) { v = [v[1], v[0], v[3], v[2]]; nn = [ne, ns, ns, ne]; }    // keep the quad facing out of the loop
          for (const t of [[0, 1, 2], [0, 2, 3]]) for (const j of t) { pos.push(...v[j]); nrm.push(...nn[j]); }
        }
      }
      T = P; add = [0, 0, 0];
    } else {
      const F = revolveFrame(p, L.loops); if (F.problem) return { pos: [], nrm: [] };
      const loops = L.loops.map(F.toRA), th = p.dims.angle * PI / 180;
      for (const l of loops) {
        const m = lathe(l.pts.map((q, i) => ({ r: Math.max(0, q[0]), y: q[1], smooth: l.smooth[i] })), seg, F.phi0, th, l.depth % 2 === 1);
        for (let i = 0; i < m.pos.length; i++) { pos.push(m.pos[i]); nrm.push(m.nrm[i]); }
      }
      if (th < 2 * PI - 1e-12) {
        const put = (q, f) => [q[0] * Math.cos(f), q[1], -q[0] * Math.sin(f)], f0 = F.phi0, f1 = f0 + th;
        const n0 = [-Math.sin(f0), 0, -Math.cos(f0)].map(x => -x), n1 = [-Math.sin(f1), 0, -Math.cos(f1)];   // −sweep at start, +sweep at end
        for (const reg of regions(loops)) for (const [a, b, c] of capTris(reg)) {
          const s0 = [put(a, f0), put(b, f0), put(c, f0)], s1 = [put(a, f1), put(b, f1), put(c, f1)];
          const face = (tri, want) => { const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])); return n[0] * want[0] + n[1] * want[1] + n[2] * want[2] >= 0 ? tri : [tri[0], tri[2], tri[1]]; };
          for (const v of face(s0, n0)) { pos.push(...v); nrm.push(...n0); }
          for (const v of face(s1, n1)) { pos.push(...v); nrm.push(...n1); }
        }
      }
      T = Core_mulMM(P, F.M); add = Core_mulMV(P, [0, 0, off]);
    }
    const t = add.map((v, i) => v - base[i]), outP = transformPos(pos, T, t), outN = transformPos(nrm, T, [0, 0, 0]);
    return { pos: outP, nrm: outN };
  }
  // Center of an extrude/revolve's sketch geometry in world terms (becomes p.base, so the part's origin sits there).
  function sketchCenter(p, seg) {
    const q = Object.assign({}, p, { base: [0, 0, 0] }), m = sketchMesh(q, seg || 32).pos;
    if (!m.length) return [0, 0, 0];
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.length; i++) { const k = i % 3; lo[k] = Math.min(lo[k], m[i]); hi[k] = Math.max(hi[k], m[i]); }
    return lo.map((v, k) => Math.round((v + hi[k]) / 2 * 1e6) / 1e6);
  }
  // Filled-profile triangles in sketch (u, v), for showing material vs holes while sketching; null if the sketch has a problem.
  function sketchFill(sk, seg) {
    const L = sketchLoops(sk, seg || 64); if (L.problem || !triangulator) return null;
    const out = []; for (const reg of regions(L.loops)) for (const t of capTris(reg)) for (const q of t) out.push(q[0], q[1]);
    return out;
  }
  const Core_mulMV = (M, v) => mulMV(M, v), Core_mulMM = (A, B) => mulMM(A, B), Core_T = A => T(A);


  // ---------- solid booleans (CSG on meshes) ----------
  // BSP-tree constructive solid geometry (the classic Naylor/Thibault scheme as popularized by csg.js), written here
  // iteratively so tall trees from curved parts cannot overflow the stack. Inputs and outputs are triangle meshes.
  const CSG_EPS = 1e-5;
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  function polyOf(verts, plane) { return { verts, plane }; }
  function flipPoly(q) { return { verts: q.verts.slice().reverse().map(v => ({ p: v.p, n: [-v.n[0], -v.n[1], -v.n[2]] })), plane: { n: q.plane.n.map(x => -x), w: -q.plane.w } }; }
  function splitPoly(pl, q, cf, cb, f, b) {
    const types = []; let all = 0;
    for (const v of q.verts) { const t = dot3(pl.n, v.p) - pl.w, ty = t < -CSG_EPS ? 2 : t > CSG_EPS ? 1 : 0; all |= ty; types.push(ty); }
    if (all === 0) (dot3(pl.n, q.plane.n) > 0 ? cf : cb).push(q);
    else if (all === 1) f.push(q);
    else if (all === 2) b.push(q);
    else {
      const fs = [], bs = [], m = q.verts.length;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m, ti = types[i], tj = types[j], vi = q.verts[i], vj = q.verts[j];
        if (ti !== 2) fs.push(vi);
        if (ti !== 1) bs.push(vi);
        if ((ti | tj) === 3) {
          const t = (pl.w - dot3(pl.n, vi.p)) / dot3(pl.n, sub(vj.p, vi.p));
          const v = { p: vi.p.map((x, k) => x + (vj.p[k] - x) * t), n: vi.n.map((x, k) => x + (vj.n[k] - x) * t) };
          fs.push(v); bs.push(v);
        }
      }
      if (fs.length >= 3) f.push(polyOf(fs, q.plane));
      if (bs.length >= 3) b.push(polyOf(bs, q.plane));
    }
  }
  function Node(polys) { this.plane = null; this.front = null; this.back = null; this.polygons = []; if (polys) this.build(polys); }
  Node.prototype.nodes = function () { const out = [], st = [this]; while (st.length) { const n = st.pop(); out.push(n); if (n.front) st.push(n.front); if (n.back) st.push(n.back); } return out; };
  Node.prototype.build = function (polys) {
    const st = [[this, polys]];
    while (st.length) {
      const [n, ps] = st.pop(); if (!ps.length) continue;
      if (!n.plane) n.plane = ps[0].plane;
      const f = [], b = [];
      for (const q of ps) splitPoly(n.plane, q, n.polygons, n.polygons, f, b);
      if (f.length) { n.front = n.front || new Node(); st.push([n.front, f]); }
      if (b.length) { n.back = n.back || new Node(); st.push([n.back, b]); }
    }
  };
  Node.prototype.clip = function (polys) {   // keep the parts of polys outside this solid
    const out = [], st = [[this, polys]];
    while (st.length) {
      const [n, ps] = st.pop();
      if (!n.plane) { for (const q of ps) out.push(q); continue; }
      const f = [], b = [];
      for (const q of ps) splitPoly(n.plane, q, f, b, f, b);
      if (n.front) st.push([n.front, f]); else for (const q of f) out.push(q);
      if (n.back) st.push([n.back, b]);
    }
    return out;
  };
  Node.prototype.clipTo = function (bsp) { for (const n of this.nodes()) n.polygons = bsp.clip(n.polygons); };
  Node.prototype.invert = function () {
    for (const n of this.nodes()) { n.polygons = n.polygons.map(flipPoly); if (n.plane) n.plane = { n: n.plane.n.map(x => -x), w: -n.plane.w }; const t = n.front; n.front = n.back; n.back = t; }
  };
  Node.prototype.all = function () { const out = []; for (const n of this.nodes()) for (const q of n.polygons) out.push(q); return out; };
  function meshToPolys(m) {
    const P = m.pos, N = m.nrm, out = [];
    for (let i = 0; i + 8 < P.length; i += 9) {
      const a = [P[i], P[i + 1], P[i + 2]], b = [P[i + 3], P[i + 4], P[i + 5]], c = [P[i + 6], P[i + 7], P[i + 8]];
      const nn = cross(sub(b, a), sub(c, a)), L = norm(nn); if (!(L > 1e-12)) continue;
      const n = nn.map(x => x / L), vn = k => N && N.length === P.length ? [N[i + 3 * k], N[i + 3 * k + 1], N[i + 3 * k + 2]] : n;
      out.push(polyOf([{ p: a, n: vn(0) }, { p: b, n: vn(1) }, { p: c, n: vn(2) }], { n, w: dot3(n, a) }));
    }
    return out;
  }
  function polysToMesh(polys) {
    const pos = [], nrm = [];
    for (const q of polys) for (let k = 1; k + 1 < q.verts.length; k++) for (const v of [q.verts[0], q.verts[k], q.verts[k + 1]]) { pos.push(v.p[0], v.p[1], v.p[2]); nrm.push(v.n[0], v.n[1], v.n[2]); }
    return { pos, nrm };
  }
  function csg(op, A, B) {
    const a = new Node(meshToPolys(A)), b = new Node(meshToPolys(B));
    if (op === 'union') { a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.all()); }
    else if (op === 'subtract') { a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.all()); a.invert(); }
    else { a.invert(); b.clipTo(a); b.invert(); a.clipTo(b); b.clipTo(a); a.build(b.all()); a.invert(); }
    return polysToMesh(a.all());
  }

  // Raw moments (V, ∫x, ∫xxᵀ about the origin) add and subtract; centroidal props convert both ways.
  function toRaw(pr) {
    const V = pr.V, c = pr.c, I = pr.I, tr = (I[0][0] + I[1][1] + I[2][2]) / 2;
    return { V, S: c.map(x => x * V), J: [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? tr : 0) - I[i][j] + V * c[i] * c[j])) };
  }
  function fromRaw(r) {
    const V = r.V, c = V ? r.S.map(x => x / V) : [0, 0, 0], Jc = r.J.map((row, i) => row.map((x, j) => x - V * c[i] * c[j])), tr = Jc[0][0] + Jc[1][1] + Jc[2][2];
    return { V, c, I: Jc.map((row, i) => row.map((x, j) => (i === j ? tr : 0) - x)) };
  }
  const addRaw = (a, b, s) => ({ V: a.V + s * b.V, S: a.S.map((x, i) => x + s * b.S[i]), J: a.J.map((row, i) => row.map((x, j) => x + s * b.J[i][j])) });

  // A body is a list of features in its own frame: [{ op: 'base' | 'join' | 'cut', part }]. Each feature part keeps
  // its own pos/rot/base inside the body frame; the body's pos/rot/base then place the whole thing in the world.
  const memo = new Map();
  function remember(key, fn) { if (memo.has(key)) return memo.get(key); const v = fn(); memo.set(key, v); if (memo.size > 60) memo.delete(memo.keys().next().value); return v; }
  function featureMesh(part, seg, meshes) { return transformPos(partMesh(part, seg, meshes).pos, rotMatrix(part.rot), part.pos || [0, 0, 0]); }
  function featureMeshN(part, seg, meshes) { const m = partMesh(part, seg, meshes), R = rotMatrix(part.rot); return { pos: transformPos(m.pos, R, part.pos || [0, 0, 0]), nrm: m.nrm ? transformPos(m.nrm, R, [0, 0, 0]) : null }; }
  // Body mesh and density-1 props, both in the body frame (before the body's own base shift).
  function bodyEval(p, seg, meshes) {
    const key = JSON.stringify([p.children, seg, Object.keys(meshes || {}).length]);
    return remember(key, () => {
      let cur = null, raw = null, approx = false;
      const fs = Math.max(seg || 48, 96);   // mass-property booleans run finer than the display
      for (const ch of p.children) {
        const part = ch.part, model = { meshes };
        const lp = localProps(part, model), R = rotMatrix(part.rot), t = part.pos || [0, 0, 0];
        const pw = { V: lp.V, c: mulMV(R, lp.c).map((v, i) => v + t[i]), I: mulMM(mulMM(R, lp.I), T(R)) };
        const fineTool = featureMesh(part, fs, meshes), showTool = featureMeshN(part, seg, meshes);
        if (!cur) { cur = { show: showTool, fine: { pos: fineTool } }; raw = toRaw(pw); continue; }
        // overlap of this feature with the body so far: exact when it is all or nothing, else from the meshes
        const inter = meshProps(csg('intersect', cur.fine, { pos: fineTool }).pos), toolV = meshProps(fineTool).V, curV = meshProps(cur.fine.pos).V;
        let ov;
        if (inter.V <= 1e-9 * Math.max(toolV, 1)) ov = null;
        else if (Math.abs(inter.V - toolV) <= 1e-6 * toolV) ov = toRaw(pw);
        else if (Math.abs(inter.V - curV) <= 1e-6 * curV) ov = raw;
        else { ov = toRaw(inter); approx = true; }
        const op = ch.op === 'cut' ? 'subtract' : 'union';
        if (ch.op === 'cut') { if (ov) raw = addRaw(raw, ov, -1); }
        else { raw = addRaw(raw, toRaw(pw), 1); if (ov) raw = addRaw(raw, ov, -1); }
        cur = { show: csg(op, cur.show, showTool), fine: { pos: csg(op, cur.fine, { pos: fineTool }).pos } };
      }
      const pr = fromRaw(raw);
      return { mesh: cur.show, props: { V: pr.V, A: meshProps(cur.fine.pos).A, c: pr.c, I: pr.I, approx } };
    });
  }
  function bodyMesh(p, seg, meshes) {
    const e = bodyEval(p, seg, meshes), b = p.base || [0, 0, 0];
    return { pos: transformPos(e.mesh.pos, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], b.map(x => -x)), nrm: e.mesh.nrm };
  }
  function localProps(p, model) {
    if (p.type === 'mesh') return meshProps(partMesh(p, 0, model.meshes).pos);
    if (p.type === 'body') { const e = bodyEval(p, model.seg || 48, model.meshes).props, b = p.base || [0, 0, 0]; return { V: e.V, A: e.A, c: e.c.map((x, i) => x - b[i]), I: e.I, approx: e.approx }; }
    return exactProps(p);
  }
  // Re-express a world-placed part inside a body's frame (so it moves with the body afterward).
  function eulerXYZ(R) {
    const y = Math.asin(Math.max(-1, Math.min(1, R[0][2])));
    const [x, z] = Math.abs(R[0][2]) < 0.9999999 ? [Math.atan2(-R[1][2], R[2][2]), Math.atan2(-R[0][1], R[0][0])] : [Math.atan2(R[2][1], R[1][1]), 0];
    return [x, y, z].map(a => Math.round(a * 180 / PI * 1e6) / 1e6);
  }
  function intoBody(body, part) {
    const Rb = rotMatrix(body.rot), Rbt = T(Rb), pb = body.pos || [0, 0, 0], bb = body.base || [0, 0, 0];
    const q = JSON.parse(JSON.stringify(part));
    q.pos = mulMV(Rbt, sub(part.pos || [0, 0, 0], pb)).map((v, i) => Math.round((v + bb[i]) * 1e6) / 1e6);
    q.rot = eulerXYZ(mulMM(Rbt, rotMatrix(part.rot)));
    return q;
  }
  // Undo intoBody: place a feature part in the world with its body's transform.
  function outOfBody(body, part) {
    const Rb = rotMatrix(body.rot), pb = body.pos || [0, 0, 0], bb = body.base || [0, 0, 0], q = JSON.parse(JSON.stringify(part));
    q.pos = mulMV(Rb, sub(part.pos || [0, 0, 0], bb)).map((v, i) => Math.round((v + pb[i]) * 1e6) / 1e6);
    q.rot = eulerXYZ(mulMM(Rb, rotMatrix(part.rot)));
    return q;
  }
  // Volume shared by two placed parts (world frame), for deciding what a Join or Cut touches.
  function overlapVolume(a, b, model) {
    const ma = { pos: featureMesh(a, 32, model.meshes) }, mb = { pos: featureMesh(b, 32, model.meshes) };
    return meshProps(csg('intersect', ma, mb).pos).V;
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
    const local = localProps(p, model);
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

  return { TYPES, PLANES, MATERIALS, MAT, csg, intoBody, outOfBody, overlapVolume, localProps, eulerXYZ, setTriangulator, sketchLoops, sketchFill, sketchCenter, entLoop, regionMoment, defaultDims, dimProblem, exactProps, partMesh, meshProps, meshCheck, rotMatrix, transformPos, shift, eigSym,
    mulMV, mulMM, T, density, partInfo, solve, worldTriangles, stlBinary, parseSTL, centerMesh, gauss3 };
})();
if (typeof module !== 'undefined') module.exports = Core;
