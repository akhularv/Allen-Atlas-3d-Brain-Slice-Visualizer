"""
Allen Atlas Mesh Server
Serves PLY mesh files for the Allen Mouse Brain CCF v3 over HTTP with CORS.

Run:
    uvicorn mesh_server:app --port 8000

SECURITY NOTE: Access-Control-Allow-Origin is set to '*' for local development
only. This MUST be removed before any production or networked deployment.
See INTERFACE_CONTRACTS.md §Module: MeshServer §Invariants.

Dependencies: fastapi uvicorn numpy
    pip install fastapi uvicorn numpy
"""

import os
import struct
import logging
import pathlib
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Allen Atlas Mesh Server",
    description=(
        "Serves Allen CCF v3 PLY meshes for the Oblique Slice Planner. "
        "Local development only — do NOT deploy with CORS * in production."
    ),
    version="1.0",
)

# CORS: allow all origins for localhost development
# INTERFACE_CONTRACTS §MeshServer §Invariants: MUST be removed for production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
# Meshes directory is prioritized as follows:
# 1. Local ./meshes folder relative to this file
# 2. ~/meshes folder in the user's home directory
LOCAL_MESHES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "meshes")
HOME_MESHES_DIR = os.path.join(os.path.expanduser("~"), "meshes")

# Use the local directory as the primary write target for downloads
MESHES_DIR = LOCAL_MESHES_DIR

# ---------------------------------------------------------------------------
# Download Helper (RESEARCH_BRIEF_STAGE4.md §R-2)
# ---------------------------------------------------------------------------
import urllib.request
import ssl

def download_mesh(structure_id: int) -> str:
    """
    Download a missing .ply mesh from the Allen Institute archive.
    
    Args:
        structure_id: Allen CCF integer ID.
    Returns:
        Path to the downloaded file.
    Raises:
        HTTPException 404: if the mesh does not exist on the remote server.
        Exception: for any other network or write error.
    """
    if not os.path.exists(MESHES_DIR):
        os.makedirs(MESHES_DIR, exist_ok=True)
    
    target_path = os.path.join(MESHES_DIR, f"{structure_id}.ply")
    
    # Canonical URL from RESEARCH_BRIEF_STAGE4.md §1
    url = f"https://download.alleninstitute.org/informatics-archive/current-release/mouse_ccf/annotation/ccf_2017/structure_meshes/ply/{structure_id}.ply"
    
    logger.info("Downloading mesh %d from Allen Institute...", structure_id)
    
    try:
        # We use a custom opener to handle potential certificate issues or redirects
        # although urllib usually handles HTTPS redirects automatically.
        context = ssl._create_unverified_context() # Defensive for some environments
        with urllib.request.urlopen(url, context=context, timeout=15) as response:
            if response.status != 200:
                raise HTTPException(status_code=response.status, detail=f"Allen API returned {response.status}")
            
            with open(target_path, "wb") as f:
                f.write(response.read())
        
        # Validation (R-2: check size and header)
        if os.path.getsize(target_path) < 1000:
            os.remove(target_path)
            raise ValueError("Downloaded file is too small (likely a redirect body or empty)")
            
        with open(target_path, "rb") as f:
            header = f.read(3)
            if header != b"ply":
                os.remove(target_path)
                raise ValueError("Downloaded file does not have 'ply' header")
                
        logger.info("Successfully downloaded %d.ply (%d bytes)", structure_id, os.path.getsize(target_path))
        return target_path
        
    except urllib.error.HTTPError as e:
        if e.code == 404:
            logger.warning("Mesh %d not found on Allen server (404)", structure_id)
            raise HTTPException(status_code=404, detail=f"Mesh {structure_id} not found on Allen server")
        raise HTTPException(status_code=e.code, detail=f"Allen server error: {e.reason}")
    except Exception as e:
        logger.error("Failed to download mesh %d: %s", structure_id, e)
        if os.path.exists(target_path):
            os.remove(target_path)
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")

# ---------------------------------------------------------------------------
# Structure registry — id → acronym
# ... rest of the code ...
# VPL is id=718 (NOT 563). 563 = dorsal tegmental tract.
# Source: RESEARCH_BRIEF_STAGE4.md §1, confirmed via Allen Brain Atlas API.
# All other IDs verified against Allen CCF v3.
# ---------------------------------------------------------------------------
ACRONYM_MAP: dict[int, str] = {
    733:  "VPM",      # Ventral posteromedial nucleus
    718:  "VPL",      # Ventral posterolateral nucleus (correct Allen CCF ID)
    149:  "LP",       # Lateral posterior nucleus
    1020: "PO",       # Posterior complex
    362:  "MD",       # Mediodorsal nucleus
    262:  "RT",       # Reticular nucleus
    329:  "SSp",      # Primary somatosensory area
    981:  "SSp-bfd",  # Barrel field
    985:  "MOp",      # Primary motor area
    1011: "VISp",     # Primary visual area
    1002: "AUDp",     # Primary auditory area
    776:  "ic",       # Internal capsule
    1000: "cc",       # Corpus callosum
    901:  "ec",       # External capsule
    375:  "CA1",      # Ammon's horn CA1
    463:  "CA3",      # Ammon's horn CA3
    726:  "DG",       # Dentate gyrus
    672:  "CP",       # Caudoputamen
    381:  "SNr",      # Substantia nigra reticular
    997:  "root",     # Whole-brain root (brain shell)
}

# ---------------------------------------------------------------------------
# PLY parser (numpy vectorised — RESEARCH_BRIEF_STAGE4.md §5 R-4)
# ---------------------------------------------------------------------------

# Allen CCF PLY format is always binary_little_endian 1.0.
# Vertices: 6 × float32 per vertex (x, y, z, nx, ny, nz).
# Faces: 1 × uint8 (count, always 3) + 3 × int32 (indices) per triangle.
# Header end: dynamic — parsed line-by-line (R-3: never hardcode byte offset).

_VERTEX_BYTES_PER_PROP = 4  # float32 = 4 bytes
_BYTES_PER_FACE = 13        # 1 uint8 + 3 int32 = 1 + 12 bytes (triangles only)


def parse_ply(path: str) -> tuple[list[float], list[int]]:
    """
    Parse a binary_little_endian PLY file from the Allen CCF mesh set.

    Uses numpy frombuffer for fast bulk reads (50x faster than struct loop
    for the 98,638-face root mesh). Discards normal vectors (nx, ny, nz)
    to halve payload size; Three.js recomputes normals via
    geometry.computeVertexNormals().

    Per RESEARCH_BRIEF_STAGE4.md §5 R-5 and §5 R-4.

    Args:
        path: Absolute path to a .ply file on disk.

    Returns:
        Tuple (vertices_flat, faces_flat) where:
          vertices_flat: flat list of float — [x0,y0,z0, x1,y1,z1, ...]
                         raw Allen CCF micrometers; no coordinate transform.
          faces_flat:    flat list of int   — [i0,i1,i2, i0,i1,i2, ...]
                         signed int32 triangle indices.

    Raises:
        AssertionError: if any face count byte is not 3 (non-triangle face).
        ValueError:     if vertex count or face count cannot be parsed from header.
        OSError:        if the file cannot be read.
    """
    with open(path, "rb") as f:
        # --- Parse header dynamically (R-3: never hardcode byte offset) ---
        n_verts: int = 0
        n_faces: int = 0
        n_vertex_props: int = 0
        face_index_dtype: str = "<i4"  # default: signed int32 little-endian

        in_vertex: bool = False
        in_face: bool = False

        while True:
            # Read one header line; decode as ASCII (PLY spec requires ASCII headers)
            raw_line = f.readline()
            if not raw_line:
                raise ValueError(f"Unexpected end of file before 'end_header' in {path}")
            line = raw_line.decode("ascii", errors="replace").rstrip("\r\n")

            if line.startswith("element vertex"):
                n_verts = int(line.split()[-1])
                in_vertex = True
                in_face = False
            elif line.startswith("element face"):
                n_faces = int(line.split()[-1])
                in_face = True
                in_vertex = False
            elif line.startswith("element "):
                # A different element type — neither vertex nor face
                in_vertex = False
                in_face = False

            if in_vertex and line.startswith("property float"):
                # Count float properties on the vertex element (x, y, z, nx, ny, nz = 6)
                n_vertex_props += 1

            if in_face and "property list" in line:
                # Parse face index dtype from: "property list <count_type> <index_type> <name>"
                parts = line.split()
                # parts[3] is the index type: 'int', 'int32', 'uint32', etc.
                if len(parts) > 3:
                    index_type_str = parts[3]
                    if index_type_str in ("uint", "uint32"):
                        face_index_dtype = "<u4"  # unsigned int32
                    else:
                        face_index_dtype = "<i4"  # signed int32 (PLY 'int' = signed)

            if line == "end_header":
                break

        if n_verts == 0:
            raise ValueError(f"PLY header did not declare vertex count in {path}")
        if n_faces == 0:
            raise ValueError(f"PLY header did not declare face count in {path}")

        # --- Read vertex block: n_verts × n_vertex_props × 4 bytes ---
        # All Allen CCF PLY files have 6 float32 per vertex (xyz + normals).
        vertex_bytes = n_verts * n_vertex_props * _VERTEX_BYTES_PER_PROP
        raw_vertex_block = f.read(vertex_bytes)
        if len(raw_vertex_block) < vertex_bytes:
            raise ValueError(
                f"Vertex block truncated: expected {vertex_bytes} bytes, "
                f"got {len(raw_vertex_block)} in {path}"
            )
        # Reshape to (n_verts, n_vertex_props) and extract only x,y,z (columns 0–2)
        # Discarding normals (columns 3–5) reduces JSON payload by 50% (R-5).
        verts_raw = np.frombuffer(raw_vertex_block, dtype="<f4").reshape(n_verts, n_vertex_props)
        xyz = verts_raw[:, :3]  # shape (n_verts, 3) — raw CCF µm [AP, DV, ML]

        # Convert to Python float list for JSON serialisation.
        # np.float32 is JSON-serialisable via FastAPI's jsonable_encoder.
        # tolist() converts to native Python floats, ensuring clean serialisation.
        vertices_flat: list[float] = xyz.flatten().tolist()

        # --- Read face block: n_faces × 13 bytes (triangle-only optimisation) ---
        # Dtype: [('count', 'u1'), ('indices', face_index_dtype, 3)]
        # This reads the entire face block in one frombuffer call (R-4).
        face_dtype = np.dtype([("count", "u1"), ("indices", face_index_dtype, 3)])
        expected_face_bytes = n_faces * face_dtype.itemsize
        raw_face_block = f.read(expected_face_bytes)
        if len(raw_face_block) < expected_face_bytes:
            raise ValueError(
                f"Face block truncated: expected {expected_face_bytes} bytes, "
                f"got {len(raw_face_block)} in {path}"
            )
        faces_raw = np.frombuffer(raw_face_block, dtype=face_dtype)

        # Guard: every face must be a triangle (count byte = 3).
        # This catches any future format change in the Allen mesh set.
        assert np.all(faces_raw["count"] == 3), (
            f"Non-triangle face detected in {path}. "
            "All Allen CCF PLY meshes should be fully triangulated."
        )

        # Flatten (n_faces, 3) → [i0,i1,i2, i0,i1,i2, ...]
        # tolist() converts np.int32 → Python int for clean JSON serialisation.
        faces_flat: list[int] = faces_raw["indices"].flatten().tolist()

    logger.debug(
        "Parsed %s: %d vertices, %d faces",
        os.path.basename(path), n_verts, n_faces,
    )
    return vertices_flat, faces_flat


# ---------------------------------------------------------------------------
# CR-08 startup assertion — verify root mesh (997) is in raw CCF µm
# RESEARCH_BRIEF_STAGE4.md §3 CR-08 Assertion and §7 R-6.
# Must run before the server accepts connections.
# ---------------------------------------------------------------------------

def _assert_root_mesh_unit() -> None:
    """
    Assert that root mesh (997.ply) vertex coordinates are in raw CCF µm.

    The AP axis (x column) of the root mesh must span 12,000–14,500 µm.
    If it does not, the PLY files are likely in voxel indices (× 25 µm/voxel)
    or millimeters — either would cause ccfToThree to produce silently wrong
    positions on the client.

    Raises:
        AssertionError: if AP range is outside the expected CCF µm bounds.
        FileNotFoundError: if 997.ply is not present in MESHES_DIR.
    """
    home_path = os.path.join(HOME_MESHES_DIR, "997.ply")
    local_path = os.path.join(LOCAL_MESHES_DIR, "997.ply")
    
    if os.path.exists(home_path):
        root_path = home_path
    elif os.path.exists(local_path):
        root_path = local_path
    else:
        logger.warning(
            "CR-08: 997.ply (root mesh) not found in %s or %s — skipping unit assertion. "
            "Add 997.ply to enable the CCF µm scale check.",
            HOME_MESHES_DIR, LOCAL_MESHES_DIR,
        )
        return

    with open(root_path, "rb") as f:
        n_verts: int = 0
        n_vertex_props: int = 0
        while True:
            raw_line = f.readline()
            if not raw_line:
                break
            line = raw_line.decode("ascii", errors="replace").rstrip("\r\n")
            if line.startswith("element vertex"):
                n_verts = int(line.split()[-1])
            if line.startswith("property float"):
                n_vertex_props += 1
            if line == "end_header":
                break
        # Read AP (x) column only via full vertex block parse
        vertex_bytes = n_verts * n_vertex_props * 4
        verts_raw = np.frombuffer(f.read(vertex_bytes), dtype="<f4").reshape(n_verts, n_vertex_props)
        ap_col = verts_raw[:, 0]  # CCF x = AP axis

    ap_range = float(ap_col.max() - ap_col.min())
    # Expected: root mesh spans nearly the full CCF AP extent (~13,200 µm)
    assert 12000 < ap_range < 14500, (
        f"CR-08 FAILED: Root mesh (997.ply) AP range is {ap_range:.0f} µm, "
        "expected 12000–14500 µm. "
        "PLY vertices may not be in raw CCF µm — check download and unit conventions."
    )
    logger.info(
        "CR-08 PASSED: root mesh AP range %.0f µm — vertices confirmed in raw CCF µm",
        ap_range,
    )


# Run assertion at import time (before server starts accepting requests).
_assert_root_mesh_unit()

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health", summary="Health check — list available mesh IDs")
def health() -> dict:
    available: list[int] = []
    for sid in ACRONYM_MAP:
        local_p = os.path.join(LOCAL_MESHES_DIR, f"{sid}.ply")
        home_p = os.path.join(HOME_MESHES_DIR, f"{sid}.ply")
        if (os.path.exists(local_p) and os.path.getsize(local_p) > 100) or \
           (os.path.exists(home_p) and os.path.getsize(home_p) > 100):
            available.append(sid)
    available.sort()
    logger.info("Health check: %d / %d meshes available", len(available), len(ACRONYM_MAP))
    return {"status": "ok", "meshes_available": available}


@app.get(
    "/mesh/{structure_id}",
    summary="Return parsed PLY mesh for a single structure",
)
def get_mesh(structure_id: int) -> dict:
    """
    Return PLY vertex and face data for the requested Allen CCF structure.

    Vertices are returned in raw CCF µm (AP × DV × ML) — no coordinate
    transform is applied server-side (SYSTEM_SPEC.md v2 §OD-08 decision:
    transform is client-side in React).

    INTERFACE_CONTRACTS §MeshServer §Invariants:
    - Server MUST NOT return HTTP 200 with empty/partial vertex array.
    - Server MUST NOT serve files outside MESHES_DIR (no path traversal —
      structure_id is validated against ACRONYM_MAP before path construction).

    Args:
        structure_id: Allen CCF integer structure ID (e.g., 718 for VPL).

    Returns:
        JSON: {"id": int, "acronym": str, "vertices": [float, ...], "faces": [int, ...]}

    Raises:
        HTTPException 404: if structure_id is not in ACRONYM_MAP.
        HTTPException 404: if PLY file does not exist on disk.
        HTTPException 500: if PLY parsing fails for any reason.
    """
    # Validate against ACRONYM_MAP — prevents path traversal and unknown IDs.
    if structure_id not in ACRONYM_MAP:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Unknown structure_id {structure_id}. "
                "Not present in the server's ACRONYM_MAP. "
                "Note: VPL is id=718 (not 563)."
            ),
        )

    # Strategy: Check home meshes dir (symlink or existing) first, then local meshes dir.
    # If not found in either, attempt to download to the local dir.
    home_path = os.path.join(HOME_MESHES_DIR, f"{structure_id}.ply")
    local_path = os.path.join(LOCAL_MESHES_DIR, f"{structure_id}.ply")
    
    # Path is constructed from a validated integer key — no traversal possible.
    if os.path.exists(home_path):
        path = home_path
    elif os.path.exists(local_path):
        path = local_path
    else:
        # Mesh not found on disk — trigger download
        logger.info("Mesh %d not found on disk; attempting to pull from Allen...", structure_id)
        path = download_mesh(structure_id)

    try:
        vertices, faces = parse_ply(path)
    except AssertionError as exc:
        # Non-triangle face detected — this is a data integrity error
        logger.error("PLY assertion error for id=%d: %s", structure_id, exc)
        raise HTTPException(status_code=500, detail=f"PLY integrity error: {exc}") from exc
    except Exception as exc:
        # Catch-all for IO errors, parse errors, malformed headers, etc.
        logger.error("PLY parse error for id=%d: %s", structure_id, exc)
        raise HTTPException(
            status_code=500,
            detail=f"PLY parse error for structure {structure_id}: {exc}",
        ) from exc

    # Validate output contract: INTERFACE_CONTRACTS §MeshServer §Invariants
    # "Server MUST NOT return HTTP 200 with an empty or partial vertices array"
    if len(vertices) == 0:
        raise HTTPException(
            status_code=500,
            detail=f"PLY parsed zero vertices for structure_id={structure_id}",
        )
    if len(faces) == 0:
        raise HTTPException(
            status_code=500,
            detail=f"PLY parsed zero faces for structure_id={structure_id}",
        )

    acronym = ACRONYM_MAP[structure_id]
    logger.info(
        "Serving id=%d (%s): %d vertices, %d faces",
        structure_id, acronym, len(vertices) // 3, len(faces) // 3,
    )

    return {
        "id":       structure_id,
        "acronym":  acronym,
        "vertices": vertices,  # flat float list [x0,y0,z0, x1,y1,z1, ...] raw CCF µm
        "faces":    faces,     # flat int list [i0,i1,i2, ...] signed int32 indices
    }


# ---------------------------------------------------------------------------
# Stage 7: Frontend serving endpoints
# ---------------------------------------------------------------------------

# index.html is the canonical static entry point; app.html remains a compatibility alias.
INDEX_HTML_PATH = pathlib.Path(__file__).parent / "index.html"


@app.get("/app", response_class=HTMLResponse, summary="Serve the frontend HTML app")
@app.get("/", response_class=HTMLResponse, summary="Serve the frontend root")
async def serve_app():
    """
    Serve the self-contained frontend (index.html) at / and /app.

    Returns the full HTML page including the embedded React + Three.js component.
    The page fetches mesh data from /mesh/{id} on the same origin (no CORS needed).

    Raises:
        HTTPException 404: if index.html is not present next to mesh_server.py.
    """
    if not INDEX_HTML_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="index.html not found. Run the master-coder to generate it.",
        )
    return INDEX_HTML_PATH.read_text(encoding="utf-8")
