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
BENEFITS_START = '---benefits---'


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
    # Strip highlights, budget, RAID log, comms, and baseline sections before processing
    text = strip_highlights(text)
    text = strip_budget(text)
    text = strip_raid_log(text)
    text = strip_comms(text)
    text = strip_benefits(text)
    text = strip_baseline(text)
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

    # Find the end: explicit end marker, budget, raid log section, comms, baseline, or EOF
    end_idx = len(text)
    for marker in (HIGHLIGHTS_END, BUDGET_START, BENEFITS_START, RAID_LOG_START, COMMS_START, BASELINE_START):
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

    # Find the end: explicit end marker, budget, raid log section, comms, baseline, or EOF
    end_idx = len(text)
    end_len = 0
    for marker in (HIGHLIGHTS_END, BUDGET_START, BENEFITS_START, RAID_LOG_START, COMMS_START, BASELINE_START):
        idx = text.find(marker, after_start)
        if idx != -1 and idx < end_idx:
            end_idx = idx
            # Only consume the end-highlights marker, not the raid log or
            # baseline markers so their strippers can still find them
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
    # Preserve any existing budget, benefits, RAID log, comms, and baseline that follow highlights
    budget_text = extract_budget(plan_text)
    benefits_text = extract_benefits(plan_text)
    raid_log_text = extract_raid_log(plan_text)
    comms_text = extract_comms_plan(plan_text)
    baseline_text = extract_baseline(plan_text)
    base = strip_baseline(strip_comms(strip_raid_log(strip_benefits(strip_budget(strip_highlights(plan_text)))))).rstrip('\n')
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

    # Re-append the baseline if it was present
    if baseline_text:
        result = result.rstrip('\n') + '\n\n' + BASELINE_START + '\n' + baseline_text

    return result


def extract_raid_log(text: str) -> str:
    """Extract the RAID log section text from plan text.

    Returns the raw text between ``---raid log---`` and the next section
    marker (``---budget---``, ``---baseline---``) or EOF, or an empty
    string if no RAID log section is present.
    """
    start_idx = text.find(RAID_LOG_START)
    if start_idx == -1:
        return ''

    after_start = start_idx + len(RAID_LOG_START)

    # Find the end: budget, comms, baseline section, or EOF
    end_idx = len(text)
    for marker in (BUDGET_START, COMMS_START, BASELINE_START):
        idx = text.find(marker, after_start)
        if idx != -1 and idx < end_idx:
            end_idx = idx

    return text[after_start:end_idx].strip()


def strip_raid_log(text: str) -> str:
    """Remove the RAID log section from plan text.

    Returns the plan text without the ``---raid log---`` block,
    suitable for passing to the task parser.  Preserves any budget
    or baseline section that follows the RAID log.
    """
    start_idx = text.find(RAID_LOG_START)
    if start_idx == -1:
        return text

    before = text[:start_idx].rstrip('\n')

    # Preserve sections that follow the RAID log (budget, comms, or baseline)
    for marker in (BUDGET_START, COMMS_START, BASELINE_START):
        idx = text.find(marker, start_idx)
        if idx != -1:
            after = text[idx:]
            return before + '\n\n' + after

    return before


def extract_budget(text: str) -> str:
    """Extract the budget section text from plan text.

    Returns the raw text between ``---budget---`` and the next section
    marker (``---raid log---``, ``---baseline---``) or EOF, or an empty
    string if no budget section is present.
    """
    start_idx = text.find(BUDGET_START)
    if start_idx == -1:
        return ''

    after_start = start_idx + len(BUDGET_START)

    # Find the end: benefits, RAID log, comms, baseline, or EOF
    end_idx = len(text)
    for marker in (BENEFITS_START, RAID_LOG_START, COMMS_START, BASELINE_START):
        idx = text.find(marker, after_start)
        if idx != -1 and idx < end_idx:
            end_idx = idx

    return text[after_start:end_idx].strip()


def strip_budget(text: str) -> str:
    """Remove the budget section from plan text.

    Returns the plan text without the ``---budget---`` block.
    Preserves any RAID log and baseline sections that follow.
    """
    start_idx = text.find(BUDGET_START)
    if start_idx == -1:
        return text

    before = text[:start_idx].rstrip('\n')

    # Preserve sections that follow the budget
    for marker in (BENEFITS_START, RAID_LOG_START, COMMS_START, BASELINE_START):
        idx = text.find(marker, start_idx)
        if idx != -1:
            after = text[idx:]
            return before + '\n\n' + after

    return before


def extract_benefits(text: str) -> str:
    """Extract the benefits section text from plan text.

    Returns the raw text between ``---benefits---`` and the next section
    marker or EOF, or an empty string if no benefits section is present.
    """
    start_idx = text.find(BENEFITS_START)
    if start_idx == -1:
        return ''

    after_start = start_idx + len(BENEFITS_START)

    end_idx = len(text)
    for marker in (RAID_LOG_START, COMMS_START, BASELINE_START):
        idx = text.find(marker, after_start)
        if idx != -1 and idx < end_idx:
            end_idx = idx

    return text[after_start:end_idx].strip()


def strip_benefits(text: str) -> str:
    """Remove the benefits section from plan text.

    Returns the plan text without the ``---benefits---`` block.
    Preserves any RAID log, comms, and baseline sections that follow.
    """
    start_idx = text.find(BENEFITS_START)
    if start_idx == -1:
        return text

    before = text[:start_idx].rstrip('\n')

    # Preserve sections that follow the benefits
    for marker in (RAID_LOG_START, COMMS_START, BASELINE_START):
        idx = text.find(marker, start_idx)
        if idx != -1:
            after = text[idx:]
            return before + '\n\n' + after

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
    existing RAID log section is removed.  Preserves any baseline
    section that follows.

    Args:
        plan_text: The full plan text.
        raid_items: List of RAID item dicts.

    Returns:
        Updated plan text.
    """
    # Preserve the comms and baseline sections
    comms_text = extract_comms_plan(plan_text)
    baseline_text = extract_baseline(plan_text)
    base = strip_baseline(strip_comms(strip_raid_log(plan_text))).rstrip('\n')
    table = generate_raid_log_text(raid_items)

    result = base
    if table:
        result = result + '\n\n' + RAID_LOG_START + '\n' + table

    # Re-append the comms plan if it was present
    if comms_text:
        result = result.rstrip('\n') + '\n\n' + COMMS_START + '\n' + comms_text

    # Re-append the baseline if it was present
    if baseline_text:
        result = result.rstrip('\n') + '\n\n' + BASELINE_START + '\n' + baseline_text

    return result


def extract_comms_plan(text: str) -> str:
    """Extract the comms plan section text from plan text.

    Returns the raw text between ``---comms---`` and the next section
    marker (``---baseline---``) or EOF, or an empty string if no comms
    section is present.
    """
    start_idx = text.find(COMMS_START)
    if start_idx == -1:
        return ''

    after_start = start_idx + len(COMMS_START)

    # Find the end: baseline section or EOF
    end_idx = len(text)
    baseline_idx = text.find(BASELINE_START, after_start)
    if baseline_idx != -1 and baseline_idx < end_idx:
        end_idx = baseline_idx

    return text[after_start:end_idx].strip()


def strip_comms(text: str) -> str:
    """Remove the comms plan section from plan text.

    Returns the plan text without the ``---comms---`` block.
    Preserves any baseline section that follows.
    """
    start_idx = text.find(COMMS_START)
    if start_idx == -1:
        return text

    before = text[:start_idx].rstrip('\n')

    # Preserve the baseline section if it follows
    baseline_idx = text.find(BASELINE_START, start_idx)
    if baseline_idx != -1:
        after = text[baseline_idx:]
        return before + '\n\n' + after

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
    existing comms section is removed.  Preserves any baseline
    section that follows.

    Args:
        plan_text: The full plan text.
        comms_items: List of comms item dicts.

    Returns:
        Updated plan text.
    """
    # Preserve the baseline section
    baseline_text = extract_baseline(plan_text)
    base = strip_baseline(strip_comms(plan_text)).rstrip('\n')
    table = generate_comms_plan_text(comms_items)

    result = base
    if table:
        result = result + '\n\n' + COMMS_START + '\n' + table

    # Re-append the baseline if it was present
    if baseline_text:
        result = result.rstrip('\n') + '\n\n' + BASELINE_START + '\n' + baseline_text

    return result


def extract_baseline(text: str) -> str:
    """Extract the baseline section text from plan text.

    Returns the raw text between ``---baseline---`` and EOF,
    or an empty string if no baseline section is present.
    """
    start_idx = text.find(BASELINE_START)
    if start_idx == -1:
        return ''

    after_start = start_idx + len(BASELINE_START)
    return text[after_start:].strip()


def strip_baseline(text: str) -> str:
    """Remove the baseline section from plan text.

    Returns the plan text without the ``---baseline---`` block.
    """
    start_idx = text.find(BASELINE_START)
    if start_idx == -1:
        return text

    before = text[:start_idx].rstrip('\n')
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

    Args:
        plan_text: The full plan text.
        baseline_items: List of baseline item dicts.

    Returns:
        Updated plan text.
    """
    # Preserve the comms section when updating baseline
    base = strip_baseline(plan_text).rstrip('\n')
    table = generate_baseline_text(baseline_items)

    if not table:
        return base

    return base + '\n\n' + BASELINE_START + '\n' + table


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

    Returns the raw text between ``---benefits---`` and the next section
    marker or EOF, or an empty string if no benefits section is present.
    """
    start_idx = text.find(BENEFITS_START)
    if start_idx == -1:
        return ''

    after_start = start_idx + len(BENEFITS_START)

    # Find the end: next section marker or EOF
    end_idx = len(text)
    for marker in (RAID_LOG_START, COMMS_START, BASELINE_START):
        idx = text.find(marker, after_start)
        if idx != -1 and idx < end_idx:
            end_idx = idx

    return text[after_start:end_idx].strip()


def strip_benefits(text: str) -> str:
    """Remove the benefits section from plan text.

    Returns the plan text without the ``---benefits---`` block.
    """
    start_idx = text.find(BENEFITS_START)
    if start_idx == -1:
        return text

    before = text[:start_idx].rstrip('\n')

    # Preserve any section that follows the benefits block
    after_start = start_idx + len(BENEFITS_START)
    for marker in (RAID_LOG_START, COMMS_START, BASELINE_START):
        idx = text.find(marker, after_start)
        if idx != -1:
            after = text[idx:]
            return before + '\n\n' + after

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
