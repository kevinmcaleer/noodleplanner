"""Native .mpp export (noodle_core.mpp_writer) and its round trip through
NoodlePlanner's own .mpp importer.

Needs the optional pymppwriter dependency and a Microsoft Project template at
templates/mpp-template.mpp (or NOODLE_MPP_TEMPLATE); both are skipped
gracefully when absent so CI without them stays green.
"""

import os
from pathlib import Path

import pytest

TEMPLATE = os.environ.get(
    "NOODLE_MPP_TEMPLATE",
    str(Path(__file__).resolve().parent.parent / "templates" / "mpp-template.mpp"),
)
pymppwriter = pytest.importorskip("pymppwriter")
pytestmark = pytest.mark.skipif(
    not os.path.exists(TEMPLATE), reason="needs an .mpp template (NOODLE_MPP_TEMPLATE)"
)

PLAN = """Phase 1
  Proposal 1d 100% @kevin 2026-07-01
  *Approval 0d @kevin
  Build 5d @adam, @kevin 50%
Phase 2
  Review 2d @kevin
  Ship 1d
"""


def _export(tmp_path):
    from noodle_core.mpp_writer import export_to_mpp

    out = tmp_path / "plan.mpp"
    export_to_mpp(PLAN, str(out), TEMPLATE, project_name="Roundtrip")
    return out


def test_export_produces_native_mpp(tmp_path):
    import olefile

    out = _export(tmp_path)
    ole = olefile.OleFileIO(str(out))
    assert ole.exists("   114/TBkndTask/FixedData")


def test_roundtrip_through_own_importer(tmp_path):
    from noodle_core.msproject import import_from_mpp

    out = _export(tmp_path)
    markdown = import_from_mpp(out.read_bytes())
    # every named task survives the export -> native import cycle
    for name in ("Proposal", "Approval", "Build", "Review", "Ship"):
        assert name in markdown, f"{name!r} missing from re-imported plan:\n{markdown}"
    assert "Phase 1" in markdown and "Phase 2" in markdown


def test_missing_template_raises_clear_error(tmp_path):
    from noodle_core.mpp_writer import MppTemplateError, export_to_mpp

    with pytest.raises(MppTemplateError, match="template"):
        export_to_mpp(PLAN, str(tmp_path / "x.mpp"), str(tmp_path / "nope.mpp"))
