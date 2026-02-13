"""Convert between different task file formats."""

import re
import yaml

HIGHLIGHTS_START = '---highlights---'
HIGHLIGHTS_END = '---end-highlights---'


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
            if isinstance(frontmatter, dict) and 'title' in frontmatter:
                title = frontmatter['title']
                # Ensure we return a string, not None or other types
                if title is not None:
                    return str(title)
        except Exception as e:
            # Invalid YAML should return None
            pass

    return None


def convert_plan_format_to_standard(text: str) -> str:
    """Convert plan.md format to standard natural language format.

    Conversions:
    - Strip YAML front matter (between --- markers)
    - Strip highlights section (---highlights--- / ---end-highlights---)
    - Convert "3days" to "3d", "2weeks" to "2w", etc.
    - Convert [depends taskname] to #taskname
    - Convert multi-word task names to snake_case
    - Keep @ for resources
    - Keep % for completion
    - Keep !" for comments
    """
    # Strip highlights section before processing
    text = strip_highlights(text)
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

        # Convert dependency format: [depends taskname] or [depends task1, task2] -> #taskname or #task1 #task2
        # BUT: Keep [depends] syntax if any dependency has lag/lead time (e.g., +2d, -1w)
        # Support multiple comma-separated dependencies
        def convert_depends(match):
            depends_str = match.group(1).strip()

            # Check if any dependency has lag/lead time
            has_lag_lead = bool(re.search(r'[+\-]\d+[dwmy]', depends_str))

            if has_lag_lead:
                # Keep [depends ...] syntax for lag/lead support
                return f'[depends {depends_str}]'

            # Split by comma to handle multiple dependencies (no lag/lead)
            task_names = [name.strip() for name in depends_str.split(',')]
            # Convert each task name to #taskname format (preserve spaces, don't convert to snake_case)
            result = ' '.join(f'#{name}' for name in task_names)
            return result

        line = re.sub(r'\[depends\s+([^\]]+)\]', convert_depends, line, flags=re.IGNORECASE)

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

    Parses the ---highlights--- / ---end-highlights--- section and returns
    a list of highlight dictionaries with date, author, and content fields.

    Returns:
        List of dicts: [{'date': '2026-02-13', 'author': 'Alice', 'content': '...'}]
    """
    start_idx = text.find(HIGHLIGHTS_START)
    if start_idx == -1:
        return []

    end_idx = text.find(HIGHLIGHTS_END, start_idx)
    if end_idx == -1:
        return []

    section = text[start_idx + len(HIGHLIGHTS_START):end_idx]
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
    that precedes the highlights section.
    """
    start_idx = text.find(HIGHLIGHTS_START)
    if start_idx == -1:
        return text

    end_idx = text.find(HIGHLIGHTS_END, start_idx)
    if end_idx == -1:
        return text

    before = text[:start_idx].rstrip('\n')
    after = text[end_idx + len(HIGHLIGHTS_END):].lstrip('\n')

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
    lines.append(HIGHLIGHTS_END)
    return '\n'.join(lines)


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
    base = strip_highlights(plan_text).rstrip('\n')
    section = generate_highlights_text(highlights)

    if not section:
        return base

    return base + '\n\n---\n\n' + section
