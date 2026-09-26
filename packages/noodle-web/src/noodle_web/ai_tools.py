"""AI tool definitions and executor functions for plan manipulation.

Defines tool/function calling definitions in OpenAI format and the
deterministic Python executor functions that modify plan markdown.
The AI decides WHAT to change; these functions handle HOW.
"""

import re

import yaml

from noodle_core.format_converter import (
    ALL_SECTION_MARKERS,
    BASELINE_START,
    BENEFITS_START,
    BUDGET_START,
    COMMS_START,
    HIGHLIGHTS_START,
    HIGHLIGHTS_END,
    RAID_LOG_START,
    extract_baseline,
    extract_benefits,
    extract_budget,
    extract_comms_plan,
    extract_highlights,
    extract_raid_log,
    generate_baseline_text,
    generate_comms_plan_text,
    generate_highlights_text,
    generate_raid_log_text,
    parse_benefits_markdown,
    parse_budget_markdown,
    parse_comms_markdown,
    parse_raid_markdown,
    strip_baseline,
    strip_highlights,
    update_plan_highlights,
    strip_benefits,
    strip_budget,
    strip_comms,
    strip_raid_log,
    update_plan_baseline,
    update_plan_comms,
    update_plan_raid_log,
)

# ---------------------------------------------------------------------------
# Every back-matter section marker: the task area ends at the first of them.
# This used to be a hand-kept list of six that had fallen behind the core's
# sections (no highlights, lessons learned, parking lot or estimates), so
# add_task on a plan whose first section was one of those appended the task
# inside that section, where it was never scheduled.
# ---------------------------------------------------------------------------

SECTION_MARKERS = ALL_SECTION_MARKERS


# ===================================================================
# Front-matter helpers
# ===================================================================

def _parse_front_matter(plan_text: str) -> tuple[dict, int, int]:
    """Parse front matter from plan text using line-by-line parsing.

    YAML ``safe_load`` cannot handle the plan format because resource
    and stakeholder lines contain bare ``@`` symbols.  This parser
    reads the front matter line-by-line instead.

    Returns (parsed_dict, start_index, end_index) where the indices
    cover the full ``---`` ... ``---`` block including the markers.
    If no front matter is found, returns ({}, -1, -1).
    """
    lines = plan_text.split('\n')
    fm_start = -1
    fm_end = -1
    for i, line in enumerate(lines):
        if line.strip() == '---':
            if fm_start == -1:
                fm_start = i
            else:
                fm_end = i
                break

    if fm_start == -1 or fm_end == -1:
        return {}, -1, -1

    data: dict = {}
    current_list_key: str | None = None

    for line in lines[fm_start + 1:fm_end]:
        stripped = line.strip()
        if not stripped:
            continue

        # List item (indented with ``- ``)
        if stripped.startswith('- ') and current_list_key is not None:
            data[current_list_key].append(stripped[2:])
            continue

        # Key: value or key with list to follow
        if ':' in stripped:
            key, _, value = stripped.partition(':')
            key = key.strip()
            value = value.strip()
            if value:
                data[key] = value
                current_list_key = None
            else:
                # Empty value means a list follows
                data[key] = []
                current_list_key = key
        else:
            current_list_key = None

    return data, fm_start, fm_end


def _rebuild_front_matter(data: dict) -> str:
    """Convert a front-matter dict back into YAML between ``---`` markers.

    Stakeholders and resources are formatted as bare strings (with @)
    so the output matches the plan format.  Non-working-days use the
    ``Name: start:end`` format.
    """
    lines = ['---']

    simple_keys = ['title', 'project manager', 'start date', 'budget']
    for key in simple_keys:
        if key in data and data[key] is not None:
            lines.append(f'{key}: {data[key]}')

    if 'stakeholders' in data and data['stakeholders']:
        lines.append('stakeholders:')
        for s in data['stakeholders']:
            lines.append(f'  - {s}')

    if 'resources' in data and data['resources']:
        lines.append('resources:')
        for r in data['resources']:
            lines.append(f'  - {r}')

    if 'non-working-days' in data and data['non-working-days']:
        lines.append('non-working-days:')
        for nwd in data['non-working-days']:
            lines.append(f'  - {nwd}')

    # Preserve any keys we don't explicitly handle
    handled = set(simple_keys) | {'stakeholders', 'resources', 'non-working-days'}
    for key in data:
        if key not in handled:
            val = data[key]
            if isinstance(val, list):
                lines.append(f'{key}:')
                for item in val:
                    lines.append(f'  - {item}')
            else:
                lines.append(f'{key}: {val}')

    lines.append('---')
    return '\n'.join(lines)


def _replace_front_matter(plan_text: str, new_fm: str, fm_start: int, fm_end: int) -> str:
    """Replace front matter in plan_text between line indices fm_start..fm_end."""
    lines = plan_text.split('\n')
    before = lines[:fm_start]
    after = lines[fm_end + 1:]
    return '\n'.join(before) + ('\n' if before else '') + new_fm + '\n' + '\n'.join(after)


# ===================================================================
# Task-area helpers
# ===================================================================

def _get_task_area(plan_text: str) -> tuple[str, int, int]:
    """Return the task area text and its line range (start, end exclusive).

    The task area is everything after the front matter closing ``---``
    and before the first section marker.
    """
    lines = plan_text.split('\n')

    # Find end of front matter
    fm_dashes = 0
    task_start = 0
    for i, line in enumerate(lines):
        if line.strip() == '---':
            fm_dashes += 1
            if fm_dashes == 2:
                task_start = i + 1
                break

    # Find first section marker
    task_end = len(lines)
    for i in range(task_start, len(lines)):
        stripped = lines[i].strip().lower()
        if any(stripped == m for m in SECTION_MARKERS):
            task_end = i
            break

    # update_plan_highlights leads its section in with a bare ``---`` line
    # (see strip_highlights). That separator belongs to the section, not the
    # task list, so a task appended at the end must go above it.
    j = task_end
    while j > task_start and not lines[j - 1].strip():
        j -= 1
    if j > task_start and task_end < len(lines) and lines[j - 1].strip() == '---':
        task_end = j - 1

    return '\n'.join(lines[task_start:task_end]), task_start, task_end


# A token that starts a task line's metadata: the task's name is every token
# before the first of these. ``N%`` is among them because update_task writes
# progress in that form, and a bare-name task given a completion must still be
# found by name afterwards; ``[repeats`` so that "Standup [repeats daily]" is
# found as "Standup" by the recurrence tools.
_METADATA_TOKEN = re.compile(r'^(\d+[dwmy]|\d{1,3}%|@|!\"|%\d|#|\$|\[depends|\[repeats)')


def _split_task_line(line: str) -> tuple[str, str, str]:
    """Split a task line into ``(prefix, name, rest)``.

    *prefix* is the indentation and any sequential ``*``, *name* the task
    name as written, and *rest* everything after the name (starting with the
    whitespace before its first metadata token), so that
    ``prefix + name + rest == line``.
    """
    prefix = re.match(r'\s*\**\s*', line).group()
    body = line[len(prefix):]
    name_end = len(body.rstrip())
    for token in re.finditer(r'\S+', body):
        if _METADATA_TOKEN.match(token.group()):
            name_end = len(body[:token.start()].rstrip())
            break
    return prefix, body[:name_end], body[name_end:]


def _find_task_line(plan_text: str, task_name: str) -> int | None:
    """Find the line index of a task by name (case-insensitive).

    Returns the 0-based line index or None if not found.
    """
    task_area, area_start, area_end = _get_task_area(plan_text)
    lines = plan_text.split('\n')

    for i in range(area_start, area_end):
        line_name = ' '.join(_split_task_line(lines[i])[1].split())
        if line_name.lower() == task_name.lower():
            return i

    return None


# Parts of a task line whose insides are not task tokens: the [depends ...],
# [repeats ...] and [levelled ...] blocks, a resource allocation's [50%], and
# quoted comments. The "+2d" in "[depends Design +2d]" is a lag, not the
# task's duration, so token edits must not look inside them.
_OPAQUE_SPAN = re.compile(r'\[[^\]]*\]|!?"[^"]*"|!\'[^\']*\'')
_COMMENT_SPAN = re.compile(r'!?"[^"]*"|!\'[^\']*\'')
_DURATION_TOKEN = re.compile(r'\d+[dwmy]')
# Percent complete as the core reads it (``80%``), its legacy form (``p80``),
# and the ``%80`` form this module used to write, which the core never read.
_PROGRESS_TOKEN = re.compile(r'\d{1,3}%|p\d{1,3}|%\d{1,3}')
# ``@name:P`` / ``:R`` / ``:A`` is a quality-role assignment, not a resource.
_QUALITY_ROLE_TOKEN = re.compile(r'@[^:\s]+:[PRA]', re.IGNORECASE)


def _is_resource_token(token: str) -> bool:
    return token.startswith('@') and not _QUALITY_ROLE_TOKEN.fullmatch(token)


def _remove_span(text: str, start: int, end: int) -> str:
    """Remove ``text[start:end]`` and the whitespace in front of it."""
    while start > 0 and text[start - 1] in ' \t':
        start -= 1
    return text[:start] + text[end:]


def _set_token(rest: str, is_token, new_token: str,
               drop_others: bool = False) -> str:
    """Put *new_token* in place of the first token of *rest* that *is_token*
    accepts, or append it if there is none. With *drop_others*, any further
    matching tokens are removed. Every other token is left as written.
    """
    # Blank opaque spans to NULs (not spaces, so an allocation stays part of
    # its @name token); the offsets still line up with *rest*.
    masked = _OPAQUE_SPAN.sub(lambda m: '\0' * len(m.group()), rest)
    spans = [m.span() for m in re.finditer(r'\S+', masked) if is_token(m.group())]
    if not spans:
        return rest.rstrip() + f' {new_token}'
    if drop_others:
        for start, end in reversed(spans[1:]):
            rest = _remove_span(rest, start, end)
    start, end = spans[0]
    return rest[:start] + new_token + rest[end:]


def _get_parent_indent(plan_text: str, parent_name: str) -> int | None:
    """Return the indentation level of a parent task (in spaces)."""
    idx = _find_task_line(plan_text, parent_name)
    if idx is None:
        return None
    line = plan_text.split('\n')[idx]
    return len(line) - len(line.lstrip())


def _build_task_line(indent: int, name: str, duration: str | None = None,
                     resource: str | None = None, sequential: bool = False,
                     depends_on: str | None = None, comment: str | None = None,
                     completion: int | None = None, deliverable: str | None = None,
                     label: str | None = None, dep_type: str | None = None,
                     lag: str | None = None) -> str:
    """Build a task line string with proper indentation and metadata."""
    parts = [' ' * indent]
    if sequential:
        parts.append('*')
    parts.append(name)

    if duration:
        parts.append(f' {duration}')
    if resource:
        r = resource if resource.startswith('@') else f'@{resource}'
        parts.append(f' {r}')
    if deliverable:
        d = deliverable if deliverable.startswith('$') else f'${deliverable}'
        parts.append(f' {d}')
    if label:
        lb = label if label.startswith('#') else f'#{label}'
        parts.append(f' {lb}')
    if depends_on:
        dep_str = depends_on
        if dep_type and dep_type.upper() != 'FS':
            dep_str += f':{dep_type.upper()}'
        if lag:
            dep_str += f' {lag}'
        parts.append(f' [depends {dep_str}]')
    if comment:
        parts.append(f' !"{comment}"')
    if completion is not None and completion > 0:
        parts.append(f' {completion}%')

    return ''.join(parts)


# ===================================================================
# Section-table helpers (budget, benefits)
# ===================================================================

def _generate_budget_text(budget_items: list) -> str:
    """Generate a formatted markdown table from budget items."""
    if not budget_items:
        return ''

    headers = ['ID', 'Description', 'Estimate', 'Forecast', 'Type',
               'Invoice', 'PO', 'Supplier', 'Total', 'Ordered',
               'Received', 'Category']

    def escape_pipe(value):
        return str(value).replace('|', '\\|').replace('\n', ' ')

    rows = []
    for item in budget_items:
        rows.append([
            escape_pipe(str(item.get('id', ''))),
            escape_pipe(item.get('description', '')),
            escape_pipe(str(item.get('estimate', 0))),
            escape_pipe(str(item.get('forecast', 0))),
            escape_pipe(item.get('type', '')),
            escape_pipe(item.get('invoice', '')),
            escape_pipe(item.get('po', '')),
            escape_pipe(item.get('supplier', '')),
            escape_pipe(str(item.get('total', 0))),
            escape_pipe(item.get('date_ordered', '')),
            escape_pipe(item.get('date_received', '')),
            escape_pipe(item.get('category', '')),
        ])

    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def format_row(cells):
        padded = [cell.ljust(widths[i]) for i, cell in enumerate(cells)]
        return '| ' + ' | '.join(padded) + ' |'

    separator = '|' + '|'.join('-' * (w + 2) for w in widths) + '|'

    lines = [format_row(headers), separator]
    for row in rows:
        lines.append(format_row(row))

    return '\n'.join(lines)


def _generate_benefits_text(benefit_items: list) -> str:
    """Generate a formatted markdown table from benefit items."""
    if not benefit_items:
        return ''

    headers = ['ID', 'Type', 'Title', 'Description', 'Objective Type',
               'Target Value', 'Current Value', 'Target Date',
               'Measurement', 'Linked To', 'Contribution %']

    def escape_pipe(value):
        return str(value).replace('|', '\\|').replace('\n', ' ')

    rows = []
    for item in benefit_items:
        linked = ', '.join(str(x) for x in item.get('linked_to', []))
        rows.append([
            escape_pipe(str(item.get('id', ''))),
            escape_pipe(item.get('type', '')),
            escape_pipe(item.get('title', '')),
            escape_pipe(item.get('description', '')),
            escape_pipe(item.get('objective_type', '')),
            escape_pipe(item.get('target_value', '')),
            escape_pipe(item.get('current_value', '')),
            escape_pipe(item.get('target_date', '')),
            escape_pipe(item.get('measurement_method', '')),
            escape_pipe(linked),
            escape_pipe(str(item.get('contribution_percent', 0))),
        ])

    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def format_row(cells):
        padded = [cell.ljust(widths[i]) for i, cell in enumerate(cells)]
        return '| ' + ' | '.join(padded) + ' |'

    separator = '|' + '|'.join('-' * (w + 2) for w in widths) + '|'

    lines = [format_row(headers), separator]
    for row in rows:
        lines.append(format_row(row))

    return '\n'.join(lines)


def _update_plan_budget(plan_text: str, budget_items: list) -> str:
    """Update plan text with the given budget table."""
    benefits_text = extract_benefits(plan_text)
    raid_text = extract_raid_log(plan_text)
    comms_text = extract_comms_plan(plan_text)
    baseline_text = extract_baseline(plan_text)
    base = strip_baseline(strip_comms(strip_raid_log(
        strip_benefits(strip_budget(plan_text))))).rstrip('\n')

    table = _generate_budget_text(budget_items)
    result = base
    if table:
        result = result + '\n\n' + BUDGET_START + '\n' + table

    if benefits_text:
        result = result.rstrip('\n') + '\n\n' + BENEFITS_START + '\n' + benefits_text
    if raid_text:
        result = result.rstrip('\n') + '\n\n' + RAID_LOG_START + '\n' + raid_text
    if comms_text:
        result = result.rstrip('\n') + '\n\n' + COMMS_START + '\n' + comms_text
    if baseline_text:
        result = result.rstrip('\n') + '\n\n' + BASELINE_START + '\n' + baseline_text
    return result


def _update_plan_benefits(plan_text: str, benefit_items: list) -> str:
    """Update plan text with the given benefits table."""
    raid_text = extract_raid_log(plan_text)
    comms_text = extract_comms_plan(plan_text)
    baseline_text = extract_baseline(plan_text)
    base = strip_baseline(strip_comms(strip_raid_log(
        strip_benefits(plan_text)))).rstrip('\n')

    table = _generate_benefits_text(benefit_items)
    result = base
    if table:
        result = result + '\n\n' + BENEFITS_START + '\n' + table

    if raid_text:
        result = result.rstrip('\n') + '\n\n' + RAID_LOG_START + '\n' + raid_text
    if comms_text:
        result = result.rstrip('\n') + '\n\n' + COMMS_START + '\n' + comms_text
    if baseline_text:
        result = result.rstrip('\n') + '\n\n' + BASELINE_START + '\n' + baseline_text
    return result


# ===================================================================
# Executor functions
# ===================================================================

# --- Plan Structure ---

def _create_plan(plan_text: str, title: str, project_manager: str | None = None,
                 start_date: str | None = None, budget: str | None = None) -> tuple[str, str]:
    """Create a new plan from scratch."""
    data = {'title': title}
    if project_manager:
        data['project manager'] = project_manager
    if start_date:
        data['start date'] = start_date
    if budget:
        data['budget'] = budget
    data['stakeholders'] = []
    data['resources'] = []
    data['non-working-days'] = []

    new_plan = _rebuild_front_matter(data) + '\n'
    return new_plan, f"Created new plan '{title}'."


def _update_front_matter(plan_text: str, field: str, value: str) -> tuple[str, str]:
    """Update any front-matter field."""
    data, fm_start, fm_end = _parse_front_matter(plan_text)
    if fm_start == -1:
        return plan_text, "No front matter found in plan."

    data[field] = value
    new_fm = _rebuild_front_matter(data)
    return _replace_front_matter(plan_text, new_fm, fm_start, fm_end), \
        f"Updated front matter field '{field}' to '{value}'."


# --- Stakeholders ---

def _add_stakeholder(plan_text: str, name: str, interest: str | None = None,
                     influence: str | None = None) -> tuple[str, str]:
    """Add a stakeholder to the plan's front matter."""
    data, fm_start, fm_end = _parse_front_matter(plan_text)
    if fm_start == -1:
        return plan_text, "No front matter found in plan."

    if 'stakeholders' not in data or data['stakeholders'] is None:
        data['stakeholders'] = []

    entry = f'@{name}'
    if interest:
        entry += f' {{{interest}}}'
    if influence:
        entry += f' {{{influence}}}'

    # Check for duplicate
    for s in data['stakeholders']:
        if f'@{name}' in str(s):
            return plan_text, f"Stakeholder '{name}' already exists."

    data['stakeholders'].append(entry)
    new_fm = _rebuild_front_matter(data)
    return _replace_front_matter(plan_text, new_fm, fm_start, fm_end), \
        f"Added stakeholder '{name}'."


def _update_stakeholder(plan_text: str, name: str, interest: str | None = None,
                        influence: str | None = None) -> tuple[str, str]:
    """Update an existing stakeholder."""
    data, fm_start, fm_end = _parse_front_matter(plan_text)
    if fm_start == -1:
        return plan_text, "No front matter found in plan."

    stakeholders = data.get('stakeholders') or []
    found = False
    for i, s in enumerate(stakeholders):
        if f'@{name}' in str(s):
            entry = f'@{name}'
            if interest:
                entry += f' {{{interest}}}'
            if influence:
                entry += f' {{{influence}}}'
            stakeholders[i] = entry
            found = True
            break

    if not found:
        return plan_text, f"Stakeholder '{name}' not found."

    data['stakeholders'] = stakeholders
    new_fm = _rebuild_front_matter(data)
    return _replace_front_matter(plan_text, new_fm, fm_start, fm_end), \
        f"Updated stakeholder '{name}'."


def _remove_stakeholder(plan_text: str, name: str) -> tuple[str, str]:
    """Remove a stakeholder from the plan."""
    data, fm_start, fm_end = _parse_front_matter(plan_text)
    if fm_start == -1:
        return plan_text, "No front matter found in plan."

    stakeholders = data.get('stakeholders') or []
    original_len = len(stakeholders)
    data['stakeholders'] = [s for s in stakeholders if f'@{name}' not in str(s)]

    if len(data['stakeholders']) == original_len:
        return plan_text, f"Stakeholder '{name}' not found."

    new_fm = _rebuild_front_matter(data)
    return _replace_front_matter(plan_text, new_fm, fm_start, fm_end), \
        f"Removed stakeholder '{name}'."


# --- Resources ---

def _add_resource(plan_text: str, name: str, full_name: str | None = None,
                  role: str | None = None, email: str | None = None) -> tuple[str, str]:
    """Add a resource to the plan's front matter."""
    data, fm_start, fm_end = _parse_front_matter(plan_text)
    if fm_start == -1:
        return plan_text, "No front matter found in plan."

    if 'resources' not in data or data['resources'] is None:
        data['resources'] = []

    # Check for duplicate
    for r in data['resources']:
        if str(r).startswith(f'@{name}:') or str(r) == f'@{name}':
            return plan_text, f"Resource '{name}' already exists."

    parts = [f'@{name}:']
    detail_parts = []
    if full_name:
        detail_parts.append(full_name)
    if role:
        detail_parts.append(role)
    if email:
        detail_parts.append(email)
    entry = f'@{name}: {", ".join(detail_parts)}' if detail_parts else f'@{name}'

    data['resources'].append(entry)
    new_fm = _rebuild_front_matter(data)
    return _replace_front_matter(plan_text, new_fm, fm_start, fm_end), \
        f"Added resource '{name}'."


def _update_resource(plan_text: str, name: str, full_name: str | None = None,
                     role: str | None = None, email: str | None = None) -> tuple[str, str]:
    """Update an existing resource."""
    data, fm_start, fm_end = _parse_front_matter(plan_text)
    if fm_start == -1:
        return plan_text, "No front matter found in plan."

    resources = data.get('resources') or []
    found = False
    for i, r in enumerate(resources):
        r_str = str(r)
        if r_str.startswith(f'@{name}:') or r_str == f'@{name}':
            # Parse existing to preserve fields not being updated
            existing_parts = r_str.split(':', 1)
            existing_details = []
            if len(existing_parts) > 1:
                existing_details = [p.strip() for p in existing_parts[1].split(',')]

            detail_parts = []
            detail_parts.append(full_name if full_name else
                                (existing_details[0] if len(existing_details) > 0 else ''))
            detail_parts.append(role if role else
                                (existing_details[1] if len(existing_details) > 1 else ''))
            detail_parts.append(email if email else
                                (existing_details[2] if len(existing_details) > 2 else ''))
            # Remove trailing empty parts
            while detail_parts and not detail_parts[-1]:
                detail_parts.pop()

            entry = f'@{name}: {", ".join(detail_parts)}' if detail_parts else f'@{name}'
            resources[i] = entry
            found = True
            break

    if not found:
        return plan_text, f"Resource '{name}' not found."

    data['resources'] = resources
    new_fm = _rebuild_front_matter(data)
    return _replace_front_matter(plan_text, new_fm, fm_start, fm_end), \
        f"Updated resource '{name}'."


def _remove_resource(plan_text: str, name: str) -> tuple[str, str]:
    """Remove a resource from the plan."""
    data, fm_start, fm_end = _parse_front_matter(plan_text)
    if fm_start == -1:
        return plan_text, "No front matter found in plan."

    resources = data.get('resources') or []
    original_len = len(resources)
    data['resources'] = [r for r in resources
                         if not (str(r).startswith(f'@{name}:') or str(r) == f'@{name}')]

    if len(data['resources']) == original_len:
        return plan_text, f"Resource '{name}' not found."

    new_fm = _rebuild_front_matter(data)
    return _replace_front_matter(plan_text, new_fm, fm_start, fm_end), \
        f"Removed resource '{name}'."


# --- Non-working days ---

def _add_non_working_day(plan_text: str, name: str, start_date: str,
                         end_date: str | None = None) -> tuple[str, str]:
    """Add a non-working day entry."""
    data, fm_start, fm_end = _parse_front_matter(plan_text)
    if fm_start == -1:
        return plan_text, "No front matter found in plan."

    if 'non-working-days' not in data or data['non-working-days'] is None:
        data['non-working-days'] = []

    date_range = start_date
    if end_date:
        date_range = f'{start_date}:{end_date}'
    entry = f'{name}: {date_range}'

    data['non-working-days'].append(entry)
    new_fm = _rebuild_front_matter(data)
    return _replace_front_matter(plan_text, new_fm, fm_start, fm_end), \
        f"Added non-working day '{name}'."


def _remove_non_working_day(plan_text: str, name: str) -> tuple[str, str]:
    """Remove a non-working day entry."""
    data, fm_start, fm_end = _parse_front_matter(plan_text)
    if fm_start == -1:
        return plan_text, "No front matter found in plan."

    nwd = data.get('non-working-days') or []
    original_len = len(nwd)
    data['non-working-days'] = [
        n for n in nwd if not str(n).lower().startswith(name.lower())
    ]

    if len(data['non-working-days']) == original_len:
        return plan_text, f"Non-working day '{name}' not found."

    new_fm = _rebuild_front_matter(data)
    return _replace_front_matter(plan_text, new_fm, fm_start, fm_end), \
        f"Removed non-working day '{name}'."


# --- Tasks ---

def _add_task(plan_text: str, name: str, parent: str | None = None,
              duration: str | None = None, resource: str | None = None,
              depends_on: str | None = None, sequential: bool = False,
              comment: str | None = None) -> tuple[str, str]:
    """Add a task to the plan."""
    indent = 0
    insert_after = None

    if parent:
        parent_indent = _get_parent_indent(plan_text, parent)
        if parent_indent is None:
            return plan_text, f"Parent task '{parent}' not found."
        indent = parent_indent + 2
        # Find the last child of this parent to insert after
        parent_idx = _find_task_line(plan_text, parent)
        lines = plan_text.split('\n')
        insert_after = parent_idx
        for i in range(parent_idx + 1, len(lines)):
            line = lines[i]
            if not line.strip():
                continue
            line_indent = len(line) - len(line.lstrip())
            if line_indent <= parent_indent:
                break
            # Check for section markers
            if line.strip().lower() in SECTION_MARKERS:
                break
            insert_after = i
    else:
        # Add at the end of the task area
        _, area_start, area_end = _get_task_area(plan_text)
        insert_after = area_end - 1

    task_line = _build_task_line(indent, name, duration=duration, resource=resource,
                                sequential=sequential, depends_on=depends_on,
                                comment=comment)

    lines = plan_text.split('\n')
    lines.insert(insert_after + 1, task_line)
    return '\n'.join(lines), f"Added task '{name}'."


def _update_task(plan_text: str, name: str, new_name: str | None = None,
                 duration: str | None = None, resource: str | None = None,
                 completion: int | None = None,
                 comment: str | None = None) -> tuple[str, str]:
    """Update an existing task's properties.

    Each change edits its own token in place, or appends one, and every other
    token on the line is left exactly as written. This used to rebuild the
    line from seven regex captures, which dropped the second and later
    resources, every label but the first, allocations, dates and
    ``N%``/``pN`` progress, and wrote completion as ``%80``, which the core
    parser never reads.
    """
    idx = _find_task_line(plan_text, name)
    if idx is None:
        return plan_text, f"Task '{name}' not found."

    lines = plan_text.split('\n')
    prefix, old_name, rest = _split_task_line(lines[idx])

    if duration:
        rest = _set_token(rest, _DURATION_TOKEN.fullmatch, duration)
    if resource:
        # The task's resource becomes this one, as with assign_resource;
        # quality-role assignments are not resources and stay put.
        r = resource if resource.startswith('@') else f'@{resource}'
        rest = _set_token(rest, _is_resource_token, r, drop_others=True)
    if completion is not None:
        pct = max(0, min(100, int(completion)))
        rest = _set_token(rest, _PROGRESS_TOKEN.fullmatch, f'{pct}%',
                          drop_others=True)
    if comment is not None:
        match = _COMMENT_SPAN.search(rest)
        new_comment = f'!"{comment}"' if comment else ''
        if match and new_comment:
            rest = rest[:match.start()] + new_comment + rest[match.end():]
        elif match:
            rest = _remove_span(rest, *match.span())
        elif new_comment:
            rest = rest.rstrip() + f' {new_comment}'

    lines[idx] = prefix + (new_name or old_name) + rest
    changes = []
    if new_name:
        changes.append(f"renamed to '{new_name}'")
    if duration:
        changes.append(f"duration={duration}")
    if resource:
        changes.append(f"resource=@{resource}")
    if completion is not None:
        changes.append(f"completion={completion}%")
    if comment is not None:
        changes.append(f"comment updated")

    return '\n'.join(lines), f"Updated task '{name}': {', '.join(changes)}."


def _remove_task(plan_text: str, name: str) -> tuple[str, str]:
    """Remove a task and its children from the plan."""
    idx = _find_task_line(plan_text, name)
    if idx is None:
        return plan_text, f"Task '{name}' not found."

    lines = plan_text.split('\n')
    task_indent = len(lines[idx]) - len(lines[idx].lstrip())

    # Find range: this task + all children (indented further)
    end_idx = idx + 1
    while end_idx < len(lines):
        line = lines[end_idx]
        if not line.strip():
            end_idx += 1
            continue
        line_indent = len(line) - len(line.lstrip())
        if line_indent <= task_indent:
            break
        if line.strip().lower() in SECTION_MARKERS:
            break
        end_idx += 1

    del lines[idx:end_idx]
    return '\n'.join(lines), f"Removed task '{name}' and its children."


def _move_task(plan_text: str, name: str, new_parent: str) -> tuple[str, str]:
    """Move a task under a new parent."""
    idx = _find_task_line(plan_text, name)
    if idx is None:
        return plan_text, f"Task '{name}' not found."

    new_parent_indent = _get_parent_indent(plan_text, new_parent)
    if new_parent_indent is None:
        return plan_text, f"New parent '{new_parent}' not found."

    lines = plan_text.split('\n')
    old_line = lines[idx]
    old_indent = len(old_line) - len(old_line.lstrip())

    # Collect task + children
    task_lines = [old_line]
    end_idx = idx + 1
    while end_idx < len(lines):
        line = lines[end_idx]
        if not line.strip():
            end_idx += 1
            continue
        line_indent = len(line) - len(line.lstrip())
        if line_indent <= old_indent:
            break
        if line.strip().lower() in SECTION_MARKERS:
            break
        task_lines.append(line)
        end_idx += 1

    # Remove from old position
    del lines[idx:end_idx]

    # Re-indent
    new_indent = new_parent_indent + 2
    indent_diff = new_indent - old_indent
    reindented = []
    for line in task_lines:
        if line.strip():
            current_indent = len(line) - len(line.lstrip())
            new_line_indent = max(0, current_indent + indent_diff)
            reindented.append(' ' * new_line_indent + line.lstrip())
        else:
            reindented.append(line)

    # Find new parent and insert after its last child
    plan_text_temp = '\n'.join(lines)
    new_parent_idx = _find_task_line(plan_text_temp, new_parent)
    if new_parent_idx is None:
        return plan_text, f"New parent '{new_parent}' not found after removal."

    insert_after = new_parent_idx
    for i in range(new_parent_idx + 1, len(lines)):
        line = lines[i]
        if not line.strip():
            continue
        line_indent = len(line) - len(line.lstrip())
        if line_indent <= new_parent_indent:
            break
        if line.strip().lower() in SECTION_MARKERS:
            break
        insert_after = i

    for j, rl in enumerate(reindented):
        lines.insert(insert_after + 1 + j, rl)

    return '\n'.join(lines), f"Moved task '{name}' under '{new_parent}'."


def _set_dependency(plan_text: str, task_name: str, depends_on: str,
                    dep_type: str | None = None,
                    lag: str | None = None) -> tuple[str, str]:
    """Set a dependency on a task."""
    idx = _find_task_line(plan_text, task_name)
    if idx is None:
        return plan_text, f"Task '{task_name}' not found."

    lines = plan_text.split('\n')
    line = lines[idx]

    # Remove existing [depends ...] if present
    line = re.sub(r'\s*\[depends\s*[^\]]*\]', '', line)

    dep_str = depends_on
    if dep_type and dep_type.upper() != 'FS':
        dep_str += f':{dep_type.upper()}'
    if lag:
        dep_str += f' {lag}'

    line = line.rstrip() + f' [depends {dep_str}]'
    lines[idx] = line

    return '\n'.join(lines), f"Set dependency on '{task_name}': depends on '{depends_on}'."


def _assign_resource(plan_text: str, task_name: str,
                     resource_name: str) -> tuple[str, str]:
    """Assign a resource to a task."""
    idx = _find_task_line(plan_text, task_name)
    if idx is None:
        return plan_text, f"Task '{task_name}' not found."

    lines = plan_text.split('\n')
    line = lines[idx]

    # Remove existing @resource tokens (but not quality roles @X:P/R/A)
    line = re.sub(r'\s+@[A-Za-z]\w*(?!:[PRA])\b', '', line)

    r = resource_name if resource_name.startswith('@') else f'@{resource_name}'
    line = line.rstrip() + f' {r}'
    lines[idx] = line

    return '\n'.join(lines), f"Assigned @{resource_name.lstrip('@')} to '{task_name}'."


# --- RAID ---

def _add_raid_item(plan_text: str, type: str, title: str,
                   description: str | None = None, owner: str | None = None,
                   impact: str | None = None, likelihood: str | None = None,
                   status: str | None = None,
                   mitigation: str | None = None) -> tuple[str, str]:
    """Add a RAID item."""
    raid_text = extract_raid_log(plan_text)
    items = parse_raid_markdown(raid_text) if raid_text else []

    max_id = max((item.get('id', 0) for item in items), default=0)
    new_item = {
        'id': max_id + 1,
        'type': type,
        'title': title,
        'description': description or '',
        'raised_by': '',
        'owner': owner or '',
        'mitigation_actions': mitigation or '',
        'impact': impact or '',
        'likelihood': likelihood or '',
        'score': '',
        'status': status or 'Open',
        'priority': '',
        'target_date': '',
    }
    items.append(new_item)

    return update_plan_raid_log(plan_text, items), \
        f"Added {type} item '{title}' (ID {new_item['id']})."


def _update_raid_item(plan_text: str, id: int, title: str | None = None,
                      status: str | None = None, owner: str | None = None,
                      impact: str | None = None, likelihood: str | None = None,
                      mitigation: str | None = None) -> tuple[str, str]:
    """Update an existing RAID item."""
    raid_text = extract_raid_log(plan_text)
    if not raid_text:
        return plan_text, "No RAID log section found."

    items = parse_raid_markdown(raid_text)
    found = False
    for item in items:
        if item.get('id') == id:
            if title is not None:
                item['title'] = title
            if status is not None:
                item['status'] = status
            if owner is not None:
                item['owner'] = owner
            if impact is not None:
                item['impact'] = impact
            if likelihood is not None:
                item['likelihood'] = likelihood
            if mitigation is not None:
                item['mitigation_actions'] = mitigation
            found = True
            break

    if not found:
        return plan_text, f"RAID item with ID {id} not found."

    return update_plan_raid_log(plan_text, items), f"Updated RAID item {id}."


def _remove_raid_item(plan_text: str, id: int) -> tuple[str, str]:
    """Remove a RAID item."""
    raid_text = extract_raid_log(plan_text)
    if not raid_text:
        return plan_text, "No RAID log section found."

    items = parse_raid_markdown(raid_text)
    original_len = len(items)
    items = [item for item in items if item.get('id') != id]

    if len(items) == original_len:
        return plan_text, f"RAID item with ID {id} not found."

    return update_plan_raid_log(plan_text, items), f"Removed RAID item {id}."


# --- Budget ---

def _add_budget_item(plan_text: str, description: str,
                     estimate: float | None = None, forecast: float | None = None,
                     type: str | None = None, supplier: str | None = None,
                     category: str | None = None) -> tuple[str, str]:
    """Add a budget item."""
    budget_text = extract_budget(plan_text)
    items = parse_budget_markdown(budget_text) if budget_text else []

    max_id = max((item.get('id', 0) for item in items), default=0)
    new_item = {
        'id': max_id + 1,
        'description': description,
        'estimate': estimate or 0,
        'forecast': forecast or 0,
        'type': type or 'Capex',
        'invoice': '',
        'po': '',
        'supplier': supplier or '',
        'total': 0,
        'date_ordered': '',
        'date_received': '',
        'category': category or 'Consultancy',
    }
    items.append(new_item)

    return _update_plan_budget(plan_text, items), \
        f"Added budget item '{description}' (ID {new_item['id']})."


def _update_budget_item(plan_text: str, id: int, description: str | None = None,
                        estimate: float | None = None, forecast: float | None = None,
                        type: str | None = None,
                        supplier: str | None = None) -> tuple[str, str]:
    """Update an existing budget item."""
    budget_text = extract_budget(plan_text)
    if not budget_text:
        return plan_text, "No budget section found."

    items = parse_budget_markdown(budget_text)
    found = False
    for item in items:
        if item.get('id') == id:
            if description is not None:
                item['description'] = description
            if estimate is not None:
                item['estimate'] = estimate
            if forecast is not None:
                item['forecast'] = forecast
            if type is not None:
                item['type'] = type
            if supplier is not None:
                item['supplier'] = supplier
            found = True
            break

    if not found:
        return plan_text, f"Budget item with ID {id} not found."

    return _update_plan_budget(plan_text, items), f"Updated budget item {id}."


def _remove_budget_item(plan_text: str, id: int) -> tuple[str, str]:
    """Remove a budget item."""
    budget_text = extract_budget(plan_text)
    if not budget_text:
        return plan_text, "No budget section found."

    items = parse_budget_markdown(budget_text)
    original_len = len(items)
    items = [item for item in items if item.get('id') != id]

    if len(items) == original_len:
        return plan_text, f"Budget item with ID {id} not found."

    return _update_plan_budget(plan_text, items), f"Removed budget item {id}."


# --- Benefits ---

def _add_benefit(plan_text: str, type: str, title: str,
                 description: str | None = None,
                 target_value: str | None = None,
                 contribution_percent: int | None = None) -> tuple[str, str]:
    """Add a benefit."""
    benefits_text = extract_benefits(plan_text)
    items = parse_benefits_markdown(benefits_text) if benefits_text else []

    max_id = max((item.get('id', 0) for item in items), default=0)
    new_item = {
        'id': max_id + 1,
        'type': type,
        'title': title,
        'description': description or '',
        'objective_type': '',
        'target_value': target_value or '',
        'current_value': '',
        'target_date': '',
        'measurement_method': '',
        'linked_to': [],
        'contribution_percent': contribution_percent or 0,
    }
    items.append(new_item)

    return _update_plan_benefits(plan_text, items), \
        f"Added benefit '{title}' (ID {new_item['id']})."


def _update_benefit(plan_text: str, id: int, title: str | None = None,
                    description: str | None = None,
                    target_value: str | None = None,
                    contribution_percent: int | None = None) -> tuple[str, str]:
    """Update an existing benefit."""
    benefits_text = extract_benefits(plan_text)
    if not benefits_text:
        return plan_text, "No benefits section found."

    items = parse_benefits_markdown(benefits_text)
    found = False
    for item in items:
        if item.get('id') == id:
            if title is not None:
                item['title'] = title
            if description is not None:
                item['description'] = description
            if target_value is not None:
                item['target_value'] = target_value
            if contribution_percent is not None:
                item['contribution_percent'] = contribution_percent
            found = True
            break

    if not found:
        return plan_text, f"Benefit with ID {id} not found."

    return _update_plan_benefits(plan_text, items), f"Updated benefit {id}."


def _remove_benefit(plan_text: str, id: int) -> tuple[str, str]:
    """Remove a benefit."""
    benefits_text = extract_benefits(plan_text)
    if not benefits_text:
        return plan_text, "No benefits section found."

    items = parse_benefits_markdown(benefits_text)
    original_len = len(items)
    items = [item for item in items if item.get('id') != id]

    if len(items) == original_len:
        return plan_text, f"Benefit with ID {id} not found."

    return _update_plan_benefits(plan_text, items), f"Removed benefit {id}."


def _link_benefit(plan_text: str, from_id: int,
                  to_id: int) -> tuple[str, str]:
    """Link one benefit to another."""
    benefits_text = extract_benefits(plan_text)
    if not benefits_text:
        return plan_text, "No benefits section found."

    items = parse_benefits_markdown(benefits_text)
    found = False
    for item in items:
        if item.get('id') == from_id:
            linked = item.get('linked_to', [])
            if to_id not in linked:
                linked.append(to_id)
                item['linked_to'] = linked
            found = True
            break

    if not found:
        return plan_text, f"Benefit with ID {from_id} not found."

    return _update_plan_benefits(plan_text, items), \
        f"Linked benefit {from_id} to benefit {to_id}."


# --- Comms ---

def _add_comms_activity(plan_text: str, audience: str, message: str,
                        channel: str | None = None, frequency: str | None = None,
                        owner: str | None = None) -> tuple[str, str]:
    """Add a comms activity."""
    comms_text = extract_comms_plan(plan_text)
    items = parse_comms_markdown(comms_text) if comms_text else []

    max_id = max((item.get('id', 0) for item in items), default=0)
    new_item = {
        'id': max_id + 1,
        'activity': message,
        'audience': audience,
        'content': message,
        'frequency': frequency or 'Weekly',
        'channel': channel or '',
        'owner': owner or '',
        'status': 'Planned',
    }
    items.append(new_item)

    return update_plan_comms(plan_text, items), \
        f"Added comms activity for '{audience}' (ID {new_item['id']})."


def _update_comms_activity(plan_text: str, id: int,
                           audience: str | None = None,
                           message: str | None = None,
                           channel: str | None = None,
                           frequency: str | None = None,
                           owner: str | None = None) -> tuple[str, str]:
    """Update an existing comms activity."""
    comms_text = extract_comms_plan(plan_text)
    if not comms_text:
        return plan_text, "No comms section found."

    items = parse_comms_markdown(comms_text)
    found = False
    for item in items:
        if item.get('id') == id:
            if audience is not None:
                item['audience'] = audience
            if message is not None:
                item['activity'] = message
                item['content'] = message
            if channel is not None:
                item['channel'] = channel
            if frequency is not None:
                item['frequency'] = frequency
            if owner is not None:
                item['owner'] = owner
            found = True
            break

    if not found:
        return plan_text, f"Comms activity with ID {id} not found."

    return update_plan_comms(plan_text, items), f"Updated comms activity {id}."


def _remove_comms_activity(plan_text: str, id: int) -> tuple[str, str]:
    """Remove a comms activity."""
    comms_text = extract_comms_plan(plan_text)
    if not comms_text:
        return plan_text, "No comms section found."

    items = parse_comms_markdown(comms_text)
    original_len = len(items)
    items = [item for item in items if item.get('id') != id]

    if len(items) == original_len:
        return plan_text, f"Comms activity with ID {id} not found."

    return update_plan_comms(plan_text, items), f"Removed comms activity {id}."


# --- Deliverables ---

def _add_deliverable(plan_text: str, name: str,
                     type: str | None = None) -> tuple[str, str]:
    """Add a deliverable ($name) to the plan.

    If type is specified, it determines the prefix:
    - 'group': /$name
    - 'external': ^$name
    - 'internal' (default): $name
    """
    # Check if deliverable already exists
    prefix = ''
    if type == 'group':
        prefix = '/'
    elif type == 'external':
        prefix = '^'

    pattern = re.compile(rf'[/^]?\${re.escape(name)}\b', re.IGNORECASE)
    task_area, area_start, area_end = _get_task_area(plan_text)
    if pattern.search(task_area):
        return plan_text, f"Deliverable '${name}' already exists in the plan."

    # Add as a new task line at the end of the task area
    lines = plan_text.split('\n')
    task_line = f'  {name} 0d {prefix}${name}'
    lines.insert(area_end, task_line)

    return '\n'.join(lines), f"Added deliverable '${name}' as a milestone."


def _update_deliverable(plan_text: str, name: str,
                        new_name: str | None = None,
                        type: str | None = None) -> tuple[str, str]:
    """Update a deliverable name across all task lines."""
    old_pattern = re.compile(rf'([/^])?\${re.escape(name)}\b', re.IGNORECASE)
    task_area, _, _ = _get_task_area(plan_text)

    if not old_pattern.search(task_area):
        return plan_text, f"Deliverable '${name}' not found."

    target_name = new_name if new_name else name
    prefix = ''
    if type == 'group':
        prefix = '/'
    elif type == 'external':
        prefix = '^'

    replacement = f'{prefix}${target_name}'
    result = old_pattern.sub(replacement, plan_text)

    return result, f"Updated deliverable '${name}' to '{replacement}'."


def _remove_deliverable(plan_text: str, name: str) -> tuple[str, str]:
    """Remove a deliverable ($name) from all task lines."""
    pattern = re.compile(rf'\s*[/^]?\${re.escape(name)}\b', re.IGNORECASE)
    task_area, _, _ = _get_task_area(plan_text)

    if not pattern.search(task_area):
        return plan_text, f"Deliverable '${name}' not found."

    result = pattern.sub('', plan_text)
    return result, f"Removed deliverable '${name}' from all tasks."


# --- Baseline ---

def _create_baseline(plan_text: str) -> tuple[str, str]:
    """Create a baseline snapshot from current task data.

    Parses all tasks and records their names with placeholder dates.
    A real baseline would use the scheduling engine, but here we
    capture a text snapshot of task names and durations.
    """
    task_area, _, _ = _get_task_area(plan_text)
    lines = task_area.split('\n')
    baseline_items = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        name_part = stripped.lstrip('*').strip()
        tokens = name_part.split()
        name_tokens = []
        duration_str = ''
        for t in tokens:
            dur_match = re.match(r'^(\d+[dwmy])$', t)
            if dur_match:
                duration_str = dur_match.group(1)
                continue
            if re.match(r'^(@|!\"|%\d|#|\$|\[depends)', t):
                break
            name_tokens.append(t)

        task_name = ' '.join(name_tokens)
        if task_name:
            baseline_items.append({
                'name': task_name,
                'start': '',
                'finish': '',
                'duration': duration_str,
            })

    return update_plan_baseline(plan_text, baseline_items), \
        f"Created baseline with {len(baseline_items)} tasks."


# ── Highlights ────────────────────────────────────────────────


def _add_highlight(plan_text: str, date: str, author: str,
                   content: str) -> tuple[str, str]:
    """Add a highlight/status update entry."""
    highlights = extract_highlights(plan_text)
    highlights.append({'date': date, 'author': author, 'content': content})
    updated = update_plan_highlights(plan_text, highlights)
    return updated, f"Added highlight for {date} by @{author}."


def _update_highlight(plan_text: str, date: str, author: str,
                      content: str) -> tuple[str, str]:
    """Update an existing highlight by date and author."""
    highlights = extract_highlights(plan_text)
    found = False
    for h in highlights:
        if h['date'] == date and h['author'].lower() == author.lower():
            h['content'] = content
            found = True
            break
    if not found:
        return plan_text, f"Highlight for {date} by @{author} not found."
    return update_plan_highlights(plan_text, highlights), f"Updated highlight for {date} by @{author}."


def _remove_highlight(plan_text: str, date: str,
                      author: str) -> tuple[str, str]:
    """Remove a highlight by date and author."""
    highlights = extract_highlights(plan_text)
    original_len = len(highlights)
    highlights = [
        h for h in highlights
        if not (h['date'] == date and h['author'].lower() == author.lower())
    ]
    if len(highlights) == original_len:
        return plan_text, f"Highlight for {date} by @{author} not found."
    return update_plan_highlights(plan_text, highlights), f"Removed highlight for {date} by @{author}."


# ── Milestones ────────────────────────────────────────────────


# A bare YYYY-MM-DD token on a task line is its explicit start date (see
# "Explicit Start Date" in docs/reference/plan-syntax.rst). A "D" prefix makes
# it a deadline instead, which a milestone's date is not.
_ISO_DATE = re.compile(r'\d{4}-\d{2}-\d{2}')


def _add_milestone(plan_text: str, name: str,
                   parent: str | None = None,
                   date: str | None = None) -> tuple[str, str]:
    """Add a milestone (a task with 0d duration), dated if *date* is given."""
    if date and not _ISO_DATE.fullmatch(date):
        return plan_text, f"Invalid date '{date}': use YYYY-MM-DD."
    # _build_task_line writes the duration straight after the name, so the
    # date rides along with it rather than widening add_task's own arguments.
    duration = f'0d {date}' if date else '0d'
    return _add_task(plan_text, name=name, parent=parent, duration=duration,
                     comment=None, resource=None, depends_on=None,
                     sequential=False)


def _update_milestone(plan_text: str, name: str,
                      new_name: str | None = None,
                      date: str | None = None) -> tuple[str, str]:
    """Update a milestone name or date."""
    if date and not _ISO_DATE.fullmatch(date):
        return plan_text, f"Invalid date '{date}': use YYYY-MM-DD."
    idx = _find_task_line(plan_text, name)
    if idx is None:
        return plan_text, f"Milestone '{name}' not found."

    lines = plan_text.split('\n')
    prefix, old_name, rest = _split_task_line(lines[idx])
    if date:
        rest = _set_token(rest, _ISO_DATE.fullmatch, date)
    lines[idx] = prefix + (new_name or old_name) + rest

    changes = []
    if new_name:
        changes.append(f"renamed to '{new_name}'")
    if date:
        changes.append(f"date={date}")
    return '\n'.join(lines), f"Updated milestone '{name}': {', '.join(changes)}."


# ── Labels ────────────────────────────────────────────────────
#
# These and the recurrence tools below used to unpack _get_task_area's
# (text, start, end) as (text, before, after) and return
# ``before + text + after`` -- a TypeError on every call, which execute_tool
# reported to the model as "Invalid arguments". They now find the task with
# _find_task_line and edit that one line, like set_dependency.


def _label_pattern(tag: str) -> re.Pattern:
    # Whole tokens only, so "#urg" is not found in (or cut out of) "#urgent".
    return re.compile(r'(?<!\S)' + re.escape(tag) + r'(?!\S)', re.IGNORECASE)


def _add_label(plan_text: str, task_name: str,
               label: str) -> tuple[str, str]:
    """Add a #label tag to a task."""
    tag = f'#{label}' if not label.startswith('#') else label
    idx = _find_task_line(plan_text, task_name)
    if idx is None:
        return plan_text, f"Task '{task_name}' not found."

    lines = plan_text.split('\n')
    if _label_pattern(tag).search(lines[idx]):
        return plan_text, f"Task '{task_name}' already has label {tag}."
    lines[idx] = lines[idx].rstrip() + f' {tag}'
    return '\n'.join(lines), f"Added {tag} to '{task_name}'."


def _remove_label(plan_text: str, task_name: str,
                  label: str) -> tuple[str, str]:
    """Remove a #label tag from a task."""
    tag = f'#{label}' if not label.startswith('#') else label
    idx = _find_task_line(plan_text, task_name)
    if idx is None:
        return plan_text, f"Task '{task_name}' not found."

    lines = plan_text.split('\n')
    # Remove the label tag (case-insensitive) and the space before it
    match = _label_pattern(tag).search(lines[idx])
    if not match:
        return plan_text, f"Task '{task_name}' does not have label {tag}."
    lines[idx] = _remove_span(lines[idx], *match.span())
    return '\n'.join(lines), f"Removed {tag} from '{task_name}'."


# ── Recurrence ────────────────────────────────────────────────


def _set_recurrence(plan_text: str, task_name: str,
                    pattern: str) -> tuple[str, str]:
    """Set a recurrence pattern on a task. Pattern examples: 'weekly', 'monthly', 'every 2 weeks'."""
    idx = _find_task_line(plan_text, task_name)
    if idx is None:
        return plan_text, f"Task '{task_name}' not found."

    lines = plan_text.split('\n')
    # Remove existing recurrence
    new_line = re.sub(r'\s*\[repeats\s+[^\]]*\]', '', lines[idx])
    lines[idx] = new_line.rstrip() + f' [repeats {pattern}]'
    return '\n'.join(lines), f"Set recurrence '{pattern}' on '{task_name}'."


def _remove_recurrence(plan_text: str, task_name: str) -> tuple[str, str]:
    """Remove recurrence from a task."""
    idx = _find_task_line(plan_text, task_name)
    if idx is None:
        return plan_text, f"Task '{task_name}' not found."

    lines = plan_text.split('\n')
    new_line = re.sub(r'\s*\[repeats\s+[^\]]*\]', '', lines[idx])
    if new_line == lines[idx]:
        return plan_text, f"Task '{task_name}' has no recurrence."
    lines[idx] = new_line
    return '\n'.join(lines), f"Removed recurrence from '{task_name}'."


# ── Update non-working day ────────────────────────────────────


def _update_non_working_day(plan_text: str, name: str,
                            new_name: str | None = None,
                            start_date: str | None = None,
                            end_date: str | None = None) -> tuple[str, str]:
    """Update an existing non-working day entry.

    Edits the entry's line in place, so the rest of the front matter keeps
    its order and formatting. (This called an undefined
    ``_split_front_matter``, so every call failed with a NameError.)
    """
    _, fm_start, fm_end = _parse_front_matter(plan_text)
    if fm_start == -1:
        return plan_text, "No front matter found in plan."

    lines = plan_text.split('\n')
    in_nwd = False

    for i in range(fm_start + 1, fm_end):
        line = lines[i]
        stripped = line.strip()
        if stripped.lower() in ('non-working-days:', 'holidays:'):
            in_nwd = True
            continue
        if in_nwd and stripped.startswith('- '):
            entry = stripped[2:].strip()
            if entry.lower().startswith(name.lower()):
                n = new_name or name
                s = start_date
                e = end_date
                # Parse existing dates if not provided
                match = re.match(r'^[^:]+:\s*(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?', entry)
                if match:
                    s = s or match.group(1)
                    e = e or match.group(2) or ''
                if not s:
                    return plan_text, f"Non-working day '{name}' has no date; give a start_date."
                indent = line[:len(line) - len(line.lstrip())]
                new_entry = f'{indent}- {n}: {s}'
                if e:
                    new_entry += f':{e}'
                lines[i] = new_entry
                return '\n'.join(lines), f"Updated non-working day '{name}'."
        elif in_nwd and not stripped.startswith('-') and stripped and ':' in stripped:
            in_nwd = False

    return plan_text, f"Non-working day '{name}' not found."


# ===================================================================
# Plan quality review (#782)
# ===================================================================


def _analyse_plan(plan_text: str) -> tuple[str, str]:
    """Review the plan for common problems. Read-only."""
    from noodle_core.plan_quality import format_review, review_plan

    return plan_text, format_review(review_plan(plan_text), limit=40)


def _apply_plan_fix(plan_text: str, finding_id: str) -> tuple[str, str]:
    """Apply the one-click fix for a finding reported by analyse_plan."""
    from noodle_core.plan_quality import FixError, apply_finding_fix

    try:
        updated = apply_finding_fix(plan_text, finding_id)
    except FixError as exc:
        return plan_text, f"Could not apply the fix: {exc}"
    return updated, f"Applied the fix for '{finding_id}'."


# ===================================================================
# Tool definitions (OpenAI function calling format)
# ===================================================================

TOOL_DEFINITIONS = [
    # --- Plan Structure ---
    {
        "type": "function",
        "function": {
            "name": "create_plan",
            "description": "Create a new plan from scratch with title and optional fields",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Project title"},
                    "project_manager": {"type": "string", "description": "Project manager name"},
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD)"},
                    "budget": {"type": "string", "description": "Budget amount (e.g. '1,000,000')"},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_front_matter",
            "description": "Update any top-level front matter field (title, project manager, start date, budget)",
            "parameters": {
                "type": "object",
                "properties": {
                    "field": {"type": "string", "description": "Field name to update"},
                    "value": {"type": "string", "description": "New value"},
                },
                "required": ["field", "value"],
            },
        },
    },
    # --- Tasks ---
    {
        "type": "function",
        "function": {
            "name": "add_task",
            "description": "Add a task to the plan. Use parent to nest under an existing task.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Task name"},
                    "parent": {"type": "string", "description": "Parent task name to nest under"},
                    "duration": {"type": "string", "description": "Duration (e.g. 5d, 2w, 1m)"},
                    "resource": {"type": "string", "description": "Resource short name"},
                    "depends_on": {"type": "string", "description": "Task name this depends on"},
                    "sequential": {"type": "boolean", "description": "Mark as sequential (*) task"},
                    "comment": {"type": "string", "description": "Comment text"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_task",
            "description": "Update an existing task's name, duration, resource, completion, or comment",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Current task name to find"},
                    "new_name": {"type": "string", "description": "New task name"},
                    "duration": {"type": "string", "description": "New duration"},
                    "resource": {"type": "string", "description": "New resource short name"},
                    "completion": {"type": "integer", "description": "Completion percentage (0-100)"},
                    "comment": {"type": "string", "description": "New comment text"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_task",
            "description": "Remove a task and all its children from the plan",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Task name to remove"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "move_task",
            "description": "Move a task (and its children) under a different parent task",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Task name to move"},
                    "new_parent": {"type": "string", "description": "New parent task name"},
                },
                "required": ["name", "new_parent"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_dependency",
            "description": "Set a dependency on a task (e.g. [depends Phase 1])",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_name": {"type": "string", "description": "Task to add dependency to"},
                    "depends_on": {"type": "string", "description": "Task name it depends on"},
                    "dep_type": {"type": "string", "enum": ["FS", "SS", "FF", "SF"],
                                 "description": "Dependency type (default FS)"},
                    "lag": {"type": "string", "description": "Lag/lead time (e.g. +2d, -1w)"},
                },
                "required": ["task_name", "depends_on"],
            },
        },
    },
    # --- Resources ---
    {
        "type": "function",
        "function": {
            "name": "add_resource",
            "description": "Add a resource to the plan's front matter",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Resource short name"},
                    "full_name": {"type": "string", "description": "Full name"},
                    "role": {"type": "string", "description": "Role/title"},
                    "email": {"type": "string", "description": "Email address"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_resource",
            "description": "Update an existing resource's details",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Resource short name to find"},
                    "full_name": {"type": "string", "description": "New full name"},
                    "role": {"type": "string", "description": "New role/title"},
                    "email": {"type": "string", "description": "New email address"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_resource",
            "description": "Remove a resource from the plan's front matter",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Resource short name to remove"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assign_resource",
            "description": "Assign a resource to a task",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_name": {"type": "string", "description": "Task name"},
                    "resource_name": {"type": "string", "description": "Resource short name"},
                },
                "required": ["task_name", "resource_name"],
            },
        },
    },
    # --- Stakeholders ---
    {
        "type": "function",
        "function": {
            "name": "add_stakeholder",
            "description": "Add a stakeholder to the plan's front matter",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Stakeholder name"},
                    "interest": {"type": "string", "enum": ["High", "Medium", "Low"],
                                 "description": "Interest level"},
                    "influence": {"type": "string", "enum": ["High", "Medium", "Low"],
                                  "description": "Influence level"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_stakeholder",
            "description": "Update an existing stakeholder's interest or influence levels",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Stakeholder name to find"},
                    "interest": {"type": "string", "enum": ["High", "Medium", "Low"],
                                 "description": "New interest level"},
                    "influence": {"type": "string", "enum": ["High", "Medium", "Low"],
                                  "description": "New influence level"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_stakeholder",
            "description": "Remove a stakeholder from the plan",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Stakeholder name to remove"},
                },
                "required": ["name"],
            },
        },
    },
    # --- RAID ---
    {
        "type": "function",
        "function": {
            "name": "add_raid_item",
            "description": "Add a Risk, Assumption, Issue, or Decision to the RAID log",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["Risk", "Assumption", "Issue", "Decision"],
                             "description": "RAID item type"},
                    "title": {"type": "string", "description": "Short title"},
                    "description": {"type": "string", "description": "Detailed description"},
                    "owner": {"type": "string", "description": "Owner name"},
                    "impact": {"type": "string", "description": "Impact level"},
                    "likelihood": {"type": "string", "description": "Likelihood level"},
                    "status": {"type": "string", "description": "Status (e.g. Open, Closed, Mitigated)"},
                    "mitigation": {"type": "string", "description": "Mitigation actions"},
                },
                "required": ["type", "title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_raid_item",
            "description": "Update an existing RAID item by ID",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer", "description": "RAID item ID"},
                    "title": {"type": "string", "description": "New title"},
                    "status": {"type": "string", "description": "New status"},
                    "owner": {"type": "string", "description": "New owner"},
                    "impact": {"type": "string", "description": "New impact level"},
                    "likelihood": {"type": "string", "description": "New likelihood level"},
                    "mitigation": {"type": "string", "description": "New mitigation actions"},
                },
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_raid_item",
            "description": "Remove a RAID item by ID",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer", "description": "RAID item ID to remove"},
                },
                "required": ["id"],
            },
        },
    },
    # --- Budget ---
    {
        "type": "function",
        "function": {
            "name": "add_budget_item",
            "description": "Add a budget line item",
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {"type": "string", "description": "Item description"},
                    "estimate": {"type": "number", "description": "Estimated cost"},
                    "forecast": {"type": "number", "description": "Forecast cost"},
                    "type": {"type": "string", "enum": ["Capex", "Opex", "One-off"],
                             "description": "Budget type"},
                    "supplier": {"type": "string", "description": "Supplier name"},
                    "category": {"type": "string",
                                 "enum": ["Consultancy", "Resource", "Travel",
                                          "Infrastructure", "Hardware", "Software"],
                                 "description": "Budget category"},
                },
                "required": ["description"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_budget_item",
            "description": "Update an existing budget item by ID",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer", "description": "Budget item ID"},
                    "description": {"type": "string", "description": "New description"},
                    "estimate": {"type": "number", "description": "New estimate"},
                    "forecast": {"type": "number", "description": "New forecast"},
                    "type": {"type": "string", "enum": ["Capex", "Opex", "One-off"],
                             "description": "New budget type"},
                    "supplier": {"type": "string", "description": "New supplier"},
                },
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_budget_item",
            "description": "Remove a budget item by ID",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer", "description": "Budget item ID to remove"},
                },
                "required": ["id"],
            },
        },
    },
    # --- Benefits ---
    {
        "type": "function",
        "function": {
            "name": "add_benefit",
            "description": "Add a benefit or disbenefit to the plan",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "description": "Benefit type (e.g. Benefit, Disbenefit)"},
                    "title": {"type": "string", "description": "Benefit title"},
                    "description": {"type": "string", "description": "Detailed description"},
                    "target_value": {"type": "string", "description": "Target value/metric"},
                    "contribution_percent": {"type": "integer", "description": "Contribution percentage"},
                },
                "required": ["type", "title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_benefit",
            "description": "Update an existing benefit by ID",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer", "description": "Benefit ID"},
                    "title": {"type": "string", "description": "New title"},
                    "description": {"type": "string", "description": "New description"},
                    "target_value": {"type": "string", "description": "New target value"},
                    "contribution_percent": {"type": "integer", "description": "New contribution %"},
                },
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_benefit",
            "description": "Remove a benefit by ID",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer", "description": "Benefit ID to remove"},
                },
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "link_benefit",
            "description": "Link one benefit to another (from_id linked_to to_id)",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_id": {"type": "integer", "description": "Source benefit ID"},
                    "to_id": {"type": "integer", "description": "Target benefit ID to link to"},
                },
                "required": ["from_id", "to_id"],
            },
        },
    },
    # --- Comms ---
    {
        "type": "function",
        "function": {
            "name": "add_comms_activity",
            "description": "Add a communications activity to the comms plan",
            "parameters": {
                "type": "object",
                "properties": {
                    "audience": {"type": "string", "description": "Target audience"},
                    "message": {"type": "string", "description": "Communication message/activity"},
                    "channel": {"type": "string", "description": "Communication channel"},
                    "frequency": {"type": "string",
                                  "enum": ["Daily", "Weekly", "Fortnightly", "Monthly",
                                           "Quarterly", "Annually", "Ad-hoc", "Once"],
                                  "description": "Frequency"},
                    "owner": {"type": "string", "description": "Owner"},
                },
                "required": ["audience", "message"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_comms_activity",
            "description": "Update an existing comms activity by ID",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer", "description": "Comms activity ID"},
                    "audience": {"type": "string", "description": "New audience"},
                    "message": {"type": "string", "description": "New message"},
                    "channel": {"type": "string", "description": "New channel"},
                    "frequency": {"type": "string",
                                  "enum": ["Daily", "Weekly", "Fortnightly", "Monthly",
                                           "Quarterly", "Annually", "Ad-hoc", "Once"],
                                  "description": "New frequency"},
                    "owner": {"type": "string", "description": "New owner"},
                },
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_comms_activity",
            "description": "Remove a comms activity by ID",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer", "description": "Comms activity ID to remove"},
                },
                "required": ["id"],
            },
        },
    },
    # --- Deliverables ---
    {
        "type": "function",
        "function": {
            "name": "add_deliverable",
            "description": "Add a deliverable ($name) to the plan as a milestone task",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Deliverable name (without $ prefix)"},
                    "type": {"type": "string", "enum": ["internal", "group", "external"],
                             "description": "Deliverable type (default: internal)"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_deliverable",
            "description": "Rename a deliverable across all task lines",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Current deliverable name"},
                    "new_name": {"type": "string", "description": "New deliverable name"},
                    "type": {"type": "string", "enum": ["internal", "group", "external"],
                             "description": "New deliverable type"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_deliverable",
            "description": "Remove a deliverable ($name) from all task lines",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Deliverable name to remove"},
                },
                "required": ["name"],
            },
        },
    },
    # --- Baseline ---
    {
        "type": "function",
        "function": {
            "name": "create_baseline",
            "description": "Create a baseline snapshot of all current tasks",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    # --- Plan quality (#782) ---
    {
        "type": "function",
        "function": {
            "name": "analyse_plan",
            "description": (
                "Review the plan for common problems -- dangling or circular dependencies, "
                "tasks with no duration or owner, over-allocated resources, work on "
                "non-working days, missing governance -- and return each finding with its "
                "severity, line, how to fix it, and an id. Read-only; call it before "
                "suggesting plan improvements."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "apply_plan_fix",
            "description": (
                "Apply the one-click fix for a finding that analyse_plan marked "
                "'[one-click fix available]', by its id."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "finding_id": {"type": "string", "description": "The finding's id from analyse_plan"},
                },
                "required": ["finding_id"],
            },
        },
    },
    # --- Non-working days ---
    {
        "type": "function",
        "function": {
            "name": "add_non_working_day",
            "description": "Add a non-working day or holiday period",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Holiday/event name"},
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD), optional for single day"},
                },
                "required": ["name", "start_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_non_working_day",
            "description": "Remove a non-working day entry by name",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Holiday/event name to remove"},
                },
                "required": ["name"],
            },
        },
    },
    # --- Highlights ---
    {
        "type": "function",
        "function": {
            "name": "add_highlight",
            "description": "Add a status update/highlight entry with date, author, and content (RAG status, key updates, risks)",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "Date (YYYY-MM-DD)"},
                    "author": {"type": "string", "description": "Author name (without @)"},
                    "content": {"type": "string", "description": "Highlight content (markdown text with RAG status, updates, etc.)"},
                },
                "required": ["date", "author", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_highlight",
            "description": "Update an existing highlight entry by date and author",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "Date of the highlight (YYYY-MM-DD)"},
                    "author": {"type": "string", "description": "Author name"},
                    "content": {"type": "string", "description": "New content"},
                },
                "required": ["date", "author", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_highlight",
            "description": "Remove a highlight entry by date and author",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "Date of the highlight (YYYY-MM-DD)"},
                    "author": {"type": "string", "description": "Author name"},
                },
                "required": ["date", "author"],
            },
        },
    },
    # --- Milestones ---
    {
        "type": "function",
        "function": {
            "name": "add_milestone",
            "description": "Add a milestone (a task with zero duration marking a key date)",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Milestone name"},
                    "parent": {"type": "string", "description": "Parent task/phase name to nest under"},
                    "date": {"type": "string", "description": "Target date (YYYY-MM-DD)"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_milestone",
            "description": "Update a milestone name or date",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Current milestone name"},
                    "new_name": {"type": "string", "description": "New name"},
                    "date": {"type": "string", "description": "New target date (YYYY-MM-DD)"},
                },
                "required": ["name"],
            },
        },
    },
    # --- Labels ---
    {
        "type": "function",
        "function": {
            "name": "add_label",
            "description": "Add a #label tag to a task for categorisation",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_name": {"type": "string", "description": "Task name to add the label to"},
                    "label": {"type": "string", "description": "Label name (without #)"},
                },
                "required": ["task_name", "label"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_label",
            "description": "Remove a #label tag from a task",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_name": {"type": "string", "description": "Task name"},
                    "label": {"type": "string", "description": "Label name to remove (without #)"},
                },
                "required": ["task_name", "label"],
            },
        },
    },
    # --- Recurrence ---
    {
        "type": "function",
        "function": {
            "name": "set_recurrence",
            "description": "Set a recurrence pattern on a task (e.g. weekly, monthly, every 2 weeks)",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_name": {"type": "string", "description": "Task name"},
                    "pattern": {"type": "string", "description": "Recurrence pattern (e.g. 'weekly', 'monthly', 'every 2 weeks')"},
                },
                "required": ["task_name", "pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_recurrence",
            "description": "Remove recurrence from a task",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_name": {"type": "string", "description": "Task name"},
                },
                "required": ["task_name"],
            },
        },
    },
    # --- Update Non-working day ---
    {
        "type": "function",
        "function": {
            "name": "update_non_working_day",
            "description": "Update an existing non-working day entry (name, dates)",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Current name of the non-working day"},
                    "new_name": {"type": "string", "description": "New name"},
                    "start_date": {"type": "string", "description": "New start date (YYYY-MM-DD)"},
                    "end_date": {"type": "string", "description": "New end date (YYYY-MM-DD)"},
                },
                "required": ["name"],
            },
        },
    },
]


# ===================================================================
# Executor registry and dispatch
# ===================================================================

TOOL_EXECUTORS = {
    "create_plan": _create_plan,
    "update_front_matter": _update_front_matter,
    "add_task": _add_task,
    "update_task": _update_task,
    "remove_task": _remove_task,
    "move_task": _move_task,
    "set_dependency": _set_dependency,
    "add_resource": _add_resource,
    "update_resource": _update_resource,
    "remove_resource": _remove_resource,
    "assign_resource": _assign_resource,
    "add_stakeholder": _add_stakeholder,
    "update_stakeholder": _update_stakeholder,
    "remove_stakeholder": _remove_stakeholder,
    "add_raid_item": _add_raid_item,
    "update_raid_item": _update_raid_item,
    "remove_raid_item": _remove_raid_item,
    "add_budget_item": _add_budget_item,
    "update_budget_item": _update_budget_item,
    "remove_budget_item": _remove_budget_item,
    "add_benefit": _add_benefit,
    "update_benefit": _update_benefit,
    "remove_benefit": _remove_benefit,
    "link_benefit": _link_benefit,
    "add_comms_activity": _add_comms_activity,
    "update_comms_activity": _update_comms_activity,
    "remove_comms_activity": _remove_comms_activity,
    "add_deliverable": _add_deliverable,
    "update_deliverable": _update_deliverable,
    "remove_deliverable": _remove_deliverable,
    "create_baseline": _create_baseline,
    "analyse_plan": _analyse_plan,
    "apply_plan_fix": _apply_plan_fix,
    "add_non_working_day": _add_non_working_day,
    "remove_non_working_day": _remove_non_working_day,
    "update_non_working_day": _update_non_working_day,
    "add_highlight": _add_highlight,
    "update_highlight": _update_highlight,
    "remove_highlight": _remove_highlight,
    "add_milestone": _add_milestone,
    "update_milestone": _update_milestone,
    "add_label": _add_label,
    "remove_label": _remove_label,
    "set_recurrence": _set_recurrence,
    "remove_recurrence": _remove_recurrence,
}


def execute_tool(tool_name: str, plan_text: str, arguments: dict) -> tuple[str, str]:
    """Execute a tool and return (updated_plan_text, result_message).

    Args:
        tool_name: Name of the tool to execute.
        plan_text: Current plan markdown text.
        arguments: Tool-specific keyword arguments.

    Returns:
        Tuple of (possibly modified plan text, human-readable result message).
    """
    executor = TOOL_EXECUTORS.get(tool_name)
    if not executor:
        return plan_text, f"Unknown tool: {tool_name}"
    try:
        # Filter arguments to only those the executor accepts.
        # Small models sometimes include extra fields (e.g. "function", "id").
        import inspect
        sig = inspect.signature(executor)
        valid_params = set(sig.parameters.keys()) - {'plan_text'}
        filtered_args = {k: v for k, v in arguments.items() if k in valid_params}
        return executor(plan_text, **filtered_args)
    except TypeError as e:
        return plan_text, f"Invalid arguments for {tool_name}: {e}"
    except Exception as e:
        return plan_text, f"Error executing {tool_name}: {e}"
