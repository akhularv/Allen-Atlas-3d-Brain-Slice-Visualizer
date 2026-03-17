/**
 * Allen Atlas Oblique Slice Planner — Stage 5
 * Extends Stage 4 with:
 *   A. sliceState v2: lrPosition and dvPosition fields added (raw µm).
 *   B. buildSlicePlane v2: 3-axis center vector (lrMicrons, dvMicrons params).
 *   C. CSS grid restructure of left panel ("frame" / specimen stage layout).
 *   D. Frame sliders: L↔R (top), Yaw (bottom), Roll (left, vertical), D↔V (right, vertical).
 *   E. Pitch demoted to numeric input in right panel; old 4 sliders removed.
 *   F. viewLocked camera mode: lerp-to-position + orbit disable toggle.
 *   G. SavedSlices: save, recall, delete, thumbnail, export/import session JSON.
 *
 * Stage 5 preserves ALL Stage 4 logic exactly:
 *   - CCF_STRUCTURES registry (VPL id:718)
 *   - scene setup, lights, shell mesh, structure meshes (ellipsoids as fallback)
 *   - orbit controls, ghost plane stack, axis indicator, hover tooltip
 *   - buildSlicePlane / intersectMeshWithPlane / computeAllIntersections
 *   - sliceStateRef / visibilityRef / highlightRef sync pattern
 *   - 2D slice rendering: region fills, labels, scale bar, compass
 *   - Export PNG / Export Config buttons
 *   - Mesh loading useEffect (Stage 4 Change C/D/E)
 *
 * Carry-forward constraints (must not be broken):
 *   - apPosition: raw µm — do NOT divide by 1000 anywhere
 *   - lrPosition, dvPosition: also raw µm — same convention
 *   - 2D scale: auto-fit bbox — do NOT replace with hardcoded scale
 *   - edgeIntersect: >= 0 positive-side convention — unchanged
 *   - Three.js r128 is in use (not r165)
 *
 * SYSTEM_SPEC.md v3 §Stage 5 Addendum
 * INTERFACE_CONTRACTS.md v3 §Stage 5 Addendum
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

/* Frame slider track — used by the four frame sliders around the 3D canvas */
.frame-slider {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  outline: none;
  padding: 0;
  margin: 0;
}
.frame-slider::-webkit-slider-runnable-track {
  height: 2px;
  background: #DDD8CE;
  border-radius: 1px;
}
.frame-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: #4A6741;
  margin-top: -6px;
  cursor: pointer;
  transition: background 0.1s;
}
.frame-slider:active::-webkit-slider-thumb {
  background: #C4A35A;
}
/* Vertical slider wrapper */
.vslider-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 100%;
  overflow: hidden;
  position: relative;
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
// Stage 3 A1: hexToRgba — pure utility, outside component
// ---------------------------------------------------------------------------
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------------
// SliderPill helper component — small floating value badge on frame sliders
// Defined outside main component so it is never re-created on every render.
// ---------------------------------------------------------------------------
function SliderPill({ value, unit }) {
  const display = (value >= 0 ? '+' : '') + value + unit;
  return (
    <div style={{
      position: 'absolute', right: 0, top: -18,
      fontFamily: '"DM Mono", monospace', fontSize: 10,
      background: '#FAF8F5', border: '1px solid #DDD8CE',
      borderRadius: 10, padding: '1px 5px', color: '#5A5450',
      pointerEvents: 'none', whiteSpace: 'nowrap',
    }}>
      {display}
    </div>
  );
}

// ---------------------------------------------------------------------------
// renderMiniSlice — generate a thumbnail data URL for a saved slice entry.
// Uses a detached canvas (not in DOM). Called from confirmSaveSlice which
// runs in a click handler, so THREE is always available at call time.
//
// Args:
//   entry: object with { sliceResult } where sliceResult has intersections + plane
//   w: canvas width in px (default 60)
//   h: canvas height in px (default 45)
// Returns:
//   PNG data URL string, or null if THREE unavailable / no intersections
// ---------------------------------------------------------------------------
function renderMiniSlice(entry, w = 60, h = 45) {
  const THREE = window.THREE;
  if (!THREE || !entry.sliceResult || !entry.sliceResult.intersections || !entry.sliceResult.intersections.length) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#FAF8F5';
  ctx.fillRect(0, 0, w, h);

  const sr = entry.sliceResult;
  const normal = sr.plane.normal;
  // Choose up vector that is not parallel to normal
  const up = Math.abs(normal.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const uAxis = new THREE.Vector3().crossVectors(up, normal).normalize();
  const vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize();

  // Compute bbox for scale — same algorithm as renderSlice2D
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  sr.intersections.forEach(ix => {
    ix.segments.forEach(seg => {
      ['start', 'end'].forEach(k => {
        const u =  seg[k].dot(uAxis);
        const v = -seg[k].dot(vAxis);
        if (u < uMin) uMin = u; if (u > uMax) uMax = u;
        if (v < vMin) vMin = v; if (v > vMax) vMax = v;
      });
    });
  });

  const rangeU = uMax - uMin || 1;
  const rangeV = vMax - vMin || 1;
  // Auto-fit scale — same formula as full renderSlice2D (carry-forward constraint)
  const scale = Math.min((w * 0.85) / rangeU, (h * 0.85) / rangeV);
  const cx = w / 2 - ((uMin + uMax) / 2) * scale;
  const cy = h / 2 + ((vMin + vMax) / 2) * scale;

  sr.intersections.forEach(ix => {
    ctx.strokeStyle = ix.color;
    ctx.lineWidth = 1;
    ix.segments.forEach(seg => {
      ctx.beginPath();
      ctx.moveTo( seg.start.dot(uAxis) * scale + cx, -seg.start.dot(vAxis) * scale + cy);
      ctx.lineTo( seg.end.dot(uAxis)   * scale + cx, -seg.end.dot(vAxis)   * scale + cy);
      ctx.stroke();
    });
  });

  return canvas.toDataURL('image/png');
}

// ---------------------------------------------------------------------------
// CCF_STRUCTURES Registry
// INTERFACE_CONTRACTS.md §Module: CCF_STRUCTURES Registry
// Frozen at load time; no module may mutate this object.
//
// Stage 4 Change A+B: Added `id` field; VPL id corrected from 563 → 718.
// ---------------------------------------------------------------------------
const CCF_STRUCTURES_RAW = [
  // ---- THALAMUS -----------------------------------------------------------
  { id:733,  acronym:'VPM',     label:'Ventral posteromedial nucleus',
    color:'#FF6B6B', group:'thalamus',
    center_ccf:[5900,4300,4700], semi_axes:[380,320,290], euler_ccf:[0,0,0] },
  { id:718,  acronym:'VPL',     label:'Ventral posterolateral nucleus',
    // Stage 4: id corrected from 563 → 718.
    // 563 is the dorsal tegmental tract (DTT). 718 is the correct Allen CCF
    // ID for VPL, confirmed by /mesh/{id} PLY bounding box.
    // RESEARCH_BRIEF_STAGE4.md §1 and §3.
    color:'#FF8E53', group:'thalamus',
    center_ccf:[5950,4350,4200], semi_axes:[430,340,330], euler_ccf:[0,0,0] },
  { id:149,  acronym:'LP',      label:'Lateral posterior nucleus',
    color:'#FFA07A', group:'thalamus',
    center_ccf:[5400,3950,4500], semi_axes:[360,310,290], euler_ccf:[0,0,0] },
  { id:1020, acronym:'PO',      label:'Posterior complex',
    color:'#FFB347', group:'thalamus',
    center_ccf:[6100,4400,5000], semi_axes:[340,290,280], euler_ccf:[0,0,0] },
  { id:362,  acronym:'MD',      label:'Mediodorsal nucleus',
    color:'#FF69B4', group:'thalamus',
    center_ccf:[5500,3800,5500], semi_axes:[490,380,340], euler_ccf:[0,0,0] },
  { id:262,  acronym:'RT',      label:'Reticular nucleus',
    color:'#DA70D6', group:'thalamus',
    center_ccf:[5700,4100,4600], semi_axes:[580,190,490], euler_ccf:[0,0,0] },

  // ---- CORTEX -------------------------------------------------------------
  { id:329,  acronym:'SSp',     label:'Primary somatosensory area',
    color:'#2ECC71', group:'cortex',
    center_ccf:[4500,2800,4200], semi_axes:[680,480,580], euler_ccf:[0,0,0] },
  { id:981,  acronym:'SSp-bfd', label:'Barrel field',
    color:'#27AE60', group:'cortex',
    center_ccf:[4200,2900,4000], semi_axes:[390,380,340], euler_ccf:[0,0,0] },
  { id:985,  acronym:'MOp',     label:'Primary motor area',
    color:'#1ABC9C', group:'cortex',
    center_ccf:[3200,2500,4500], semi_axes:[780,480,680], euler_ccf:[0,0,0] },
  { id:1011, acronym:'VISp',    label:'Primary visual area',
    color:'#16A085', group:'cortex',
    center_ccf:[6500,3000,4300], semi_axes:[580,480,530], euler_ccf:[0,0,0] },
  { id:1002, acronym:'AUDp',    label:'Primary auditory area',
    color:'#48C9B0', group:'cortex',
    center_ccf:[5200,3200,3800], semi_axes:[530,430,460], euler_ccf:[0,0,0] },

  // ---- FIBER TRACTS -------------------------------------------------------
  { id:776,  acronym:'ic',      label:'Internal capsule',
    color:'#BDC3C7', group:'fiber',
    center_ccf:[5600,4000,4700], semi_axes:[780,190,240], euler_ccf:[0,0,0] },
  { id:1000, acronym:'cc',      label:'Corpus callosum',
    color:'#D5D8DC', group:'fiber',
    center_ccf:[4800,3000,5500], semi_axes:[1950,140,780], euler_ccf:[0,0,0] },
  { id:901,  acronym:'ec',      label:'External capsule',
    color:'#AAB7B8', group:'fiber',
    center_ccf:[5000,3400,4000], semi_axes:[900,150,200], euler_ccf:[0,0,0] },

  // ---- HIPPOCAMPUS --------------------------------------------------------
  { id:375,  acronym:'CA1',     label:"Ammon's horn CA1",
    color:'#8E44AD', group:'hippocampus',
    center_ccf:[5800,3500,4800], semi_axes:[680,240,390], euler_ccf:[0,0,0] },
  { id:463,  acronym:'CA3',     label:"Ammon's horn CA3",
    color:'#9B59B6', group:'hippocampus',
    center_ccf:[5500,3600,5200], semi_axes:[480,240,340], euler_ccf:[0,0,0] },
  { id:726,  acronym:'DG',      label:'Dentate gyrus',
    color:'#BB8FCE', group:'hippocampus',
    center_ccf:[5700,3700,5000], semi_axes:[580,290,390], euler_ccf:[0,0,0] },

  // ---- SUBCORTICAL --------------------------------------------------------
  { id:672,  acronym:'CP',      label:'Caudoputamen',
    color:'#F39C12', group:'subcortical',
    center_ccf:[4000,3600,4500], semi_axes:[880,680,780], euler_ccf:[0,0,0] },
  { id:381,  acronym:'SNr',     label:'Substantia nigra reticular',
    color:'#E67E22', group:'subcortical',
    center_ccf:[7200,4800,5300], semi_axes:[480,240,380], euler_ccf:[0,0,0] },
];

// Root mesh ID — brain shell; separate from the structure list
const ROOT_MESH_ID = 997;

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

const CCF_BY_ACRONYM = Object.freeze(
  Object.fromEntries(CCF_STRUCTURES.map(s => [s.acronym, s]))
);

const CCF_BY_GROUP = Object.freeze(
  CCF_STRUCTURES.reduce((acc, s) => {
    if (!acc[s.group]) acc[s.group] = [];
    acc[s.group].push(s.acronym);
    return acc;
  }, {})
);

const GROUP_COLORS = Object.freeze({
  thalamus:    '#FF6B6B',
  cortex:      '#2ECC71',
  fiber:       '#BDC3C7',
  hippocampus: '#8E44AD',
  subcortical: '#F39C12',
});

// ---------------------------------------------------------------------------
// Coordinate Utilities
// ---------------------------------------------------------------------------
function ccfToThree(ccfX, ccfY, ccfZ) {
  if (!isFinite(ccfX) || !isFinite(ccfY) || !isFinite(ccfZ)) {
    throw new Error(`ccfToThree: non-finite input (${ccfX}, ${ccfY}, ${ccfZ})`);
  }
  return {
    x:  ccfZ - 5700,
    y: -(ccfY - 4000),
    z: -(ccfX - 5700),
  };
}

function buildPlaneEuler(pitch, yaw, roll) {
  const DEG2RAD = Math.PI / 180;
  return { x: pitch * DEG2RAD, y: yaw * DEG2RAD, z: roll * DEG2RAD };
}

// ---------------------------------------------------------------------------
// buildSlicePlane v2 — Stage 5
// Now accepts lrMicrons and dvMicrons for full 3-axis translation.
// All three axes use raw µm (1 µm = 1 Three.js unit). No division by 1000.
//
// Args:
//   pitch:      rotation about X axis, degrees [-90, 90]
//   yaw:        rotation about Y axis, degrees [-90, 90]
//   roll:       rotation about Z axis, degrees [-90, 90]
//   apMicrons:  AP position in raw µm (Three.js Z = -apMicrons)
//   lrMicrons:  L↔R position in raw µm (Three.js X = lrMicrons)
//   dvMicrons:  D↔V position in raw µm (Three.js Y = -dvMicrons, flipped)
// Returns:
//   THREE.Plane with unit normal
// ---------------------------------------------------------------------------
function buildSlicePlane(pitch, yaw, roll, apMicrons, lrMicrons = 0, dvMicrons = 0) {
  const THREE = window.THREE;
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(pitch),
    THREE.MathUtils.degToRad(yaw),
    THREE.MathUtils.degToRad(roll),
    'XYZ'
  );
  const normal = new THREE.Vector3(0, 0, 1);
  const rotMat = new THREE.Matrix4().makeRotationFromEuler(euler);
  normal.applyMatrix4(rotMat).normalize();

  // Translation: all axes in raw µm (1 µm = 1 Three.js unit).
  // threeX = lrMicrons      (L→R; lateral = positive X)
  // threeY = -dvMicrons     (DV flipped: positive dvMicrons = ventral = negative Y)
  // threeZ = -apMicrons     (AP: anterior = positive apMicrons, which maps to negative Z)
  // Do NOT divide by 1000 — carry-forward constraint
  const center = new THREE.Vector3(
    lrMicrons,
    -dvMicrons,
    -apMicrons
  );
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center);
}

// ---------------------------------------------------------------------------
// intersectMeshWithPlane — carry-forward from Stage 2/3/4 (unchanged)
// edgeIntersect: >= 0 positive-side convention (DEBUG_REPORT_2 M-01 fix)
// ---------------------------------------------------------------------------
function intersectMeshWithPlane(mesh, plane) {
  const THREE = window.THREE;
  const geo      = mesh.geometry;
  const posAttr  = geo.attributes.position;
  const index    = geo.index;
  const segments = [];

  const vertexCount = index ? index.count : posAttr.count;
  const triCount    = Math.floor(vertexCount / 3);

  function edgeIntersect(v1, v2, d1, d2, pts) {
    if (d1 === 0 && d2 === 0) return;
    // >= 0 positive-side convention — carry-forward from Stage 2 (DEBUG_REPORT_2 M-01)
    const s1 = d1 >= 0 ? 1 : -1;
    const s2 = d2 >= 0 ? 1 : -1;
    if (s1 === s2) return;
    const t = d1 / (d1 - d2);
    pts.push(new THREE.Vector3().lerpVectors(v1, v2, t));
  }

  for (let i = 0; i < triCount; i++) {
    const ia = index ? index.getX(i * 3)     : i * 3;
    const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2;

    const vA = new THREE.Vector3()
      .fromBufferAttribute(posAttr, ia)
      .applyMatrix4(mesh.matrixWorld);
    const vB = new THREE.Vector3()
      .fromBufferAttribute(posAttr, ib)
      .applyMatrix4(mesh.matrixWorld);
    const vC = new THREE.Vector3()
      .fromBufferAttribute(posAttr, ic)
      .applyMatrix4(mesh.matrixWorld);

    const dA = plane.distanceToPoint(vA);
    const dB = plane.distanceToPoint(vB);
    const dC = plane.distanceToPoint(vC);

    const pts = [];
    edgeIntersect(vA, vB, dA, dB, pts);
    edgeIntersect(vB, vC, dB, dC, pts);
    edgeIntersect(vC, vA, dC, dA, pts);

    if (pts.length === 2) {
      segments.push({ start: pts[0], end: pts[1] });
    }
  }

  return segments;
}

// Canonical group ordering for structure list
const GROUP_SORT_ORDER = ['thalamus', 'cortex', 'fiber', 'hippocampus', 'subcortical'];

function computeAllIntersections(meshes, plane) {
  const THREE = window.THREE;
  const results = [];

  meshes.forEach(mesh => {
    if (!mesh.visible) return;
    if (!mesh.userData || !mesh.userData.acronym) return;

    const segments = intersectMeshWithPlane(mesh, plane);
    if (segments.length === 0) return;

    const centroid = new THREE.Vector3();
    segments.forEach(seg => {
      centroid.x += (seg.start.x + seg.end.x) / 2;
      centroid.y += (seg.start.y + seg.end.y) / 2;
      centroid.z += (seg.start.z + seg.end.z) / 2;
    });
    centroid.divideScalar(segments.length);

    results.push({
      acronym:  mesh.userData.acronym,
      name:     mesh.userData.label  || mesh.userData.acronym,
      color:    mesh.userData.color  || '#888888',
      group:    mesh.userData.group  || 'subcortical',
      segments,
      centroid,
    });
  });

  results.sort((a, b) => {
    const ai = GROUP_SORT_ORDER.indexOf(a.group);
    const bi = GROUP_SORT_ORDER.indexOf(b.group);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return results;
}

function generateSlicePlanes(basePitch, baseYaw, baseRoll, baseApPosition, thicknessMicrons, count) {
  const planes = [];
  const halfCount = Math.floor(count / 2);
  for (let i = 0; i < count; i++) {
    const offsetIndex = i - halfCount;
    planes.push({
      pitch: basePitch, yaw: baseYaw, roll: baseRoll,
      apPosition: baseApPosition + offsetIndex * thicknessMicrons,
    });
  }
  return planes;
}

// ---------------------------------------------------------------------------
// Preset Engine
// ---------------------------------------------------------------------------
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

function applyPreset(presetName, currentThickness, setSliceState, setHighlightState) {
  if (!Object.prototype.hasOwnProperty.call(PRESETS, presetName)) {
    throw new Error(`applyPreset: unrecognized presetName "${presetName}"`);
  }
  const p = PRESETS[presetName];
  setSliceState(prev => ({
    ...prev,
    pitch:      p.pitch,
    yaw:        p.yaw,
    roll:       p.roll,
    apPosition: p.apPosition,
  }));
  setHighlightState({ preset: presetName, highlighted: p.highlighted });
}

function toggleGroup(groupName, visible, meshMapRef, setVisibility) {
  if (!Object.prototype.hasOwnProperty.call(CCF_BY_GROUP, groupName)) {
    throw new Error(`toggleGroup: unrecognized groupName "${groupName}"`);
  }
  const members = CCF_BY_GROUP[groupName];
  members.forEach(acronym => {
    const mesh = meshMapRef.current[acronym];
    if (!mesh) { console.warn(`toggleGroup: acronym "${acronym}" not found in mesh map`); return; }
    mesh.visible = visible;
  });
  setVisibility(prev => {
    const next = { ...prev };
    members.forEach(a => { next[a] = visible; });
    return next;
  });
}

function makeInitialVisibility() {
  return Object.fromEntries(CCF_STRUCTURES.map(s => [s.acronym, true]));
}

function makeInitialGroupVisibility() {
  return Object.fromEntries(Object.keys(CCF_BY_GROUP).map(g => [g, true]));
}

// ---------------------------------------------------------------------------
// Thickness stack constants
// ---------------------------------------------------------------------------
const THICKNESS_STACK_COUNT = Object.freeze({
  '350µm': 1, '400µm': 1, '1mm': 3, '2mm': 5, '4mm': 8, '6mm': 12,
});

const THICKNESS_TO_MICRONS = Object.freeze({
  '350µm': 350, '400µm': 400, '1mm': 1000, '2mm': 2000, '4mm': 4000, '6mm': 6000,
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function AllenAtlasSlicePlanner() {
  const React = window.React;
  const { useState, useEffect, useRef, useCallback } = React;

  // ---- Shared state -------------------------------------------------------
  // sliceState v2 — Stage 5: lrPosition and dvPosition added (both raw µm)
  const [sliceState, setSliceState] = useState({
    pitch:      0,
    yaw:        0,
    roll:       0,
    apPosition: 0,      // raw µm offset along AP axis
    lrPosition: 0,      // raw µm offset along L↔R axis (Stage 5)
    dvPosition: 0,      // raw µm offset along D↔V axis (Stage 5)
    thickness:  400,    // µm; default 400 µm per brief
  });

  const [highlightState, setHighlightState] = useState({
    preset:      null,
    highlighted: [],
  });

  const [visibilityState, setVisibilityState] = useState(makeInitialVisibility);
  const [groupVisibility,  setGroupVisibility]  = useState(makeInitialGroupVisibility);

  const [cameraState, setCameraState] = useState({
    theta:  Math.PI / 6,
    phi:    Math.PI / 3,
    radius: 800,
  });

  const [selectedThickness, setSelectedThickness] = useState('400µm');
  const [panelExpanded,  setPanelExpanded]  = useState(true);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [sliceResult, setSliceResult] = useState(null);
  const [tooltip, setTooltip] = useState(null);

  // Stage 4: scene readiness and mesh load state
  const [sceneReady,     setSceneReady]     = useState(false);
  const [meshLoadState,  setMeshLoadState]  = useState({ total: 0, loaded: 0, failed: 0 });

  // Stage 5 — viewLocked camera state
  const [viewLocked, setViewLocked] = useState(false);

  // Stage 5 — SavedSlices state (all at top level — no hooks in nested functions)
  const [savedSlices,          setSavedSlices]          = useState([]);
  const [saveNameInput,        setSaveNameInput]        = useState('');
  const [showSaveInput,        setShowSaveInput]        = useState(false);
  const [importMsg,            setImportMsg]            = useState('');
  const [savedSlicesPanelOpen, setSavedSlicesPanelOpen] = useState(true);

  // ---- Refs ---------------------------------------------------------------
  const mountRef           = useRef(null);  // Three.js canvas mount (canvas grid cell)
  const axisCanvasRef      = useRef(null);
  const sliceCanvasRef     = useRef(null);
  const meshMapRef         = useRef({});
  const shellRef           = useRef(null);
  const planeRef           = useRef(null);
  const planeEdgesRef      = useRef(null);
  const rendererRef        = useRef(null);
  const sceneRef           = useRef(null);
  const cameraRef          = useRef(null);
  const frameRef           = useRef(null);
  const structureMeshesRef = useRef([]);
  const slicePlaneGroupRef = useRef([]);
  const labelOverlayRef    = useRef(null);
  const meshLoadStateRef   = useRef({ total: 0, loaded: 0, failed: 0 });
  const rightPanelRef      = useRef(null);  // scrollable right panel div
  const importFileRef      = useRef(null);  // hidden file input for session import

  // Stage 5 — frame slider refs (for ResizeObserver width sync)
  const rollSliderRef = useRef(null);
  const dvSliderRef   = useRef(null);

  // Stage 5 — viewLocked refs (read in animation loop — no re-render on change)
  const viewLockedRef    = useRef(false);
  const lerpTargetPos    = useRef(null);   // initialized inside scene useEffect after THREE available
  const isLerping        = useRef(false);

  // Orbit state — kept in ref to avoid re-render on every pointer move
  const orbitRef = useRef({
    isPointerDown: false,
    lastX: 0, lastY: 0,
    theta:  Math.PI / 6,
    phi:    Math.PI / 3,
    radius: 800,
    targetX: 0, targetY: 0, targetZ: 0,
    spherical: { phi: Math.PI / 3, theta: Math.PI / 6 },
  });

  // Slice state ref — read by animation loop without triggering re-renders
  const sliceStateRef = useRef(sliceState);
  useEffect(() => { sliceStateRef.current = sliceState; }, [sliceState]);

  const visibilityRef = useRef(visibilityState);
  useEffect(() => { visibilityRef.current = visibilityState; }, [visibilityState]);

  const highlightRef = useRef(highlightState);
  useEffect(() => { highlightRef.current = highlightState; }, [highlightState]);

  const lastRaycastTime = useRef(0);

  // ---- Three.js scene init ------------------------------------------------
  useEffect(() => {
    const THREE = window.THREE;
    if (!THREE) {
      console.error('Three.js not found on window.THREE — ensure CDN script is loaded');
      return;
    }

    // Stage 5: initialize lerpTargetPos here where THREE is available
    lerpTargetPos.current = new THREE.Vector3(300, -150, 500);

    const mount = mountRef.current;
    const w = mount.clientWidth;
    const h = mount.clientHeight;

    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    renderer.sortObjects = true;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // --- Scene ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#FAF8F5');
    sceneRef.current = scene;

    // --- Camera ---
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 10000);
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
      color: new THREE.Color('#BBBBBB'), opacity: 0.06,
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.renderOrder = 0;
    scene.add(shell);
    shellRef.current = shell;

    // --- Structure meshes (renderOrder 1 default) ---
    structureMeshesRef.current = [];
    const meshMap = {};
    CCF_STRUCTURES.forEach(s => {
      const [rx, ry, rz] = s.semi_axes;
      const geo = new THREE.SphereGeometry(1, 32, 24);
      geo.applyMatrix4(new THREE.Matrix4().makeScale(rx, ry, rz));
      const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(s.color), opacity: 0.70,
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const pos  = ccfToThree(...s.center_ccf);
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.renderOrder = 1;
      mesh.userData = { acronym: s.acronym, label: s.label, color: s.color, group: s.group };
      scene.add(mesh);
      meshMap[s.acronym] = mesh;
      structureMeshesRef.current.push(mesh);
    });
    meshMapRef.current = meshMap;

    // --- Slice plane widget (renderOrder 3) ---
    const planeGeo = new THREE.PlaneGeometry(900, 700);
    const planeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#4A90D9'), opacity: 0.22,
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    const planeMesh = new THREE.Mesh(planeGeo, planeMat);
    planeMesh.renderOrder = 3;
    scene.add(planeMesh);
    planeRef.current = planeMesh;

    // --- EdgesGeometry border lines ---
    const edgesGeo  = new THREE.EdgesGeometry(new THREE.PlaneGeometry(900, 700));
    const edgesMat  = new THREE.LineBasicMaterial({ color: '#4A90D9', linewidth: 1 });
    const planeEdges = new THREE.LineSegments(edgesGeo, edgesMat);
    planeEdges.renderOrder = 3;
    scene.add(planeEdges);
    planeEdgesRef.current = planeEdges;

    // --- Animation loop ---
    function animate() {
      frameRef.current = requestAnimationFrame(animate);

      const vis   = visibilityRef.current;
      const hi    = highlightRef.current;
      const hiSet = new Set(hi.highlighted);

      Object.entries(meshMap).forEach(([acronym, mesh]) => {
        mesh.visible = vis[acronym] !== false;
        if (!mesh.visible) return;
        if (hiSet.has(acronym)) {
          mesh.renderOrder = 2;
          mesh.material.opacity = 0.92;
          mesh.material.emissive = new THREE.Color(mesh.userData.color).multiplyScalar(0.25);
        } else if (hi.preset !== null) {
          mesh.renderOrder = 1;
          mesh.material.opacity = 0.12;
          mesh.material.emissive = new THREE.Color(0x000000);
        } else {
          mesh.renderOrder = 1;
          mesh.material.opacity = 0.70;
          mesh.material.emissive = new THREE.Color(0x000000);
        }
      });

      // Update slice plane widget position — Stage 5: all three translation axes
      const ss = sliceStateRef.current;
      if (planeRef.current) {
        planeRef.current.rotation.set(
          THREE.MathUtils.degToRad(ss.pitch),
          THREE.MathUtils.degToRad(ss.yaw),
          THREE.MathUtils.degToRad(ss.roll)
        );
        // Stage 5: include lrPosition (X) and dvPosition (Y, flipped)
        // apPosition maps to -Z (Stage 1 convention, raw µm, no division)
        planeRef.current.position.set(
          ss.lrPosition,
          -ss.dvPosition,
          -ss.apPosition
        );
      }

      if (planeEdgesRef.current) {
        planeEdgesRef.current.rotation.set(
          THREE.MathUtils.degToRad(ss.pitch),
          THREE.MathUtils.degToRad(ss.yaw),
          THREE.MathUtils.degToRad(ss.roll)
        );
        planeEdgesRef.current.position.set(
          ss.lrPosition,
          -ss.dvPosition,
          -ss.apPosition
        );
      }

      updateCamera();

      // Stage 5: lerp camera to locked position when viewLocked is active
      if (isLerping.current && cameraRef.current && lerpTargetPos.current) {
        const cam = cameraRef.current;
        cam.position.lerp(lerpTargetPos.current, 0.08);
        cam.lookAt(0, 0, 0);
        if (cam.position.distanceTo(lerpTargetPos.current) < 2) {
          cam.position.copy(lerpTargetPos.current);
          cam.lookAt(0, 0, 0);
          isLerping.current = false;
        }
      }

      renderer.render(scene, camera);

      // 3D overlay labels for highlighted structures
      const overlayCanvas = labelOverlayRef.current;
      if (overlayCanvas && highlightRef.current.highlighted.length > 0) {
        const ow = overlayCanvas.offsetWidth;
        const oh = overlayCanvas.offsetHeight;
        if (overlayCanvas.width !== ow || overlayCanvas.height !== oh) {
          overlayCanvas.width  = ow;
          overlayCanvas.height = oh;
        }
        const octx = overlayCanvas.getContext('2d');
        octx.clearRect(0, 0, ow, oh);

        highlightRef.current.highlighted.forEach(acronym => {
          const mesh = meshMap[acronym];
          if (!mesh || !mesh.visible) return;
          const vec = mesh.position.clone().project(camera);
          const sx  = ( vec.x + 1) / 2 * ow;
          const sy  = (-vec.y + 1) / 2 * oh;
          const color = mesh.userData.color;
          octx.beginPath();
          octx.arc(sx, sy, 3, 0, Math.PI * 2);
          octx.fillStyle = color;
          octx.fill();
          const lx = sx + 15;
          const ly = sy - 10;
          octx.font = 'bold 11px "DM Mono", monospace';
          const m = octx.measureText(acronym);
          octx.fillStyle = 'rgba(250,248,245,0.90)';
          octx.beginPath();
          if (octx.roundRect) {
            octx.roundRect(lx - 2, ly - 11, m.width + 4, 14, 3);
          } else {
            octx.rect(lx - 2, ly - 11, m.width + 4, 14);
          }
          octx.fill();
          octx.strokeStyle = color;
          octx.lineWidth   = 0.8;
          octx.globalAlpha = 0.6;
          octx.beginPath();
          octx.moveTo(sx, sy);
          octx.lineTo(lx, ly);
          octx.stroke();
          octx.globalAlpha = 1.0;
          octx.fillStyle = color;
          octx.fillText(acronym, lx, ly);
        });
      } else if (overlayCanvas) {
        overlayCanvas.getContext('2d').clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }

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

    // --- Manual orbit controls ---
    function updateCamera() {
      // Stage 5: skip orbit update when viewLocked — camera is driven by lerp
      if (viewLockedRef.current && !isLerping.current) return;
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
      setCameraState({ theta: o.theta, phi: o.phi, radius: o.radius });
    }

    function onPointerDown(e) {
      // Stage 5: block orbit interaction when view is locked
      if (viewLockedRef.current) return;
      const o = orbitRef.current;
      o.isPointerDown = true;
      o.lastX = e.clientX;
      o.lastY = e.clientY;
      mount.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
      // Stage 5: block orbit interaction when view is locked
      if (viewLockedRef.current) return;
      const o = orbitRef.current;
      if (!o.isPointerDown) return;
      const dx = e.clientX - o.lastX;
      const dy = e.clientY - o.lastY;
      o.lastX = e.clientX;
      o.lastY = e.clientY;
      if (e.shiftKey) {
        const PAN_SPEED = 0.8;
        const sinTheta = Math.sin(o.theta);
        const cosTheta = Math.cos(o.theta);
        o.targetX -= dx * cosTheta * PAN_SPEED;
        o.targetZ += dx * sinTheta * PAN_SPEED;
        o.targetY += dy * PAN_SPEED;
      } else {
        const ORBIT_SPEED = 0.005;
        o.theta -= dx * ORBIT_SPEED;
        o.phi   -= dy * ORBIT_SPEED;
        o.phi = Math.max(0.05, Math.min(Math.PI - 0.05, o.phi));
      }
      updateCamera();
    }

    function onPointerUp(e) {
      orbitRef.current.isPointerDown = false;
      mount.releasePointerCapture(e.pointerId);
    }

    function onWheel(e) {
      // Stage 5: block zoom when view is locked
      if (viewLockedRef.current) return;
      e.preventDefault();
      orbitRef.current.radius *= (1 + e.deltaY * 0.001);
      orbitRef.current.radius = Math.max(80, Math.min(2000, orbitRef.current.radius));
      updateCamera();
    }

    mount.addEventListener('pointerdown',   onPointerDown);
    mount.addEventListener('pointermove',   onPointerMove);
    mount.addEventListener('pointerup',     onPointerUp);
    mount.addEventListener('pointercancel', onPointerUp);
    mount.addEventListener('wheel', onWheel, { passive: false });

    setSceneReady(true);

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
  // ResizeObserver — syncs vertical slider width to canvas cell height
  // Stage 5: roll and DV sliders are rotated 90deg; their track width must
  // equal the grid cell height for full-height coverage.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const cell = mountRef.current;
    if (!cell) return;
    const ro = new ResizeObserver(entries => {
      const h = entries[0].contentRect.height;
      if (rollSliderRef.current) rollSliderRef.current.style.width = h + 'px';
      if (dvSliderRef.current)   dvSliderRef.current.style.width   = h + 'px';
    });
    ro.observe(cell);
    return () => ro.disconnect();
  }, []);

  // ---------------------------------------------------------------------------
  // Ghost plane stack — rebuild whenever sliceState or selectedThickness changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const THREE = window.THREE;
    if (!THREE || !sceneRef.current) return;
    const scene = sceneRef.current;

    slicePlaneGroupRef.current.forEach(ghost => {
      ghost.geometry.dispose();
      ghost.material.dispose();
      scene.remove(ghost);
    });
    slicePlaneGroupRef.current = [];

    const count = THICKNESS_STACK_COUNT[selectedThickness] || 1;
    if (count <= 1) return;

    const stepMicrons = THICKNESS_TO_MICRONS[selectedThickness] || 400;
    const halfCount   = Math.floor(count / 2);

    for (let i = -halfCount; i <= halfCount; i++) {
      if (i === 0) continue;
      const ghostGeo = new THREE.PlaneGeometry(900, 700);
      const ghostMat = new THREE.MeshBasicMaterial({
        color: '#4A90D9', opacity: 0.06,
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
      });
      const ghost = new THREE.Mesh(ghostGeo, ghostMat);
      ghost.renderOrder = 3;
      ghost.rotation.set(
        THREE.MathUtils.degToRad(sliceState.pitch),
        THREE.MathUtils.degToRad(sliceState.yaw),
        THREE.MathUtils.degToRad(sliceState.roll)
      );
      // Stage 5: ghost planes share lrPosition/dvPosition offset; step only on AP axis
      // Do NOT divide by 1000 — carry-forward constraint
      ghost.position.set(
        sliceState.lrPosition,
        -sliceState.dvPosition,
        -sliceState.apPosition + i * stepMicrons
      );
      scene.add(ghost);
      slicePlaneGroupRef.current.push(ghost);
    }
  }, [sliceState, selectedThickness]);

  // ---------------------------------------------------------------------------
  // Stage 4 Change C+D+E: Mesh loading useEffect
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!sceneReady) return;

    const BACKEND = 'http://localhost:8000';
    const structures = CCF_STRUCTURES;
    const totalCount = structures.length + 1;
    meshLoadStateRef.current = { total: totalCount, loaded: 0, failed: 0 };
    setMeshLoadState({ total: totalCount, loaded: 0, failed: 0 });

    function applyCcfToThree(verts) {
      for (let i = 0; i < verts.length; i += 3) {
        const cx = verts[i];
        const cy = verts[i + 1];
        const cz = verts[i + 2];
        verts[i]     =  cz - 5700;
        verts[i + 1] = -(cy - 4000);
        verts[i + 2] = -(cx - 5700);
      }
    }

    function onLoaded() {
      meshLoadStateRef.current.loaded++;
      setMeshLoadState({ ...meshLoadStateRef.current });
    }

    function onFailed() {
      meshLoadStateRef.current.failed++;
      setMeshLoadState({ ...meshLoadStateRef.current });
    }

    function fetchAndApplyMesh(structureId, acronym, targetMesh) {
      const THREE = window.THREE;
      if (!THREE) return;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      fetch(`${BACKEND}/mesh/${structureId}`, { signal: controller.signal })
        .then(r => {
          clearTimeout(timeoutId);
          if (!r.ok) throw new Error(`HTTP ${r.status} for ${acronym} (id=${structureId})`);
          return r.json();
        })
        .then(data => {
          if (!targetMesh) throw new Error(`Target mesh for ${acronym} no longer exists`);
          if (!Array.isArray(data.vertices) || data.vertices.length === 0)
            throw new Error(`Empty vertices array for ${acronym}`);
          if (!Array.isArray(data.faces) || data.faces.length === 0)
            throw new Error(`Empty faces array for ${acronym}`);
          if (data.vertices.length % 3 !== 0)
            throw new Error(`Malformed vertices for ${acronym}`);
          if (data.faces.length % 3 !== 0)
            throw new Error(`Malformed faces for ${acronym}`);
          const verts = new Float32Array(data.vertices);
          applyCcfToThree(verts);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
          geo.setIndex(new THREE.BufferAttribute(new Int32Array(data.faces), 1));
          geo.computeVertexNormals();
          targetMesh.geometry.dispose();
          targetMesh.geometry = geo;
          onLoaded();
        })
        .catch(err => {
          clearTimeout(timeoutId);
          console.warn(`Allen mesh unavailable for ${acronym} (id=${structureId}): ${err.message}. Using ellipsoid fallback.`);
          onFailed();
        });
    }

    structures.forEach(s => {
      const targetMesh = meshMapRef.current[s.acronym];
      if (!targetMesh) { console.warn(`Mesh loading: "${s.acronym}" not in meshMapRef. Skipping.`); onFailed(); return; }
      fetchAndApplyMesh(s.id, s.acronym, targetMesh);
    });
    fetchAndApplyMesh(ROOT_MESH_ID, 'root', shellRef.current);

  }, [sceneReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Axis indicator — drawn on 2D canvas overlay
  // ---------------------------------------------------------------------------
  function drawAxisIndicator() {
    const canvas = axisCanvasRef.current;
    if (!canvas) return;
    const ctx    = canvas.getContext('2d');
    const SIZE   = 80;
    const CENTER = 40;
    const LENGTH = 28;

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, 36, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(245, 242, 236, 0.85)';
    ctx.fill();
    ctx.strokeStyle = '#DDD8CE';
    ctx.lineWidth = 1;
    ctx.stroke();

    const { theta, phi } = orbitRef.current;
    const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
    const sinTheta = Math.sin(theta), cosTheta = Math.cos(theta);

    const rightX =  sinPhi * cosTheta, rightY = 0, rightZ = -sinPhi * sinTheta;
    const rightLen = Math.sqrt(rightX*rightX + rightY*rightY + rightZ*rightZ) || 1;
    const upX = -(cosPhi * sinTheta), upY = sinPhi, upZ = -(cosPhi * cosTheta);
    const upLen = Math.sqrt(upX*upX + upY*upY + upZ*upZ) || 1;

    function projectAxis(ax, ay, az) {
      return {
        sx: (ax * rightX + ay * rightY + az * rightZ) / rightLen,
        sy: -((ax * upX + ay * upY + az * upZ) / upLen),
      };
    }

    const axes = [
      { vec: [1,0,0], color: '#E74C3C', label: 'R' },
      { vec: [0,1,0], color: '#2ECC71', label: 'D' },
      { vec: [0,0,1], color: '#3498DB', label: 'A' },
    ];

    const projected = axes.map(a => {
      const { sx, sy } = projectAxis(...a.vec);
      const viewX = sinPhi * sinTheta, viewY = cosPhi, viewZ = sinPhi * cosTheta;
      const depth = a.vec[0]*viewX + a.vec[1]*viewY + a.vec[2]*viewZ;
      return { ...a, sx, sy, depth };
    });
    projected.sort((a, b) => a.depth - b.depth);

    projected.forEach(({ sx, sy, color, label }) => {
      const ex = CENTER + sx * LENGTH;
      const ey = CENTER + sy * LENGTH;
      ctx.beginPath(); ctx.moveTo(CENTER, CENTER); ctx.lineTo(ex, ey);
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
      const angle = Math.atan2(sy, sx);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - 6*Math.cos(angle-0.4), ey - 6*Math.sin(angle-0.4));
      ctx.lineTo(ex - 6*Math.cos(angle+0.4), ey - 6*Math.sin(angle+0.4));
      ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      ctx.font = 'bold 9px "DM Mono", monospace';
      ctx.fillStyle = color;
      ctx.fillText(label, ex + 5*Math.cos(angle), ey + 5*Math.sin(angle) + 4);
    });
  }

  useEffect(() => {
    drawAxisIndicator();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState]);

  // ---------------------------------------------------------------------------
  // Stage 5 — handleToggleLock: toggle viewLocked mode
  // ---------------------------------------------------------------------------
  const handleToggleLock = useCallback(() => {
    const next = !viewLockedRef.current;
    viewLockedRef.current = next;
    setViewLocked(next);
    if (next) {
      // Start lerp to the locked camera position
      isLerping.current = true;
    } else {
      // Exit lock: stop lerp and recalculate spherical orbit from current camera position
      isLerping.current = false;
      if (cameraRef.current) {
        const pos = cameraRef.current.position;
        const r = pos.length();
        orbitRef.current.radius = r;
        orbitRef.current.phi    = Math.acos(pos.y / r);
        orbitRef.current.theta  = Math.atan2(pos.x, pos.z);
      }
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Slider change handler (kept for compatibility; frame sliders use setSliceState directly)
  // ---------------------------------------------------------------------------
  const handleSliderChange = useCallback((field, rawValue) => {
    const RANGES = {
      pitch: [-45, 45], yaw: [-45, 45], roll: [-45, 45],
      apPosition: [-3000, 3000], lrPosition: [-3000, 3000], dvPosition: [-2000, 2000],
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
  const THICKNESS_OPTIONS = [350, 400, 1000, 2000, 4000, 6000];
  const THICKNESS_LABELS  = ['350µm','400µm','1mm','2mm','4mm','6mm'];

  const handleThickness = useCallback((val, label) => {
    setSelectedThickness(label);
    setSliceState(prev => ({ ...prev, thickness: val }));
  }, []);

  // ---------------------------------------------------------------------------
  // applyPresetHighlight — extracted from inline preset button logic
  // Stage 5: needed by handleRecallSlice for restoring saved slice presets
  // ---------------------------------------------------------------------------
  const applyPresetHighlight = useCallback((presetName) => {
    if (!presetName || !PRESETS[presetName]) {
      setHighlightState({ preset: null, highlighted: [] });
      return;
    }
    const p = PRESETS[presetName];
    setHighlightState({ preset: presetName, highlighted: p.highlighted });
  }, []);

  // ---------------------------------------------------------------------------
  // Preset button handlers
  // ---------------------------------------------------------------------------
  const handlePreset = useCallback((name) => {
    if (name === 'reset') {
      setSliceState(prev => ({ ...prev, pitch: 0, yaw: 0, roll: 0, apPosition: 0, lrPosition: 0, dvPosition: 0 }));
      setHighlightState({ preset: null, highlighted: [] });
      return;
    }
    applyPreset(name, sliceState.thickness, setSliceState, setHighlightState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliceState.thickness]);

  // ---------------------------------------------------------------------------
  // Region toggle handlers
  // ---------------------------------------------------------------------------
  const handleToggleStructure = useCallback((acronym, checked) => {
    if (!CCF_BY_ACRONYM[acronym]) { console.warn(`RegionTogglePanel: unknown acronym "${acronym}"`); return; }
    const mesh = meshMapRef.current[acronym];
    if (mesh) mesh.visible = checked;
    setVisibilityState(prev => ({ ...prev, [acronym]: checked }));
  }, []);

  const handleToggleGroup = useCallback((groupName, checked) => {
    toggleGroup(groupName, checked, meshMapRef, setVisibilityState);
    setGroupVisibility(prev => ({ ...prev, [groupName]: checked }));
  }, []);

  const toggleGroupExpand = useCallback((groupName) => {
    setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));
  }, []);

  function isGroupChecked(groupName) {
    return (CCF_BY_GROUP[groupName] || []).every(a => visibilityState[a] !== false);
  }

  // ---------------------------------------------------------------------------
  // Generate Slice handler — Stage 5: passes lrPosition and dvPosition
  // ---------------------------------------------------------------------------
  const handleGenerateSlice = useCallback(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    sceneRef.current.updateMatrixWorld(true);

    const plane = buildSlicePlane(
      sliceState.pitch,
      sliceState.yaw,
      sliceState.roll,
      sliceState.apPosition,
      sliceState.lrPosition,
      sliceState.dvPosition
    );

    const intersections = computeAllIntersections(structureMeshesRef.current, plane);

    setSliceResult({
      plane,
      intersections,
      thickness:  selectedThickness,
      pitch:      sliceState.pitch,
      yaw:        sliceState.yaw,
      roll:       sliceState.roll,
      apPosition: sliceState.apPosition,
      lrPosition: sliceState.lrPosition,
      dvPosition: sliceState.dvPosition,
    });
  }, [sliceState, selectedThickness]);

  // ---------------------------------------------------------------------------
  // Export handlers — Stage 4 (unchanged)
  // ---------------------------------------------------------------------------
  const handleExportPNG = useCallback(() => {
    if (!sliceCanvasRef.current) return;
    const url = sliceCanvasRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    const r = sliceResult;
    a.download = `slice_pitch${r.pitch}_yaw${r.yaw}_roll${r.roll}_${r.thickness.replace(/\s/g,'')}.png`;
    a.href = url; a.click(); URL.revokeObjectURL(url);
  }, [sliceResult]);

  const handleExportConfig = useCallback(() => {
    if (!sliceResult) return;
    const thicknessMap = {
      '350µm':350, '400µm':400, '1mm':1000, '2mm':2000, '4mm':4000, '6mm':6000,
    };
    const config = {
      tool: 'Allen Atlas Oblique Slice Planner',
      version: '2.0',
      mesh_source: 'Allen CCF v3 PLY (localhost:8000) with ellipsoid fallback',
      ccf_version: 'v3',
      slice_config: {
        pitch_deg:      sliceResult.pitch,
        yaw_deg:        sliceResult.yaw,
        roll_deg:       sliceResult.roll,
        ap_position_um: sliceResult.apPosition,
        lr_position_um: sliceResult.lrPosition ?? 0,
        dv_position_um: sliceResult.dvPosition ?? 0,
        thickness_um:   thicknessMap[sliceResult.thickness] ?? 400,
      },
      active_preset: highlightState.preset === 'tc'    ? 'thalamocortical'
                   : highlightState.preset === 'hippo' ? 'hippocampal'
                   : null,
      intersected_structures: sliceResult.intersections.map(ix => ({
        acronym: ix.acronym, name: ix.name, group: ix.group,
      })),
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.download = `slice_config_${Date.now()}.json`;
    a.href = url; a.click(); URL.revokeObjectURL(url);
  }, [sliceResult, sliceState, highlightState]);

  // ---------------------------------------------------------------------------
  // Hover tooltip
  // ---------------------------------------------------------------------------
  const handleMouseMove = useCallback((e) => {
    if (orbitRef.current?.isPointerDown) { setTooltip(null); return; }
    const now = Date.now();
    if (now - lastRaycastTime.current < 50) return;
    lastRaycastTime.current = now;
    const THREE = window.THREE;
    if (!THREE || !rendererRef.current || !cameraRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ( (e.clientX - rect.left)  / rect.width  ) * 2 - 1;
    const y = -((e.clientY - rect.top)   / rect.height ) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), cameraRef.current);
    const hits = raycaster.intersectObjects(structureMeshesRef.current);
    if (hits.length > 0) {
      const ud = hits[0].object.userData;
      setTooltip({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 20, name: ud.name, group: ud.group });
    } else {
      setTooltip(null);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // SavedSlices handlers — Stage 5
  // ---------------------------------------------------------------------------

  const handleSaveSlice = useCallback(() => {
    if (!sliceResult) return;
    setShowSaveInput(true);
    setSaveNameInput('');
  }, [sliceResult]);

  const confirmSaveSlice = useCallback(() => {
    if (!sliceResult) return;
    const name = saveNameInput.trim() || `Slice ${savedSlices.length + 1}`;
    // Deep-copy intersections to avoid stale THREE object references
    const sliceResultCopy = {
      ...sliceResult,
      intersections: sliceResult.intersections.map(ix => ({
        ...ix,
        centroid: ix.centroid.clone(),
        segments: ix.segments.map(s => ({ start: s.start.clone(), end: s.end.clone() })),
      })),
    };
    const thumbnail = renderMiniSlice({ sliceResult: sliceResultCopy });
    const entry = {
      id:         Date.now().toString(),
      name,
      pitch:      sliceResult.pitch      ?? sliceState.pitch,
      yaw:        sliceResult.yaw        ?? sliceState.yaw,
      roll:       sliceResult.roll       ?? sliceState.roll,
      apPosition: sliceResult.apPosition ?? sliceState.apPosition,
      lrPosition: sliceState.lrPosition,
      dvPosition: sliceState.dvPosition,
      thickness:  sliceResult.thickness,
      preset:     highlightState.preset,
      sliceResult: sliceResultCopy,
      thumbnail,
      savedAt: new Date().toISOString(),
    };
    setSavedSlices(prev => [...prev, entry]);
    setShowSaveInput(false);
    setSaveNameInput('');
  }, [sliceResult, sliceState, highlightState, savedSlices.length, saveNameInput]);

  const handleRecallSlice = useCallback((entry) => {
    setSliceState(s => ({
      ...s,
      pitch:      entry.pitch,
      yaw:        entry.yaw,
      roll:       entry.roll,
      apPosition: entry.apPosition,
      lrPosition: entry.lrPosition ?? 0,
      dvPosition: entry.dvPosition ?? 0,
    }));
    setSelectedThickness(entry.thickness);
    if (entry.preset) {
      applyPresetHighlight(entry.preset);
    } else {
      setHighlightState({ preset: null, highlighted: [] });
    }
    setSliceResult(entry.sliceResult);
    rightPanelRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [applyPresetHighlight]);

  const handleDeleteSlice = useCallback((id) => {
    setSavedSlices(prev => prev.filter(e => e.id !== id));
  }, []);

  const handleExportSession = useCallback(() => {
    const data = {
      tool:       'Allen Atlas Oblique Slice Planner',
      version:    '1.0',
      exportedAt: new Date().toISOString(),
      slices: savedSlices.map(e => ({
        ...e,
        sliceResult: {
          ...e.sliceResult,
          // THREE.Plane cannot be serialized directly — extract primitive fields
          plane: {
            normal:   { x: e.sliceResult.plane.normal.x, y: e.sliceResult.plane.normal.y, z: e.sliceResult.plane.normal.z },
            constant: e.sliceResult.plane.constant,
          },
        },
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.download = `atlas_session_${Date.now()}.json`;
    a.href = url; a.click(); URL.revokeObjectURL(url);
  }, [savedSlices]);

  const handleImportSession = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data.slices)) throw new Error('Missing slices array');
        const THREE = window.THREE;
        const restored = data.slices.map(entry => {
          // Reconstruct THREE.Plane from serialized { normal, constant }
          if (entry.sliceResult?.plane && !entry.sliceResult.plane.distanceToPoint) {
            const { normal: n, constant: c } = entry.sliceResult.plane;
            entry.sliceResult.plane = new THREE.Plane(new THREE.Vector3(n.x, n.y, n.z), c);
          }
          // Reconstruct THREE.Vector3 for segment points
          if (entry.sliceResult?.intersections) {
            entry.sliceResult.intersections.forEach(ix => {
              if (ix.segments) {
                ix.segments = ix.segments.map(seg => ({
                  start: seg.start?.x !== undefined ? new THREE.Vector3(seg.start.x, seg.start.y, seg.start.z) : seg.start,
                  end:   seg.end?.x   !== undefined ? new THREE.Vector3(seg.end.x,   seg.end.y,   seg.end.z)   : seg.end,
                }));
              }
              if (ix.centroid?.x !== undefined) {
                ix.centroid = new THREE.Vector3(ix.centroid.x, ix.centroid.y, ix.centroid.z);
              }
              if (!ix.color) ix.color = '#888888';
            });
          }
          return entry;
        });
        setSavedSlices(prev => [...prev, ...restored]);
        setImportMsg(`Imported ${restored.length} slice${restored.length !== 1 ? 's' : ''}`);
        setTimeout(() => setImportMsg(''), 2500);
      } catch (err) {
        setImportMsg(`Import failed: ${err.message}`);
        setTimeout(() => setImportMsg(''), 3000);
      }
      e.target.value = ''; // reset file input for re-use
    };
    reader.readAsText(file);
  }, []);

  // ---------------------------------------------------------------------------
  // renderSlice2D — carry-forward from Stage 3/4; auto-fit bbox scale preserved
  // ---------------------------------------------------------------------------
  function renderSlice2D() {
    const THREE = window.THREE;
    if (!THREE) return;
    const canvas = sliceCanvasRef.current;
    if (!canvas || !sliceResult) return;

    const W = canvas.offsetWidth || 400;
    const H = 300;
    canvas.width  = W;
    canvas.height = H;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FAF8F5';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#E8E4DC';
    ctx.lineWidth   = 0.5;
    for (let x = 0; x < W; x += 50) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y < H; y += 50) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    if (!sliceResult.intersections || sliceResult.intersections.length === 0) {
      ctx.font = '11px "DM Mono", monospace';
      ctx.fillStyle = '#8A8078';
      ctx.textAlign = 'center';
      ctx.fillText('No structures intersected', W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }

    const normal = sliceResult.plane.normal;
    const up = Math.abs(normal.y) < 0.99 ? new THREE.Vector3(0,1,0) : new THREE.Vector3(1,0,0);
    const uAxis = new THREE.Vector3().crossVectors(up, normal).normalize();
    const vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize();

    // --- Auto-fit bounding box (carry-forward constraint: do NOT replace this) ---
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    sliceResult.intersections.forEach(intersection => {
      intersection.segments.forEach(seg => {
        ['start','end'].forEach(key => {
          const u =  seg[key].dot(uAxis);
          const v = -seg[key].dot(vAxis);
          if (u < uMin) uMin = u; if (u > uMax) uMax = u;
          if (v < vMin) vMin = v; if (v > vMax) vMax = v;
        });
      });
    });

    const rangeU = uMax - uMin || 1;
    const rangeV = vMax - vMin || 1;
    // SCALE: auto-fit to 80% of canvas — DO NOT hardcode (carry-forward constraint)
    const SCALE = Math.min((W * 0.8) / rangeU, (H * 0.8) / rangeV);
    const uCenter = (uMin + uMax) / 2;
    const vCenter = (vMin + vMax) / 2;
    const cx = W / 2 - uCenter * SCALE;
    const cy = H / 2 + vCenter * SCALE;

    // --- Region fills ---
    sliceResult.intersections.forEach(intersection => {
      if (intersection.segments.length === 0) return;
      const pts = [];
      intersection.segments.forEach(seg => {
        ['start','end'].forEach(key => {
          pts.push({ u: seg[key].dot(uAxis)*SCALE+cx, v: -seg[key].dot(vAxis)*SCALE+cy });
        });
      });
      const centU = intersection.centroid.dot(uAxis)*SCALE+cx;
      const centV = -intersection.centroid.dot(vAxis)*SCALE+cy;
      pts.sort((a,b) => Math.atan2(a.v-centV, a.u-centU) - Math.atan2(b.v-centV, b.u-centU));
      ctx.beginPath();
      ctx.moveTo(pts[0].u, pts[0].v);
      pts.slice(1).forEach(p => ctx.lineTo(p.u, p.v));
      ctx.closePath();
      ctx.fillStyle = hexToRgba(intersection.color, 0.15);
      ctx.fill();
    });

    // --- Stroke segments ---
    sliceResult.intersections.forEach(intersection => {
      ctx.strokeStyle = intersection.color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      intersection.segments.forEach(seg => {
        ctx.beginPath();
        ctx.moveTo(seg.start.dot(uAxis)*SCALE+cx, -seg.start.dot(vAxis)*SCALE+cy);
        ctx.lineTo(seg.end.dot(uAxis)*SCALE+cx,   -seg.end.dot(vAxis)*SCALE+cy);
        ctx.stroke();
      });
    });

    // --- Force-separation labels ---
    ctx.font = 'bold 11px "DM Mono", monospace';
    const lb = sliceResult.intersections.map(ix => ({
      x: ix.centroid.dot(uAxis)*SCALE+cx,
      y: -ix.centroid.dot(vAxis)*SCALE+cy,
      origX: ix.centroid.dot(uAxis)*SCALE+cx,
      origY: -ix.centroid.dot(vAxis)*SCALE+cy,
      text: ix.acronym, color: ix.color,
    }));

    const LABEL_MIN_DIST = 22;
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < lb.length; i++) {
        for (let j = i + 1; j < lb.length; j++) {
          const dx = lb[j].x - lb[i].x, dy = lb[j].y - lb[i].y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < LABEL_MIN_DIST && dist > 0) {
            const push = (LABEL_MIN_DIST - dist) / 2;
            lb[i].x -= (dx/dist)*push; lb[i].y -= (dy/dist)*push;
            lb[j].x += (dx/dist)*push; lb[j].y += (dy/dist)*push;
          }
        }
      }
    }

    lb.forEach(label => {
      const dispX = label.x - label.origX, dispY = label.y - label.origY;
      if (Math.sqrt(dispX*dispX + dispY*dispY) > 3) {
        ctx.save();
        ctx.globalAlpha = 0.5; ctx.strokeStyle = label.color; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(label.origX, label.origY); ctx.lineTo(label.x, label.y); ctx.stroke();
        ctx.restore();
      }
    });

    lb.forEach(label => {
      const m = ctx.measureText(label.text);
      ctx.fillStyle = 'rgba(250,248,245,0.92)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(label.x-3, label.y-11, m.width+6, 15, 3);
      else ctx.rect(label.x-3, label.y-11, m.width+6, 15);
      ctx.fill();
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, label.x, label.y);
    });

    // --- Scale bar (1 mm) ---
    const barPx = 1000 * SCALE;
    const barX = 12, barY = H - 14;
    ctx.save();
    ctx.strokeStyle = '#8A8078'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(barX, barY); ctx.lineTo(barX+barPx, barY);
    ctx.moveTo(barX, barY-3); ctx.lineTo(barX, barY+3);
    ctx.moveTo(barX+barPx, barY-3); ctx.lineTo(barX+barPx, barY+3);
    ctx.stroke();
    ctx.font = '9px "DM Mono", monospace'; ctx.fillStyle = '#8A8078';
    ctx.fillText('1 mm', barX+barPx/2-12, barY-4);
    ctx.restore();

    // --- Orientation compass ---
    const compX = W - 38, compY = H - 38, compR = 15;
    const yawRad  = (sliceResult.yaw  || 0) * Math.PI / 180;
    const rollRad = (sliceResult.roll || 0) * Math.PI / 180;
    const compassAxes = [
      { label:'D', dx:  Math.sin(rollRad), dy: -Math.cos(rollRad) },
      { label:'V', dx: -Math.sin(rollRad), dy:  Math.cos(rollRad) },
      { label:'M', dx: -Math.cos(yawRad),  dy:  0 },
      { label:'L', dx:  Math.cos(yawRad),  dy:  0 },
    ];
    ctx.save();
    ctx.font = '9px "DM Mono", monospace'; ctx.fillStyle = '#8A8078';
    compassAxes.forEach(a => {
      const ex = compX + a.dx*compR, ey = compY + a.dy*compR;
      ctx.strokeStyle = '#8A8078'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(compX, compY); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillText(a.label, ex-4, ey+4);
    });
    ctx.restore();
  }

  useEffect(() => {
    if (sliceResult) setTimeout(() => renderSlice2D(), 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliceResult]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <style>{FONT_STYLE}</style>

      {/* Root container — full viewport */}
      <div style={{
        display: 'flex', width: '100vw', height: '100vh',
        overflow: 'hidden', background: T.bg, fontFamily: T.fontMono,
      }}>

        {/* ================================================================
            LEFT PANEL — CSS grid "specimen frame" layout (Stage 5)
            gridAreas: top=L↔R slider, left=Roll slider, canvas=3D view,
                       right=D↔V slider, bottom=Yaw slider
        ================================================================ */}
        <div style={{
          flex: '0 0 60%',
          display: 'grid',
          gridTemplateAreas: '". top ." "left canvas right" ". bottom ."',
          gridTemplateColumns: '56px 1fr 56px',
          gridTemplateRows: '56px 1fr 56px',
          background: '#FAF8F5',
          position: 'relative',
        }}>

          {/* ---- Top slider: L ← → R ---- */}
          <div style={{
            gridArea: 'top', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', padding: '4px 0',
          }}>
            <div style={{
              fontFamily: '"DM Mono",monospace', fontSize: 9, color: '#8A8078',
              marginBottom: 2, userSelect: 'none',
            }}>L ← → R</div>
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type="range" className="frame-slider"
                min={-3000} max={3000} step={50}
                value={sliceState.lrPosition}
                onChange={e => setSliceState(s => ({ ...s, lrPosition: Number(e.target.value) }))}
                style={{ width: '100%', display: 'block' }}
              />
              <SliderPill value={sliceState.lrPosition} unit="µm" />
            </div>
          </div>

          {/* ---- Left slider: Roll (vertical, rotated) ---- */}
          <div className="vslider-wrap" style={{ gridArea: 'left' }}>
            <span style={{
              position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
              fontFamily: '"DM Mono",monospace', fontSize: 8, color: '#8A8078',
              writingMode: 'vertical-rl', userSelect: 'none', letterSpacing: '0.05em',
            }}>
              ROLL
            </span>
            <input
              ref={rollSliderRef}
              type="range" className="frame-slider"
              min={-45} max={45} step={1}
              value={sliceState.roll}
              onChange={e => setSliceState(s => ({ ...s, roll: Number(e.target.value) }))}
              style={{
                transform: 'rotate(-90deg)', transformOrigin: 'center center',
                width: '200px', display: 'block',  // overridden by ResizeObserver
              }}
            />
          </div>

          {/* ---- Canvas cell: Three.js 3D viewer ---- */}
          <div
            ref={mountRef}
            style={{
              gridArea: 'canvas', position: 'relative',
              overflow: 'hidden', cursor: 'grab',
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setTooltip(null)}
          >
            {/* Canvas overlay for 3D projected acronym labels */}
            <canvas
              ref={labelOverlayRef}
              style={{
                position: 'absolute', top: 0, left: 0,
                width: '100%', height: '100%', pointerEvents: 'none',
              }}
            />

            {/* Stage 5 — View lock toggle button (absolute top-right of canvas cell) */}
            <button
              onClick={handleToggleLock}
              style={{
                position: 'absolute', top: 12, right: 12, zIndex: 10,
                fontFamily: '"DM Mono", monospace', fontSize: 10,
                background: viewLocked ? '#4A6741' : '#FAF8F5',
                color:      viewLocked ? 'white'   : '#3D3530',
                border: '1px solid #DDD8CE', borderRadius: 4,
                padding: '6px 10px', cursor: 'pointer',
              }}
            >
              {viewLocked ? '\u229E Locked View' : '\u2295 Free Orbit'}
            </button>

            {/* Hover tooltip */}
            {tooltip && (
              <div style={{
                position: 'absolute', left: tooltip.x, top: tooltip.y,
                background: '#FAF8F5', border: `1px solid ${T.border}`,
                borderRadius: 4, padding: '4px 8px',
                fontFamily: T.fontMono, fontSize: 11, color: T.text,
                pointerEvents: 'none', zIndex: 100,
                whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              }}>
                <strong>{tooltip.name}</strong>
                <span style={{ color: T.textMuted, marginLeft: 6 }}>{tooltip.group}</span>
              </div>
            )}

            {/* Region Toggle Panel — absolute overlay top-left of canvas */}
            <div style={{
              position: 'absolute', top: 12, left: 12,
              background: T.bg, border: `1px solid ${T.border}`,
              borderRadius: 8, padding: 10, maxWidth: 210,
              fontFamily: T.fontMono, fontSize: 11, color: T.text,
              zIndex: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', userSelect: 'none',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: panelExpanded ? 8 : 0,
              }}>
                <span style={{ fontFamily: T.fontMono, fontWeight: 500, fontSize: 11, letterSpacing: '0.05em', color: T.text }}>
                  Structures
                </span>
                <button
                  onClick={() => setPanelExpanded(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 13, padding: '0 2px', lineHeight: 1 }}
                  title={panelExpanded ? 'Collapse' : 'Expand'}
                >
                  {panelExpanded ? '▲' : '▼'}
                </button>
              </div>

              {panelExpanded && Object.keys(CCF_BY_GROUP).map(groupName => {
                const groupChecked  = isGroupChecked(groupName);
                const groupExpanded = expandedGroups[groupName];
                const members       = CCF_BY_GROUP[groupName];
                return (
                  <div key={groupName} style={{ marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingBottom: 2 }}>
                      <input type="checkbox" checked={groupChecked}
                             onChange={e => handleToggleGroup(groupName, e.target.checked)}
                             style={{ cursor: 'pointer', accentColor: T.accent, margin: 0 }} />
                      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: GROUP_COLORS[groupName], flexShrink: 0 }} />
                      <span style={{ flex: 1, fontWeight: 500, textTransform: 'capitalize', fontSize: 11 }}>{groupName}</span>
                      <button onClick={() => toggleGroupExpand(groupName)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 11, padding: '0 2px' }}>
                        {groupExpanded ? '▲' : '▼'}
                      </button>
                    </div>
                    {groupExpanded && members.map(acronym => {
                      const s = CCF_BY_ACRONYM[acronym];
                      const checked = visibilityState[acronym] !== false;
                      return (
                        <div key={acronym} style={{ display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 16, marginBottom: 2 }}>
                          <input type="checkbox" checked={checked}
                                 onChange={e => handleToggleStructure(acronym, e.target.checked)}
                                 style={{ cursor: 'pointer', accentColor: T.accent, margin: 0 }} />
                          <span style={{ fontFamily: T.fontMono, fontWeight: 500, color: s.color, fontSize: 10, minWidth: 40 }}>{acronym}</span>
                          <span style={{ color: T.textMuted, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }} title={s.label}>
                            {s.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Stage 4: Loading progress overlay */}
            {meshLoadState.loaded + meshLoadState.failed < meshLoadState.total && meshLoadState.total > 0 && (
              <div style={{
                position: 'absolute', bottom: 48, right: 12,
                background: 'rgba(250,248,245,0.92)', border: `1px solid ${T.border}`,
                borderRadius: 6, padding: '5px 10px',
                fontFamily: T.fontMono, fontSize: 10, color: T.textMuted,
                pointerEvents: 'none', zIndex: 10,
              }}>
                Loading meshes… ({meshLoadState.loaded}/{meshLoadState.total})
                {meshLoadState.failed > 0 && ` · ${meshLoadState.failed} fallback`}
              </div>
            )}

            {/* Axis Indicator — bottom-left of canvas cell */}
            <canvas
              ref={axisCanvasRef}
              width={80} height={80}
              style={{ position: 'absolute', bottom: 12, left: 12, pointerEvents: 'none', zIndex: 10 }}
            />
          </div>

          {/* ---- Right slider: D ↕ V (vertical, rotated) ---- */}
          <div className="vslider-wrap" style={{ gridArea: 'right' }}>
            <input
              ref={dvSliderRef}
              type="range" className="frame-slider"
              min={-2000} max={2000} step={50}
              value={sliceState.dvPosition}
              onChange={e => setSliceState(s => ({ ...s, dvPosition: Number(e.target.value) }))}
              style={{
                transform: 'rotate(-90deg)', transformOrigin: 'center center',
                width: '200px', display: 'block',  // overridden by ResizeObserver
              }}
            />
            <span style={{
              position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
              fontFamily: '"DM Mono",monospace', fontSize: 8, color: '#8A8078',
              writingMode: 'vertical-rl', userSelect: 'none', letterSpacing: '0.05em',
            }}>
              D ↕ V
            </span>
          </div>

          {/* ---- Bottom slider: Yaw ---- */}
          <div style={{
            gridArea: 'bottom', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', padding: '4px 0',
          }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type="range" className="frame-slider"
                min={-45} max={45} step={1}
                value={sliceState.yaw}
                onChange={e => setSliceState(s => ({ ...s, yaw: Number(e.target.value) }))}
                style={{ width: '100%', display: 'block' }}
              />
              <SliderPill value={sliceState.yaw} unit="°" />
            </div>
            <div style={{
              fontFamily: '"DM Mono",monospace', fontSize: 9, color: '#8A8078',
              marginTop: 2, userSelect: 'none',
            }}>YAW</div>
          </div>

        </div>{/* end left panel grid */}

        {/* ================================================================
            RIGHT PANEL — Controls + Slice Output (40%)
        ================================================================ */}
        <div style={{
          flex: '0 0 40%', display: 'flex', flexDirection: 'column',
          borderLeft: `1px solid ${T.border}`, background: T.panelBg,
          overflow: 'hidden',
        }}>

          {/* ---- Controls Panel (top half, scrollable) ---- */}
          <div
            ref={rightPanelRef}
            style={{ flex: '1 1 0', overflowY: 'auto', padding: 20 }}
          >
            <h1 style={{
              fontFamily: T.fontSerif, fontSize: 18, fontWeight: 600,
              color: T.text, margin: '0 0 20px 0', lineHeight: 1.2,
            }}>
              Slice Planner
            </h1>

            {/* Stage 5 — Pitch numeric input (replaces pitch slider) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontFamily: '"DM Mono",monospace', fontSize: 10, color: '#8A8078', letterSpacing: '0.1em' }}>PITCH</span>
              <input
                type="number" min={-45} max={45} step={1}
                value={sliceState.pitch}
                onChange={e => {
                  const v = Math.max(-45, Math.min(45, Number(e.target.value)));
                  setSliceState(s => ({ ...s, pitch: v }));
                }}
                style={{
                  width: 60, fontFamily: '"DM Mono",monospace', fontSize: 11,
                  border: '1px solid #DDD8CE', borderRadius: 4, padding: '3px 6px',
                  background: '#FAF8F5', color: '#3D3530', textAlign: 'right',
                }}
              />
              <span style={{ fontFamily: '"DM Mono",monospace', fontSize: 10, color: '#8A8078' }}>°</span>
              <span style={{ fontFamily: '"DM Mono",monospace', fontSize: 9, color: '#AAA098' }}>A/P tilt</span>
            </div>

            {/* ---- Circuit Presets ---- */}
            <div style={{ marginBottom: 22 }}>
              <div style={{
                fontFamily: T.fontMono, fontSize: 10, letterSpacing: '0.1em',
                color: T.textMuted, marginBottom: 8, textTransform: 'uppercase',
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
                    <button key={id} onClick={() => handlePreset(id)} style={{
                      fontFamily: T.fontMono, fontSize: 11, padding: '6px 10px',
                      borderRadius: 4, border: `1px solid ${isActive ? T.gold : T.border}`,
                      background: isActive ? '#FDF6E3' : T.bg, color: T.text,
                      cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
                    }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ---- Slice Thickness ---- */}
            <div>
              <div style={{
                fontFamily: T.fontMono, fontSize: 10, letterSpacing: '0.1em',
                color: T.textMuted, marginBottom: 8, textTransform: 'uppercase',
              }}>
                Slice Thickness
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {THICKNESS_OPTIONS.map((val, i) => {
                  const lbl    = THICKNESS_LABELS[i];
                  const active = selectedThickness === lbl;
                  return (
                    <button key={val} onClick={() => handleThickness(val, lbl)} style={{
                      fontFamily: T.fontMono, fontSize: 11, padding: '5px 10px',
                      borderRadius: 20, border: `1px solid ${active ? 'transparent' : T.border}`,
                      background: active ? T.accent : T.bg,
                      color: active ? '#FFFFFF' : T.text,
                      cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
                    }}>
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ---- Divider ---- */}
          <div style={{ height: 1, background: T.border, flexShrink: 0 }} />

          {/* ================================================================
              Slice Output Panel (bottom half)
          ================================================================ */}
          <div style={{
            flex: '0 0 auto', minHeight: 200, padding: 16,
            display: 'flex', flexDirection: 'column', overflowY: 'auto',
          }}>

            {sliceResult === null ? (
              <>
                <div style={{
                  border: `1px dashed ${T.border}`, borderRadius: 6,
                  padding: '24px 16px', textAlign: 'center',
                  marginBottom: 16, background: T.bg,
                }}>
                  <p style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textMuted, margin: '0 0 4px 0', lineHeight: 1.5 }}>
                    Configure slice orientation above,
                  </p>
                  <p style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textMuted, margin: 0, lineHeight: 1.5 }}>
                    then click Generate Slice
                  </p>
                </div>

                <button onClick={handleGenerateSlice} style={{
                  width: '100%', background: T.accent, color: '#FFFFFF',
                  fontFamily: T.fontSerif, fontSize: 15, fontWeight: 600,
                  padding: '12px 0', borderRadius: 6, border: 'none',
                  cursor: 'pointer', letterSpacing: '0.01em',
                }}>
                  Generate Slice
                </button>

                {/* Stage 5: Save Slice button — disabled when no result yet */}
                <button
                  onClick={handleSaveSlice}
                  disabled={!sliceResult}
                  style={{
                    width: '100%', marginTop: 8,
                    fontFamily: T.fontSerif, fontSize: 14,
                    padding: '10px', borderRadius: 6,
                    cursor: 'not-allowed',
                    background: '#FAF8F5',
                    border: `1px solid ${T.border}`,
                    color: '#AAA098',
                  }}
                >
                  Save Slice
                </button>
              </>
            ) : (
              <>
                {/* Slice title with parameter badges */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 6, flexWrap: 'wrap', gap: 4,
                }}>
                  <span style={{ fontFamily: T.fontMono, fontSize: 10, letterSpacing: '0.1em', color: T.textMuted }}>
                    SLICE PREVIEW
                  </span>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {highlightState.preset && (
                      <span style={{
                        fontFamily: T.fontMono, fontSize: 10,
                        background: '#FDF6E3', border: `1px solid ${T.gold}`,
                        color: T.gold, borderRadius: 10, padding: '2px 7px',
                      }}>
                        {highlightState.preset === 'tc' ? 'Thalamocortical' : 'Hippocampal'}
                      </span>
                    )}
                    {[
                      ['P', sliceResult.pitch,    '°'],
                      ['Y', sliceResult.yaw,       '°'],
                      ['R', sliceResult.roll,       '°'],
                      ['T', sliceResult.thickness,  ''],
                    ].map(([k, v, u]) => (
                      <span key={k} style={{
                        fontFamily: T.fontMono, fontSize: 10,
                        background: '#F0EDE6', border: `1px solid ${T.border}`,
                        color: '#5A5450', borderRadius: 10, padding: '2px 7px',
                      }}>
                        {k} {v}{u}
                      </span>
                    ))}
                  </div>
                </div>

                {/* 2D cross-section canvas */}
                <canvas
                  ref={sliceCanvasRef}
                  style={{
                    width: '100%', height: '300px', display: 'block',
                    borderRadius: 4, border: `1px solid ${T.border}`,
                    marginBottom: 12, background: '#FAF8F5',
                  }}
                />

                {/* Structure list */}
                <div style={{ fontFamily: T.fontMono, fontSize: 10, letterSpacing: '0.1em', color: T.textMuted, marginTop: 12, marginBottom: 6 }}>
                  INTERSECTED STRUCTURES ({sliceResult.intersections.length})
                </div>

                {sliceResult.intersections.length === 0 ? (
                  <div style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textMuted, textAlign: 'center', padding: '16px 0' }}>
                    No structures at this plane position.<br/>Try adjusting A→P position or pitch.
                  </div>
                ) : (
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {sliceResult.intersections.map(ix => {
                      const isHighlighted = highlightState.highlighted.includes(ix.acronym);
                      const groupColor    = GROUP_COLORS[ix.group] || '#888';
                      return (
                        <div key={ix.acronym} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '4px 8px', borderRadius: 4,
                          background: isHighlighted ? hexToRgba(ix.color, 0.07) : 'transparent',
                        }}>
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: ix.color, flexShrink: 0 }} />
                          <span style={{ fontFamily: T.fontMono, fontWeight: 'bold', fontSize: 11, color: ix.color, minWidth: 52 }}>
                            {ix.acronym}
                          </span>
                          <span style={{ fontFamily: T.fontMono, fontSize: 11, color: '#5A5450', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ix.name}
                          </span>
                          <span style={{ fontFamily: T.fontMono, fontSize: 9, background: hexToRgba(groupColor, 0.15), color: groupColor, borderRadius: 3, padding: '2px 6px', flexShrink: 0 }}>
                            {ix.group}
                          </span>
                          {isHighlighted && <span style={{ color: T.gold, fontSize: 10, flexShrink: 0 }}>★</span>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Export buttons */}
                <div style={{ display: 'flex', gap: 8, marginTop: 12, padding: '0 0 8px' }}>
                  <button onClick={handleExportPNG} style={{
                    flex: 1, fontFamily: T.fontMono, fontSize: 11, padding: '7px 0',
                    borderRadius: 4, cursor: 'pointer',
                    background: '#FAF8F5', border: `1px solid ${T.accent}`, color: T.accent,
                  }}>
                    Export PNG
                  </button>
                  <button onClick={handleExportConfig} style={{
                    flex: 1, fontFamily: T.fontMono, fontSize: 11, padding: '7px 0',
                    borderRadius: 4, cursor: 'pointer',
                    background: T.accent, border: `1px solid ${T.accent}`, color: 'white',
                  }}>
                    Export Config
                  </button>
                </div>

                {/* Stage 5: Save Slice button */}
                <button
                  onClick={handleSaveSlice}
                  disabled={!sliceResult}
                  style={{
                    width: '100%', marginTop: 8,
                    fontFamily: T.fontSerif, fontSize: 14,
                    padding: '10px', borderRadius: 6,
                    cursor: sliceResult ? 'pointer' : 'not-allowed',
                    background: '#FAF8F5',
                    border: `1px solid ${sliceResult ? T.gold : T.border}`,
                    color: sliceResult ? T.gold : '#AAA098',
                  }}
                >
                  Save Slice
                </button>

                {/* Re-generate button */}
                <button onClick={handleGenerateSlice} style={{
                  width: '100%', marginTop: 4,
                  background: T.accent, color: '#FFFFFF',
                  fontFamily: T.fontSerif, fontSize: 14, fontWeight: 600,
                  padding: '10px 0', borderRadius: 6, border: 'none',
                  cursor: 'pointer', letterSpacing: '0.01em',
                }}>
                  Re-generate Slice
                </button>
              </>
            )}

            {/* ================================================================
                Stage 5 — Saved Slices Panel
                Rendered unconditionally (not gated on sliceResult).
                Save button is disabled when sliceResult is null.
            ================================================================ */}
            <div style={{ marginTop: 16, borderTop: '1px solid #DDD8CE', paddingTop: 12 }}>
              {/* Panel header */}
              <div
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  cursor: 'pointer', marginBottom: savedSlicesPanelOpen ? 8 : 0,
                }}
                onClick={() => setSavedSlicesPanelOpen(o => !o)}
              >
                <span style={{ fontFamily: '"DM Mono",monospace', fontSize: 10, letterSpacing: '0.1em', color: '#8A8078' }}>
                  SAVED SLICES ({savedSlices.length})
                </span>
                <span style={{ fontSize: 10, color: '#8A8078' }}>{savedSlicesPanelOpen ? '▾' : '▸'}</span>
              </div>

              {savedSlicesPanelOpen && (
                <>
                  {/* Saved slice rows */}
                  {savedSlices.length === 0 ? (
                    <div style={{ fontFamily: '"DM Mono",monospace', fontSize: 10, color: '#AAA098', padding: '8px 0' }}>
                      No saved slices yet. Generate a slice and click "Save".
                    </div>
                  ) : (
                    savedSlices.map(entry => (
                      <div key={entry.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 0', borderBottom: '1px solid #F0EDE6',
                      }}>
                        {/* Thumbnail */}
                        {entry.thumbnail ? (
                          <img src={entry.thumbnail} width={60} height={45}
                               style={{ borderRadius: 3, border: '1px solid #DDD8CE', flexShrink: 0 }}
                               alt={entry.name} />
                        ) : (
                          <div style={{ width: 60, height: 45, background: '#F0EDE6', borderRadius: 3, flexShrink: 0 }} />
                        )}
                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontFamily: '"DM Mono",monospace', fontSize: 11, fontWeight: 'bold', color: '#3D3530',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {entry.name}
                          </div>
                          <div style={{ fontFamily: '"DM Mono",monospace', fontSize: 9, color: '#8A8078' }}>
                            P:{entry.pitch}° Y:{entry.yaw}° R:{entry.roll}° | {entry.thickness}
                          </div>
                        </div>
                        {/* Recall */}
                        <button
                          onClick={() => handleRecallSlice(entry)}
                          style={{
                            fontFamily: '"DM Mono",monospace', fontSize: 10,
                            background: '#FAF8F5', border: '1px solid #4A6741',
                            color: '#4A6741', borderRadius: 3, padding: '3px 7px',
                            cursor: 'pointer', flexShrink: 0,
                          }}
                        >
                          ↩
                        </button>
                        {/* Delete */}
                        <button
                          onClick={() => handleDeleteSlice(entry.id)}
                          style={{
                            fontFamily: '"DM Mono",monospace', fontSize: 10,
                            background: 'transparent', border: 'none',
                            color: '#AAA098', cursor: 'pointer', padding: '3px', flexShrink: 0,
                          }}
                          onMouseEnter={e => e.target.style.color = '#C0392B'}
                          onMouseLeave={e => e.target.style.color = '#AAA098'}
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}

                  {/* Save name input (inline, shown when showSaveInput) */}
                  {showSaveInput && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <input
                        autoFocus
                        type="text"
                        value={saveNameInput}
                        onChange={e => setSaveNameInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter')  confirmSaveSlice();
                          if (e.key === 'Escape') setShowSaveInput(false);
                        }}
                        placeholder={`Slice ${savedSlices.length + 1}`}
                        style={{
                          flex: 1, fontFamily: '"DM Mono",monospace', fontSize: 11,
                          border: '1px solid #DDD8CE', borderRadius: 4, padding: '4px 8px',
                          background: '#FAF8F5', color: '#3D3530', minWidth: 0,
                        }}
                      />
                      <button onClick={confirmSaveSlice} style={{
                        fontFamily: '"DM Mono",monospace', fontSize: 10,
                        background: '#4A6741', color: 'white', border: 'none',
                        borderRadius: 4, padding: '4px 10px', cursor: 'pointer',
                      }}>
                        Save
                      </button>
                      <button onClick={() => setShowSaveInput(false)} style={{
                        fontFamily: '"DM Mono",monospace', fontSize: 10,
                        background: '#FAF8F5', color: '#8A8078',
                        border: '1px solid #DDD8CE', borderRadius: 4,
                        padding: '4px 10px', cursor: 'pointer',
                      }}>
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* Session export / import */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
                    <button
                      onClick={handleExportSession}
                      disabled={savedSlices.length === 0}
                      style={{
                        flex: 1, fontFamily: '"DM Mono",monospace', fontSize: 10,
                        padding: '6px 0', borderRadius: 4,
                        cursor: savedSlices.length ? 'pointer' : 'not-allowed',
                        background: '#FAF8F5', border: '1px solid #DDD8CE',
                        color: savedSlices.length ? '#3D3530' : '#AAA098',
                      }}
                    >
                      Export Session
                    </button>
                    <button
                      onClick={() => importFileRef.current?.click()}
                      style={{
                        flex: 1, fontFamily: '"DM Mono",monospace', fontSize: 10,
                        padding: '6px 0', borderRadius: 4, cursor: 'pointer',
                        background: '#FAF8F5', border: '1px solid #DDD8CE', color: '#3D3530',
                      }}
                    >
                      Import Session
                    </button>
                    <input
                      ref={importFileRef}
                      type="file" accept=".json"
                      style={{ display: 'none' }}
                      onChange={handleImportSession}
                    />
                  </div>

                  {importMsg && (
                    <div style={{ fontFamily: '"DM Mono",monospace', fontSize: 10, color: '#4A6741', marginTop: 6 }}>
                      {importMsg}
                    </div>
                  )}
                </>
              )}
            </div>
            {/* end Saved Slices Panel */}

          </div>{/* end Slice Output Panel */}
        </div>{/* end right panel */}
      </div>{/* end root container */}
    </>
  );
}
