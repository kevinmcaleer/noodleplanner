"""Convert between different task file formats."""

import re
import yaml

HIGHLIGHTS_START = '---highlights---'
HIGHLIGHTS_END = '---end-highlights---'
RAID_LOG_START = '---raid log---'


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
    # Strip highlights and RAID log sections before processing
    text = strip_highlights(text)
    text = strip_raid_log(text)
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

            # Find where the metadata starts (@, #, %, number, date)
            metadata_start = len(stripped)
            for char in ['@', '%', '#', '!']:
                pos = stripped.find(char)
                if pos > 0:  # pos > 0 to ensure there's a task name before it
                    metadata_start = min(metadata_start, pos)

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

    # Find the end: explicit end marker, raid log section, or EOF
    end_idx = len(text)
    for marker in (HIGHLIGHTS_END, RAID_LOG_START):
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

    # Find the end: explicit end marker, raid log section, or EOF
    end_idx = len(text)
    end_len = 0
    for marker in (HIGHLIGHTS_END, RAID_LOG_START):
        idx = text.find(marker, after_start)
        if idx != -1 and idx < end_idx:
            end_idx = idx
            # Only consume the end-highlights marker, not the raid log marker
            # so strip_raid_log can still find it
            end_len = len(marker) if marker == HIGHLIGHTS_END else 0

    before = text[:start_idx].rstrip('\n')
    after = text[end_idx + end_len:].lstrip('\n')

    # Remove trailing --- separator that precedes the highlights section
    lines = before.split('\n')
    while lines and lines[-1].strip() == '---':
        lines.pop()
    before = '\n'.join(lines).rstrip('\n')

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
    # Preserve any existing RAID log that follows highlights
    raid_log_text = extract_raid_log(plan_text)
    base = strip_raid_log(strip_highlights(plan_text)).rstrip('\n')
    section = generate_highlights_text(highlights)

    if not section:
        result = base
    else:
        result = base + '\n\n---\n\n' + section

    # Re-append the RAID log if it was present
    if raid_log_text:
        result = result.rstrip('\n') + '\n\n' + RAID_LOG_START + '\n' + raid_log_text
    return result


def extract_raid_log(text: str) -> str:
    """Extract the RAID log section text from plan text.

    Returns the raw text between ``---raid log---`` and EOF,
    or an empty string if no RAID log section is present.
    """
    start_idx = text.find(RAID_LOG_START)
    if start_idx == -1:
        return ''

    after_start = start_idx + len(RAID_LOG_START)
    return text[after_start:].strip()


def strip_raid_log(text: str) -> str:
    """Remove the RAID log section from plan text.

    Returns the plan text without the ``---raid log---`` block,
    suitable for passing to the task parser.
    """
    start_idx = text.find(RAID_LOG_START)
    if start_idx == -1:
        return text

    before = text[:start_idx].rstrip('\n')
    return before


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
        owner, mitigation_actions, impact, likelihood, score, status

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
        # Remove first and last empty elements (before first | and after last |)
        cells = [cell.strip() for cell in parts if cell.strip()]
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
        'status': 'status'
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
        }
        items.append(item)

    return items


def generate_raid_log_text(raid_items: list) -> str:
    """Generate a formatted markdown table from RAID items.

    Each column is padded to the width of its widest entry for
    clean, readable markdown output.

    Args:
        raid_items: List of dicts with keys: type, title, status,
            score, owner, date.  Missing keys default to empty strings.

    Returns:
        The formatted markdown table string, or empty string if
        there are no items.
    """
    if not raid_items:
        return ''

    headers = ['Type', 'Description', 'Status', 'Score', 'Owner', 'Date']

    def escape_pipe(value):
        return str(value).replace('|', '\\|').replace('\n', ' ')

    rows = []
    for item in raid_items:
        rows.append([
            escape_pipe(item.get('type', '')),
            escape_pipe(item.get('title', '')),
            escape_pipe(item.get('status', '')),
            escape_pipe(str(item.get('score', ''))),
            escape_pipe(item.get('owner', '')),
            escape_pipe(item.get('date', '')),
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
    existing RAID log section is removed.

    Args:
        plan_text: The full plan text.
        raid_items: List of RAID item dicts.

    Returns:
        Updated plan text.
    """
    base = strip_raid_log(plan_text).rstrip('\n')
    table = generate_raid_log_text(raid_items)

    if not table:
        return base

    return base + '\n\n' + RAID_LOG_START + '\n' + table
