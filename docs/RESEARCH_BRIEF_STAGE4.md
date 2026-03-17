# Research Brief — Allen Atlas Oblique Slice Planner (Stage 4)
Date: 2026-03-09  |  Spec Version Referenced: SYSTEM_SPEC.md v2 (Stage 4 Addendum)

---

## 1. Download Status

All files downloaded from:
`https://download.alleninstitute.org/informatics-archive/current-release/mouse_ccf/annotation/ccf_2017/structure_meshes/ply/{id}.ply`

NOTE: The HTTP URL (no TLS) returns a 301 redirect to HTTPS. `curl` must be invoked with `-L` to follow the redirect. Without `-L`, curl writes the 167-byte HTML redirect body as the output file, and the download silently appears to succeed. This is the primary failure mode for naive download scripts.

### Downloaded Successfully (19 / 20)

| Structure ID | Name      | File Size | Status         |
|-------------|-----------|-----------|----------------|
| 733         | VPM       | 63 KB     | OK             |
| 149         | LP        | 30 KB     | OK             |
| 1020        | PO        | 55 KB     | OK             |
| 362         | MD        | 51 KB     | OK             |
| 262         | RT        | 115 KB    | OK             |
| 329         | SSp       | 154 KB    | OK             |
| 981         | SSp-bfd   | 87 KB     | OK             |
| 985         | MOp       | 268 KB    | OK             |
| 1011        | VISp      | 63 KB     | OK             |
| 1002        | AUDp      | 71 KB     | OK             |
| 776         | ic        | 919 KB    | OK             |
| 1000        | cc        | 174 KB    | OK             |
| 901         | ec        | 198 KB    | OK             |
| 375         | CA1       | 449 KB    | OK             |
| 463         | CA3       | 240 KB    | OK             |
| 726         | DG        | 263 KB    | OK             |
| 672         | CP        | 410 KB    | OK             |
| 381         | SNr       | 67 KB     | OK             |
| 997         | root      | 2.4 MB    | OK             |

### Failed / Wrong ID (1 / 20)

| Structure ID | Intended Name | Result                  | Correct ID    |
|-------------|---------------|-------------------------|---------------|
| 563         | VPL           | HTTP 404 (NoSuchKey)   | **718** (see below) |

**VPL Correction**: Allen CCF structure ID 563 is the **dorsal tegmental tract (DTT)**, not VPL. The ventral posterolateral nucleus of the thalamus is structure ID **718**. Confirmed via Allen Brain Atlas API query (`model::Structure,[acronym$eq'VPL']`). The PLY file for ID 718 downloads successfully (66 KB, 1359 vertices, 2710 faces) and its coordinate ranges (AP: 6195–7665, DV: 3401–4940, ML: 3221–8148 µm) place it correctly in the thalamus, adjacent to VPM (733).

**Action required**: Replace structure ID 563 with 718 in any structure registry, download script, or `CCF_STRUCTURES` registry entry for VPL.

Downloaded: `/Users/akhularvind/meshes/718.ply`

---

## 2. PLY Format

All 19 successfully downloaded files (including 718) share **identical format**. There are no format variants across the structure set.

### Exact Header (copy-paste from `head` of 733.ply and 997.ply)

**733.ply** (header ends at byte 229):
```
ply
format binary_little_endian 1.0
element vertex 1290
property float x
property float y
property float z
property float nx
property float ny
property float nz
element face 2572
property list uchar int vertex_indices
end_header
```

**997.ply** (header ends at byte 231 — two extra bytes from longer vertex count field):
```
ply
format binary_little_endian 1.0
element vertex 49324
property float x
property float y
property float z
property float nx
property float ny
property float nz
element face 98638
property list uchar int vertex_indices
end_header
```

### Format Summary

| Field                     | Value                              |
|---------------------------|------------------------------------|
| Encoding                  | `binary_little_endian 1.0`         |
| Vertex layout             | 6 × float32 = 24 bytes per vertex  |
| Vertex properties         | x, y, z, nx, ny, nz (no extras)   |
| Face encoding             | `property list uchar int vertex_indices` |
| Face layout               | 1 byte (count) + count × 4 bytes (int32 indices) |
| Face count byte type      | `uchar` = uint8                    |
| Face index type           | `int` = int32 signed, little-endian|
| Polygon type              | Exclusively triangles (count byte always = 3) |
| Normal vectors present    | Yes (nx, ny, nz as float32)        |
| Color properties          | None                               |
| Confidence/other fields   | None                               |

### Binary Layout Verification

For 733.ply (verified by byte-exact arithmetic):

```
File size = header_bytes + vertex_bytes + face_bytes
64,625   = 229 + (1290 × 6 × 4) + (2572 × (1 + 3 × 4))
64,625   = 229 + 30,960 + 33,436
64,625   = 64,625  ✓
```

For 997.ply:
```
2,466,301 = 231 + (49,324 × 6 × 4) + (98,638 × (1 + 3 × 4))
2,466,301 = 231 + 1,183,776 + 1,282,294
2,466,301 = 2,466,301  ✓
```

All faces are triangles — the count byte is always 3. There are no quads, n-gons, or degenerate faces.

---

## 3. Coordinate System

### Axis Mapping

PLY property names and their anatomical meaning in Allen CCF v3:

| PLY property | CCF axis | Direction                              | Full range (root mesh) |
|-------------|----------|----------------------------------------|------------------------|
| x           | AP       | Anterior (+) to Posterior (-)         | -17 to 13,193 µm       |
| y           | DV       | Dorsal (+) to Ventral (-)             | 134 to 7,564 µm        |
| z           | ML       | Medial (0) to Lateral (+, bilateral)  | 486 to 10,891 µm       |

Units are **raw CCF micrometers** throughout. This is consistent with the correction documented in HISTORY and SYSTEM_SPEC.md v2: no division by 1000, no voxel-index scaling.

### CR-08 Assertion (verified)

The AP range of root mesh (997) spans -17 to 13,193 µm. The expected annotation volume is 0–13,200 µm along AP. The -17 µm offset is a normal mesh surface overhang. This PASSES the CR-08 plausibility check. Vertices are confirmed to be in raw CCF µm, not voxel indices and not millimeters.

Add this assertion to `mesh_server.py` startup:
```python
# CR-08 guard: AP extent of root mesh must be 12000–14000 µm
assert 12000 < root_ap_max < 14000, f"Root mesh AP range {root_ap_max:.0f} does not match expected CCF µm scale"
```

### VPM (733) Bounding Box — Thalamus Landmark

| Axis       | Min (µm) | Max (µm) | Mid (µm) |
|-----------|---------|---------|---------|
| AP (x)    | 6,403   | 7,718   | 7,061   |
| DV (y)    | 3,411   | 4,890   | 4,151   |
| ML (z)    | 3,281   | 8,089   | 5,685   |

The wide ML range (3281–8089 µm) reflects that VPM is a bilateral structure — both hemispheres are encoded in the same mesh. This matches the anatomical expectation for a thalamic relay nucleus.

### VPL (718) Bounding Box

| Axis       | Min (µm) | Max (µm) |
|-----------|---------|---------|
| AP (x)    | 6,195   | 7,665   |
| DV (y)    | 3,401   | 4,940   |
| ML (z)    | 3,221   | 8,148   |

VPL and VPM are immediately adjacent in CCF space, consistent with anatomy.

---

## 4. Vertex and Face Counts (All Downloaded Files)

| ID   | Name    | Vertices | Faces   | File Size |
|------|---------|---------|---------|-----------|
| 733  | VPM     | 1,290   | 2,572   | 63 KB     |
| 718  | VPL     | 1,359   | 2,710   | 66 KB     |
| 149  | LP      | 606     | 1,208   | 30 KB     |
| 1020 | PO      | 1,131   | 2,254   | 55 KB     |
| 362  | MD      | 1,040   | 2,072   | 51 KB     |
| 262  | RT      | 2,343   | 4,678   | 115 KB    |
| 329  | SSp     | 3,160   | 6,312   | 154 KB    |
| 981  | SSp-bfd | 1,787   | 3,566   | 87 KB     |
| 985  | MOp     | 5,483   | 10,958  | 268 KB    |
| 1011 | VISp    | 1,295   | 2,582   | 63 KB     |
| 1002 | AUDp    | 1,445   | 2,882   | 71 KB     |
| 776  | ic      | 19,031  | 37,229  | 919 KB    |
| 1000 | cc      | 3,561   | 7,120   | 174 KB    |
| 901  | ec      | 4,049   | 8,090   | 198 KB    |
| 375  | CA1     | 9,198   | 18,388  | 449 KB    |
| 463  | CA3     | 4,906   | 9,804   | 240 KB    |
| 726  | DG      | 5,380   | 10,752  | 263 KB    |
| 672  | CP      | 8,394   | 16,780  | 410 KB    |
| 381  | SNr     | 1,377   | 2,746   | 67 KB     |
| 997  | root    | 49,324  | 98,638  | 2.4 MB    |

Note: In all cases, face count = 2 × vertex count (approximately). This is the expected ratio for a closed triangulated surface mesh (Euler's formula for genus-0 closed surfaces: F ≈ 2V).

---

## 5. Parser Requirements for mesh_server.py

### Python struct format string (server-side parsing)

```python
import struct

VERTEX_STRUCT = struct.Struct('<ffffff')   # little-endian, 6 float32 = 24 bytes
VERTEX_SIZE   = 24                          # bytes per vertex
FACE_COUNT_STRUCT = struct.Struct('<B')     # little-endian, 1 uint8 = count byte
FACE_INDEX_STRUCT = struct.Struct('<iii')   # little-endian, 3 int32 = triangle indices (count always 3)
FACE_ENTRY_SIZE   = 13                      # 1 + 3*4 bytes (valid ONLY because all faces are triangles)

def parse_ply(path):
    with open(path, 'rb') as f:
        # 1. Read header line-by-line until 'end_header'
        n_verts = n_faces = 0
        while True:
            line = f.readline().decode('ascii').strip()
            if line.startswith('element vertex'):
                n_verts = int(line.split()[-1])
            elif line.startswith('element face'):
                n_faces = int(line.split()[-1])
            elif line == 'end_header':
                break

        # 2. Read vertex block: n_verts * 24 bytes
        vertex_block = f.read(n_verts * VERTEX_SIZE)
        vertices = [
            VERTEX_STRUCT.unpack_from(vertex_block, i * VERTEX_SIZE)
            for i in range(n_verts)
        ]
        # vertices[i] = (x, y, z, nx, ny, nz) all in CCF µm / unit normals

        # 3. Read face block: n_faces * 13 bytes (triangle-only optimization)
        face_block = f.read(n_faces * FACE_ENTRY_SIZE)
        faces = []
        offset = 0
        for _ in range(n_faces):
            count = FACE_COUNT_STRUCT.unpack_from(face_block, offset)[0]
            # count is always 3 — assert in production to catch format changes
            assert count == 3, f"Non-triangle face at offset {offset}"
            i0, i1, i2 = FACE_INDEX_STRUCT.unpack_from(face_block, offset + 1)
            faces.append((i0, i1, i2))
            offset += 13

    return vertices, faces
```

### Fast bulk-read alternative (numpy, recommended for large meshes)

```python
import numpy as np

def parse_ply_numpy(path):
    with open(path, 'rb') as f:
        header_end = 0
        n_verts = n_faces = 0
        while True:
            line = f.readline().decode('ascii').strip()
            header_end = f.tell()
            if line.startswith('element vertex'):
                n_verts = int(line.split()[-1])
            elif line.startswith('element face'):
                n_faces = int(line.split()[-1])
            elif line == 'end_header':
                break

        # Read all vertex data as float32 array (shape: n_verts × 6)
        verts_raw = np.frombuffer(f.read(n_verts * 24), dtype='<f4').reshape(n_verts, 6)
        xyz  = verts_raw[:, :3]   # shape (n_verts, 3) — CCF µm positions
        nxyz = verts_raw[:, 3:]   # shape (n_verts, 3) — unit normals (discard if not needed)

        # Read face block: each entry is [count_byte, i0, i1, i2] packed as 1+3*4=13 bytes
        # Dtype trick: read as structured array
        face_dtype = np.dtype([('count', 'u1'), ('indices', '<i4', 3)])
        faces_raw = np.frombuffer(f.read(n_faces * 13), dtype=face_dtype)
        assert np.all(faces_raw['count'] == 3), "Non-triangle face found"
        tri_indices = faces_raw['indices']  # shape (n_faces, 3) — int32

    return xyz, tri_indices
```

### JSON output contract for `/mesh/{structure_id}` endpoint

```json
{
  "id": 733,
  "acronym": "VPM",
  "vertices": [x0, y0, z0, x1, y1, z1, ...],
  "faces": [i0, i1, i2, i3, i4, i5, ...]
}
```

- `vertices`: flat float32 array, length = n_verts × 3 (x,y,z only; normals omitted to reduce payload; Three.js recomputes normals via `geometry.computeVertexNormals()`)
- `faces`: flat int32 array, length = n_faces × 3
- All vertex coordinates are raw CCF µm — no transform applied server-side (per OD-08 decision in SYSTEM_SPEC.md v2)

### Client-side Three.js geometry construction

```javascript
// Apply ccfToThree transform (from SYSTEM_SPEC.md v2, Stage 4 Addendum)
const positions = new Float32Array(data.vertices.length);
for (let i = 0; i < data.vertices.length; i += 3) {
    const ccfX = data.vertices[i];     // AP
    const ccfY = data.vertices[i + 1]; // DV
    const ccfZ = data.vertices[i + 2]; // ML
    positions[i]     =  ccfZ - 5700;   // Three.js X = ML offset
    positions[i + 1] = -(ccfY - 4000); // Three.js Y = DV flipped
    positions[i + 2] = -(ccfX - 5700); // Three.js Z = AP flipped
}
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.setIndex(new THREE.BufferAttribute(new Int32Array(data.faces), 1));
geometry.computeVertexNormals();
```

---

## 6. Root Mesh (997) Assessment

| Metric                                  | Value                          |
|-----------------------------------------|--------------------------------|
| Vertex count                            | 49,324                         |
| Face count                              | 98,638                         |
| Raw file size                           | 2.4 MB                         |
| Three.js position buffer (float32 xyz)  | 591,888 bytes (~578 KB)        |
| Three.js index buffer (int32)           | 1,183,656 bytes (~1.13 MB)    |
| Total GPU buffer for geometry only      | ~1.7 MB                        |
| CR-10 frame rate risk                   | MEDIUM — see below             |

**Browser loading**: The 2.4 MB file will transfer in under 1 second on localhost (no issue). On a shared server (OD-09 scope) this may be noticeable.

**Frame rate**: 49,324 vertices is well within the capability of any integrated GPU for a single mesh. The risk is not the root mesh alone but the **sum** across all loaded structures. If all 20 structures are loaded simultaneously, total vertex count is approximately 125,000 (root mesh 49K + structures 76K). This remains manageable on integrated GPU.

**Flag for CR-10**: The internal capsule (ic, ID 776) has 19,031 vertices — the second largest structure — and combined with the root shell, these two meshes alone account for 68,355 vertices. Chaos Engineer must benchmark with both ic and 997 loaded.

**Recommendation**: Do NOT decimate root mesh in Stage 4. The vertex count does not justify the added complexity. Revisit only if Chaos Engineer benchmarks show < 30 fps with all structures loaded.

---

## 7. Recommendations for Master Coder

### R-1: Correct VPL structure ID (CRITICAL)

Replace ID 563 with ID **718** everywhere VPL appears in `CCF_STRUCTURES` registry, download scripts, and server configuration. ID 563 is a fiber tract (dorsal tegmental tract), not VPL. This is a silent data error — the server would return a 404, triggering the fallback to ellipsoid with no indication of the ID mismatch.

### R-2: Download script must use HTTPS with redirect following

The canonical URL is `https://download.alleninstitute.org/...`. The HTTP version returns a 301 without payload. Any download utility must follow redirects (`curl -L` or `requests.get(allow_redirects=True)`). Add a post-download validation step that checks `file_size > 1000` and `header_bytes[:3] == b'ply'` to catch silent 404/redirect failures.

### R-3: Header end byte offset varies slightly between files

Do NOT hardcode the header end byte offset. Parse the header dynamically by reading lines until `end_header`. Header length is 229 bytes for small vertex counts (4-digit) and 231 bytes for 5-digit vertex counts (997.ply). Any other dynamic header line count difference would also cause an incorrect offset.

### R-4: Face parsing optimization (triangle-only)

All faces in this dataset are triangles (count byte always = 3). The numpy structured-dtype approach (`face_dtype = np.dtype([('count', 'u1'), ('indices', '<i4', 3)])`) reads the entire face block in a single `np.frombuffer` call, which is ~50x faster than a Python loop for the 98,638-face root mesh. Use this approach in `mesh_server.py`. Add the assertion `assert np.all(faces_raw['count'] == 3)` to guard against any future format change.

### R-5: Serve xyz only (omit normals in JSON)

The PLY files store 6 floats per vertex (x, y, z, nx, ny, nz). The normals are pre-computed surface normals. For the JSON API, serve only x, y, z (3 floats per vertex) and call `geometry.computeVertexNormals()` client-side. This reduces JSON payload by 50% (from 24 bytes/vertex to 12 bytes/vertex). For the root mesh, this saves ~590 KB of JSON.

### R-6: CR-08 assertion at server startup

Add a startup check in `mesh_server.py` that loads the root mesh (997.ply) and asserts the AP axis (x column) spans > 12,000 µm. This catches any unit mismatch (voxel indices, millimeters) before the server accepts connections:

```python
xyz, _ = parse_ply_numpy('/path/to/meshes/997.ply')
ap_range = xyz[:, 0].max() - xyz[:, 0].min()
assert 12000 < ap_range < 14500, f"Root mesh AP range {ap_range:.0f} µm is outside expected CCF µm bounds"
```

### R-7: Health endpoint must enumerate actual files on disk (CR-09)

At startup, scan the meshes directory for `*.ply` files and return their integer IDs in the `/health` response. The React client should log a warning for any structure ID present in `CCF_STRUCTURES` but absent from the health response. This surfaces ID mismatches (like the 563 vs 718 issue) immediately on first load.

### R-8: No server-side coordinate transform (OD-08 already decided)

`mesh_server.py` must serve raw CCF µm coordinates. The ccfToThree transform is applied client-side in React. Do not add numpy transform logic to the server. If this decision is reversed in a future stage, it requires Architect sign-off per SYSTEM_SPEC.md v2.

### R-9: Face index type is signed int32

The PLY spec says `property list uchar int vertex_indices`. The word `int` in PLY is 32-bit signed. The Three.js `setIndex` call accepts Int32Array. Do not use Uint32Array — while vertex indices are always positive, the PLY format's `int` type is signed, and using the wrong type would produce incorrect faces for meshes with more than 32,767 vertices (this matters for ic with 19,031 vertices if using Uint16Array, and could matter for root mesh if using signed 16-bit).

---

## 8. Prior Work in HISTORY

HISTORY/allen_atlas_oblique_slice_planner.md records the following relevant decisions for Stage 4:

- **CCF µm units confirmed**: All existing modules use raw CCF µm. PLY vertices are in the same unit. No conversion needed.
- **ccfToThree transform is locked**: `threeX = ccfZ - 5700`, `threeY = -(ccfY - 4000)`, `threeZ = -(ccfX - 5700)`. This was validated in Stage 2.
- **No allensdk needed**: PLY files are available directly via HTTPS. The allensdk download path was not used in this brief (HTTPS direct download was sufficient and faster).
- **stage 3 known limitation**: "No per-vertex color, no real Allen mesh geometry — all structures are axis-aligned scaled ellipsoids. Future upgrade path: replace ellipsoids with real CCF PLY meshes via local FastAPI backend with CORS headers." Stage 4 implements this.

---

## Handoff Status

Files written:
- `/Users/akhularvind/RESEARCH_BRIEF_STAGE4.md` (this file)
- `/Users/akhularvind/meshes/` — 19 PLY files downloaded and verified (718.ply added as correct VPL; 563.ply is a 404 placeholder)

Methods reviewed: 2 PLY binary parsing approaches (struct loop, numpy frombuffer)
Top recommendation: numpy frombuffer with structured dtype for face block
Most critical gap found: ID 563 is not VPL — use 718 instead (CRITICAL data error if not corrected)

[OPEN DECISION] resolved: OD-08 (coordinate transform location = client-side) is confirmed correct by the data — serving raw CCF µm is the right API contract.

DataMaster and Neuro Hypothesis agents may now proceed.

Sources:
- [Allen Mouse Brain Common Coordinate Framework (CCF v3)](https://doi.org/10.1016/j.cell.2020.04.007)
- [Allen CCF 2020 version — ABC Atlas Data Access](https://alleninstitute.github.io/abc_atlas_access/descriptions/Allen-CCF-2020.html)
- [Allen Brain Atlas API — Structure query](https://api.brain-map.org/api/v2/data/query.json?criteria=model::Structure,rma::criteria,[acronym$eq%27VPL%27])
- [PLY file format specification (Turk, 1994)](http://paulbourke.net/dataformats/ply/)
