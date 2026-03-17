/**
 * Allen Atlas Oblique Slice Planner — Stage 4
 * Extends Stage 3 with:
 *   A. Fix VPL structure ID: registry now uses id:718 for VPL (NOT 563).
 *      563 = dorsal tegmental tract. Source: RESEARCH_BRIEF_STAGE4.md §1.
 *   B. All CCF_STRUCTURES_RAW entries have numeric `id` fields (Allen CCF IDs).
 *   C. Mesh loading useEffect: fetches real Allen PLY geometry from
 *      mesh_server.py (FastAPI, localhost:8000) and replaces ellipsoid
 *      BufferGeometry in-place after loading. Falls back silently to
 *      ellipsoid on any fetch/parse/geometry error.
 *   D. Root mesh (997) replaces the programmatic scaled-sphere brain shell.
 *   E. Loading progress overlay ("Loading meshes... (N/total)").
 *   F. Export Config JSON version bumped to '2.0' with mesh_source note.
 *
 * Stage 4 preserves ALL Stage 3 logic exactly:
 *   - CCF_STRUCTURES registry validation
 *   - scene setup, lights, shell mesh, structure meshes (ellipsoids as fallback)
 *   - orbit controls, ghost plane stack, axis indicator, hover tooltip
 *   - buildSlicePlane / intersectMeshWithPlane / computeAllIntersections
 *   - sliceStateRef / visibilityRef / highlightRef sync pattern
 *   - 2D slice rendering: region fills, labels, scale bar, compass
 *   - Export PNG / Export Config buttons
 *
 * Carry-forward constraints (must not be broken):
 *   - apPosition: raw µm — do NOT divide by 1000 anywhere
 *   - 2D scale: auto-fit bbox — do NOT replace with hardcoded scale
 *   - edgeIntersect: >= 0 positive-side convention — unchanged
 *   - Three.js r128 is in use (not r165)
 *
 * SYSTEM_SPEC.md v2 §Stage 4 Addendum — MeshServer Module 10
 * INTERFACE_CONTRACTS.md v2 §Stage 4 Addendum — MeshServer contracts
 * RESEARCH_BRIEF_STAGE4.md §7 Recommendations applied: R-1 through R-9
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
// Stage 3 A1: hexToRgba — pure utility, outside component
// Converts a 6-digit hex color + alpha to an rgba() CSS string.
// Args:
//   hex:   '#RRGGBB' format
//   alpha: number [0, 1]
// Returns: rgba string e.g. 'rgba(255,107,107,0.15)'
// ---------------------------------------------------------------------------
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------------
// CCF_STRUCTURES Registry
// INTERFACE_CONTRACTS.md §Module: CCF_STRUCTURES Registry
// Frozen at load time; no module may mutate this object.
//
// Stage 4 Change A+B:
//   - Added `id` field to every record (Allen CCF integer structure IDs).
//   - VPL id corrected from 563 → 718.
//     563 = dorsal tegmental tract (DTT), NOT VPL.
//     718 = Ventral posterolateral nucleus (confirmed via Allen Brain Atlas API).
//     Source: RESEARCH_BRIEF_STAGE4.md §1 VPL Correction.
//
// Fields: id (Allen CCF int), acronym, label (full name), group, color,
//         center_ccf [AP,DV,ML µm], semi_axes [a,b,c µm],
//         euler_ccf [rx,ry,rz rad] (all zero = axis-aligned)
// ---------------------------------------------------------------------------
const CCF_STRUCTURES_RAW = [
  // ---- THALAMUS -----------------------------------------------------------
  { id:733,  acronym:'VPM',     label:'Ventral posteromedial nucleus',
    color:'#FF6B6B', group:'thalamus',
    center_ccf:[5900,4300,4700], semi_axes:[380,320,290], euler_ccf:[0,0,0] },
  { id:718,  acronym:'VPL',     label:'Ventral posterolateral nucleus',
    // Stage 4: id corrected from 563 → 718.
    // 563 is the dorsal tegmental tract (DTT). 718 is the correct Allen CCF
    // ID for VPL, confirmed by /mesh/{id} PLY bounding box
    // (AP: 6195–7665, DV: 3401–4940, ML: 3221–8148 µm — thalamic position).
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
// because it is loaded into shellRef, not meshMapRef.
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

// Group swatch colors — used in RegionTogglePanel, structure list, and renderSlice2D
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
// Remapping (locked in Stage 2, validated against thalamic landmark data):
//   threeX =  ccfZ - 5700   (ML centered on 5700 midline)
//   threeY = -(ccfY - 4000) (DV flipped: dorsal up in Three.js)
//   threeZ = -(ccfX - 5700) (AP: anterior = negative Z)
//
// Stage 4: same transform is applied client-side to PLY mesh vertices
// in the mesh loading useEffect. SYSTEM_SPEC.md v2 §Stage 4 Addendum
// §Coordinate system for PLY vertices.
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
// Slice Plane Engine (carry-forward from Stage 2/3)
// ---------------------------------------------------------------------------

/**
 * Build a THREE.Plane from pitch/yaw/roll (degrees) and AP position (µm).
 *
 * Algorithm:
 *   1. Convert degrees → radians.
 *   2. Build THREE.Euler with order 'XYZ'.
 *   3. Start with normal = (0, 0, 1) — unrotated coronal plane faces +Z.
 *   4. Apply euler rotation via Matrix4.makeRotationFromEuler, then normalize.
 *   5. apOffset = -apPositionMicrons maps CCF µm to Three.js Z units.
 *      Raw µm is used for consistency with Stage 1 plane widget convention.
 *      SPEC_CONFLICT: brief says apOffset = -(apPositionMicrons / 1000) but
 *      Stage 1 plane widget uses position.z = -apPosition (raw µm). Using raw
 *      µm here to stay consistent with Stage 1 plane widget position.
 *   6. center = THREE.Vector3(0, 0, apOffset).
 *   7. Return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center).
 *
 * Args:
 *   pitch:             rotation about X axis, degrees [-90, 90]
 *   yaw:               rotation about Y axis, degrees [-90, 90]
 *   roll:              rotation about Z axis, degrees [-90, 90]
 *   apPositionMicrons: AP position in µm [-3000, 3000]
 * Returns:
 *   THREE.Plane with unit normal, consistent with the 3D plane widget position.
 */
function buildSlicePlane(pitch, yaw, roll, apPositionMicrons) {
  const THREE = window.THREE;
  const DEG2RAD = Math.PI / 180;

  // Build rotation matrix from Euler angles (order XYZ)
  const euler = new THREE.Euler(
    pitch * DEG2RAD,
    yaw   * DEG2RAD,
    roll  * DEG2RAD,
    'XYZ'
  );

  // Start with plane normal pointing along +Z (coronal plane at zero rotation)
  const normal = new THREE.Vector3(0, 0, 1);
  const rotMat = new THREE.Matrix4().makeRotationFromEuler(euler);
  normal.applyMatrix4(rotMat).normalize();

  // AP offset: raw µm → Three.js Z. Stage 1 convention: z = -apPosition.
  // Do NOT divide by 1000 — carry-forward constraint from task spec.
  const apOffset = -apPositionMicrons;
  const center = new THREE.Vector3(0, 0, apOffset);

  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center);
}

/**
 * Compute line segments where a triangle mesh intersects a THREE.Plane.
 *
 * For each triangle in the mesh geometry, tests which edges cross the plane
 * using signed distances. Crossing edges produce interpolated intersection
 * points; two such points per triangle form one line segment.
 *
 * edgeIntersect uses >= 0 positive-side convention (carry-forward from Stage 2,
 * fixing DEBUG_REPORT_2 M-01: Math.sign(0) returns 0 which caused degenerate
 * zero-length segments when a vertex lies exactly on the plane).
 *
 * Args:
 *   mesh:  THREE.Mesh with BufferGeometry; matrixWorld must be up-to-date.
 *   plane: THREE.Plane in world space.
 * Returns:
 *   Array of { start: THREE.Vector3, end: THREE.Vector3 } in world space.
 *   Empty array if no triangles intersect.
 */
function intersectMeshWithPlane(mesh, plane) {
  const THREE = window.THREE;
  const geo      = mesh.geometry;
  const posAttr  = geo.attributes.position;
  const index    = geo.index;
  const segments = [];

  const vertexCount = index ? index.count : posAttr.count;
  const triCount    = Math.floor(vertexCount / 3);

  /**
   * Test whether two vertices straddle the plane and, if so, push the
   * interpolated intersection point onto pts.
   * Straddling condition: signs differ, AND the degenerate case where both
   * distances are exactly zero (coplanar edge) is excluded.
   *
   * Uses >= 0 positive-side convention (DEBUG_REPORT_2 M-01 fix):
   *   s = d >= 0 ? 1 : -1
   * so d=0 is treated as positive-side, preventing duplicate vertex pushes.
   *
   * Args:
   *   v1, v2: THREE.Vector3 endpoints in world space
   *   d1, d2: signed distances from v1/v2 to plane
   *   pts:    accumulator array
   */
  function edgeIntersect(v1, v2, d1, d2, pts) {
    // Skip coplanar edges (both vertices on the plane)
    if (d1 === 0 && d2 === 0) return;
    // >= 0 positive-side convention: d=0 treated as positive, not as its own
    // Math.sign category. This prevents zero-length degenerate segments when
    // a vertex lies exactly on the plane.
    const s1 = d1 >= 0 ? 1 : -1;
    const s2 = d2 >= 0 ? 1 : -1;
    if (s1 === s2) return; // same side (or both zero already excluded above)
    const t = d1 / (d1 - d2);
    pts.push(new THREE.Vector3().lerpVectors(v1, v2, t));
  }

  for (let i = 0; i < triCount; i++) {
    // Vertex indices in the buffer — support both indexed and non-indexed geometry
    const ia = index ? index.getX(i * 3)     : i * 3;
    const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2;

    // Extract world-space positions (matrixWorld applied here)
    const vA = new THREE.Vector3()
      .fromBufferAttribute(posAttr, ia)
      .applyMatrix4(mesh.matrixWorld);
    const vB = new THREE.Vector3()
      .fromBufferAttribute(posAttr, ib)
      .applyMatrix4(mesh.matrixWorld);
    const vC = new THREE.Vector3()
      .fromBufferAttribute(posAttr, ic)
      .applyMatrix4(mesh.matrixWorld);

    // Signed distance from each vertex to the plane
    const dA = plane.distanceToPoint(vA);
    const dB = plane.distanceToPoint(vB);
    const dC = plane.distanceToPoint(vC);

    // Collect intersection points for all three edges
    const pts = [];
    edgeIntersect(vA, vB, dA, dB, pts); // edge AB
    edgeIntersect(vB, vC, dB, dC, pts); // edge BC
    edgeIntersect(vC, vA, dC, dA, pts); // edge CA

    // A proper crossing produces exactly 2 intersection points → 1 segment
    if (pts.length === 2) {
      segments.push({ start: pts[0], end: pts[1] });
    }
    // pts.length === 0 → triangle missed plane entirely (normal case, skip)
    // pts.length === 1 → plane grazed a single vertex (degenerate, skip)
    // pts.length === 3 → all three edges cross (shouldn't happen geometrically)
  }

  return segments;
}

/**
 * Compute intersections of all visible structure meshes with a plane.
 *
 * Filters to meshes where:
 *   - mesh.visible === true (respects user toggle state)
 *   - mesh.userData.acronym exists (excludes shell mesh, plane widget, ghosts)
 *
 * For each qualifying mesh with at least one intersection segment:
 *   - Computes centroid as the average of all segment midpoints
 *   - Returns metadata needed for 2D rendering and the structure list
 *
 * Output is sorted by group in the canonical order defined by GROUP_SORT_ORDER.
 *
 * Args:
 *   meshes: array of THREE.Mesh objects from the scene
 *   plane:  THREE.Plane in world space
 * Returns:
 *   Array of { acronym, name, color, group, segments, centroid: THREE.Vector3 }
 *   sorted by group order. Empty array if nothing intersects.
 */

// Canonical group ordering for consistent structure list display
const GROUP_SORT_ORDER = ['thalamus', 'cortex', 'fiber', 'hippocampus', 'subcortical'];

function computeAllIntersections(meshes, plane) {
  const THREE = window.THREE;
  const results = [];

  meshes.forEach(mesh => {
    // Filter: only visible structure meshes (skip shell, plane widget, ghosts)
    if (!mesh.visible) return;
    if (!mesh.userData || !mesh.userData.acronym) return;

    const segments = intersectMeshWithPlane(mesh, plane);
    if (segments.length === 0) return;

    // Compute centroid as average of all segment midpoints
    const centroid = new THREE.Vector3();
    segments.forEach(seg => {
      // Midpoint of each segment, accumulated into centroid
      centroid.x += (seg.start.x + seg.end.x) / 2;
      centroid.y += (seg.start.y + seg.end.y) / 2;
      centroid.z += (seg.start.z + seg.end.z) / 2;
    });
    centroid.divideScalar(segments.length); // average over all segment midpoints

    results.push({
      acronym:  mesh.userData.acronym,
      name:     mesh.userData.label  || mesh.userData.acronym,
      color:    mesh.userData.color  || '#888888',
      group:    mesh.userData.group  || 'subcortical',
      segments,
      centroid,
    });
  });

  // Sort by GROUP_SORT_ORDER; structures in unrecognized groups go last
  results.sort((a, b) => {
    const ai = GROUP_SORT_ORDER.indexOf(a.group);
    const bi = GROUP_SORT_ORDER.indexOf(b.group);
    const aOrd = ai === -1 ? 999 : ai;
    const bOrd = bi === -1 ? 999 : bi;
    return aOrd - bOrd;
  });

  return results;
}

/**
 * Generate an array of N evenly-spaced parallel plane configurations,
 * centered on the base AP position.
 *
 * All planes share the same pitch/yaw/roll. AP positions are offset by
 * integer multiples of thicknessMicrons, centered on baseApPosition.
 *
 * Args:
 *   basePitch:         pitch in degrees for all planes
 *   baseYaw:           yaw in degrees for all planes
 *   baseRoll:          roll in degrees for all planes
 *   baseApPosition:    center AP position in µm
 *   thicknessMicrons:  spacing between adjacent planes in µm
 *   count:             total number of planes to generate
 * Returns:
 *   Array of { pitch, yaw, roll, apPosition } length === count.
 *   Index floor(count/2) corresponds to baseApPosition when count is odd.
 */
function generateSlicePlanes(basePitch, baseYaw, baseRoll, baseApPosition, thicknessMicrons, count) {
  const planes = [];
  const halfCount = Math.floor(count / 2); // center offset index

  for (let i = 0; i < count; i++) {
    // Offset index relative to center: i - floor(count/2)
    const offsetIndex = i - halfCount;
    planes.push({
      pitch:      basePitch,
      yaw:        baseYaw,
      roll:       baseRoll,
      apPosition: baseApPosition + offsetIndex * thicknessMicrons,
    });
  }

  return planes;
}

// ---------------------------------------------------------------------------
// Preset Engine (applyPreset)
// INTERFACE_CONTRACTS.md §Module: Preset Engine
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
// Thickness stack constants
// ---------------------------------------------------------------------------
const THICKNESS_STACK_COUNT = Object.freeze({
  '350µm': 1,
  '400µm': 1,
  '1mm':   3,
  '2mm':   5,
  '4mm':   8,
  '6mm':   12,
});

const THICKNESS_TO_MICRONS = Object.freeze({
  '350µm': 350,
  '400µm': 400,
  '1mm':   1000,
  '2mm':   2000,
  '4mm':   4000,
  '6mm':   6000,
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function AllenAtlasStage4() {
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
    theta:  Math.PI / 6,
    phi:    Math.PI / 3,
    radius: 800,
  });

  // Active thickness pill label (e.g. '400µm')
  const [selectedThickness, setSelectedThickness] = useState('400µm');

  // Expanded state for RegionTogglePanel
  const [panelExpanded,  setPanelExpanded]  = useState(true);
  const [expandedGroups, setExpandedGroups] = useState({});

  // Slice result — null until Generate Slice is clicked
  const [sliceResult, setSliceResult] = useState(null);

  // Hover tooltip state — { x, y, name, group } | null
  const [tooltip, setTooltip] = useState(null);

  // Stage 4 Change C/D/E: scene readiness flag — mesh loading waits for scene init
  // Set to true at the end of the Three.js scene useEffect (before cleanup).
  const [sceneReady, setSceneReady] = useState(false);

  // Stage 4 Change E: mesh loading progress state
  // INTERFACE_CONTRACTS §MeshServer §Client Mesh Loading State Contract
  // total = CCF_STRUCTURES.length + 1 (for root mesh 997)
  const [meshLoadState, setMeshLoadState] = useState({ total: 0, loaded: 0, failed: 0 });

  // ---- Refs ---------------------------------------------------------------
  const mountRef        = useRef(null); // DOM node for Three.js canvas
  const axisCanvasRef   = useRef(null); // small axis indicator canvas
  const sliceCanvasRef  = useRef(null); // 2D cross-section canvas
  const meshMapRef      = useRef({});   // { [acronym]: THREE.Mesh }
  const shellRef        = useRef(null); // brain shell mesh (also used as shellMeshRef for root PLY)
  const planeRef        = useRef(null); // main slice plane widget mesh
  const planeEdgesRef   = useRef(null); // EdgesGeometry border lines for plane widget
  const rendererRef     = useRef(null);
  const sceneRef        = useRef(null);
  const cameraRef       = useRef(null);
  const frameRef        = useRef(null);

  // Accumulates structure meshes for intersection testing
  const structureMeshesRef  = useRef([]);
  // Ghost plane meshes for the thickness stack
  const slicePlaneGroupRef  = useRef([]);

  // Canvas overlay for 3D projected labels on highlighted structures
  const labelOverlayRef = useRef(null);

  // Stage 4: mutable ref tracking load state without triggering re-renders
  // on every increment. The React state is updated via setMeshLoadState for
  // UI sync; the ref is read/written in the async fetch callbacks.
  const meshLoadStateRef = useRef({ total: 0, loaded: 0, failed: 0 });

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

  // Highlight ref — read by animation loop and labelOverlay drawing code
  const highlightRef = useRef(highlightState);
  useEffect(() => { highlightRef.current = highlightState; }, [highlightState]);

  // Throttle for raycaster calls (max 20fps = 50ms between calls)
  const lastRaycastTime = useRef(0);

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
    // Stage 4 Change D: this ellipsoid is the fallback. The mesh loading
    // useEffect will replace its geometry with root mesh (997) after fetch.
    // shellRef is used by both Stage 3 rendering code and Stage 4 root PLY load.
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
    // Stage 4: ellipsoid geometry is the fallback. The mesh loading useEffect
    // replaces each mesh's BufferGeometry with the real Allen PLY geometry
    // in-place after a successful fetch. On failure it silently retains
    // the ellipsoid (SYSTEM_SPEC.md v2 §Stage 4 §Fallback contract).
    structureMeshesRef.current = [];
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
      mesh.renderOrder = 1;
      mesh.userData = {
        acronym: s.acronym,
        label:   s.label,
        color:   s.color,
        group:   s.group,
      };

      scene.add(mesh);
      meshMap[s.acronym] = mesh;
      structureMeshesRef.current.push(mesh);
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

    // --- EdgesGeometry border lines for the main plane widget ---
    const edgesGeo  = new THREE.EdgesGeometry(new THREE.PlaneGeometry(900, 700));
    const edgesMat  = new THREE.LineBasicMaterial({ color: '#4A90D9', linewidth: 1 });
    const planeEdges = new THREE.LineSegments(edgesGeo, edgesMat);
    planeEdges.renderOrder = 3;
    scene.add(planeEdges);
    planeEdgesRef.current = planeEdges;

    // --- Animation loop ---
    function animate() {
      frameRef.current = requestAnimationFrame(animate);

      // Reconcile visibility + highlight from refs (avoids stale closure)
      const vis  = visibilityRef.current;
      const hi   = highlightRef.current;
      const hiSet = new Set(hi.highlighted);

      Object.entries(meshMap).forEach(([acronym, mesh]) => {
        // Visibility — INTERFACE_CONTRACTS §BrainViewer: only .visible is set
        mesh.visible = vis[acronym] !== false;

        if (!mesh.visible) return;

        // Highlight reconciler — CR-04: only this one place sets renderOrder/opacity
        if (hiSet.has(acronym)) {
          mesh.renderOrder = 2;
          mesh.material.opacity = 0.92;
          const emissive = new THREE.Color(mesh.userData.color).multiplyScalar(0.25);
          mesh.material.emissive = emissive;
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

      // Update slice plane orientation from sliceStateRef
      const ss = sliceStateRef.current;
      if (planeRef.current) {
        planeRef.current.rotation.set(
          THREE.MathUtils.degToRad(ss.pitch),
          THREE.MathUtils.degToRad(ss.yaw),
          THREE.MathUtils.degToRad(ss.roll)
        );
        // AP position: Stage 1 convention = -apPosition (raw µm)
        planeRef.current.position.set(0, 0, -ss.apPosition);
      }

      if (planeEdgesRef.current) {
        planeEdgesRef.current.rotation.set(
          THREE.MathUtils.degToRad(ss.pitch),
          THREE.MathUtils.degToRad(ss.yaw),
          THREE.MathUtils.degToRad(ss.roll)
        );
        planeEdgesRef.current.position.set(0, 0, -ss.apPosition);
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
        const oc = overlayCanvas;
        const octx2 = oc.getContext('2d');
        octx2.clearRect(0, 0, oc.width, oc.height);
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

    // Stage 4 Change C: signal that scene + meshMapRef are fully initialised.
    // The mesh loading useEffect waits on [sceneReady] to avoid fetching before
    // meshMapRef.current is populated (timing gap: both useEffects run on mount
    // but scene init is synchronous within its own callback before cleanup).
    setSceneReady(true);

    // ---- Cleanup ----
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
  // Ghost plane stack — rebuild whenever sliceState or selectedThickness changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const THREE = window.THREE;
    if (!THREE || !sceneRef.current) return;
    const scene = sceneRef.current;

    // Dispose and remove all existing ghost planes
    slicePlaneGroupRef.current.forEach(ghost => {
      ghost.geometry.dispose();
      ghost.material.dispose();
      scene.remove(ghost);
    });
    slicePlaneGroupRef.current = [];

    const count      = THICKNESS_STACK_COUNT[selectedThickness] || 1;
    if (count <= 1) return;

    const stepMicrons = THICKNESS_TO_MICRONS[selectedThickness] || 400;
    const halfCount   = Math.floor(count / 2);

    for (let i = -halfCount; i <= halfCount; i++) {
      if (i === 0) continue;

      const ghostGeo = new THREE.PlaneGeometry(900, 700);
      const ghostMat = new THREE.MeshBasicMaterial({
        color:       '#4A90D9',
        opacity:     0.06,
        transparent: true,
        side:        THREE.DoubleSide,
        depthWrite:  false,
      });
      const ghost = new THREE.Mesh(ghostGeo, ghostMat);
      ghost.renderOrder = 3;

      ghost.rotation.set(
        THREE.MathUtils.degToRad(sliceState.pitch),
        THREE.MathUtils.degToRad(sliceState.yaw),
        THREE.MathUtils.degToRad(sliceState.roll)
      );
      // Do NOT divide by 1000 — carry-forward constraint
      ghost.position.set(
        0,
        0,
        -sliceState.apPosition + i * stepMicrons
      );

      scene.add(ghost);
      slicePlaneGroupRef.current.push(ghost);
    }
  }, [sliceState, selectedThickness]);

  // ---------------------------------------------------------------------------
  // Stage 4 Change C+D+E: Mesh loading useEffect
  //
  // Runs after sceneReady becomes true (i.e., after the Three.js scene useEffect
  // has completed, meshMapRef is fully populated, and shellRef is assigned).
  //
  // For each structure in CCF_STRUCTURES:
  //   1. Fetch JSON from mesh_server.py GET /mesh/{s.id}
  //   2. Apply ccfToThree transform to PLY vertices (client-side, per OD-08)
  //   3. Replace ellipsoid BufferGeometry in-place with PLY-derived geometry
  //   4. On any error: retain ellipsoid (FALLBACK), log warning, increment failed
  //
  // For root mesh (997, brain shell):
  //   - Replace shellRef.current geometry instead of meshMapRef geometry.
  //   - Total count includes root: structures.length + 1
  //
  // SYSTEM_SPEC.md v2 §Stage 4 §Mesh Loading State Machine
  // INTERFACE_CONTRACTS §MeshServer §Client Mesh Loading State Contract
  //
  // TIMEOUT: INTERFACE_CONTRACTS §MeshServer §Failure Modes requires a timeout
  // (minimum 10 seconds) to prevent indefinite loading overlay. Implemented
  // via AbortController with a 15-second timeout per fetch.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Wait until scene is initialised — meshMapRef must be populated
    if (!sceneReady) return;

    const BACKEND = 'http://localhost:8000';
    const structures = CCF_STRUCTURES;

    // total = structure count + 1 for root mesh (997)
    const totalCount = structures.length + 1;
    meshLoadStateRef.current = { total: totalCount, loaded: 0, failed: 0 };
    setMeshLoadState({ total: totalCount, loaded: 0, failed: 0 });

    /**
     * Apply the ccfToThree coordinate transform in-place to a flat Float32Array
     * of CCF vertices ([x0,y0,z0, x1,y1,z1, ...] where x=AP, y=DV, z=ML µm).
     *
     * Transform (SYSTEM_SPEC.md v2 §Stage 4 §Coordinate system for PLY vertices):
     *   threeX =  ccfZ - 5700    (ML → Three.js X)
     *   threeY = -(ccfY - 4000)  (DV → Three.js Y, flipped)
     *   threeZ = -(ccfX - 5700)  (AP → Three.js Z, flipped)
     *
     * Mutates the array in-place for allocation efficiency.
     */
    function applyCcfToThree(verts) {
      for (let i = 0; i < verts.length; i += 3) {
        const cx = verts[i];       // CCF AP (x)
        const cy = verts[i + 1];   // CCF DV (y)
        const cz = verts[i + 2];   // CCF ML (z)
        verts[i]     =  cz - 5700;   // Three.js X = ML - midline
        verts[i + 1] = -(cy - 4000); // Three.js Y = -(DV - 4000) — flipped
        verts[i + 2] = -(cx - 5700); // Three.js Z = -(AP - 5700) — flipped
      }
    }

    /**
     * Increment the loaded counter and sync React state.
     * Uses the ref to avoid race conditions across concurrent fetch callbacks.
     */
    function onLoaded() {
      meshLoadStateRef.current.loaded++;
      setMeshLoadState({ ...meshLoadStateRef.current });
    }

    /**
     * Increment the failed counter and sync React state.
     * Uses the ref to avoid race conditions across concurrent fetch callbacks.
     */
    function onFailed() {
      meshLoadStateRef.current.failed++;
      setMeshLoadState({ ...meshLoadStateRef.current });
    }

    /**
     * Fetch and apply real PLY geometry for a structure mesh.
     * Falls back silently to ellipsoid on any error.
     *
     * SYSTEM_SPEC.md v2 §Stage 4 §Fallback contract:
     *   fetch rejects → FALLBACK
     *   non-200 status → FALLBACK
     *   JSON parse throws → FALLBACK
     *   BufferGeometry construction throws → FALLBACK
     *
     * @param {number} structureId  Allen CCF integer ID
     * @param {string} acronym      Acronym for logging
     * @param {THREE.Mesh} targetMesh  The scene mesh to update in-place
     */
    function fetchAndApplyMesh(structureId, acronym, targetMesh) {
      const THREE = window.THREE;
      if (!THREE) return; // Three.js not available — skip silently

      // Timeout guard: INTERFACE_CONTRACTS §MeshServer §Failure Modes
      // "minimum 10 seconds" timeout to prevent indefinite loading overlay
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 15000); // 15 seconds — above the 10-second minimum from spec

      fetch(`${BACKEND}/mesh/${structureId}`, { signal: controller.signal })
        .then(r => {
          clearTimeout(timeoutId);
          if (!r.ok) {
            throw new Error(`HTTP ${r.status} for ${acronym} (id=${structureId})`);
          }
          return r.json(); // PARSING state
        })
        .then(data => {
          // BUILDING_GEOMETRY state
          if (!targetMesh) {
            // Mesh was removed between fetch start and callback — rare race condition
            throw new Error(`Target mesh for ${acronym} no longer exists`);
          }

          // Validate response shape per INTERFACE_CONTRACTS §MeshServer §Invariants
          if (!Array.isArray(data.vertices) || data.vertices.length === 0) {
            throw new Error(`Empty vertices array for ${acronym} (id=${structureId})`);
          }
          if (!Array.isArray(data.faces) || data.faces.length === 0) {
            throw new Error(`Empty faces array for ${acronym} (id=${structureId})`);
          }
          if (data.vertices.length % 3 !== 0) {
            throw new Error(
              `Malformed vertices (length ${data.vertices.length} not divisible by 3) `
              + `for ${acronym} (id=${structureId})`
            );
          }
          if (data.faces.length % 3 !== 0) {
            throw new Error(
              `Malformed faces (length ${data.faces.length} not divisible by 3) `
              + `for ${acronym} (id=${structureId})`
            );
          }

          // Apply ccfToThree transform client-side (OD-08 decision: client-side transform)
          // INTERFACE_CONTRACTS §MeshServer §Vertex Coordinate Contract
          const verts = new Float32Array(data.vertices);
          applyCcfToThree(verts); // mutates in-place

          // Build BufferGeometry from transformed vertices and int32 face indices
          // R-9: face indices are signed int32 (PLY 'int' = signed 32-bit)
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
          // Use Int32Array: PLY 'int' = signed int32. Three.js r128 setIndex accepts
          // Int32Array. Do NOT use Uint32Array (RESEARCH_BRIEF_STAGE4.md §7 R-9).
          geo.setIndex(new THREE.BufferAttribute(new Int32Array(data.faces), 1));
          // Recompute normals: server omits PLY normals to halve payload (R-5)
          geo.computeVertexNormals();

          // Replace ellipsoid geometry in-place.
          // INTERFACE_CONTRACTS §BrainViewer §Invariants: meshes remain in scene
          // for application lifetime — geometry swap is safe without scene re-add.
          // Dispose old geometry to free GPU memory.
          targetMesh.geometry.dispose();
          targetMesh.geometry = geo;

          onLoaded();
        })
        .catch(err => {
          clearTimeout(timeoutId);
          // FALLBACK: retain ellipsoid, log warning, increment failed count.
          // INTERFACE_CONTRACTS §MeshServer §Failure Modes:
          // "Client MUST NOT throw an unhandled exception on any fetch failure"
          console.warn(
            `Allen mesh unavailable for ${acronym} (id=${structureId}): `
            + `${err.message}. Using ellipsoid fallback.`
          );
          onFailed();
        });
    }

    // Fetch all structure meshes (CCF_STRUCTURES — excludes root)
    structures.forEach(s => {
      const targetMesh = meshMapRef.current[s.acronym];
      if (!targetMesh) {
        // Mesh not found in map (shouldn't happen if scene init completed)
        console.warn(
          `Mesh loading: acronym "${s.acronym}" not found in meshMapRef. Skipping.`
        );
        onFailed();
        return;
      }
      fetchAndApplyMesh(s.id, s.acronym, targetMesh);
    });

    // Stage 4 Change D: Fetch root mesh (997) to replace brain shell ellipsoid.
    // shellRef.current is the brain shell THREE.Mesh (renderOrder 0).
    // On success: replace its geometry with the real Allen root mesh.
    // On failure: retain scaled-sphere shell (no visual disruption).
    fetchAndApplyMesh(ROOT_MESH_ID, 'root', shellRef.current);

  // Depends only on sceneReady — runs once after scene is initialised
  }, [sceneReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Axis indicator — drawn on a 2D canvas overlay using cameraState
  // ---------------------------------------------------------------------------
  function drawAxisIndicator() {
    const canvas = axisCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
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

    const sinPhi   = Math.sin(phi);
    const cosPhi   = Math.cos(phi);
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    const rightX =  sinPhi * cosTheta;
    const rightY =  0;
    const rightZ = -sinPhi * sinTheta;
    const rightLen = Math.sqrt(rightX*rightX + rightY*rightY + rightZ*rightZ) || 1;

    const upX = -(cosPhi * sinTheta);
    const upY =  sinPhi;
    const upZ = -(cosPhi * cosTheta);
    const upLen = Math.sqrt(upX*upX + upY*upY + upZ*upZ) || 1;

    function projectAxis(ax, ay, az) {
      const screenX = (ax * rightX + ay * rightY + az * rightZ) / rightLen;
      const screenY = (ax * upX    + ay * upY    + az * upZ)    / upLen;
      return { sx: screenX, sy: -screenY };
    }

    const axes = [
      { vec: [1,0,0], color: '#E74C3C', label: 'R'  },
      { vec: [0,1,0], color: '#2ECC71', label: 'D'  },
      { vec: [0,0,1], color: '#3498DB', label: 'A'  },
    ];

    const projected = axes.map(a => {
      const { sx, sy } = projectAxis(...a.vec);
      const viewX = sinPhi * sinTheta;
      const viewY = cosPhi;
      const viewZ = sinPhi * cosTheta;
      const depth = a.vec[0]*viewX + a.vec[1]*viewY + a.vec[2]*viewZ;
      return { ...a, sx, sy, depth };
    });
    projected.sort((a, b) => a.depth - b.depth);

    projected.forEach(({ sx, sy, color, label }) => {
      const ex = CENTER + sx * LENGTH;
      const ey = CENTER + sy * LENGTH;

      ctx.beginPath();
      ctx.moveTo(CENTER, CENTER);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();

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
  // Slider change handler
  // ---------------------------------------------------------------------------
  const handleSliderChange = useCallback((field, rawValue) => {
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
  const THICKNESS_OPTIONS = [350, 400, 1000, 2000, 4000, 6000];
  const THICKNESS_LABELS  = ['350µm','400µm','1mm','2mm','4mm','6mm'];

  const handleThickness = useCallback((val, label) => {
    setSelectedThickness(label);
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
  // ---------------------------------------------------------------------------
  const handleToggleStructure = useCallback((acronym, checked) => {
    if (!CCF_BY_ACRONYM[acronym]) {
      console.warn(`RegionTogglePanel: unknown acronym "${acronym}"`);
      return;
    }
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

  // ---------------------------------------------------------------------------
  // Derived: check if all members of a group are visible (for group checkbox)
  // ---------------------------------------------------------------------------
  function isGroupChecked(groupName) {
    return (CCF_BY_GROUP[groupName] || []).every(a => visibilityState[a] !== false);
  }

  // ---------------------------------------------------------------------------
  // Generate Slice handler
  // ---------------------------------------------------------------------------
  const handleGenerateSlice = useCallback(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

    sceneRef.current.updateMatrixWorld(true);

    const plane = buildSlicePlane(
      sliceState.pitch,
      sliceState.yaw,
      sliceState.roll,
      sliceState.apPosition
    );

    const intersections = computeAllIntersections(structureMeshesRef.current, plane);

    setSliceResult({
      plane,
      intersections,
      thickness: selectedThickness,
      pitch:      sliceState.pitch,
      yaw:        sliceState.yaw,
      roll:       sliceState.roll,
      apPosition: sliceState.apPosition,
    });
  }, [sliceState, selectedThickness]);

  // ---------------------------------------------------------------------------
  // Export handlers
  // Stage 4 Change F: version bumped to '2.0', mesh_source field added
  // ---------------------------------------------------------------------------

  const handleExportPNG = useCallback(() => {
    if (!sliceCanvasRef.current) return;
    const url = sliceCanvasRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    const r = sliceResult;
    a.download = `slice_pitch${r.pitch}_yaw${r.yaw}_roll${r.roll}_${r.thickness.replace(/\s/g, '')}.png`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }, [sliceResult]);

  const handleExportConfig = useCallback(() => {
    if (!sliceResult) return;
    const thicknessMap = {
      '350µm': 350, '400µm': 400, '1mm': 1000,
      '2mm': 2000,  '4mm':  4000, '6mm': 6000,
    };
    const config = {
      tool:        'Allen Atlas Oblique Slice Planner',
      // Stage 4 Change F: version '2.0' — real PLY mesh geometry available
      version:     '2.0',
      // Stage 4 Change F: document mesh source for reproducibility
      mesh_source: 'Allen CCF v3 PLY (localhost:8000) with ellipsoid fallback',
      ccf_version: 'v3',
      slice_config: {
        pitch_deg:      sliceResult.pitch,
        yaw_deg:        sliceResult.yaw,
        roll_deg:       sliceResult.roll,
        ap_position_um: sliceResult.apPosition,
        thickness_um:   thicknessMap[sliceResult.thickness] ?? 400,
      },
      active_preset: highlightState.preset === 'tc'    ? 'thalamocortical'
                   : highlightState.preset === 'hippo' ? 'hippocampal'
                   : null,
      intersected_structures: sliceResult.intersections.map(ix => ({
        acronym: ix.acronym,
        name:    ix.name,
        group:   ix.group,
      })),
    };
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.download = `slice_config_${Date.now()}.json`;
    a.href     = url;
    a.click();
    URL.revokeObjectURL(url);
  }, [sliceResult, sliceState, highlightState]);

  // ---------------------------------------------------------------------------
  // Hover tooltip — raycaster on mousemove (throttled to 20fps)
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
      setTooltip({
        x:     e.clientX - rect.left + 12,
        y:     e.clientY - rect.top  - 20,
        name:  ud.name,
        group: ud.group,
      });
    } else {
      setTooltip(null);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // renderSlice2D — draw 2D cross-section onto sliceCanvasRef
  // Carry-forward from Stage 3: region fills, force-separation labels,
  // scale bar, orientation compass. Auto-fit bbox scale preserved exactly.
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
    for (let x = 0; x < W; x += 50) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 50) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    if (!sliceResult.intersections || sliceResult.intersections.length === 0) {
      ctx.font      = '11px "DM Mono", monospace';
      ctx.fillStyle = '#8A8078';
      ctx.textAlign = 'center';
      ctx.fillText('No structures intersected', W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }

    const normal = sliceResult.plane.normal;

    const up = Math.abs(normal.y) < 0.99
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);

    const uAxis = new THREE.Vector3().crossVectors(up, normal).normalize();
    const vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize();

    // --- Auto-fit bounding box (carry-forward constraint: do NOT replace this) ---
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    const allPts = [];
    sliceResult.intersections.forEach(intersection => {
      intersection.segments.forEach(seg => {
        ['start', 'end'].forEach(key => {
          const u =  seg[key].dot(uAxis);
          const v = -seg[key].dot(vAxis);
          allPts.push({ u, v });
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

    // --- Region fills (drawn before strokes) ---
    sliceResult.intersections.forEach(intersection => {
      if (intersection.segments.length === 0) return;

      const pts = [];
      intersection.segments.forEach(seg => {
        ['start', 'end'].forEach(key => {
          pts.push({
            u:  seg[key].dot(uAxis)  * SCALE + cx,
            v: -seg[key].dot(vAxis)  * SCALE + cy,
          });
        });
      });

      const centU = intersection.centroid.dot(uAxis)  * SCALE + cx;
      const centV = -intersection.centroid.dot(vAxis) * SCALE + cy;

      pts.sort((a, b) =>
        Math.atan2(a.v - centV, a.u - centU) -
        Math.atan2(b.v - centV, b.u - centU)
      );

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
      ctx.lineWidth   = 2;
      ctx.lineCap     = 'round';

      intersection.segments.forEach(seg => {
        const su = seg.start.dot(uAxis) * SCALE + cx;
        const sv = -seg.start.dot(vAxis) * SCALE + cy;
        const eu = seg.end.dot(uAxis)   * SCALE + cx;
        const ev = -seg.end.dot(vAxis)  * SCALE + cy;

        ctx.beginPath();
        ctx.moveTo(su, sv);
        ctx.lineTo(eu, ev);
        ctx.stroke();
      });
    });

    // --- Force-separation labels with leader lines ---
    ctx.font = 'bold 11px "DM Mono", monospace';

    const lb = sliceResult.intersections.map(intersection => {
      const cu = intersection.centroid.dot(uAxis)  * SCALE + cx;
      const cv = -intersection.centroid.dot(vAxis) * SCALE + cy;
      return {
        x: cu, y: cv,
        origX: cu, origY: cv,
        text:  intersection.acronym,
        color: intersection.color,
      };
    });

    const LABEL_MIN_DIST = 22;
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < lb.length; i++) {
        for (let j = i + 1; j < lb.length; j++) {
          const dx   = lb[j].x - lb[i].x;
          const dy   = lb[j].y - lb[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < LABEL_MIN_DIST && dist > 0) {
            const push = (LABEL_MIN_DIST - dist) / 2;
            const nx   = dx / dist;
            const ny   = dy / dist;
            lb[i].x -= nx * push;
            lb[i].y -= ny * push;
            lb[j].x += nx * push;
            lb[j].y += ny * push;
          }
        }
      }
    }

    lb.forEach(label => {
      const dispX = label.x - label.origX;
      const dispY = label.y - label.origY;
      const displaced = Math.sqrt(dispX * dispX + dispY * dispY);
      if (displaced > 3) {
        ctx.save();
        ctx.globalAlpha  = 0.5;
        ctx.strokeStyle  = label.color;
        ctx.lineWidth    = 0.5;
        ctx.beginPath();
        ctx.moveTo(label.origX, label.origY);
        ctx.lineTo(label.x, label.y);
        ctx.stroke();
        ctx.restore();
      }
    });

    lb.forEach(label => {
      const m = ctx.measureText(label.text);
      const lx = label.x;
      const ly = label.y;

      ctx.fillStyle = 'rgba(250,248,245,0.92)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(lx - 3, ly - 11, m.width + 6, 15, 3);
      } else {
        ctx.rect(lx - 3, ly - 11, m.width + 6, 15);
      }
      ctx.fill();

      ctx.fillStyle = label.color;
      ctx.fillText(label.text, lx, ly);
    });

    // --- Scale bar (1 mm) ---
    const barPx = 1000 * SCALE;
    const barX  = 12;
    const barY  = H - 14;

    ctx.save();
    ctx.strokeStyle = '#8A8078';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(barX, barY);
    ctx.lineTo(barX + barPx, barY);
    ctx.moveTo(barX,          barY - 3); ctx.lineTo(barX,          barY + 3);
    ctx.moveTo(barX + barPx,  barY - 3); ctx.lineTo(barX + barPx,  barY + 3);
    ctx.stroke();
    ctx.font      = '9px "DM Mono", monospace';
    ctx.fillStyle = '#8A8078';
    ctx.fillText('1 mm', barX + barPx / 2 - 12, barY - 4);
    ctx.restore();

    // --- Orientation compass ---
    const compX = W - 38;
    const compY = H - 38;
    const compR = 15;

    const yawRad  = (window.THREE && window.THREE.MathUtils)
      ? window.THREE.MathUtils.degToRad(sliceResult.yaw  || 0)
      : (sliceResult.yaw  || 0) * Math.PI / 180;
    const rollRad = (window.THREE && window.THREE.MathUtils)
      ? window.THREE.MathUtils.degToRad(sliceResult.roll || 0)
      : (sliceResult.roll || 0) * Math.PI / 180;

    const compassAxes = [
      { label: 'D', dx:  Math.sin(rollRad), dy: -Math.cos(rollRad) },
      { label: 'V', dx: -Math.sin(rollRad), dy:  Math.cos(rollRad) },
      { label: 'M', dx: -Math.cos(yawRad),  dy:  0                 },
      { label: 'L', dx:  Math.cos(yawRad),  dy:  0                 },
    ];

    ctx.save();
    ctx.font      = '9px "DM Mono", monospace';
    ctx.fillStyle = '#8A8078';
    compassAxes.forEach(a => {
      const ex = compX + a.dx * compR;
      const ey = compY + a.dy * compR;
      ctx.strokeStyle = '#8A8078';
      ctx.lineWidth   = 0.8;
      ctx.beginPath();
      ctx.moveTo(compX, compY);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillText(a.label, ex - 4, ey + 4);
    });
    ctx.restore();
  }

  // Re-render 2D canvas whenever sliceResult changes
  useEffect(() => {
    if (sliceResult) {
      setTimeout(() => renderSlice2D(), 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliceResult]);

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
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setTooltip(null)}
          />

          {/* Canvas overlay for 3D projected acronym labels */}
          <canvas
            ref={labelOverlayRef}
            style={{
              position:      'absolute',
              top:           0,
              left:          0,
              width:         '100%',
              height:        '100%',
              pointerEvents: 'none',
            }}
          />

          {/* Hover tooltip */}
          {tooltip && (
            <div style={{
              position:   'absolute',
              left:       tooltip.x,
              top:        tooltip.y,
              background: '#FAF8F5',
              border:     `1px solid ${T.border}`,
              borderRadius: 4,
              padding:    '4px 8px',
              fontFamily: T.fontMono,
              fontSize:   11,
              color:      T.text,
              pointerEvents: 'none',
              zIndex:     100,
              whiteSpace: 'nowrap',
              boxShadow:  '0 2px 8px rgba(0,0,0,0.08)',
            }}>
              <strong>{tooltip.name}</strong>
              <span style={{ color: T.textMuted, marginLeft: 6 }}>{tooltip.group}</span>
            </div>
          )}

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

                  {/* Individual structure rows */}
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

          {/* Stage 4 Change E: Loading progress overlay
              Visible while loaded + failed < total (i.e., fetches still in flight).
              Disappears automatically when all fetches complete (success or fallback).
              Positioned above the axis indicator (bottom: 48 to clear the 80px canvas).
              pointerEvents:none so it doesn't interfere with orbit controls.
              INTERFACE_CONTRACTS §MeshServer §Client Mesh Loading State Contract */}
          {meshLoadState.loaded + meshLoadState.failed < meshLoadState.total
            && meshLoadState.total > 0 && (
            <div style={{
              position:      'absolute',
              bottom:        48,
              right:         12,
              background:    'rgba(250,248,245,0.92)',
              border:        `1px solid ${T.border}`,
              borderRadius:  6,
              padding:       '5px 10px',
              fontFamily:    T.fontMono,
              fontSize:      10,
              color:         T.textMuted,
              pointerEvents: 'none',
              zIndex:        10,
            }}>
              Loading meshes… ({meshLoadState.loaded}/{meshLoadState.total})
              {meshLoadState.failed > 0 && ` · ${meshLoadState.failed} fallback`}
            </div>
          )}

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
                  <span style={{
                    fontFamily: T.fontMono,
                    fontSize:   11,
                    color:      T.text,
                    minWidth:   52,
                  }}>
                    {label}
                  </span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={sliceState[field]}
                    onChange={e => handleSliderChange(field, e.target.value)}
                    style={{ flex: 1 }}
                  />
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
                  const lbl    = THICKNESS_LABELS[i];
                  const active = selectedThickness === lbl;
                  return (
                    <button
                      key={val}
                      onClick={() => handleThickness(val, lbl)}
                      style={{
                        fontFamily:   T.fontMono,
                        fontSize:     11,
                        padding:      '5px 10px',
                        borderRadius: 20,
                        border:       `1px solid ${active ? 'transparent' : T.border}`,
                        background:   active ? T.accent : T.bg,
                        color:        active ? '#FFFFFF' : T.text,
                        cursor:       'pointer',
                        transition:   'background 0.15s, color 0.15s',
                      }}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ---- Divider ---- */}
          <div style={{
            height:     1,
            background: T.border,
            flexShrink: 0,
          }} />

          {/* ================================================================
              Slice Output Panel (bottom half)
          ================================================================ */}
          <div style={{
            flex:          '0 0 auto',
            minHeight:     200,
            padding:       16,
            display:       'flex',
            flexDirection: 'column',
            overflowY:     'auto',
          }}>

            {sliceResult === null ? (
              <>
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

                <button
                  onClick={handleGenerateSlice}
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
              </>
            ) : (
              <>
                {/* Upgraded slice title with parameter badges */}
                <div style={{
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'space-between',
                  marginBottom:   6,
                  flexWrap:       'wrap',
                  gap:            4,
                }}>
                  <span style={{
                    fontFamily:    T.fontMono,
                    fontSize:      10,
                    letterSpacing: '0.1em',
                    color:         T.textMuted,
                  }}>
                    SLICE PREVIEW
                  </span>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {highlightState.preset && (
                      <span style={{
                        fontFamily:   T.fontMono,
                        fontSize:     10,
                        background:   '#FDF6E3',
                        border:       `1px solid ${T.gold}`,
                        color:        T.gold,
                        borderRadius: 10,
                        padding:      '2px 7px',
                      }}>
                        {highlightState.preset === 'tc' ? 'Thalamocortical' : 'Hippocampal'}
                      </span>
                    )}
                    {[
                      ['P', sliceResult.pitch,     '°'],
                      ['Y', sliceResult.yaw,        '°'],
                      ['R', sliceResult.roll,        '°'],
                      ['T', sliceResult.thickness,   ''],
                    ].map(([k, v, u]) => (
                      <span key={k} style={{
                        fontFamily:   T.fontMono,
                        fontSize:     10,
                        background:   '#F0EDE6',
                        border:       `1px solid ${T.border}`,
                        color:        '#5A5450',
                        borderRadius: 10,
                        padding:      '2px 7px',
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
                    width:        '100%',
                    height:       '300px',
                    display:      'block',
                    borderRadius: 4,
                    border:       `1px solid ${T.border}`,
                    marginBottom: 12,
                    background:   '#FAF8F5',
                  }}
                />

                {/* Structure list header */}
                <div style={{
                  fontFamily:    T.fontMono,
                  fontSize:      10,
                  letterSpacing: '0.1em',
                  color:         T.textMuted,
                  marginTop:     12,
                  marginBottom:  6,
                }}>
                  INTERSECTED STRUCTURES ({sliceResult.intersections.length})
                </div>

                {sliceResult.intersections.length === 0 ? (
                  <div style={{
                    fontFamily: T.fontMono,
                    fontSize:   11,
                    color:      T.textMuted,
                    textAlign:  'center',
                    padding:    '16px 0',
                  }}>
                    No structures at this plane position.<br/>
                    Try adjusting A→P position or pitch.
                  </div>
                ) : (
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {sliceResult.intersections.map(ix => {
                      const isHighlighted = highlightState.highlighted.includes(ix.acronym);
                      const groupColor    = GROUP_COLORS[ix.group] || '#888';
                      return (
                        <div key={ix.acronym} style={{
                          display:    'flex',
                          alignItems: 'center',
                          gap:        8,
                          padding:    '4px 8px',
                          borderRadius: 4,
                          background: isHighlighted ? hexToRgba(ix.color, 0.07) : 'transparent',
                        }}>
                          <div style={{
                            width:        10,
                            height:       10,
                            borderRadius: '50%',
                            background:   ix.color,
                            flexShrink:   0,
                          }} />
                          <span style={{
                            fontFamily: T.fontMono,
                            fontWeight: 'bold',
                            fontSize:   11,
                            color:      ix.color,
                            minWidth:   52,
                          }}>
                            {ix.acronym}
                          </span>
                          <span style={{
                            fontFamily:   T.fontMono,
                            fontSize:     11,
                            color:        '#5A5450',
                            flex:         1,
                            overflow:     'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace:   'nowrap',
                          }}>
                            {ix.name}
                          </span>
                          <span style={{
                            fontFamily:   T.fontMono,
                            fontSize:     9,
                            background:   hexToRgba(groupColor, 0.15),
                            color:        groupColor,
                            borderRadius: 3,
                            padding:      '2px 6px',
                            flexShrink:   0,
                          }}>
                            {ix.group}
                          </span>
                          {isHighlighted && (
                            <span style={{ color: T.gold, fontSize: 10, flexShrink: 0 }}>
                              ★
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Export buttons */}
                <div style={{
                  display:   'flex',
                  gap:       8,
                  marginTop: 12,
                  padding:   '0 0 8px',
                }}>
                  <button
                    onClick={handleExportPNG}
                    style={{
                      flex:         1,
                      fontFamily:   T.fontMono,
                      fontSize:     11,
                      padding:      '7px 0',
                      borderRadius: 4,
                      cursor:       'pointer',
                      background:   '#FAF8F5',
                      border:       `1px solid ${T.accent}`,
                      color:        T.accent,
                    }}
                  >
                    Export PNG
                  </button>
                  <button
                    onClick={handleExportConfig}
                    style={{
                      flex:         1,
                      fontFamily:   T.fontMono,
                      fontSize:     11,
                      padding:      '7px 0',
                      borderRadius: 4,
                      cursor:       'pointer',
                      background:   T.accent,
                      border:       `1px solid ${T.accent}`,
                      color:        'white',
                    }}
                  >
                    Export Config
                  </button>
                </div>

                {/* Re-generate button */}
                <button
                  onClick={handleGenerateSlice}
                  style={{
                    width:        '100%',
                    marginTop:    4,
                    background:   T.accent,
                    color:        '#FFFFFF',
                    fontFamily:   T.fontSerif,
                    fontSize:     14,
                    fontWeight:   600,
                    padding:      '10px 0',
                    borderRadius: 6,
                    border:       'none',
                    cursor:       'pointer',
                    letterSpacing:'0.01em',
                  }}
                >
                  Re-generate Slice
                </button>
              </>
            )}

          </div>

        </div>
      </div>
    </>
  );
}
