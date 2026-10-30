// Solid Bench — UI. Model → Core.solve → inspector + three.js scene. Autosaves to localStorage; files go through the
// claude.ai `downloads` capability inside an artifact and a plain browser download elsewhere.
(() => {
  'use strict';
  const STORE_KEY = 'solid-bench:model:v1', UI_KEY = 'solid-bench:ui:v1';
  const $ = s => document.querySelector(s);
  const DEG = Math.PI / 180;
  let model, res, downloads = null, selId = null, tool = 'select', dragStart = null, storeWarned = false;
  const undoStack = [], redoStack = [];
  const PALETTE = ['#7b93c9', '#d9825b', '#6fb38a', '#c9a24a', '#a07cc4', '#5fa9b8', '#c46d8a', '#8a9399'];
  const ui = { ortho: false, edges: true, snap: 5 };
  try { Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY)) || {}); } catch (e) { /* storage unavailable */ }

  // ---------- helpers ----------
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3200); }
  function fmt(v, sig = 5) {
    if (!isFinite(v)) return '—';
    const a = Math.abs(v); if (a < 1e-9) return '0';   // round-off from rotations, not a real offset
    if (a >= 1e9 || a < 1e-4) return v.toExponential(sig - 1);
    return (+v.toPrecision(sig)).toLocaleString('en-US', { maximumFractionDigits: 6 });
  }
  const r3 = v => Math.round(v * 1000) / 1000;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const sel = () => model.parts.find(p => p.id === selId) || null;
  const newId = () => 'p' + Math.random().toString(36).slice(2, 8);
  const snapshot = () => JSON.stringify({ seg: model.seg, parts: model.parts, selId });
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(model)); }
    catch (e) { if (!storeWarned) { storeWarned = true; toast('This model is too large to autosave in the browser. Use File → Save model.'); } }
  }
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* storage unavailable */ } }

  // ---------- model edits ----------
  function edit(fn) { undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift(); redoStack.length = 0; fn(); update(); }
  function restore(s) { const o = JSON.parse(s); model.seg = o.seg; model.parts = o.parts; selId = model.parts.some(p => p.id === o.selId) ? o.selId : null; update(); }
  function update(opts) {
    res = Core.solve(model); persist();
    syncScene(); renderParts(); if (!(opts && opts.keepInspector)) renderInspector(); else refreshInspectorValues(); renderOutputs();
    if ($('#math').classList.contains('open')) renderMath();
    requestRender();
  }
  function addPart(type) {
    const dims = Core.defaultDims(type);
    const halfH = { box: dims.h / 2, cylinder: dims.h / 2, tube: dims.h / 2, sphere: dims.r, cone: dims.h / 2, torus: dims.r }[type];
    let x = 0;
    if (res && res.bbox && res.count) { const halfW = { box: dims.w / 2, torus: dims.R + dims.r }[type] || (dims.r || dims.ro || dims.r1); x = res.bbox.hi[0] + halfW + 10; if (ui.snap > 0) x = Math.ceil(x / ui.snap) * ui.snap; }
    const n = model.parts.filter(p => p.type === type).length + 1;
    const p = { id: newId(), name: `${Core.TYPES[type].label} ${n}`, type, dims, pos: [r3(x), halfH, 0], rot: [0, 0, 0], mat: 'al6061', color: PALETTE[model.parts.length % PALETTE.length], visible: true };
    edit(() => { model.parts.push(p); selId = p.id; });
    if (tool === 'select' || tool === 'measure') setTool('move');
    toast(`Added ${p.name}. Drag the arrows to move it, or type exact numbers on the right.`);
  }
  function duplicate() {
    const p = sel(); if (!p) return;
    const q = JSON.parse(JSON.stringify(p)); q.id = newId(); q.name = p.name.replace(/( copy( \d+)?)?$/, ' copy');
    const b = res.bbox; q.pos = [r3(p.pos[0] + (b ? Math.max(10, Math.min(60, b.size[0] * 0.3)) : 20)), p.pos[1], p.pos[2]];
    edit(() => { model.parts.push(q); selId = q.id; });
  }
  function removeSel() { const p = sel(); if (!p) return; edit(() => { model.parts = model.parts.filter(q => q !== p); selId = null; }); toast(`Deleted ${p.name}. Undo brings it back.`); }
  function partBox(p) {   // world bounding box of one part (from its display mesh)
    const w = Core.transformPos(Core.partMesh(p, model.seg, model.meshes).pos, Core.rotMatrix(p.rot), p.pos);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < w.length; i++) { const k = i % 3; lo[k] = Math.min(lo[k], w[i]); hi[k] = Math.max(hi[k], w[i]); }
    return { lo, hi };
  }
  function dropToGrid() { const p = sel(); if (!p || Core.dimProblem(p)) return; const b = partBox(p); edit(() => { p.pos[1] = r3(p.pos[1] - b.lo[1]); }); }

  // ---------- three.js scene ----------
  const cv = $('#cv');
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;
  const col = c => new THREE.Color(c).convertSRGBToLinear();   // CSS colors are sRGB; the renderer works in linear
  const scene = new THREE.Scene();
  const persp = new THREE.PerspectiveCamera(35, 1, 0.5, 20000);
  const ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, -20000, 20000);
  let cam = ui.ortho ? ortho : persp;
  for (const c of [persp, ortho]) { scene.add(c); const key = new THREE.DirectionalLight(0xffffff, 0.75); key.position.set(0.5, 1, 0.8); c.add(key); }
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 0.55));
  const orbit = new THREE.OrbitControls(cam, cv);
  orbit.screenSpacePanning = true; orbit.zoomSpeed = 1.1;
  orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  const gizmo = new THREE.TransformControls(cam, cv);
  gizmo.setSize(0.85); gizmo.setRotationSnap(15 * DEG);
  scene.add(gizmo);
  const world = new THREE.Group(); scene.add(world);
  const helpers = new THREE.Group(); scene.add(helpers);
  const objs = new Map();   // part id → { mesh, edges, key }

  function buildHelpers() {
    helpers.clear();
    const minor = new THREE.GridHelper(1000, 100, col(css('--grid-minor')), col(css('--grid-minor'))), major = new THREE.GridHelper(1000, 20, col(css('--grid-major')), col(css('--grid-major')));
    for (const g of [minor, major]) { g.material.transparent = true; g.material.opacity = 0.9; g.material.depthWrite = false; g.renderOrder = -1; helpers.add(g); }
    minor.position.y = -0.01; major.position.y = -0.005;
    const axis = (to, color) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), to]), new THREE.LineBasicMaterial({ color: col(color), depthTest: false, transparent: true, opacity: 0.85 }));
    helpers.add(axis(new THREE.Vector3(40, 0, 0), css('--ax-x')), axis(new THREE.Vector3(0, 40, 0), css('--ax-y')), axis(new THREE.Vector3(0, 0, 40), css('--ax-z')));
    for (const o of objs.values()) o.edges.material.color.copy(col(o.mesh.userData.id === selId ? css('--accent') : css('--edge')));
    measureGroup.children.forEach(c => c.material && c.material.color && c.material.color.copy(col(css('--measure'))));
  }
  function geomKey(p) { return p.type + JSON.stringify(p.dims) + (p.type === 'mesh' ? p.mesh : model.seg); }
  function syncScene() {
    const seen = new Set();
    for (const p of model.parts) {
      seen.add(p.id);
      let o = objs.get(p.id);
      const bad = !!Core.dimProblem(p);
      if (!o) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: col(p.color), roughness: 0.55, metalness: 0.08, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
        const edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: col(css('--edge')), transparent: true, opacity: 0.55 }));
        mesh.add(edges); mesh.userData.id = p.id; world.add(mesh);
        o = { mesh, edges, key: '' }; objs.set(p.id, o);
      }
      const key = geomKey(p);
      if (o.key !== key && !bad) {
        const m = Core.partMesh(p, model.seg, model.meshes), g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
        if (m.nrm) g.setAttribute('normal', new THREE.Float32BufferAttribute(m.nrm, 3)); else g.computeVertexNormals();
        g.computeBoundingSphere();
        o.mesh.geometry.dispose(); o.mesh.geometry = g;
        o.edges.geometry.dispose(); o.edges.geometry = new THREE.EdgesGeometry(g, 28);
        o.key = key;
      }
      o.mesh.position.set(...p.pos); o.mesh.rotation.set(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG, 'XYZ');
      o.mesh.visible = p.visible !== false && !bad;
      o.mesh.material.color.copy(col(p.color));
      const isSel = p.id === selId;
      o.mesh.material.emissive.copy(col(isSel ? css('--accent') : '#000000')); o.mesh.material.emissiveIntensity = isSel ? 0.12 : 0;
      o.edges.visible = ui.edges || isSel;
      o.edges.material.color.copy(col(isSel ? css('--accent') : css('--edge'))); o.edges.material.opacity = isSel ? 1 : 0.55;
    }
    for (const [id, o] of objs) if (!seen.has(id)) { world.remove(o.mesh); o.mesh.geometry.dispose(); o.edges.geometry.dispose(); objs.delete(id); }
    attachGizmo();
  }
  function attachGizmo() {
    const o = selId && objs.get(selId);
    if (o && o.mesh.visible && (tool === 'move' || tool === 'rotate')) {
      if (gizmo.object !== o.mesh) gizmo.attach(o.mesh);
      gizmo.setMode(tool === 'move' ? 'translate' : 'rotate');
      gizmo.setTranslationSnap(ui.snap > 0 ? ui.snap : null);
    } else if (gizmo.object) gizmo.detach();
  }
  gizmo.addEventListener('dragging-changed', e => {
    orbit.enabled = !e.value;
    if (e.value) dragStart = snapshot();
    else if (dragStart) { const before = dragStart; dragStart = null; if (before !== snapshot()) { undoStack.push(before); redoStack.length = 0; } update(); }
  });
  gizmo.addEventListener('objectChange', () => {
    const p = sel(), m = gizmo.object; if (!p || !m) return;
    p.pos = [r3(m.position.x), r3(m.position.y), r3(m.position.z)];
    p.rot = [r3(m.rotation.x / DEG), r3(m.rotation.y / DEG), r3(m.rotation.z / DEG)];
    if (!liveQueued) { liveQueued = true; requestAnimationFrame(() => { liveQueued = false; res = Core.solve(model); refreshInspectorValues(); renderOutputs(); }); }
  });
  let liveQueued = false;

  // ---------- rendering, cameras, views ----------
  let renderQueued = false;
  function requestRender() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderer.render(scene, cam); drawTriad(); }); } }
  orbit.addEventListener('change', requestRender); gizmo.addEventListener('change', requestRender);
  function resize() {
    const r = cv.getBoundingClientRect(); if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    persp.aspect = r.width / r.height; persp.updateProjectionMatrix();
    const halfH = (ortho.top - ortho.bottom) / 2; ortho.left = -halfH * persp.aspect; ortho.right = halfH * persp.aspect; ortho.updateProjectionMatrix();
    requestRender();
  }
  function sceneSphere() {
    if (!res || !res.bbox) return { c: new THREE.Vector3(0, 20, 0), r: 60 };
    const { lo, hi } = res.bbox, c = new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
    return { c, r: Math.max(10, 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])) };
  }
  const VIEWS = { iso: [1, 0.8, 1.1], front: [0, 0, 1], top: [0, 1, 1e-4], right: [1, 0, 0] };
  function setView(name) {
    const { c, r } = sceneSphere();
    const dir = name === 'fit' ? cam.position.clone().sub(orbit.target).normalize() : new THREE.Vector3(...VIEWS[name]).normalize();
    const dist = r / Math.sin(persp.fov * DEG / 2) * 1.08;
    persp.position.copy(c).addScaledVector(dir, dist); ortho.position.copy(persp.position);
    const halfH = r * 1.1; ortho.top = halfH; ortho.bottom = -halfH; ortho.zoom = 1; resize();
    for (const k of [persp, ortho]) k.lookAt(c);
    orbit.target.copy(c); orbit.update(); requestRender();
  }
  function setOrtho(on) {
    if (on === (cam === ortho)) return;
    const dist = cam.position.distanceTo(orbit.target);
    if (on) { const halfH = dist * Math.tan(persp.fov * DEG / 2) / (persp.zoom || 1); ortho.position.copy(persp.position); ortho.quaternion.copy(persp.quaternion); ortho.top = halfH; ortho.bottom = -halfH; ortho.zoom = 1; cam = ortho; }
    else { const halfH = (ortho.top - ortho.bottom) / 2 / ortho.zoom, d = halfH / Math.tan(persp.fov * DEG / 2); persp.position.copy(orbit.target).addScaledVector(ortho.position.clone().sub(orbit.target).normalize(), d); persp.quaternion.copy(ortho.quaternion); cam = persp; }
    orbit.object = cam; gizmo.camera = cam; resize(); orbit.update();
    ui.ortho = on; saveUi(); $('#orthoBtn').classList.toggle('on', on); requestRender();
  }
  function drawTriad() {
    const q = cam.quaternion.clone().invert(), svg = $('#triad');
    const ax = [['X', [1, 0, 0], '--ax-x'], ['Y', [0, 1, 0], '--ax-y'], ['Z', [0, 0, 1], '--ax-z']].map(([n, v, c]) => { const w = new THREE.Vector3(...v).applyQuaternion(q); return { n, x: w.x * 22, y: -w.y * 22, z: w.z, c: css(c) }; });
    ax.sort((a, b) => a.z - b.z);
    svg.innerHTML = ax.map(a => `<line x1="0" y1="0" x2="${a.x.toFixed(1)}" y2="${a.y.toFixed(1)}" stroke="${a.c}" stroke-width="2" stroke-linecap="round"/><text x="${(a.x * 1.28).toFixed(1)}" y="${(a.y * 1.28 + 3.5).toFixed(1)}" fill="${a.c}" font-size="10" font-family="IBM Plex Mono, monospace" font-weight="600" text-anchor="middle">${a.n}</text>`).join('');
  }

  // ---------- picking, hover readout, measuring ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function hit(e) {
    const r = cv.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const h = ray.intersectObjects([...objs.values()].filter(o => o.mesh.visible).map(o => o.mesh), false)[0];
    return h || null;
  }
  function toScreen(v) { const r = cv.getBoundingClientRect(), p = new THREE.Vector3(...v).project(cam); return [r.left + (p.x + 1) / 2 * r.width, r.top + (1 - p.y) / 2 * r.height]; }
  // Snap a surface hit to the nearest corner of the hit triangle when within 12 px (corners and edges are what you measure).
  function snapPoint(h, e) {
    const g = h.object.geometry.attributes.position, m = h.object.matrixWorld;
    let best = h.point.clone(), bd = 12, corner = false;
    for (const i of [h.face.a, h.face.b, h.face.c]) {
      const v = new THREE.Vector3(g.getX(i), g.getY(i), g.getZ(i)).applyMatrix4(m), s = toScreen([v.x, v.y, v.z]);
      const d = Math.hypot(s[0] - e.clientX, s[1] - e.clientY); if (d < bd) { bd = d; best = v; corner = true; }
    }
    return { p: best, corner };
  }
  const measureGroup = new THREE.Group(); scene.add(measureGroup);
  let mpts = [], mText = '';
  function drawMeasure() {
    measureGroup.clear();
    const mc = col(css('--measure')), { r } = sceneSphere(), s = r * 0.012;
    for (const p of mpts) { const dot = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 8), new THREE.MeshBasicMaterial({ color: mc, depthTest: false })); dot.position.copy(p); dot.renderOrder = 10; measureGroup.add(dot); }
    if (mpts.length === 2) { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(mpts), new THREE.LineBasicMaterial({ color: mc, depthTest: false })); l.renderOrder = 10; measureGroup.add(l); }
    requestRender();
  }
  function measureClick(h, e) {
    if (!h) { mpts = []; mText = ''; drawMeasure(); showHint(); return; }
    const { p } = snapPoint(h, e);
    if (mpts.length >= 2) mpts = [];
    mpts.push(p);
    if (mpts.length === 2) {
      const d = mpts[1].clone().sub(mpts[0]);
      mText = `Distance ${fmt(d.length(), 6)} mm  (ΔX ${fmt(d.x, 5)}, ΔY ${fmt(d.y, 5)}, ΔZ ${fmt(d.z, 5)})`;
    } else mText = 'Click a second point';
    drawMeasure(); showHint();
  }
  function showHint() {
    const t = { select: 'Click a part to select it · drag to orbit · right-drag to pan · scroll to zoom', move: 'Drag an arrow or plane to move · snaps to the grid setting',
      rotate: 'Drag a ring to rotate · snaps to 15°', measure: 'Click two points (corners snap) · click empty space to clear' }[tool];
    $('#hint').textContent = tool === 'measure' && mText ? mText : t;
  }
  let down = null, hoverQueued = null;
  cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, onGizmo: gizmo.axis !== null && !!gizmo.object }; });
  cv.addEventListener('pointerup', e => {
    if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), onGizmo = down.onGizmo; down = null;
    if (moved > 5 || onGizmo || e.button === 2) return;
    const h = hit(e);
    if (tool === 'measure') { measureClick(h, e); return; }
    const id = h ? h.object.userData.id : null;
    if (id !== selId) { selId = id; update(); }
  });
  cv.addEventListener('pointermove', e => {
    if (e.buttons) return;
    hoverQueued = e; requestAnimationFrame(() => {
      if (!hoverQueued) return; const ev = hoverQueued; hoverQueued = null;
      const h = hit(ev), ro = $('#readout');
      if (h) { const p = model.parts.find(q => q.id === h.object.userData.id), s = tool === 'measure' ? snapPoint(h, ev) : { p: h.point, corner: false };
        ro.textContent = `${p ? p.name : ''}${s.corner ? ' · corner' : ''} · X ${fmt(s.p.x, 5)}  Y ${fmt(s.p.y, 5)}  Z ${fmt(s.p.z, 5)} mm`; }
      else { const g = new THREE.Vector3(); if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), g)) ro.textContent = `Grid · X ${fmt(g.x, 4)}  Z ${fmt(g.z, 4)} mm`; else ro.textContent = ''; }
      ro.hidden = !ro.textContent;
    });
  });
  cv.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- tools ----------
  function setTool(t) {
    tool = t; document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    if (t !== 'measure') { mpts = []; mText = ''; drawMeasure(); }
    attachGizmo(); showHint(); requestRender();
  }
  document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => addPart(b.dataset.add)));
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#orthoBtn').addEventListener('click', () => setOrtho(cam !== ortho));
  $('#edgesBtn').addEventListener('click', () => { ui.edges = !ui.edges; saveUi(); $('#edgesBtn').classList.toggle('on', ui.edges); syncScene(); requestRender(); });
  $('#snapSel').addEventListener('change', e => { ui.snap = +e.target.value; saveUi(); attachGizmo(); });

  // ---------- parts list ----------
  const EYE = '<svg viewBox="0 0 16 16"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 16 16"><path d="M2 2l12 12M6.5 4a6 6 0 0 1 1.5-.5c4 0 6.5 4.5 6.5 4.5a12 12 0 0 1-2 2.4M4.2 5.3C2.5 6.5 1.5 8 1.5 8S4 12.5 8 12.5a6 6 0 0 0 2.7-.6"/></svg>';
  function renderParts() {
    const box = $('#partList');
    $('#partCount').textContent = model.parts.length ? `${model.parts.length}` : '';
    if (!model.parts.length) { box.innerHTML = '<div class="empty">No parts yet. Add one from the tool rail (keys 1–6), pick an example, or import an STL from the File menu.</div>'; return; }
    box.innerHTML = model.parts.map(p => `<div class="prow${p.id === selId ? ' sel' : ''}${p.visible === false ? ' hid' : ''}" data-id="${p.id}"><span class="sw" style="background:${esc(p.color)}"></span><span class="nm">${esc(p.name)}</span><span class="ty">${Core.TYPES[p.type].label.toLowerCase()}</span><button class="eye" data-eye="${p.id}" aria-label="${p.visible === false ? 'Show' : 'Hide'} ${esc(p.name)}" title="${p.visible === false ? 'Show' : 'Hide'}">${p.visible === false ? EYE_OFF : EYE}</button></div>`).join('');
    box.querySelectorAll('.prow').forEach(r => r.addEventListener('click', e => {
      const eye = e.target.closest('[data-eye]');
      if (eye) { const p = model.parts.find(q => q.id === eye.dataset.eye); edit(() => { p.visible = p.visible === false; }); return; }
      selId = r.dataset.id === selId ? null : r.dataset.id; update();
    }));
  }

  // ---------- inspector ----------
  function numField(label, unit, value, onSet, attrs = '') {
    return { html: `<label class="field"><span>${label}</span><span class="inp"><input type="number" step="any" ${attrs} value="${+(+value).toPrecision(8)}"><em>${unit}</em></span></label>`, onSet };
  }
  function renderInspector() {
    const box = $('#inspector'), p = sel();
    if (!p) {
      $('#inspTitle').textContent = 'Model';
      box.innerHTML = `<p class="empty">Nothing selected. Click a part in the view or in the list above.</p>
        <label class="field"><span>Curve smoothness</span><span class="inp"><select id="segSel">${[24, 48, 96, 192].map(n => `<option value="${n}"${model.seg === n ? ' selected' : ''}>${n} facets</option>`).join('')}</select></span></label>
        <p class="note">Smoothness sets how finely curved parts are drawn and exported to STL. Mass properties of primitives are exact either way.</p>`;
      $('#segSel').addEventListener('change', e => edit(() => { model.seg = +e.target.value; }));
      return;
    }
    $('#inspTitle').textContent = Core.TYPES[p.type].label;
    const rows = [];
    rows.push(`<label class="field"><span>Name</span><span class="inp"><input type="text" id="nameIn" value="${esc(p.name)}"></span></label>`);
    const dimFields = Core.TYPES[p.type].dims.map(([k, label]) => numField(label, 'mm', p.dims[k], v => { p.dims[k] = v; }, `min="0" data-dim="${k}"`));
    rows.push(...dimFields.map(f => f.html));
    const xyz = (label, key, unit) => `<div class="field"><span>${label}</span><span class="xyz">${['X', 'Y', 'Z'].map((a, i) => `<span class="inp"><b>${a}</b><input type="number" step="any" data-${key}="${i}" value="${+(+p[key][i]).toPrecision(8)}" aria-label="${label} ${a} (${unit})"></span>`).join('')}</span></div>`;
    rows.push(xyz('Position, mm', 'pos', 'mm'), xyz('Rotation, °', 'rot', 'degrees'));
    rows.push(`<label class="field"><span>Material</span><span class="inp"><select id="matSel">${Core.MATERIALS.map(([k, n, r]) => `<option value="${k}"${p.mat === k ? ' selected' : ''}>${n}</option>`).join('')}</select></span></label>`);
    rows.push(p.mat === 'custom' ? numField('Density', 'g/cm³', p.rho || 1, null, 'min="0" id="rhoIn"').html : `<div class="field"><span>Density</span><span class="note">${Core.density(p)} g/cm³</span></div>`);
    rows.push(`<label class="field"><span>Color</span><input type="color" id="colorIn" value="${esc(p.color)}"></label>`);
    rows.push(`<div class="actions"><button class="btn" id="dupBtn" title="Duplicate (⌘D)">Duplicate</button><button class="btn" id="dropBtn" title="Set it down on the grid">Sit on grid</button><button class="btn" id="hideBtn">${p.visible === false ? 'Show' : 'Hide'}</button><button class="btn" id="delBtn" title="Delete (Del)">Delete</button></div>`);
    rows.push(`<div id="partStats"></div>`);
    box.innerHTML = rows.join('');
    $('#nameIn').addEventListener('change', e => { const v = e.target.value.trim(); if (v) edit(() => { p.name = v; }); });
    box.querySelectorAll('[data-dim]').forEach(inp => inp.addEventListener('change', e => { const v = parseFloat(e.target.value); if (isFinite(v) && v >= 0) edit(() => { p.dims[inp.dataset.dim] = v; }); else { toast('Enter a number of 0 or more.'); refreshInspectorValues(); } }));
    for (const key of ['pos', 'rot']) box.querySelectorAll(`[data-${key}]`).forEach(inp => inp.addEventListener('change', e => { const v = parseFloat(e.target.value); if (isFinite(v)) edit(() => { p[key][+inp.dataset[key]] = v; }); }));
    $('#matSel').addEventListener('change', e => edit(() => { if (e.target.value === 'custom' && !(p.rho > 0)) p.rho = Core.density(p) || 1; p.mat = e.target.value; }));
    const rho = $('#rhoIn'); if (rho) rho.addEventListener('change', e => { const v = parseFloat(e.target.value); if (isFinite(v) && v > 0) edit(() => { p.rho = v; }); });
    $('#colorIn').addEventListener('input', e => { p.color = e.target.value; syncScene(); renderParts(); requestRender(); });
    $('#colorIn').addEventListener('change', e => { const v = e.target.value; p.color = colorBefore; edit(() => { p.color = v; }); });
    let colorBefore = p.color; $('#colorIn').addEventListener('focus', () => { colorBefore = p.color; });
    $('#dupBtn').addEventListener('click', duplicate); $('#dropBtn').addEventListener('click', dropToGrid); $('#delBtn').addEventListener('click', removeSel);
    $('#hideBtn').addEventListener('click', () => edit(() => { p.visible = p.visible === false; }));
    renderPartStats();
  }
  function refreshInspectorValues() {
    const p = sel(), box = $('#inspector'); if (!p) return;
    const set = (inp, v) => { if (inp && document.activeElement !== inp) inp.value = +(+v).toPrecision(8); };
    box.querySelectorAll('[data-dim]').forEach(i => set(i, p.dims[i.dataset.dim]));
    box.querySelectorAll('[data-pos]').forEach(i => set(i, p.pos[+i.dataset.pos]));
    box.querySelectorAll('[data-rot]').forEach(i => set(i, p.rot[+i.dataset.rot]));
    renderPartStats();
  }
  function renderPartStats() {
    const el = $('#partStats'), p = sel(); if (!el || !p) return;
    const i = model.parts.indexOf(p), info = res.parts[i];
    if (info.problem) { el.innerHTML = `<div class="warnbox">${esc(info.problem)}.</div>`; return; }
    el.innerHTML = `<div class="scope" style="margin-top:10px">This part alone</div><div id="partOut" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <div class="stat"><b>${fmt(info.m)}</b><span>Mass, g</span></div><div class="stat"><b>${fmt(info.V)}</b><span>Volume, mm³</span></div>
      <div class="stat wide"><b>${info.c.map(v => fmt(v, 5)).join(', ')}</b><span>Center of mass X, Y, Z, mm</span></div></div>`;
  }
  function renderOutputs() {
    const n = res.count, total = model.parts.length, hidden = model.parts.filter(p => p.visible === false).length;
    $('#massScope').textContent = n ? `All ${n} visible part${n === 1 ? '' : 's'}${hidden ? `, ${hidden} hidden part${hidden === 1 ? '' : 's'} left out` : ''}` : (total ? 'Every part is hidden.' : 'Add a part to see its mass properties.');
    const I = res.I;
    $('#outputs').innerHTML = n ? `<div class="stat"><b>${fmt(res.M)}</b><span>Mass, g</span></div><div class="stat"><b>${fmt(res.V)}</b><span>Volume, mm³</span></div>
      <div class="stat"><b>${fmt(res.A)}</b><span>Surface area, mm²</span></div><div class="stat"><b>${fmt(res.M / res.V * 1000, 4)}</b><span>Average density, g/cm³</span></div>
      <div class="stat wide"><b>${res.bbox ? res.bbox.size.map(v => fmt(v, 5)).join(' × ') : '—'}</b><span>Bounding box X × Y × Z, mm</span></div>
      <div class="stat wide"><b>${res.C.map(v => fmt(v, 5)).join(', ')}</b><span>Center of mass X, Y, Z, mm</span></div>
      <div class="stat wide"><b>${[I[0][0], I[1][1], I[2][2]].map(v => fmt(v, 5)).join(', ')}</b><span>Ixx, Iyy, Izz about the center of mass, g·mm²</span></div>
      <div class="stat wide"><b>${res.principal.values.map(v => fmt(v, 5)).join(', ')}</b><span>Principal moments, g·mm²</span></div>` : '';
    $('#warns').innerHTML = res.warnings.map(w => `<div class="warnbox">${esc(w)}</div>`).join('');
    const st = $('#status');
    st.classList.toggle('bad', res.warnings.length > 0);
    st.textContent = res.warnings.length ? res.warnings[0] : n ? `${n} part${n === 1 ? '' : 's'} · ${fmt(res.M, 4)} g · ${res.bbox.size.map(v => fmt(v, 3)).join(' × ')} mm` : 'Empty model';
  }

  // ---------- the math drawer ----------
  function renderMath() { $('#mathBody').innerHTML = Explain.build(model, res, selId); const p = sel(); $('#mathSub').textContent = p ? `for ${p.name} and the assembly` : 'for the assembly'; }
  function openMath(on) { $('#math').classList.toggle('open', on); $('#math').setAttribute('aria-hidden', String(!on)); $('#scrim').hidden = !on; if (on) renderMath(); }
  $('#mathBtn').addEventListener('click', () => openMath(true)); $('#mathClose').addEventListener('click', () => openMath(false)); $('#scrim').addEventListener('click', () => openMath(false));

  // ---------- files ----------
  async function offerFile(filename, data) {
    if (downloads) { try { await downloads.save({ filename, data }); toast(`Saved ${filename}.`); } catch (err) { if (!err || err.code !== 'declined') toast(`Could not save ${filename} here.`); } return; }
    if (window.claude && window.claude.use) { toast('Saving files is not available in this view.'); return; }
    const type = filename.endsWith('.csv') ? 'text/csv' : filename.endsWith('.stl') ? 'model/stl' : 'application/json';
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const fileSafe = s => (s || 'solid-bench').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'solid-bench';
  function exportModel() { const used = new Set(model.parts.map(p => p.mesh).filter(Boolean)), meshes = {}; for (const k of used) if (model.meshes[k]) meshes[k] = model.meshes[k]; return JSON.stringify({ app: 'solid-bench', version: 1, seg: model.seg, parts: model.parts, meshes }); }
  function exportCSV() {
    const head = 'part,type,material,density (g/cm3),volume (mm3),area (mm2),mass (g),cx (mm),cy (mm),cz (mm),Ixx (g mm2),Iyy (g mm2),Izz (g mm2),Ixy (g mm2),Iyz (g mm2),Ixz (g mm2)';
    const q = s => `"${String(s).replace(/"/g, '""')}"`;
    const rows = model.parts.map((p, i) => { const r = res.parts[i]; if (r.problem || p.visible === false) return null;
      return [q(p.name), p.type, q(Core.MAT[p.mat] ? Core.MAT[p.mat].name : p.mat), Core.density(p), r.V, r.A, r.m, ...r.c, r.I[0][0], r.I[1][1], r.I[2][2], -r.I[0][1], -r.I[1][2], -r.I[0][2]].join(','); }).filter(Boolean);
    const I = res.I;
    rows.push([q('ASSEMBLY (about its center of mass)'), '', '', '', res.V, res.A, res.M, ...res.C, I[0][0], I[1][1], I[2][2], -I[0][1], -I[1][2], -I[0][2]].join(','));
    return head + '\n' + rows.join('\n') + '\n# part inertias are about each part centroid on world axes; products of inertia are the integrals of xy, yz, xz dm\n';
  }
  function exportSTL(onlySel) {
    const p = sel(); if (onlySel && !p) { toast('Select a part first.'); return; }
    const tris = Core.worldTriangles(model, onlySel ? [p.id] : null);
    if (!tris.length) { toast('Nothing visible to export.'); return; }
    offerFile(fileSafe(onlySel ? p.name : 'solid-bench-model') + '.stl', new Blob([Core.stlBinary(tris)], { type: 'model/stl' }));
  }
  function loadModel(o) {
    if (!o || !Array.isArray(o.parts)) throw new Error('This file is not a Solid Bench model.');
    for (const p of o.parts) if (!Core.TYPES[p.type] || !Array.isArray(p.pos) || !Array.isArray(p.rot)) throw new Error('This model has a part Solid Bench cannot read.');
    undoStack.push(snapshot()); redoStack.length = 0;
    model = { seg: o.seg || 48, parts: o.parts, meshes: Object.assign({}, model.meshes, o.meshes || {}) }; selId = null; update(); setView('iso');
  }
  function importSTL(name, buf) {
    const raw = Core.parseSTL(buf);
    if (raw.length / 9 > 400000) throw new Error('That STL has more than 400,000 triangles; Solid Bench keeps it basic for now.');
    const { pos, center } = Core.centerMesh(raw), mid = 'm' + Math.random().toString(36).slice(2, 8), ck = Core.meshCheck(pos);
    model.meshes[mid] = { name, pos };
    const p = { id: newId(), name: name.replace(/\.stl$/i, ''), type: 'mesh', mesh: mid, dims: {}, pos: center.map(r3), rot: [0, 0, 0], mat: 'al6061', color: PALETTE[model.parts.length % PALETTE.length], visible: true };
    edit(() => { model.parts.push(p); selId = p.id; }); setView('fit');
    toast(`Imported ${ck.tris.toLocaleString('en-US')} triangles as mm${ck.closed ? '' : ` · not watertight (${ck.open} open edges), so mass properties are unreliable`}.`);
  }
  const fileMenu = $('#fileMenu');
  $('#fileBtn').addEventListener('click', e => { e.stopPropagation(); fileMenu.hidden = !fileMenu.hidden; });
  addEventListener('click', e => { if (!fileMenu.hidden && !e.target.closest('.menu')) fileMenu.hidden = true; });
  fileMenu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { fileMenu.hidden = true; ({
    new: () => edit(() => { model.parts = []; selId = null; }),
    open: () => $('#fileIn').click(),
    save: () => offerFile('solid-bench-model.json', exportModel()),
    stl: () => exportSTL(false), stlsel: () => exportSTL(true),
    csv: () => offerFile('solid-bench-mass-properties.csv', exportCSV()),
    png: () => { renderer.render(scene, cam); cv.toBlob(bl => bl && offerFile('solid-bench-view.png', bl), 'image/png'); },
  })[b.dataset.act](); }));
  $('#fileIn').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      if (/\.stl$/i.test(f.name)) importSTL(f.name, await f.arrayBuffer());
      else loadModel(JSON.parse(await f.text()));
    } catch (err) { toast(err && err.message ? err.message : 'Could not read that file.'); }
  });

  // ---------- undo, examples, keys ----------
  $('#undoBtn').addEventListener('click', () => { if (undoStack.length) { redoStack.push(snapshot()); restore(undoStack.pop()); } });
  $('#redoBtn').addEventListener('click', () => { if (redoStack.length) { undoStack.push(snapshot()); restore(redoStack.pop()); } });
  const presetSel = $('#presetSel');
  for (const [k, t] of Object.entries(Presets.titles)) presetSel.appendChild(Object.assign(document.createElement('option'), { value: k, textContent: t }));
  presetSel.addEventListener('change', () => { if (presetSel.value) { const m = Presets.list[presetSel.value](); edit(() => { model.seg = m.seg; model.parts = m.parts; selId = null; }); setView('iso'); presetSel.value = ''; } });
  addEventListener('keydown', e => {
    const typing = e.target.closest && e.target.closest('input, select, textarea');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); $(e.shiftKey ? '#redoBtn' : '#undoBtn').click(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && !typing) { e.preventDefault(); duplicate(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { if ($('#math').classList.contains('open')) openMath(false); else if (mpts.length) measureClick(null); else if (selId) { selId = null; update(); } return; }
    const k = e.key.toLowerCase();
    const act = { v: () => setTool('select'), g: () => setTool('move'), r: () => setTool('rotate'), m: () => setTool('measure'), f: () => setView('fit'), 0: () => setView('iso'), o: () => setOrtho(cam !== ortho),
      1: () => addPart('box'), 2: () => addPart('cylinder'), 3: () => addPart('tube'), 4: () => addPart('sphere'), 5: () => addPart('cone'), 6: () => addPart('torus'),
      delete: removeSel, backspace: removeSel }[k];
    if (act) { e.preventDefault(); act(); }
  });

  // ---------- start ----------
  try { const s = localStorage.getItem(STORE_KEY); model = s ? JSON.parse(s) : null; } catch (e) { model = null; }
  if (!model || !Array.isArray(model.parts)) model = Presets.list.rocket();
  model.meshes = model.meshes || {}; model.seg = model.seg || 48;
  $('#snapSel').value = String(ui.snap); $('#orthoBtn').classList.toggle('on', cam === ortho); $('#edgesBtn').classList.toggle('on', ui.edges);
  buildHelpers(); setTool('select');
  new ResizeObserver(resize).observe(cv);
  const retheme = () => { buildHelpers(); syncScene(); requestRender(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.claude && window.claude.use) window.claude.use('downloads').then(d => { downloads = d; }).catch(() => { downloads = null; });
  update(); resize(); setView('iso');
  // Read-only hook for browser tests.
  window.__tool = { get model() { return model; }, get res() { return res; }, get selId() { return selId; }, toScreen, partScreen: id => { const p = model.parts.find(q => q.id === id); return p ? toScreen(Core.solve({ parts: [p], meshes: model.meshes }).parts[0].c) : null; } };
})();
