"""Convert between different task file formats."""

import re


def convert_plan_format_to_standard(text: str) -> str:
    """Convert plan.md format to standard natural language format.

    Conversions:
    - Strip YAML front matter (between --- markers)
    - Convert "3days" to "3d", "2weeks" to "2w", etc.
    - Convert [depends taskname] to #taskname
    - Convert multi-word task names to snake_case
    - Keep @ for resources
    - Keep % for completion
    - Keep !" for comments
    """
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
        # Support multiple comma-separated dependencies
        def convert_depends(match):
            depends_str = match.group(1).strip()
            # Split by comma to handle multiple dependencies
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

            duration_match = re.search(r'\d+[dwm]', stripped)
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
