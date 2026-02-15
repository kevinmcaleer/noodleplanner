"""Excel workbook import and conversion to NoodlePlanner markdown format."""

import io
import logging
import math
import re
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
    except Exception as e:
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
    except Exception as e:
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

            # First row is headers
            headers = [str(c) if c is not None else "" for c in rows[0]]
            data_rows = rows[1:]

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

    return {"sheets": sheets}


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

        headers = [str(c) if c is not None else "" for c in rows[0]]
        data_rows = rows[1:]

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
                "resources": resources,
                "percent": percent,
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
                        'score': 'score', 'status': 'status', 'date': 'date'
                    }

                    for idx, header in enumerate(raid_headers):
                        for alias, field in field_aliases.items():
                            if alias in header:
                                col_map[field] = idx
                                break

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

                        # Try to get date from Excel, fallback to current date
                        date_raw = get_cell('date', '')
                        if date_raw:
                            date = normalize_date(date_raw)
                            if date is None:
                                date = datetime.now().strftime('%Y-%m-%d')
                        else:
                            date = datetime.now().strftime('%Y-%m-%d')

                        raid_items.append({
                            'type': item_type if item_type in valid_types else 'risk',
                            'title': get_cell('title', ''),
                            'status': item_status if item_status in valid_statuses else 'open',
                            'score': score,
                            'owner': get_cell('owner', ''),
                            'date': date,
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
        parts.append(f"{task['duration']}d")

    # Start date (only if no duration, as a hint)
    if task.get("start_date") and not task.get("duration"):
        parts.append(f"start:{task['start_date']}")

    # Percent complete
    if task.get("percent") is not None and task["percent"] > 0:
        parts.append(f"{task['percent']}%")

    # Comment
    if task.get("comment"):
        parts.append(f"! {task['comment']}")

    if not parts:
        return ""
    return " " + " ".join(parts)
