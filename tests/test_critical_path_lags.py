"""The critical path honours a link's lag/lead and its type.

The backward pass is the forward pass run in reverse: a successor's late
start (FS, SS) or late finish (FF, SF), shifted back by the link's lag,
bounds the predecessor's finish (FS, FF) or start (SS, SF). It used to take
``min(successor late_start)`` for every link, so a lag gave its predecessor
float it did not have, and an FF link was measured from the wrong end. The
browser engine is held to the same answers by
tests/test_engine_conformance.mjs.
"""

from noodle_web.plan_service import PlanService


def _float(plan):
    return {t["name"]: t["total_float"] for t in PlanService().parse(plan).tasks if not t["is_summary"]}


def test_a_lag_that_drives_the_finish_makes_its_predecessor_critical():
    # B starts two working days after A and ends the project: A cannot slip
    floats = _float("P\n  A 2d 2026-06-01\n  B 2d [depends A +2d]\n  Side 1d 2026-06-01\n")
    assert floats["A"] == 0
    assert floats["B"] == 0
    assert floats["Side"] > 0


def test_a_star_lag_chain_is_critical_end_to_end():
    floats = _float("P\n  First 2d 2026-06-01\n  *Second 3d\n  * +2d Third 2d\n  * -1d Fourth 1d\n")
    assert floats == {"First": 0, "Second": 0, "Third": 0, "Fourth": 0}


def test_a_lead_is_a_link_like_any_other():
    # C overlaps B by a day and ends the project; B's float comes from C
    floats = _float("P\n  B 3d 2026-06-01\n  C 3d [depends B -1d]\n")
    assert floats == {"B": 0, "C": 0}


def test_an_ss_lag_bounds_the_predecessor_start():
    # B starts a day after A starts and runs long; A's start is pinned by it
    floats = _float("P\n  A 2d 2026-06-01\n  B 6d [depends A:SS +1d]\n")
    assert floats == {"A": 0, "B": 0}


def test_an_ff_link_is_measured_from_the_successor_finish():
    # A runs Mon 1 - Thu 4 June and B must finish with it (B is Thu 4th);
    # Tail's last day is Mon 8th, so B -- and A with it -- can slip two
    # working days. Measured from B's start, as the old pass did, A had one.
    floats = _float("P\n  A 4d 2026-06-01\n  B 1d [depends A:FF]\n  Tail 6d 2026-06-01\n")
    assert floats == {"A": 2, "B": 2, "Tail": 0}


def test_a_link_without_lag_or_type_is_unchanged():
    floats = _float("P\n  A 2d 2026-06-01\n  B 2d [depends A]\n  Side 1d 2026-06-01\n")
    assert floats == {"A": 0, "B": 0, "Side": 3}
