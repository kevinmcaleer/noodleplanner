"""Excel workbook import and conversion to NoodlePlanner markdown format."""

import io
import logging
import math
import re
import zipfile
from datetime import datetime, timedelta

import openpyxl
from dateutil import parser as dateutil_parser

from .format_converter import generate_raid_log_text

logger = logging.getLogger(__name__)

# Known column name patterns for auto-detection
COLUMN_PATTERNS = {
    "task_name": ["task name", "task", "name", "activity", "wbs"],
    "start_date": ["start", "start date", "begin", "begin date"],
    "end_date": ["finish", "finish date", "end", "end date"],
    "duration": ["duration", "duration (days)", "days", "effort"],
    "resources": ["resources", "resource", "assigned to", "owner"],
    "percent_complete": ["% complete", "percent complete", "complete", "progress", "% done"],
    "comment": ["comment", "comments", "notes", "note", "description"],
}

# Planner header field names (case-insensitive matching)
PLANNER_HEADER_FIELDS = {
    "task number",
    "project name",
    "plan owner",
    "project start",
    "project start date",
    "project finish",
    "project finish date",
    "duration",
    "% complete",
    "exported on",
}

# Planner task column names mapped to internal field names.
# Each field maps to a list of possible column header names (first match wins).
PLANNER_TASK_COLUMNS = {
    "task_name": ["task name", "name"],
    "start_date": ["start"],
    "end_date": ["finish"],
    "duration": ["duration"],
    "resources": ["resource names", "assigned to"],
    "percent_complete": ["% complete"],
    "depends_on": ["predecessors", "depends on"],
    "task_number": ["id", "task number"],
    "outline_level": ["outline level", "outline number"],
}

# Known Planner task column headers used to identify the column header row
PLANNER_TASK_HEADER_INDICATORS = {
    "task name", "name", "assigned to", "resource names",
    "predecessors", "depends on", "outline level", "outline number",
    "bucket", "labels", "priority", "milestone", "sprint",
}

# Excel epoch for serial date conversion (Excel uses Jan 0, 1900 as day 1)
EXCEL_EPOCH = datetime(1899, 12, 30)


def normalize_date(value):
    """Convert various date representations to YYYY-MM-DD string.

    Handles datetime objects, ISO strings, DD/MM/YYYY, MM/DD/YYYY,
    DD-Mon-YYYY, and Excel serial numbers.

    Returns None for invalid or out-of-range dates.
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        return None

    parsed = None

    if isinstance(value, datetime):
        parsed = value

    elif isinstance(value, (int, float)):
        if 1 < value < 200000:
            parsed = EXCEL_EPOCH + timedelta(days=value)
        else:
            return None

    elif isinstance(value, str):
        value = value.strip()
        formats = [
            "%Y-%m-%d",
            "%d/%m/%Y",
            "%m/%d/%Y",
            "%d-%b-%Y",
            "%d-%B-%Y",
            "%Y/%m/%d",
            "%d.%m.%Y",
        ]
        for fmt in formats:
            try:
                parsed = datetime.strptime(value, fmt)
                break
            except ValueError:
                continue

        # Fallback to dateutil for unusual formats
        if parsed is None:
            try:
                parsed = dateutil_parser.parse(value, dayfirst=True)
            except (ValueError, OverflowError):
                return None
    else:
        return None

    # Validate date range
    if parsed.year < 1900 or parsed.year > 2100:
        return None

    return parsed.strftime("%Y-%m-%d")


def detect_hierarchy(task_names):
    """Detect task hierarchy from leading whitespace in task names.

    Returns list of (level, cleaned_name) tuples.
    Two spaces = one level of indentation (matching export format).
    """
    result = []
    for name in task_names:
        if not name or not isinstance(name, str):
            result.append((0, str(name) if name else ""))
            continue
        stripped = name.lstrip(" ")
        leading_spaces = len(name) - len(stripped)
        level = leading_spaces // 2
        result.append((level, stripped))
    return result


def calculate_duration_from_dates(start_str, end_str):
    """Calculate working days between two date strings (YYYY-MM-DD).

    Excludes weekends. Returns None if either date is invalid.
    """
    if not start_str or not end_str:
        return None
    try:
        start = datetime.strptime(start_str, "%Y-%m-%d")
        end = datetime.strptime(end_str, "%Y-%m-%d")
    except (ValueError, TypeError):
        return None

    if end < start:
        return None

    working_days = 0
    current = start
    while current <= end:
        if current.weekday() < 5:  # Monday=0 to Friday=4
            working_days += 1
        current += timedelta(days=1)

    return working_days


def _read_workbook(file_bytes, filename):
    """Load a workbook from bytes.

    Supports .xlsx (via openpyxl) and .xls (via xlrd + openpyxl adapter).
    """
    extension = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if extension not in ("xlsx", "xls"):
        raise ValueError(f"Unsupported file extension: .{extension}")

    if extension == "xls":
        return _read_xls_workbook(file_bytes)

    try:
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    except (zipfile.BadZipFile, KeyError, ValueError) as e:
        raise ValueError(f"Failed to read Excel file: {e}")
    return wb


def _read_xls_workbook(file_bytes):
    """Convert a legacy .xls file to an openpyxl Workbook in memory.

    Uses xlrd to read the .xls, then writes it into an openpyxl Workbook
    so the rest of the pipeline can treat both formats identically.
    """
    try:
        import xlrd
    except ImportError:
        raise ValueError(
            "Reading .xls files requires the 'xlrd' package. "
            "Install it with: pip install xlrd"
        )

    try:
        xls_book = xlrd.open_workbook(file_contents=file_bytes)
    except (ValueError, TypeError, KeyError, xlrd.biffh.XLRDError) as e:
        raise ValueError(f"Failed to read .xls file: {e}")

    wb = openpyxl.Workbook()
    # Remove default sheet that openpyxl creates
    default_sheet = wb.active

    for idx, sheet_name in enumerate(xls_book.sheet_names()):
        xls_sheet = xls_book.sheet_by_index(idx)
        if idx == 0:
            ws = default_sheet
            ws.title = sheet_name
        else:
            ws = wb.create_sheet(sheet_name)

        for row_idx in range(xls_sheet.nrows):
            for col_idx in range(xls_sheet.ncols):
                cell = xls_sheet.cell(row_idx, col_idx)
                value = cell.value
                # xlrd returns dates as floats with cell type XL_CELL_DATE
                if cell.ctype == xlrd.XL_CELL_DATE:
                    try:
                        date_tuple = xlrd.xldate_as_tuple(value, xls_book.datemode)
                        value = datetime(*date_tuple)
                    except (ValueError, TypeError):
                        pass
                ws.cell(row=row_idx + 1, column=col_idx + 1, value=value)

    xls_book.release_resources()
    return wb


def parse_planner_duration(raw_duration):
    """Parse a Planner duration string with units into noodleplanner format.

    Planner exports durations like "5 days", "2 weeks", "1 month", "3 days?".
    Converts to noodleplanner format: days -> Xd, weeks -> Xw, months -> Xm.

    Returns (value, suffix) tuple, e.g. (5, "d") or None if unparseable.
    """
    if raw_duration is None:
        return None

    text = str(raw_duration).strip().rstrip("?")
    if not text:
        return None

    # Try numeric-only value (assume days)
    try:
        val = int(float(text))
        return (val, "d") if val >= 0 else None
    except (ValueError, TypeError):
        pass

    # Match patterns like "5 days", "2 weeks", "1 month", "1.5 days", "10 mons"
    match = re.match(r"(\d+(?:\.\d+)?)\s*(days?|weeks?|wks?|months?|mons?)", text, re.IGNORECASE)
    if not match:
        return None

    value = float(match.group(1))
    unit = match.group(2).lower()

    if unit.startswith("day"):
        return (int(value), "d")
    elif unit.startswith("week") or unit.startswith("wk"):
        return (int(value), "w")
    elif unit.startswith("mon"):
        return (int(value), "m")

    return None


def parse_planner_dependency(dep_string, task_number_to_name):
    """Parse a Planner dependency string into noodleplanner dependency references.

    Planner uses formats like:
    - "2FS" (task 2, finish-to-start)
    - "3SS" (task 3, start-to-start)
    - "2FS,5FS" (multiple dependencies)
    - "2" (task 2, implied finish-to-start)

    Only finish-to-start (FS) dependencies are supported by noodleplanner.
    Other types (SS, FF, SF) generate warnings.

    Returns (dependency_names, warnings) tuple.
    """
    if dep_string is None or not str(dep_string).strip():
        return [], []

    text = str(dep_string).strip()
    deps = []
    warnings = []

    for part in text.split(","):
        part = part.strip()
        if not part:
            continue

        # Match: optional number + optional dependency type (FS, SS, FF, SF)
        match = re.match(r"(\d+)\s*(FS|SS|FF|SF)?", part, re.IGNORECASE)
        if not match:
            warnings.append(f"Could not parse dependency '{part}'")
            continue

        task_num = int(match.group(1))
        dep_type = (match.group(2) or "FS").upper()

        if dep_type != "FS":
            warnings.append(
                f"Dependency type '{dep_type}' on task {task_num} "
                f"not supported, treating as finish-to-start (FS)"
            )

        task_name = task_number_to_name.get(task_num)
        if task_name:
            deps.append(task_name)
        else:
            warnings.append(f"Dependency references unknown task number {task_num}")

    return deps, warnings


def detect_planner_worksheet(wb):
    """Check if a workbook contains a Microsoft Planner export.

    Planner exports typically have a worksheet (often called 'Project tasks'
    or 'Tasks') with metadata header rows followed by a task data table.
    Detection checks both the sheet name and content pattern.

    Returns the worksheet name if detected, None otherwise.
    """
    # First, check for exact "Project tasks" sheet name
    for sheet_name in wb.sheetnames:
        if sheet_name.lower().strip() == "project tasks":
            return sheet_name

    # Next, check sheets whose content looks like a Planner export:
    # metadata rows (label-value pairs) with known Planner header fields
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True, max_row=15))
        matched_fields = 0
        for row in rows:
            if not row or all(c is None for c in row):
                continue
            first_cell = str(row[0]).strip().lower() if row[0] is not None else ""
            if first_cell in PLANNER_HEADER_FIELDS:
                matched_fields += 1
        if matched_fields >= 3:
            return sheet_name

    return None


def _is_task_header_row(row):
    """Check if a row looks like the task column header row.

    Task column header rows have many non-empty cells (typically 10+)
    and contain known Planner column names.
    """
    non_empty = [str(c).strip().lower() for c in row if c is not None and str(c).strip()]
    if len(non_empty) < 4:
        return False
    return bool(set(non_empty) & PLANNER_TASK_HEADER_INDICATORS)


def parse_planner_header(ws):
    """Parse the Planner header section from a worksheet.

    The header occupies the first few rows and contains project metadata
    as label-value pairs (2 columns). The task data table starts at the
    row containing task column headers (many columns).

    Returns dict with parsed header fields and the row index where
    task data headers begin.
    """
    header = {}
    task_header_row = None

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return header, None

    for row_idx, row in enumerate(rows):
        if not row or all(cell is None for cell in row):
            continue

        # Check if this row looks like the task column header row
        # (many columns with known task header names) before checking
        # metadata fields, since some names overlap (e.g. "Task Number").
        if _is_task_header_row(row):
            task_header_row = row_idx
            break

        first_cell = str(row[0]).strip().lower() if row[0] is not None else ""

        # Check if this row is a metadata header field
        if first_cell in ("task number", "project name"):
            header["project_name"] = str(row[1]).strip() if len(row) > 1 and row[1] else ""
        elif first_cell == "plan owner":
            header["plan_owner"] = str(row[1]).strip() if len(row) > 1 and row[1] else ""
        elif first_cell in ("project start date", "project start"):
            header["start_date"] = normalize_date(row[1]) if len(row) > 1 else None
        elif first_cell in PLANNER_HEADER_FIELDS:
            # Other known metadata fields (project finish, % complete, etc.)
            pass

    return header, task_header_row


def convert_planner_to_markdown(file_bytes, filename):
    """Convert a Microsoft Planner export to NoodlePlanner markdown format.

    Detects the Planner-specific format, parses header metadata, and
    converts tasks with durations and dependencies into markdown.

    Returns the same format as convert_excel_to_markdown:
        {
            "markdown": str,
            "warnings": [str, ...],
            "task_count": int,
            "phase_count": int,
        }
    """
    wb = _read_workbook(file_bytes, filename)
    warnings = []

    try:
        planner_sheet = detect_planner_worksheet(wb)
        if not planner_sheet:
            raise ValueError("No Planner tasks worksheet found in workbook")

        ws = wb[planner_sheet]
        header_info, task_header_row = parse_planner_header(ws)

        if task_header_row is None:
            raise ValueError("Could not find task column headers in Planner worksheet")

        rows = list(ws.iter_rows(values_only=True))
        header_row = rows[task_header_row]
        headers = [str(c).strip().lower() if c is not None else "" for c in header_row]
        data_rows = rows[task_header_row + 1:]

        # Build column index map for Planner columns
        col_index = {}
        for field, patterns in PLANNER_TASK_COLUMNS.items():
            for pattern in patterns:
                for i, h in enumerate(headers):
                    if h == pattern:
                        col_index[field] = i
                        break
                if field in col_index:
                    break

        if "task_name" not in col_index:
            raise ValueError("Could not find task name column (expected 'Task Name' or 'Name') in Planner worksheet")

        # First pass: build task number to name mapping for dependencies
        task_number_to_name = {}
        for row in data_rows:
            if not row or all(c is None for c in row):
                continue
            task_name_val = row[col_index["task_name"]] if col_index["task_name"] < len(row) else None
            if task_name_val is None or str(task_name_val).strip() == "":
                continue
            if "task_number" in col_index and col_index["task_number"] < len(row):
                raw_num = row[col_index["task_number"]]
                if raw_num is not None:
                    try:
                        task_num = int(float(str(raw_num)))
                        task_number_to_name[task_num] = str(task_name_val).strip()
                    except (ValueError, TypeError):
                        pass

        # Second pass: extract task data
        tasks = []
        all_resources = set()

        for row_num, row in enumerate(data_rows, start=task_header_row + 2):
            if not row or all(c is None for c in row):
                continue

            task_name_val = row[col_index["task_name"]] if col_index["task_name"] < len(row) else None
            if task_name_val is None or str(task_name_val).strip() == "":
                continue

            task_name = str(task_name_val).strip()

            # Parse dates
            start_date = None
            end_date = None
            if "start_date" in col_index and col_index["start_date"] < len(row):
                start_date = normalize_date(row[col_index["start_date"]])
            if "end_date" in col_index and col_index["end_date"] < len(row):
                end_date = normalize_date(row[col_index["end_date"]])

            # Parse duration with units
            duration = None
            duration_suffix = "d"
            if "duration" in col_index and col_index["duration"] < len(row):
                raw_dur = row[col_index["duration"]]
                parsed = parse_planner_duration(raw_dur)
                if parsed:
                    duration, duration_suffix = parsed
                elif raw_dur is not None and str(raw_dur).strip():
                    warnings.append(f"Row {row_num}: Could not parse duration '{raw_dur}'")

            # Calculate duration from dates if not explicit
            if duration is None and start_date and end_date:
                calc_dur = calculate_duration_from_dates(start_date, end_date)
                if calc_dur:
                    duration = calc_dur
                    duration_suffix = "d"

            # Parse resources
            resources = ""
            if "resources" in col_index and col_index["resources"] < len(row):
                raw_res = row[col_index["resources"]]
                if raw_res is not None and str(raw_res).strip():
                    resources = str(raw_res).strip()
                    for r in resources.split(","):
                        r = r.strip()
                        if r:
                            all_resources.add(r)

            # Parse percent complete
            percent = None
            if "percent_complete" in col_index and col_index["percent_complete"] < len(row):
                raw_pct = row[col_index["percent_complete"]]
                if raw_pct is not None and str(raw_pct).strip():
                    try:
                        pct_val = float(str(raw_pct).rstrip("%"))
                        # Planner stores as float 0.0-1.0
                        if 0 < pct_val <= 1:
                            pct_val = pct_val * 100
                        percent = int(pct_val)
                        percent = max(0, min(100, percent))
                    except (ValueError, TypeError):
                        pass

            # Parse dependencies
            dep_names = []
            if "depends_on" in col_index and col_index["depends_on"] < len(row):
                raw_dep = row[col_index["depends_on"]]
                dep_names, dep_warnings = parse_planner_dependency(raw_dep, task_number_to_name)
                warnings.extend(
                    f"Row {row_num}: {w}" for w in dep_warnings
                )

            # Detect hierarchy from outline level
            level = 0
            if "outline_level" in col_index and col_index["outline_level"] < len(row):
                raw_level = row[col_index["outline_level"]]
                if raw_level is not None:
                    try:
                        level = max(0, int(float(str(raw_level))) - 1)
                    except (ValueError, TypeError):
                        pass

            tasks.append({
                "name": task_name,
                "start_date": start_date,
                "end_date": end_date,
                "duration": duration,
                "duration_suffix": duration_suffix,
                "resources": resources,
                "percent": percent,
                "depends": dep_names,
                "level": level,
            })

        if not tasks:
            raise ValueError("No tasks found in Planner worksheet")

        # Build resource map
        resource_map = {}
        for name in all_resources:
            resource_map[name] = _make_shortname(name)

        # Build markdown
        markdown_lines = []

        # Front matter with project metadata
        markdown_lines.append("---")
        if header_info.get("project_name"):
            markdown_lines.append(f"title: {header_info['project_name']}")
        if header_info.get("plan_owner"):
            markdown_lines.append(f"manager: {header_info['plan_owner']}")
        if header_info.get("start_date"):
            markdown_lines.append(f"start: {header_info['start_date']}")
        if all_resources:
            markdown_lines.append(_build_resource_section(all_resources))
        markdown_lines.append("---")
        markdown_lines.append("")

        # Render tasks with hierarchy
        phase_count = 0
        task_count = 0
        has_hierarchy = any(t["level"] > 0 for t in tasks)

        if not has_hierarchy:
            markdown_lines.append(header_info.get("project_name", "Imported Tasks"))
            phase_count = 1
            for task in tasks:
                task_count += 1
                meta = _build_planner_task_metadata(task, resource_map)
                markdown_lines.append(f"  {task['name']}{meta}")
        else:
            current_phase = None
            for task in tasks:
                level = task["level"]
                if level == 0:
                    phase_count += 1
                    current_phase = task["name"]
                    meta = _build_planner_task_metadata(task, resource_map)
                    if meta:
                        markdown_lines.append(f"{task['name']}{meta}")
                        task_count += 1
                    else:
                        markdown_lines.append(task["name"])
                else:
                    task_count += 1
                    if current_phase is None:
                        markdown_lines.append("Tasks")
                        current_phase = "Tasks"
                        phase_count += 1
                    indent = "  " * level
                    meta = _build_planner_task_metadata(task, resource_map)
                    markdown_lines.append(f"{indent}{task['name']}{meta}")

        markdown = "\n".join(markdown_lines) + "\n"

        return {
            "markdown": markdown,
            "warnings": warnings,
            "task_count": task_count,
            "phase_count": phase_count,
        }

    finally:
        wb.close()


def _build_planner_task_metadata(task, resource_map):
    """Build the metadata suffix for a Planner task line."""
    parts = []

    # Resources
    if task.get("resources"):
        shortnames = _resource_to_shortname(task["resources"], resource_map)
        if shortnames:
            parts.append(shortnames)

    # Duration with proper suffix (d, w, m)
    if task.get("duration") and task["duration"] > 0:
        suffix = task.get("duration_suffix", "d")
        parts.append(f"{task['duration']}{suffix}")

    # Start date (only if no duration)
    if task.get("start_date") and not task.get("duration"):
        parts.append(f"start:{task['start_date']}")

    # Percent complete
    if task.get("percent") is not None and task["percent"] > 0:
        parts.append(f"{task['percent']}%")

    # Dependencies
    if task.get("depends"):
        dep_str = ", ".join(task["depends"])
        parts.append(f"[depends {dep_str}]")

    if not parts:
        return ""
    return " " + " ".join(parts)


def analyze_workbook(file_bytes, filename):
    """Analyze an Excel workbook and return sheet/column metadata.

    Returns:
        {
            "sheets": [
                {
                    "name": str,
                    "row_count": int,
                    "columns": [str, ...],
                    "sample_rows": [[value, ...], ...]
                },
                ...
            ]
        }
    """
    wb = _read_workbook(file_bytes, filename)
    sheets = []

    try:
        # Detect if this is a Planner export
        planner_sheet = detect_planner_worksheet(wb)
        is_planner = planner_sheet is not None

        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows = list(ws.iter_rows(values_only=True))

            if not rows:
                sheets.append({
                    "name": sheet_name,
                    "row_count": 0,
                    "columns": [],
                    "sample_rows": [],
                })
                continue

            # For the Planner tasks sheet, skip metadata rows and find actual headers
            header_row_idx = 0
            if is_planner and sheet_name == planner_sheet:
                _header_info, task_header_row = parse_planner_header(ws)
                if task_header_row is not None:
                    header_row_idx = task_header_row

            headers = [str(c) if c is not None else "" for c in rows[header_row_idx]]
            data_rows = rows[header_row_idx + 1:]

            # Sample up to 5 data rows, converting values to strings
            sample_rows = []
            for row in data_rows[:5]:
                sample_row = []
                for cell in row:
                    if cell is None:
                        sample_row.append("")
                    elif isinstance(cell, datetime):
                        sample_row.append(cell.strftime("%Y-%m-%d"))
                    else:
                        sample_row.append(str(cell))
                sample_rows.append(sample_row)

            sheets.append({
                "name": sheet_name,
                "row_count": len(data_rows),
                "columns": headers,
                "sample_rows": sample_rows,
            })
    finally:
        wb.close()

    result = {"sheets": sheets}
    if is_planner:
        result["is_planner"] = True
    return result


def _auto_detect_column(columns, field_name):
    """Try to match a field name to a column header using known patterns."""
    patterns = COLUMN_PATTERNS.get(field_name, [])
    columns_lower = [c.lower().strip() for c in columns]
    for pattern in patterns:
        for i, col in enumerate(columns_lower):
            if col == pattern:
                return columns[i]
    return None


def _build_resource_section(resource_names):
    """Build the Resources front matter section from a set of resource names."""
    if not resource_names:
        return ""

    lines = ["Resources:"]
    for name in sorted(resource_names):
        # Create a shortname from the full name
        shortname = _make_shortname(name)
        lines.append(f"- @{shortname}: {name}")
    return "\n".join(lines)


def _make_shortname(full_name):
    """Generate a shortname from a full resource name."""
    # If it already looks like a shortname (single word, lowercase, no spaces)
    if re.match(r"^@?\w+$", full_name) and " " not in full_name:
        return full_name.lstrip("@").lower()

    parts = full_name.strip().split(",")[0].strip().split()
    if not parts:
        return "unknown"
    if len(parts) == 1:
        return parts[0].lower()
    # First name lowercase
    return parts[0].lower()


def _resource_to_shortname(resource_str, resource_map):
    """Convert full resource name(s) to @shortname references."""
    if not resource_str or not isinstance(resource_str, str):
        return ""

    resources = [r.strip() for r in resource_str.split(",")]
    shortnames = []
    for r in resources:
        if not r:
            continue
        if r in resource_map:
            shortnames.append(f"@{resource_map[r]}")
        else:
            shortnames.append(f"@{_make_shortname(r)}")

    return ", ".join(shortnames)


def convert_excel_to_markdown(file_bytes, filename, sheet_name, column_mapping):
    """Convert an Excel worksheet to NoodlePlanner markdown format.

    Args:
        file_bytes: Raw bytes of the Excel file
        filename: Original filename (for format detection)
        sheet_name: Name of the worksheet to convert
        column_mapping: Dict mapping field names to column headers, e.g.
            {"task_name": "Task Name", "start_date": "Start", ...}

    Returns:
        {
            "markdown": str,
            "warnings": [str, ...],
            "task_count": int,
            "phase_count": int,
        }
    """
    if "task_name" not in column_mapping or not column_mapping["task_name"]:
        raise ValueError("task_name column mapping is required")

    wb = _read_workbook(file_bytes, filename)
    warnings = []

    try:
        if sheet_name not in wb.sheetnames:
            raise ValueError(f"Sheet '{sheet_name}' not found in workbook")

        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))

        if not rows:
            raise ValueError("Worksheet is empty")

        # For Planner exports, skip metadata rows to find actual headers
        header_row_idx = 0
        planner_sheet = detect_planner_worksheet(wb)
        if planner_sheet and sheet_name == planner_sheet:
            _header_info, task_header_row = parse_planner_header(ws)
            if task_header_row is not None:
                header_row_idx = task_header_row

        headers = [str(c) if c is not None else "" for c in rows[header_row_idx]]
        data_rows = rows[header_row_idx + 1:]

        # Build column index map
        col_index = {}
        for field, col_name in column_mapping.items():
            if col_name and col_name in headers:
                col_index[field] = headers.index(col_name)

        if "task_name" not in col_index:
            raise ValueError(
                f"Task name column '{column_mapping['task_name']}' not found in sheet headers"
            )

        # Extract task data
        tasks = []
        all_resources = set()

        for row_num, row in enumerate(data_rows, start=2):
            # Get task name
            task_name_val = row[col_index["task_name"]] if col_index["task_name"] < len(row) else None
            if task_name_val is None or str(task_name_val).strip() == "":
                continue  # Skip empty rows

            task_name = str(task_name_val)

            # Parse dates
            start_date = None
            end_date = None
            if "start_date" in col_index and col_index["start_date"] < len(row):
                raw_start = row[col_index["start_date"]]
                start_date = normalize_date(raw_start)
                if raw_start is not None and str(raw_start).strip() and start_date is None:
                    warnings.append(f"Row {row_num}: Could not parse start date '{raw_start}'")

            if "end_date" in col_index and col_index["end_date"] < len(row):
                raw_end = row[col_index["end_date"]]
                end_date = normalize_date(raw_end)
                if raw_end is not None and str(raw_end).strip() and end_date is None:
                    warnings.append(f"Row {row_num}: Could not parse end date '{raw_end}'")

            # Validate start < end
            if start_date and end_date and start_date > end_date:
                warnings.append(
                    f"Row {row_num}: Start date ({start_date}) is after end date ({end_date})"
                )

            # Parse duration
            duration = None
            duration_suffix = "d"
            if "duration" in col_index and col_index["duration"] < len(row):
                raw_dur = row[col_index["duration"]]
                if raw_dur is not None and str(raw_dur).strip():
                    try:
                        duration = int(float(str(raw_dur)))
                        if duration < 0:
                            warnings.append(
                                f"Row {row_num}: Negative duration ({duration}) treated as 0"
                            )
                            duration = 0
                    except (ValueError, TypeError):
                        # Try parsing text durations like "7 days", "2 weeks"
                        parsed = parse_planner_duration(raw_dur)
                        if parsed:
                            duration, duration_suffix = parsed
                        else:
                            warnings.append(
                                f"Row {row_num}: Could not parse duration '{raw_dur}'"
                            )

            # Calculate duration from dates if not explicit
            if duration is None and start_date and end_date:
                duration = calculate_duration_from_dates(start_date, end_date)

            # Parse resources
            resources = ""
            if "resources" in col_index and col_index["resources"] < len(row):
                raw_res = row[col_index["resources"]]
                if raw_res is not None and str(raw_res).strip():
                    resources = str(raw_res).strip()
                    # Collect all unique resource names
                    for r in resources.split(","):
                        r = r.strip()
                        if r:
                            all_resources.add(r)

            # Parse percent complete
            percent = None
            if "percent_complete" in col_index and col_index["percent_complete"] < len(row):
                raw_pct = row[col_index["percent_complete"]]
                if raw_pct is not None and str(raw_pct).strip():
                    try:
                        pct_val = float(str(raw_pct).rstrip("%"))
                        # Excel sometimes stores 0.75 for 75%
                        if 0 < pct_val < 1:
                            pct_val = pct_val * 100
                        percent = int(pct_val)
                        if percent < 0 or percent > 100:
                            warnings.append(
                                f"Row {row_num}: Percent complete ({percent}%) "
                                f"outside 0-100 range, clamped"
                            )
                            percent = max(0, min(100, percent))
                    except (ValueError, TypeError):
                        warnings.append(
                            f"Row {row_num}: Could not parse percent '{raw_pct}'"
                        )

            # Parse priority
            priority = ""
            if "priority" in col_index and col_index["priority"] < len(row):
                raw_priority = row[col_index["priority"]]
                if raw_priority is not None and str(raw_priority).strip():
                    priority = str(raw_priority).strip()

            # Parse bucket
            bucket = ""
            if "bucket" in col_index and col_index["bucket"] < len(row):
                raw_bucket = row[col_index["bucket"]]
                if raw_bucket is not None and str(raw_bucket).strip():
                    bucket = str(raw_bucket).strip()

            # Parse comment
            comment = ""
            if "comment" in col_index and col_index["comment"] < len(row):
                raw_comment = row[col_index["comment"]]
                if raw_comment is not None and str(raw_comment).strip():
                    comment = str(raw_comment).strip()

            tasks.append({
                "name": task_name,
                "start_date": start_date,
                "end_date": end_date,
                "duration": duration,
                "duration_suffix": duration_suffix,
                "resources": resources,
                "percent": percent,
                "priority": priority,
                "bucket": bucket,
                "comment": comment,
            })

        # Check if there's a RAID Log sheet and parse it before closing workbook
        raid_log_section = ""
        if "RAID Log" in wb.sheetnames:
            try:
                ws_raid = wb["RAID Log"]
                raid_rows = list(ws_raid.iter_rows(values_only=True))

                if raid_rows and len(raid_rows) > 1:  # Has header and at least one data row
                    raid_headers = [str(c).lower() if c is not None else "" for c in raid_rows[0]]
                    raid_data_rows = raid_rows[1:]

                    # Build column mapping
                    col_map = {}
                    field_aliases = {
                        'id': 'id', 'type': 'type', 'title': 'title',
                        'description': 'description', 'raised by': 'raised_by',
                        'owner': 'owner', 'mitigation actions': 'mitigation_actions',
                        'impact': 'impact', 'likelihood': 'likelihood',
                        'score': 'score', 'status': 'status', 'date': 'date',
                        'priority': 'priority', 'target date': 'target_date',
                    }

                    for idx, header in enumerate(raid_headers):
                        for alias, field in field_aliases.items():
                            if alias in header:
                                col_map[field] = idx
                                break

                    # Fallback: if no title column but description exists, use description as title
                    if 'title' not in col_map and 'description' in col_map:
                        col_map['title'] = col_map['description']

                    # Parse RAID items
                    raid_items = []
                    valid_types = {'risk', 'action', 'issue', 'decision', 'dependency'}
                    valid_statuses = {'open', 'closed', 'transferred'}

                    for row in raid_data_rows:
                        if not row or not any(row):
                            continue

                        def get_cell(field, default=''):
                            idx = col_map.get(field)
                            if idx is not None and idx < len(row) and row[idx] is not None:
                                return str(row[idx])
                            return default

                        item_type = get_cell('type', 'risk').lower()
                        item_status = get_cell('status', 'open').lower()
                        if 'transferred' in item_status:
                            item_status = 'transferred'

                        try:
                            impact = int(get_cell('impact', '3') or '3')
                            likelihood = int(get_cell('likelihood', '3') or '3')
                            impact = max(1, min(5, impact))
                            likelihood = max(1, min(5, likelihood))
                            score = impact * likelihood
                        except (ValueError, TypeError):
                            impact = 3
                            likelihood = 3
                            score = 9

                        # Try to get score directly, or calculate from impact/likelihood
                        score_raw = get_cell('score', '')
                        if score_raw:
                            try:
                                score = int(score_raw)
                            except (ValueError, TypeError):
                                score = impact * likelihood
                        else:
                            score = impact * likelihood

                        # Get target_date from target_date column or date column
                        target_date = get_cell('target_date', '')
                        if not target_date:
                            date_raw = get_cell('date', '')
                            if date_raw:
                                target_date = normalize_date(date_raw) or ''
                        else:
                            target_date = normalize_date(target_date) or target_date

                        # Parse ID if present
                        id_raw = get_cell('id', '')
                        try:
                            item_id = int(id_raw) if id_raw else len(raid_items) + 1
                        except (ValueError, TypeError):
                            item_id = len(raid_items) + 1

                        raid_items.append({
                            'id': item_id,
                            'type': item_type if item_type in valid_types else 'risk',
                            'title': get_cell('title', ''),
                            'description': get_cell('description', ''),
                            'raised_by': get_cell('raised_by', ''),
                            'owner': get_cell('owner', ''),
                            'mitigation_actions': get_cell('mitigation_actions', ''),
                            'impact': impact,
                            'likelihood': likelihood,
                            'score': score,
                            'status': item_status if item_status in valid_statuses else 'open',
                            'priority': get_cell('priority', ''),
                            'target_date': target_date,
                        })

                    # Generate RAID Log markdown section
                    if raid_items:
                        raid_table = generate_raid_log_text(raid_items)
                        raid_log_section = f"\n\n---raid log---\n{raid_table}\n"

            except (ValueError, KeyError, AttributeError, TypeError) as e:
                logger.warning(f"Failed to parse RAID Log sheet: {e}")
                warnings.append(f"RAID Log sheet found but could not be parsed: {e}")

    finally:
        wb.close()

    if not tasks:
        raise ValueError("No tasks found in the selected worksheet")

    # Detect hierarchy from task names
    hierarchy = detect_hierarchy([t["name"] for t in tasks])
    for i, (level, cleaned_name) in enumerate(hierarchy):
        tasks[i]["level"] = level
        tasks[i]["name"] = cleaned_name

    # Build resource name -> shortname map
    resource_map = {}
    for name in all_resources:
        resource_map[name] = _make_shortname(name)

    # Build markdown output
    markdown_lines = []

    # Front matter
    markdown_lines.append("---")
    if all_resources:
        markdown_lines.append(_build_resource_section(all_resources))
    markdown_lines.append("---")
    markdown_lines.append("")

    # Group tasks into phases (level 0 = phase header, level > 0 = tasks under it)
    phase_count = 0
    task_count = 0
    current_phase = None

    # Check if we have any hierarchy at all
    has_hierarchy = any(t["level"] > 0 for t in tasks)

    if not has_hierarchy:
        # All tasks are flat - wrap them under a single phase
        markdown_lines.append("Imported Tasks")
        phase_count = 1
        for task in tasks:
            task_count += 1
            meta = _build_task_metadata(task, resource_map)
            markdown_lines.append(f"  {task['name']}{meta}")
    else:
        for task in tasks:
            level = task["level"]

            if level == 0:
                # Treat level 0 items as phase headers
                phase_count += 1
                current_phase = task["name"]
                markdown_lines.append(task["name"])

                # If the phase header itself has metadata, still include it
                meta = _build_task_metadata(task, resource_map)
                if meta:
                    markdown_lines[-1] = f"{task['name']}{meta}"
                    task_count += 1
            else:
                task_count += 1
                if current_phase is None:
                    # Tasks without a phase - create default phase
                    markdown_lines.append("Tasks")
                    current_phase = "Tasks"
                    phase_count += 1

                indent = "  " * level
                meta = _build_task_metadata(task, resource_map)
                markdown_lines.append(f"{indent}{task['name']}{meta}")

    markdown = "\n".join(markdown_lines) + raid_log_section + "\n"

    return {
        "markdown": markdown,
        "warnings": warnings,
        "task_count": task_count,
        "phase_count": phase_count,
    }


def _build_task_metadata(task, resource_map):
    """Build the metadata suffix for a task line (resources, duration, percent, comment)."""
    parts = []

    # Resources
    if task.get("resources"):
        shortnames = _resource_to_shortname(task["resources"], resource_map)
        if shortnames:
            parts.append(shortnames)

    # Duration
    if task.get("duration") and task["duration"] > 0:
        suffix = task.get("duration_suffix", "d")
        parts.append(f"{task['duration']}{suffix}")

    # Start date (only if no duration, as a hint)
    if task.get("start_date") and not task.get("duration"):
        parts.append(f"start:{task['start_date']}")

    # Percent complete
    if task.get("percent") is not None and task["percent"] > 0:
        parts.append(f"{task['percent']}%")

    # Priority
    if task.get("priority"):
        priority_markers = {'Urgent': '!!!', 'Important': '!!', 'Medium': '!'}
        marker = priority_markers.get(task["priority"], '')
        if marker:
            parts.append(marker)

    # Bucket
    if task.get("bucket"):
        parts.append(f"{{{task['bucket']}}}")

    # Comment
    if task.get("comment"):
        parts.append(f'! {task["comment"]}')

    if not parts:
        return ""
    return " " + " ".join(parts)
