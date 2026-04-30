"""STL → PNG thumbnail renderer.

Pure-Python via `trimesh` (binary + ASCII STL) + Matplotlib's Agg backend
(no OpenGL / GPU needed — works in K8s pods). Output is an 800×600 PNG
matching the Crafters Market industrial palette so generated thumbs
slot into the gallery without looking out of place.

Used by the community-files variants pipeline: when a maker uploads an
STL with no thumbnail, the FileCard exposes a "Render thumbnail" button
that calls the convert endpoint, which uploads the resulting PNG to R2
and stamps it on the design_files row's `thumbnail_url`.
"""
from __future__ import annotations
import io
import logging

logger = logging.getLogger("crafters")

# Bigger STLs are common (printable models can be 30-50 MB) — but rendering
# >100 MB worth of triangles takes minutes and would block the upload bay
# even with a thread executor. Cap at 50 MB; bigger files raise 422.
MAX_STL_BYTES = 50 * 1024 * 1024

# Triangle-count guard. A 50 MB binary STL is ~1M triangles — past that
# matplotlib's Poly3DCollection slows to a crawl. Decimate-or-refuse.
MAX_TRIANGLES = 250_000


def render_stl_to_png(
    stl_bytes: bytes,
    width: int = 800,
    height: int = 600,
    elev: float = 30.0,
    azim: float = -60.0,
) -> bytes:
    """Render an STL to PNG bytes.

    Raises `ValueError` on parse / size / decimation failures. The endpoint
    layer translates these to clean 4xx responses.
    """
    if not stl_bytes:
        raise ValueError("Empty STL.")
    if len(stl_bytes) > MAX_STL_BYTES:
        raise ValueError(
            f"STL is {len(stl_bytes)//1024//1024} MB — max is {MAX_STL_BYTES//1024//1024} MB.",
        )

    import trimesh
    import matplotlib
    matplotlib.use("Agg")  # headless safe
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    try:
        mesh = trimesh.load(io.BytesIO(stl_bytes), file_type="stl")
    except Exception as e:
        raise ValueError(f"Couldn't parse STL: {e}")

    # Some STLs load as a Scene (multiple meshes). Concat into a single Trimesh.
    if hasattr(mesh, "geometry") and not hasattr(mesh, "faces"):
        try:
            mesh = trimesh.util.concatenate(list(mesh.geometry.values()))
        except Exception as e:
            raise ValueError(f"Couldn't concatenate scene meshes: {e}")
    if not hasattr(mesh, "faces") or len(mesh.faces) == 0:
        raise ValueError("STL has no triangle faces — empty or corrupted.")

    if len(mesh.faces) > MAX_TRIANGLES:
        # Try to simplify; if quadric simplification isn't available, refuse.
        try:
            mesh = mesh.simplify_quadric_decimation(MAX_TRIANGLES)
        except Exception:
            raise ValueError(
                f"STL has {len(mesh.faces)} triangles (limit {MAX_TRIANGLES}). "
                "Re-export from your slicer with a coarser decimation.",
            )

    fig = plt.figure(figsize=(width / 100, height / 100), dpi=100, facecolor="#0a0a0a")
    ax = fig.add_subplot(111, projection="3d")
    ax.set_facecolor("#0a0a0a")

    poly = Poly3DCollection(
        mesh.vertices[mesh.faces],
        facecolor="#ff4500",
        edgecolor="#262626",
        linewidth=0.3,
        alpha=0.95,
    )
    ax.add_collection3d(poly)

    bb = mesh.bounding_box.bounds  # 2x3 array
    dx, dy, dz = bb[1] - bb[0]
    ax.set_xlim(bb[0, 0], bb[1, 0])
    ax.set_ylim(bb[0, 1], bb[1, 1])
    ax.set_zlim(bb[0, 2], bb[1, 2])
    # set_box_aspect can fail on some matplotlib versions when an axis is 0;
    # we tuck behind try/except because the render still works without it.
    try:
        ax.set_box_aspect((max(dx, 1e-6), max(dy, 1e-6), max(dz, 1e-6)))
    except Exception:
        pass
    ax.view_init(elev=elev, azim=azim)
    ax.set_axis_off()

    out = io.BytesIO()
    try:
        fig.savefig(
            out,
            format="png",
            bbox_inches="tight",
            pad_inches=0.1,
            facecolor="#0a0a0a",
        )
    finally:
        plt.close(fig)
    return out.getvalue()
