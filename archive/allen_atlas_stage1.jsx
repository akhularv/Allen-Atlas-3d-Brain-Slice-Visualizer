/**
 * Allen Atlas Oblique Slice Planner — Stage 1
 * 3D scene with all structures, orbit controls, region toggles,
 * circuit presets, and slice plane widget.
 *
 * Implements SYSTEM_SPEC.md §2–§3 and INTERFACE_CONTRACTS.md §All Modules.
 * Three.js r128 via CDN (window.THREE, loaded by artifact HTML wrapper).
 *
 * SPEC NOTE: SYSTEM_SPEC.md §4 pins Three.js r165, but the Stage 1
 * invocation brief specifies r128. r128 is used here per the brief.
 * Flag to Architect before Stage 2 if the version should be reconciled.
 *
 * SPEC NOTE: INTERFACE_CONTRACTS.md §ControlsPanel specifies apPosition
 * as [0, 100]% normalized. The brief specifies [-3000, 3000] µm raw.
 * Raw µm is used here for physical interpretability; normalization
 * should be resolved in INTERFACE_CONTRACTS v2 before Stage 2.
 */

// ---------------------------------------------------------------------------
// Google Fonts injection (DM Mono + Playfair Display)
// ---------------------------------------------------------------------------
const FONT_STYLE = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Playfair+Display:wght@400;600&display=swap');

/* Slider thumb accent — target the accent color defined below */
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  background: #DDD8CE;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #4A6741;
  cursor: pointer;
  border: 2px solid #FAF8F5;
  box-shadow: 0 0 0 1px #4A6741;
}
input[type="range"]::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #4A6741;
  cursor: pointer;
  border: 2px solid #FAF8F5;
  box-shadow: 0 0 0 1px #4A6741;
}
`;

// ---------------------------------------------------------------------------
// Design tokens — all magic colors live here, not scattered in JSX
// ---------------------------------------------------------------------------
const T = {
  bg:           '#FAF8F5',   // cream background
  panelBg:      '#F5F2EC',   // panel background
  border:       '#DDD8CE',   // border color
  accent:       '#4A6741',   // muted botanical green
  gold:         '#C4A35A',   // warm gold — active / selected
  text:         '#3D3530',   // primary text
  textMuted:    '#8A8078',   // muted labels
  fontMono:     '"DM Mono", monospace',
  fontSerif:    '"Playfair Display", Georgia, serif',
};

// ---------------------------------------------------------------------------
// CCF_STRUCTURES Registry
// INTERFACE_CONTRACTS.md §Module: CCF_STRUCTURES Registry
// Frozen at load time; no module may mutate this object.
// Fields: acronym, label (full name), group, color, center_ccf [AP,DV,ML µm],
//         semi_axes [a,b,c µm], euler_ccf [rx,ry,rz rad] (all zero = axis-aligned)
// ---------------------------------------------------------------------------
const CCF_STRUCTURES_RAW = [
  // ---- THALAMUS -----------------------------------------------------------
  { acronym:'VPM',     label:'Ventral posteromedial nucleus',
    color:'#FF6B6B', group:'thalamus',
    center_ccf:[5900,4300,4700], semi_axes:[380,320,290], euler_ccf:[0,0,0] },
  { acronym:'VPL',     label:'Ventral posterolateral nucleus',
    color:'#FF8E53', group:'thalamus',
    center_ccf:[5950,4350,4200], semi_axes:[430,340,330], euler_ccf:[0,0,0] },
  { acronym:'LP',      label:'Lateral posterior nucleus',
    color:'#FFA07A', group:'thalamus',
    center_ccf:[5400,3950,4500], semi_axes:[360,310,290], euler_ccf:[0,0,0] },
  { acronym:'PO',      label:'Posterior complex',
    color:'#FFB347', group:'thalamus',
    center_ccf:[6100,4400,5000], semi_axes:[340,290,280], euler_ccf:[0,0,0] },
  { acronym:'MD',      label:'Mediodorsal nucleus',
    color:'#FF69B4', group:'thalamus',
    center_ccf:[5500,3800,5500], semi_axes:[490,380,340], euler_ccf:[0,0,0] },
  { acronym:'RT',      label:'Reticular nucleus',
    color:'#DA70D6', group:'thalamus',
    center_ccf:[5700,4100,4600], semi_axes:[580,190,490], euler_ccf:[0,0,0] },

  // ---- CORTEX -------------------------------------------------------------
  { acronym:'SSp',     label:'Primary somatosensory area',
    color:'#2ECC71', group:'cortex',
    center_ccf:[4500,2800,4200], semi_axes:[680,480,580], euler_ccf:[0,0,0] },
  { acronym:'SSp-bfd', label:'Barrel field',
    color:'#27AE60', group:'cortex',
    center_ccf:[4200,2900,4000], semi_axes:[390,380,340], euler_ccf:[0,0,0] },
  { acronym:'MOp',     label:'Primary motor area',
    color:'#1ABC9C', group:'cortex',
    center_ccf:[3200,2500,4500], semi_axes:[780,480,680], euler_ccf:[0,0,0] },
  { acronym:'VISp',    label:'Primary visual area',
    color:'#16A085', group:'cortex',
    center_ccf:[6500,3000,4300], semi_axes:[580,480,530], euler_ccf:[0,0,0] },
  { acronym:'AUDp',    label:'Primary auditory area',
    color:'#48C9B0', group:'cortex',
    center_ccf:[5200,3200,3800], semi_axes:[530,430,460], euler_ccf:[0,0,0] },

  // ---- FIBER TRACTS -------------------------------------------------------
  { acronym:'ic',      label:'Internal capsule',
    color:'#BDC3C7', group:'fiber',
    center_ccf:[5600,4000,4700], semi_axes:[780,190,240], euler_ccf:[0,0,0] },
  { acronym:'cc',      label:'Corpus callosum',
    color:'#D5D8DC', group:'fiber',
    center_ccf:[4800,3000,5500], semi_axes:[1950,140,780], euler_ccf:[0,0,0] },
  { acronym:'ec',      label:'External capsule',
    color:'#AAB7B8', group:'fiber',
    center_ccf:[5000,3400,4000], semi_axes:[900,150,200], euler_ccf:[0,0,0] },

  // ---- HIPPOCAMPUS --------------------------------------------------------
  { acronym:'CA1',     label:"Ammon's horn CA1",
    color:'#8E44AD', group:'hippocampus',
    center_ccf:[5800,3500,4800], semi_axes:[680,240,390], euler_ccf:[0,0,0] },
  { acronym:'CA3',     label:"Ammon's horn CA3",
    color:'#9B59B6', group:'hippocampus',
    center_ccf:[5500,3600,5200], semi_axes:[480,240,340], euler_ccf:[0,0,0] },
  { acronym:'DG',      label:'Dentate gyrus',
    color:'#BB8FCE', group:'hippocampus',
    center_ccf:[5700,3700,5000], semi_axes:[580,290,390], euler_ccf:[0,0,0] },

  // ---- SUBCORTICAL --------------------------------------------------------
  { acronym:'CP',      label:'Caudoputamen',
    color:'#F39C12', group:'subcortical',
    center_ccf:[4000,3600,4500], semi_axes:[880,680,780], euler_ccf:[0,0,0] },
  { acronym:'SNr',     label:'Substantia nigra reticular',
    color:'#E67E22', group:'subcortical',
    center_ccf:[7200,4800,5300], semi_axes:[480,240,380], euler_ccf:[0,0,0] },
];

// Validate registry at load time — INTERFACE_CONTRACTS §CCF_STRUCTURES §Failure Modes
(function validateRegistry(raw) {
  const seen = new Set();
  raw.forEach((s, i) => {
    if (!s.acronym)       throw new Error(`CCF_STRUCTURES[${i}]: missing acronym`);
    if (!s.center_ccf || s.center_ccf.length !== 3)
      throw new Error(`CCF_STRUCTURES[${i}] "${s.acronym}": missing or malformed center_ccf`);
    if (seen.has(s.acronym))
      throw new Error(`CCF_STRUCTURES: duplicate acronym "${s.acronym}"`);
    if (!s.semi_axes || s.semi_axes.some(v => v <= 0))
      throw new Error(`CCF_STRUCTURES[${i}] "${s.acronym}": semi_axes must all be > 0`);
    if (!s.group)
      throw new Error(`CCF_STRUCTURES[${i}] "${s.acronym}": missing group`);
    if (!['thalamus','cortex','fiber','hippocampus','subcortical'].includes(s.group))
      throw new Error(`CCF_STRUCTURES[${i}] "${s.acronym}": unrecognized group "${s.group}"`);
    seen.add(s.acronym);
  });
})(CCF_STRUCTURES_RAW);

// Frozen registry — no module may mutate
const CCF_STRUCTURES = Object.freeze(
  CCF_STRUCTURES_RAW.map(s => Object.freeze({ ...s }))
);

// Lookup map: acronym → record (built once)
const CCF_BY_ACRONYM = Object.freeze(
  Object.fromEntries(CCF_STRUCTURES.map(s => [s.acronym, s]))
);

// Group membership map: group → [acronym, ...]
const CCF_BY_GROUP = Object.freeze(
  CCF_STRUCTURES.reduce((acc, s) => {
    if (!acc[s.group]) acc[s.group] = [];
    acc[s.group].push(s.acronym);
    return acc;
  }, {})
);

// Group swatch colors
const GROUP_COLORS = Object.freeze({
  thalamus:    '#FF6B6B',
  cortex:      '#2ECC71',
  fiber:       '#BDC3C7',
  hippocampus: '#8E44AD',
  subcortical: '#F39C12',
});

// ---------------------------------------------------------------------------
// Coordinate Utilities
// INTERFACE_CONTRACTS.md §Module: Coordinate Utilities
//
// CCF v3 axes (in µm):
//   x = AP  (anterior=low, posterior=high; full range ~0–13200)
//   y = DV  (dorsal=low, ventral=high; full range ~0–8000)
//   z = ML  (medial=low, lateral=high; full range ~0–11400)
//
// Three.js scene: Y-up, right-handed
//   threeX = ML offset  (lateral = positive X)
//   threeY = DV offset  (dorsal  = positive Y)
//   threeZ = AP offset  (anterior = negative Z, posterior = positive Z)
//
// Remapping (per brief):
//   threeX =  ccfZ - 5700   (ML centered on 5700 midline)
//   threeY = -(ccfY - 4000) (DV flipped: dorsal up in Three.js)
//   threeZ = -(ccfX - 5700) (AP: anterior = negative Z)
//
// CCF bregma reference: AP≈5400, DV≈0, ML≈5700 → threeX=0, threeY=4000, threeZ=0
// ---------------------------------------------------------------------------

/**
 * Convert CCF v3 coordinates (µm) to Three.js world-space coordinates.
 *
 * Args:
 *   ccfX: AP axis position in µm [0, 13200]
 *   ccfY: DV axis position in µm [0, 8000]
 *   ccfZ: ML axis position in µm [0, 11400]
 * Returns:
 *   { x, y, z } in Three.js scene units (1 unit = 1 µm)
 * Raises:
 *   Error if any input is NaN or Infinity (INTERFACE_CONTRACTS §ccfToThree §Failure Modes)
 */
function ccfToThree(ccfX, ccfY, ccfZ) {
  if (!isFinite(ccfX) || !isFinite(ccfY) || !isFinite(ccfZ)) {
    throw new Error(
      `ccfToThree: non-finite input (${ccfX}, ${ccfY}, ${ccfZ})`
    );
  }
  return {
    x:  ccfZ - 5700,   // ML → Three.js X (centered on midline)
    y: -(ccfY - 4000), // DV → Three.js Y (flipped: dorsal = positive Y)
    z: -(ccfX - 5700), // AP → Three.js Z (anterior = negative Z)
  };
}

/**
 * Build a Three.js Euler for the slice plane from pitch/yaw/roll in degrees.
 * Rotation order XYZ applied to an initially coronal (XY-plane) orientation.
 * At pitch=0, yaw=0, roll=0 the plane faces the -Z direction (coronal cut).
 *
 * Args:
 *   pitch: rotation about X axis in degrees [-90, 90]
 *   yaw:   rotation about Y axis in degrees [-90, 90]
 *   roll:  rotation about Z axis in degrees [-90, 90]
 * Returns:
 *   { x, y, z } Euler angles in radians for THREE.Euler('XYZ')
 */
function buildPlaneEuler(pitch, yaw, roll) {
  const DEG2RAD = Math.PI / 180;
  return {
    x: pitch * DEG2RAD,
    y: yaw   * DEG2RAD,
    z: roll  * DEG2RAD,
  };
}

// ---------------------------------------------------------------------------
// Preset Engine (applyPreset)
// INTERFACE_CONTRACTS.md §Module: Preset Engine
//
// SPEC NOTE (OD-06): Exact preset angles are marked [OPEN DECISION] in the spec.
// Values below come from the Stage 1 brief (Agmon-Connors thalamocortical: -35°
// pitch; hippocampal: 15° yaw). These must be validated by a domain expert
// before Stage 2 / clinical use.
// ---------------------------------------------------------------------------

// Named preset definitions — hardcoded per brief
const PRESETS = Object.freeze({
  tc: Object.freeze({
    pitch: -35, yaw: 0, roll: 0, apPosition: 0,
    highlighted: ['VPM','VPL','LP','ic','SSp','SSp-bfd','MOp'],
  }),
  hippo: Object.freeze({
    pitch: 0, yaw: 15, roll: 0, apPosition: 0,
    highlighted: ['CA1','CA3','DG'],
  }),
});

/**
 * Apply a named circuit preset atomically.
 * Both setSliceState and setHighlightState are called synchronously.
 * INTERFACE_CONTRACTS §applyPreset: must throw on unrecognized presetName.
 *
 * Args:
 *   presetName:        'tc' | 'hippo'
 *   currentThickness:  current thickness value (presets do not change thickness)
 *   setSliceState:     React state setter
 *   setHighlightState: React state setter
 * Raises:
 *   Error if presetName is not recognized
 */
function applyPreset(presetName, currentThickness, setSliceState, setHighlightState) {
  if (!Object.prototype.hasOwnProperty.call(PRESETS, presetName)) {
    // INTERFACE_CONTRACTS §applyPreset §Failure Modes: must throw, not silently ignore
    throw new Error(`applyPreset: unrecognized presetName "${presetName}"`);
  }
  const p = PRESETS[presetName];
  // Both setters called synchronously — CR-05 atomicity guarantee
  setSliceState(prev => ({
    ...prev,
    pitch:      p.pitch,
    yaw:        p.yaw,
    roll:       p.roll,
    apPosition: p.apPosition,
    // thickness unchanged per INTERFACE_CONTRACTS §applyPreset invariants
  }));
  setHighlightState({
    preset:      presetName,
    highlighted: p.highlighted,
  });
}

/**
 * Toggle all structure meshes in a named group.
 * INTERFACE_CONTRACTS §toggleGroup: throws on unrecognized groupName.
 *
 * Args:
 *   groupName:       one of the five permitted group strings
 *   visible:         boolean
 *   meshMapRef:      ref to { [acronym]: THREE.Mesh }
 *   setVisibility:   React state setter for visibilityState
 * Raises:
 *   Error if groupName is not recognized
 */
function toggleGroup(groupName, visible, meshMapRef, setVisibility) {
  if (!Object.prototype.hasOwnProperty.call(CCF_BY_GROUP, groupName)) {
    throw new Error(`toggleGroup: unrecognized groupName "${groupName}"`);
  }
  const members = CCF_BY_GROUP[groupName];
  // Apply to meshes immediately for zero-lag visual feedback
  members.forEach(acronym => {
    const mesh = meshMapRef.current[acronym];
    if (!mesh) {
      console.warn(`toggleGroup: acronym "${acronym}" not found in mesh map`);
      return;
    }
    mesh.visible = visible;
  });
  // Write a new visibilityState snapshot atomically — CR-03
  setVisibility(prev => {
    const next = { ...prev };
    members.forEach(a => { next[a] = visible; });
    return next;
  });
}

// ---------------------------------------------------------------------------
// Derive initial visibility state (all structures visible)
// ---------------------------------------------------------------------------
function makeInitialVisibility() {
  return Object.fromEntries(CCF_STRUCTURES.map(s => [s.acronym, true]));
}

function makeInitialGroupVisibility() {
  return Object.fromEntries(Object.keys(CCF_BY_GROUP).map(g => [g, true]));
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function AllenAtlasStage1() {
  const React = window.React;
  const { useState, useEffect, useRef, useCallback } = React;

  // ---- Shared state -------------------------------------------------------
  const [sliceState, setSliceState] = useState({
    pitch:      0,
    yaw:        0,
    roll:       0,
    apPosition: 0,     // raw µm offset along AP axis
    thickness:  400,   // µm; default 400 µm per brief
  });

  const [highlightState, setHighlightState] = useState({
    preset:      null,
    highlighted: [],
  });

  const [visibilityState, setVisibilityState] = useState(makeInitialVisibility);
  const [groupVisibility, setGroupVisibility] = useState(makeInitialGroupVisibility);

  // Camera state — written by orbit handler, read by AxisIndicator
  const [cameraState, setCameraState] = useState({
    theta:  Math.PI / 6,   // initial azimuthal angle (radians)
    phi:    Math.PI / 3,   // initial polar angle (radians)
    radius: 800,           // initial distance from target (scene units / µm)
  });

  // Active thickness pill
  const [activeThickness, setActiveThickness] = useState(400);

  // Expanded state for RegionTogglePanel
  const [panelExpanded,     setPanelExpanded]     = useState(true);
  const [expandedGroups,    setExpandedGroups]    = useState({});

  // ---- Refs ---------------------------------------------------------------
  const mountRef    = useRef(null);    // DOM node for Three.js canvas
  const axisCanvasRef = useRef(null); // small axis indicator canvas
  const meshMapRef  = useRef({});     // { [acronym]: THREE.Mesh }
  const shellRef    = useRef(null);   // brain shell mesh
  const planeRef    = useRef(null);   // slice plane widget mesh
  const rendererRef = useRef(null);
  const sceneRef    = useRef(null);
  const cameraRef   = useRef(null);
  const frameRef    = useRef(null);

  // Orbit state — kept in a ref to avoid re-render on every pointer move
  const orbitRef = useRef({
    isPointerDown: false,
    lastX: 0,
    lastY: 0,
    theta:  Math.PI / 6,
    phi:    Math.PI / 3,
    radius: 800,
    // Orbit target in Three.js world space — starts at brain center
    targetX: 0, targetY: 0, targetZ: 0,
  });

  // Slice state ref — read by animation loop without triggering re-renders
  const sliceStateRef = useRef(sliceState);
  useEffect(() => { sliceStateRef.current = sliceState; }, [sliceState]);

  // Visibility ref — read by animation loop
  const visibilityRef = useRef(visibilityState);
  useEffect(() => { visibilityRef.current = visibilityState; }, [visibilityState]);

  // Highlight ref — read by animation loop
  const highlightRef = useRef(highlightState);
  useEffect(() => { highlightRef.current = highlightState; }, [highlightState]);

  // ---- Three.js scene init ------------------------------------------------
  useEffect(() => {
    const THREE = window.THREE;
    if (!THREE) {
      console.error('Three.js not found on window.THREE — ensure CDN script is loaded');
      return;
    }

    const mount = mountRef.current;
    const w = mount.clientWidth;
    const h = mount.clientHeight;

    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    renderer.sortObjects = true; // required for renderOrder + transparent meshes
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // --- Scene ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#FAF8F5');
    sceneRef.current = scene;

    // --- Camera ---
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 10000);
    // Initial position derived from orbitRef spherical coords
    const { theta, phi, radius } = orbitRef.current;
    camera.position.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta),
    );
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // --- Lights ---
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(1, 2, 3);
    scene.add(dirLight);

    // --- Brain shell (renderOrder 0) ---
    const shellGeo = new THREE.SphereGeometry(1, 48, 32);
    shellGeo.applyMatrix4(new THREE.Matrix4().makeScale(580, 380, 480));
    const shellMat = new THREE.MeshPhongMaterial({
      color:       new THREE.Color('#BBBBBB'),
      opacity:     0.06,
      transparent: true,
      side:        THREE.DoubleSide,
      depthWrite:  false,
      wireframe:   false,
    });
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.renderOrder = 0; // immutable per INTERFACE_CONTRACTS §BrainViewer
    scene.add(shell);
    shellRef.current = shell;

    // --- Structure meshes (renderOrder 1 default) ---
    const meshMap = {};
    CCF_STRUCTURES.forEach(s => {
      const [rx, ry, rz] = s.semi_axes;
      const geo = new THREE.SphereGeometry(1, 32, 24);
      // Scale unit sphere to match semi-axes (µm = scene units)
      geo.applyMatrix4(new THREE.Matrix4().makeScale(rx, ry, rz));

      const mat = new THREE.MeshPhongMaterial({
        color:       new THREE.Color(s.color),
        opacity:     0.70,
        transparent: true,
        side:        THREE.DoubleSide,
        depthWrite:  false,
      });

      const mesh = new THREE.Mesh(geo, mat);
      const pos  = ccfToThree(...s.center_ccf);
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.renderOrder = 1; // default; overridden by highlightState reconciler
      mesh.userData = {
        acronym: s.acronym,
        label:   s.label,
        color:   s.color,
        group:   s.group,
      };

      scene.add(mesh);
      meshMap[s.acronym] = mesh;
    });
    meshMapRef.current = meshMap;

    // --- Slice plane widget (renderOrder 3) ---
    const planeGeo = new THREE.PlaneGeometry(900, 700);
    const planeMat = new THREE.MeshBasicMaterial({
      color:       new THREE.Color('#4A90D9'),
      opacity:     0.22,
      transparent: true,
      side:        THREE.DoubleSide,
      depthWrite:  false,
    });
    const planeMesh = new THREE.Mesh(planeGeo, planeMat);
    planeMesh.renderOrder = 3;
    scene.add(planeMesh);
    planeRef.current = planeMesh;

    // --- Animation loop ---
    function animate() {
      frameRef.current = requestAnimationFrame(animate);

      // Reconcile visibility + highlight from refs (avoids stale closure)
      const vis  = visibilityRef.current;
      const hi   = highlightRef.current;
      const hiSet = new Set(hi.highlighted);

      Object.entries(meshMap).forEach(([acronym, mesh]) => {
        // Visibility — INTERFACE_CONTRACTS §BrainViewer: only .visible is set
        mesh.visible = vis[acronym] !== false; // default true if key missing

        if (!mesh.visible) return; // skip renderOrder for hidden meshes

        // Highlight reconciler — CR-04: only this one place sets renderOrder/opacity
        if (hiSet.has(acronym)) {
          mesh.renderOrder = 2;
          mesh.material.opacity = 0.92;
          // Emissive tint: structure color × 0.25
          const emissive = new THREE.Color(mesh.userData.color).multiplyScalar(0.25);
          mesh.material.emissive = emissive;
        } else if (hi.preset !== null) {
          // Non-highlighted meshes are dimmed when a preset is active
          mesh.renderOrder = 1;
          mesh.material.opacity = 0.12;
          mesh.material.emissive = new THREE.Color(0x000000);
        } else {
          // Reset state
          mesh.renderOrder = 1;
          mesh.material.opacity = 0.70;
          mesh.material.emissive = new THREE.Color(0x000000);
        }
      });

      // Update slice plane orientation from sliceStateRef
      const ss = sliceStateRef.current;
      if (planeRef.current) {
        const euler = buildPlaneEuler(ss.pitch, ss.yaw, ss.roll);
        planeRef.current.rotation.set(euler.x, euler.y, euler.z, 'XYZ');
        // Translate plane along Three.js Z axis (AP) by apPosition
        // apPosition in µm maps directly to Three.js Z offset (negated for AP convention)
        planeRef.current.position.set(0, 0, -ss.apPosition);
      }

      renderer.render(scene, camera);

      // Draw axis indicator on its own canvas
      drawAxisIndicator();
    }

    animate();

    // --- Resize handler ---
    function onResize() {
      const w2 = mount.clientWidth;
      const h2 = mount.clientHeight;
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2);
    }
    window.addEventListener('resize', onResize);

    // --- Manual orbit controls (pointer events) ---
    // SYSTEM_SPEC §3.2 — OrbitControls not available in r128 CDN bundle
    function updateCamera() {
      const o = orbitRef.current;
      const sinPhi   = Math.sin(o.phi);
      const cosPhi   = Math.cos(o.phi);
      const sinTheta = Math.sin(o.theta);
      const cosTheta = Math.cos(o.theta);
      camera.position.set(
        o.targetX + o.radius * sinPhi * sinTheta,
        o.targetY + o.radius * cosPhi,
        o.targetZ + o.radius * sinPhi * cosTheta,
      );
      camera.lookAt(o.targetX, o.targetY, o.targetZ);
      // Expose current theta/phi for AxisIndicator (CR-06)
      setCameraState({ theta: o.theta, phi: o.phi, radius: o.radius });
    }

    function onPointerDown(e) {
      const o = orbitRef.current;
      o.isPointerDown = true;
      o.lastX = e.clientX;
      o.lastY = e.clientY;
      mount.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
      const o = orbitRef.current;
      if (!o.isPointerDown) return;
      const dx = e.clientX - o.lastX;
      const dy = e.clientY - o.lastY;
      o.lastX = e.clientX;
      o.lastY = e.clientY;

      if (e.shiftKey) {
        // Pan: move target along camera right and up axes
        const PAN_SPEED = 0.8; // µm per pixel
        // Right vector: cross(up_world, viewDir) — approximate for now
        const sinTheta = Math.sin(o.theta);
        const cosTheta = Math.cos(o.theta);
        // Camera right is perpendicular to view direction in XZ plane
        o.targetX -= dx * cosTheta * PAN_SPEED;
        o.targetZ += dx * sinTheta * PAN_SPEED;
        o.targetY += dy * PAN_SPEED;
      } else {
        // Orbit: update theta (azimuthal) and phi (polar)
        const ORBIT_SPEED = 0.005; // radians per pixel
        o.theta -= dx * ORBIT_SPEED;
        o.phi   -= dy * ORBIT_SPEED;
        // Clamp phi to avoid gimbal lock at poles
        // INTERFACE_CONTRACTS §BrainViewer: phi ∈ [ε, π-ε], ε = 0.05
        const PHI_MIN = 0.05;
        const PHI_MAX = Math.PI - 0.05;
        o.phi = Math.max(PHI_MIN, Math.min(PHI_MAX, o.phi));
      }
      updateCamera();
    }

    function onPointerUp(e) {
      orbitRef.current.isPointerDown = false;
      mount.releasePointerCapture(e.pointerId);
    }

    function onWheel(e) {
      e.preventDefault();
      const ZOOM_SPEED  = 0.001;
      const RADIUS_MIN  = 80;
      const RADIUS_MAX  = 2000;
      orbitRef.current.radius *= (1 + e.deltaY * ZOOM_SPEED);
      orbitRef.current.radius = Math.max(
        RADIUS_MIN,
        Math.min(RADIUS_MAX, orbitRef.current.radius)
      );
      updateCamera();
    }

    mount.addEventListener('pointerdown',   onPointerDown);
    mount.addEventListener('pointermove',   onPointerMove);
    mount.addEventListener('pointerup',     onPointerUp);
    mount.addEventListener('pointercancel', onPointerUp);
    mount.addEventListener('wheel', onWheel, { passive: false });

    // ---- Cleanup (mandatory per SYSTEM_SPEC §3.2) ----
    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', onResize);
      mount.removeEventListener('pointerdown',   onPointerDown);
      mount.removeEventListener('pointermove',   onPointerMove);
      mount.removeEventListener('pointerup',     onPointerUp);
      mount.removeEventListener('pointercancel', onPointerUp);
      mount.removeEventListener('wheel', onWheel);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  // ---------------------------------------------------------------------------
  // Axis indicator — drawn on a 2D canvas overlay using cameraState
  // INTERFACE_CONTRACTS §AxisIndicator: receives only theta/phi, never camera ref
  // ---------------------------------------------------------------------------
  function drawAxisIndicator() {
    const canvas = axisCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const SIZE   = 80;   // canvas size in px
    const CENTER = 40;   // center point
    const LENGTH = 28;   // arrow length in px

    ctx.clearRect(0, 0, SIZE, SIZE);

    // Draw background circle
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, 36, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(245, 242, 236, 0.85)';
    ctx.fill();
    ctx.strokeStyle = '#DDD8CE';
    ctx.lineWidth = 1;
    ctx.stroke();

    const { theta, phi } = orbitRef.current; // read directly from orbit state

    // Basis vectors of the camera's view matrix
    // We rotate the three world axes by the current view direction
    // to determine where they project on screen.
    //
    // Camera looks from (sinPhi*sinTheta, cosPhi, sinPhi*cosTheta) toward origin.
    // Camera "right" (screen X): d/dTheta of position = (sinPhi*cosTheta, 0, -sinPhi*sinTheta), normalized
    // Camera "up" (screen Y): d/dPhi of position (negated for up) = ...
    // We project each world axis onto (right, up) screen basis.

    const sinPhi   = Math.sin(phi);
    const cosPhi   = Math.cos(phi);
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    // Camera right vector (unnormalized): ∂pos/∂theta / |∂pos/∂theta|
    const rightX =  sinPhi * cosTheta;
    const rightY =  0;
    const rightZ = -sinPhi * sinTheta;
    const rightLen = Math.sqrt(rightX*rightX + rightY*rightY + rightZ*rightZ) || 1;

    // Camera up vector (unnormalized): -∂pos/∂phi / |∂pos/∂phi|
    const upX = -(cosPhi * sinTheta);
    const upY =  sinPhi;
    const upZ = -(cosPhi * cosTheta);
    const upLen = Math.sqrt(upX*upX + upY*upY + upZ*upZ) || 1;

    // Project each world axis unit vector onto screen (right, up)
    function projectAxis(ax, ay, az) {
      const screenX = (ax * rightX + ay * rightY + az * rightZ) / rightLen;
      const screenY = (ax * upX    + ay * upY    + az * upZ)    / upLen;
      return { sx: screenX, sy: -screenY }; // flip Y for canvas convention
    }

    // World axes: X=Three.js X (ML/lateral), Y=Three.js Y (DV/dorsal), Z=Three.js Z (AP/anterior)
    const axes = [
      { vec: [1,0,0], color: '#E74C3C', label: 'R'  }, // Three.js X → lateral / Right
      { vec: [0,1,0], color: '#2ECC71', label: 'D'  }, // Three.js Y → dorsal
      { vec: [0,0,1], color: '#3498DB', label: 'A'  }, // Three.js Z → anterior (negated AP)
    ];

    // Sort by depth so front axes draw last (painter's algorithm)
    const projected = axes.map(a => {
      const { sx, sy } = projectAxis(...a.vec);
      // Depth approximation: dot with view direction
      const viewX = sinPhi * sinTheta;
      const viewY = cosPhi;
      const viewZ = sinPhi * cosTheta;
      const depth = a.vec[0]*viewX + a.vec[1]*viewY + a.vec[2]*viewZ;
      return { ...a, sx, sy, depth };
    });
    projected.sort((a, b) => a.depth - b.depth); // back-to-front

    projected.forEach(({ sx, sy, color, label }) => {
      const ex = CENTER + sx * LENGTH;
      const ey = CENTER + sy * LENGTH;

      // Arrow line
      ctx.beginPath();
      ctx.moveTo(CENTER, CENTER);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Arrowhead
      const angle = Math.atan2(sy, sx);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(
        ex - 6 * Math.cos(angle - 0.4),
        ey - 6 * Math.sin(angle - 0.4)
      );
      ctx.lineTo(
        ex - 6 * Math.cos(angle + 0.4),
        ey - 6 * Math.sin(angle + 0.4)
      );
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();

      // Label
      ctx.font = 'bold 9px "DM Mono", monospace';
      ctx.fillStyle = color;
      ctx.fillText(
        label,
        ex + 5 * Math.cos(angle),
        ey + 5 * Math.sin(angle) + 4
      );
    });
  }

  // Keep axis indicator in sync when camera state changes
  useEffect(() => {
    drawAxisIndicator();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState]);

  // ---------------------------------------------------------------------------
  // Slider change handler (writes all five sliceState fields atomically)
  // INTERFACE_CONTRACTS §ControlsPanel invariant: all fields updated synchronously
  // ---------------------------------------------------------------------------
  const handleSliderChange = useCallback((field, rawValue) => {
    // Clamp to declared ranges before writing — §ControlsPanel §Failure Modes
    const RANGES = {
      pitch:      [-45, 45],
      yaw:        [-45, 45],
      roll:       [-45, 45],
      apPosition: [-3000, 3000],
    };
    let value = Number(rawValue);
    if (field in RANGES) {
      const [lo, hi] = RANGES[field];
      value = Math.max(lo, Math.min(hi, value));
    }
    setSliceState(prev => ({ ...prev, [field]: value }));
  }, []);

  // ---------------------------------------------------------------------------
  // Thickness selector
  // ---------------------------------------------------------------------------
  const THICKNESS_OPTIONS = [350, 400, 1000, 2000, 4000, 6000]; // µm
  const THICKNESS_LABELS  = ['350µm','400µm','1mm','2mm','4mm','6mm'];

  const handleThickness = useCallback((val) => {
    setActiveThickness(val);
    setSliceState(prev => ({ ...prev, thickness: val }));
  }, []);

  // ---------------------------------------------------------------------------
  // Preset button handlers
  // ---------------------------------------------------------------------------
  const handlePreset = useCallback((name) => {
    if (name === 'reset') {
      setSliceState(prev => ({
        ...prev, pitch: 0, yaw: 0, roll: 0, apPosition: 0,
      }));
      setHighlightState({ preset: null, highlighted: [] });
      return;
    }
    applyPreset(name, sliceState.thickness, setSliceState, setHighlightState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliceState.thickness]);

  // ---------------------------------------------------------------------------
  // Region toggle handlers
  // INTERFACE_CONTRACTS §RegionTogglePanel: writes new snapshot, never mutates
  // ---------------------------------------------------------------------------
  const handleToggleStructure = useCallback((acronym, checked) => {
    if (!CCF_BY_ACRONYM[acronym]) {
      console.warn(`RegionTogglePanel: unknown acronym "${acronym}"`);
      return;
    }
    // Update mesh directly for instant feedback
    const mesh = meshMapRef.current[acronym];
    if (mesh) mesh.visible = checked;
    // Write new snapshot atomically
    setVisibilityState(prev => ({ ...prev, [acronym]: checked }));
  }, []);

  const handleToggleGroup = useCallback((groupName, checked) => {
    toggleGroup(groupName, checked, meshMapRef, setVisibilityState);
    setGroupVisibility(prev => ({ ...prev, [groupName]: checked }));
  }, []);

  const toggleGroupExpand = useCallback((groupName) => {
    setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));
  }, []);

  // ---------------------------------------------------------------------------
  // Derived: check if all members of a group are visible (for group checkbox)
  // ---------------------------------------------------------------------------
  function isGroupChecked(groupName) {
    return (CCF_BY_GROUP[groupName] || []).every(a => visibilityState[a] !== false);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      {/* Google Fonts + slider styling */}
      <style>{FONT_STYLE}</style>

      {/* Root container — full viewport, no scroll */}
      <div style={{
        display:    'flex',
        width:      '100vw',
        height:     '100vh',
        overflow:   'hidden',
        background: T.bg,
        fontFamily: T.fontMono,
      }}>

        {/* ================================================================
            LEFT PANEL — 3D viewer (60%)
        ================================================================ */}
        <div style={{
          flex:     '0 0 60%',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Three.js canvas mount */}
          <div
            ref={mountRef}
            style={{ width: '100%', height: '100%', cursor: 'grab' }}
          />

          {/* Region Toggle Panel — absolute overlay top-left */}
          <div style={{
            position:    'absolute',
            top:         12,
            left:        12,
            background:  T.bg,
            border:      `1px solid ${T.border}`,
            borderRadius: 8,
            padding:     10,
            maxWidth:    210,
            fontFamily:  T.fontMono,
            fontSize:    11,
            color:       T.text,
            zIndex:      10,
            boxShadow:   '0 2px 8px rgba(0,0,0,0.08)',
            userSelect:  'none',
          }}>
            {/* Panel header */}
            <div style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'space-between',
              marginBottom:   panelExpanded ? 8 : 0,
            }}>
              <span style={{
                fontFamily:    T.fontMono,
                fontWeight:    500,
                fontSize:      11,
                letterSpacing: '0.05em',
                color:         T.text,
              }}>
                Structures
              </span>
              <button
                onClick={() => setPanelExpanded(v => !v)}
                style={{
                  background: 'none',
                  border:     'none',
                  cursor:     'pointer',
                  color:      T.textMuted,
                  fontSize:   13,
                  padding:    '0 2px',
                  lineHeight: 1,
                }}
                title={panelExpanded ? 'Collapse' : 'Expand'}
              >
                {panelExpanded ? '▲' : '▼'}
              </button>
            </div>

            {/* Group rows — only when expanded */}
            {panelExpanded && Object.keys(CCF_BY_GROUP).map(groupName => {
              const groupChecked  = isGroupChecked(groupName);
              const groupExpanded = expandedGroups[groupName];
              const members       = CCF_BY_GROUP[groupName];

              return (
                <div key={groupName} style={{ marginBottom: 4 }}>
                  {/* Group row */}
                  <div style={{
                    display:     'flex',
                    alignItems:  'center',
                    gap:         5,
                    paddingBottom: 2,
                  }}>
                    <input
                      type="checkbox"
                      checked={groupChecked}
                      onChange={e => handleToggleGroup(groupName, e.target.checked)}
                      style={{ cursor: 'pointer', accentColor: T.accent, margin: 0 }}
                    />
                    {/* Color swatch */}
                    <span style={{
                      display:      'inline-block',
                      width:        10,
                      height:       10,
                      borderRadius: 3,
                      background:   GROUP_COLORS[groupName],
                      flexShrink:   0,
                    }} />
                    <span style={{
                      flex:          1,
                      fontWeight:    500,
                      textTransform: 'capitalize',
                      fontSize:      11,
                    }}>
                      {groupName}
                    </span>
                    <button
                      onClick={() => toggleGroupExpand(groupName)}
                      style={{
                        background: 'none',
                        border:     'none',
                        cursor:     'pointer',
                        color:      T.textMuted,
                        fontSize:   11,
                        padding:    '0 2px',
                      }}
                    >
                      {groupExpanded ? '▲' : '▼'}
                    </button>
                  </div>

                  {/* Individual structure rows — only when group expanded */}
                  {groupExpanded && members.map(acronym => {
                    const s = CCF_BY_ACRONYM[acronym];
                    const checked = visibilityState[acronym] !== false;
                    return (
                      <div
                        key={acronym}
                        style={{
                          display:    'flex',
                          alignItems: 'center',
                          gap:        5,
                          paddingLeft: 16,
                          marginBottom: 2,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => handleToggleStructure(acronym, e.target.checked)}
                          style={{ cursor: 'pointer', accentColor: T.accent, margin: 0 }}
                        />
                        <span style={{
                          fontFamily: T.fontMono,
                          fontWeight: 500,
                          color:      s.color,
                          fontSize:   10,
                          minWidth:   40,
                        }}>
                          {acronym}
                        </span>
                        <span style={{
                          color:    T.textMuted,
                          fontSize: 10,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace:   'nowrap',
                          maxWidth:     90,
                        }} title={s.label}>
                          {s.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Axis Indicator — bottom-left of 3D canvas */}
          <canvas
            ref={axisCanvasRef}
            width={80}
            height={80}
            style={{
              position:     'absolute',
              bottom:       12,
              left:         12,
              pointerEvents:'none',
              zIndex:       10,
            }}
          />
        </div>

        {/* ================================================================
            RIGHT PANEL — Controls + Slice Output (40%)
        ================================================================ */}
        <div style={{
          flex:          '0 0 40%',
          display:       'flex',
          flexDirection: 'column',
          borderLeft:    `1px solid ${T.border}`,
          background:    T.panelBg,
          overflow:      'hidden',
        }}>

          {/* ---- Controls Panel (top half, scrollable) ---- */}
          <div style={{
            flex:       '1 1 0',
            overflowY:  'auto',
            padding:    20,
          }}>
            {/* Header */}
            <h1 style={{
              fontFamily:  T.fontSerif,
              fontSize:    18,
              fontWeight:  600,
              color:       T.text,
              margin:      '0 0 20px 0',
              lineHeight:  1.2,
            }}>
              Slice Planner
            </h1>

            {/* ---- Circuit Presets ---- */}
            <div style={{ marginBottom: 22 }}>
              <div style={{
                fontFamily:    T.fontMono,
                fontSize:      10,
                letterSpacing: '0.1em',
                color:         T.textMuted,
                marginBottom:  8,
                textTransform: 'uppercase',
              }}>
                Circuit Presets
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { id: 'tc',    label: 'Thalamocortical' },
                  { id: 'hippo', label: 'Hippocampal' },
                  { id: 'reset', label: 'Reset' },
                ].map(({ id, label }) => {
                  const isActive = id !== 'reset' && highlightState.preset === id;
                  return (
                    <button
                      key={id}
                      onClick={() => handlePreset(id)}
                      style={{
                        fontFamily:   T.fontMono,
                        fontSize:     11,
                        padding:      '6px 10px',
                        borderRadius: 4,
                        border:       `1px solid ${isActive ? T.gold : T.border}`,
                        background:   isActive ? '#FDF6E3' : T.bg,
                        color:        T.text,
                        cursor:       'pointer',
                        transition:   'border-color 0.15s, background 0.15s',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ---- Slice Orientation Sliders ---- */}
            <div style={{ marginBottom: 22 }}>
              <div style={{
                fontFamily:    T.fontMono,
                fontSize:      10,
                letterSpacing: '0.1em',
                color:         T.textMuted,
                marginBottom:  10,
                textTransform: 'uppercase',
              }}>
                Slice Orientation
              </div>
              {[
                { field: 'pitch',      label: 'Pitch',   min: -45,   max: 45,   step: 1,  unit: '°',  dec: 0 },
                { field: 'yaw',        label: 'Yaw',     min: -45,   max: 45,   step: 1,  unit: '°',  dec: 0 },
                { field: 'roll',       label: 'Roll',    min: -45,   max: 45,   step: 1,  unit: '°',  dec: 0 },
                { field: 'apPosition', label: 'A→P Pos', min: -3000, max: 3000, step: 50, unit: 'µm', dec: 0 },
              ].map(({ field, label, min, max, step, unit, dec }) => (
                <div key={field} style={{
                  display:       'flex',
                  alignItems:    'center',
                  gap:           10,
                  marginBottom:  10,
                }}>
                  {/* Label */}
                  <span style={{
                    fontFamily: T.fontMono,
                    fontSize:   11,
                    color:      T.text,
                    minWidth:   52,
                  }}>
                    {label}
                  </span>
                  {/* Slider */}
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={sliceState[field]}
                    onChange={e => handleSliderChange(field, e.target.value)}
                    style={{ flex: 1 }}
                  />
                  {/* Live value display */}
                  <span style={{
                    fontFamily: T.fontMono,
                    fontSize:   11,
                    color:      T.text,
                    minWidth:   52,
                    textAlign:  'right',
                  }}>
                    {Number(sliceState[field]).toFixed(dec)}{unit}
                  </span>
                </div>
              ))}
            </div>

            {/* ---- Slice Thickness ---- */}
            <div>
              <div style={{
                fontFamily:    T.fontMono,
                fontSize:      10,
                letterSpacing: '0.1em',
                color:         T.textMuted,
                marginBottom:  8,
                textTransform: 'uppercase',
              }}>
                Slice Thickness
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {THICKNESS_OPTIONS.map((val, i) => {
                  const active = activeThickness === val;
                  return (
                    <button
                      key={val}
                      onClick={() => handleThickness(val)}
                      style={{
                        fontFamily:   T.fontMono,
                        fontSize:     11,
                        padding:      '5px 10px',
                        borderRadius: 20, // pill shape
                        border:       `1px solid ${active ? 'transparent' : T.border}`,
                        background:   active ? T.accent : T.bg,
                        color:        active ? '#FFFFFF' : T.text,
                        cursor:       'pointer',
                        transition:   'background 0.15s, color 0.15s',
                      }}
                    >
                      {THICKNESS_LABELS[i]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ---- Divider ---- */}
          <div style={{
            height:          1,
            background:      T.border,
            flexShrink:      0,
          }} />

          {/* ---- Slice Output Panel (bottom half) — Stage 1 placeholder ---- */}
          <div style={{
            flex:           '0 0 auto',
            minHeight:      200,
            padding:        20,
            display:        'flex',
            flexDirection:  'column',
            justifyContent: 'center',
          }}>
            {/* Placeholder box */}
            <div style={{
              border:       `1px dashed ${T.border}`,
              borderRadius: 6,
              padding:      '24px 16px',
              textAlign:    'center',
              marginBottom: 16,
              background:   T.bg,
            }}>
              <p style={{
                fontFamily: T.fontMono,
                fontSize:   11,
                color:      T.textMuted,
                margin:     '0 0 4px 0',
                lineHeight: 1.5,
              }}>
                Configure slice orientation above,
              </p>
              <p style={{
                fontFamily: T.fontMono,
                fontSize:   11,
                color:      T.textMuted,
                margin:     0,
                lineHeight: 1.5,
              }}>
                then click Generate Slice
              </p>
            </div>

            {/* Generate Slice button — present and styled; onClick stub for Stage 2 */}
            <button
              onClick={() => {
                console.log('[Stage 1] Generate Slice clicked — sliceState:', sliceState);
              }}
              style={{
                width:        '100%',
                background:   T.accent,
                color:        '#FFFFFF',
                fontFamily:   T.fontSerif,
                fontSize:     15,
                fontWeight:   600,
                padding:      '12px 0',
                borderRadius: 6,
                border:       'none',
                cursor:       'pointer',
                letterSpacing:'0.01em',
              }}
            >
              Generate Slice
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
