// Solid Bench — mesh file importers (3MF, OBJ). Pure: bytes or text in, bodies out, so node tests can run them.
// Each body is { name, pos } with pos a flat triangle array in mm, already in Solid Bench's Y-up frame.
const Importers = (() => {
  'use strict';

  // ---------- zip (just enough for 3MF: stored or deflated entries) ----------
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a zip-based 3MF file');
    const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged 3MF file');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loc = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      const start = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true), data = u8.subarray(start, start + csize);
      files[name] = { method, data };
      p += 46 + nlen + xlen + clen;
    }
    return {
      names: Object.keys(files),
      async text(name) {
        const f = files[name]; if (!f) return null;
        if (f.method === 0) return new TextDecoder().decode(f.data);
        if (f.method !== 8) throw new Error('3MF uses an unsupported compression');
        const out = await new Response(new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
        return new TextDecoder().decode(out);
      },
    };
  }

  // ---------- 3MF ----------
  // Core spec: <resources> holds <object>s with a <mesh> (vertices, triangles) or <components> (other objects with a
  // transform); <build> lists <item>s to print. Transforms are 3×4, row-vector convention ("m00 m01 m02 m10 … m32").
  // 3MF is Z-up (the build plate), so every point turns (x, y, z) → (x, z, −y).
  const UNIT_MM = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
  const attr = (s, k) => { const m = new RegExp('\\b' + k + '\\s*=\\s*"([^"]*)"').exec(s); return m ? m[1] : null; };
  const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  function parseXf(s) { if (!s) return IDENT; const v = s.trim().split(/\s+/).map(Number); return v.length === 12 && v.every(isFinite) ? v : IDENT; }
  function mulXf(a, b) {   // apply a, then b (row vectors: p·A·B)
    const M = (t, r, c) => t[r * 3 + c];   // rows 0-2 = linear part, row 3 = translation
    const o = new Array(12);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = M(a, r, 0) * M(b, 0, c) + M(a, r, 1) * M(b, 1, c) + M(a, r, 2) * M(b, 2, c) + (r === 3 ? M(b, 3, c) : 0);
    return o;
  }
  async function parse3MF(buf) {
    const z = await unzip(buf);
    let modelName = z.names.find(n => /^3D\/.*\.model$/i.test(n));
    const rels = await z.text('_rels/.rels');
    if (rels) { const m = /Target\s*=\s*"\/?([^"]+\.model)"/i.exec(rels); if (m && z.names.includes(m[1])) modelName = m[1]; }
    if (!modelName) throw new Error('This 3MF has no 3D model inside');
    const xml = await z.text(modelName);
    const scale = UNIT_MM[attr(/<model\b[^>]*>/i.exec(xml)[0], 'unit') || 'millimeter'] || 1;
    const objects = {};
    for (const m of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/gi)) {
      const id = attr(m[1], 'id'), name = attr(m[1], 'name'), body = m[2];
      const o = { name, verts: null, tris: null, comps: [] };
      const mesh = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/i.exec(body);
      if (mesh) {
        o.verts = []; o.tris = [];
        for (const v of mesh[1].matchAll(/<vertex\b([^>]*)\/?>/gi)) o.verts.push(+attr(v[1], 'x'), +attr(v[1], 'y'), +attr(v[1], 'z'));
        for (const t of mesh[1].matchAll(/<triangle\b([^>]*)\/?>/gi)) o.tris.push(+attr(t[1], 'v1'), +attr(t[1], 'v2'), +attr(t[1], 'v3'));
      }
      for (const c of body.matchAll(/<component\b([^>]*)\/?>/gi)) o.comps.push({ id: attr(c[1], 'objectid'), xf: parseXf(attr(c[1], 'transform')) });
      objects[id] = o;
    }
    const bodies = [];
    const emit = (id, xf, label, depth) => {
      const o = objects[id]; if (!o || depth > 16) return;
      const nm = o.name || label;
      if (o.verts) {
        const pos = [];
        for (const i of o.tris) {
          const x = o.verts[3 * i], y = o.verts[3 * i + 1], z = o.verts[3 * i + 2];
          const X = x * xf[0] + y * xf[3] + z * xf[6] + xf[9], Y = x * xf[1] + y * xf[4] + z * xf[7] + xf[10], Z = x * xf[2] + y * xf[5] + z * xf[8] + xf[11];
          pos.push(X * scale, Z * scale, -Y * scale);
        }
        if (pos.length) bodies.push({ name: nm, pos });
      }
      o.comps.forEach((c, k) => emit(c.id, mulXf(c.xf, xf), `${nm} ${k + 1}`, depth + 1));
    };
    const items = [...xml.matchAll(/<item\b([^>]*)\/?>/gi)];
    items.forEach((it, k) => emit(attr(it[1], 'objectid'), parseXf(attr(it[1], 'transform')), `Body ${k + 1}`, 0));
    if (!bodies.length) throw new Error('This 3MF has no printable bodies');
    return { bodies, unit: Object.keys(UNIT_MM).find(k => UNIT_MM[k] === scale) || 'millimeter' };
  }

  // ---------- OBJ ----------
  // v x y z, f a b c … (v, v/vt, v//vn, v/vt/vn, negative indices), o/g start a new body. Faces fan-triangulate.
  // OBJ has no units or up axis: read as mm, Y-up (Fusion and SolidWorks both write Y-up OBJ by default).
  function parseOBJ(text) {
    const verts = [], bodies = []; let cur = null;
    const start = name => { cur = { name, pos: [] }; bodies.push(cur); };
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim(); if (!line || line[0] === '#') continue;
      const parts = line.split(/\s+/), k = parts[0];
      if (k === 'v') verts.push([+parts[1], +parts[2], +parts[3]]);
      else if (k === 'o' || k === 'g') { const nm = parts.slice(1).join(' ') || `Body ${bodies.length + 1}`; if (!cur || cur.pos.length) start(nm); else cur.name = nm; }
      else if (k === 'f') {
        if (!cur) start('Body 1');
        const idx = parts.slice(1).map(t => { const i = parseInt(t.split('/')[0], 10); return i < 0 ? verts.length + i : i - 1; });
        if (idx.some(i => !(i >= 0 && i < verts.length))) throw new Error('This OBJ refers to a vertex that does not exist');
        for (let j = 1; j + 1 < idx.length; j++) for (const i of [idx[0], idx[j], idx[j + 1]]) cur.pos.push(...verts[i]);
      }
    }
    const out = bodies.filter(b => b.pos.length);
    if (!out.length) throw new Error('This OBJ has no faces');
    return { bodies: out, unit: 'millimeter' };
  }

  return { unzip, parse3MF, parseOBJ };
})();
if (typeof module !== 'undefined') module.exports = Importers;
