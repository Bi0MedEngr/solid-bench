// Worked examples. Each one is also a test case (tests/test_core.js checks it against hand answers).
const Presets = (() => {
  'use strict';
  let n = 0;
  const part = (name, type, dims, pos, rot, mat, color, extra) => Object.assign({ id: 'p' + (++n), name, type, dims, pos, rot: rot || [0, 0, 0], mat, color, visible: true }, extra || {});
  const M = parts => { n = 0; return { seg: 48, parts: parts(), meshes: {} }; };
  const list = {
    rocket: () => M(() => [
      part('Body tube', 'cylinder', { r: 10, h: 80 }, [0, 40, 0], null, 'pc', '#6b8fd6'),
      part('Nose cone', 'cone', { r1: 10, r2: 0, h: 30 }, [0, 95, 0], null, 'abs', '#d65f5f'),
      ...[0, 120, 240].map((a, i) => part('Fin ' + (i + 1), 'box', { w: 18, h: 25, d: 1.5 },
        [19 * Math.cos(a * Math.PI / 180), 12.5, -19 * Math.sin(a * Math.PI / 180)], [0, a, 0], 'pla', '#e0a83a')),
    ]),
    bushing: () => M(() => [
      part('Flange', 'tube', { ro: 12, ri: 5, h: 3 }, [0, 1.5, 0], null, 'brass360', '#c9a14a'),
      part('Barrel', 'tube', { ro: 8, ri: 5, h: 12 }, [0, 9, 0], null, 'brass360', '#c9a14a'),
    ]),
    dumbbell: () => M(() => [
      part('Bar', 'cylinder', { r: 4, h: 100 }, [0, 15, 0], [0, 0, 90], 'steel1018', '#8a9399'),
      part('Left bell', 'sphere', { r: 15 }, [-65, 15, 0], null, 'steel1018', '#5d666c'),
      part('Right bell', 'sphere', { r: 15 }, [65, 15, 0], null, 'steel1018', '#5d666c'),
    ]),
    bracket: () => M(() => [
      part('Base', 'box', { w: 60, h: 5, d: 40 }, [0, 2.5, 0], null, 'al6061', '#9fb3c8'),
      part('Upright', 'box', { w: 5, h: 40, d: 40 }, [-27.5, 25, 0], null, 'al6061', '#9fb3c8'),
    ]),
    pulley: () => M(() => [
      part('Hub', 'tube', { ro: 8, ri: 4, h: 20 }, [0, 10, 0], null, 'acetal', '#e8e4da'),
      part('Web', 'tube', { ro: 30, ri: 8, h: 5 }, [0, 10, 0], null, 'acetal', '#e8e4da'),
      part('Rim', 'tube', { ro: 35, ri: 30, h: 14 }, [0, 10, 0], null, 'acetal', '#e8e4da'),
    ]),
    shaft: () => M(() => [
      part('Left journal', 'cylinder', { r: 6, h: 20 }, [-40, 8, 0], [0, 0, 90], 'steel1018', '#8a9399'),
      part('Center', 'cylinder', { r: 8, h: 60 }, [0, 8, 0], [0, 0, 90], 'steel1018', '#8a9399'),
      part('Right journal', 'cylinder', { r: 6, h: 20 }, [40, 8, 0], [0, 0, 90], 'steel1018', '#8a9399'),
    ]),
    oring: () => M(() => [
      part('Shaft', 'cylinder', { r: 10, h: 60 }, [0, 30, 0], null, 'ss316', '#a7b0b6'),
      part('O-ring (FKM)', 'torus', { R: 11.5, r: 1.5 }, [0, 40, 0], null, 'custom', '#3a3a3a', { rho: 1.85 }),
    ]),
    plate: () => M(() => [part('Mounting plate', 'extrude', { d: 6 }, [0, 3, 0], null, 'al6061', '#9fb3c8', {
      base: [0, 3, 0], sketch: { plane: 'ground', offset: 0, ents: [{ kind: 'rect', x: -40, y: -25, w: 80, h: 50, rr: 6 },
        ...[[-32, -17], [32, -17], [32, 17], [-32, 17]].map(([x, y]) => ({ kind: 'circle', x, y, r: 3.25 })), { kind: 'circle', x: 0, y: 0, r: 11 }] } })]),
    turned: () => M(() => [part('Turned shaft', 'revolve', { angle: 360 }, [0, 37.5, 0], null, 'steel1018', '#8a9399', {
      axis: 'v', base: [0, 37.5, 0], sketch: { plane: 'front', offset: 0, ents: [{ kind: 'poly',
        pts: [[0, 0], [10, 0], [10, 20], [7, 20], [7, 60], [5, 60], [5, 75], [0, 75]], f: [0, 1, 1, 1.5, 0.5, 1, 0.5, 0] }] } })]),
    cube: () => M(() => [part('100 mm cube', 'box', { w: 100, h: 100, d: 100 }, [0, 50, 0], null, 'al6061', '#9fb3c8')]),
    tilted: () => M(() => [part('Tilted plate', 'box', { w: 80, h: 6, d: 40 }, [0, 40, 0], [30, 0, 20], 'ss304', '#a7b0b6')]),
  };
  const titles = {
    rocket: 'Model rocket (cylinder, cone, 3 fins)', bushing: 'Flanged bushing (2 tubes)', dumbbell: 'Dumbbell (bar + 2 spheres)',
    bracket: 'L-bracket (2 boxes)', pulley: 'Pulley (hub, web, rim)', shaft: 'Stepped shaft (horizontal)',
    oring: 'O-ring on shaft (torus)', plate: 'Mounting plate (sketch: fillets + 5 holes)', turned: 'Turned shaft (sketch: revolve with fillets)', cube: '100 mm aluminum cube (check)', tilted: 'Tilted plate (principal axes)',
  };
  return { list, titles };
})();
if (typeof module !== 'undefined') module.exports = Presets;
