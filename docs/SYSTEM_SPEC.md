# System Specification — Allen Atlas Oblique Slice Planner

Version: 3  |  Date: 2026-03-10  |  Changed: Stage 5 Addendum — Frame UI (CSS grid specimen stage), sliceState v2 (lrPosition, dvPosition), buildSlicePlane v2 signature, viewLocked camera mode, savedSlices feature, thumbnail generation, session persistence, Module 11 SavedSlicesPanel, Module 12 FrameSliders, coupling risks CR-11/12/13, open decisions OD-10/11.

---

## 1. Problem Statement

Neuroscientists preparing oblique vibratome sections of mouse brain need a rapid,
interactive tool to predict which anatomical structures a physical cut will capture
before committing to a tissue preparation. This tool renders a 3D model of the Allen
Mouse Brain Common Coordinate Framework (CCF v3) using hardcoded ellipsoid
approximations of major structures, allows the researcher to position and orient a
virtual slicing plane in three rotational degrees of freedom plus anterior-posterior
translation, and produces a 2D cross-sectional preview alongside a ranked list of
intersected structures — all running client-side in a browser with no server
dependency.

---

## 2. System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  BROWSER (single-page, client-side only)                                    │
│                                                                             │
│  ┌─── CCF_STRUCTURES (static registry) ──────────────────────────────────┐ │
│  │  Hardcoded JSON: acronym → { color, group, axes, center }             │ │
│  │  Built once at module load; never mutated                             │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│            │                                                                │
│            │ build ellipsoid meshes (startup only)                         │
│            ▼                                                                │
│  ┌─── Three.js Scene ──────────────────────────────────────────────────── ┐ │
│  │  Shell mesh (renderOrder 0)                                            │ │
│  │  Structure meshes[] (renderOrder 1)                                   │ │
│  │  Highlighted meshes[] (renderOrder 2)                                 │ │
│  │  SlicePlaneWidget mesh (renderOrder 3)                                │ │
│  └─────────────────────────────────────────────────────────────────────── ┘ │
│            │                           ▲                                    │
│            │ renderer.render()         │ mesh.visible / renderOrder         │
│            ▼                           │ updates from state                 │
│  ┌─── BrainViewer ─────────────────────┼──────────────────────────────── ┐ │
│  │  Three.js WebGL canvas (60% width)  │                                 │ │
│  │  Manual orbit (pointer events)      │                                 │ │
│  │  AxisIndicator (bottom-left corner) │                                 │ │
│  │  RegionTogglePanel overlay (top-left, collapsible)                    │ │
│  └─────────────────────────────────────────────────────────────────────── ┘ │
│                                        │                                    │
│            ┌───────────────────────────┘                                    │
│            │ sliceState changes (pitch/yaw/roll/apPosition/thickness)       │
│            ▼                                                                │
│  ┌─── ControlsPanel (right 40%, top half) ────────────────────────────── ┐ │
│  │  Sliders: pitch, yaw, roll, AP position, thickness                    │ │
│  │  Preset buttons → applyPreset()                                       │ │
│  └─────────────────────────────────────────────────────────────────────── ┘ │
│            │                                                                │
│            │ sliceState → computeSlice() → sliceResult                     │
│            ▼                                                                │
│  ┌─── SliceOutputPanel (right 40%, bottom half) ──────────────────────── ┐ │
│  │  2D HTML Canvas: colored cross-section segments                       │ │
│  │  Structure list: acronym, color swatch, group label                   │ │
│  └─────────────────────────────────────────────────────────────────────── ┘ │
└─────────────────────────────────────────────────────────────────────────────┘

State flow (read-only arrows = read; write arrows = mutate):

  userInteraction ──write──► cameraState ──read──► renderer (every frame)
  userInteraction ──write──► sliceState  ──read──► buildPlane() ──► SlicePlaneWidget
                                          ──read──► computeSlice() ──► sliceResult
  userInteraction ──write──► visibilityState ──read──► mesh.visible (every frame)
  userInteraction ──write──► highlightState  ──read──► mesh.renderOrder + opacity
  applyPreset()   ──write──► sliceState, highlightState (atomic)
```

---

## 3. Module Inventory

### 3.1 CCF_STRUCTURES Registry

| Field        | Value                                                          |
|--------------|----------------------------------------------------------------|
| Purpose      | Single source of truth for all brain structure definitions.    |
|              | Maps structure acronym to geometry parameters, display color,  |
|              | and group membership. Read-only after module load.             |
| Inputs       | None (hardcoded at build time)                                 |
| Outputs      | Record per structure: { acronym, label, group, color (hex),    |
|              |   center_ccf: [x,y,z], semi_axes: [a,b,c], euler_ccf: [rx,ry,rz] } |
| Dependencies | None                                                           |

### 3.2 BrainViewer

| Field        | Value                                                          |
|--------------|----------------------------------------------------------------|
| Purpose      | Owns the Three.js WebGL renderer and scene. Handles orbit      |
|              | camera input, delegates mesh visibility and renderOrder updates |
|              | from upstream state, and renders every animation frame.        |
| Inputs       | cameraState (read), visibilityState (read), highlightState     |
|              | (read), sliceState (read, for SlicePlaneWidget position)       |
| Outputs      | Rendered pixels to canvas; fires cameraState updates on orbit  |
| Dependencies | Three.js scene (owns it), CCF_STRUCTURES (mesh construction),  |
|              | ccfToThree() coordinate transformer                            |

### 3.3 RegionTogglePanel

| Field        | Value                                                          |
|--------------|----------------------------------------------------------------|
| Purpose      | Collapsible overlay (positioned top-left of BrainViewer        |
|              | canvas) containing per-group and per-structure toggles.        |
|              | Writes to visibilityState and groupVisibility only;            |
|              | never touches Three.js objects directly.                       |
| Inputs       | visibilityState (read for checkbox sync), groupVisibility (read)|
| Outputs      | Writes: visibilityState[acronym], groupVisibility[group]       |
| Dependencies | toggleGroup() utility (provided by BrainViewer bridge)         |

### 3.4 AxisIndicator

| Field        | Value                                                          |
|--------------|----------------------------------------------------------------|
| Purpose      | Fixed-size XYZ RGB axes gizmo rendered in the bottom-left      |
|              | corner of the BrainViewer canvas. Mirrors camera orientation   |
|              | so the researcher always knows which anatomical axis is facing  |
|              | toward them.                                                    |
| Inputs       | cameraState.theta, cameraState.phi (read each frame)           |
| Outputs      | Rendered axis arrows (canvas overlay or separate small canvas) |
| Dependencies | BrainViewer (shares or mirrors camera quaternion)              |

### 3.5 ControlsPanel

| Field        | Value                                                          |
|--------------|----------------------------------------------------------------|
| Purpose      | Right 40% of viewport, top half. Exposes five sliders (pitch,  |
|              | yaw, roll, AP position, thickness) and preset buttons.         |
|              | Writes exclusively to sliceState and highlightState.           |
|              | Never reads from sliceResult or the Three.js scene.            |
| Inputs       | sliceState (read for slider sync), highlightState (read)       |
| Outputs      | Writes: sliceState (all five fields), highlightState           |
| Dependencies | applyPreset() for preset buttons                               |

### 3.6 SliceOutputPanel

| Field        | Value                                                          |
|--------------|----------------------------------------------------------------|
| Purpose      | Right 40% of viewport, bottom half. Renders 2D cross-section   |
|              | onto an HTML Canvas element and displays a sorted list of       |
|              | intersected structure names with color swatches. Pure display; |
|              | no writes to any shared state.                                 |
| Inputs       | sliceResult (read), visibilityState (read, to filter display)  |
| Outputs      | Painted 2D canvas; DOM list of { acronym, color, group }       |
| Dependencies | None beyond sliceResult                                        |

### 3.7 Intersection Engine (computeSlice)

| Field        | Value                                                          |
|--------------|----------------------------------------------------------------|
| Purpose      | Pure function. Given the current slicing plane and the set of  |
|              | currently visible ellipsoid parameters, computes the           |
|              | cross-sectional ellipse (or empty) for each structure and      |
|              | returns segment data for 2D rendering.                         |
| Inputs       | sliceState: { pitch, yaw, roll, apPosition, thickness },       |
|              | visibleMeshes: array of structure records from CCF_STRUCTURES   |
| Outputs      | sliceResult: { intersections: [{ acronym, color,               |
|              |   segments: [{ x, y }], centroid: { x, y } }] }               |
| Dependencies | buildPlane(), ccfToThree() (coordinate helpers)                |

### 3.8 Coordinate Utilities

| Field        | Value                                                          |
|--------------|----------------------------------------------------------------|
| Purpose      | Stateless helper functions for coordinate-space transformations.|
|              | CCF v3 uses a right-handed (AP, DV, ML) atlas space; Three.js  |
|              | uses a right-handed Y-up world space. All axis remapping is    |
|              | contained here so no other module embeds axis assumptions.     |
| Inputs       | Raw CCF (x,y,z) coordinates in micrometers                     |
| Outputs      | THREE.Vector3 in Three.js scene units                          |
| Dependencies | Three.js (THREE.Vector3 only)                                  |

### 3.9 Preset Engine (applyPreset)

| Field        | Value                                                          |
|--------------|----------------------------------------------------------------|
| Purpose      | Maps named preset identifiers ('tc', 'hippo') to a specific    |
|              | sliceState configuration and a highlightState. Applied         |
|              | atomically: both states are updated in the same synchronous    |
|              | call so the UI never shows a half-applied preset.              |
| Inputs       | presetName: 'tc' | 'hippo', setSliceState callback,            |
|              | setHighlightState callback                                     |
| Outputs      | Calls setSliceState(newSliceState), setHighlightState(newHS)   |
| Dependencies | None beyond the two setter callbacks                           |

---

## 4. Technology Stack

| Concern            | Choice                    | Version / Notes                        |
|--------------------|---------------------------|----------------------------------------|
| Rendering          | Three.js                  | r165 (pinned)                          |
| Language           | JavaScript (ES2022)       | No TypeScript requirement unless added |
| Build              | [OPEN DECISION — see §7]  | Vite 5.x or single-file HTML bundle    |
| UI framework       | [OPEN DECISION — see §7]  | Vanilla JS or React 18 for panel state |
| 2D canvas          | HTML5 Canvas API          | Native browser, no extra library       |
| CCF data           | Hardcoded JS module        | Ellipsoid params derived from CCF v3   |
| CSS layout         | CSS Grid / Flexbox         | No CSS framework dependency            |
| Testing            | [OPEN DECISION — see §7]  | Vitest or Jest for pure-function units |

---

## 5. Scalability Constraints

| Constraint          | Limit / Budget                                                  |
|---------------------|-----------------------------------------------------------------|
| Structure count     | CCF v3 has ~1,300 named regions; this tool targets the ~40-80   |
|                     | major structures that are experimentally actionable. Full atlas |
|                     | coverage is out of scope for version 1.                         |
| Frame budget        | 60 fps target; orbit and slider updates must not drop below     |
|                     | 30 fps on a mid-range laptop GPU (integrated Intel Iris or      |
|                     | equivalent)                                                     |
| computeSlice budget | Must complete in < 16 ms for the target structure count so      |
|                     | it can run synchronously on every slider change without a       |
|                     | dedicated worker thread                                         |
| Memory ceiling      | Entire page must load and run in < 256 MB browser heap; no      |
|                     | volumetric NIfTI/NRRD data is loaded at runtime                 |
| Bundle size         | Target < 2 MB transferred (Three.js ~600 kB gzipped + app);    |
|                     | no lazy loading required for the target structure count         |
| Offline operation   | Must run from file:// or a plain static HTTP server with no     |
|                     | external network calls at runtime                               |

---

## 6. Coupling Risk Register

### CR-01: Coordinate-axis convention shared implicitly across modules
**Risk level**: HIGH
**Description**: CCF v3 uses (AP, DV, ML) in micrometers; Three.js expects Y-up
world space. If any module outside `ccfToThree()` embeds an axis-remapping
assumption, a sign flip or axis swap in one place will corrupt 3D positions and
slice geometry simultaneously, producing silent wrong results.
**Mitigation**: All axis remapping is contained exclusively in `ccfToThree()`. No
other module is permitted to apply any axis permutation or sign change to CCF
coordinates. The interface contract for `ccfToThree` must be tested with a known
CCF landmark (e.g., bregma at CCF [5400, 0, 5700] µm).

### CR-02: Tight temporal coupling between sliceState and SlicePlaneWidget
**Risk level**: HIGH
**Description**: BrainViewer reads sliceState to position the 3D plane widget on
every render frame, and computeSlice also reads sliceState to produce sliceResult.
If BrainViewer caches a stale copy of sliceState while computeSlice uses the
current copy, the visible plane widget and the 2D output will be out of sync.
**Mitigation**: Both BrainViewer and computeSlice must read from the same
authoritative sliceState reference — no copying or destructuring that produces
divergent snapshots. sliceState is treated as a single immutable snapshot per
render frame.

### CR-03: visibilityState drives both mesh.visible and computeSlice filtering
**Risk level**: MEDIUM
**Description**: The same visibilityState object is consumed by BrainViewer
(mesh.visible) and by computeSlice (which structures to intersect). If these two
consumers read visibilityState at different moments within a single interaction
event, a structure could appear visible in 3D but absent from the 2D output or
vice versa.
**Mitigation**: visibilityState must be frozen (Object.freeze or equivalent) per
render cycle. Both consumers receive the same snapshot within the same event
dispatch. RegionTogglePanel writes a new snapshot atomically; it never mutates
individual fields of an in-use snapshot.

### CR-04: renderOrder / opacity coupling to highlightState
**Risk level**: MEDIUM
**Description**: Highlighted structures require renderOrder 2 and opacity 0.92;
standard structures require renderOrder 1 and opacity 0.70; the shell requires
renderOrder 0. If multiple code paths write renderOrder (e.g., a preset and a
manual toggle conflict), Z-fighting and transparency artifacts will occur.
**Mitigation**: renderOrder and opacity are derived exclusively from
highlightState in a single, centralized mapping function. No component writes
renderOrder directly to a mesh; only the mapping function does.

### CR-05: applyPreset atomicity
**Risk level**: MEDIUM
**Description**: applyPreset writes both sliceState and highlightState. If the two
setter callbacks are dispatched in separate microtasks (e.g., in a React
useReducer with async middleware), the UI may render one frame with a new
sliceState but old highlightState, producing a flash or incorrect 2D output.
**Mitigation**: applyPreset must call both setters synchronously within the same
event handler invocation. No await, no setTimeout between the two calls. The
interface contract for applyPreset must specify synchronous-only execution.

### CR-06: AxisIndicator camera state sharing
**Risk level**: LOW
**Description**: AxisIndicator needs the camera's current quaternion or (theta,
phi) to orient its gizmo. If it holds a reference to the Three.js camera object
rather than reading from cameraState, it bypasses the cameraState abstraction and
creates a direct Three.js dependency in what should be a display-only component.
**Mitigation**: AxisIndicator must receive cameraState as a prop/parameter, not a
camera object reference. The BrainViewer extracts theta/phi from the camera and
writes them to cameraState before AxisIndicator reads.

### CR-07: computeSlice performance on slider drag
**Risk level**: LOW
**Description**: computeSlice is called on every slider change event (mousemove /
input event). For structure counts up to ~80, synchronous execution is acceptable.
If structure count grows beyond ~200, this will cause slider lag.
**Mitigation**: The < 16 ms budget for computeSlice (§5) is enforced by the
Chaos Engineer during testing. If structure count exceeds 80, debouncing with a
4 ms delay is the approved mitigation before considering a Web Worker migration.

---

## 7. Open Decisions

### OD-01: Build system and deployment target [OPEN DECISION]
Is this a single self-contained HTML file (no build step, sharable by email/USB),
or a Vite-bundled project with npm? Single-file deployment is strongly preferred
for neuroscience lab use, but requires either a CDN import map for Three.js or
inlining. This decision affects the entire module import strategy.
**Requires human sign-off before coding begins.**

### OD-02: UI framework for panel state management [OPEN DECISION]
ControlsPanel and RegionTogglePanel require reactive state updates (slider values
reflected in input elements, checkboxes synced to visibilityState). Should these
use vanilla JS with manual DOM updates, or a lightweight reactive framework (React
18, Preact, Solid.js)? The choice affects how atomicity of applyPreset (CR-05) is
enforced and how sliceState/highlightState snapshots are managed.
**Requires human sign-off before coding begins.**

### OD-03: Exact CCF structures to include in version 1 [OPEN DECISION]
The spec calls for ~40-80 major structures. The specific list (acronyms, ellipsoid
parameters, group assignments) must be reviewed and approved by a domain expert
before the CCF_STRUCTURES registry is locked. Incorrect ellipsoid parameters are
a silent data error — they produce plausible-looking but anatomically wrong
cross-sections.
**Requires human sign-off (domain expert review of structure list and ellipsoid
parameters) before coding begins.**

### OD-04: Ellipsoid parameterization source [OPEN DECISION]
Ellipsoid semi-axes and centers can be derived from (a) manual measurement against
the CCF reference atlas, (b) bounding-box fitting on CCF segmentation masks, or
(c) a published approximation. Method (b) would require a one-time Python script
run against the Allen SDK volumetric data. The accuracy of computeSlice depends
entirely on these parameters.
**Requires human sign-off on derivation method before CCF_STRUCTURES is coded.**

### OD-05: 2D canvas coordinate system for SliceOutputPanel [OPEN DECISION]
The 2D cross-section can be rendered in (a) CCF slice-plane coordinates
(anatomically scaled, preserving aspect ratio), or (b) normalized canvas
coordinates (fills the panel regardless of plane orientation). Choice (a) is more
anatomically meaningful; choice (b) is simpler to implement but distorts structures
at oblique angles.
**Requires human sign-off.**

### OD-06: Preset definitions — exact angle and position values [OPEN DECISION]
The preset names 'tc' (thalamocortical) and 'hippo' (hippocampal) imply specific
pitch/yaw/roll/apPosition values that produce surgically correct cut angles. These
values must be validated by a neuroanatomy domain expert — they cannot be guessed
from the spec alone.
**Requires human sign-off (domain expert provides exact values).**

### OD-07: Testing scope for intersection geometry [OPEN DECISION]
computeSlice performs ellipsoid-plane intersection geometry. Unit tests require
ground-truth answers (known ellipsoid + known plane → expected 2D ellipse
parameters). Should the test suite use analytical solutions, or reference outputs
from a trusted external tool (e.g., scipy or MATLAB)?
**Requires human sign-off on test oracle strategy.**

---

## Stage 4 Addendum — MeshServer (FastAPI Backend)

> This section documents the additions introduced in Stage 4.
> All prior sections remain authoritative. In case of conflict between this
> addendum and the body above, this addendum takes precedence for Stage 4 and
> later work only. Prior stages are unaffected.

### Retroactive Spec Corrections (from HISTORY/allen_atlas_oblique_slice_planner.md)

The following corrections were identified during Stage 2 implementation and are
formally recorded here for the first time (previously only in HISTORY):

1. **apPosition unit**: `sliceState.apPosition` is raw CCF micrometers (µm), NOT
   a normalized [0, 100] % value as stated in the original spec. All modules that
   receive or emit apPosition must treat it as a µm value. The [0, 100] % range
   in §3.5 and the ControlsPanel output contract is superseded.
2. **Three.js version**: r128 is in use (not r165 as stated in §4). Before any
   version upgrade, a full API diff against the intersection and rotation code
   must be performed.
3. **Coordinate division**: The buildPlane() spec reference to dividing
   apPositionMicrons by 1000 was incorrect and was never implemented. No division
   by 1000 is applied anywhere in the codebase.

---

### Module 10: MeshServer (FastAPI Backend)

| Field        | Value                                                          |
|--------------|----------------------------------------------------------------|
| Purpose      | Serves Allen CCF PLY mesh files over HTTP with CORS headers   |
|              | for local development. Replaces ellipsoid geometry with real  |
|              | Allen CCF mesh data. NOT intended for production deployment.  |
| Inputs       | PLY files on local disk (path known at server startup);        |
|              | HTTP GET requests from React client on localhost              |
| Outputs      | JSON responses containing vertex float arrays, face int arrays|
|              | and metadata per structure; health endpoint listing available  |
|              | structure IDs                                                  |
| Dependencies | fastapi, uvicorn, numpy (server-side only); Three.js           |
|              | BufferGeometry (client-side only, not a server dependency)    |

**Technology**: FastAPI + uvicorn, running on localhost:8000
**CORS policy**: `Access-Control-Allow-Origin: *` — local development only.
This setting MUST NOT be carried into any production or shared deployment.

**Endpoints**:
- `GET /health` → `{"status": "ok", "meshes_available": [list of integer IDs]}`
- `GET /mesh/{structure_id}` → `{"id": int, "acronym": str, "vertices": [float,...], "faces": [int,...]}`

**Mesh Loading State Machine (React client side)**:

```
IDLE → LOADING → FETCHING → PARSING → BUILDING_GEOMETRY → READY
                                                         ↓ on any failure
                                                    FALLBACK (keep ellipsoid)
```

State semantics:
- IDLE: component mounted; scene initialization not yet complete
- LOADING: scene initialization done; mesh fetches have been started
- FETCHING: HTTP request in flight for a given structure_id
- PARSING: JSON received; extracting vertex and face arrays from response body
- BUILDING_GEOMETRY: THREE.BufferGeometry being constructed; normals computed
- READY: PLY-derived mesh has replaced the ellipsoid mesh in the scene
- FALLBACK: any error during FETCHING, PARSING, or BUILDING_GEOMETRY — ellipsoid
  geometry is retained; console.warn is logged; no exception propagates

**Loading progress state** (useState in React component):
```
loadingState: { total: number, loaded: number, failed: number }
```
Rendered as a canvas overlay: "Loading meshes... (loaded/total)"
Overlay disappears when `loaded + failed === total`.
Fallback is per-structure: some structures may use real PLY mesh while others
retain their ellipsoid approximation within the same scene.

**Coordinate system for PLY vertices**:
PLY files from the Allen CCF contain vertices in raw CCF µm:
  - axis order: AP × DV × ML
  - origin: anterior-superior-left corner of the annotation volume

The same `ccfToThree` transform used for ellipsoid centers is applied client-side
to all PLY vertices before they are written into THREE.BufferAttribute:

```
threeX =  ccfZ - 5700    (ML axis → Three.js X)
threeY = -(ccfY - 4000)  (DV axis → Three.js Y, flipped)
threeZ = -(ccfX - 5700)  (AP axis → Three.js Z, flipped)
```

The transform is applied client-side (React) to avoid a server-side numpy
dependency for the transform computation (OD-08 below documents this decision).

**Fallback contract** (per structure, any combination allowed in the same scene):
- If `fetch()` rejects (server not running) → keep ellipsoid, log warning
- If `fetch()` returns non-200 status → keep ellipsoid, log warning
- If JSON parse throws → keep ellipsoid, log warning
- If THREE.BufferGeometry construction throws → keep ellipsoid, log warning

---

### Additions to §6 Coupling Risk Register

### CR-08: PLY vertex unit assumption [HIGH]
**Description**: The React client assumes PLY vertices from the Allen atlas are in
raw CCF µm (same unit as ellipsoid center_ccf). If the downloaded PLY files use a
different unit (e.g., voxel indices × 25 µm/voxel, or millimeters), the
ccfToThree transform will produce structures rendered at incorrect positions without
any error. This is a silent wrong-result failure.
**Mitigation**: During the PLY download / preprocessing step (pre-Stage 4 or early
Stage 4), explicitly verify the vertex unit by checking that a known landmark
structure (e.g., whole-brain root shell ID 997) spans approximately [0, 13200] µm
in the AP axis. Assert this range before any client consumes the mesh data. Document
the verified unit in the PLY download script as a code comment.

### CR-09: structure_id / PLY filename correspondence [MEDIUM]
**Description**: CCF_STRUCTURES uses Allen integer IDs in its registry. The
MeshServer constructs PLY file paths from the requested structure_id. If the
PLY filenames on disk use a different ID scheme, numbering offset, or naming
convention than the registry, mesh fetches will silently 404 and all structures
will fall back to ellipsoids with no diagnostic indication of the root cause.
**Mitigation**: At server startup, the health endpoint must enumerate all PLY
files actually present on disk and return their IDs. The React client must compare
this list against CCF_STRUCTURES IDs at load time and log any IDs present in
CCF_STRUCTURES but absent from the server's available list.

### CR-10: Large mesh frame rate [LOW]
**Description**: Root shell (ID 997), caudoputamen (CP), and primary somatosensory
cortex (SSp) may have 100k+ vertices each. Replacing multiple high-vertex-count
ellipsoids in the same scene with real PLY meshes may cause frame rate drops below
the 30 fps floor (§5) on integrated GPU hardware.
**Mitigation**: No decimation is implemented in Stage 4. This is accepted as a
known limitation. Mesh decimation (server-side or client-side) is deferred to
Stage 5 (OD-09 below). The Chaos Engineer must benchmark frame rate with real PLY
meshes before Stage 4 ships.

---

### Additions to §7 Open Decisions

### OD-08: Coordinate transform location — client-side vs server-side [OPEN DECISION]
Stage 4 implements the ccfToThree transform client-side (in React), converting raw
CCF µm vertices to Three.js world space before writing to BufferAttribute. An
alternative is to apply the transform server-side in mesh_server.py (returning
pre-transformed vertices), which would reduce client-side CPU time for large meshes
but add a numpy dependency and couple the server to the Three.js coordinate
convention. Current decision: client-side. If server-side is preferred, this
requires Architect sign-off and an update to the MeshServer output contract.
**Requires human sign-off to change from current (client-side) decision.**

### OD-09: Root mesh decimation [OPEN DECISION]
The root shell mesh (structure_id=997) may contain 100k+ vertices. Serving it
without decimation may cause noticeable latency on the initial /mesh/997 fetch and
frame rate drops after loading (CR-10). Server-side decimation using open3d or
trimesh, or client-side simplification using a Three.js SimplifyModifier, are both
viable. This is deferred to Stage 5.
**Requires human sign-off on decimation strategy and acceptable vertex count
ceiling per mesh before Stage 5 begins.**

---

## Stage 5 Addendum — Frame UI + Saved Slices

> This section documents the additions introduced in Stage 5.
> All prior sections remain authoritative. In case of conflict between this
> addendum and the body above, this addendum takes precedence for Stage 5 and
> later work only. Prior stages are unaffected.

### Updated Module: ControlsPanel (Stage 5 changes)

The ControlsPanel layout is restructured around a CSS grid "specimen stage" that
surrounds the 3D canvas with four range-input sliders. The right panel retains
pitch as a numeric input only; pitch is NOT surfaced as a frame slider.

CSS grid layout for the canvas frame:

```
grid-template-areas:
  ".    top    ."
  "left canvas right"
  ".   bottom  ."
grid-template-columns: 56px 1fr 56px
grid-template-rows:    56px 1fr 56px
```

Slider assignments:
- TOP slot:    L-R translate (lrPosition), range [-3000, 3000] µm, step 50, horizontal
- LEFT slot:   Roll, range [-45, 45] deg, step 1, vertical (CSS rotate(-90deg))
- RIGHT slot:  D-V translate (dvPosition), range [-2000, 2000] µm, step 50, vertical
- BOTTOM slot: Yaw, range [-45, 45] deg, step 1, horizontal

Vertical slider implementation note: `transform: rotate(-90deg)` alone does not
resize the slider's hit area. The slider's `width` must be set in JavaScript to
match the canvas `clientHeight`. This is done via a ResizeObserver on the canvas
container element (see Module 12 FrameSliders and CR-12).

### Updated sliceState Shape (v2)

Old shape: `{ pitch, yaw, roll, apPosition, thickness }`
New shape: `{ pitch, yaw, roll, apPosition, lrPosition, dvPosition, thickness }`

Two new fields:

| Field      | Type   | Valid Range        | Axis         | Semantics                                  |
|------------|--------|--------------------|--------------|--------------------------------------------|
| lrPosition | number | [-3000, 3000] µm   | Three.js X   | L-R translation; raw µm, no scaling        |
| dvPosition | number | [-2000, 2000] µm   | Three.js Y   | D-V translation; positive = dorsal         |
|            |        |                    | (flipped)    | dvPosition maps to -dvPosition in Three.js Y |

DV flip convention (carry-forward from ccfToThree): dorsal is anatomically "up"
but corresponds to negative Three.js Y. dvPosition is stored with the anatomist's
convention (positive = dorsal) and negated only inside buildSlicePlane v2.

All existing consumers of sliceState that do not read lrPosition or dvPosition are
unaffected; those two fields are additive.

### Updated Function: buildSlicePlane v2

Old signature: `buildSlicePlane(pitch, yaw, roll, apPositionMicrons)`
New signature: `buildSlicePlane(pitch, yaw, roll, apPositionMicrons, lrMicrons, dvMicrons)`

The plane center (translation) is now a full 3-axis vector:

```
center = new THREE.Vector3(
  lrMicrons,          // threeX: L-R axis
  -dvMicrons,         // threeY: flipped (dorsal up = negative Y in Three.js)
  apPositionMicrons   // threeZ: AP axis (raw µm — no /1000, carry-forward invariant)
)
```

Unit convention: all three axes use raw µm. This is consistent with the
retroactive correction from Stage 4 (apPosition is raw µm, never divided by 1000).
CR-11 below documents the risk of inconsistency across the three axes.

### New Feature: Lock/Free Camera Mode

A new boolean state `viewLocked` (default: false) controls camera behavior:

| viewLocked value | Behavior                                                              |
|------------------|-----------------------------------------------------------------------|
| false            | Manual orbit active (existing pointer events on canvas)              |
| true             | Orbit disabled; camera lerps to locked position (300, -150, 500),    |
|                  | target (0, 0, 0); pointer events on canvas suspended during lerp     |

Lerp parameters:
- Factor: 0.05 per animation frame
- Completion threshold: within 1 Three.js unit of locked position
- During lerp: `pointerEvents: 'none'` on the mount div
- After completion: `pointerEvents` restored to default

Toggle control: a button positioned absolute top-right of the 3D canvas.
viewLocked is written by that button only; no other module writes it.

### New Feature: Saved Slices

New state: `savedSlices: SavedSlice[]`, initial value `[]`.

SavedSlice shape:

| Field          | Type                     | Semantics                                              |
|----------------|--------------------------|--------------------------------------------------------|
| id             | string                   | `Date.now().toString()` at creation time; unique key   |
| name           | string                   | User-visible label for the slice                       |
| pitch          | number                   | Degrees, at save time                                  |
| yaw            | number                   | Degrees, at save time                                  |
| roll           | number                   | Degrees, at save time                                  |
| apPosition     | number                   | Raw CCF µm, at save time                               |
| lrPosition     | number                   | Raw CCF µm, at save time                               |
| dvPosition     | number                   | Raw CCF µm, at save time                               |
| thickness      | string                   | Thickness pill value at save time                      |
| preset         | 'tc' \| 'hippo' \| null  | Active preset at save time (null if none)              |
| sliceResult    | object                   | Full sliceResult snapshot at save time (plane, intersections, metadata) |
| thumbnail      | string                   | data URL (PNG), 60x45 px, generated at save time       |
| savedAt        | string                   | ISO 8601 date string                                   |

Thumbnail generation: a detached `document.createElement('canvas')` (width=60,
height=45) is used; `renderSlice2D` logic is applied to it; `.toDataURL()` is
called. The detached canvas is never mounted into the DOM (CR-13 documents the
SSR assumption).

Session persistence:
- Export: downloads a JSON file with shape `{ tool, version, exportedAt, slices: [...] }`
- Import: reads a JSON file via file input; appends imported slices to existing
  `savedSlices` (no replace); unknown acronyms in imported intersection data are
  rendered with fallback color `'#888888'`

Recall behavior (must be atomic — all six steps in the same synchronous dispatch):

1. Call `setSliceState` with all 6 slider values from the saved slice
2. Call `setSelectedThickness` with saved `thickness`
3. Restore `highlightState` (preset + highlighted array from saved slice)
4. Call `handleGenerateSlice()` to rerun the intersection
5. Scroll the right panel to its top
6. No intermediate render between steps 1-5

### Module 11: SavedSlicesPanel

| Field        | Value                                                               |
|--------------|---------------------------------------------------------------------|
| Purpose      | Collapsible panel displayed below the export buttons in the right   |
|              | panel. Lists all saved slices as thumbnail cards. Provides recall   |
|              | and delete per slice, and session export/import at the panel footer.|
| Inputs       | savedSlices[] (read), sliceState (read for highlight sync)          |
| Outputs      | Writes: savedSlices (via delete); triggers recall (atomic update    |
|              | of sliceState, selectedThickness, highlightState, handleGenerateSlice) |
|              | Triggers: file download (export), file input dialog (import)        |
| Dependencies | renderSlice2D (for thumbnail generation), handleGenerateSlice       |

Card layout per saved slice:
- Thumbnail image (60x45 px data URL)
- Name label
- Angle summary (pitch/yaw/roll/AP/LR/DV formatted as compact string)
- Recall button
- Delete button

Panel footer:
- "Export Session" button: triggers JSON download
- "Import Session" button: triggers file input upload

### Module 12: FrameSliders

| Field        | Value                                                               |
|--------------|---------------------------------------------------------------------|
| Purpose      | Four range inputs surrounding the 3D canvas in the CSS grid frame. |
|              | Each slider controls one axis of sliceState. Emits live updates     |
|              | on every `onChange` event (not debounced to `onMouseUp`).           |
| Inputs       | sliceState (read for sync), containerRef (canvas container element  |
|              | for ResizeObserver measurement)                                     |
| Outputs      | Writes: sliceState.lrPosition (TOP), sliceState.roll (LEFT),        |
|              | sliceState.dvPosition (RIGHT), sliceState.yaw (BOTTOM)              |
| Dependencies | ResizeObserver API (browser-native); no external library            |

Vertical slider sizing: a ResizeObserver is attached to the canvas container.
On every observed resize (including the initial observation on mount):
```
sliderRef.current.style.width = containerRef.current.clientHeight + 'px'
```
This fires on both initial mount and subsequent window resizes (CR-12).

Live value pill readout: each slider is accompanied by a small label that shows
the current numeric value and units (µm or °), updated on every onChange.

Wiring to sliceState: FrameSliders writes only to sliceState via `setSliceState`.
It does not write to highlightState, savedSlices, or any other state.

---

### Additions to §6 Coupling Risk Register (Stage 5)

### CR-11: buildSlicePlane translation unit consistency [HIGH]
**Description**: buildSlicePlane v2 uses raw µm for all three translation axes
(lrMicrons, dvMicrons, apPositionMicrons). The carry-forward invariant from Stage 4
(no division by 1000 for apPosition) now extends to lrMicrons and dvMicrons. If any
future caller passes lrMicrons or dvMicrons in a different unit (e.g., mm or voxel
indices), the plane will be positioned at a wildly incorrect location without any
error. Because the Three.js scene is entirely in raw CCF µm, the error will produce
a plausible-looking but anatomically wrong plane position — a silent wrong-result
failure.
**Mitigation**: buildSlicePlane v2 must assert at its entry that all three
positional arguments are within the expected CCF µm ranges:
`|lrMicrons| <= 3000`, `|dvMicrons| <= 2000`, `apPositionMicrons in [0, 13200]`.
Out-of-range values must warn (not throw, to allow drag beyond soft limits) and be
clamped before use. The unit convention (raw µm, no scaling) must be documented in
the function signature comment.

### CR-12: ResizeObserver vertical slider sizing fires on mount [MEDIUM]
**Description**: Vertical sliders (LEFT=roll, RIGHT=dvPosition) require their
`width` CSS property to be set to the canvas `clientHeight` to provide the correct
interactive hit area. If the ResizeObserver only fires on subsequent resize events
and not on the initial observation, the slider will have a width of 0 (or its
default inline width) on first render, producing a non-interactive control with no
visual indication of failure.
**Mitigation**: The ResizeObserver callback must be invoked immediately after
`observer.observe(containerRef.current)` returns, either by calling the callback
explicitly once or by relying on the specification-guaranteed initial callback that
browsers fire for the observed element's initial size. The implementation must be
tested on Chrome, Firefox, and Safari for consistent initial-fire behavior. A
defensive fallback: on the first useEffect execution, read `clientHeight` directly
and apply it before the observer is registered.

### CR-13: Thumbnail detached canvas requires browser environment [LOW]
**Description**: Thumbnail generation uses `document.createElement('canvas')`,
which is only available in a browser context. If any part of the pipeline is ever
run server-side (SSR, testing in Node.js via jsdom, or a future Next.js migration),
thumbnail generation will throw a reference error or produce a blank canvas without
warning.
**Mitigation**: This tool is documented as a browser-only artifact (§5: "Must run
from file:// or a plain static HTTP server"). Server-side execution is explicitly
out of scope. If SSR is ever introduced, thumbnail generation must be wrapped in an
`if (typeof document !== 'undefined')` guard that returns a placeholder data URL
instead of throwing. Document this assumption in the function comment.

---

### Additions to §7 Open Decisions (Stage 5)

### OD-10: Pitch slider placement [OPEN DECISION]
The current Stage 5 spec places pitch as a numeric input in the right panel only
— it is not surfaced as a frame slider in the CSS grid. The rationale is that the
4-sided grid frame has a natural mapping to 4 axes (LR/DV translation + yaw/roll),
and pitch is the least-used rotation for standard oblique cuts. However, some
workflows (e.g., hippocampal long-axis cuts) require fine pitch control. Should
pitch be added as a 5th slider somewhere in the UI (e.g., inside the canvas overlay,
or as a second-row control)? Or is numeric-input-only sufficient?
**Requires human sign-off before Stage 5 coding begins.**

### OD-11: Thumbnail resolution [OPEN DECISION]
The current spec defines thumbnail dimensions as 60x45 px. For dense coronal slices
with many intersecting structures, 60x45 may be too low resolution to distinguish
individual structure fills in the SavedSlicesPanel cards. An alternative of 120x90
rendered at 0.5x CSS scale (effectively the same display size but 2x pixel density
for retina screens) would improve clarity at the cost of 4x the data URL size per
saved slice, and 4x the detached-canvas rendering work per save.
**Requires human sign-off on acceptable thumbnail resolution before SavedSlicesPanel
is coded.**
