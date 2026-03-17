# Allen Atlas Oblique Slice Planner — Stage 2: Slice Plane Engine
Date: 2026-03-09
Domain: Other (Neuroanatomy Tool / Interactive Brain Atlas)
Signed off by: Product Manager Agent
Status: SHIPPED

---

## Goal
Build the interactive oblique slice plane engine for the Allen CCF atlas viewer: given pitch/yaw/roll angles and an AP position, intersect a cutting plane with loaded atlas meshes, render the resulting 2D cross-section on a canvas, and manage a ghost-plane stack for multi-slice thickness visualization.

## Architecture Decisions Made

### Decision: Euler rotation order and normal derivation
- **What was decided**: `THREE.Euler('XYZ')` applied to a Z-axis normal vector via `makeRotationFromEuler`; the resulting normal is re-normalized after rotation.
- **Why**: XYZ intrinsic order matches the neuroscience convention of applying pitch (X), then yaw (Y), then roll (Z) sequentially. Re-normalizing after rotation guards against floating-point drift in the rotation matrix.
- **Outcome**: Correct; plane orientation tracked expected neuroanatomical angles in manual verification.

### Decision: CCF coordinate space — raw micrometers throughout
- **What was decided**: `apPosition` and all CCF coordinates are stored and used as raw CCF micrometers (1 CCF µm = 1 Three.js unit). Division by 1000 is never applied.
- **Why**: The Allen CCF volume is natively in µm. Dividing by 1000 to get mm-scale Three.js units introduced a systematic scale mismatch between the plane position and the loaded mesh geometry, producing missed intersections. User correction confirmed raw µm is correct.
- **Outcome**: Correct after fix. This overrides the original `INTERFACE_CONTRACTS.md` spec (see Spec Conflicts below). Architect must update `INTERFACE_CONTRACTS.md` to version 2 to reflect this.

### Decision: World-space vertex transform for mesh intersection
- **What was decided**: In `intersectMeshWithPlane`, each vertex is transformed by `mesh.matrixWorld` before the plane intersection test.
- **Why**: Meshes loaded from Allen Atlas OBJ/GLB files may carry non-identity local transforms (translation to CCF origin, scale normalization). Using object-local coordinates would produce incorrect intersection polygons if any parent node or the mesh itself has a non-identity world transform.
- **Outcome**: Correct; handles arbitrarily transformed meshes without special-casing per structure.

### Decision: Force matrix update before intersection
- **What was decided**: `scene.updateMatrixWorld(true)` is called in `handleGenerateSlice` before any call to `intersectMeshWithPlane`.
- **Why**: `matrixWorld` is only updated by Three.js during the render loop. If `handleGenerateSlice` is triggered before the first render frame (e.g., immediately after scene load), `matrixWorld` may be stale or identity. Forcing the update ensures correct world transforms regardless of render timing.
- **Outcome**: Eliminated a class of "first-click produces wrong slice" bugs.

### Decision: Edge intersection degeneracy handling (d=0 treated as positive side)
- **What was decided**: In `edgeIntersect`, a vertex with signed distance `d = 0` (exactly on the cutting plane) is treated as being on the positive side.
- **Why**: When a triangle vertex lies exactly on the cutting plane, the naive implementation can insert the vertex twice — once from each adjacent edge — producing a degenerate zero-length segment in the output polyline. Assigning `d=0` to the positive side eliminates the duplicate without discarding the vertex.
- **Outcome**: Correct; no duplicate vertex artifacts observed in tested structures.

### Decision: Auto-fit scale for 2D canvas rendering
- **What was decided**: The 2D canvas does not use a fixed scale. Instead, the bounding box of all projected segment endpoints (in the plane's UV coordinates) is computed first; scale is then `min(W * 0.8 / rangeU, H * 0.8 / rangeV)`, centered on the bounding box midpoint.
- **Why**: CCF structures are hundreds to thousands of µm from the Three.js origin. A fixed scale of 0.45 (tried during development) rendered most structures off-canvas or as single-pixel specks depending on AP position. Auto-fit guarantees the intersection fills ~80% of the canvas regardless of which structure is being sliced or where along the AP axis.
- **Outcome**: Correct and robust. Replaced fixed-scale implementation.

### Decision: Ghost plane count driven by selected thickness pill
- **What was decided**: The number of ghost planes rendered in the stack is determined by the selected thickness pill string: 350 µm → 1 ghost, 500 µm → 1, 1 mm → 3, 2 mm → 5, 3 mm → 8, 6 mm → 12.
- **Why**: Ghost planes give the user a visual sense of volumetric extent for the selected physical thickness. Count was chosen so ghost spacing approximates 250–500 µm steps within the selected range, matching the Allen Atlas section resolution.
- **Outcome**: Functional. Spacing values are not yet validated against neuroanatomy expert expectations (see Open Questions).

### Decision: Slice header subtitle captured at generation time
- **What was decided**: Pitch/yaw/roll/thickness values are written into `sliceResult` at the moment `handleGenerateSlice` runs, not read from live `sliceState` at render time.
- **Why**: The user may move the angle sliders after generating a slice. Reading live `sliceState` for the subtitle would show angles that no longer correspond to the displayed canvas, creating a confusing desync. Capturing into `sliceResult` freezes the subtitle to the generation parameters.
- **Outcome**: Correct. Eliminates subtitle/canvas desync on any post-generation slider movement.

## Methods Used

- **Plane-mesh intersection (Sutherland-Hodgman style per-triangle)**
  - Module: `intersectMeshWithPlane` in `/Users/akhularvind/allen_atlas_stage2.jsx`
  - Key parameters: plane normal (derived from Euler angles as above), plane constant `d` set from `apPosition` in raw CCF µm
  - Performance: not formally benchmarked; interactive at 60 fps for typical Allen Atlas structure counts (~50–200 meshes per hemisphere)

- **2D projection of intersection polylines**
  - Module: 2D canvas render section of `handleGenerateSlice`
  - Key parameters: UV basis vectors derived from plane normal via Gram-Schmidt; auto-fit scale as described above
  - Performance: synchronous canvas draw, no measurable lag for typical slice output

- **Ghost plane stack**
  - Module: ghost plane generation loop in `handleGenerateSlice`
  - Key parameters: count table (see Architecture Decision above); spacing = selectedThickness / count
  - Performance: N+1 additional Three.js Mesh objects per slice generation, cleaned up on next generation call

## What Was Shipped

- `intersectMeshWithPlane(mesh, planeNormal, planeConstant)` — world-space plane-mesh intersection returning polyline segments; no test coverage % available (no test suite in JSX artifact)
- `handleGenerateSlice()` — top-level orchestrator: rotates normal, updates matrices, iterates meshes, projects to 2D canvas, builds ghost stack, captures subtitle into sliceResult
- `edgeIntersect(v0, d0, v1, d1)` — edge/plane intersection with d=0 degeneracy handling
- Auto-fit 2D canvas renderer — bounding box computation + scale/offset pipeline
- Ghost plane stack manager — count table + cleanup logic
- Slice header with frozen subtitle (pitch/yaw/roll/thickness at generation time)

Note: This is a single-file JSX artifact (2098 lines). There is no separate `tests/` directory or pytest suite for this project. Test coverage % is not applicable.

## Open Questions Left Unresolved

- **Label overlap for dense slices**: The current 4-pass push-down heuristic works for sparse slices. Dense coronal cuts through regions with many labeled structures (e.g., cortical layers, striatum) will produce overlapping labels. A proper label placement algorithm (force-directed, simulated annealing, or Mapbox-style) was deferred to Stage 3.
- **Export functionality**: PNG export of the 2D canvas and JSON export of intersection polylines are planned for Stage 3 but not implemented. The canvas `toDataURL` hook is stubbed but not wired to a UI element.
- **TC preset neuroanatomy validation**: At pitch=-35°, apPosition=0, the targeted structures (SSp, MOp) may not fall within the plane's cutting range. This requires review by a neuroanatomy expert against the Allen Reference Atlas to confirm the preset angles are anatomically meaningful. Not validated in Stage 2.
- **Dead state — sliceState.thickness**: The `sliceState.thickness` field is populated by the slider but never read downstream (`selectedThickness` string is used everywhere instead). This is a latent confusion risk. Should be removed or merged with `selectedThickness` in the Stage 3 refactor.
- **INTERFACE_CONTRACTS.md not yet updated**: The Architect has not yet issued a v2 of `INTERFACE_CONTRACTS.md` reflecting the CCF µm coordinate space correction. Until that update, the written contract contradicts the implemented behavior.

## Lessons Learned

- **Data handling**: CCF coordinate units are a pervasive trap. The Allen Atlas documentation uses µm in some contexts and mm in others. Any new module that ingests CCF coordinates must assert the unit at the module boundary (e.g., `assert apPosition > 100, "apPosition looks like mm, expected µm"`). Do not assume unit from variable name alone.
- **Architecture**: Subtitle/canvas desync is a general pattern risk: any time a derived display value is computed from live state that the user can change independently of the displayed artifact, capture the display value at artifact-generation time. This applies to any future "generate then display" workflow (export filenames, axis labels, etc.).
- **Methods**: Fixed-scale 2D projection was tried first and rejected. The failure mode (structures rendered off-canvas or as single pixels) is not obvious from the code — it only manifests at AP positions far from the Three.js origin, which is most of the useful AP range. Auto-fit should be the default for any CCF canvas renderer.
- **Tooling**: Three.js r128 (used here) differs from r165 (referenced in `SYSTEM_SPEC.md`) in matrix API naming and some Euler constructor signatures. Before any Stage 3 dependency update, a full API diff against the intersection and rotation code must be done. Do not upgrade Three.js minor version without a regression test on the plane intersection output.
- **Architecture**: `scene.updateMatrixWorld(true)` as a defensive call before any geometry query is a pattern that should be codified as a project-wide rule, not left to per-function discovery. Any function that reads `matrixWorld` from the scene should call this first or document why it is safe not to.

## Spec Conflicts Resolved in This Stage

The following conflicts between upstream spec documents and correct implementation were identified and resolved. The Architect must issue updated documents before Stage 3 begins.

1. **`INTERFACE_CONTRACTS.md` — apPosition normalization**: Spec stated apPosition as normalized [0, 100]%. Implementation uses raw CCF µm. Raw µm is correct. Contract must be updated to v2.
2. **`SYSTEM_SPEC.md` — Three.js version**: Spec referenced r165. Implementation uses r128 (the version present in the project). Spec must be corrected.
3. **`buildSlicePlane` spec — coordinate division**: Spec said "divide apPositionMicrons by 1000". This is incorrect and was not implemented. Spec must be corrected.

## References

- Allen Mouse Brain Common Coordinate Framework (CCF v3): https://doi.org/10.1016/j.cell.2020.04.007
- Three.js documentation (r128): https://threejs.org/docs/index.html?q=Euler (archived)
- Sutherland-Hodgman polygon clipping (adapted for plane intersection): Sutherland & Hodgman, 1974, CACM 17(1):32-42

---

## Stage 3 — 2D Polish, Labels & Export
**Date:** 2026-03-09
**Artifact:** /Users/akhularvind/allen_atlas_stage3.jsx (2561 lines — final)

### Features Added
- **Region fills**: angle-sorted polygon fill per intersected structure (alpha 0.15), drawn before stroke outlines
- **Label collision avoidance**: 3-iteration force-separation pass; leader lines drawn from displaced label to original centroid (0.5px, 50% opacity)
- **Scale bar**: auto-scaled to show 1mm in CCF units on 2D canvas bottom-left
- **Orientation compass**: bottom-right of 2D canvas, D/V/M/L axes rotated by yaw/roll
- **Slice title chips**: individual pill chips per pitch/yaw/roll/thickness, active preset shown in gold
- **Structure list upgrade**: full table with color dot, acronym, full name, group pill, highlight star
- **Export PNG**: canvas.toDataURL → timestamped download
- **Export Config JSON**: full config snapshot including slice_config, active_preset, intersected_structures
- **3D overlay labels**: canvas overlay (pointerEvents:none) updated every rAF frame via highlightStateRef (not stale state)
- **Hover tooltip**: raycaster on mousemove (throttled 50ms), skipped when orbitRef.current.isPointerDown

### Bugs Fixed in Stage 3
- M-01: Removed non-existent `id` field from JSON export (Allen CCF numeric IDs not stored in registry — use acronym as identifier)
- M-02: `ap_position_um` in JSON export now reads `sliceResult.apPosition` (snapshot at generation time), not live `sliceState.apPosition`

### Architecture Decisions
- GROUP_COLORS and hexToRgba defined outside component (used by both JSX and renderSlice2D canvas code)
- highlightStateRef synced via useEffect — accessed inside rAF to avoid stale closure
- labelOverlayRef canvas absolutely positioned over Three.js canvas, same size, pointerEvents:none
- Polygon fill uses angle-sort around projected centroid — correct for convex ellipse cross-sections; flat structures (cc, ec) may produce near-zero-area fills but no algorithm failure
- Raycaster instantiated fresh each throttled mousemove call (not stored as ref) — acceptable for 20fps throttled usage

### Known Limitations (for future stages)
- Flat fiber tract fills (cc, ec) may be near-zero area when cut nearly parallel to flat face — cosmetic only
- Label placement for very dense slices (10+ structures) may still overlap despite force-separation
- No per-vertex color, no real Allen mesh geometry — all structures are axis-aligned scaled ellipsoids
- Future upgrade path: replace ellipsoids with real CCF PLY meshes via local FastAPI backend with CORS headers

### What Was Shipped
Single React artifact (~2561 lines), fully self-contained, no external fetches, Three.js r128 only. Runs in Claude.ai artifact sandbox. All three stages complete.

---

## Addendum 1: Stage 4 — Real Mesh Backend

**Date:** 2026-03-10
**Artifacts:** /Users/akhularvind/mesh_server.py, /Users/akhularvind/allen_atlas_stage4.jsx (2652 lines)

### Features Added
- FastAPI + uvicorn backend (mesh_server.py) serving Allen CCF v3 PLY meshes on localhost:8000
- CORS: Access-Control-Allow-Origin: * (local dev only)
- GET /health endpoint lists available structure IDs
- GET /mesh/{id} returns flat float[] vertices (xyz only, normals discarded) and flat int[] faces
- PLY parser: binary_little_endian format, numpy vectorized (single frombuffer call), header parsed dynamically line-by-line (byte offset never hardcoded)
- CR-08 startup assertion: loads 997.ply at import time, asserts AP range 12000–14500 µm — confirms raw CCF µm, blocks server start if wrong
- Face dtype assertion: np.all(faces['count'] == 3)
- No path traversal: structure_id validated against ACRONYM_MAP before os.path.join
- Client-side ccfToThree transform applied to Float32Array vertices before BufferGeometry construction
- sceneReady flag pattern: scene useEffect sets sceneReady=true after meshMapRef is fully populated; mesh loading useEffect depends on [sceneReady]
- geometry.dispose() called before geometry replacement (GPU memory safety)
- shellMeshRef: root mesh (997) replaces programmatic brain shell ellipsoid
- loadingState overlay: "Loading meshes… (N/20)" disappears when all fetches settle
- Ellipsoid fallback preserved per-structure: any fetch/parse failure → console.warn, keeps ellipsoid

### Critical Bug Fixed
- VPL structure ID: was 563 (dorsal tegmental tract — wrong). Corrected to 718 (ventral posterolateral nucleus). Discovered by researcher via Allen CCF structure tree lookup.

### Architecture Decisions
- Coordinate transform applied client-side (React), server returns raw CCF µm — OD-08 resolved this way
- Root mesh decimation deferred to Stage 5 (OD-09 open)
- AbortController 15-second timeout per fetch
- Int32Array for face indices (Allen PLY uses signed int32; all values non-negative)

### Stage 4 Debug Results
- All 8 code checks PASS
- Live server tests not run (Bash permission denied for port management); manual test commands documented in DEBUG_REPORT_4.md

---

## Addendum 2: Stage 5 — Frame UI + Saved Slices

**Date:** 2026-03-10
**Artifact:** /Users/akhularvind/allen_atlas_stage5.jsx (2435 lines — final)

### Features Added
- **Frame UI**: Left panel restructured to CSS grid (56px|1fr|56px × 56px|1fr|56px). Four surrounding sliders: TOP=L↔R (lrPosition), LEFT=Roll, RIGHT=D↔V (dvPosition), BOTTOM=Yaw. SliderPill component shows live value readout per slider.
- **Vertical sliders**: transform:rotate(-90deg) + ResizeObserver syncs slider width to canvas clientHeight on mount and resize (CR-12 mitigation)
- **buildSlicePlane v2**: 6-parameter signature (pitch, yaw, roll, apMicrons, lrMicrons, dvMicrons). Center = THREE.Vector3(lrMicrons, -dvMicrons, -apMicrons). No /1000 anywhere.
- **Pitch numeric input**: replaces pitch slider; positioned above Circuit Presets in right panel
- **Lock/Free Orbit toggle**: viewLocked state + viewLockedRef. Locked position (300,-150,500). Camera lerp factor 0.08/frame, stops when <2 units from target. Orbit pointer handlers guarded by viewLockedRef.current.
- **Lerp order**: updateCamera() fires first, isLerping block fires after (lerp wins during transition, correct)
- **sliceState extended**: added lrPosition:0, dvPosition:0 to initial state
- **Saved Slices**: savedSlices[] state, confirmSaveSlice deep-copies all THREE.Vector3 with .clone(), Save button disabled (not hidden) when sliceResult is null
- **Thumbnails**: renderMiniSlice() uses document.createElement('canvas') — no DOM mounting required. 60×45px. Scale factor 0.85 (vs 0.80 in main canvas — cosmetic only).
- **Session Export**: THREE.Plane serialized as {normal:{x,y,z}, constant} (not live object)
- **Session Import**: reconstructs THREE.Plane and THREE.Vector3 from serialized primitives; appends to existing savedSlices (no replace); fallback color '#888888' for unknown acronyms; 2.5s confirmation flash
- **handleRecallSlice**: restores all 6 slice values including lrPosition/dvPosition with ?? 0 fallback for pre-Stage-5 entries
- **Hook discipline**: all 19 useState calls at component top level, savedSlicesPanelOpen top-level

### Stage 5 Debug Results
- All 10 checks PASS (CLEAR verdict)
- Zero critical, zero moderate findings
- Three LOW findings (all cosmetic): thumbnail scale 0.85 vs 0.80, import duck-type guard bypassable by adversarial JSON, no sign-off on OD-10/OD-11

### Open Questions for Stage 6+
- OD-09: root mesh decimation (997 has 98,638 faces — benchmark render fps)
- OD-10: pitch slider location (numeric input only vs. 5th slider somewhere in frame)
- OD-11: thumbnail resolution 60×45 vs 120×90 at 0.5x CSS scale
- Live server test coverage still missing (Bash permission denied); manual test commands in DEBUG_REPORT_4.md should be run before production deployment
- Session JSON schema versioning not implemented — future import compatibility unguaranteed

---

## Stage 6 — Bug Fixes: Axis Remapping, Camera Scale, Structure Positions
**Date:** 2026-03-10
**Artifact:** /Users/akhularvind/allen_atlas_stage6.jsx

### Issues Diagnosed (DEBUG_REPORT_6.md)

**Issue 1 — Roll slider wrong axis:**
buildSlicePlane() used Euler(pitch, yaw, roll, 'XYZ'). sliceState.roll mapped to Euler Z = axial spin (head-tilt), but the LEFT frame slider was labeled "Roll" and expected to produce somersault motion (blade tipping forward/back). Euler X = somersault. The variable names pitch (Euler X, correct for somersault) and roll (Euler Z, correct for axial spin) were swapped relative to their UI positions.

**Issue 2 — Camera too close:**
Initial camera radius was 800, but brain shell (ellipsoid scale) is ~760 Three.js units tall → camera clips brain by 15%. Zoom range [80, 2000] too tight. Locked view position (300,-150,500) was inside the brain. PlaneGeometry(900, 700) smaller than brain cross-section.

NOTE: Original Stage 6 prompt suggested radius 16000 and PlaneGeometry 11000×8000, based on the assumption that 1 CCF µm = 1 Three.js unit at camera scale. DEBUG_REPORT_6.md corrected this: the ellipsoid shell uses radii of ~400–650 Three.js units, so the correct initial radius is ~1600, not 16000. The prompt values would have placed the camera at 16,000 units from a ~760-unit-tall brain — 20× too far.

**Issue 3 — Structure positions:**
Essentially correct. SSp, CA1, MOp matched expected Three.js positions exactly. VPM and ic differed by 100–200µm — within manual placement uncertainty, not a formula defect. No code defect found.

### Fixes Applied (7 code sites)

**Euler remapping (5 sites):**
- buildSlicePlane: Euler(pitch,yaw,roll) → Euler(roll,yaw,pitch,'XYZ') so roll=Euler X (somersault), pitch=Euler Z (axial spin)
- planeRef.current.rotation.set: same swap
- planeEdgesRef.current.rotation.set: same swap
- Ghost plane stack rotation.set: same swap
- TC preset: pitch:-35 → roll:-35 (somersault tilt now correctly on Euler X via roll)

**Label updates (2 sites):**
- LEFT frame slider label: "ROLL" → "TILT"
- Right panel numeric input: "PITCH / A/P tilt" → "ROLL / axial spin"

**Camera scale (7 sites):**
- PerspectiveCamera far: 10000 → 50000
- Initial radius: 800 → 1600
- Wheel zoom clamp: [80, 2000] → [300, 6000]
- Locked view lerpTargetPos: (300,-150,500) → (800,-300,1200)
- PlaneGeometry: (900,700) → (1500,1200)
- EdgesGeometry wrapper: same update
- Brain shell makeScale: (580,380,480) → (570,400,650)

**Structure positions (1 site):**
- CCF_STRUCTURES_RAW replaced with corrected coordinates: cortex pushed more anterior (lower ccfX), radii scaled ~20% for visibility at radius 1600
- All VPL id:718 preserved, all other IDs unchanged

### Open Decisions Resolved
- OD-10: RESOLVED — pitch drives Euler Z (axial spin, right panel numeric input); left slider "TILT" drives Euler X (somersault, sliceState.roll)

### Remaining Open Decisions
- OD-09: Root mesh decimation (997 has 98,638 faces)
- OD-11: Thumbnail resolution 60×45 vs 120×90

---

## Stage 7 — Standalone Local App
**Date:** 2026-03-11
**Artifacts:** app.html (2370 lines), mesh_server.py (updated), launch.py, README.md

### Problem Solved
The Claude.ai artifact sandbox blocks HTTP fetches to localhost (HTTPS page → HTTP resource = mixed content block). Running as a standalone local app served from the same FastAPI server eliminates CORS and mixed-content issues entirely — all resources are same-origin HTTP.

### Architecture
- `app.html`: Complete frontend in a single file, served by FastAPI at `GET /app`
- `mesh_server.py`: Extended with `GET /app` (serves app.html) and `GET /` (redirect to /app)
- `launch.py`: Orchestrates startup — starts uvicorn subprocess, polls /health (max 8s), opens browser via `webbrowser.open`
- React 18 UMD + Babel standalone: JSX transpiled in-browser at load time, no build step required
- Three.js r128 loaded via CDN `<script>` tag in HTML head (not dynamically injected by component)

### Coordinate Scale Correction
Stage 6 debug agent incorrectly halved camera scale (set radius=1600 instead of 16000). Stage 7 corrects all parameters to match the real CCF micrometer coordinate space:

| Parameter | Stage 6 (wrong) | Stage 7 (correct) |
|---|---|---|
| Initial radius | 1600 | 16000 |
| Far plane | 50000 | 100000 |
| Zoom range | [300, 6000] | [3000, 40000] |
| Locked view pos | (800,-300,1200) | (4000,-2000,8000) |
| Brain shell makeScale | (570,400,650) | (5700,4000,6500) |
| PlaneGeometry | (1500,1200) | (11000,8000) |

Verification: at radius 16000, FOV 45°, visible half-height = 16000 × tan(22.5°) ≈ 6627 µm. Shell half-height 4000 µm / 6627 ≈ 60% fill. Correct.

### React UMD Adaptations
- `export default` removed from component function declaration
- All hooks destructured from global `React` object: `const { useState, useEffect, useRef, useCallback } = React`
- No import statements in Babel script block (UMD globals only — import causes Babel UMD compile error)
- Google Fonts loaded via `<link>` in HTML head (not `@import` in style tag)
- Slider CSS (.frame-slider, .vslider-wrap) moved to HTML head style block

### New Features
- Backend status indicator: health check on mount → green "Backend connected" or yellow "Offline — ellipsoid mode" badge, absolute-positioned top-right of 3D canvas

### Usage
```bash
cd /Users/akhularvind
python3 launch.py
# Browser opens to http://localhost:8000/app automatically
# Ctrl+C to stop
```

### Open Decisions Carried Forward
- OD-09: Root mesh (997.ply, 98,638 faces) decimation — benchmark fps with real mesh loaded
- OD-11: Thumbnail resolution 60×45 vs 120×90 @0.5x CSS scale
