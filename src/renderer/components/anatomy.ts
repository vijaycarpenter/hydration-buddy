// Procedural, original anatomical figure for the hydration view: a translucent body
// shell, a matching inner volume for the water, internal organs and skeleton hints.
// Units ≈ metres; the figure stands on y = 0, faces +z, and is ~1.9 tall.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V3 = [number, number, number];

export const BODY_TOP = 1.9;

// ---------------------------------------------------------------- helpers

const UP = new THREE.Vector3(0, 1, 0);

/** A tapered segment from a to b: a lathe whose radius follows `radii` (evenly spaced, rounded ends). */
function limb(a: V3, b: V3, radii: number[], opts: { flatten?: number; flattenAxis?: 'x' | 'z'; shrink?: number; segments?: number } = {}) {
  const { flatten = 1, flattenAxis = 'z', shrink = 1, segments = 20 } = opts;
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const pts: THREE.Vector2[] = [];
  const n = radii.length;
  const capA = radii[0] * 0.75;
  const capB = radii[n - 1] * 0.75;
  pts.push(new THREE.Vector2(0.0001, -len / 2 - capA));
  pts.push(new THREE.Vector2(radii[0] * 0.7, -len / 2 - capA * 0.7));
  radii.forEach((r, i) => pts.push(new THREE.Vector2(r, -len / 2 + (len * i) / (n - 1))));
  pts.push(new THREE.Vector2(radii[n - 1] * 0.7, len / 2 + capB * 0.7));
  pts.push(new THREE.Vector2(0.0001, len / 2 + capB));
  const geo = new THREE.LatheGeometry(pts, segments);
  const s = new THREE.Vector3(1, 1, 1);
  if (flattenAxis === 'z') s.z = flatten;
  else s.x = flatten;
  s.multiplyScalar(shrink);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  geo.applyMatrix4(new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, s));
  return geo;
}

function blob(r: number, pos: V3, scale: V3 = [1, 1, 1], rot: V3 = [0, 0, 0], shrink = 1, seg = 24) {
  const geo = new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7));
  geo.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(scale[0] * shrink, scale[1] * shrink, scale[2] * shrink),
    ),
  );
  return geo;
}

function tube(points: V3[], radius: number, tubular = 64, radial = 8, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
  return new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
}

/** Horizontal elliptical ring (ribs, pelvis), open toward the front by `gap` (0..1 of the circle). */
function ring(y: number, rx: number, rz: number, thick: number, gap: number, tilt = 0, z = 0) {
  const geo = new THREE.TorusGeometry(1, thick, 6, 40, Math.PI * 2 * (1 - gap));
  // Torus lies in XY with its arc starting at +x; rotate so the gap is centred at the front (+z).
  geo.rotateZ(Math.PI / 2 + Math.PI * gap);
  geo.rotateX(Math.PI / 2);
  geo.scale(rx, rx * 0.9, rz);
  geo.rotateX(tilt);
  geo.translate(0, y, z);
  return geo;
}

const merge = (geos: THREE.BufferGeometry[]) => {
  // mergeGeometries needs identical attribute sets; every primitive here has position/normal/uv and an index.
  const out = mergeGeometries(geos, false)!;
  geos.forEach((g) => g.dispose());
  return out;
};

// ---------------------------------------------------------------- body surface

const TORSO_PROFILE: [number, number][] = [
  [0.0001, 0.9], [0.1, 0.905], [0.155, 0.94], [0.178, 0.99], [0.172, 1.05], [0.155, 1.11],
  [0.142, 1.16], [0.146, 1.22], [0.158, 1.29], [0.172, 1.36], [0.182, 1.42], [0.19, 1.47],
  [0.17, 1.52], [0.12, 1.545], [0.06, 1.56], [0.0001, 1.565],
];

/** Skin surface (shrink = 1) or the inner water volume (shrink < 1, each part scaled about its own centre). */
export function buildBody(shrink = 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const torsoMid = 1.23;
  const torso = new THREE.LatheGeometry(TORSO_PROFILE.map(([r, y]) => new THREE.Vector2(r, y - torsoMid)), 48);
  torso.scale(shrink, shrink, 0.62 * shrink);
  torso.translate(0, torsoMid, 0);
  parts.push(torso);

  // head, jaw, neck
  parts.push(blob(0.1, [0, 1.775, 0.005], [0.9, 1.16, 1.02], [0, 0, 0], shrink, 36));
  parts.push(blob(0.062, [0, 1.71, 0.025], [1.0, 0.85, 0.95], [0, 0, 0], shrink));
  parts.push(limb([0, 1.54, -0.005], [0, 1.68, 0.0], [0.052, 0.05, 0.048], { shrink }));
  // chest / glutes volume for a less cylindrical torso
  parts.push(blob(0.09, [0.075, 1.37, 0.04], [1.1, 0.75, 0.75], [0, 0, 0], shrink));
  parts.push(blob(0.09, [-0.075, 1.37, 0.04], [1.1, 0.75, 0.75], [0, 0, 0], shrink));
  parts.push(blob(0.1, [0.07, 0.97, -0.04], [0.9, 0.8, 0.75], [0, 0, 0], shrink));
  parts.push(blob(0.1, [-0.07, 0.97, -0.04], [0.9, 0.8, 0.75], [0, 0, 0], shrink));

  for (const s of [1, -1]) {
    // shoulder (deltoid)
    parts.push(blob(0.058, [s * 0.195, 1.47, 0], [1.05, 1, 1], [0, 0, 0], shrink));
    // upper arm, forearm, hand, thumb
    parts.push(limb([s * 0.215, 1.47, 0], [s * 0.255, 1.19, -0.01], [0.046, 0.047, 0.042, 0.035], { shrink }));
    parts.push(limb([s * 0.255, 1.19, -0.01], [s * 0.285, 0.93, 0.025], [0.034, 0.037, 0.031, 0.024], { shrink }));
    parts.push(limb([s * 0.287, 0.92, 0.028], [s * 0.3, 0.8, 0.035], [0.023, 0.03, 0.03, 0.022, 0.012], { flatten: 0.45, flattenAxis: 'x', shrink }));
    parts.push(limb([s * 0.27, 0.9, 0.04], [s * 0.265, 0.85, 0.06], [0.01, 0.009, 0.007], { shrink, segments: 10 }));
    // thigh, knee, calf, foot
    parts.push(limb([s * 0.09, 0.96, 0], [s * 0.085, 0.53, 0.005], [0.088, 0.083, 0.07, 0.054], { shrink }));
    parts.push(blob(0.048, [s * 0.085, 0.52, 0.015], [1, 1.05, 0.95], [0, 0, 0], shrink));
    parts.push(limb([s * 0.085, 0.51, 0], [s * 0.08, 0.075, -0.01], [0.048, 0.053, 0.046, 0.034, 0.03], { shrink }));
    parts.push(limb([s * 0.08, 0.045, -0.035], [s * 0.088, 0.022, 0.13], [0.034, 0.042, 0.04, 0.03, 0.018], { flatten: 0.55, flattenAxis: 'z', shrink }));
  }
  return merge(parts);
}

// ---------------------------------------------------------------- internals

/** Wrinkled brain: a displaced sphere with a midline groove. */
function brain() {
  const geo = new THREE.SphereGeometry(0.078, 48, 36);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const folds =
      Math.sin(n.x * 38 + Math.sin(n.y * 21)) * Math.sin(n.y * 33 + n.z * 17) * 0.045 +
      Math.sin(n.z * 45 + n.x * 9) * 0.02;
    const groove = Math.exp(-Math.pow(n.x * 16, 2)) * 0.12 * Math.max(n.y, 0);
    v.multiplyScalar(1 + folds - groove);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  geo.scale(0.92, 0.78, 1.08);
  geo.translate(0, 1.805, -0.004);
  return geo;
}

function intestines() {
  // small intestine: a coiled path through the lower abdomen
  const pts: V3[] = [];
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const y = 1.1 - r * 0.022;
    const dir = r % 2 === 0 ? 1 : -1;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = dir * (-0.075 + t * 0.15);
      pts.push([x, y + Math.sin(t * Math.PI * 4 + r) * 0.009, 0.045 + Math.cos(t * Math.PI * 3 + r) * 0.018]);
    }
  }
  const small = tube(pts, 0.0115, 420, 8);
  // large intestine framing it
  const large = tube(
    [
      [-0.035, 0.985, 0.04], [-0.1, 0.99, 0.035], [-0.11, 1.05, 0.035], [-0.105, 1.125, 0.04],
      [-0.02, 1.135, 0.055], [0.06, 1.13, 0.05], [0.105, 1.12, 0.04], [0.11, 1.04, 0.035], [0.09, 0.99, 0.035], [0.03, 0.97, 0.03],
    ],
    0.019, 120, 10,
  );
  return [small, large];
}

export interface Anatomy {
  organs: THREE.BufferGeometry;
  brain: THREE.BufferGeometry;
  heart: THREE.BufferGeometry;
  bones: THREE.BufferGeometry;
  heartCenter: THREE.Vector3;
}

export function buildAnatomy(): Anatomy {
  const organs = merge([
    // airway + lungs
    limb([0, 1.64, 0.025], [0, 1.43, 0.02], [0.011, 0.012, 0.012], { segments: 10 }),
    tube([[0, 1.44, 0.02], [0.03, 1.41, 0.015], [0.06, 1.39, 0.01]], 0.008, 16, 8),
    tube([[0, 1.44, 0.02], [-0.03, 1.41, 0.015], [-0.06, 1.39, 0.01]], 0.008, 16, 8),
    blob(0.068, [0.078, 1.355, 0.005], [0.95, 1.6, 0.85], [0, 0, -0.08]),
    blob(0.068, [-0.078, 1.355, 0.005], [1.0, 1.6, 0.85], [0, 0, 0.08]),
    // liver (person's right = -x), stomach (left = +x), kidneys, bladder
    blob(0.075, [-0.055, 1.2, 0.03], [1.35, 0.55, 0.75], [0, 0, 0.25]),
    tube([[0.0, 1.27, 0.02], [0.03, 1.235, 0.04], [0.09, 1.215, 0.045], [0.1, 1.165, 0.045], [0.06, 1.14, 0.05], [0.015, 1.15, 0.05]], 0.026, 48, 12),
    blob(0.026, [0.068, 1.12, -0.045], [0.75, 1.3, 0.65], [0, 0, -0.2]),
    blob(0.026, [-0.068, 1.11, -0.045], [0.75, 1.3, 0.65], [0, 0, 0.2]),
    blob(0.03, [0, 0.955, 0.04], [1.1, 0.85, 0.9]),
    ...intestines(),
  ]);

  const bonesParts: THREE.BufferGeometry[] = [];
  // spine
  for (let y = 0.97; y <= 1.66; y += 0.026) {
    const r = y > 1.55 ? 0.011 : y > 1.3 ? 0.014 : 0.017;
    const g = new THREE.CylinderGeometry(r, r, 0.017, 10);
    g.translate(0, y, -0.055 + (y > 1.5 ? 0.02 : 0));
    bonesParts.push(g);
  }
  // ribs, sternum, clavicles, pelvis
  for (let i = 0; i < 9; i++) {
    const y = 1.47 - i * 0.03;
    const w = 0.115 + Math.sin((i / 8) * Math.PI) * 0.045;
    bonesParts.push(ring(y, w, 0.088, 0.04, i < 7 ? 0.12 : 0.3, 0.32, 0.0));
  }
  bonesParts.push(limb([0, 1.48, 0.075], [0, 1.31, 0.08], [0.008, 0.009, 0.007], { segments: 8 }));
  for (const s of [1, -1]) {
    bonesParts.push(tube([[s * 0.01, 1.515, 0.06], [s * 0.09, 1.525, 0.045], [s * 0.18, 1.5, 0.0]], 0.0065, 20, 6));
    // limb bones
    bonesParts.push(limb([s * 0.215, 1.46, 0], [s * 0.255, 1.2, -0.01], [0.012, 0.009, 0.012], { segments: 8 }));
    bonesParts.push(limb([s * 0.255, 1.18, -0.01], [s * 0.285, 0.94, 0.025], [0.009, 0.007, 0.009], { segments: 8 }));
    bonesParts.push(limb([s * 0.09, 0.93, 0], [s * 0.085, 0.54, 0.005], [0.016, 0.012, 0.016], { segments: 8 }));
    bonesParts.push(limb([s * 0.085, 0.5, 0.01], [s * 0.08, 0.09, -0.005], [0.014, 0.01, 0.012], { segments: 8 }));
    bonesParts.push(blob(0.016, [s * 0.215, 1.47, 0], [1, 1, 1], [0, 0, 0], 1, 12));
  }
  bonesParts.push(ring(0.995, 0.13, 0.075, 0.13, 0.25, -0.35, -0.01));

  const heartCenter = new THREE.Vector3(0.025, 1.33, 0.04);
  const heart = merge([
    blob(0.038, [0, 0, 0], [0.9, 1.1, 0.85], [0, 0, -0.45]),
    blob(0.022, [-0.012, 0.03, 0.005], [1, 1, 1]),
    tube([[-0.005, 0.03, -0.005], [0.0, 0.07, -0.01], [0.03, 0.075, -0.015], [0.04, 0.05, -0.02]], 0.009, 16, 8),
  ]);

  return { organs, brain: brain(), heart, bones: merge(bonesParts), heartCenter };
}
