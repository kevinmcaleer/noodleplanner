"""Unit tests for the pure-Python MPP binary reader.

The reader was the least-tested module in noodle_core: the only coverage came
from mocking ``MppProject.read`` wholesale in the import route tests, so none
of the decoding helpers, version sniffing or the data model were exercised.
These tests drive those pieces directly with hand-built byte buffers and a
minimal in-memory stand-in for ``olefile.OleFileIO``, so they need no real
.mpp fixture.
"""

import datetime
import struct

import pytest

from noodle_core.mpp_reader import (
    Mpp9Reader,
    Mpp12Reader,
    Mpp14Reader,
    Mpp14TableBackedReader,
    MppAssignment,
    MppDependency,
    MppProject,
    MppReadError,
    MppResource,
    MppTask,
    _decode_duration,
    _decode_mpp_date,
    _decode_tb_date,
    _detect_version,
    _find_tb_dir,
    _is_table_backed,
    _MPP_EPOCH,
    _read_stream_safe,
    _read_tb_vardata_string,
    _read_utf16,
    _read_vardata_string,
)


# ---------------------------------------------------------------------------
# A tiny in-memory stand-in for olefile.OleFileIO
# ---------------------------------------------------------------------------

class FakeOle:
    """Just enough of the OleFileIO surface for the reader: a dict of streams."""

    def __init__(self, streams=None, author=None):
        # keys are '/'-joined paths, e.g. 'VisibleDocument/Options'
        self._streams = dict(streams or {})
        self._author = author

    def exists(self, name):
        if isinstance(name, list):
            name = "/".join(name)
        return name in self._streams or any(
            k.startswith(name + "/") for k in self._streams
        )

    def openstream(self, name):
        if isinstance(name, list):
            name = "/".join(name)
        if name not in self._streams:
            raise OSError(f"stream not found: {name}")

        class _Stream:
            def __init__(self, data):
                self._data = data

            def read(self):
                return self._data

        return _Stream(self._streams[name])

    def listdir(self):
        return [k.split("/") for k in self._streams]

    def get_metadata(self):
        class _Meta:
            author = self._author

        return _Meta()


def _u16(s: str) -> bytes:
    return s.encode("utf-16-le")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

def _task(**overrides):
    base = dict(
        unique_id=1, task_id=1, name="Task", outline_level=1,
        duration_minutes=480.0, start=None, finish=None,
        percent_complete=0, milestone=False, summary=False,
        parent_unique_id=None,
    )
    base.update(overrides)
    return MppTask(**base)


class TestDataModel:
    def test_duration_days_converts_eight_hour_days(self):
        assert _task(duration_minutes=480.0).duration_days == 1.0
        assert _task(duration_minutes=1200.0).duration_days == 2.5
        assert _task(duration_minutes=None).duration_days is None

    def test_duration_days_rounds_to_four_places(self):
        assert _task(duration_minutes=100.0).duration_days == 0.2083

    def test_task_str_indents_by_outline_level(self):
        t = _task(name="Child", outline_level=3, unique_id=7)
        s = str(t)
        assert s.startswith("    [7] Child")
        assert "dur=1.0d" in s

    def test_task_str_shows_question_mark_without_duration(self):
        assert "dur=?" in str(_task(duration_minutes=None))

    def test_resource_dependency_assignment_str(self):
        assert str(MppResource(3, 1, "Alice", "Work")) == "[3] Alice (Work)"
        dep = MppDependency(1, 2, "FS", 0)
        assert str(dep) == "Task[1] → Task[2]  [FS]"
        dep_lag = MppDependency(1, 2, "SS", 480.0)
        assert str(dep_lag).endswith("[SS] lag=480.0min")
        assert str(MppAssignment(5, 9, 50.0)) == "Resource[9] → Task[5] at 50.0%"

    def test_real_tasks_drops_project_summary_and_unnamed(self):
        proj = MppProject(title="", author="", mpp_version="x", tasks=[
            _task(unique_id=0, outline_level=0, name="Project Summary"),
            _task(unique_id=1, outline_level=1, name="Real"),
            _task(unique_id=2, outline_level=1, name=""),
        ])
        assert [t.unique_id for t in proj.real_tasks()] == [1]

    def test_real_resources_drops_unnamed(self):
        proj = MppProject(title="", author="", mpp_version="x", resources=[
            MppResource(0, 0, "", "Work"),
            MppResource(1, 1, "Bob", "Work"),
        ])
        assert [r.name for r in proj.real_resources()] == ["Bob"]

    def test_lookups_by_uid(self):
        proj = MppProject(
            title="", author="", mpp_version="x",
            tasks=[_task(unique_id=10), _task(unique_id=11)],
            resources=[MppResource(20, 1, "A", "Work")],
        )
        assert proj.task_by_uid(11).unique_id == 11
        assert proj.task_by_uid(99) is None
        assert proj.resource_by_uid(20).name == "A"
        assert proj.resource_by_uid(99) is None


# ---------------------------------------------------------------------------
# Decoding helpers
# ---------------------------------------------------------------------------

class TestDateDecoding:
    def test_zero_and_sentinels_are_unset(self):
        assert _decode_mpp_date(0) is None
        assert _decode_mpp_date(0x74BBEAC0) is None
        assert _decode_mpp_date(0xFFFFFFFF) is None

    def test_minutes_since_1984_epoch(self):
        # 1 day + 90 minutes
        assert _decode_mpp_date(24 * 60 + 90) == datetime.datetime(1984, 1, 2, 1, 30)

    def test_overflow_is_none(self):
        assert _decode_mpp_date(10**15) is None

    def test_tb_date_zero_and_sentinel(self):
        assert _decode_tb_date(0) is None
        assert _decode_tb_date(0xFFFFFFFF) is None

    def test_tb_date_day_and_time_packing(self):
        # day 2 (1984-01-02), 9:00 = 540 minutes = 5400 tenths
        raw = (2 << 16) | 5400
        assert _decode_tb_date(raw) == datetime.datetime(1984, 1, 2, 9, 0)

    def test_tb_date_day_one_is_epoch(self):
        assert _decode_tb_date(1 << 16) == _MPP_EPOCH


class TestDurationDecoding:
    def test_unset_values(self):
        assert _decode_duration(0, 5) is None
        assert _decode_duration(0xFFFFFFFF, 5) is None

    @pytest.mark.parametrize("unit, raw, minutes", [
        (3, 300, 30.0),        # 30.0 minutes stored as tenths
        (4, 20, 120.0),        # 2 hours
        (5, 10, 480.0),        # 1 day
        (6, 10, 2400.0),       # 1 week
        (7, 10, 9600.0),       # 1 month
        (19, 300, 30.0),       # elapsed minutes
        (20, 20, 120.0),       # elapsed hours
        (21, 10, 480.0),       # elapsed days
    ])
    def test_unit_multipliers(self, unit, raw, minutes):
        assert _decode_duration(raw, unit) == minutes

    def test_unknown_unit_defaults_to_days(self):
        assert _decode_duration(10, 99) == 480.0


class TestStringHelpers:
    def test_read_utf16_stops_at_null_terminator(self):
        buf = _u16("Hello") + b"\x00\x00" + _u16("junk")
        assert _read_utf16(buf, 0) == "Hello"

    def test_read_utf16_honours_offset_and_max_chars(self):
        buf = b"\xff\xff" + _u16("abcdef") + b"\x00\x00"
        assert _read_utf16(buf, 2) == "abcdef"
        assert _read_utf16(buf, 2, max_chars=3) == "abc"

    def test_read_utf16_at_end_of_buffer(self):
        assert _read_utf16(b"", 0) == ""
        assert _read_utf16(b"\x00", 5) == ""

    def test_vardata_string_length_prefixed_uint16(self):
        payload = _u16("Design")
        pool = b"\x00" * 4 + struct.pack("<H", len(payload)) + payload
        assert _read_vardata_string(pool, 4) == "Design"

    def test_vardata_string_rejects_bad_pointers(self):
        pool = b"\x00\x00" + struct.pack("<H", 4) + _u16("ab")
        assert _read_vardata_string(pool, 2) == "ab"
        # pointer 0 means "no string", as does the all-ones sentinel
        assert _read_vardata_string(pool, 0) == ""
        assert _read_vardata_string(pool, 0xFFFFFFFF) == ""
        assert _read_vardata_string(b"", 2) == ""
        assert _read_vardata_string(pool, 50) == ""
        # length overruns the buffer
        assert _read_vardata_string(b"\x00\x00" + struct.pack("<H", 100) + b"ab", 2) == ""
        # zero length
        assert _read_vardata_string(b"\x00\x00" + struct.pack("<H", 0), 2) == ""

    def test_tb_vardata_string_length_prefixed_uint32(self):
        payload = _u16("Build")
        pool = struct.pack("<I", len(payload)) + payload
        assert _read_tb_vardata_string(pool, 0) == "Build"

    def test_tb_vardata_string_rejects_bad_input(self):
        assert _read_tb_vardata_string(b"", 0) == ""
        assert _read_tb_vardata_string(b"\x00\x00", 0) == ""
        assert _read_tb_vardata_string(struct.pack("<I", 0) + b"xx", 0) == ""
        assert _read_tb_vardata_string(struct.pack("<I", 20000) + b"xx", 0) == ""
        assert _read_tb_vardata_string(struct.pack("<I", 8) + b"xx", 0) == ""

    def test_read_stream_safe_returns_none_for_missing(self):
        ole = FakeOle({"VisibleDocument/Options": b"abc"})
        assert _read_stream_safe(ole, "VisibleDocument", "Options") == b"abc"
        assert _read_stream_safe(ole, "VisibleDocument", "Nope") is None


# ---------------------------------------------------------------------------
# Version detection
# ---------------------------------------------------------------------------

class TestVersionDetection:
    @pytest.mark.parametrize("marker", [9, 12, 14])
    def test_marker_in_visible_document_header(self, marker):
        ole = FakeOle({"VisibleDocument": struct.pack("<H", marker) + b"\x00\x00"})
        assert _detect_version(ole) == marker

    def test_unknown_marker_falls_through_to_stream_names(self):
        ole = FakeOle({
            "VisibleDocument": struct.pack("<H", 42) + b"\x00\x00",
            "Props9": b"",
        })
        assert _detect_version(ole) == 12

    def test_short_header_is_ignored(self):
        ole = FakeOle({"VisibleDocument": b"\x09", "Props8": b""})
        assert _detect_version(ole) == 9

    @pytest.mark.parametrize("stream, version", [
        ("Props14", 14), ("Props", 14), ("Props9", 12), ("Props8", 9),
        ("Task2", 14), ("Task", 9),
    ])
    def test_well_known_streams(self, stream, version):
        assert _detect_version(FakeOle({stream: b""})) == version

    def test_table_backed_layout_is_mpp14(self):
        ole = FakeOle({"   114/TBkndTask/FixedData": b""})
        assert _detect_version(ole) == 14

    def test_nothing_recognisable_raises(self):
        with pytest.raises(MppReadError, match="Could not detect MPP version"):
            _detect_version(FakeOle({"Something": b""}))

    def test_is_table_backed(self):
        assert _is_table_backed(FakeOle({"   114/TBkndTask/FixedData": b""}))
        assert not _is_table_backed(FakeOle({"VisibleDocument/Task2": b""}))
        assert not _is_table_backed(FakeOle({"114": b""}))

    def test_find_tb_dir_preserves_leading_spaces(self):
        assert _find_tb_dir(FakeOle({"   114/TBkndTask/FixedData": b""})) == "   114"
        assert _find_tb_dir(FakeOle({"114/TBkndTask/FixedData": b""})) == "114"
        assert _find_tb_dir(FakeOle({})) == "   114"


# ---------------------------------------------------------------------------
# MppProject.read — file-level validation and reader dispatch
# ---------------------------------------------------------------------------

class TestProjectRead:
    def test_missing_file(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            MppProject.read(tmp_path / "nope.mpp")

    def test_non_ole_file_is_rejected_with_hint(self, tmp_path):
        f = tmp_path / "plan.mpp"
        f.write_text("<Project xmlns='http://schemas.microsoft.com/project'/>")
        with pytest.raises(MppReadError, match="not a valid OLE2/MPP file"):
            MppProject.read(f)

    @pytest.mark.parametrize("version, reader_cls, label", [
        (9, Mpp9Reader, "MPP9"),
        (12, Mpp12Reader, "MPP12"),
        (14, Mpp14Reader, "MPP14"),
    ])
    def test_dispatches_to_versioned_reader(self, tmp_path, monkeypatch,
                                            version, reader_cls, label):
        f = tmp_path / "plan.mpp"
        f.write_bytes(b"x")

        import noodle_core.mpp_reader as mr

        ole = FakeOle({"VisibleDocument": struct.pack("<H", version) + b"\x00\x00"})

        class _Ctx:
            def __enter__(self_inner):
                return ole

            def __exit__(self_inner, *a):
                return False

        monkeypatch.setattr(mr.olefile, "isOleFile", lambda p: True)
        monkeypatch.setattr(mr.olefile, "OleFileIO", lambda p: _Ctx())

        proj = MppProject.read(f)
        assert label in proj.mpp_version
        # An empty container yields an empty, but well-formed, project.
        assert proj.tasks == []
        assert proj.resources == []
        assert proj.dependencies == []
        assert proj.assignments == []

    def test_dispatches_to_table_backed_reader(self, tmp_path, monkeypatch):
        f = tmp_path / "plan.mpp"
        f.write_bytes(b"x")
        import noodle_core.mpp_reader as mr

        ole = FakeOle({"   114/TBkndTask/FixedData": b""})

        class _Ctx:
            def __enter__(self_inner):
                return ole

            def __exit__(self_inner, *a):
                return False

        monkeypatch.setattr(mr.olefile, "isOleFile", lambda p: True)
        monkeypatch.setattr(mr.olefile, "OleFileIO", lambda p: _Ctx())

        proj = MppProject.read(f)
        assert "table" in proj.mpp_version.lower() or "MPP14" in proj.mpp_version
        assert proj.tasks == []


# ---------------------------------------------------------------------------
# Mpp9Reader — stream parsing with hand-built blocks
# ---------------------------------------------------------------------------

def _mpp9_task_block(uid, tid, name_ptr, *, duration_raw=10, unit=5,
                     start=None, finish=None, percent=0, flags=0,
                     outline=1, parent=0):
    block = bytearray(Mpp9Reader.TASK_BLOCK_SIZE)
    struct.pack_into("<I", block, Mpp9Reader.TASK_UNIQUE_ID, uid)
    struct.pack_into("<I", block, Mpp9Reader.TASK_ID, tid)
    struct.pack_into("<I", block, Mpp9Reader.TASK_NAME_OFFSET, name_ptr)
    struct.pack_into("<I", block, Mpp9Reader.TASK_DURATION, duration_raw)
    block[Mpp9Reader.TASK_DURATION_UNIT] = unit
    struct.pack_into("<I", block, Mpp9Reader.TASK_START, start or 0)
    struct.pack_into("<I", block, Mpp9Reader.TASK_FINISH, finish or 0)
    struct.pack_into("<H", block, Mpp9Reader.TASK_PERCENT, percent)
    block[Mpp9Reader.TASK_MILESTONE] = flags
    struct.pack_into("<H", block, Mpp9Reader.TASK_OUTLINE_LEVEL, outline)
    struct.pack_into("<I", block, Mpp9Reader.TASK_PARENT_UID, parent)
    return bytes(block)


def _vardata_pool(*names):
    """Build a var-data pool and return (pool_bytes, [ptr per name])."""
    pool = bytearray(b"\x00" * 2)  # ptr 0 means "no name"
    ptrs = []
    for n in names:
        ptrs.append(len(pool))
        payload = _u16(n)
        pool += struct.pack("<H", len(payload)) + payload
    return bytes(pool), ptrs


class TestMpp9ReaderTitleAndAuthor:
    def test_title_from_options_stream(self):
        title = _u16("Launch Plan")
        options = bytearray(200)
        struct.pack_into("<H", options, 0x20, len("Launch Plan"))
        options[0x22:0x22 + len(title)] = title
        ole = FakeOle({"VisibleDocument/Options": bytes(options)}, author="Kev")
        reader = Mpp9Reader(ole, None)
        assert reader._read_title() == "Launch Plan"
        assert reader._read_author() == "Kev"

    def test_title_blank_when_stream_short_or_missing(self):
        assert Mpp9Reader(FakeOle({}), None)._read_title() == ""
        assert Mpp9Reader(FakeOle({"VisibleDocument/Options": b"\x00" * 10}), None)._read_title() == ""

    def test_author_blank_when_metadata_unavailable(self):
        class _NoMeta(FakeOle):
            def get_metadata(self):
                raise RuntimeError("no summary info")

        assert Mpp9Reader(_NoMeta({}), None)._read_author() == ""


def _mpp9_resource_block(uid, rid, name_ptr, rtype=0):
    block = bytearray(Mpp9Reader.RESOURCE_BLOCK_SIZE)
    struct.pack_into("<I", block, Mpp9Reader.RES_UNIQUE_ID, uid)
    struct.pack_into("<I", block, Mpp9Reader.RES_ID, rid)
    struct.pack_into("<I", block, Mpp9Reader.RES_NAME_OFFSET, name_ptr)
    block[Mpp9Reader.RES_TYPE] = rtype
    return bytes(block)


def _mpp9_relation(pred, succ, rel_type, lag_tenths=0, lag_unit=3):
    rec = bytearray(Mpp9Reader.REL_RECORD_SIZE)
    struct.pack_into("<I", rec, Mpp9Reader.REL_PREDECESSOR_UID, pred)
    struct.pack_into("<I", rec, Mpp9Reader.REL_SUCCESSOR_UID, succ)
    struct.pack_into("<H", rec, Mpp9Reader.REL_TYPE, rel_type)
    struct.pack_into("<i", rec, Mpp9Reader.REL_LAG, lag_tenths)
    rec[Mpp9Reader.REL_LAG_UNIT] = lag_unit
    return bytes(rec)


def _mpp9_assignment(task_uid, res_uid, units):
    rec = bytearray(116)
    struct.pack_into("<I", rec, 0, task_uid)
    struct.pack_into("<I", rec, 4, res_uid)
    struct.pack_into("<d", rec, 8, units)
    return bytes(rec)


class TestMpp9ReaderTasks:
    def test_empty_when_tasks_stream_missing(self):
        assert Mpp9Reader(FakeOle({}), None)._read_tasks() == []

    def test_decodes_fixed_blocks_and_names(self):
        pool, (p_summary, p_design) = _vardata_pool("Project Summary", "Design")
        start = 24 * 60 * 10          # 1984-01-11 00:00
        finish = start + 8 * 60       # +8h
        fixed = (
            _mpp9_task_block(1, 0, p_summary, outline=0, flags=0x02, parent=0xFFFFFFFF)
            + _mpp9_task_block(2, 1, p_design, duration_raw=25, unit=5,
                               start=start, finish=finish, percent=150,
                               flags=0x01, outline=1, parent=1)
            + _mpp9_task_block(0, 2, 0)              # uid 0 is skipped
            + _mpp9_task_block(0xFFFFFFFF, 3, 0)     # sentinel uid is skipped
        )
        ole = FakeOle({"VisibleDocument/Tasks": fixed, "VisibleDocument/TBkndA": pool})
        tasks = Mpp9Reader(ole, None)._read_tasks()

        assert [t.unique_id for t in tasks] == [1, 2]
        summary, design = tasks
        assert summary.name == "Project Summary"
        assert summary.outline_level == 0
        assert summary.summary is True and summary.milestone is False
        assert summary.parent_unique_id is None

        assert design.name == "Design"
        assert design.task_id == 1
        assert design.duration_minutes == 2.5 * 480
        assert design.duration_days == 2.5
        assert design.start == datetime.datetime(1984, 1, 11, 0, 0)
        assert design.finish == datetime.datetime(1984, 1, 11, 8, 0)
        assert design.percent_complete == 100  # clamped
        assert design.milestone is True and design.summary is False
        assert design.parent_unique_id == 1

    def test_falls_back_to_generated_names_without_var_pool(self):
        fixed = _mpp9_task_block(7, 1, 123)
        tasks = Mpp9Reader(FakeOle({"VisibleDocument/Tasks": fixed}), None)._read_tasks()
        assert tasks[0].name == "Task 7"

    def test_partial_trailing_block_is_ignored(self):
        pool, (p,) = _vardata_pool("A")
        fixed = _mpp9_task_block(1, 1, p) + b"\x01" * 100
        ole = FakeOle({"VisibleDocument/Tasks": fixed, "VisibleDocument/TBkndA": pool})
        assert len(Mpp9Reader(ole, None)._read_tasks()) == 1

    def test_full_read_assembles_project(self):
        pool, (p,) = _vardata_pool("Only task")
        ole = FakeOle({"VisibleDocument/Tasks": _mpp9_task_block(1, 1, p),
                       "VisibleDocument/TBkndA": pool}, author="Me")
        proj = Mpp9Reader(ole, None).read()
        assert proj.author == "Me"
        assert proj.mpp_version.startswith("MPP9")
        assert [t.name for t in proj.real_tasks()] == ["Only task"]


class TestMpp9ReaderResources:
    def test_empty_when_stream_missing(self):
        assert Mpp9Reader(FakeOle({}), None)._read_resources() == []

    def test_decodes_blocks_and_types(self):
        pool, (p_alice, p_steel, p_fee) = _vardata_pool("Alice", "Steel", "Fee")
        fixed = (
            _mpp9_resource_block(1, 1, p_alice, 0)
            + _mpp9_resource_block(2, 2, p_steel, 1)
            + _mpp9_resource_block(3, 3, p_fee, 2)
            + _mpp9_resource_block(4, 4, 0, 99)   # unknown type → Work
            + _mpp9_resource_block(0, 5, 0)
        )
        ole = FakeOle({"VisibleDocument/Resources": fixed, "VisibleDocument/RBkndA": pool})
        res = Mpp9Reader(ole, None)._read_resources()
        assert [(r.unique_id, r.name, r.type) for r in res] == [
            (1, "Alice", "Work"), (2, "Steel", "Material"), (3, "Fee", "Cost"), (4, "", "Work"),
        ]

    def test_generated_names_without_var_pool(self):
        fixed = _mpp9_resource_block(9, 1, 5)
        res = Mpp9Reader(FakeOle({"VisibleDocument/Resources": fixed}), None)._read_resources()
        assert res[0].name == "Resource 9"


class TestMpp9ReaderRelations:
    def test_empty_when_stream_missing(self):
        assert Mpp9Reader(FakeOle({}), None)._read_dependencies() == []

    def test_parses_records_types_and_lag(self):
        data = (
            _mpp9_relation(1, 2, 0)
            + _mpp9_relation(2, 3, 1, lag_tenths=10, lag_unit=5)    # +1 day lag
            + _mpp9_relation(3, 4, 2, lag_tenths=-600, lag_unit=3)  # -60 min lead
            + _mpp9_relation(4, 5, 3)
            + _mpp9_relation(4, 5, 77)                               # unknown → FS
            + _mpp9_relation(0, 5, 0)                                # skipped
            + _mpp9_relation(5, 0xFFFFFFFF, 0)                       # skipped
        )
        deps = Mpp9Reader(FakeOle({"VisibleDocument/Relations": data}), None)._read_dependencies()
        assert [(d.predecessor_unique_id, d.successor_unique_id, d.relation_type, d.lag_minutes)
                for d in deps] == [
            (1, 2, "FS", 0.0),
            (2, 3, "SS", 480.0),
            (3, 4, "FF", -60.0),
            (4, 5, "SF", 0.0),
            (4, 5, "FS", 0.0),
        ]


class TestMpp9ReaderAssignments:
    def test_empty_when_stream_missing(self):
        assert Mpp9Reader(FakeOle({}), None)._read_assignments() == []

    def test_units_scaled_to_percent(self):
        data = (
            _mpp9_assignment(1, 10, 1.0)
            + _mpp9_assignment(2, 11, 0.5)
            + _mpp9_assignment(0, 11, 1.0)   # skipped
            + _mpp9_assignment(3, 0, 1.0)    # skipped
        )
        asg = Mpp9Reader(FakeOle({"VisibleDocument/Assignments": data}), None)._read_assignments()
        assert [(a.task_unique_id, a.resource_unique_id, a.units) for a in asg] == [
            (1, 10, 100.0), (2, 11, 50.0),
        ]
