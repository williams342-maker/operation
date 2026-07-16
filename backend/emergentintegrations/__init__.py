"""Local development shim for the unavailable emergentintegrations package.

If the real `emergentintegrations` distribution IS installed (Emergent
preview/production pods), delegate to it: load the site-packages copy and
replace this module in sys.modules so the in-repo shim never shadows the
real integration. On local machines without the package, the shim's
inert submodules are used and `emergent_optional` degrades gracefully.
"""
import importlib.util as _ilu
import sys as _sys
from pathlib import Path as _Path

_SHIM_DIR = _Path(__file__).resolve().parent


def _delegate_to_real() -> bool:
    for entry in _sys.path:
        try:
            cand = _Path(entry) / "emergentintegrations" / "__init__.py"
        except TypeError:
            continue
        if not cand.exists() or cand.resolve().parent == _SHIM_DIR:
            continue
        spec = _ilu.spec_from_file_location(
            "emergentintegrations", cand,
            submodule_search_locations=[str(cand.parent)],
        )
        if spec is None or spec.loader is None:
            continue
        mod = _ilu.module_from_spec(spec)
        _sys.modules["emergentintegrations"] = mod
        spec.loader.exec_module(mod)
        return True
    return False


_delegate_to_real()
