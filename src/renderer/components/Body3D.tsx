// Translucent anatomical body whose water level represents progress toward the daily
// goal (a visual metaphor only — not a measurement of actual body water).
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BODY_TOP, buildAnatomy, buildBody } from './anatomy';

const FLOW_PARTICLES = 90;
const BUBBLES = 80;

const vertex = /* glsl */ `
  varying vec3 vNormal; varying vec3 vView; varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Skin: holographic glass with bright rims.
const shellFragment = /* glsl */ `
  uniform vec3 uRim; uniform vec3 uBase; uniform float uGlow; uniform float uTime;
  varying vec3 vNormal; varying vec3 vView; varying vec3 vWorld;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.4);
    float scan = (sin(vWorld.y * 60.0 - uTime * 2.0) * 0.5 + 0.5) * 0.025;
    vec3 col = mix(uBase, uRim, fres) + uRim * uGlow * fres * 0.7;
    gl_FragColor = vec4(col, 0.06 + fres * (0.62 + uGlow * 0.3) + scan);
  }
`;

// Organs & bones: fresnel-lit; brighter and more saturated where the water has reached.
const organFragment = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uWet; uniform float uLevel; uniform float uAlpha; uniform float uTime;
  varying vec3 vNormal; varying vec3 vView; varying vec3 vWorld;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float fres = pow(1.0 - facing, 1.8);
    float wet = smoothstep(uLevel + 0.012, uLevel - 0.012, vWorld.y);
    vec3 col = mix(uColor, uWet, wet * 0.8) * (0.55 + facing * 0.55) + fres * mix(0.18, 0.45, wet);
    gl_FragColor = vec4(col, uAlpha * (0.45 + fres * 0.55) * mix(0.55, 1.0, wet));
  }
`;

const waterFragment = /* glsl */ `
  uniform float uLevel; uniform float uTime; uniform float uPulse;
  varying vec3 vNormal; varying vec3 vView; varying vec3 vWorld;
  void main() {
    float amp = 0.006 * (1.0 + uPulse * 4.0);
    float wave = sin(vWorld.x * 22.0 + uTime * 2.3) * amp + sin(vWorld.z * 18.0 - uTime * 1.8) * amp * 0.8;
    float surface = uLevel + wave;
    if (vWorld.y > surface) discard;
    float depth = clamp((surface - vWorld.y) / 1.6, 0.0, 1.0);
    vec3 col = mix(vec3(0.45, 0.9, 1.0), vec3(0.03, 0.3, 0.85), depth);
    float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
    float band = smoothstep(0.03, 0.0, surface - vWorld.y);
    float caustic = (sin(vWorld.y * 50.0 - uTime * 3.2 + sin(vWorld.x * 20.0 + uTime)) * 0.5 + 0.5) * 0.05;
    col += vec3(0.75, 0.97, 1.0) * band * 0.9 + fres * 0.2 + caustic + uPulse * 0.12;
    gl_FragColor = vec4(col, 0.34 + fres * 0.25 + band * 0.35);
  }
`;

function levelFor(percent: number) {
  const p = Math.min(Math.max(percent, 0), 100) / 100;
  return 0.012 + p * (BODY_TOP - 0.01);
}

const shader = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, side: THREE.Side = THREE.FrontSide) =>
  new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader, uniforms, transparent: true, depthWrite: false, side });

function organMaterial(color: string, wet: string, alpha: number) {
  return shader(organFragment, {
    uColor: { value: new THREE.Color(color) },
    uWet: { value: new THREE.Color(wet) },
    uLevel: { value: 0 },
    uAlpha: { value: alpha },
    uTime: { value: 0 },
  });
}

function BodyModel({ percent, drinkKey, dark }: { percent: number; drinkKey: number; dark: boolean }) {
  const shellGeo = useMemo(() => buildBody(1), []);
  const waterGeo = useMemo(() => buildBody(0.88), []);
  const anatomy = useMemo(() => buildAnatomy(), []);
  const level = useRef(levelFor(percent));
  const pulseStart = useRef(-10);
  const clockRef = useRef(0);
  const heartRef = useRef<THREE.Mesh>(null);

  const mats = useMemo(
    () => ({
      shell: shader(shellFragment, {
        uRim: { value: new THREE.Color('#38bdf8') },
        uBase: { value: new THREE.Color('#bae6fd') },
        uGlow: { value: 0 },
        uTime: { value: 0 },
      }),
      water: shader(waterFragment, { uLevel: { value: level.current }, uTime: { value: 0 }, uPulse: { value: 0 } }),
      organs: organMaterial('#1d4ed8', '#22d3ee', 0.85),
      brain: organMaterial('#2563eb', '#67e8f9', 0.9),
      heart: organMaterial('#1e40af', '#38bdf8', 0.95),
      bones: organMaterial('#93c5fd', '#e0f2fe', 0.55),
    }),
    [],
  );

  // Depth-only pre-passes: the skin and the water are unions of overlapping parts, so without these
  // every internal overlap would draw its own rim. The pre-pass keeps only the outermost surface.
  // They are flagged transparent so they render in the ordered (renderOrder) pass, after the organs.
  const prepass = useMemo(
    () => ({
      shell: new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: shellFragment, uniforms: mats.shell.uniforms, colorWrite: false, transparent: true }),
      water: new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: waterFragment, uniforms: mats.water.uniforms, colorWrite: false, transparent: true }),
    }),
    [mats],
  );

  useEffect(() => {
    mats.shell.uniforms.uBase.value.set(dark ? '#0c2a4d' : '#bae6fd');
    mats.shell.uniforms.uRim.value.set(dark ? '#38bdf8' : '#0ea5e9');
  }, [dark, mats]);

  // Water flowing down from the mouth to the water line after a drink.
  const flow = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FLOW_PARTICLES * 3), 3));
    const seeds = Array.from({ length: FLOW_PARTICLES }, () => ({
      delay: Math.random() * 0.9,
      dx: (Math.random() - 0.5) * 0.1,
      dz: (Math.random() - 0.5) * 0.05,
      speed: 0.8 + Math.random() * 0.5,
    }));
    const mat = new THREE.PointsMaterial({ color: '#a5f3fc', size: 0.03, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    return { geo, seeds, mat };
  }, []);

  // Bubbles rising inside the water (torso and legs).
  const bubbles = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BUBBLES * 3), 3));
    const seeds = Array.from({ length: BUBBLES }, () => {
      const inTorso = Math.random() < 0.6;
      const x = inTorso ? (Math.random() - 0.5) * 0.22 : (Math.random() < 0.5 ? -1 : 1) * (0.07 + Math.random() * 0.03);
      return { x, z: (Math.random() - 0.5) * 0.08, y: Math.random() * (inTorso ? 1.5 : 0.9), speed: 0.04 + Math.random() * 0.1 };
    });
    const mat = new THREE.PointsMaterial({ color: '#e0f2fe', size: 0.014, transparent: true, opacity: 0.6, depthWrite: false });
    return { geo, seeds, mat };
  }, []);

  useEffect(() => {
    if (drinkKey > 0) pulseStart.current = clockRef.current;
  }, [drinkKey]);

  useEffect(
    () => () => {
      [shellGeo, waterGeo, anatomy.organs, anatomy.brain, anatomy.heart, anatomy.bones, flow.geo, bubbles.geo].forEach((g) => g.dispose());
      [...Object.values(mats), ...Object.values(prepass), flow.mat, bubbles.mat].forEach((m) => m.dispose());
    },
    [shellGeo, waterGeo, anatomy, mats, prepass, flow, bubbles],
  );

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    clockRef.current = t;
    level.current += (levelFor(percent) - level.current) * Math.min(dt * 1.8, 1);
    const since = t - pulseStart.current;
    const pulse = since >= 0 && since < 3 ? Math.exp(-since * 1.4) : 0;

    mats.water.uniforms.uLevel.value = level.current;
    mats.water.uniforms.uTime.value = t;
    mats.water.uniforms.uPulse.value = pulse;
    mats.shell.uniforms.uTime.value = t;
    mats.shell.uniforms.uGlow.value = percent >= 100 ? 0.6 + Math.sin(t * 2.5) * 0.4 : pulse * 0.8;
    for (const m of [mats.organs, mats.brain, mats.heart, mats.bones]) m.uniforms.uLevel.value = level.current;

    // heartbeat (~66 bpm, faster right after a drink)
    if (heartRef.current) {
      const beat = Math.pow(Math.max(Math.sin(t * Math.PI * 2 * (1.1 + pulse)), 0), 8);
      heartRef.current.scale.setScalar(1 + beat * 0.12);
    }

    const fp = flow.geo.attributes.position as THREE.BufferAttribute;
    let anyVisible = false;
    flow.seeds.forEach((s, i) => {
      const p = (since - s.delay) * s.speed;
      if (since < 0 || p < 0 || p > 1) {
        fp.setXYZ(i, 0, -10, 0);
        return;
      }
      anyVisible = true;
      const startY = 1.68;
      const endY = Math.max(level.current, 0.1);
      const spread = Math.min(Math.max(p * 3 - 1, 0), 1);
      fp.setXYZ(i, s.dx * spread + Math.sin(t * 8 + i) * 0.006, startY + (endY - startY) * p * p, 0.035 + s.dz * spread);
    });
    fp.needsUpdate = true;
    flow.mat.opacity = anyVisible ? 0.95 : 0;

    const bp = bubbles.geo.attributes.position as THREE.BufferAttribute;
    bubbles.seeds.forEach((b, i) => {
      b.y += b.speed * dt * (1 + pulse * 4);
      if (b.y > level.current - 0.015) b.y = 0.05 + Math.random() * 0.2;
      bp.setXYZ(i, b.x + Math.sin(t * 2 + i) * 0.008, level.current > 0.08 ? b.y : -10, b.z);
    });
    bp.needsUpdate = true;
  });

  return (
    <group>
      {/* Order matters: organs first, then water and skin draw only their outermost surface over them. */}
      <mesh geometry={anatomy.bones} material={mats.bones} renderOrder={1} />
      <mesh geometry={anatomy.organs} material={mats.organs} renderOrder={2} />
      <mesh geometry={anatomy.brain} material={mats.brain} renderOrder={2} />
      <mesh ref={heartRef} geometry={anatomy.heart} material={mats.heart} position={anatomy.heartCenter} renderOrder={2} />
      <points geometry={bubbles.geo} material={bubbles.mat} renderOrder={3} />
      <points geometry={flow.geo} material={flow.mat} renderOrder={3} />
      <mesh geometry={waterGeo} material={prepass.water} renderOrder={4} />
      <mesh geometry={waterGeo} material={mats.water} renderOrder={5} />
      <mesh geometry={shellGeo} material={prepass.shell} renderOrder={6} />
      <mesh geometry={shellGeo} material={mats.shell} renderOrder={7} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[0.55, 64]} />
        <meshBasicMaterial color={dark ? '#0e2a47' : '#bae6fd'} transparent opacity={0.6} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.53, 0.565, 64]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

function Controls({ autoRotate }: { autoRotate: boolean }) {
  const { camera, gl } = useThree();
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl]);
  useEffect(() => {
    controls.target.set(0, 0.95, 0);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minDistance = 1.6;
    controls.maxDistance = 5.5;
    controls.minPolarAngle = 0.9;
    controls.maxPolarAngle = 2.0;
    controls.autoRotateSpeed = 1.2;
    let resumeTimer: ReturnType<typeof setTimeout>;
    // Pause auto-rotation while the user drags; resume a few seconds later.
    const onStart = () => {
      controls.autoRotate = false;
      clearTimeout(resumeTimer);
    };
    const onEnd = () => {
      resumeTimer = setTimeout(() => (controls.autoRotate = autoRotate), 4000);
    };
    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);
    return () => {
      clearTimeout(resumeTimer);
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
    };
  }, [controls, autoRotate]);
  useEffect(() => {
    controls.autoRotate = autoRotate;
  }, [controls, autoRotate]);
  useEffect(() => () => controls.dispose(), [controls]);
  useFrame(() => controls.update());
  return null;
}

export function Body3D({ percent, drinkKey, dark, animated }: { percent: number; drinkKey: number; dark: boolean; animated: boolean }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 1.0, 3.9], fov: 34 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      aria-label={`3D body showing ${Math.round(percent)} percent of today's water goal`}
    >
      <BodyModel percent={percent} drinkKey={drinkKey} dark={dark} />
      <Controls autoRotate={animated} />
    </Canvas>
  );
}
