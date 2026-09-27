"""The mobile metrics ratchet (#1379, epic #1376).

Walks all 39 views on a phone and on two tablets, with touch emulation on, and
fails when any number is worse than ``ci/mobile-metrics-baseline.json`` records:
less of the first screen showing the view, taller chrome, more targets under
44px or 24px, more text fields under 16px, more controls only reachable by
hover, or a form whose action buttons something is covering.

It never fails because a number got *better*. It says so instead, and the
baseline is lowered to hold the gain:

    uv run python scripts/mobile_metrics.py --write-baseline

``scripts/mobile_metrics.py`` holds the walk and its docstring says what each
number means. This file only runs it in CI's ``ui`` job, one device per test so
``-n auto`` spreads them across workers.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from mobile_metrics import DEVICES, compare, load_baseline, walk  # noqa: E402


@pytest.mark.parametrize("device", sorted(DEVICES))
def test_no_mobile_metric_is_worse_than_the_baseline(browser, app_server, device):
    baseline = load_baseline()
    assert baseline, "ci/mobile-metrics-baseline.json is missing; run scripts/mobile_metrics.py --write-baseline"

    measured = {device: walk(browser, app_server, device)}
    walked = [v for v in measured[device]["views"].values() if v is not None]
    assert len(walked) >= 39, f"only {len(walked)} views could be measured on {device}"

    worse, better = compare(baseline, measured)
    if worse:
        # A view caught mid-render -- the walk's settle gives up after 2.5s,
        # and this job shares its cores with the other devices' walks -- can
        # read a transient state. Measure just those views once more, from a
        # fresh page: a real regression reproduces, a render in flight does
        # not.
        views = sorted({line.split(" view ", 1)[1].split(":", 1)[0] for line in worse if " view " in line})
        again = walk(browser, app_server, device, only=set(views)) if views else {"views": {}, "forms": {}}
        remeasured = {device: {"views": {**measured[device]["views"], **again["views"]},
                               "forms": measured[device]["forms"]}}
        worse, better = compare(baseline, remeasured)
    for line in better:
        print(f"better: {line}")
    if better and not worse:
        print("Lower the baseline so the gain is held: uv run python scripts/mobile_metrics.py --write-baseline")
    assert not worse, "Mobile metrics got worse:\n  " + "\n  ".join(worse)
