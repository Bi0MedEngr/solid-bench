// Solid Bench — "show the math". Pure: model + solved result in, HTML sections out (collapsible <details>).
const Explain = (() => {
  'use strict';
  const f = (v, d = 4) => { if (!isFinite(v)) return '—'; const a = Math.abs(v); return a !== 0 && (a >= 1e6 || a < 1e-3) ? v.toExponential(d - 1) : (+v.toPrecision(d)).toString(); };
  const vec = v => `(${v.map(x => f(x, 5)).join(', ')})`;
  const mat = (M, d = 5) => M.map(r => `<div class="sub">[ ${r.map(x => f(Math.abs(x) < 1e-9 * Math.max(...M.flat().map(Math.abs)) ? 0 : x, d).padStart(11)).join(' ')} ]</div>`).join('');
  const sec = (title, body, open) => `<details${open ? ' open' : ''}><summary>${title}</summary>${body}</details>`;
  const eqs = lines => `<div class="eqs">${lines.join('<br>')}</div>`;

  // Closed-form formulas with this part's numbers substituted (density 1 → V-weighted, then × ρ).
  function formulas(p, info) {
    const d = p.dims, m = info.m, r = (s, v, u) => `${s} = <span class="res">${f(v, 6)} ${u}</span>`;
    const V = info.local.V, Ix = info.Ilocal[0][0], Iy = info.Ilocal[1][1], Iz = info.Ilocal[2][2];
    switch (p.type) {
      case 'box': return [`V = w·h·d = ${d.w}·${d.h}·${d.d}`, r('V', V, 'mm³'), `A = 2(wh + hd + wd)`, r('A', info.A, 'mm²'),
        `Ixx = m(h² + d²)/12, Iyy = m(w² + d²)/12, Izz = m(w² + h²)/12`, r('Ixx', Ix, 'g·mm²'), r('Iyy', Iy, 'g·mm²'), r('Izz', Iz, 'g·mm²')];
      case 'cylinder': return [`V = πr²h = π·${d.r}²·${d.h}`, r('V', V, 'mm³'), `A = 2πr² + 2πrh`, r('A', info.A, 'mm²'),
        `Iyy (axis) = mr²/2`, r('Iyy', Iy, 'g·mm²'), `Ixx = Izz = m(3r² + h²)/12`, r('Ixx', Ix, 'g·mm²')];
      case 'tube': return [`V = π(ro² − ri²)h = π(${d.ro}² − ${d.ri}²)·${d.h}`, r('V', V, 'mm³'), `A = 2π(ro² − ri²) + 2π(ro + ri)h`, r('A', info.A, 'mm²'),
        `Iyy (axis) = m(ro² + ri²)/2`, r('Iyy', Iy, 'g·mm²'), `Ixx = Izz = m[3(ro² + ri²) + h²]/12`, r('Ixx', Ix, 'g·mm²')];
      case 'sphere': return [`V = 4/3·πr³ = 4/3·π·${d.r}³`, r('V', V, 'mm³'), `A = 4πr²`, r('A', info.A, 'mm²'), `I = 2/5·mr² (every axis)`, r('I', Ix, 'g·mm²')];
      case 'cone': return [`Stacked disks, ρ(s) = r1 + (r2 − r1)·s/h, s = height above the base`,
        `V = ∫ πρ² ds = πh/3·(r1² + r1·r2 + r2²)`, r('V', V, 'mm³'),
        `ȳ = ∫ πρ²s ds / V = h(r1² + 2r1r2 + 3r2²) / 4(r1² + r1r2 + r2²)`, r('ȳ (above base)', info.local.c[1] + d.h / 2, 'mm'),
        `Iyy = ∫ πρ⁴/2 ds·ρ_mat`, r('Iyy', Iy, 'g·mm²'),
        `Ixx = ∫ πρ²(ρ²/4 + s²) ds·ρ_mat − m·ȳ²`, r('Ixx', Ix, 'g·mm²'),
        `<span class="sub">integrals by 3-point Gauss–Legendre, exact for these degree-4 polynomials</span>`,
        `A = π(r1 + r2)·√((r1 − r2)² + h²) + πr1² + πr2²`, r('A', info.A, 'mm²')];
      case 'torus': return [`V = 2π²Rr² = 2π²·${d.R}·${d.r}²`, r('V', V, 'mm³'), `A = 4π²Rr`, r('A', info.A, 'mm²'),
        `Iyy (axis) = m(R² + 3r²/4)`, r('Iyy', Iy, 'g·mm²'), `Ixx = Izz = m(R²/2 + 5r²/8)`, r('Ixx', Ix, 'g·mm²')];
      case 'mesh': return [`Imported mesh: properties from the triangles (divergence theorem, below)`, r('V', V, 'mm³'), r('A', info.A, 'mm²')];
    }
    return [];
  }

  function build(model, res, selId) {
    const out = [], idx = model.parts.findIndex(p => p.id === selId), p = model.parts[idx], info = idx >= 0 ? res.parts[idx] : null;
    if (p && info && !info.problem) {
      const rho = Core.density(p);
      out.push(sec(`${p.name}: closed-form properties`, `<p>${Core.TYPES[p.type].label} in its own frame: origin at the center of its bounding box${p.type === 'box' || p.type === 'mesh' ? '' : ', axis of revolution along local Y'}. Density ρ = ${f(rho)} g/cm³ = ${f(rho / 1000)} g/mm³.</p>` +
        eqs([...formulas(p, info), `m = ρV = ${f(rho / 1000)}·${f(info.V, 6)} = <span class="res">${f(info.m, 6)} g</span>`]), true));
      if (p.type !== 'mesh') {
        const mp = Core.meshProps(Core.partMesh(p, model.seg, model.meshes).pos), e = info.local, pct = (a, b) => b ? f(100 * (a - b) / b, 3) + ' %' : '—';
        out.push(sec('Check: integrate the displayed mesh', `<p>The same solid as drawn (${model.seg} facets around) integrated triangle by triangle with the divergence theorem. A faceted solid is slightly smaller than the true one, so a small negative error is expected; it shrinks as 1/n².</p>` +
          eqs([`V_mesh = Σ (1/6)·(v₀ · (v₁ × v₂))`, `V: exact ${f(e.V, 7)}  mesh ${f(mp.V, 7)}  → <span class="res">${pct(mp.V, e.V)}</span>`,
            `A: exact ${f(e.A, 7)}  mesh ${f(mp.A, 7)}  → <span class="res">${pct(mp.A, e.A)}</span>`,
            `Iyy/ρ: exact ${f(e.I[1][1], 7)}  mesh ${f(mp.I[1][1], 7)}  → <span class="res">${pct(mp.I[1][1], e.I[1][1])}</span>`])));
      } else {
        const ck = Core.meshCheck(Core.partMesh(p, 0, model.meshes).pos);
        out.push(sec('Mesh integrity', `<p>${ck.tris} triangles. ${ck.closed ? 'Every edge is shared by exactly two triangles, so the mesh is closed and its volume integrals are valid.' : `<b>Not watertight</b>: ${ck.open} open edges, ${ck.nonManifold} non-manifold edges. Volume and inertia of an open mesh are not meaningful.`}${ck.degenerate ? ` ${ck.degenerate} zero-area triangles skipped.` : ''}</p>`));
      }
      out.push(sec(`${p.name}: placed in the world`, `<p>Rotation R from the Euler angles (X, then Y, then Z: R = Rx·Ry·Rz). The centroid moves with the part; the inertia tensor turns with it.</p>` +
        eqs([`angles = (${p.rot.map(a => f(a)).join('°, ')}°)`, `R =`, mat(info.R, 5), `c_world = R·c_local + t = <span class="res">${vec(info.c)} mm</span>`,
          `I_world = R·I_local·Rᵀ  (g·mm², about the part centroid)`, mat(info.I, 6)])));
    } else if (p && info && info.problem) out.push(sec(p.name, `<p>${info.problem}.</p>`, true));

    const vis = model.parts.map((q, i) => [q, res.parts[i]]).filter(([q, r]) => q.visible !== false && !r.problem);
    if (vis.length) {
      const rows = vis.map(([q, r]) => `${q.name.padEnd(14).slice(0, 14)} m = ${f(r.m, 5).padStart(9)} g  c = ${vec(r.c)}`);
      out.push(sec('Assembly: mass and center of mass', `<p>Each visible part counts as a separate solid. Parts that overlap are counted twice (no boolean union yet).</p>` +
        eqs([...rows, `M = Σ mᵢ = <span class="res">${f(res.M, 6)} g</span>`, `C = Σ mᵢcᵢ / M = <span class="res">${vec(res.C)} mm</span>`]), !p));
      out.push(sec('Assembly: inertia about the center of mass', `<p>Parallel-axis theorem in tensor form for each part, offset dᵢ = cᵢ − C, then summed. Off-diagonal terms are the negated products of inertia.</p>` +
        eqs([`I_C = Σ [ I_world,i + mᵢ(|dᵢ|²E − dᵢdᵢᵀ) ]  (g·mm²)`, mat(res.I, 6),
          `Principal moments (Jacobi eigenvalues): <span class="res">${res.principal.values.map(v => f(v, 6)).join(', ')} g·mm²</span>`,
          ...res.principal.vectors.map((v, i) => `<span class="sub">axis ${i + 1}: ${vec(v)}</span>`),
          `Radius of gyration about principal axes: ${res.principal.values.map(v => f(Math.sqrt(Math.max(0, v) / res.M), 4)).join(', ')} mm`])));
      if (res.bbox) out.push(sec('Bounding box', `<p>From the displayed mesh vertices in world coordinates (curved surfaces are inscribed, so it can read a hair small).</p>` +
        eqs([`min ${vec(res.bbox.lo)} mm`, `max ${vec(res.bbox.hi)} mm`, `size <span class="res">${res.bbox.size.map(v => f(v, 5)).join(' × ')} mm</span>`])));
    }
    out.push(sec('Validation', `<p>Every formula here is checked by <code>tests/test_core.js</code> against textbook answers: each primitive's volume, area and inertia; the faceted mesh converging to the exact value; rotations matching three.js; R·I·Rᵀ + parallel axis matching a direct integration of a rotated, moved box; every example against a hand calculation; and STL round trips.</p>`));
    return out.join('');
  }
  return { build };
})();
if (typeof module !== 'undefined') module.exports = Explain;
