# `/api/parse` benchmark: Phase 0 of #788 (issue #789)

`POST /api/parse` runs on essentially every plan edit. Phase 0 removed the work
in it that nobody read and the work it did twice:

1. `PlanService.parse()` built an ASCII table (`ascii_output`) that no
   `/api/parse` caller reads; building it scheduled the whole plan a second
   time. It is now opt-in (`include_ascii`), and `/render` still produces it.
2. The summary roll-up (`calculate_summary_dates`) rescanned the task list for
   every summary and recomputed nested summaries without remembering them: a
   300-summary plan did the roll-up 1,200 times. Children are now indexed once
   and each summary is computed once, bottom-up. `build_ordered_list` shares
   the index.
3. The task-line tokeniser's 25 regular expressions are compiled once at
   module level instead of being looked up per call.

Every `/api/parse` response field the frontend reads is byte-identical before
and after, checked by dumping the full payload (minus `ascii_output`) for the
six bundled templates, the four round-trip fixtures and two generated plans
and diffing. `tests/test_parse_once.py` asserts the plan is scheduled once per
parse, each task line is tokenised once, and the indexed roll-up matches the
old per-summary scan over the same corpus.

## How to reproduce

```
uv run scripts/benchmark_parse.py --runs 15 --markdown
```

`parse ms` is the default path; `with-ascii ms` is the pre-#789 behaviour
(`include_ascii=True`), kept in the harness so the saving stays measurable.

## Results

Median of 5 runs, one warm-up discarded, Apple Silicon Mac, Python 3.14.
"Before" is commit `e8a1d04` (main before this change); "after" is this branch.

### `PlanService.parse()` alone

| tasks | rows | before (ms) | after (ms) | speed-up |
|---:|---:|---:|---:|---:|
| 110 | 171 | 11.3 | 3.6 | 3.1× |
| 275 | 426 | 40.5 | 8.9 | 4.6× |
| 550 | 851 | 113.3 | 17.7 | 6.4× |
| 1,100 | 1,701 | 369.4 | 37.3 | 9.9× |

The speed-up grows with plan size because the roll-up fix removes a quadratic
term, not just the constant ~55% the ASCII table accounted for.

### Full endpoint (`POST /api/parse` via TestClient, adds JSON encoding)

| tasks | rows | after HTTP (ms) |
|---:|---:|---:|
| 110 | 171 | 9.2 |
| 275 | 426 | 19.7 |
| 550 | 851 | 38.5 |
| 1,100 | 1,701 | 75.2 |

### Raspberry Pi 5 (the deployment target)

Before, measured on the Pi for PR #800 (median of 15 runs):

| tasks | parse ms | HTTP ms |
|---:|---:|---:|
| 110 | 35.7 | 52.6 |
| 275 | 109.9 | 146.7 |
| 550 | 302.8 | 373.0 |
| 1,100 | 980.5 | 1,108.8 |

After: **not yet measured on the Pi**. Run the command above on the Pi after
deploying and record the table on #788; the Mac ratio suggests the 1,100-task
parse should drop from about a second to roughly 100 ms.
