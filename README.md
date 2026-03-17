# Allen Atlas Oblique Slice Planner

Interactive 3D slice-planning tool for thalamocortical, hippocampal, and other
oblique brain preparations using the Allen Mouse Brain Common Coordinate
Framework.

## Why It Is Built This Way

This project is now structured to publish cleanly as a plain static site on
GitHub Pages. The browser can load real Allen CCF `.ply` meshes directly from
the repository's `meshes/` folder, so the published site can show the actual
brain structures without needing a running backend.

The optional local Python mesh server still exists for local workflows where
you want automatic mesh discovery or downloads outside the repo.

## Tech

- Single-file static HTML app for deployment
- React 18 UMD + Three.js via CDN
- Optional FastAPI mesh backend for local high-resolution geometry

## GitHub Pages Deployment

1. Push this folder to a GitHub repository.
2. Enable GitHub Pages to deploy from the repository root.
3. Keep the `.nojekyll` file so the site is served without Jekyll processing.
4. Commit the `meshes/*.ply` files if you want the public site to render real
   Allen structures.
5. Use `index.html` as the public entry point.

The Pages version loads `.ply` files from `./meshes/` automatically. If a mesh
file is missing, that structure falls back to the built-in ellipsoid
representation instead of failing.

## Local Development

For a quick static preview:

```bash
cd /Users/akhularvind/allen_atlas_oblique_slice
python3 -m http.server 8124
```

Then open `http://127.0.0.1:8124/`.

## Local High-Resolution Mesh Mode

To enable live Allen PLY meshes locally:

```bash
cd /Users/akhularvind/allen_atlas_oblique_slice
pip install fastapi uvicorn numpy
python3 launch.py
```

That starts the mesh server and opens the planner in the browser.

Mesh files should live at `./meshes/{id}.ply` for GitHub Pages and can also
live at `~/meshes/{id}.ply` for the local server workflow. If a mesh is
missing, the frontend falls back to the built-in ellipsoid representation.

## What It Does

- Rotates a virtual cutting plane using pitch, yaw, and roll
- Moves the plane in AP, L/R, and D/V coordinates
- Computes a 2D slice intersection view from the current 3D plane
- Highlights circuit-specific structure groups with presets
- Exports PNG, JSON config, and multi-slice session files
- Imports previously exported session files

## Controls

| Control | Function |
|---------|----------|
| Frame sliders (top/left/right/bottom) | L↔R translate, TILT, D↔V translate, YAW |
| ROLL numeric input | Axial spin of the cutting plane |
| Free Orbit / Locked View | Toggle between manual camera orbit and specimen-stage view |
| Generate Slice | Compute the 2D cross-section at the current plane |
| Save Slice | Save current config + thumbnail to the session list |
| Export PNG | Download the 2D slice canvas as PNG |
| Export Config | Download slice parameters as JSON |
| Export Session | Download all saved slices as JSON |
| Import Session | Load a previously exported session JSON |

## Circuit Presets

- **Thalamocortical**: TILT -35°, highlights VPM/VPL/LP/ic/SSp/SSp-bfd/MOp
- **Hippocampal**: YAW +15°, highlights CA1/CA3/DG
- **Reset**: returns all sliders to 0 and clears highlights

## Repo Layout

| File | Purpose |
|------|---------|
| `index.html` | Canonical GitHub Pages entry point |
| `app.html` | Compatibility redirect for older `/app.html` links |
| `meshes/` | Static Allen CCF `.ply` files served directly by GitHub Pages |
| `mesh_server.py` | Optional FastAPI mesh server |
| `launch.py` | One-command local launcher for mesh mode |
| `docs/` | Architecture, research, and history notes |
