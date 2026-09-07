"""Convert between different task file formats."""

import re
import yaml

HIGHLIGHTS_START = '---highlights---'
HIGHLIGHTS_END = '---end-highlights---'
BUDGET_START = '---budget---'
RAID_LOG_START = '---raid log---'
COMMS_START = '---comms---'
BENEFITS_START = '---benefits---'
BASELINE_START = '---baseline---'
LESSONS_START = '---lessons learned---'
WHITEBOARD_START = '---whiteboard---'

# Every back-matter section marker. The canonical write order (see the
# update_plan_* functions below, e.g. update_plan_highlights) puts these
# in the order: highlights, budget, benefits, raid log, comms, lessons
# learned, baseline, whiteboard. Nothing enforces that order in hand-edited
# or AI-chat-edited plan text, though, so any function that finds "the next
# section marker"
# after a given section must scan for *every other* marker here and take
# whichever occurs earliest -- not just the ones that are supposed to come
# later in canonical order. Otherwise a section that ends up out of its
# canonical position can be silently swallowed into (or split across) a
# neighbouring section. See kevinmcaleer/Snakie#978.
ALL_SECTION_MARKERS = (
    HIGHLIGHTS_START, HIGHLIGHTS_END, BUDGET_START, BENEFITS_START,
    RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START,
    WHITEBOARD_START,
)


def _next_marker_idx(text: str, from_idx: int, exclude: tuple) -> int:
    """Find the earliest index, at or after *from_idx*, of any section
    marker other than those in *exclude*.

    Returns ``len(text)`` if none of the other markers appear.  Used so
    that "where does this section end" is always computed the same way --
    the closest marker actually present in the text -- regardless of
    whether the plan happens to have its sections in canonical order.
    """
    end_idx = len(text)
    for marker in ALL_SECTION_MARKERS:
        if marker in exclude:
            continue
        idx = text.find(marker, from_idx)
        if idx != -1 and idx < end_idx:
            end_idx = idx
    return end_idx


def _is_valid_yaml_value(value: str) -> bool:
    """Check if a string looks like a valid YAML scalar value.

    Rejects values that appear to be malformed YAML collections
    (e.g. unclosed brackets or braces).
    """
    if value.startswith('[') and not value.endswith(']'):
        return False
    if value.startswith('{') and not value.endswith('}'):
        return False
    return True


def extract_title_from_frontmatter(text: str) -> str:
    """Extract title from YAML front matter.

    Returns:
        The title from the front matter, or None if not found
    """
    lines = text.split('\n')
    in_frontmatter = False
    frontmatter_lines = []

    for line in lines:
        if line.strip() == '---':
            if not in_frontmatter:
                in_frontmatter = True
                continue
            else:
                # End of front matter
                break
        if in_frontmatter:
            frontmatter_lines.append(line)

    # Use YAML parsing to properly handle quoted strings and invalid YAML
    if frontmatter_lines:
        try:
            yaml_text = '\n'.join(frontmatter_lines)
            frontmatter = yaml.safe_load(yaml_text)
            if isinstance(frontmatter, dict):
                # Case-insensitive lookup for 'title' key
                for key, value in frontmatter.items():
                    if key.lower() == 'title' and value is not None:
                        return str(value)
        except yaml.YAMLError:
            # YAML parsing can fail (e.g. @ symbols in resource lines).
            # Fall back to simple line-by-line parsing.
            for line in frontmatter_lines:
                if ':' in line:
                    key, value = line.split(':', 1)
                    if key.strip().lower() == 'title':
                        title = value.strip()
                        if title and _is_valid_yaml_value(title):
                            return title

    return None


def convert_plan_format_to_standard(text: str) -> str:
    """Convert plan.md format to standard natural language format.

    Conversions:
    - Strip YAML front matter (between --- markers)
    - Strip highlights section (---highlights--- / ---end-highlights---)
    - Convert "3days" to "3d", "2weeks" to "2w", etc.
    - Preserve [depends taskname] syntax (dependencies use bracket notation)
    - Convert multi-word task names to snake_case
    - Keep @ for resources
    - Keep % for completion
    - Keep !" for comments
    """
    # Strip highlights, budget, RAID log, comms, lessons, baseline, and
    # whiteboard sections before processing
    text = strip_highlights(text)
    text = strip_budget(text)
    text = strip_raid_log(text)
    text = strip_comms(text)
    text = strip_benefits(text)
    text = strip_lessons(text)
    text = strip_baseline(text)
    text = strip_whiteboard(text)
    lines = text.split('\n')
    output_lines = []
    in_frontmatter = False

    for line in lines:
        # Skip YAML front matter
        if line.strip() == '---':
            in_frontmatter = not in_frontmatter
            continue
        if in_frontmatter:
            continue

        # Skip commented-out lines (// prefix) — preserved in markdown but not parsed
        if line.lstrip().startswith('//'):
            continue

        # Skip markdown table rows and headings so content from supplementary
        # sections (benefits, RAID, etc.) does not become tasks if a user types
        # the section marker incorrectly (e.g. ``benefits---`` instead of
        # ``---benefits---``).
        stripped_line = line.lstrip()
        if stripped_line.startswith('|'):
            continue
        if re.match(r'^#+\s+\S', stripped_line):
            continue

        # Convert duration formats: "3days" -> "3d", "2weeks" -> "2w", "1month" -> "1m"
        line = re.sub(r'(\d+)days?', r'\1d', line)
        line = re.sub(r'(\d+)weeks?', r'\1w', line)
        line = re.sub(r'(\d+)months?', r'\1m', line)

        # Preserve [depends ...] syntax as-is (dependencies use bracket notation)
        # No conversion needed - the scheduling engine handles [depends] directly

        # Convert multi-word task names to snake_case for tasks with metadata
        # Only convert if line has @ or % or # or date or duration (has metadata)
        stripped = line.lstrip()
        if stripped and any(c in stripped for c in ['@', '%', '#', 'd', 'w', 'm']):
            # Extract leading whitespace and * if present
            leading_ws = line[:len(line) - len(stripped)]
            is_sequential = stripped.startswith('*')
            if is_sequential:
                stripped = stripped[1:].lstrip()

            # Find where the metadata starts (@, #, number, date)
            metadata_start = len(stripped)
            for char in ['@', '#', '!']:
                pos = stripped.find(char)
                if pos > 0:  # pos > 0 to ensure there's a task name before it
                    metadata_start = min(metadata_start, pos)

            # Check for percent token (digits followed by %) - use start of digits, not %
            percent_match = re.search(r'\b(\d{1,3})%', stripped)
            if percent_match and percent_match.start() > 0:
                metadata_start = min(metadata_start, percent_match.start())

            # Also check for dates and durations
            date_match = re.search(r'\d{4}-\d{2}-\d{2}', stripped)
            if date_match and date_match.start() > 0:
                metadata_start = min(metadata_start, date_match.start())

            duration_match = re.search(r'\d+[dwmy]', stripped)
            if duration_match and duration_match.start() > 0:
                metadata_start = min(metadata_start, duration_match.start())

            # Extract task name and metadata
            task_name = stripped[:metadata_start].strip()
            metadata = stripped[metadata_start:].strip()

            # Don't convert task names - preserve them as-is
            # Task names are for display and should keep spaces

            # Reconstruct line
            seq_prefix = '*' if is_sequential else ''
            line = f"{leading_ws}{seq_prefix}{task_name} {metadata}" if metadata else f"{leading_ws}{seq_prefix}{task_name}"

        output_lines.append(line)

    return '\n'.join(output_lines)


def extract_highlights(text: str) -> list:
    """Extract highlights from plan text.

    Parses the ---highlights--- section and returns a list of highlight
    dictionaries with date, author, and content fields.  The section ends
    at ---end-highlights---, ---raid log---, or end of file.

    Returns:
        List of dicts: [{'date': '2026-02-13', 'author': 'Alice', 'content': '...'}]
    """
    start_idx = text.find(HIGHLIGHTS_START)
    if start_idx == -1:
        return []

    after_start = start_idx + len(HIGHLIGHTS_START)

    # Find the end: explicit end marker, or whichever other section marker
    # occurs next in the actual text, or EOF.
    end_idx = len(text)
    for marker in (HIGHLIGHTS_END, BUDGET_START, BENEFITS_START, RAID_LOG_START,
                   COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START):
        idx = text.find(marker, after_start)
        if idx != -1 and idx < end_idx:
            end_idx = idx

    section = text[after_start:end_idx]
    return _parse_highlights_section(section)


def _parse_highlights_section(section: str) -> list:
    """Parse the content between highlights delimiters into structured data."""
    highlights = []
    current = None

    for line in section.split('\n'):
        stripped = line.strip()

        # Skip blank lines before the first heading
        if not stripped and current is None:
            continue

        # Match heading line: ## 2026-02-13 @Alice
        heading_match = re.match(
            r'^##\s+(\d{4}-\d{2}-\d{2})\s+@(\S+)\s*$', stripped
        )
        if heading_match:
            if current is not None:
                current['content'] = current['content'].strip()
                highlights.append(current)
            current = {
                'date': heading_match.group(1),
                'author': heading_match.group(2),
                'content': '',
            }
            continue

        # Content line (belongs to current highlight), including blank lines
        if current is not None:
            current['content'] += line.rstrip() + '\n'

    # Don't forget the last highlight
    if current is not None:
        current['content'] = current['content'].strip()
        highlights.append(current)

    return highlights


def _strip_trailing_bare_separator(text: str) -> str:
    """Remove a trailing bare ``---`` separator line, if present.

    The bare ``---`` line is only meaningful as a visual lead-in to the
    highlights section.  Once whatever used to follow it (highlights, or
    a hand-typed separator that was never followed by anything special)
    has been stripped away, the ``---`` no longer marks anything and
    should not be preserved as if it were plan content — otherwise it
    lingers indefinitely between the task list and whatever back-matter
    section happens to be first.  Multiple stacked bare lines are all
    removed.
    """
    text = text.rstrip('\n')
    lines = text.split('\n')
    while lines and lines[-1].strip() == '---':
        lines.pop()
    return '\n'.join(lines).rstrip('\n')


def strip_highlights(text: str) -> str:
    """Remove the highlights section from plan text.

    Returns the plan text without the highlights block, suitable for
    passing to the task parser.  Also removes the --- separator line
    that precedes the highlights section.  The section ends at
    ---end-highlights---, ---raid log---, or end of file.
    """
    start_idx = text.find(HIGHLIGHTS_START)
    if start_idx == -1:
        return text

    after_start = start_idx + len(HIGHLIGHTS_START)

    # Find the end: explicit end marker, or whichever other section marker
    # occurs next in the actual text, or EOF.
    end_idx = len(text)
    end_len = 0
    for marker in (HIGHLIGHTS_END, BUDGET_START, BENEFITS_START, RAID_LOG_START,
                   COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START):
        idx = text.find(marker, after_start)
        if idx != -1 and idx < end_idx:
            end_idx = idx
            # Only consume the end-highlights marker, not the raid log or
            # baseline markers so their strippers can still find them
            end_len = len(marker) if marker == HIGHLIGHTS_END else 0

    # Remove trailing --- separator that precedes the highlights section
    before = _strip_trailing_bare_separator(text[:start_idx])
    after = text[end_idx + end_len:].lstrip('\n')

    if after:
        return before + '\n' + after
    return before


def generate_highlights_text(highlights: list) -> str:
    """Generate the highlights section text from structured data.

    Args:
        highlights: List of dicts with date, author, and content fields.

    Returns:
        The formatted highlights block including delimiters, or empty
        string if there are no highlights.
    """
    if not highlights:
        return ''

    lines = [HIGHLIGHTS_START]
    for h in highlights:
        lines.append(f"## {h['date']} @{h['author']}")
        lines.append(h.get('content', '').rstrip())
        lines.append('')
    return '\n'.join(lines).rstrip()


def update_plan_highlights(plan_text: str, highlights: list) -> str:
    """Update plan text with the given highlights.

    Replaces existing highlights section or appends a new one.
    If highlights list is empty, removes any existing section.

    Args:
        plan_text: The full plan text (may or may not contain highlights).
        highlights: List of highlight dicts.

    Returns:
        Updated plan text.
    """
    # Preserve any existing budget, benefits, RAID log, comms, lessons,
    # baseline, and whiteboard sections that follow highlights
    budget_text = extract_budget(plan_text)
    benefits_text = extract_benefits(plan_text)
    raid_log_text = extract_raid_log(plan_text)
    comms_text = extract_comms_plan(plan_text)
    lessons_text = extract_lessons(plan_text)
    baseline_text = extract_baseline(plan_text)
    whiteboard_text = extract_whiteboard(plan_text)
    base = strip_whiteboard(strip_baseline(strip_lessons(strip_comms(strip_raid_log(strip_benefits(strip_budget(strip_highlights(plan_text)))))))).rstrip('\n')
    section = generate_highlights_text(highlights)

    if not section:
        result = base
    else:
        result = base + '\n\n---\n\n' + section

    # Re-append the budget if it was present
    if budget_text:
        result = result.rstrip('\n') + '\n\n' + BUDGET_START + '\n' + budget_text

    # Re-append the benefits if present
    if benefits_text:
        result = result.rstrip('\n') + '\n\n' + BENEFITS_START + '\n' + benefits_text

    # Re-append the RAID log if it was present
    if raid_log_text:
        result = result.rstrip('\n') + '\n\n' + RAID_LOG_START + '\n' + raid_log_text

    # Re-append the comms plan if it was present
    if comms_text:
        result = result.rstrip('\n') + '\n\n' + COMMS_START + '\n' + comms_text

    # Re-append the lessons learned section if it was present
    if lessons_text:
        result = result.rstrip('\n') + '\n\n' + LESSONS_START + '\n' + lessons_text

    # Re-append the baseline if it was present
    if baseline_text:
        result = result.rstrip('\n') + '\n\n' + BASELINE_START + '\n' + baseline_text

    # Re-append the whiteboard section if it was present
    if whiteboard_text:
        result = result.rstrip('\n') + '\n\n' + WHITEBOARD_START + '\n' + whiteboard_text

    return result


def extract_raid_log(text: str) -> str:
    """Extract the RAID log section text from plan text.

    Returns the raw text between ``---raid log---`` and whichever other
    section marker occurs next in the actual text (not just the ones that
    are supposed to follow it in canonical order), or EOF.  Returns an
    empty string if no RAID log section is present.
    """
    start_idx = text.find(RAID_LOG_START)
    if start_idx == -1:
        return ''

    after_start = start_idx + len(RAID_LOG_START)
    end_idx = _next_marker_idx(text, after_start, exclude=(RAID_LOG_START,))

    return text[after_start:end_idx].strip()


def strip_raid_log(text: str) -> str:
    """Remove the RAID log section from plan text.

    Returns the plan text without the ``---raid log---`` block,
    suitable for passing to the task parser.  Preserves whatever other
    section actually follows the RAID log in the text, regardless of
    canonical order.
    """
    start_idx = text.find(RAID_LOG_START)
    if start_idx == -1:
        return text

    before = _strip_trailing_bare_separator(text[:start_idx])
    end_idx = _next_marker_idx(text, start_idx, exclude=(RAID_LOG_START,))
    if end_idx < len(text):
        return before + '\n\n' + text[end_idx:]

    return before


def extract_budget(text: str) -> str:
    """Extract the budget section text from plan text.

    Returns the raw text between ``---budget---`` and whichever other
    section marker occurs next in the actual text, or EOF.  Returns an
    empty string if no budget section is present.
    """
    start_idx = text.find(BUDGET_START)
    if start_idx == -1:
        return ''

    after_start = start_idx + len(BUDGET_START)
    end_idx = _next_marker_idx(text, after_start, exclude=(BUDGET_START,))

    return text[after_start:end_idx].strip()


def strip_budget(text: str) -> str:
    """Remove the budget section from plan text.

    Returns the plan text without the ``---budget---`` block.
    Preserves whatever other section actually follows the budget section
    in the text, regardless of canonical order.
    """
    start_idx = text.find(BUDGET_START)
    if start_idx == -1:
        return text

    before = _strip_trailing_bare_separator(text[:start_idx])
    end_idx = _next_marker_idx(text, start_idx, exclude=(BUDGET_START,))
    if end_idx < len(text):
        return before + '\n\n' + text[end_idx:]

    return before


def parse_budget_markdown(text: str) -> list:
    """Parse budget markdown table into a list of budget items.

    Args:
        text: Markdown text containing a budget table

    Returns:
        List of dicts with keys: id, description, estimate, forecast,
        type, invoice, po, supplier, total, date_ordered, date_received,
        category
    """
    lines = [line.strip() for line in text.split('\n') if line.strip()]

    # Find header row
    header_index = -1
    for i, line in enumerate(lines):
        lower = line.lower()
        if '|' in lower and any(kw in lower for kw in ['description', 'estimate', 'forecast']):
            header_index = i
            break

    if header_index == -1:
        return []

    def parse_row(line):
        parts = [cell.strip() for cell in line.split('|')]
        return [p for p in parts if p or parts.index(p) not in (0, len(parts) - 1)][0:]

    # More robust row parsing - split on pipes, drop empty first/last
    def parse_row(line):
        parts = line.split('|')
        cells = []
        for i, p in enumerate(parts):
            stripped = p.strip()
            if i == 0 and not stripped:
                continue
            if i == len(parts) - 1 and not stripped:
                continue
            cells.append(stripped)
        return cells

    headers = [h.lower() for h in parse_row(lines[header_index])]

    aliases = {
        'id': 'id', 'description': 'description', 'estimate': 'estimate',
        'forecast': 'forecast', 'type': 'type', 'invoice': 'invoice',
        'po': 'po', 'supplier': 'supplier', 'total': 'total',
        'ordered': 'date_ordered', 'received': 'date_received',
        'category': 'category'
    }

    col_map = {}
    for idx, h in enumerate(headers):
        for alias, field in aliases.items():
            if alias in h:
                col_map[field] = idx
                break

    valid_types = ['Capex', 'Opex', 'One-off']
    valid_categories = ['Consultancy', 'Resource', 'Travel', 'Infrastructure', 'Hardware', 'Software']
    items = []
    max_id = 0

    for i in range(header_index + 1, len(lines)):
        line = lines[i]
        if '|' not in line:
            continue
        if all(c in '-| ' for c in line):
            continue
        if line.lstrip().startswith('//'):
            continue

        cells = parse_row(line)
        if not cells:
            continue

        def get_cell(field, default=''):
            idx = col_map.get(field)
            if idx is not None and idx < len(cells):
                return cells[idx].replace('\\|', '|')
            return default

        id_str = get_cell('id', '')
        item_id = int(id_str) if id_str and id_str.isdigit() else max_id + 1
        max_id = max(max_id, item_id)

        item_type = get_cell('type', 'Capex')
        item_category = get_cell('category', 'Consultancy')

        def safe_float(val, default=0):
            try:
                return float(val) if val else default
            except (ValueError, TypeError):
                return default

        items.append({
            'id': item_id,
            'description': get_cell('description', ''),
            'estimate': safe_float(get_cell('estimate', '0')),
            'forecast': safe_float(get_cell('forecast', '0')),
            'type': item_type if item_type in valid_types else 'Capex',
            'invoice': get_cell('invoice', ''),
            'po': get_cell('po', ''),
            'supplier': get_cell('supplier', ''),
            'total': safe_float(get_cell('total', '0')),
            'date_ordered': get_cell('date_ordered', ''),
            'date_received': get_cell('date_received', ''),
            'category': item_category if item_category in valid_categories else 'Consultancy',
        })

    return items


def parse_raid_markdown(text: str) -> list:
    """Parse RAID log markdown table into a list of RAID items.

    Handles two table formats:
    1. Simple: Type | Description | Status | Score | Owner | Date
       (Description maps to 'title' field internally)
    2. Full: ID | Type | Title | Description | Raised By | Owner |
             Mitigation Actions | Impact | Likelihood | Score | Status
       (Title and Description are separate fields)

    Args:
        text: Markdown text containing a RAID log table

    Returns:
        List of dicts with keys: id, type, title, description, raised_by,
        owner, mitigation_actions, impact, likelihood, score, status,
        priority, target_date

    Examples:
        Simple format table:
        >>> text = '''
        ... | Type | Description | Status |
        ... | risk | Test risk   | open   |
        ... '''
        >>> items = parse_raid_markdown(text)
        >>> items[0]['title']
        'Test risk'
    """
    lines = [line.strip() for line in text.split('\n') if line.strip()]

    # Find header row
    header_index = -1
    for i, line in enumerate(lines):
        if '|' in line and any(keyword in line.lower() for keyword in ['id', 'title', 'type', 'description']):
            header_index = i
            break

    if header_index == -1:
        return []

    def parse_row(line):
        """Parse a markdown table row into cells, handling escaped pipes."""
        # Use regex to split on pipes that aren't escaped
        import re
        # Split on | that isn't preceded by \
        parts = re.split(r'(?<!\\)\|', line)
        # Strip leading/trailing empty parts (before first | and after last |)
        if parts and not parts[0].strip():
            parts = parts[1:]
        if parts and not parts[-1].strip():
            parts = parts[:-1]
        # Preserve empty cells to maintain column alignment
        cells = [cell.strip() for cell in parts]
        return cells

    headers = [h.lower() for h in parse_row(lines[header_index])]

    # Build column mapping with explicit precedence
    # Map standard fields first
    col_map = {}
    standard_aliases = {
        'id': 'id',
        'type': 'type',
        'raised by': 'raised_by',
        'owner': 'owner',
        'mitigation actions': 'mitigation_actions',
        'impact': 'impact',
        'likelihood': 'likelihood',
        'score': 'score',
        'status': 'status',
        'priority': 'priority',
        'target date': 'target_date',
        'date': 'target_date',
    }

    for idx, header in enumerate(headers):
        for alias, field in standard_aliases.items():
            if alias in header:
                col_map[field] = idx
                break

    # Handle title/description mapping with explicit logic:
    # - If "title" exists, map it to 'title'
    # - If "description" exists, map it to 'description'
    # - If "description" exists but "title" doesn't, also map "description" to 'title' (simple format)
    has_title_col = False
    has_desc_col = False

    for idx, header in enumerate(headers):
        if 'title' in header and 'title' not in col_map:
            col_map['title'] = idx
            has_title_col = True
        if 'description' in header and 'description' not in col_map:
            col_map['description'] = idx
            has_desc_col = True

    # Simple format fallback: use description column for title if no title column exists
    if not has_title_col and has_desc_col and 'title' not in col_map:
        col_map['title'] = col_map['description']

    valid_types = {'risk', 'action', 'issue', 'decision', 'dependency'}
    valid_statuses = {'open', 'closed', 'transferred'}
    items = []
    max_id_seen = 0  # Track maximum ID to avoid duplicates

    # Parse data rows (skip header and separator)
    for i in range(header_index + 1, len(lines)):
        line = lines[i]
        if not '|' in line:
            continue
        # Skip separator row (all dashes)
        if line.replace('|', '').replace('-', '').replace(' ', '') == '':
            continue
        if line.lstrip().startswith('//'):
            continue

        cells = parse_row(line)
        if not cells:
            continue

        def get_cell(field, default=''):
            idx = col_map.get(field)
            if idx is not None and idx < len(cells):
                # Unescape pipes
                return cells[idx].replace('\\|', '|')
            return default

        item_type = get_cell('type', 'risk').lower()
        item_status = get_cell('status', 'open').lower()
        if 'transferred' in item_status:
            item_status = 'transferred'

        # Try to get score directly from table first
        score_str = get_cell('score', '')
        if score_str:
            try:
                score = int(score_str)
                # Derive impact and likelihood from score if not provided
                impact_str = get_cell('impact', '')
                likelihood_str = get_cell('likelihood', '')
                if impact_str:
                    impact = int(impact_str)
                    impact = max(1, min(5, impact))
                else:
                    impact = 3  # default
                if likelihood_str:
                    likelihood = int(likelihood_str)
                    likelihood = max(1, min(5, likelihood))
                else:
                    likelihood = 3  # default
            except (ValueError, TypeError):
                # Fall back to calculating from impact/likelihood
                impact = int(get_cell('impact', '3') or '3')
                likelihood = int(get_cell('likelihood', '3') or '3')
                impact = max(1, min(5, impact))
                likelihood = max(1, min(5, likelihood))
                score = impact * likelihood
        else:
            # Calculate score from impact and likelihood
            impact = int(get_cell('impact', '3') or '3')
            likelihood = int(get_cell('likelihood', '3') or '3')
            impact = max(1, min(5, impact))
            likelihood = max(1, min(5, likelihood))
            score = impact * likelihood

        # Generate ID: use provided ID if valid, otherwise use max_id + 1
        id_str = get_cell('id', '')
        if id_str:
            try:
                item_id = int(id_str)
            except (ValueError, TypeError):
                item_id = max_id_seen + 1
        else:
            item_id = max_id_seen + 1

        max_id_seen = max(max_id_seen, item_id)

        item = {
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
            'target_date': get_cell('target_date', ''),
        }
        items.append(item)

    # Deduplicate items by (type, title, description) to prevent the same
    # RAID item from appearing multiple times (e.g. when the plan text
    # contains duplicate table rows).
    seen = set()
    unique_items = []
    for item in items:
        key = (item['type'], item['title'], item['description'])
        if key not in seen:
            seen.add(key)
            unique_items.append(item)

    return unique_items


def generate_raid_log_text(raid_items: list) -> str:
    """Generate a formatted markdown table from RAID items.

    Each column is padded to the width of its widest entry for
    clean, readable markdown output.

    Args:
        raid_items: List of dicts with all RAID item fields.
            Missing keys default to empty strings.

    Returns:
        The formatted markdown table string, or empty string if
        there are no items.
    """
    if not raid_items:
        return ''

    headers = ['ID', 'Type', 'Title', 'Description', 'Raised By', 'Owner',
               'Mitigation Actions', 'Impact', 'Likelihood', 'Score', 'Status',
               'Priority', 'Target Date']

    def escape_pipe(value):
        return str(value).replace('|', '\\|').replace('\n', ' ')

    rows = []
    for item in raid_items:
        rows.append([
            escape_pipe(str(item.get('id', ''))),
            escape_pipe(item.get('type', '')),
            escape_pipe(item.get('title', '')),
            escape_pipe(item.get('description', '')),
            escape_pipe(item.get('raised_by', '')),
            escape_pipe(item.get('owner', '')),
            escape_pipe(item.get('mitigation_actions', '')),
            escape_pipe(str(item.get('impact', ''))),
            escape_pipe(str(item.get('likelihood', ''))),
            escape_pipe(str(item.get('score', ''))),
            escape_pipe(item.get('status', '')),
            escape_pipe(item.get('priority', '')),
            escape_pipe(item.get('target_date', item.get('date', ''))),
        ])

    # Calculate column widths (minimum of header width)
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def format_row(cells):
        padded = [cell.ljust(widths[i]) for i, cell in enumerate(cells)]
        return '| ' + ' | '.join(padded) + ' |'

    separator = '|' + '|'.join('-' * (widths[i] + 2) for i in range(len(headers))) + '|'

    lines = [format_row(headers), separator]
    for row in rows:
        lines.append(format_row(row))

    return '\n'.join(lines)


def update_plan_raid_log(plan_text: str, raid_items: list) -> str:
    """Update plan text with the given RAID log table.

    Replaces the existing ``---raid log---`` section or appends a new
    one after the highlights section.  If *raid_items* is empty, any
    existing RAID log section is removed.  Preserves any comms, lessons,
    baseline, and whiteboard sections that follow.

    Args:
        plan_text: The full plan text.
        raid_items: List of RAID item dicts.

    Returns:
        Updated plan text.
    """
    # Preserve the comms, lessons, baseline, and whiteboard sections
    comms_text = extract_comms_plan(plan_text)
    lessons_text = extract_lessons(plan_text)
    baseline_text = extract_baseline(plan_text)
    whiteboard_text = extract_whiteboard(plan_text)
    base = strip_whiteboard(strip_baseline(strip_lessons(strip_comms(strip_raid_log(plan_text))))).rstrip('\n')
    table = generate_raid_log_text(raid_items)

    result = base
    if table:
        result = result + '\n\n' + RAID_LOG_START + '\n' + table

    # Re-append the comms plan if it was present
    if comms_text:
        result = result.rstrip('\n') + '\n\n' + COMMS_START + '\n' + comms_text

    # Re-append the lessons learned section if it was present
    if lessons_text:
        result = result.rstrip('\n') + '\n\n' + LESSONS_START + '\n' + lessons_text

    # Re-append the baseline if it was present
    if baseline_text:
        result = result.rstrip('\n') + '\n\n' + BASELINE_START + '\n' + baseline_text

    # Re-append the whiteboard section if it was present
    if whiteboard_text:
        result = result.rstrip('\n') + '\n\n' + WHITEBOARD_START + '\n' + whiteboard_text

    return result


def extract_comms_plan(text: str) -> str:
    """Extract the comms plan section text from plan text.

    Returns the raw text between ``---comms---`` and whichever other
    section marker occurs next in the actual text (not just the ones
    that are supposed to follow it in canonical order -- a RAID log,
    budget, or benefits section that ends up positioned after the comms
    section must still bound it, or its content leaks into the comms
    text). Returns an empty string if no comms section is present.
    """
    start_idx = text.find(COMMS_START)
    if start_idx == -1:
        return ''

    after_start = start_idx + len(COMMS_START)
    end_idx = _next_marker_idx(text, after_start, exclude=(COMMS_START,))

    return text[after_start:end_idx].strip()


def strip_comms(text: str) -> str:
    """Remove the comms plan section from plan text.

    Returns the plan text without the ``---comms---`` block.
    Preserves whatever other section actually follows the comms section
    in the text, regardless of canonical order.
    """
    start_idx = text.find(COMMS_START)
    if start_idx == -1:
        return text

    before = _strip_trailing_bare_separator(text[:start_idx])
    end_idx = _next_marker_idx(text, start_idx, exclude=(COMMS_START,))
    if end_idx < len(text):
        return before + '\n\n' + text[end_idx:]

    return before


def parse_comms_markdown(text: str) -> list:
    """Parse comms plan markdown table into a list of comms items.

    Args:
        text: Markdown text containing a comms plan table

    Returns:
        List of dicts with keys: id, activity, audience, content,
        frequency, channel, owner, status
    """
    lines = [line.strip() for line in text.split('\n') if line.strip()]

    # Find header row
    header_index = -1
    for i, line in enumerate(lines):
        lower = line.lower()
        if '|' in lower and any(kw in lower for kw in ['activity', 'audience', 'content']):
            header_index = i
            break

    if header_index == -1:
        return []

    def parse_row(line):
        parts = line.split('|')
        cells = []
        for i, p in enumerate(parts):
            stripped = p.strip()
            if i == 0 and not stripped:
                continue
            if i == len(parts) - 1 and not stripped:
                continue
            cells.append(stripped)
        return cells

    headers = [h.lower() for h in parse_row(lines[header_index])]

    aliases = {
        'id': 'id', 'activity': 'activity', 'audience': 'audience',
        'content': 'content', 'frequency': 'frequency',
        'channel': 'channel', 'owner': 'owner', 'status': 'status',
    }

    col_map = {}
    for idx, h in enumerate(headers):
        for alias, field in aliases.items():
            if alias in h:
                col_map[field] = idx
                break

    valid_frequencies = ['Daily', 'Weekly', 'Fortnightly', 'Monthly', 'Quarterly', 'Annually', 'Ad-hoc', 'Once']
    valid_statuses = ['Active', 'Planned', 'Completed']
    items = []
    max_id = 0

    for i in range(header_index + 1, len(lines)):
        line = lines[i]
        if '|' not in line:
            continue
        if all(c in '-| ' for c in line):
            continue
        if line.lstrip().startswith('//'):
            continue

        cells = parse_row(line)
        if not cells:
            continue

        def get_cell(field, default=''):
            idx = col_map.get(field)
            if idx is not None and idx < len(cells):
                return cells[idx].replace('\\|', '|')
            return default

        id_str = get_cell('id', '')
        item_id = int(id_str) if id_str and id_str.isdigit() else max_id + 1
        max_id = max(max_id, item_id)

        item_frequency = get_cell('frequency', 'Weekly')
        item_status = get_cell('status', 'Planned')

        items.append({
            'id': item_id,
            'activity': get_cell('activity', ''),
            'audience': get_cell('audience', ''),
            'content': get_cell('content', ''),
            'frequency': item_frequency if item_frequency in valid_frequencies else 'Weekly',
            'channel': get_cell('channel', ''),
            'owner': get_cell('owner', ''),
            'status': item_status if item_status in valid_statuses else 'Planned',
        })

    return items


def generate_comms_plan_text(comms_items: list) -> str:
    """Generate a formatted markdown table from comms plan items.

    Each column is padded to the width of its widest entry for
    clean, readable markdown output.

    Args:
        comms_items: List of dicts with all comms item fields.

    Returns:
        The formatted markdown table string, or empty string if
        there are no items.
    """
    if not comms_items:
        return ''

    headers = ['ID', 'Activity', 'Audience', 'Content', 'Frequency',
               'Channel', 'Owner', 'Status']

    def escape_pipe(value):
        return str(value).replace('|', '\\|').replace('\n', ' ')

    rows = []
    for item in comms_items:
        rows.append([
            escape_pipe(str(item.get('id', ''))),
            escape_pipe(item.get('activity', '')),
            escape_pipe(item.get('audience', '')),
            escape_pipe(item.get('content', '')),
            escape_pipe(item.get('frequency', '')),
            escape_pipe(item.get('channel', '')),
            escape_pipe(item.get('owner', '')),
            escape_pipe(item.get('status', '')),
        ])

    # Calculate column widths (minimum of header width)
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def format_row(cells):
        padded = [cell.ljust(widths[i]) for i, cell in enumerate(cells)]
        return '| ' + ' | '.join(padded) + ' |'

    separator = '|' + '|'.join('-' * (widths[i] + 2) for i in range(len(headers))) + '|'

    lines = [format_row(headers), separator]
    for row in rows:
        lines.append(format_row(row))

    return '\n'.join(lines)


def update_plan_comms(plan_text: str, comms_items: list) -> str:
    """Update plan text with the given comms plan table.

    Replaces the existing ``---comms---`` section or appends a new
    one after the RAID log section.  If *comms_items* is empty, any
    existing comms section is removed.  Preserves any lessons learned,
    baseline, and whiteboard sections that follow.

    Args:
        plan_text: The full plan text.
        comms_items: List of comms item dicts.

    Returns:
        Updated plan text.
    """
    # Preserve the lessons learned, baseline, and whiteboard sections
    lessons_text = extract_lessons(plan_text)
    baseline_text = extract_baseline(plan_text)
    whiteboard_text = extract_whiteboard(plan_text)
    base = strip_whiteboard(strip_baseline(strip_lessons(strip_comms(plan_text)))).rstrip('\n')
    table = generate_comms_plan_text(comms_items)

    result = base
    if table:
        result = result + '\n\n' + COMMS_START + '\n' + table

    # Re-append the lessons learned section if it was present
    if lessons_text:
        result = result.rstrip('\n') + '\n\n' + LESSONS_START + '\n' + lessons_text

    # Re-append the baseline if it was present
    if baseline_text:
        result = result.rstrip('\n') + '\n\n' + BASELINE_START + '\n' + baseline_text

    # Re-append the whiteboard section if it was present
    if whiteboard_text:
        result = result.rstrip('\n') + '\n\n' + WHITEBOARD_START + '\n' + whiteboard_text

    return result


def extract_baseline(text: str) -> str:
    """Extract the baseline section text from plan text.

    Returns the raw text between ``---baseline---`` and whichever other
    section marker occurs next in the actual text (not just the ones that
    are supposed to follow it in canonical order -- a whiteboard section
    that ends up positioned after the baseline must still bound it), or
    EOF. Returns an empty string if no baseline section is present.
    """
    start_idx = text.find(BASELINE_START)
    if start_idx == -1:
        return ''

    after_start = start_idx + len(BASELINE_START)
    end_idx = _next_marker_idx(text, after_start, exclude=(BASELINE_START,))
    return text[after_start:end_idx].strip()


def strip_baseline(text: str) -> str:
    """Remove the baseline section from plan text.

    Returns the plan text without the ``---baseline---`` block.
    Preserves whatever other section actually follows the baseline
    section in the text, regardless of canonical order.
    """
    start_idx = text.find(BASELINE_START)
    if start_idx == -1:
        return text

    before = _strip_trailing_bare_separator(text[:start_idx])
    end_idx = _next_marker_idx(text, start_idx, exclude=(BASELINE_START,))
    if end_idx < len(text):
        return before + '\n\n' + text[end_idx:]

    return before


def parse_baseline_markdown(text: str) -> list:
    """Parse baseline markdown table into a list of baseline items.

    Expects a markdown table with columns: Task Name | Start | Finish | Duration

    Args:
        text: Markdown text containing a baseline table

    Returns:
        List of dicts with keys: name, start, finish, duration
    """
    items = []
    lines = text.strip().split('\n')

    # Find the header row to determine column mapping
    header_line = None
    header_idx = -1
    for i, line in enumerate(lines):
        if '|' in line and 'task name' in line.lower():
            header_line = line
            header_idx = i
            break

    if header_line is None:
        return items

    # Parse header columns
    headers = [h.strip().lower() for h in header_line.strip('| ').split('|')]

    # Skip separator row (the line after headers with dashes)
    data_start = header_idx + 2

    for line in lines[data_start:]:
        line = line.strip()
        if not line or not line.startswith('|'):
            continue
        if line.startswith('//'):
            continue

        cells = [c.strip() for c in line.strip('| ').split('|')]

        if len(cells) < len(headers):
            continue

        item = {}
        for col_idx, header in enumerate(headers):
            value = cells[col_idx].strip() if col_idx < len(cells) else ''
            if header == 'task name':
                item['name'] = value
            elif header == 'start':
                item['start'] = value
            elif header == 'finish':
                item['finish'] = value
            elif header == 'duration':
                item['duration'] = value

        if item.get('name'):
            items.append(item)

    return items


def generate_baseline_text(baseline_items: list) -> str:
    """Generate a formatted markdown table from baseline items.

    Each column is padded to the width of its widest entry for
    clean, readable markdown output.

    Args:
        baseline_items: List of dicts with keys: name, start, finish, duration

    Returns:
        Markdown table string.
    """
    if not baseline_items:
        return ''

    headers = ['Task Name', 'Start', 'Finish', 'Duration']

    rows = []
    for item in baseline_items:
        rows.append([
            str(item.get('name', '')),
            str(item.get('start', '')),
            str(item.get('finish', '')),
            str(item.get('duration', '')),
        ])

    # Calculate column widths
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def pad(s, width):
        return s + ' ' * max(0, width - len(s))

    def format_row(cells):
        return '| ' + ' | '.join(pad(c, widths[i]) for i, c in enumerate(cells)) + ' |'

    separator = '|' + '|'.join('-' * (w + 2) for w in widths) + '|'

    lines = [format_row(headers), separator]
    for row in rows:
        lines.append(format_row(row))

    return '\n'.join(lines)


def update_plan_baseline(plan_text: str, baseline_items: list) -> str:
    """Update plan text with the given baseline table.

    Replaces the existing ``---baseline---`` section or appends a new
    one at the end of the plan text (after RAID log).  If
    *baseline_items* is empty, any existing baseline section is removed.
    Preserves any whiteboard section that follows.

    Args:
        plan_text: The full plan text.
        baseline_items: List of baseline item dicts.

    Returns:
        Updated plan text.
    """
    # Preserve the whiteboard section when updating baseline
    whiteboard_text = extract_whiteboard(plan_text)
    base = strip_whiteboard(strip_baseline(plan_text)).rstrip('\n')
    table = generate_baseline_text(baseline_items)

    result = base
    if table:
        result = result + '\n\n' + BASELINE_START + '\n' + table

    # Re-append the whiteboard section if it was present
    if whiteboard_text:
        result = result.rstrip('\n') + '\n\n' + WHITEBOARD_START + '\n' + whiteboard_text

    return result


def export_comms_to_docx(comms_items: list, project_name: str = "Project") -> bytes:
    """Export the communications plan as a Word document with a landscape table.

    Args:
        comms_items: List of comms plan item dicts.
        project_name: Project name for the document title.

    Returns:
        The .docx file content as bytes.
    """
    from docx import Document
    from docx.shared import Inches, Pt, Cm, RGBColor
    from docx.enum.section import WD_ORIENT
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    import io

    doc = Document()

    # Set landscape orientation
    section = doc.sections[0]
    section.orientation = WD_ORIENT.LANDSCAPE
    new_width, new_height = section.page_height, section.page_width
    section.page_width = new_width
    section.page_height = new_height
    section.left_margin = Cm(1.5)
    section.right_margin = Cm(1.5)
    section.top_margin = Cm(1.5)
    section.bottom_margin = Cm(1.5)

    # Title
    title = doc.add_heading(f'{project_name} — Communications Plan', level=1)
    title.alignment = WD_ALIGN_PARAGRAPH.LEFT

    if not comms_items:
        doc.add_paragraph('No communications plan items defined.')
        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()

    # Create table
    headers = ['#', 'Activity', 'Audience', 'Content', 'Frequency', 'Channel', 'Owner', 'Status']
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.LEFT

    # Header row
    hdr_cells = table.rows[0].cells
    for i, header in enumerate(headers):
        hdr_cells[i].text = header
        p = hdr_cells[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        run = p.runs[0]
        run.bold = True
        run.font.size = Pt(9)
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        from docx.oxml.ns import qn
        shading = hdr_cells[i]._element.get_or_add_tcPr()
        shading_el = shading.makeelement(qn('w:shd'), {
            qn('w:val'): 'clear',
            qn('w:color'): 'auto',
            qn('w:fill'): '4A90D9'
        })
        shading.append(shading_el)

    # Data rows
    for idx, item in enumerate(comms_items):
        row_cells = table.add_row().cells
        row_cells[0].text = str(item.get('id', idx + 1))
        row_cells[1].text = item.get('activity', '')
        row_cells[2].text = item.get('audience', '')
        row_cells[3].text = item.get('content', '')
        row_cells[4].text = item.get('frequency', '')
        row_cells[5].text = item.get('channel', '')
        row_cells[6].text = item.get('owner', '')
        row_cells[7].text = item.get('status', '')

        for cell in row_cells:
            for p in cell.paragraphs:
                p.alignment = WD_ALIGN_PARAGRAPH.LEFT
                for run in p.runs:
                    run.font.size = Pt(9)

    # Set column widths
    col_widths = [Cm(1), Cm(4), Cm(3.5), Cm(5), Cm(2.5), Cm(2.5), Cm(3), Cm(2)]
    for row in table.rows:
        for i, width in enumerate(col_widths):
            row.cells[i].width = width

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def extract_benefits(text: str) -> str:
    """Extract the benefits section text from plan text.

    Returns the raw text between ``---benefits---`` and whichever other
    section marker occurs next in the actual text, or EOF.  Returns an
    empty string if no benefits section is present.
    """
    start_idx = text.find(BENEFITS_START)
    if start_idx == -1:
        return ''

    after_start = start_idx + len(BENEFITS_START)
    end_idx = _next_marker_idx(text, after_start, exclude=(BENEFITS_START,))

    return text[after_start:end_idx].strip()


def strip_benefits(text: str) -> str:
    """Remove the benefits section from plan text.

    Returns the plan text without the ``---benefits---`` block.
    Preserves whatever other section actually follows the benefits
    section in the text, regardless of canonical order.
    """
    start_idx = text.find(BENEFITS_START)
    if start_idx == -1:
        return text

    before = _strip_trailing_bare_separator(text[:start_idx])
    end_idx = _next_marker_idx(text, start_idx, exclude=(BENEFITS_START,))
    if end_idx < len(text):
        return before + '\n\n' + text[end_idx:]

    return before


def parse_benefits_markdown(text: str) -> list:
    """Parse benefits markdown table into a list of benefit items.

    Expects a markdown table with columns matching the benefits schema.

    Args:
        text: Markdown text containing a benefits table

    Returns:
        List of dicts with keys: id, type, title, description,
        objective_type, target_value, current_value, target_date,
        measurement_method, linked_to, contribution_percent
    """
    lines = [line.strip() for line in text.split('\n') if line.strip()]

    # Find header row
    header_index = -1
    for i, line in enumerate(lines):
        if '|' in line and any(
            keyword in line.lower() for keyword in ['id', 'title', 'type']
        ):
            header_index = i
            break

    if header_index == -1:
        return []

    def parse_row(line):
        """Parse a markdown table row into cells."""
        parts = re.split(r'(?<!\\)\|', line)
        if parts and not parts[0].strip():
            parts = parts[1:]
        if parts and not parts[-1].strip():
            parts = parts[:-1]
        cells = [cell.strip() for cell in parts]
        return cells

    headers = [h.strip().lower() for h in parse_row(lines[header_index])]

    # Build column mapping with EXACT header match
    col_map = {}
    header_aliases = {
        'id': 'id',
        'type': 'type',
        'title': 'title',
        'description': 'description',
        'objective type': 'objective_type',
        'target value': 'target_value',
        'current value': 'current_value',
        'target date': 'target_date',
        'measurement': 'measurement_method',
        'linked to': 'linked_to',
        'contribution %': 'contribution_percent',
    }

    for idx, header in enumerate(headers):
        if header in header_aliases:
            col_map[header_aliases[header]] = idx

    items = []

    # Parse data rows (skip header and separator)
    for i in range(header_index + 1, len(lines)):
        line = lines[i]
        if '|' not in line:
            continue
        # Skip separator row (all dashes)
        if line.replace('|', '').replace('-', '').replace(' ', '') == '':
            continue
        if line.lstrip().startswith('//'):
            continue

        cells = parse_row(line)
        if not cells:
            continue

        def get_cell(field, default=''):
            idx = col_map.get(field)
            if idx is not None and idx < len(cells):
                return cells[idx].replace('\\|', '|')
            return default

        # Parse linked_to as list of ints
        linked_to_str = get_cell('linked_to', '')
        linked_to = []
        if linked_to_str:
            for part in linked_to_str.split(','):
                part = part.strip()
                if part:
                    try:
                        linked_to.append(int(part))
                    except (ValueError, TypeError):
                        pass

        # Parse contribution_percent as int
        contrib_str = get_cell('contribution_percent', '0')
        try:
            contribution_percent = int(contrib_str)
        except (ValueError, TypeError):
            contribution_percent = 0

        # Parse id
        id_str = get_cell('id', '')
        try:
            item_id = int(id_str) if id_str else len(items) + 1
        except (ValueError, TypeError):
            item_id = len(items) + 1

        item = {
            'id': item_id,
            'type': get_cell('type', ''),
            'title': get_cell('title', ''),
            'description': get_cell('description', ''),
            'objective_type': get_cell('objective_type', ''),
            'target_value': get_cell('target_value', ''),
            'current_value': get_cell('current_value', ''),
            'target_date': get_cell('target_date', ''),
            'measurement_method': get_cell('measurement_method', ''),
            'linked_to': linked_to,
            'contribution_percent': contribution_percent,
        }
        items.append(item)

    return items


# =====================================================================
# Lessons Learned (issue #598)
#
# A lessons learned table captured at the end of a project (or per phase),
# inspired by the Appreciative Inquiry approach: each lesson records what
# went well, what would be changed, the impact, and recommendations.
#
# The section is round-tripped through plan text using the marker
# ``---lessons learned---`` followed by a markdown table.  The columns are:
#
#   ID | Project Manager | Project Type | Technology | Project Phase |
#   Area | Impact Type | Observation | Impact | Recommendations | Date
# =====================================================================


def extract_lessons(text: str) -> str:
    """Extract the lessons learned section text from plan text.

    Returns the raw text between ``---lessons learned---`` and whichever
    other section marker occurs next in the actual text, or EOF.  Returns
    an empty string if no lessons learned section is present.
    """
    start_idx = text.find(LESSONS_START)
    if start_idx == -1:
        return ''

    after_start = start_idx + len(LESSONS_START)
    end_idx = _next_marker_idx(text, after_start, exclude=(LESSONS_START,))

    return text[after_start:end_idx].strip()


def strip_lessons(text: str) -> str:
    """Remove the lessons learned section from plan text.

    Returns the plan text without the ``---lessons learned---`` block.
    Preserves whatever other section actually follows it in the text,
    regardless of canonical order.
    """
    start_idx = text.find(LESSONS_START)
    if start_idx == -1:
        return text

    before = _strip_trailing_bare_separator(text[:start_idx])
    end_idx = _next_marker_idx(text, start_idx, exclude=(LESSONS_START,))
    if end_idx < len(text):
        return before + '\n\n' + text[end_idx:]

    return before


def parse_lessons_markdown(text: str) -> list:
    """Parse a lessons learned markdown table into a list of lesson items.

    Args:
        text: Markdown text containing a lessons learned table.

    Returns:
        List of dicts with keys: id, project_manager, project_type,
        technology, project_phase, area, impact_type, observation, impact,
        recommendations, date.
    """
    lines = [line.strip() for line in text.split('\n') if line.strip()]

    # Find header row
    header_index = -1
    for i, line in enumerate(lines):
        lower = line.lower()
        if '|' in lower and any(
            kw in lower
            for kw in ['observation', 'lesson', 'impact type', 'project manager']
        ):
            header_index = i
            break

    if header_index == -1:
        return []

    def parse_row(line):
        parts = re.split(r'(?<!\\)\|', line)
        if parts and not parts[0].strip():
            parts = parts[1:]
        if parts and not parts[-1].strip():
            parts = parts[:-1]
        return [cell.strip() for cell in parts]

    headers = [h.lower() for h in parse_row(lines[header_index])]

    aliases = {
        'id': 'id',
        'project manager': 'project_manager',
        'manager': 'project_manager',
        'project type': 'project_type',
        'technology': 'technology',
        'project phase': 'project_phase',
        'phase': 'project_phase',
        'area': 'area',
        'impact type': 'impact_type',
        'observation': 'observation',
        'lesson': 'observation',
        'impact': 'impact',
        'recommendation': 'recommendations',
        'recommendations': 'recommendations',
        'date': 'date',
    }

    col_map = {}
    for idx, header in enumerate(headers):
        for alias, field in aliases.items():
            if alias in header and field not in col_map:
                col_map[field] = idx
                break

    valid_impact_types = ['Went Well', 'Needs to Change', 'Mixed']
    items = []
    max_id = 0

    for i in range(header_index + 1, len(lines)):
        line = lines[i]
        if '|' not in line:
            continue
        # Skip separator row (all dashes)
        if line.replace('|', '').replace('-', '').replace(' ', '') == '':
            continue

        cells = parse_row(line)
        if not cells:
            continue

        def get_cell(field, default=''):
            idx = col_map.get(field)
            if idx is not None and idx < len(cells):
                return cells[idx].replace('\\|', '|')
            return default

        id_str = get_cell('id', '')
        try:
            item_id = int(id_str) if id_str else max_id + 1
        except (ValueError, TypeError):
            item_id = max_id + 1
        max_id = max(max_id, item_id)

        impact_type_raw = get_cell('impact_type', 'Went Well')
        # Try a case-insensitive match against valid options
        impact_type = next(
            (v for v in valid_impact_types if v.lower() == impact_type_raw.lower()),
            impact_type_raw if impact_type_raw else 'Went Well'
        )

        items.append({
            'id': item_id,
            'project_manager': get_cell('project_manager', ''),
            'project_type': get_cell('project_type', ''),
            'technology': get_cell('technology', ''),
            'project_phase': get_cell('project_phase', ''),
            'area': get_cell('area', ''),
            'impact_type': impact_type,
            'observation': get_cell('observation', ''),
            'impact': get_cell('impact', ''),
            'recommendations': get_cell('recommendations', ''),
            'date': get_cell('date', ''),
        })

    return items


def generate_lessons_text(lessons_items: list) -> str:
    """Generate a formatted markdown table from lessons learned items.

    Each column is padded to the width of its widest entry for clean,
    readable markdown output.

    Args:
        lessons_items: List of dicts with all lessons learned fields.

    Returns:
        The formatted markdown table string, or an empty string if there
        are no items.
    """
    if not lessons_items:
        return ''

    headers = ['ID', 'Project Manager', 'Project Type', 'Technology',
               'Project Phase', 'Area', 'Impact Type', 'Observation',
               'Impact', 'Recommendations', 'Date']

    def escape_pipe(value):
        return str(value).replace('|', '\\|').replace('\n', ' ')

    rows = []
    for item in lessons_items:
        rows.append([
            escape_pipe(str(item.get('id', ''))),
            escape_pipe(item.get('project_manager', '')),
            escape_pipe(item.get('project_type', '')),
            escape_pipe(item.get('technology', '')),
            escape_pipe(item.get('project_phase', '')),
            escape_pipe(item.get('area', '')),
            escape_pipe(item.get('impact_type', '')),
            escape_pipe(item.get('observation', '')),
            escape_pipe(item.get('impact', '')),
            escape_pipe(item.get('recommendations', '')),
            escape_pipe(item.get('date', '')),
        ])

    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def format_row(cells):
        padded = [cell.ljust(widths[i]) for i, cell in enumerate(cells)]
        return '| ' + ' | '.join(padded) + ' |'

    separator = '|' + '|'.join('-' * (widths[i] + 2) for i in range(len(headers))) + '|'

    lines = [format_row(headers), separator]
    for row in rows:
        lines.append(format_row(row))

    return '\n'.join(lines)


def update_plan_lessons(plan_text: str, lessons_items: list) -> str:
    """Update plan text with the given lessons learned table.

    Replaces the existing ``---lessons learned---`` section or appends a
    new one after the comms plan.  If *lessons_items* is empty, any
    existing lessons section is removed.  Preserves any baseline and
    whiteboard sections that follow.

    Args:
        plan_text: The full plan text.
        lessons_items: List of lessons learned item dicts.

    Returns:
        Updated plan text.
    """
    # Preserve the baseline and whiteboard sections
    baseline_text = extract_baseline(plan_text)
    whiteboard_text = extract_whiteboard(plan_text)
    base = strip_whiteboard(strip_baseline(strip_lessons(plan_text))).rstrip('\n')
    table = generate_lessons_text(lessons_items)

    result = base
    if table:
        result = result + '\n\n' + LESSONS_START + '\n' + table

    if baseline_text:
        result = result.rstrip('\n') + '\n\n' + BASELINE_START + '\n' + baseline_text

    if whiteboard_text:
        result = result.rstrip('\n') + '\n\n' + WHITEBOARD_START + '\n' + whiteboard_text

    return result


# =====================================================================
# Whiteboard (issue #844)
#
# The whiteboard view (#840) lets a user drag summary tasks onto a free
# canvas as notes with a position, colour, and size. That layout is plan
# data, not a UI preference, so it round-trips through the plan text the
# same way every other back-matter section does: a marker followed by a
# Markdown table, columns matched by name.
#
# The section is round-tripped using the marker ``---whiteboard---``
# followed by a table with columns:
#
#   Task | X | Y | Colour | Width | Height | Collapsed
#
# ``Task`` names a summary task by name. ``X``/``Y`` are integer board
# coordinates in unzoomed CSS pixels, origin top-left of the board's own
# coordinate space (not the viewport). ``Colour`` is ``#RRGGBB`` or empty
# (empty means inherit the palette). ``Width``/``Height`` are optional;
# empty means the default note size. ``Collapsed`` is ``yes``/``no``.
#
# This module is storage-format only: no canvas, no notes, no rendering.
# See docs/reference/plan-format.rst for the documented format, including
# the orphan-row and duplicate-``Task`` rules implemented by
# ``validate_whiteboard_rows`` below.
# =====================================================================


def extract_whiteboard(text: str) -> str:
    """Extract the whiteboard section text from plan text.

    Returns the raw text between ``---whiteboard---`` and whichever other
    section marker occurs next in the actual text (not just the ones that
    are supposed to follow it in canonical order), or EOF. Returns an
    empty string if no whiteboard section is present.
    """
    start_idx = text.find(WHITEBOARD_START)
    if start_idx == -1:
        return ''

    after_start = start_idx + len(WHITEBOARD_START)
    end_idx = _next_marker_idx(text, after_start, exclude=(WHITEBOARD_START,))

    return text[after_start:end_idx].strip()


def strip_whiteboard(text: str) -> str:
    """Remove the whiteboard section from plan text.

    Returns the plan text without the ``---whiteboard---`` block,
    suitable for passing to the task parser.  Preserves whatever other
    section actually follows the whiteboard section in the text,
    regardless of canonical order.
    """
    start_idx = text.find(WHITEBOARD_START)
    if start_idx == -1:
        return text

    before = _strip_trailing_bare_separator(text[:start_idx])
    end_idx = _next_marker_idx(text, start_idx, exclude=(WHITEBOARD_START,))
    if end_idx < len(text):
        return before + '\n\n' + text[end_idx:]

    return before


def parse_whiteboard_markdown(text: str) -> list:
    """Parse a whiteboard markdown table into a list of note dicts.

    Columns are matched by name, not position: ``Task | X | Y | Colour |
    Width | Height | Collapsed`` in any order, with extra columns
    tolerated and ignored.

    Nothing is ever dropped: a row whose ``Task`` matches no summary task
    (an orphan -- e.g. because the task was renamed by hand) or that
    duplicates another row's ``Task`` is still returned as-is. Use
    ``validate_whiteboard_rows`` to get warnings for those cases; it is up
    to the caller (a future whiteboard view) to decide what to render.

    Args:
        text: Markdown text containing a whiteboard table.

    Returns:
        List of dicts with keys: task, x, y, colour, width, height,
        collapsed. ``width``/``height`` are ``None`` when the column is
        empty or absent, meaning "use the default note size".
    """
    lines = [line.strip() for line in text.split('\n') if line.strip()]

    def parse_row(line):
        """Parse a markdown table row into cells, handling escaped pipes."""
        parts = re.split(r'(?<!\\)\|', line)
        if parts and not parts[0].strip():
            parts = parts[1:]
        if parts and not parts[-1].strip():
            parts = parts[:-1]
        return [cell.strip() for cell in parts]

    # Find the header row: the first table row that has a "task" cell.
    header_index = -1
    headers = []
    for i, line in enumerate(lines):
        if '|' not in line:
            continue
        cells = [c.strip().lower() for c in parse_row(line)]
        if 'task' in cells:
            header_index = i
            headers = cells
            break

    if header_index == -1:
        return []

    aliases = {
        'task': 'task',
        'x': 'x',
        'y': 'y',
        'colour': 'colour',
        'color': 'colour',
        'width': 'width',
        'height': 'height',
        'collapsed': 'collapsed',
    }
    col_map = {}
    for idx, header in enumerate(headers):
        if header in aliases and aliases[header] not in col_map:
            col_map[aliases[header]] = idx

    def safe_int(value, default=0):
        try:
            return int(str(value).strip())
        except (ValueError, TypeError):
            return default

    items = []
    for i in range(header_index + 1, len(lines)):
        line = lines[i]
        if '|' not in line:
            continue
        # Skip separator row (all dashes)
        if line.replace('|', '').replace('-', '').replace(' ', '') == '':
            continue
        if line.lstrip().startswith('//'):
            continue

        cells = parse_row(line)
        if not cells:
            continue

        def get_cell(field, default=''):
            idx = col_map.get(field)
            if idx is not None and idx < len(cells):
                return cells[idx].replace('\\|', '|')
            return default

        task_name = get_cell('task', '')
        if not task_name:
            continue

        width_str = get_cell('width', '').strip()
        height_str = get_cell('height', '').strip()
        collapsed_str = get_cell('collapsed', '').strip().lower()

        items.append({
            'task': task_name,
            'x': safe_int(get_cell('x', '0')),
            'y': safe_int(get_cell('y', '0')),
            'colour': get_cell('colour', ''),
            'width': safe_int(width_str) if width_str else None,
            'height': safe_int(height_str) if height_str else None,
            'collapsed': collapsed_str in ('yes', 'true', '1'),
        })

    return items


def validate_whiteboard_rows(items: list, summary_task_names=None) -> list:
    """Return warnings for orphan and duplicate whiteboard rows.

    Two rules, documented in ``docs/reference/plan-format.rst``:

    * Duplicate ``Task``: keying by name is ambiguous when two summary
      tasks share a name (see issue #838). The rule matches the one
      already documented for dependency name resolution -- the later row
      wins -- and both rows are kept in the file.
    * Orphan ``Task``: a row whose ``Task`` matches no summary task (for
      example because the task was renamed by hand, which looks
      identical to a delete-plus-add) is kept in the file, not rendered,
      and reported here rather than silently dropped.

    Neither rule removes anything from *items* -- this only reports.

    Args:
        items: The list returned by ``parse_whiteboard_markdown``.
        summary_task_names: Iterable of valid summary task names to check
            rows against. If ``None``, orphan checking is skipped (only
            duplicate-``Task`` warnings are returned).

    Returns:
        List of dicts: ``{'type': 'duplicate'|'orphan', 'task': ..., 'message': ...}``.
    """
    # Task is matched case-insensitively, the same as dependency name
    # resolution (see "Resolution rules" in plan-format.rst).
    warnings = []

    name_counts = {}
    for item in items:
        name_counts[item['task'].lower()] = name_counts.get(item['task'].lower(), 0) + 1

    seen_duplicates = set()
    for item in items:
        name = item['task']
        key = name.lower()
        if name_counts.get(key, 0) > 1 and key not in seen_duplicates:
            seen_duplicates.add(key)
            warnings.append({
                'type': 'duplicate',
                'task': name,
                'message': (
                    f"Multiple whiteboard rows reference task '{name}'; "
                    "the later row wins."
                ),
            })

    if summary_task_names is not None:
        valid_names = {n.lower() for n in summary_task_names}
        seen_orphans = set()
        for item in items:
            name = item['task']
            key = name.lower()
            if name and key not in valid_names and key not in seen_orphans:
                seen_orphans.add(key)
                warnings.append({
                    'type': 'orphan',
                    'task': name,
                    'message': (
                        f"Whiteboard row references unknown task '{name}'; "
                        "kept in the file but not rendered."
                    ),
                })

    return warnings


def generate_whiteboard_text(items: list) -> str:
    """Generate a formatted markdown table from whiteboard note items.

    Each column is padded to the width of its widest entry for clean,
    readable markdown output.

    Args:
        items: List of dicts with keys: task, x, y, colour, width,
            height, collapsed. Missing keys default sensibly (0 for x/y,
            empty for colour/width/height, False for collapsed).

    Returns:
        The formatted markdown table string, or empty string if there
        are no items.
    """
    if not items:
        return ''

    headers = ['Task', 'X', 'Y', 'Colour', 'Width', 'Height', 'Collapsed']

    def escape_pipe(value):
        return str(value).replace('|', '\\|').replace('\n', ' ')

    def cell_or_blank(value):
        return '' if value in (None, '') else str(value)

    rows = []
    for item in items:
        rows.append([
            escape_pipe(item.get('task', '')),
            escape_pipe(str(item.get('x', 0))),
            escape_pipe(str(item.get('y', 0))),
            escape_pipe(item.get('colour', '') or ''),
            escape_pipe(cell_or_blank(item.get('width'))),
            escape_pipe(cell_or_blank(item.get('height'))),
            escape_pipe('yes' if item.get('collapsed') else 'no'),
        ])

    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def format_row(cells):
        padded = [cell.ljust(widths[i]) for i, cell in enumerate(cells)]
        return '| ' + ' | '.join(padded) + ' |'

    separator = '|' + '|'.join('-' * (widths[i] + 2) for i in range(len(headers))) + '|'

    lines = [format_row(headers), separator]
    for row in rows:
        lines.append(format_row(row))

    return '\n'.join(lines)


def update_plan_whiteboard(plan_text: str, items: list) -> str:
    """Update plan text with the given whiteboard table.

    Replaces the existing ``---whiteboard---`` section or appends a new
    one at the end of the plan text.  If *items* is empty, any existing
    whiteboard section is removed.  The whiteboard section is canonically
    the last back-matter section (see plan-format.rst), so nothing needs
    to be preserved and re-appended after it.

    Args:
        plan_text: The full plan text.
        items: List of whiteboard note dicts (see ``parse_whiteboard_markdown``).

    Returns:
        Updated plan text.
    """
    base = strip_whiteboard(plan_text).rstrip('\n')
    table = generate_whiteboard_text(items)

    if not table:
        return base

    return base + '\n\n' + WHITEBOARD_START + '\n' + table
