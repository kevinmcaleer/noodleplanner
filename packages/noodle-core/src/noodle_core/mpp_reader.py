"""
mpp_reader.py — Pure Python MPP binary reader
=============================================
Reads tasks, resources, durations and dependencies from Microsoft Project
binary .mpp files (versions MPP9/2000-2003, MPP12/2007, MPP14/2010+).

Requires only:  pip install olefile
No Java, no JVM, no JPype, no Aspose.

Architecture
------------
Layer 1  olefile         — opens the OLE2 Compound File container
Layer 2  MppVersionDetector — sniffs the MPP version byte in the CompObj stream
Layer 3  Mpp9Reader / Mpp12Reader / Mpp14Reader — version-specific stream parsers
Layer 4  MppProject       — neutral project data model returned to the caller

Byte offsets are sourced from MPXJ's open-source Java MPP readers
(github.com/joniles/mpxj) and cross-referenced with the OpenWorkbench codebase.

Limitations (inherent to pure-Python reverse-engineering approach)
------------------------------------------------------------------
- MPP8 (Project 98) not supported — too obscure, predates all reference material
- Custom fields not decoded
- Calendar/working-hours data not decoded (only task dates/durations)
- MPP14 (2010+) task block size varies; tested against 2010 and 2016 files
- Highly corrupted or password-protected files will raise MppReadError

Usage
-----
    from mpp_reader import MppProject
    proj = MppProject.read("schedule.mpp")
    for task in proj.tasks:
        print(task)
    for dep in proj.dependencies:
        print(dep)
"""

from __future__ import annotations

import struct
import datetime
from dataclasses import dataclass, field
from typing import List, Optional, Dict
from pathlib import Path

try:
    import olefile
except ImportError:
    raise ImportError(
        "olefile is required: pip install olefile\n"
        "It is pure Python and works on ARM/Raspberry Pi with no Java dependency."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Exceptions
# ─────────────────────────────────────────────────────────────────────────────

class MppReadError(Exception):
    """Raised when the MPP file cannot be parsed."""


# ─────────────────────────────────────────────────────────────────────────────
# Data model
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class MppTask:
    unique_id: int
    task_id: int                          # Sequential row number (may change)
    name: str
    outline_level: int                    # 0 = hidden project summary, 1+ = real tasks
    duration_minutes: Optional[float]     # Duration in minutes (None if not set)
    start: Optional[datetime.datetime]
    finish: Optional[datetime.datetime]
    percent_complete: int                 # 0-100
    milestone: bool
    summary: bool                         # True if parent/summary task
    parent_unique_id: Optional[int]

    @property
    def duration_days(self) -> Optional[float]:
        if self.duration_minutes is None:
            return None
        return round(self.duration_minutes / 480.0, 4)  # 480 min = 8-hour day

    def __str__(self) -> str:
        indent = "  " * max(0, self.outline_level - 1)
        dur = f"{self.duration_days}d" if self.duration_days is not None else "?"
        return (f"{indent}[{self.unique_id}] {self.name}  "
                f"dur={dur}  {self.start} → {self.finish}  {self.percent_complete}%")


@dataclass
class MppResource:
    unique_id: int
    resource_id: int
    name: str
    type: str  # "Work", "Material", "Cost"
    email: Optional[str] = None

    def __str__(self) -> str:
        return f"[{self.unique_id}] {self.name} ({self.type})"


@dataclass
class MppDependency:
    predecessor_unique_id: int
    successor_unique_id: int
    relation_type: str   # "FS", "SS", "FF", "SF"
    lag_minutes: float   # Positive = lag, negative = lead

    def __str__(self) -> str:
        lag = f" lag={self.lag_minutes}min" if self.lag_minutes else ""
        return (f"Task[{self.predecessor_unique_id}] "
                f"→ Task[{self.successor_unique_id}]  "
                f"[{self.relation_type}]{lag}")


@dataclass
class MppAssignment:
    task_unique_id: int
    resource_unique_id: int
    units: float  # % allocation (100.0 = 100%)

    def __str__(self) -> str:
        return (f"Resource[{self.resource_unique_id}] "
                f"→ Task[{self.task_unique_id}] at {self.units}%")


@dataclass
class MppProject:
    title: str
    author: str
    mpp_version: str
    tasks: List[MppTask] = field(default_factory=list)
    resources: List[MppResource] = field(default_factory=list)
    dependencies: List[MppDependency] = field(default_factory=list)
    assignments: List[MppAssignment] = field(default_factory=list)

    @classmethod
    def read(cls, path: str | Path) -> "MppProject":
        """Read a .mpp file and return a populated MppProject."""
        path = Path(path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {path}")

        if not olefile.isOleFile(str(path)):
            raise MppReadError(
                f"{path.name} is not a valid OLE2/MPP file. "
                "Ensure it is a binary .mpp, not an XML .mpp saved from newer Project."
            )

        with olefile.OleFileIO(str(path)) as ole:
            version = _detect_version(ole)
            if version == 9:
                return Mpp9Reader(ole, path).read()
            elif version == 12:
                return Mpp12Reader(ole, path).read()
            elif version == 14:
                # Check for table-backed format (Project 2024+)
                if _is_table_backed(ole):
                    return Mpp14TableBackedReader(ole, path).read()
                return Mpp14Reader(ole, path).read()
            else:
                raise MppReadError(
                    f"MPP version {version} is not supported. "
                    "Supported: MPP9 (2000-2003), MPP12 (2007), MPP14 (2010+). "
                    "MPP8 (Project 98) is not supported in this reader."
                )

    def real_tasks(self) -> List[MppTask]:
        """Return tasks excluding the hidden project-summary node (outline_level 0)."""
        return [t for t in self.tasks if t.outline_level > 0 and t.name]

    def real_resources(self) -> List[MppResource]:
        """Return resources excluding the null-name summary resource."""
        return [r for r in self.resources if r.name]

    def task_by_uid(self, uid: int) -> Optional[MppTask]:
        for t in self.tasks:
            if t.unique_id == uid:
                return t
        return None

    def resource_by_uid(self, uid: int) -> Optional[MppResource]:
        for r in self.resources:
            if r.unique_id == uid:
                return r
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Version detection
# ─────────────────────────────────────────────────────────────────────────────

def _detect_version(ole: olefile.OleFileIO) -> int:
    """
    Sniff MPP format version from the CompObj stream or from known header bytes.

    MPXJ source reference: MPPReader.java, getMppFileType()
    The version byte lives at offset 0x14 in the 'CompObj' stream,
    OR can be inferred from the root directory entry name structure.

    MPP version codes:
      8  → Project 98
      9  → Project 2000, 2002, 2003
     12  → Project 2007
     14  → Project 2010, 2013, 2016, 2019, 2024
    """
    # Try reading the version byte from the 'VisibleDocument' storage header
    # which is present in all MPP9+ files.
    for stream_name in ['VisibleDocument', 'CompObj', '\x01CompObj']:
        if ole.exists(stream_name):
            try:
                data = ole.openstream(stream_name).read()
                # MPP file type is encoded in the first 4 bytes of VisibleDocument
                # as a little-endian uint16 at offset 0 → values: 9, 12, 14
                if len(data) >= 4:
                    # MPXJ checks data[0] directly for MPP format marker
                    marker = struct.unpack_from('<H', data, 0)[0]
                    if marker in (9, 12, 14):
                        return marker
            except Exception:
                pass

    # Fallback: check which well-known streams exist
    # MPP14 has 'Props' stream; MPP12 has 'Props9' stream
    if ole.exists('Props14'):
        return 14
    if ole.exists('Props'):
        return 14
    if ole.exists('Props9'):
        return 12
    if ole.exists('Props8'):
        return 9

    # Check for table-backed MPP14 format (Project 2024+)
    # Data stored under '   114/TBkndTask/' instead of 'VisibleDocument/'
    for entry in ole.listdir():
        if len(entry) >= 2 and entry[0].strip() == '114' and entry[1].startswith('TBknd'):
            return 14
            break

    # Last resort: check root entry
    # All MPP9 files have a 'Task' stream (MPP14 uses 'Task2')
    if ole.exists('Task2'):
        return 14
    if ole.exists('Task'):
        return 9  # Could be 9 or 12; treat as 9, reader will cope

    raise MppReadError(
        "Could not detect MPP version. "
        "The file may be corrupt, password-protected (MPP12+), "
        "or an unsupported format variant."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Shared utility functions
# ─────────────────────────────────────────────────────────────────────────────

# MS Project epoch: Jan 1 1984 00:00:00
_MPP_EPOCH = datetime.datetime(1984, 1, 1, 0, 0, 0)
# Each date unit = 1 minute
_MINUTES_PER_UNIT = 1

def _decode_mpp_date(raw: int) -> Optional[datetime.datetime]:
    """
    Decode a 4-byte little-endian integer as an MPP timestamp.

    MPXJ source: MPPUtility.getTimestamp()
    MPP stores dates as minutes since 1984-01-01 00:00:00.
    Special value 0x74BBEAC0 / 0x00000000 = not set.
    """
    if raw == 0 or raw == 0x74BBEAC0 or raw == 0xFFFFFFFF:
        return None
    try:
        return _MPP_EPOCH + datetime.timedelta(minutes=raw)
    except (OverflowError, ValueError):
        return None


def _decode_duration(raw: int, time_unit_byte: int) -> Optional[float]:
    """
    Decode MPP duration into minutes.

    MPXJ source: MPPUtility.getDuration()
    The raw value is in units determined by time_unit_byte:
      3  = minutes
      4  = hours
      5  = days (8h)
      6  = weeks (40h)
      7  = months (approx 160h)
      8  = percent
      9  = percent work
     19  = elapsed minutes
     20  = elapsed hours
     21  = elapsed days
    """
    if raw == 0 or raw == 0xFFFFFFFF:
        return None

    unit_map = {
        3:  1.0,           # minutes
        4:  60.0,          # hours → minutes
        5:  480.0,         # days (8h) → minutes
        6:  2400.0,        # weeks (5d) → minutes
        7:  9600.0,        # months (4w) → minutes
        19: 1.0,           # elapsed minutes
        20: 60.0,          # elapsed hours
        21: 480.0,         # elapsed days
    }
    multiplier = unit_map.get(time_unit_byte, 480.0)  # default to days
    # Raw value is in 1/10ths (MPXJ divides by 10 after multiplying by unit)
    return (raw / 10.0) * multiplier


def _read_utf16(data: bytes, offset: int, max_chars: int = 255) -> str:
    """Read a null-terminated UTF-16LE string from a byte buffer."""
    end = offset
    limit = min(offset + max_chars * 2, len(data) - 1)
    while end < limit - 1:
        if data[end] == 0 and data[end + 1] == 0:
            break
        end += 2
    try:
        return data[offset:end].decode('utf-16-le', errors='replace').strip('\x00')
    except Exception:
        return ''


def _read_stream_safe(ole: olefile.OleFileIO, *path) -> Optional[bytes]:
    """Read a stream from the OLE file, returning None if not found."""
    try:
        return ole.openstream(list(path)).read()
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# MPP9 Reader  (Project 2000 / 2002 / 2003)
# ─────────────────────────────────────────────────────────────────────────────

class Mpp9Reader:
    """
    Reads MPP9 format files (Project 2000, 2002, 2003).

    OLE streams used:
      VisibleDocument/Options   — project properties
      VisibleDocument/Tasks     — fixed-size task blocks (904 bytes each)
      VisibleDocument/Resources — fixed-size resource blocks (648 bytes each)
      VisibleDocument/Relations — dependency records (28 bytes each)
      VisibleDocument/Assignments — assignment records

    Byte offsets sourced from MPXJ MPP9Reader.java.
    Task block size: 904 bytes
    """

    TASK_BLOCK_SIZE   = 904
    RESOURCE_BLOCK_SIZE = 648

    # ── Task field byte offsets within each 904-byte task block ──────────────
    TASK_UNIQUE_ID      = 0     # uint32 LE
    TASK_ID             = 4     # uint32 LE
    TASK_NAME_OFFSET    = 8     # uint32 LE → offset into var-data string block
    TASK_DURATION       = 0x4C  # uint32 LE — duration raw value
    TASK_DURATION_UNIT  = 0x50  # uint8 — time unit code
    TASK_START          = 0x58  # uint32 LE — minutes since 1984
    TASK_FINISH         = 0x5C  # uint32 LE — minutes since 1984
    TASK_PERCENT        = 0x64  # uint16 LE — 0-100
    TASK_MILESTONE      = 0x85  # bit 0 of byte
    TASK_SUMMARY        = 0x85  # bit 1 of byte
    TASK_OUTLINE_LEVEL  = 0x40  # uint16 LE
    TASK_PARENT_UID     = 0x44  # uint32 LE

    # ── Resource field offsets within 648-byte resource block ────────────────
    RES_UNIQUE_ID       = 0     # uint32 LE
    RES_ID              = 4     # uint32 LE
    RES_NAME_OFFSET     = 8     # uint32 LE → var data
    RES_TYPE            = 0x14  # uint8: 0=Work, 1=Material, 2=Cost

    # ── Relation (dependency) record: 28 bytes each ──────────────────────────
    REL_RECORD_SIZE     = 28
    REL_PREDECESSOR_UID = 0     # uint32 LE
    REL_SUCCESSOR_UID   = 4     # uint32 LE
    REL_TYPE            = 8     # uint16 LE: 0=FS,1=SS,2=FF,3=SF
    REL_LAG             = 12    # int32 LE in 1/10 minutes
    REL_LAG_UNIT        = 16    # uint8

    RELATION_TYPES = {0: 'FS', 1: 'SS', 2: 'FF', 3: 'SF'}
    RESOURCE_TYPES = {0: 'Work', 1: 'Material', 2: 'Cost'}

    def __init__(self, ole: olefile.OleFileIO, path: Path):
        self._ole = ole
        self._path = path

    def read(self) -> MppProject:
        proj = MppProject(
            title=self._read_title(),
            author=self._read_author(),
            mpp_version='MPP9 (Project 2000-2003)',
        )
        proj.tasks = self._read_tasks()
        proj.resources = self._read_resources()
        proj.dependencies = self._read_dependencies()
        proj.assignments = self._read_assignments()
        return proj

    def _read_title(self) -> str:
        data = _read_stream_safe(self._ole, 'VisibleDocument', 'Options')
        if not data or len(data) < 100:
            return ''
        # Title is a Pascal-style UTF-16LE string at offset 0x20
        try:
            str_len = struct.unpack_from('<H', data, 0x20)[0]
            return data[0x22:0x22 + str_len * 2].decode('utf-16-le', errors='replace')
        except Exception:
            return ''

    def _read_author(self) -> str:
        # Author lives in the standard OLE summary properties
        try:
            meta = self._ole.get_metadata()
            return meta.author or ''
        except Exception:
            return ''

    def _read_tasks(self) -> List[MppTask]:
        # MPP9 stores tasks in two parallel streams:
        #   VisibleDocument/Tasks  — fixed-size records
        #   VisibleDocument/TBkndA — var-length string/data pool
        fixed = _read_stream_safe(self._ole, 'VisibleDocument', 'Tasks')
        var   = _read_stream_safe(self._ole, 'VisibleDocument', 'TBkndA')
        if not fixed:
            return []

        tasks = []
        block_size = self.TASK_BLOCK_SIZE
        n_blocks = len(fixed) // block_size

        for i in range(n_blocks):
            blk = fixed[i * block_size:(i + 1) * block_size]
            if len(blk) < block_size:
                break

            uid = struct.unpack_from('<I', blk, self.TASK_UNIQUE_ID)[0]
            if uid == 0 or uid == 0xFFFFFFFF:
                continue

            tid          = struct.unpack_from('<I', blk, self.TASK_ID)[0]
            name_ptr     = struct.unpack_from('<I', blk, self.TASK_NAME_OFFSET)[0]
            dur_raw      = struct.unpack_from('<I', blk, self.TASK_DURATION)[0]
            dur_unit     = blk[self.TASK_DURATION_UNIT]
            start_raw    = struct.unpack_from('<I', blk, self.TASK_START)[0]
            finish_raw   = struct.unpack_from('<I', blk, self.TASK_FINISH)[0]
            pct          = struct.unpack_from('<H', blk, self.TASK_PERCENT)[0]
            outline_lvl  = struct.unpack_from('<H', blk, self.TASK_OUTLINE_LEVEL)[0]
            parent_uid   = struct.unpack_from('<I', blk, self.TASK_PARENT_UID)[0]
            flags_byte   = blk[self.TASK_MILESTONE]
            milestone    = bool(flags_byte & 0x01)
            is_summary   = bool(flags_byte & 0x02)

            name = _read_vardata_string(var, name_ptr) if var else f'Task {uid}'

            tasks.append(MppTask(
                unique_id=uid,
                task_id=tid,
                name=name,
                outline_level=outline_lvl,
                duration_minutes=_decode_duration(dur_raw, dur_unit),
                start=_decode_mpp_date(start_raw),
                finish=_decode_mpp_date(finish_raw),
                percent_complete=min(100, pct),
                milestone=milestone,
                summary=is_summary,
                parent_unique_id=parent_uid if parent_uid != 0xFFFFFFFF else None,
            ))

        return tasks

    def _read_resources(self) -> List[MppResource]:
        fixed = _read_stream_safe(self._ole, 'VisibleDocument', 'Resources')
        var   = _read_stream_safe(self._ole, 'VisibleDocument', 'RBkndA')
        if not fixed:
            return []

        resources = []
        block_size = self.RESOURCE_BLOCK_SIZE
        n_blocks = len(fixed) // block_size

        for i in range(n_blocks):
            blk = fixed[i * block_size:(i + 1) * block_size]
            if len(blk) < block_size:
                break

            uid = struct.unpack_from('<I', blk, self.RES_UNIQUE_ID)[0]
            if uid == 0 or uid == 0xFFFFFFFF:
                continue

            rid      = struct.unpack_from('<I', blk, self.RES_ID)[0]
            name_ptr = struct.unpack_from('<I', blk, self.RES_NAME_OFFSET)[0]
            rtype    = blk[self.RES_TYPE] if len(blk) > self.RES_TYPE else 0
            name     = _read_vardata_string(var, name_ptr) if var else f'Resource {uid}'

            resources.append(MppResource(
                unique_id=uid,
                resource_id=rid,
                name=name,
                type=self.RESOURCE_TYPES.get(rtype, 'Work'),
            ))

        return resources

    def _read_dependencies(self) -> List[MppDependency]:
        data = _read_stream_safe(self._ole, 'VisibleDocument', 'Relations')
        if not data:
            return []

        deps = []
        rec_size = self.REL_RECORD_SIZE
        n = len(data) // rec_size

        for i in range(n):
            rec = data[i * rec_size:(i + 1) * rec_size]
            if len(rec) < rec_size:
                break

            pred = struct.unpack_from('<I', rec, self.REL_PREDECESSOR_UID)[0]
            succ = struct.unpack_from('<I', rec, self.REL_SUCCESSOR_UID)[0]
            rtype = struct.unpack_from('<H', rec, self.REL_TYPE)[0]
            lag_raw = struct.unpack_from('<i', rec, self.REL_LAG)[0]  # signed
            lag_unit = rec[self.REL_LAG_UNIT] if len(rec) > self.REL_LAG_UNIT else 5

            if pred == 0 or succ == 0 or pred == 0xFFFFFFFF or succ == 0xFFFFFFFF:
                continue

            # Convert lag from raw 1/10 units to minutes
            lag_mins = 0.0
            if lag_raw != 0:
                lag_mins = _decode_duration(abs(lag_raw), lag_unit) or 0.0
                if lag_raw < 0:
                    lag_mins = -lag_mins

            deps.append(MppDependency(
                predecessor_unique_id=pred,
                successor_unique_id=succ,
                relation_type=self.RELATION_TYPES.get(rtype, 'FS'),
                lag_minutes=lag_mins,
            ))

        return deps

    def _read_assignments(self) -> List[MppAssignment]:
        data = _read_stream_safe(self._ole, 'VisibleDocument', 'Assignments')
        if not data:
            return []

        asgns = []
        # Assignment records in MPP9 are 116 bytes each
        REC_SIZE    = 116
        TASK_UID    = 0
        RES_UID     = 4
        UNITS       = 8   # double (64-bit float)

        n = len(data) // REC_SIZE
        for i in range(n):
            rec = data[i * REC_SIZE:(i + 1) * REC_SIZE]
            if len(rec) < REC_SIZE:
                break
            task_uid = struct.unpack_from('<I', rec, TASK_UID)[0]
            res_uid  = struct.unpack_from('<I', rec, RES_UID)[0]
            units    = struct.unpack_from('<d', rec, UNITS)[0]  # 0.0–1.0 scale

            if task_uid == 0 or res_uid == 0:
                continue

            asgns.append(MppAssignment(
                task_unique_id=task_uid,
                resource_unique_id=res_uid,
                units=round(units * 100.0, 1),  # convert to percentage
            ))

        return asgns


# ─────────────────────────────────────────────────────────────────────────────
# MPP12 Reader  (Project 2007)
# ─────────────────────────────────────────────────────────────────────────────

class Mpp12Reader(Mpp9Reader):
    """
    Reads MPP12 format files (Project 2007).

    MPP12 is structurally very similar to MPP9 but uses larger block sizes
    and slightly different stream organisation.  We inherit from Mpp9Reader
    and override the size constants and stream names.

    MPXJ source reference: MPP12Reader.java
    Task block size: 1072 bytes
    """

    TASK_BLOCK_SIZE     = 1072
    RESOURCE_BLOCK_SIZE = 692

    # MPP12 offsets differ slightly from MPP9
    TASK_NAME_OFFSET    = 8
    TASK_DURATION       = 0x54
    TASK_DURATION_UNIT  = 0x58
    TASK_START          = 0x60
    TASK_FINISH         = 0x64
    TASK_PERCENT        = 0x6C
    TASK_OUTLINE_LEVEL  = 0x48
    TASK_PARENT_UID     = 0x4C
    TASK_MILESTONE      = 0x8D
    TASK_SUMMARY        = 0x8D

    RES_UNIQUE_ID       = 0
    RES_ID              = 4
    RES_NAME_OFFSET     = 8
    RES_TYPE            = 0x14

    def read(self) -> MppProject:
        proj = MppProject(
            title=self._read_title(),
            author=self._read_author(),
            mpp_version='MPP12 (Project 2007)',
        )
        proj.tasks = self._read_tasks()
        proj.resources = self._read_resources()
        proj.dependencies = self._read_dependencies()
        proj.assignments = self._read_assignments()
        return proj


# ─────────────────────────────────────────────────────────────────────────────
# MPP14 Reader  (Project 2010, 2013, 2016, 2019, 2024)
# ─────────────────────────────────────────────────────────────────────────────

class Mpp14Reader(Mpp9Reader):
    """
    Reads MPP14 format files (Project 2010 through 2024).

    MPP14 introduced manual vs automatic scheduling, larger task blocks,
    and uses 'Task2' / 'Resource2' stream names.

    MPXJ source reference: MPP14Reader.java
    Task block size: 1744 bytes (varies; some variants use 1484)
    """

    TASK_BLOCK_SIZE     = 1744
    RESOURCE_BLOCK_SIZE = 692

    # MPP14 offsets
    TASK_UNIQUE_ID      = 0
    TASK_ID             = 4
    TASK_NAME_OFFSET    = 8
    TASK_DURATION       = 0x74
    TASK_DURATION_UNIT  = 0x78
    TASK_START          = 0x80
    TASK_FINISH         = 0x84
    TASK_PERCENT        = 0x8C
    TASK_OUTLINE_LEVEL  = 0x68
    TASK_PARENT_UID     = 0x6C
    TASK_MILESTONE      = 0xAD
    TASK_SUMMARY        = 0xAD

    # MPP14 uses different var-data stream names
    TASK_FIXED_STREAM   = ['VisibleDocument', 'Task2']
    TASK_VAR_STREAM     = ['VisibleDocument', 'TBknd2A']
    RES_FIXED_STREAM    = ['VisibleDocument', 'Resource2']
    RES_VAR_STREAM      = ['VisibleDocument', 'RBknd2A']
    DEP_STREAM          = ['VisibleDocument', 'Relation2']
    ASGN_STREAM         = ['VisibleDocument', 'Assignment2']

    def read(self) -> MppProject:
        proj = MppProject(
            title=self._read_title(),
            author=self._read_author(),
            mpp_version='MPP14 (Project 2010+)',
        )
        proj.tasks = self._read_tasks()
        proj.resources = self._read_resources()
        proj.dependencies = self._read_dependencies()
        proj.assignments = self._read_assignments()
        return proj

    def _read_tasks(self) -> List[MppTask]:
        fixed = _read_stream_safe(self._ole, *self.TASK_FIXED_STREAM)
        var   = _read_stream_safe(self._ole, *self.TASK_VAR_STREAM)
        if not fixed:
            # Try alternate block size (some 2010 files use 1484)
            self.TASK_BLOCK_SIZE = 1484
            fixed = _read_stream_safe(self._ole, *self.TASK_FIXED_STREAM)
            if not fixed:
                return []

        tasks = []
        block_size = self.TASK_BLOCK_SIZE
        n_blocks = len(fixed) // block_size

        for i in range(n_blocks):
            blk = fixed[i * block_size:(i + 1) * block_size]
            if len(blk) < block_size:
                break

            uid = struct.unpack_from('<I', blk, self.TASK_UNIQUE_ID)[0]
            if uid == 0 or uid == 0xFFFFFFFF:
                continue

            tid          = struct.unpack_from('<I', blk, self.TASK_ID)[0]
            name_ptr     = struct.unpack_from('<I', blk, self.TASK_NAME_OFFSET)[0]
            dur_raw      = struct.unpack_from('<I', blk, self.TASK_DURATION)[0]
            dur_unit     = blk[self.TASK_DURATION_UNIT] if len(blk) > self.TASK_DURATION_UNIT else 5
            start_raw    = struct.unpack_from('<I', blk, self.TASK_START)[0]
            finish_raw   = struct.unpack_from('<I', blk, self.TASK_FINISH)[0]
            pct          = struct.unpack_from('<H', blk, self.TASK_PERCENT)[0]
            outline_lvl  = struct.unpack_from('<H', blk, self.TASK_OUTLINE_LEVEL)[0]
            parent_uid   = struct.unpack_from('<I', blk, self.TASK_PARENT_UID)[0]
            flags_byte   = blk[self.TASK_MILESTONE] if len(blk) > self.TASK_MILESTONE else 0
            milestone    = bool(flags_byte & 0x01)
            is_summary   = bool(flags_byte & 0x02)

            name = _read_vardata_string(var, name_ptr) if var else f'Task {uid}'

            tasks.append(MppTask(
                unique_id=uid,
                task_id=tid,
                name=name,
                outline_level=outline_lvl,
                duration_minutes=_decode_duration(dur_raw, dur_unit),
                start=_decode_mpp_date(start_raw),
                finish=_decode_mpp_date(finish_raw),
                percent_complete=min(100, pct),
                milestone=milestone,
                summary=is_summary,
                parent_unique_id=parent_uid if parent_uid != 0xFFFFFFFF else None,
            ))

        return tasks

    def _read_resources(self) -> List[MppResource]:
        fixed = _read_stream_safe(self._ole, *self.RES_FIXED_STREAM)
        var   = _read_stream_safe(self._ole, *self.RES_VAR_STREAM)
        if not fixed:
            return []

        resources = []
        block_size = self.RESOURCE_BLOCK_SIZE
        n_blocks = len(fixed) // block_size

        for i in range(n_blocks):
            blk = fixed[i * block_size:(i + 1) * block_size]
            if len(blk) < block_size:
                break

            uid = struct.unpack_from('<I', blk, self.RES_UNIQUE_ID)[0]
            if uid == 0 or uid == 0xFFFFFFFF:
                continue

            rid      = struct.unpack_from('<I', blk, self.RES_ID)[0]
            name_ptr = struct.unpack_from('<I', blk, self.RES_NAME_OFFSET)[0]
            rtype    = blk[self.RES_TYPE] if len(blk) > self.RES_TYPE else 0
            name     = _read_vardata_string(var, name_ptr) if var else f'Resource {uid}'

            resources.append(MppResource(
                unique_id=uid,
                resource_id=rid,
                name=name,
                type=self.RESOURCE_TYPES.get(rtype, 'Work'),
            ))

        return resources

    def _read_dependencies(self) -> List[MppDependency]:
        data = _read_stream_safe(self._ole, *self.DEP_STREAM)
        if not data:
            return []
        # Reuse MPP9 logic — relation record layout is unchanged
        return super()._parse_dependency_data(data)

    def _read_assignments(self) -> List[MppAssignment]:
        data = _read_stream_safe(self._ole, *self.ASGN_STREAM)
        if not data:
            return []
        return super()._parse_assignment_data(data)


# ─────────────────────────────────────────────────────────────────────────────
# Table-backed format detection and reader (Project 2024+)
# ─────────────────────────────────────────────────────────────────────────────

def _is_table_backed(ole: olefile.OleFileIO) -> bool:
    """
    Detect if the MPP14 file uses the table-backed storage format.

    Newer MS Project versions (2024+) store data under directories like
    '   114/TBkndTask/' instead of 'VisibleDocument/Task2'.
    """
    for entry in ole.listdir():
        if len(entry) >= 2 and entry[0].strip() == '114' and entry[1].startswith('TBknd'):
            return True
    return False


def _find_tb_dir(ole: olefile.OleFileIO) -> str:
    """Find the table-backed directory name (may have leading spaces)."""
    for entry in ole.listdir():
        if len(entry) >= 2 and entry[0].strip() == '114':
            return entry[0]
    return '   114'


def _decode_tb_date(raw: int) -> Optional[datetime.datetime]:
    """
    Decode a table-backed MPP14 date value.

    Format: upper 16 bits = day number (1-based, day 1 = 1984-01-01)
            lower 16 bits = time of day in 1/10 minutes (value / 10 = minutes)
    """
    if raw == 0 or raw == 0xFFFFFFFF:
        return None
    days = raw >> 16
    time_ticks = raw & 0xFFFF
    minutes = time_ticks / 10.0
    if days == 0 and time_ticks == 0:
        return None
    try:
        # Day numbering is 1-based: day 1 = Jan 1, 1984
        return _MPP_EPOCH + datetime.timedelta(days=days - 1, minutes=minutes)
    except (OverflowError, ValueError):
        return None


def _read_tb_vardata_string(vardata: bytes, offset: int) -> str:
    """
    Read a UTF-16LE string from table-backed Var2Data.

    Format: [uint32: byte_length][utf16-le bytes]
    """
    if not vardata or offset + 4 > len(vardata):
        return ''
    try:
        byte_len = struct.unpack_from('<I', vardata, offset)[0]
        if byte_len == 0 or byte_len > 10000 or offset + 4 + byte_len > len(vardata):
            return ''
        raw = vardata[offset + 4: offset + 4 + byte_len]
        return raw.decode('utf-16-le', errors='replace').strip('\x00')
    except Exception:
        return ''


# Field ID for task name in table-backed VarMeta
_TB_FIELD_TASK_NAME = 188743694  # 0x0B40000E


class Mpp14TableBackedReader:
    """
    Reads MPP14 table-backed format files (Project 2024+).

    This newer format stores data under '   114/TBkndTask/' directories
    instead of 'VisibleDocument/Task2'. The data uses:
      - FixedData:  fixed-size records for numeric fields
      - VarMeta:    maps (row, field_id) → offset in Var2Data
      - Var2Data:   variable-length strings/binary blobs

    FixedData record layout (202 bytes, after 48-byte header):
      0x00: unique_id    (uint32)
      0x04: task_id      (uint32)
      0x50: duration     (uint32, in project-minutes: 480 min = 1 day)
      0x5C: pct_complete (uint16)
      0x60: start_date   (uint32, encoded: days<<16 | time_ticks)
      0x64: finish_date  (uint32, encoded)
      0x8C: is_summary   (byte, 1 = summary task)
      0x8E: parent_uid   (uint16, 0xFFFF = no parent)
    """

    # FixedData header size (3 × 16-byte index entries)
    _FIXED_HEADER = 48

    # Task FixedData field offsets within each record
    _T_UID        = 0x00  # uint32
    _T_ID         = 0x04  # uint32
    _T_DURATION   = 0x50  # uint32 (minutes)
    _T_PCT        = 0x5C  # uint16
    _T_START      = 0x60  # uint32 (packed date)
    _T_FINISH     = 0x64  # uint32 (packed date)
    _T_SUMMARY    = 0x8C  # byte (1 = summary)
    _T_PARENT_UID = 0x8E  # uint16 (0xFFFF = none)

    def __init__(self, ole: olefile.OleFileIO, path: Path):
        self._ole = ole
        self._path = path
        self._dir = _find_tb_dir(ole)

    def _read_stream(self, table: str, stream: str) -> Optional[bytes]:
        """Read a stream from the table-backed directory."""
        try:
            return self._ole.openstream([self._dir, table, stream]).read()
        except Exception:
            return None

    def read(self) -> MppProject:
        proj = MppProject(
            title=self._read_title(),
            author=self._read_author(),
            mpp_version='MPP14 Table-Backed (Project 2024+)',
        )
        proj.tasks = self._read_tasks()
        proj.resources = self._read_resources()
        # Dependencies and assignments use a different structure in
        # table-backed format; return empty lists for now
        proj.dependencies = []
        proj.assignments = []
        return proj

    def _read_title(self) -> str:
        try:
            meta = self._ole.get_metadata()
            title = meta.title or ''
            return title.decode('utf-8', errors='replace') if isinstance(title, bytes) else title
        except Exception:
            return ''

    def _read_author(self) -> str:
        try:
            meta = self._ole.get_metadata()
            author = meta.author or ''
            return author.decode('utf-8', errors='replace') if isinstance(author, bytes) else author
        except Exception:
            return ''

    def _read_tasks(self) -> List[MppTask]:
        fixed = self._read_stream('TBkndTask', 'FixedData')
        varmeta = self._read_stream('TBkndTask', 'VarMeta')
        vardata = self._read_stream('TBkndTask', 'Var2Data')
        if not fixed:
            return []

        # Build name lookup from VarMeta → Var2Data
        names = self._parse_var_names(varmeta, vardata)

        # Determine record size from the data
        # The FixedData has a 48-byte header followed by fixed-size records
        data_len = len(fixed) - self._FIXED_HEADER
        if data_len <= 0:
            return []

        # Auto-detect record size: try dividing by plausible record counts
        record_size = self._detect_record_size(fixed)
        if record_size == 0:
            return []

        n_records = data_len // record_size
        tasks = []
        # Track uid → outline_level for deriving from parent chain
        uid_to_level: Dict[int, int] = {}

        for i in range(n_records):
            offset = self._FIXED_HEADER + i * record_size
            rec = fixed[offset:offset + record_size]
            if len(rec) < record_size:
                break

            uid = struct.unpack_from('<I', rec, self._T_UID)[0]
            tid = struct.unpack_from('<I', rec, self._T_ID)[0]

            # Skip blank/sentinel records
            if uid == 0xFFFFFFFF:
                continue

            dur_raw = struct.unpack_from('<I', rec, self._T_DURATION)[0]
            pct = struct.unpack_from('<H', rec, self._T_PCT)[0]
            start_raw = struct.unpack_from('<I', rec, self._T_START)[0]
            finish_raw = struct.unpack_from('<I', rec, self._T_FINISH)[0]
            is_summary = bool(rec[self._T_SUMMARY])
            parent_raw = struct.unpack_from('<H', rec, self._T_PARENT_UID)[0]
            parent_uid = None if parent_raw == 0xFFFF else parent_raw

            name = names.get(i, '')
            # Skip records with no name (deleted/blank rows in the table)
            if not name and dur_raw == 0 and pct == 0:
                continue
            if not name:
                name = f'Task {uid}'
            duration = float(dur_raw) if dur_raw > 0 else None
            milestone = (dur_raw == 0 and not is_summary and uid > 0)

            tasks.append(MppTask(
                unique_id=uid,
                task_id=tid,
                name=name,
                outline_level=0,  # Computed below from parent chain
                duration_minutes=duration,
                start=_decode_tb_date(start_raw),
                finish=_decode_tb_date(finish_raw),
                percent_complete=min(100, pct),
                milestone=milestone,
                summary=is_summary,
                parent_unique_id=parent_uid,
            ))
            uid_to_level[uid] = 0  # placeholder

        # Derive outline levels from parent chain
        uid_map = {t.unique_id: t for t in tasks}
        for t in tasks:
            level = 0
            cur = t
            visited = set()
            while cur.parent_unique_id is not None and cur.parent_unique_id in uid_map:
                if cur.parent_unique_id in visited:
                    break  # avoid cycles
                visited.add(cur.parent_unique_id)
                cur = uid_map[cur.parent_unique_id]
                level += 1
            t.outline_level = level

        return tasks

    def _detect_record_size(self, fixed: bytes) -> int:
        """Auto-detect FixedData record size from the data."""
        data_len = len(fixed) - self._FIXED_HEADER
        if data_len <= 0:
            return 0

        # Look at the FixedData to count records by scanning for sequential UIDs
        # starting from the header
        best_size = 0
        for candidate in range(150, 300):
            if data_len % candidate != 0:
                continue
            n = data_len // candidate
            if n < 2:
                continue
            # Check if first few records have sequential UIDs
            try:
                uid0 = struct.unpack_from('<I', fixed, self._FIXED_HEADER)[0]
                uid1 = struct.unpack_from('<I', fixed, self._FIXED_HEADER + candidate)[0]
                if uid1 == uid0 + 1:
                    best_size = candidate
                    break
            except struct.error:
                continue

        return best_size

    def _parse_var_names(
        self,
        varmeta: Optional[bytes],
        vardata: Optional[bytes],
    ) -> Dict[int, str]:
        """Parse VarMeta to extract task names keyed by row index."""
        names: Dict[int, str] = {}
        if not varmeta or not vardata or len(varmeta) < 36:
            return names

        # VarMeta: 24-byte header + 12-byte entries
        # Entry: row_index(4) + var_data_offset(4) + field_id(4)
        for i in range(24, len(varmeta) - 11, 12):
            row = struct.unpack_from('<I', varmeta, i)[0]
            var_offset = struct.unpack_from('<I', varmeta, i + 4)[0]
            field_id = struct.unpack_from('<I', varmeta, i + 8)[0]

            if field_id == _TB_FIELD_TASK_NAME and row not in names:
                s = _read_tb_vardata_string(vardata, var_offset)
                if s:
                    names[row] = s

        return names

    def _read_resources(self) -> List[MppResource]:
        """Read resources from TBkndRsc streams."""
        varmeta = self._read_stream('TBkndRsc', 'VarMeta')
        vardata = self._read_stream('TBkndRsc', 'Var2Data')
        fixed = self._read_stream('TBkndRsc', 'FixedData')
        if not fixed:
            return []

        # Resource names from VarMeta (field 188743694 might be reused or
        # resources use a different field ID — but names are scarce in this file)
        rsc_names: Dict[int, str] = {}
        if varmeta and vardata:
            for i in range(24, len(varmeta) - 11, 12):
                row = struct.unpack_from('<I', varmeta, i)[0]
                var_offset = struct.unpack_from('<I', varmeta, i + 4)[0]
                field_id = struct.unpack_from('<I', varmeta, i + 8)[0]
                # Resource name field ID (same pattern as task name)
                if field_id == _TB_FIELD_TASK_NAME and row not in rsc_names:
                    s = _read_tb_vardata_string(vardata, var_offset)
                    if s:
                        rsc_names[row] = s

        # FixedData has a similar header structure
        # Resource records are simpler — just extract uid/id from the header entries
        resources = []
        # Try to detect record size similarly to tasks
        data_len = len(fixed)
        if data_len < self._FIXED_HEADER:
            return []

        # For resources, the header pattern is also 16-byte entries
        # but the format is simpler. Extract UIDs from the initial entries.
        # Read 16-byte header entries first
        header_entries = min(3, data_len // 16)
        remaining = data_len - header_entries * 16
        if remaining <= 0:
            return []

        # Auto-detect record size
        record_size = 0
        for candidate in range(50, 300):
            if remaining % candidate == 0:
                n = remaining // candidate
                if 1 <= n <= 100:
                    record_size = candidate
                    break

        if record_size == 0:
            return []

        n_records = remaining // record_size
        for i in range(n_records):
            offset = header_entries * 16 + i * record_size
            rec = fixed[offset:offset + record_size]
            if len(rec) < 8:
                break
            uid = struct.unpack_from('<I', rec, 0)[0]
            if uid == 0 or uid == 0xFFFFFFFF:
                continue
            rid = struct.unpack_from('<I', rec, 4)[0] if len(rec) >= 8 else uid
            name = rsc_names.get(i, '')
            resources.append(MppResource(
                unique_id=uid,
                resource_id=rid,
                name=name,
                type='Work',
            ))

        return resources


# Patch MPP9Reader to expose shared parse helpers used by Mpp14Reader
def _mpp9_parse_dependency_data(self, data: bytes) -> List[MppDependency]:
    deps = []
    rec_size = self.REL_RECORD_SIZE
    n = len(data) // rec_size
    for i in range(n):
        rec = data[i * rec_size:(i + 1) * rec_size]
        if len(rec) < rec_size:
            break
        pred = struct.unpack_from('<I', rec, self.REL_PREDECESSOR_UID)[0]
        succ = struct.unpack_from('<I', rec, self.REL_SUCCESSOR_UID)[0]
        rtype = struct.unpack_from('<H', rec, self.REL_TYPE)[0]
        lag_raw = struct.unpack_from('<i', rec, self.REL_LAG)[0]
        lag_unit = rec[self.REL_LAG_UNIT] if len(rec) > self.REL_LAG_UNIT else 5
        if pred == 0 or succ == 0 or pred == 0xFFFFFFFF or succ == 0xFFFFFFFF:
            continue
        lag_mins = 0.0
        if lag_raw != 0:
            lag_mins = _decode_duration(abs(lag_raw), lag_unit) or 0.0
            if lag_raw < 0:
                lag_mins = -lag_mins
        deps.append(MppDependency(
            predecessor_unique_id=pred,
            successor_unique_id=succ,
            relation_type=self.RELATION_TYPES.get(rtype, 'FS'),
            lag_minutes=lag_mins,
        ))
    return deps


def _mpp9_parse_assignment_data(self, data: bytes) -> List[MppAssignment]:
    asgns = []
    REC_SIZE = 116
    n = len(data) // REC_SIZE
    for i in range(n):
        rec = data[i * REC_SIZE:(i + 1) * REC_SIZE]
        if len(rec) < REC_SIZE:
            break
        task_uid = struct.unpack_from('<I', rec, 0)[0]
        res_uid  = struct.unpack_from('<I', rec, 4)[0]
        units    = struct.unpack_from('<d', rec, 8)[0]
        if task_uid == 0 or res_uid == 0:
            continue
        asgns.append(MppAssignment(
            task_unique_id=task_uid,
            resource_unique_id=res_uid,
            units=round(units * 100.0, 1),
        ))
    return asgns


Mpp9Reader._parse_dependency_data = _mpp9_parse_dependency_data
Mpp9Reader._parse_assignment_data = _mpp9_parse_assignment_data
Mpp9Reader._read_dependencies = lambda self: self._parse_dependency_data(
    _read_stream_safe(self._ole, 'VisibleDocument', 'Relations') or b'')
Mpp9Reader._read_assignments = lambda self: self._parse_assignment_data(
    _read_stream_safe(self._ole, 'VisibleDocument', 'Assignments') or b'')


# ─────────────────────────────────────────────────────────────────────────────
# Variable-length data pool reader
# ─────────────────────────────────────────────────────────────────────────────

def _read_vardata_string(vardata: bytes, ptr: int) -> str:
    """
    Read a string from the variable-data pool given a pointer offset.

    In MPP9/12/14 the var-data pool stores strings as:
      [uint16: byte_length][utf16-le bytes]

    MPXJ source: VarMeta / VarData classes.
    """
    if not vardata or ptr == 0 or ptr == 0xFFFFFFFF:
        return ''
    if ptr + 2 > len(vardata):
        return ''
    try:
        byte_len = struct.unpack_from('<H', vardata, ptr)[0]
        if byte_len == 0 or ptr + 2 + byte_len > len(vardata):
            return ''
        raw = vardata[ptr + 2: ptr + 2 + byte_len]
        return raw.decode('utf-16-le', errors='replace').strip('\x00')
    except Exception:
        return ''


# ─────────────────────────────────────────────────────────────────────────────
# CLI  (python mpp_reader.py yourfile.mpp)
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import sys

    if len(sys.argv) < 2:
        print("Usage: python mpp_reader.py <file.mpp>")
        sys.exit(1)

    try:
        proj = MppProject.read(sys.argv[1])
    except (MppReadError, FileNotFoundError) as e:
        print(f"ERROR: {e}")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  {proj.title or '(no title)'}")
    print(f"  Format : {proj.mpp_version}")
    print(f"  Author : {proj.author or '(unknown)'}")
    print(f"{'='*60}\n")

    real_tasks = proj.real_tasks()
    print(f"TASKS ({len(real_tasks)}):")
    for t in real_tasks:
        print(f"  {t}")

    real_res = proj.real_resources()
    print(f"\nRESOURCES ({len(real_res)}):")
    for r in real_res:
        print(f"  {r}")

    print(f"\nDEPENDENCIES ({len(proj.dependencies)}):")
    for d in proj.dependencies:
        pred = proj.task_by_uid(d.predecessor_unique_id)
        succ = proj.task_by_uid(d.successor_unique_id)
        pred_name = pred.name if pred else f'UID:{d.predecessor_unique_id}'
        succ_name = succ.name if succ else f'UID:{d.successor_unique_id}'
        print(f"  '{pred_name}' → '{succ_name}'  [{d.relation_type}]"
              f"{'  lag=' + str(d.lag_minutes) + 'min' if d.lag_minutes else ''}")

    print(f"\nASSIGNMENTS ({len(proj.assignments)}):")
    for a in proj.assignments:
        task = proj.task_by_uid(a.task_unique_id)
        res  = proj.resource_by_uid(a.resource_unique_id)
        tname = task.name if task else f'UID:{a.task_unique_id}'
        rname = res.name  if res  else f'UID:{a.resource_unique_id}'
        print(f"  '{rname}' → '{tname}' @ {a.units}%")
