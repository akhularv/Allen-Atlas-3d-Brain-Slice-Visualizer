# Interface Contracts — Allen Atlas Oblique Slice Planner

Version: 3  |  Date: 2026-03-10  |  Changed: Stage 5 Addendum — sliceState v2 (lrPosition, dvPosition added), buildSlicePlane v2 signature (lrMicrons, dvMicrons parameters, 3-axis center vector), ControlsPanel output contract updated for 6-field sliceState, SavedSlice shape contract, Module 11 SavedSlicesPanel contract, Module 12 FrameSliders contract, cross-module invariant 7 added (raw µm on all three translation axes).

---

## Module: CCF_STRUCTURES Registry

### Input Contract
This module has no runtime inputs. It is a static, hardcoded data module that is
loaded once at application startup and never modified.

### Output Contract

Each record in the registry exposes:

| Field        | Type          | Valid Range / Shape         | Semantics                                     | Who Consumes         |
|--------------|---------------|-----------------------------|-----------------------------------------------|----------------------|
| acronym      | string        | Non-empty, unique           | Allen CCF short identifier (e.g., "VISp")     | All modules          |
| label        | string        | Non-empty                   | Human-readable full name                      | RegionTogglePanel, SliceOutputPanel |
| group        | string enum   | 'thalamus' \| 'cortex' \|   | Coarse anatomical grouping for toggle panel   | RegionTogglePanel,   |
|              |               | 'fiber' \| 'hippocampus' \| |                                               | toggleGroup()        |
|              |               | 'subcortical'               |                                               |                      |
| color        | string (hex)  | '#RRGGBB', 6-digit hex      | Display color; used in 3D mesh and 2D canvas  | BrainViewer, SliceOutputPanel |
| center_ccf   | number[3]     | [0..13200, 0..8000, 0..11400] | Structure centroid in CCF v3 µm coordinates   | BrainViewer (via ccfToThree), computeSlice |
|              |               | (AP, DV, ML in µm)          | AP = anterior-posterior, DV = dorsal-ventral, |                      |
|              |               |                             | ML = medial-lateral                           |                      |
| semi_axes    | number[3]     | All values > 0, in µm        | Ellipsoid semi-axes [a, b, c] aligned with    | BrainViewer, computeSlice |
|              |               |                             | center_ccf coordinate frame before rotation   |                      |
| euler_ccf    | number[3]     | [-π, π] radians each        | Intrinsic XYZ Euler angles rotating the       | BrainViewer, computeSlice |
|              |               |                             | ellipsoid in CCF space                        |                      |

### Invariants
- `acronym` is unique across the entire registry — no two records share an acronym.
- `group` is always one of the five permitted enum values; no null or undefined groups.
- `color` always parses as a valid CSS hex color.
- `center_ccf` coordinates are within the CCF v3 bounding volume.
- `semi_axes` are strictly positive (no zero-radius axes).
- The registry object is frozen (read-only) at runtime; no module may mutate it.

### Failure Modes
- MUST NOT silently accept a record with missing `acronym` or `center_ccf`.
- MUST NOT silently accept a duplicate `acronym`.
- MUST NOT accept `semi_axes` containing zero or negative values.
- If the registry fails validation at load time, the application must halt with an
  explicit error message identifying the offending record.

---

## Module: BrainViewer

### Input Contract

| Field            | Type                     | Valid Range           | Semantics                                      | Who Provides       |
|------------------|--------------------------|-----------------------|------------------------------------------------|--------------------|
| cameraState      | object                   | See sub-fields below  | Spherical camera position                      | BrainViewer self (orbit) |
| cameraState.theta| number (radians)         | [0, 2π]               | Azimuthal angle around Y axis                  | orbit handler      |
| cameraState.phi  | number (radians)         | [ε, π-ε], ε = 0.01   | Polar angle from Y-up pole; clamped to avoid   | orbit handler      |
|                  |                          |                       | gimbal lock at poles                           |                    |
| cameraState.radius| number (scene units)    | [0.5, 20.0]           | Distance from target; clamped                  | orbit handler      |
| cameraState.target| THREE.Vector3           | Any finite vector     | Orbit center in Three.js world space           | orbit handler      |
| visibilityState  | { [acronym]: boolean }   | boolean per acronym   | true = mesh visible, false = hidden            | RegionTogglePanel  |
| highlightState   | object                   | See sub-fields below  | Which structures get elevated renderOrder      | ControlsPanel      |
| highlightState.preset| string \| null       | 'tc' \| 'hippo' \| null| Active preset name                             | ControlsPanel      |
| highlightState.highlighted | string[]       | acronyms in registry  | Structures rendered at renderOrder 2           | ControlsPanel      |
| sliceState       | object                   | See ControlsPanel     | Used to position SlicePlaneWidget only         | ControlsPanel      |

### Output Contract

| Field         | Type           | Semantics                                            | Who Consumes        |
|---------------|----------------|------------------------------------------------------|---------------------|
| canvas element| HTMLCanvasElement| Rendered 3D scene; DOM element mounted in page      | Browser / DOM       |
| cameraState   | object         | Updated on every orbit gesture; written to shared    | AxisIndicator,      |
|               |                | state, not returned directly                         | downstream readers  |

### Invariants
- The Three.js scene is mutated exclusively by BrainViewer. No other module calls
  scene.add(), scene.remove(), or sets mesh.renderOrder directly.
- mesh.visible is the only mesh property that other modules may indirectly trigger;
  the write always goes through BrainViewer's state-to-scene reconciliation step,
  not by direct external mesh access.
- All structure meshes are added to the scene exactly once at initialization and
  remain in the scene for the application lifetime (never removed, only hidden).
- The shell mesh (whole brain outline) is always present and always at renderOrder 0.
- renderer.sortObjects is always true.
- depthWrite is always false for all scene meshes (transparency layering relies on
  renderOrder alone).

### Failure Modes
- MUST NOT silently drop a visibilityState key; if an acronym in visibilityState
  has no corresponding scene mesh, it must log a warning (not throw).
- MUST NOT allow cameraState.phi to reach exactly 0 or π (poles); the orbit
  handler must clamp.
- MUST NOT apply renderOrder changes to the shell mesh; its renderOrder 0 is
  immutable.

---

## Module: RegionTogglePanel

### Input Contract

| Field            | Type                   | Valid Range         | Semantics                              | Who Provides     |
|------------------|------------------------|---------------------|----------------------------------------|------------------|
| visibilityState  | { [acronym]: boolean } | boolean per key     | Current visibility of each structure   | Shared state     |
| groupVisibility  | { [group]: boolean }   | boolean per group   | Whether the entire group is visible    | Shared state     |

### Output Contract

| Field            | Type                   | Semantics                                             | Who Consumes     |
|------------------|------------------------|-------------------------------------------------------|------------------|
| visibilityState  | { [acronym]: boolean } | New snapshot; entire object replaced, not mutated     | BrainViewer, computeSlice |
| groupVisibility  | { [group]: boolean }   | New snapshot after group toggle                       | BrainViewer, computeSlice |

### Invariants
- When a group is toggled off, all member acronyms in visibilityState are set to
  false in the same atomic update.
- When a group is toggled on, all member acronyms in visibilityState are set to
  true in the same atomic update.
- Individual structure toggles never modify groupVisibility.
- The panel never directly touches any Three.js object.

### Failure Modes
- MUST NOT silently accept an acronym toggle for an acronym not present in
  CCF_STRUCTURES; must log a warning.
- MUST NOT partially apply a group toggle (all members update or none do).

---

## Module: AxisIndicator

### Input Contract

| Field            | Type              | Valid Range       | Semantics                              | Who Provides   |
|------------------|-------------------|-------------------|----------------------------------------|----------------|
| cameraState.theta| number (radians)  | [0, 2π]           | Azimuthal camera angle                 | BrainViewer    |
| cameraState.phi  | number (radians)  | [ε, π-ε]          | Polar camera angle                     | BrainViewer    |

Note: AxisIndicator receives only theta and phi, never a reference to the
Three.js camera object or the renderer.

### Output Contract

| Field  | Type                  | Semantics                                           | Who Consumes |
|--------|-----------------------|-----------------------------------------------------|--------------|
| gizmo  | rendered canvas/SVG   | Three RGB arrows (X=red, Y=green, Z=blue) oriented  | DOM / user   |
|        |                       | to mirror the current camera view direction         |              |

### Invariants
- X axis arrow is always rendered in red (#FF0000 or equivalent).
- Y axis arrow is always rendered in green (#00FF00 or equivalent).
- Z axis arrow is always rendered in blue (#0000FF or equivalent).
- Gizmo size is fixed in screen pixels (not world units); it does not scale with
  camera radius.
- Gizmo is always visible regardless of visibilityState or highlightState.

### Failure Modes
- MUST NOT receive a camera object reference; the contract explicitly excludes
  any Three.js object.
- MUST NOT affect the main BrainViewer renderer or scene.

---

## Module: ControlsPanel

### Input Contract

| Field         | Type    | Valid Range              | Semantics                                 | Who Provides  |
|---------------|---------|--------------------------|-------------------------------------------|---------------|
| sliceState    | object  | See sub-fields below     | Current slider values for display/sync    | Shared state  |
| highlightState| object  | See BrainViewer contract | Current preset / highlighted list         | Shared state  |

### Output Contract

Writes to sliceState (all five fields atomically on slider change):

| Field              | Type    | Valid Range    | Semantics                                    | Who Consumes                   |
|--------------------|---------|----------------|----------------------------------------------|--------------------------------|
| sliceState.pitch   | number  | [-90, 90] deg  | Rotation about the medial-lateral axis       | buildPlane(), BrainViewer      |
| sliceState.yaw     | number  | [-90, 90] deg  | Rotation about the dorsal-ventral axis       | buildPlane(), BrainViewer      |
| sliceState.roll    | number  | [-90, 90] deg  | Rotation about the anterior-posterior axis   | buildPlane(), BrainViewer      |
| sliceState.apPosition | number | [0, 100] %  | Normalized AP position along CCF AP axis     | buildPlane(), BrainViewer      |
| sliceState.thickness| number | [10, 1000] µm  | Virtual slice thickness in micrometers       | computeSlice()                 |

Writes to highlightState on preset button activation:

| Field                      | Type        | Valid Range              | Who Consumes           |
|----------------------------|-------------|--------------------------|------------------------|
| highlightState.preset      | string\|null| 'tc'\|'hippo'\|null      | BrainViewer, SliceOutputPanel |
| highlightState.highlighted | string[]    | acronyms in registry     | BrainViewer            |

### Invariants
- All five sliceState fields are updated in the same synchronous event handler;
  no field is ever written in a separate microtask or timer callback.
- applyPreset() writes both sliceState and highlightState synchronously before
  returning; the ControlsPanel's event handler does not yield between the two writes.
- Slider values are clamped to their valid ranges before being written to state;
  they never exceed declared bounds.
- Preset buttons are mutually exclusive: activating one preset sets the other to
  null in the same synchronous call.

### Failure Modes
- MUST NOT silently clamp without notifying the UI; if a slider value arrives
  outside its declared range (e.g., from programmatic state injection), the
  displayed value must reflect the clamped value, not the raw input.
- MUST NOT call applyPreset() asynchronously.
- MUST NOT write directly to visibilityState or any mesh property.

---

## Module: SliceOutputPanel

### Input Contract

| Field         | Type         | Valid Range                  | Semantics                               | Who Provides   |
|---------------|--------------|------------------------------|-----------------------------------------|----------------|
| sliceResult   | object\|null | See below, or null           | Intersection output from computeSlice   | computeSlice() |
| visibilityState| { [acronym]: boolean } | boolean per key | Used to suppress hidden structures from the list | RegionTogglePanel |

sliceResult shape when non-null:

| Field                        | Type       | Valid Range        | Semantics                              |
|------------------------------|------------|--------------------|----------------------------------------|
| intersections                | array      | length [0, N]      | One entry per intersected structure    |
| intersections[i].acronym     | string     | CCF acronym        | Identifies the structure               |
| intersections[i].color       | string     | '#RRGGBB'          | From CCF_STRUCTURES                    |
| intersections[i].segments    | {x,y}[]    | finite numbers     | 2D outline points in canvas coordinates|
| intersections[i].centroid    | {x, y}     | finite numbers     | Centroid of the 2D outline             |

### Output Contract

| Field      | Type                  | Semantics                                         | Who Consumes |
|------------|-----------------------|---------------------------------------------------|--------------|
| 2D canvas  | HTMLCanvasElement     | Cross-section rendering: one filled ellipse per   | DOM / user   |
|            |                       | intersected structure, colored by structure color |              |
| DOM list   | list of DOM elements  | Sorted by centroid Y position; each entry shows   | DOM / user   |
|            |                       | color swatch, acronym, full label, group          |              |

### Invariants
- If sliceResult is null, the 2D canvas is cleared and the structure list is
  empty; no stale data from a prior state is displayed.
- Structures in the intersections list where visibilityState[acronym] === false
  are omitted from the DOM list but may still appear in the 2D canvas (they are
  geometrically present in the slice even if toggled off in the 3D view).
  [OPEN DECISION OD-05 affects this: the exact display rule for hidden-but-
  intersected structures requires human sign-off.]
- The 2D canvas aspect ratio is preserved on window resize; it does not stretch.
- The structure list is re-rendered on every sliceResult change; it never appends
  to a prior list.

### Failure Modes
- MUST NOT throw if sliceResult.intersections is empty; must display an empty
  canvas and empty list gracefully.
- MUST NOT retain references to prior sliceResult objects after a new result is
  received.
- MUST NOT write to any shared state.

---

## Module: Intersection Engine (computeSlice)

### Input Contract

| Field         | Type     | Valid Range                         | Semantics                            | Who Provides    |
|---------------|----------|-------------------------------------|--------------------------------------|-----------------|
| sliceState    | object   | See ControlsPanel output contract   | Defines the cutting plane geometry   | ControlsPanel   |
| visibleMeshes | array    | Records from CCF_STRUCTURES where   | Structures to test for intersection  | BrainViewer /   |
|               |          | visibilityState[acronym] === true   |                                      | shared state    |

### Output Contract

| Field                    | Type       | Valid Range       | Semantics                                | Who Consumes       |
|--------------------------|------------|-------------------|------------------------------------------|--------------------|
| sliceResult              | object     | See SliceOutputPanel input contract | Complete intersection result | SliceOutputPanel   |
| sliceResult.intersections| array      | length [0, N]     | May be empty if no structures intersect  | SliceOutputPanel   |

### Invariants
- computeSlice is a pure function: given identical inputs it always returns an
  identical output. No side effects, no global state reads beyond the two declared
  inputs.
- Every entry in sliceResult.intersections has an acronym present in CCF_STRUCTURES.
- No entry appears in sliceResult.intersections if the corresponding entry in
  visibleMeshes was not passed as input (hidden structures never appear in output).
- segment coordinates are finite numbers; NaN or Infinity must never appear in output.
- thickness is used to determine whether a structure's ellipsoid center falls within
  the slab (|distance from plane| ≤ thickness/2); structures outside the slab are
  excluded even if the plane technically clips their edge.
- The function completes within 16 ms for up to 80 input structures on the target
  hardware profile (§5).

### Failure Modes
- MUST NOT silently return a partial result if geometry computation fails for one
  structure; the failing structure must be omitted from the result and a console
  warning must be issued.
- MUST NOT mutate the input sliceState or visibleMeshes objects.
- MUST NOT produce results for structures whose ellipsoid parameters fail basic
  validity checks (non-positive semi-axes); must warn and skip.

---

## Module: Coordinate Utilities (ccfToThree / buildPlane)

### Function: ccfToThree(x, y, z)

#### Input Contract

| Parameter | Type   | Valid Range (µm)    | Semantics                                      | Who Provides      |
|-----------|--------|---------------------|------------------------------------------------|-------------------|
| x         | number | [0, 13200]          | CCF AP axis (anterior = low, posterior = high) | CCF_STRUCTURES    |
| y         | number | [0, 8000]           | CCF DV axis (dorsal = low, ventral = high)     | CCF_STRUCTURES    |
| z         | number | [0, 11400]          | CCF ML axis (medial = low, lateral = high)     | CCF_STRUCTURES    |

#### Output Contract

| Return     | Type          | Semantics                                                | Who Consumes |
|------------|---------------|----------------------------------------------------------|--------------|
| THREE.Vector3 | THREE.Vector3 | Remapped to Three.js Y-up right-handed world space.   | BrainViewer, computeSlice |
|            |               | Units scaled from µm to scene units (scale factor is    |              |
|            |               | [OPEN DECISION OD-01/03] — must be declared once and    |              |
|            |               | used only here)                                         |              |

#### Invariants
- The mapping is a fixed linear transformation (scale + axis permutation + optional
  sign flip). No branching on input values.
- The CCF bregma landmark maps to a known Three.js coordinate that is documented
  as the authoritative test case for this function.
- Scale factor is defined as a single named constant; it is not repeated elsewhere.

#### Failure Modes
- MUST NOT silently accept NaN or Infinity inputs; must throw with coordinate values.

---

### Function: buildPlane(pitch, yaw, roll, apPosition)

#### Input Contract

| Parameter  | Type   | Valid Range    | Semantics                                      | Who Provides   |
|------------|--------|----------------|------------------------------------------------|----------------|
| pitch      | number | [-90, 90] deg  | Rotation about ML axis                         | sliceState     |
| yaw        | number | [-90, 90] deg  | Rotation about DV axis                         | sliceState     |
| roll       | number | [-90, 90] deg  | Rotation about AP axis                         | sliceState     |
| apPosition | number | [0, 100] %     | AP position normalized: 0 = most anterior,     | sliceState     |
|            |        |                | 100 = most posterior in Three.js scene space   |                |

#### Output Contract

| Return      | Type        | Semantics                                            | Who Consumes              |
|-------------|-------------|------------------------------------------------------|---------------------------|
| THREE.Plane | THREE.Plane | Oriented cutting plane in Three.js world space.      | computeSlice, BrainViewer |
|             |             | Normal vector is unit length. Constant d satisfies   | (SlicePlaneWidget)        |
|             |             | n·x + d = 0 for the plane origin.                   |                           |

#### Invariants
- The returned plane normal is always a unit vector (length = 1.0 ± 1e-6).
- Rotation order for pitch/yaw/roll is defined once and documented in the function
  signature comment; it is never changed without updating this contract.
- At pitch=0, yaw=0, roll=0, the returned plane is axis-aligned (coronal cut).

#### Failure Modes
- MUST NOT return a plane with a zero or near-zero normal vector.
- MUST NOT silently accept inputs outside declared ranges; must clamp and warn.

---

## Module: Preset Engine (applyPreset)

### Input Contract

| Parameter        | Type     | Valid Range                 | Semantics                        | Who Provides   |
|------------------|----------|-----------------------------|----------------------------------|----------------|
| presetName       | string   | 'tc' \| 'hippo'             | Identifies the preset to apply   | ControlsPanel  |
| setSliceState    | function | (sliceState) => void        | State setter for slice params    | ControlsPanel  |
| setHighlightState| function | (highlightState) => void    | State setter for highlights      | ControlsPanel  |

### Output Contract

Both setSliceState and setHighlightState are called synchronously before the
function returns. There is no return value.

| Side effect       | Semantics                                              | Who Consumes     |
|-------------------|--------------------------------------------------------|------------------|
| setSliceState call| New sliceState with preset-specific pitch/yaw/roll/    | BrainViewer,     |
|                   | apPosition; thickness unchanged from current value     | computeSlice     |
| setHighlightState call | New highlightState with preset and highlighted list | BrainViewer,   |
|                   | appropriate to the preset                              | SliceOutputPanel |

### Invariants
- Both setter calls occur in the same synchronous execution context; no await or
  timer between them.
- Preset values for pitch/yaw/roll/apPosition are hardcoded constants validated by
  domain expert (OD-06); they are not computed at runtime.
- Calling applyPreset with an unrecognized presetName must throw immediately, not
  silently apply a default.
- applyPreset never modifies visibilityState.

### Failure Modes
- MUST NOT accept an unrecognized presetName (throw, do not silently ignore).
- MUST NOT yield control between the two setter calls.
- MUST NOT modify thickness in sliceState.

---

## Module: toggleGroup

### Input Contract

| Parameter  | Type                       | Valid Range          | Semantics                           | Who Provides      |
|------------|----------------------------|----------------------|-------------------------------------|-------------------|
| groupName  | string                     | 'thalamus'\|'cortex'\|'fiber'\|'hippocampus'\|'subcortical' | Group to toggle | RegionTogglePanel |
| visible    | boolean                    | true \| false        | Desired visibility for all members  | RegionTogglePanel |
| meshes     | { [acronym]: THREE.Mesh }  | Meshes in scene      | Reference to the scene mesh map     | BrainViewer       |

### Output Contract

| Side effect       | Semantics                                                     | Who Consumes    |
|-------------------|---------------------------------------------------------------|-----------------|
| void              | Sets mesh.visible for all acronyms in the group; updates      | BrainViewer     |
|                   | visibilityState snapshot atomically for all group members     | (via state)     |

### Invariants
- All group members are updated before the function returns; no partial toggle.
- toggleGroup does not affect structures outside the named group.
- toggleGroup does not change renderOrder or opacity of any mesh.

### Failure Modes
- MUST NOT silently skip an acronym that is in the group definition but absent
  from the meshes map; must log a warning with the missing acronym.
- MUST NOT accept an unrecognized groupName; must throw.

---

## Cross-Module Invariants (apply to every module boundary)

1. **No module reads from two data layers simultaneously.** The data layers are:
   (a) raw CCF registry, (b) Three.js scene objects, (c) application state objects
   (cameraState, sliceState, etc.), (d) computed outputs (sliceResult). Each module
   touches at most one writable layer per invocation.

2. **subject_id is not applicable** to this tool (no subject-level data). The
   analogous concept — structure acronym — must never be dropped or ambiguously
   merged across any module boundary.

3. **All intermediate state objects can be serialized to JSON** without loss of
   information (cameraState, sliceState, visibilityState, highlightState,
   sliceResult). This enables reproducibility: a researcher can save and reload
   their exact viewing configuration.

4. **No module writes to the DOM except its own designated DOM region.** BrainViewer
   owns its canvas. RegionTogglePanel owns its overlay container. ControlsPanel
   owns the right-top panel. SliceOutputPanel owns the right-bottom panel.
   AxisIndicator owns its corner element.

5. **All angle parameters cross module boundaries in degrees** (not radians) except
   within buildPlane(), which converts internally. The only place radians appear as
   a public interface is cameraState.theta and cameraState.phi (Three.js convention).

6. **apPosition is raw CCF µm** (retroactive correction, Stage 4): The original
   spec stated apPosition as normalized [0, 100] %. This was incorrect. All modules
   that read or write apPosition treat it as raw CCF µm. Valid range: [0, 13200] µm
   (anterior to posterior extent of the CCF v3 volume).

---

## Stage 4 Addendum — Interface Contracts

> Retroactive apPosition correction: ControlsPanel output contract field
> `sliceState.apPosition` valid range is updated from `[0, 100] %` to
> `[0, 13200] µm` (raw CCF micrometers). All downstream consumers (buildPlane,
> computeSlice, BrainViewer) read apPosition as raw µm.

---

## Module: MeshServer (FastAPI Backend)

### Input Contract

**GET /health**

| Parameter | Type | Valid Range | Semantics               | Who Provides   |
|-----------|------|-------------|-------------------------|----------------|
| (none)    | —    | —           | No query parameters     | React client   |

**GET /mesh/{structure_id}**

| Parameter    | Type    | Valid Range               | Semantics                                 | Who Provides |
|--------------|---------|---------------------------|-------------------------------------------|--------------|
| structure_id | integer | Any Allen CCF integer ID  | Identifies the structure whose PLY mesh   | React client |
|              |         | present on server disk    | is requested; must match PLY filename     |              |

### Output Contract

**GET /health response**

| Field             | Type          | Valid Range          | Semantics                                   | Who Consumes  |
|-------------------|---------------|----------------------|---------------------------------------------|---------------|
| status            | string        | "ok"                 | Server is running and PLY directory is      | React client  |
|                   |               |                      | readable                                    |               |
| meshes_available  | integer[]     | Non-empty array of   | Allen CCF integer IDs for which a PLY file  | React client  |
|                   |               | valid CCF IDs        | exists on disk at server startup            | (health check)|

**GET /mesh/{structure_id} response (HTTP 200)**

| Field    | Type      | Valid Range                     | Semantics                                      | Who Consumes   |
|----------|-----------|---------------------------------|------------------------------------------------|----------------|
| id       | integer   | Matches request structure_id    | Allen CCF structure integer ID                 | React client   |
| acronym  | string    | Non-empty, Allen CCF acronym    | Short identifier; must match CCF_STRUCTURES    | React client   |
| vertices | float[]   | Flat array, length = 3N for N   | Raw CCF µm coordinates, interleaved [x0,y0,z0, | React client  |
|          |           | vertices; all values finite     | x1,y1,z1, ...]; axis order: AP, DV, ML         | (ccfToThree)  |
| faces    | integer[] | Flat array, length = 3F for F   | Triangle face indices into vertices array;     | React client   |
|          |           | triangles; all values in        | each triplet is one triangle                   | (BufferGeometry)|
|          |           | [0, N-1]                        |                                                |               |

**GET /mesh/{structure_id} response (HTTP 404)**

Returned when structure_id has no corresponding PLY file on disk. React client
must treat 404 as a fallback trigger (retain ellipsoid, log warning).

### Client Mesh Loading State Contract

The React component maintains the following loading progress state:

| Field                | Type    | Valid Range         | Semantics                                          |
|----------------------|---------|---------------------|----------------------------------------------------|
| loadingState.total   | integer | >= 0                | Number of mesh fetches initiated at scene init     |
| loadingState.loaded  | integer | [0, total]          | Number of structures successfully replaced with PLY|
| loadingState.failed  | integer | [0, total]          | Number of structures that fell back to ellipsoid   |

Loading overlay is visible when `loaded + failed < total`.
Loading overlay disappears when `loaded + failed === total`.

### Vertex Coordinate Contract

PLY vertices from the server are in raw Allen CCF µm (AP × DV × ML, origin at
anterior-superior-left corner of the annotation volume). Before writing to
THREE.BufferAttribute, the React client applies the following linear transform
(same as the ccfToThree transform used for ellipsoid centers):

```
threeX =  ccfZ - 5700    // ML → Three.js X
threeY = -(ccfY - 4000)  // DV → Three.js Y (flipped)
threeZ = -(ccfX - 5700)  // AP → Three.js Z (flipped)
```

This transform is applied client-side only. The server returns raw CCF µm.

| Stage      | Coordinate space           | Who is responsible          |
|------------|----------------------------|-----------------------------|
| On disk    | Raw PLY (CCF µm, AP/DV/ML) | Allen Atlas source files    |
| Server response | Raw CCF µm (vertices array) | MeshServer (no transform) |
| After client parse | Raw CCF µm           | React component (pre-transform) |
| After ccfToThree | Three.js world space  | React component (post-transform, written to BufferAttribute) |

### Invariants
- The server MUST NOT apply any coordinate transform to PLY vertices; it returns
  raw CCF µm values as read from the PLY file.
- The `acronym` field in the /mesh response MUST match the acronym stored in
  CCF_STRUCTURES for the same structure_id; mismatches must be treated as a server
  error by the client.
- Vertex array length must be exactly 3 × (number of vertices); face array length
  must be exactly 3 × (number of triangles). Any other lengths are malformed
  responses and must trigger fallback.
- The health endpoint's `meshes_available` list must reflect only files actually
  present and readable on disk at the time of the request; it must not include IDs
  for files that exist but cannot be parsed.
- CORS header `Access-Control-Allow-Origin: *` is set on ALL responses from this
  server. This is intentional for local development. This header MUST be removed
  before any production or networked deployment.
- `loadingState.loaded + loadingState.failed` must never exceed `loadingState.total`.

### Failure Modes
- Server MUST NOT return HTTP 200 with an empty or partial vertices array; if PLY
  parsing fails, return HTTP 500 with a descriptive error message.
- Server MUST NOT silently truncate large meshes; it must return all vertices and
  faces from the PLY file or return an error.
- Client MUST NOT throw an unhandled exception on any fetch failure; all errors in
  the FETCHING → PARSING → BUILDING_GEOMETRY states must be caught and route to
  FALLBACK.
- Client MUST NOT mutate a mesh that is currently being rendered; geometry
  replacement must be applied before the next animation frame or deferred safely.
- Client MUST NOT display the loading overlay indefinitely; if a fetch hangs, a
  timeout (implementation-defined, minimum 10 seconds) must fire the FALLBACK
  transition and increment `loadingState.failed`.
- Server MUST NOT serve files outside the designated PLY directory regardless of
  structure_id value (no path traversal).

---

## Stage 5 Addendum — Interface Contracts

> This section appends new and updated contracts for Stage 5.
> All prior contracts remain authoritative. Where a Stage 5 entry conflicts
> with a prior entry for the same module/function, the Stage 5 entry takes
> precedence for Stage 5 and later work.

---

### Updated Contract: sliceState (v2)

sliceState is the shared state object written by ControlsPanel / FrameSliders and
read by buildSlicePlane, computeSlice, BrainViewer, and applyPreset.

Stage 5 adds two new fields. All existing fields are unchanged.

| Field       | Type   | Valid Range       | Semantics                                                  | Who Provides          | Who Consumes                          |
|-------------|--------|-------------------|------------------------------------------------------------|-----------------------|---------------------------------------|
| pitch       | number | [-90, 90] deg     | Rotation about ML axis (numeric input, right panel)        | ControlsPanel         | buildSlicePlane, BrainViewer          |
| yaw         | number | [-45, 45] deg     | Rotation about DV axis                                     | FrameSliders (BOTTOM) | buildSlicePlane, BrainViewer          |
| roll        | number | [-45, 45] deg     | Rotation about AP axis                                     | FrameSliders (LEFT)   | buildSlicePlane, BrainViewer          |
| apPosition  | number | [0, 13200] µm     | AP translation; raw CCF µm (carry-forward from Stage 4)    | ControlsPanel         | buildSlicePlane, BrainViewer          |
| lrPosition  | number | [-3000, 3000] µm  | L-R translation; raw CCF µm; maps to Three.js X directly   | FrameSliders (TOP)    | buildSlicePlane v2, BrainViewer       |
| dvPosition  | number | [-2000, 2000] µm  | D-V translation; raw CCF µm; positive = dorsal; negated    | FrameSliders (RIGHT)  | buildSlicePlane v2, BrainViewer       |
|             |        |                   | inside buildSlicePlane to Three.js Y                       |                       |                                       |
| thickness   | string | pill value string | Virtual slice thickness; interpreted by computeSlice       | ControlsPanel         | computeSlice, SavedSlicesPanel        |

Invariants for sliceState v2:
- lrPosition and dvPosition default to 0 on application init and on preset application
  (presets do not modify lrPosition or dvPosition; they remain at current values).
- All 7 fields are updated atomically within the same synchronous dispatch; no
  field subset may be updated in isolation unless explicitly permitted by the
  caller (e.g., a slider updating only its own field via functional setState is
  permitted as long as no other field is stale for more than one render frame).
- applyPreset does NOT write lrPosition or dvPosition; those fields are preserved
  from the current sliceState.

---

### Updated Contract: ControlsPanel (Stage 5)

The ControlsPanel output contract is extended to include lrPosition and dvPosition.
The prior contract entry for sliceState.apPosition valid range `[0, 100] %` was
already corrected to `[0, 13200] µm` in the Stage 4 addendum; that correction
stands. Yaw and roll ranges are further narrowed to [-45, 45] by the Stage 5 frame
slider hardware limits.

Updated output contract (replaces prior ControlsPanel output contract for affected fields):

| Field              | Type    | Valid Range        | Semantics                                    | Who Consumes              |
|--------------------|---------|--------------------|----------------------------------------------|---------------------------|
| sliceState.pitch   | number  | [-90, 90] deg      | Rotation about ML axis (numeric input only)  | buildPlane(), BrainViewer |
| sliceState.yaw     | number  | [-45, 45] deg      | Rotation about DV axis (frame slider BOTTOM) | buildPlane(), BrainViewer |
| sliceState.roll    | number  | [-45, 45] deg      | Rotation about AP axis (frame slider LEFT)   | buildPlane(), BrainViewer |
| sliceState.apPosition | number | [0, 13200] µm   | Raw CCF µm AP translation                   | buildPlane(), BrainViewer |
| sliceState.lrPosition | number | [-3000, 3000] µm| Raw CCF µm L-R translation                  | buildPlane(), BrainViewer |
| sliceState.dvPosition | number | [-2000, 2000] µm| Raw CCF µm D-V translation (positive=dorsal) | buildPlane(), BrainViewer |
| sliceState.thickness| string | pill value string  | Virtual slice thickness                      | computeSlice()             |

---

### Updated Contract: Function buildSlicePlane v2

Replaces the prior `buildPlane(pitch, yaw, roll, apPosition)` contract in all
Stage 5 and later work.

#### Input Contract

| Parameter        | Type   | Valid Range       | Semantics                                         | Who Provides   |
|------------------|--------|-------------------|---------------------------------------------------|----------------|
| pitch            | number | [-90, 90] deg     | Rotation about ML axis                            | sliceState     |
| yaw              | number | [-45, 45] deg     | Rotation about DV axis                            | sliceState     |
| roll             | number | [-45, 45] deg     | Rotation about AP axis                            | sliceState     |
| apPositionMicrons| number | [0, 13200] µm     | AP translation; raw CCF µm; maps to Three.js Z    | sliceState     |
| lrMicrons        | number | [-3000, 3000] µm  | L-R translation; raw CCF µm; maps to Three.js X   | sliceState     |
| dvMicrons        | number | [-2000, 2000] µm  | D-V translation; raw CCF µm; positive=dorsal;     | sliceState     |
|                  |        |                   | negated to Three.js Y inside this function        |                |

#### Output Contract

| Return      | Type        | Semantics                                               | Who Consumes               |
|-------------|-------------|----------------------------------------------------------|----------------------------|
| THREE.Plane | THREE.Plane | Oriented cutting plane; normal is unit length; plane     | computeSlice, BrainViewer  |
|             |             | origin is `(lrMicrons, -dvMicrons, apPositionMicrons)`   | (SlicePlaneWidget)         |

Center vector construction (must be implemented exactly):
```
center = new THREE.Vector3(
  lrMicrons,           // threeX: L-R axis
  -dvMicrons,          // threeY: flipped (dorsal up = negative Y in Three.js)
  apPositionMicrons    // threeZ: AP axis (raw µm — no /1000, carry-forward invariant)
)
```

#### Invariants
- The returned plane normal is always a unit vector (length = 1.0 ± 1e-6).
- Rotation order for pitch/yaw/roll is XYZ intrinsic (carry-forward from Stage 2;
  see HISTORY for rationale). Not changed in Stage 5.
- At pitch=0, yaw=0, roll=0, lrMicrons=0, dvMicrons=0, the plane is axis-aligned
  (coronal cut centered on the AP axis).
- apPositionMicrons, lrMicrons, and dvMicrons are all in raw CCF µm. No division
  or multiplication factor is applied to any of them inside this function.
- The DV negation (`-dvMicrons`) is applied ONLY inside this function. dvPosition
  in sliceState is always stored with the anatomist's sign convention (positive =
  dorsal); the negation is an internal implementation detail.

#### Failure Modes
- MUST NOT return a plane with a zero or near-zero normal vector.
- MUST assert (warn + clamp) if any positional argument exceeds its declared range
  (CR-11 mitigation).
- MUST NOT silently accept NaN or Infinity in any parameter.
- MUST NOT divide apPositionMicrons, lrMicrons, or dvMicrons by 1000 or any other
  factor.

---

## Module: SavedSlicesPanel (Module 11)

### Input Contract

| Field           | Type           | Valid Range              | Semantics                                           | Who Provides           |
|-----------------|----------------|--------------------------|-----------------------------------------------------|------------------------|
| savedSlices     | SavedSlice[]   | length [0, N]            | Current list of all saved slices                    | Shared state           |
| sliceState      | object         | sliceState v2 shape      | Read-only; used for highlight sync on recall        | Shared state           |

SavedSlice shape consumed by this module:

| Field        | Type                    | Valid Range          | Semantics                                          |
|--------------|-------------------------|----------------------|----------------------------------------------------|
| id           | string                  | Non-empty, unique    | `Date.now().toString()` at creation time           |
| name         | string                  | Non-empty            | User-visible display label                         |
| pitch        | number                  | [-90, 90] deg        | Frozen at save time                                |
| yaw          | number                  | [-45, 45] deg        | Frozen at save time                                |
| roll         | number                  | [-45, 45] deg        | Frozen at save time                                |
| apPosition   | number                  | [0, 13200] µm        | Frozen at save time; raw CCF µm                    |
| lrPosition   | number                  | [-3000, 3000] µm     | Frozen at save time; raw CCF µm                    |
| dvPosition   | number                  | [-2000, 2000] µm     | Frozen at save time; raw CCF µm                    |
| thickness    | string                  | pill value string    | Frozen at save time                                |
| preset       | 'tc' \| 'hippo' \| null | —                    | Active preset at save time                         |
| sliceResult  | object                  | sliceResult shape    | Full intersection snapshot at save time            |
| thumbnail    | string                  | data URL (PNG)       | 60x45 px (or OD-11 alternative) PNG data URL       |
| savedAt      | string                  | ISO 8601             | Creation timestamp                                 |

### Output Contract

| Side effect                  | Semantics                                                       | Who Consumes             |
|------------------------------|-----------------------------------------------------------------|--------------------------|
| Delete: savedSlices update   | Removes one entry by id; rest of array preserved                | Shared state             |
| Recall: setSliceState        | Sets all 7 sliceState v2 fields from the saved slice            | buildSlicePlane, BrainViewer |
| Recall: setSelectedThickness | Sets thickness pill value                                       | computeSlice             |
| Recall: setHighlightState    | Restores preset + highlighted array                             | BrainViewer, SliceOutputPanel |
| Recall: handleGenerateSlice  | Reruns intersection with restored state                         | SliceOutputPanel         |
| Recall: scroll right panel   | Scrolls right panel scrollTop to 0                              | DOM                      |
| Export: file download        | JSON blob: `{ tool, version, exportedAt, slices: [...] }`       | User filesystem          |
| Import: file input           | Parses JSON, appends slices to savedSlices; no replace          | Shared state             |

### Invariants
- Recall is atomic: all 5 state mutations and handleGenerateSlice() are dispatched
  in the same synchronous execution context; no await between them.
- Delete removes exactly one entry (the entry matching the given id); all other
  entries are preserved in their original order.
- Import appends imported slices after existing slices; it never replaces the
  existing list.
- Unknown acronyms in imported intersection data (not present in CCF_STRUCTURES
  at import time) are rendered with fallback color `'#888888'`; they are not
  silently dropped or thrown on.
- Export JSON always includes `tool`, `version`, and `exportedAt` fields in
  addition to `slices`.

### Failure Modes
- MUST NOT silently skip the scroll step on recall; if the right panel ref is not
  available, log a warning but complete the other recall steps.
- MUST NOT throw on import of a file with an unrecognized structure acronym; must
  apply the fallback color.
- MUST NOT allow a partial recall (e.g., sliceState restored but highlightState
  not restored); all fields update or none do.
- MUST NOT render a thumbnail `<img>` with a null or undefined src; if thumbnail
  is missing, display a placeholder gray box.
- MUST NOT write to cameraState, visibilityState, or the Three.js scene directly.

---

## Module: FrameSliders (Module 12)

### Input Contract

| Field          | Type                | Valid Range          | Semantics                                           | Who Provides      |
|----------------|---------------------|----------------------|-----------------------------------------------------|-------------------|
| sliceState     | object              | sliceState v2 shape  | Current slider values for display sync              | Shared state      |
| containerRef   | React.RefObject     | ref to canvas container DOM element | Used by ResizeObserver to measure clientHeight for vertical slider sizing | BrainViewer (passed as prop) |

### Output Contract

| Field                    | Type   | Valid Range       | Semantics                                            | Who Consumes      |
|--------------------------|--------|-------------------|------------------------------------------------------|-------------------|
| sliceState.lrPosition    | number | [-3000, 3000] µm  | Written on every TOP slider onChange event           | buildSlicePlane v2, BrainViewer |
| sliceState.roll          | number | [-45, 45] deg     | Written on every LEFT slider onChange event          | buildSlicePlane v2, BrainViewer |
| sliceState.dvPosition    | number | [-2000, 2000] µm  | Written on every RIGHT slider onChange event         | buildSlicePlane v2, BrainViewer |
| sliceState.yaw           | number | [-45, 45] deg     | Written on every BOTTOM slider onChange event        | buildSlicePlane v2, BrainViewer |

Each slider also renders a live value pill showing the current numeric value with
units (µm for lrPosition/dvPosition; ° for yaw/roll).

### Invariants
- onChange (not onMouseUp) is the event used for all four sliders; updates are
  live on every drag tick.
- The ResizeObserver fires on initial mount (first observation) AND on subsequent
  container resizes. On each fire, the vertical sliders' width is set to
  `containerRef.current.clientHeight + 'px'`.
- The ResizeObserver is disconnected in the useEffect cleanup function to prevent
  memory leaks.
- FrameSliders writes only to sliceState fields lrPosition, roll, dvPosition, and
  yaw. It does not touch pitch, apPosition, thickness, highlightState, savedSlices,
  cameraState, or viewLocked.
- Slider displayed value always reflects the current sliceState value (controlled
  input pattern), not an internal cached value.

### Failure Modes
- MUST NOT use onMouseUp or onPointerUp as the sole event source; onChange must
  fire on every intermediate drag position.
- MUST NOT silently fail if containerRef.current is null; must skip the width
  assignment and log a warning.
- MUST NOT write to any state other than sliceState fields declared above.
- MUST NOT apply any scale factor or unit conversion to slider values before
  writing to sliceState; the raw numeric value from the range input is written
  directly (µm or degrees as appropriate to the slider).

---

## Updated Cross-Module Invariant (Stage 5 addition)

The following invariant is appended to the Cross-Module Invariants list:

7. **All three slicePlane translation axes use raw CCF µm.** apPosition, lrPosition,
   and dvPosition in sliceState and buildSlicePlane v2 are all in raw CCF µm with
   no scaling factor applied at any module boundary. The DV axis sign convention
   (positive = dorsal in sliceState, negated to Three.js Y inside buildSlicePlane)
   is the only transform permitted. No other unit conversion (e.g., /1000, *25,
   voxel-to-µm) may be applied to these fields outside of buildSlicePlane's center
   vector construction. This invariant extends the carry-forward rule from Stage 4
   (apPosition raw µm) to all three positional axes.
