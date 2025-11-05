import yaml
import re
from datetime import datetime, timedelta
from dateutil.parser import parse as parse_date
import sys
import logging

logger = logging.getLogger(__name__)

DURATION_REGEX = re.compile(r"P(?:\d+D)?(?:\d+H)?(?:\d+M)?(?:\d+S)?")

def parse_duration(s):
    if not s:
        return None
    try:
        # Only support days for simplicity
        if s.startswith('P') and 'D' in s:
            days = int(s.split('P')[1].split('D')[0])
            return timedelta(days=days)
        # Could add more parsing for H/M/S
    except Exception:
        pass
    return None
def extract_metadata(task_str, task_name=None):
    meta = {}
    tokens = re.split(r'(?<!\\)\s+', task_str)
    resources = [t for t in tokens if t.startswith('@')]
    if resources:
        meta['resources'] = ', '.join([r.lstrip('@') for r in resources])
    dependencies = [t[1:] for t in tokens if t.startswith('#')]
    if dependencies:
        meta['depends'] = dependencies
    if task_name:
        meta['name'] = task_name
    if str(task_str).startswith('*'):
        meta['sequential'] = True
    comment_match = re.search(r'!(?:"([^"]+)"|\'([^\']+)\')', task_str)
    if comment_match:
        meta['comment'] = comment_match.group(1) if comment_match.group(1) is not None else comment_match.group(2)

    # Support both new format (10%) and old format (p10)
    percent_match = re.search(r'(\d{1,3})%', task_str)
    if percent_match:
        meta['percent'] = int(percent_match.group(1))
    else:
        # Fall back to old format
        percent_match = re.search(r'\bp(\d{1,3})\b', task_str)
        if percent_match:
            meta['percent'] = int(percent_match.group(1))

    date_match = re.search(r'(\d{4}-\d{2}-\d{2})', task_str)
    if date_match:
        meta['due'] = date_match.group(1)
        meta['start'] = parse_date(date_match.group(1))

    # Support new simple format: 10d, 2w, 3m
    duration_match = re.search(r'\b(\d+)([dwm])\b', task_str)
    if duration_match:
        value = int(duration_match.group(1))
        unit = duration_match.group(2)
        if unit == 'd':
            meta['duration'] = timedelta(days=value)
        elif unit == 'w':
            meta['duration'] = timedelta(weeks=value)
        elif unit == 'm':
            meta['duration'] = timedelta(days=value * 30)  # Approximate month as 30 days
    else:
        # Fall back to old format :p10d
        duration_match = re.search(r':p(\d+)d', task_str)
        if duration_match:
            meta['duration'] = timedelta(days=int(duration_match.group(1)))

    desc_match = re.match(r"\*?(.*?)(@|#|!|\d{4}-\d{2}-\d{2}|:p\d+d|\d+[dwm]|\d+%|$)", task_str)
    if desc_match:
        meta['description'] = desc_match.group(1).strip()
    return meta
    # Task number
    num_match = re.match(r"\s*[\*]?\s*([0-9]+)\. ", task_str)
    if num_match:
        meta['number'] = int(num_match.group(1))
    # Description
    desc_match = re.match(r"\s*[\*]?\s*\d+\. ([^,]+)", task_str)
    if desc_match:
        meta['description'] = desc_match.group(1).strip()
    return meta
def schedule_tasks(phases):
    """Schedule tasks from arbitrarily nested structure.

    Args:
        phases: Nested dict structure from natural_language_to_yaml or YAML.
                Leaf tasks have {'_text': str, '_level': int}
                Summary tasks have nested dicts with '_level' and '_is_summary' markers

    Returns:
        List of tasks, each with: name, description, level, resources, start, finish,
        duration, percent, comment, summary (bool), parent, phase
    """
    all_tasks = []

    def traverse_nested_dict(node, parent_name=None, parent_level=-1):
        """Recursively traverse nested dict and extract tasks."""
        if isinstance(node, list):
            # Handle list of dicts at top level
            for item in node:
                traverse_nested_dict(item, parent_name, parent_level)
            return

        if not isinstance(node, dict):
            return

        # Check if this is a leaf task
        if '_text' in node:
            # Leaf task - extract metadata
            task_name = None
            for key in node.keys():
                if key not in ('_text', '_level'):
                    task_name = key
                    break

            text = node['_text']
            level = node.get('_level', parent_level + 1)

            # Extract task name from text if not already set
            if not task_name:
                parts = text.split()
                if parts:
                    task_name = parts[0].lstrip('*')
                else:
                    task_name = text

            meta = extract_metadata(text, task_name)
            meta['level'] = level
            meta['parent'] = parent_name
            meta['phase'] = parent_name or ''
            meta['summary'] = False
            all_tasks.append(meta)
            return

        # This is a summary task with children
        is_summary = node.get('_is_summary', False)
        level = node.get('_level', parent_level + 1)

        # Process each child
        for key, value in node.items():
            if key.startswith('_'):
                continue

            # Check if child is a leaf or summary
            if isinstance(value, dict):
                if '_text' in value:
                    # Leaf task
                    meta = extract_metadata(value['_text'], key)
                    meta['level'] = value.get('_level', level + 1)
                    meta['parent'] = parent_name
                    meta['phase'] = parent_name or ''
                    meta['summary'] = False
                    all_tasks.append(meta)
                elif '_is_summary' in value or any(isinstance(v, dict) for v in value.values()):
                    # Summary task with children
                    summary_meta = {
                        'name': key,
                        'description': key,
                        'level': value.get('_level', level + 1),
                        'parent': parent_name,
                        'phase': parent_name or '',
                        'summary': True,
                        'resources': '',
                        'percent': 0,
                        'comment': ''
                    }
                    all_tasks.append(summary_meta)
                    # Recursively process children
                    traverse_nested_dict(value, parent_name=key, parent_level=value.get('_level', level + 1))
                else:
                    # Single key-value that might be a simple dict
                    traverse_nested_dict(value, parent_name=key, parent_level=level + 1)

    # Start traversal
    if isinstance(phases, list):
        traverse_nested_dict(phases)
    else:
        traverse_nested_dict(phases)

    # Schedule leaf tasks (non-summary tasks)
    name_lookup = {t['name']: t for t in all_tasks if 'name' in t}

    for idx, t in enumerate(all_tasks):
        # Skip summary tasks - their dates will be calculated from children
        if t.get('summary'):
            continue

        # Apply scheduling logic
        if t.get('sequential'):
            # Find previous non-summary task at same level or with same parent
            prev = None
            for j in range(idx - 1, -1, -1):
                if (all_tasks[j].get('parent') == t.get('parent') and
                    not all_tasks[j].get('summary')):
                    prev = all_tasks[j]
                    break

            if prev and 'finish' in prev:
                t['start'] = prev['finish']
            else:
                t['start'] = datetime.now()
            t['finish'] = t['start'] + (t.get('duration') or timedelta(days=1))

        elif 'start' in t:
            # Has explicit start date
            t['finish'] = t['start'] + (t.get('duration') or timedelta(days=1))

        elif 'depends' in t and t['depends']:
            # Has dependencies
            dep_finishes = [name_lookup[n]['finish'] for n in t['depends']
                          if n in name_lookup and 'finish' in name_lookup[n]]
            if dep_finishes:
                t['start'] = max(dep_finishes)
            else:
                t['start'] = datetime.now()
            t['finish'] = t['start'] + (t.get('duration') or timedelta(days=1))

        else:
            # Default: start after previous task
            if idx > 0 and 'finish' in all_tasks[idx - 1]:
                t['start'] = all_tasks[idx - 1]['finish']
            else:
                t['start'] = datetime.now()
            t['finish'] = t['start'] + (t.get('duration') or timedelta(days=1))

        # Ensure duration is set
        if 'duration' not in t or not t['duration']:
            t['duration'] = timedelta(days=1)

    # Calculate summary task dates from children
    def calculate_summary_dates(task_name):
        """Calculate start/finish for a summary task from its children."""
        children = [t for t in all_tasks if t.get('parent') == task_name]
        if not children:
            return

        # Recursively calculate for any summary children first
        for child in children:
            if child.get('summary'):
                calculate_summary_dates(child['name'])

        # Get the summary task
        summary_task = next((t for t in all_tasks if t.get('name') == task_name and t.get('summary')), None)
        if not summary_task:
            return

        # Calculate from children's dates
        starts = [c['start'] for c in children if 'start' in c]
        finishes = [c['finish'] for c in children if 'finish' in c]

        if starts and finishes:
            summary_task['start'] = min(starts)
            summary_task['finish'] = max(finishes)
            summary_task['duration'] = summary_task['finish'] - summary_task['start']

            # Calculate average percent complete
            percents = [c.get('percent', 0) for c in children]
            if percents:
                summary_task['percent'] = int(sum(percents) / len(percents))

    # Calculate dates for all summary tasks
    for t in all_tasks:
        if t.get('summary'):
            calculate_summary_dates(t['name'])

    # Re-order tasks so summary tasks appear immediately before their children
    def build_ordered_list():
        """Build properly ordered list with summary tasks before children."""
        ordered = []
        processed = set()

        def add_task_and_children(task):
            """Recursively add task and its children in order."""
            if task['name'] in processed:
                return
            processed.add(task['name'])

            # Add the task itself
            ordered.append(task)

            # If it's a summary task, add its children
            if task.get('summary'):
                children = [t for t in all_tasks if t.get('parent') == task['name']]
                # Sort children to maintain original order
                for child in children:
                    add_task_and_children(child)

        # Start with top-level tasks (no parent)
        top_level = [t for t in all_tasks if not t.get('parent')]
        for task in top_level:
            add_task_and_children(task)

        return ordered

    return build_ordered_list()

# --- Gantt chart rendering ---
def render_gantt_chart(tasks, start_date, finish_date, width=80):
    chart = "# Gantt Chart\n\n```\n"
    total_days = (finish_date - start_date).days or 1
    # Determine max ID width - use numeric IDs
    max_id_width = max(len(str(len(tasks))), 2)

    # Determine max task name width - use full length of longest task name
    max_name_width = max([len(t.get('description', '')) for t in tasks] + [20])

    # Week heading row
    week_row = [' '] * width
    week_dates = []
    current = start_date
    while current <= finish_date:
        pos = int((current - start_date).days / total_days * (width-1))
        date_str = current.strftime('%d %b')
        for i, c in enumerate(date_str):
            if pos + i < width:
                week_row[pos + i] = c
        week_dates.append(current)
        current += timedelta(days=7)
    chart += f"{'ID':<{max_id_width}}  {'Task Name':<{max_name_width}} |" + ''.join(week_row) + '|\n'
    chart += '-' * (max_id_width + 2 + max_name_width + 1 + width) + '\n'  # Adjust horizontal line
    for idx, t in enumerate(tasks, start=1):
        # Skip tasks without start or finish dates
        if 'start' not in t or 'finish' not in t:
            continue
        bar_start = int((t['start'] - start_date).days / total_days * (width-1))
        bar_end = int((t['finish'] - start_date).days / total_days * (width-1))
        line = [' '] * width
        percent = t.get('percent', 0)

        # Calculate indentation based on level (0=no indent, 1=4 spaces, 2=8 spaces, etc.)
        level = t.get('level', 0)
        indent = '    ' * (level - 1) if level > 0 else ''

        if t.get('summary'):
            # Summary task: use [ and ] for boundaries, show progress
            if bar_start < width:
                line[bar_start] = '['
            if bar_end < width:
                line[bar_end] = ']'
            progress_end = bar_start + int((bar_end - bar_start) * percent / 100)
            for i in range(bar_start + 1, bar_end):
                if i <= progress_end:
                    line[i] = '='
                else:
                    line[i] = '-'
        else:
            # Regular task: show progress with '=' and '-' based on percent
            progress_end = bar_start + int((bar_end - bar_start) * percent / 100)
            for i in range(bar_start, bar_end+1):
                if i < width:
                    if i <= progress_end:
                        line[i] = '='
                    else:
                        line[i] = '-'
        # Use numeric ID
        task_id = str(idx)
        label = f"{indent}{t.get('description','')}"

        # Make summary tasks stand out visually
        if t.get('summary'):
            # Use uppercase for summary task labels
            label = label.upper()

        line_str = ''.join(line)
        chart += f"{task_id:<{max_id_width}}  {label:<{max_name_width}} |{line_str}|\n"
    chart += "```\n"
    return chart
def render_custom_timeline(phases, milestones, start_date, finish_date, timeline_width=80):
    # Timeline line
    timeline = ['-'] * timeline_width
    milestone_labels = []
    milestone_dates = [' '] * timeline_width
    milestone_full_dates = []
    all_items = []
    # Add start milestone
    all_items.append({'type': 'milestone', 'name': 'Start', 'date': start_date})
    # Add phases
    for phase in phases:
        all_items.append({'type': 'phase', 'name': phase['name'], 'date': phase['start']})
    # Add milestones
    for milestone in milestones:
        all_items.append({'type': 'milestone', 'name': milestone['name'], 'date': milestone['date']})
    # Add finish milestone
    all_items.append({'type': 'milestone', 'name': 'Finish', 'date': finish_date})
    # Sort by date
    all_items.sort(key=lambda x: x['date'])
    # Place symbols, milestone titles, and dates
    for item in all_items:
        pos = int((item['date'] - start_date).days / (finish_date - start_date).days * (timeline_width - 1))
        if item['type'] == 'milestone':
            symbol = '◆'
            timeline[pos] = symbol
            # Place milestone label on its own line
            label_line = [' '] * timeline_width
            title = item['name']
            # If label would overflow, right-align it
            if pos + len(title) > timeline_width:
                start_pos = max(0, timeline_width - len(title))
            else:
                start_pos = pos
            for i, c in enumerate(title):
                if start_pos + i < timeline_width:
                    label_line[start_pos + i] = c
            milestone_labels.append(''.join(label_line))
            # Place milestone date (for timeline line)
            if item['date'].year == start_date.year and item['date'].year == finish_date.year:
                date_str = item['date'].strftime('%-d %b')
            else:
                date_str = item['date'].strftime('%-d %b %Y')
            for i, c in enumerate(date_str):
                if pos + i < timeline_width:
                    milestone_dates[pos + i] = c
            # Store full date string for label/date pairing
            milestone_full_dates.append(date_str)
    return ''.join(timeline), milestone_labels, ''.join(milestone_dates), milestone_full_dates

def render_timeline(phases, milestones, start_date, finish_date, timeline_width=80):
    # Calculate timeline positions
    timeline = [' '] * timeline_width
    label_line = [' '] * timeline_width
    date_line = [' '] * timeline_width
    date_titles = [' '] * timeline_width
    all_items = []
    # Add start milestone
    all_items.append({'type': 'milestone', 'name': 'Start', 'date': start_date})
    # Add phases
    for phase in phases:
        all_items.append({'type': 'phase', 'name': phase['name'], 'date': phase['start']})
    # Add milestones
    for milestone in milestones:
        all_items.append({'type': 'milestone', 'name': milestone['name'], 'date': milestone['date']})
    # Add finish milestone
    all_items.append({'type': 'milestone', 'name': 'Finish', 'date': finish_date})
    # Sort by date
    all_items.sort(key=lambda x: x['date'])
    # Timeline line
    # Place symbols, labels, and dates
    for item in all_items:
        pos = int((item['date'] - start_date).days / (finish_date - start_date).days * (timeline_width - 1))
        symbol = '●' if item['type'] == 'milestone' else '■'
        timeline[pos] = symbol
        # Place label
        label = item['name']
        for i, c in enumerate(label):
            if pos + i < timeline_width:
                label_line[pos + i] = c
        # Place date (simplified if same year)
        if item['date'].year == start_date.year and item['date'].year == finish_date.year:
            date_str = item['date'].strftime('%-d %b')
        else:
            date_str = item['date'].strftime('%-d %b %Y')
        for i, c in enumerate(date_str):
            if pos + i < timeline_width:
                date_line[pos + i] = c
        # Place title above date
        title = 'Date'
        for i, c in enumerate(title):
            if pos + i < timeline_width:
                date_titles[pos + i] = c
    symbol_line = ''.join(timeline)
    timeline_line = '-' * timeline_width
    # Build timeline output
    timeline_output = (
        f"{timeline_line}\n"
        f"{symbol_line}\n"
        f"{''.join(label_line)}\n"
        f"{''.join(date_titles)}\n"
        f"{''.join(date_line)}\n"
    )
    return timeline_output

def natural_language_to_yaml(text, project_name="Project"):
    """Convert natural language task text to hierarchical structure.

    Supports arbitrary nesting levels via indentation.
    A task without details and with indented tasks below it is a summary task.
    """
    lines = text.split('\n')

    # Build tree structure using a stack
    root = {'children': [], 'indent': -1, 'text': '', 'name': project_name, 'level': 0}
    stack = [root]

    for line in lines:
        if not line.strip():
            continue

        indent_level = len(line) - len(line.lstrip())
        stripped = line.strip()

        # Check if has task details
        has_duration = re.search(r'\b\d+[dwm]\b', stripped) is not None
        has_details = '@' in stripped or '%' in stripped or '!' in stripped or '#' in stripped or '2025-' in stripped or '2024-' in stripped or '2026-' in stripped or has_duration

        # Extract task name
        parts = stripped.split()
        if not parts:
            continue
        task_name = parts[0].lstrip('*')
        full_name = stripped if not has_details else task_name

        # Create node
        node = {
            'indent': indent_level,
            'text': stripped,
            'name': task_name,
            'full_name': full_name,
            'has_details': has_details,
            'children': [],
            'level': 0
        }

        # Find parent (pop stack until we find item with lower indent)
        while len(stack) > 1 and stack[-1]['indent'] >= indent_level:
            stack.pop()

        parent = stack[-1]
        node['level'] = parent['level'] + 1
        parent['children'].append(node)
        stack.append(node)

    # Convert tree to nested dict structure
    def tree_to_nested_dict(node):
        """Recursively convert tree to nested dicts."""
        if not node['children']:
            # Leaf node - return text with level marker
            return {'_text': node['text'], '_level': node['level']}

        # Has children - create nested dict
        result = {}
        for child in node['children']:
            child_result = tree_to_nested_dict(child)
            if '_text' in child_result:
                # Leaf task
                result[child['name']] = child_result
            else:
                # Summary task with children
                result[child['full_name']] = child_result

        # Mark as summary with level
        result['_level'] = node['level']
        result['_is_summary'] = True
        return result

    result_dict = tree_to_nested_dict(root)
    # Remove root markers
    if '_level' in result_dict:
        del result_dict['_level']
    if '_is_summary' in result_dict:
        del result_dict['_is_summary']

    return {project_name: [result_dict] if result_dict else []}

def calculate_resource_allocation(tasks, start_date, finish_date):
    """Calculate daily resource allocation in hours per day.

    Returns a dict with:
    - resources: list of resource names
    - days: list of dates from start to finish
    - allocation: dict[resource][date] = hours
    """
    from collections import defaultdict

    # Collect all resources
    resources = set()
    for t in tasks:
        res = t.get('resources', '')
        if res:
            for r in res.split(','):
                resources.add(r.strip())

    resources = sorted(list(resources))

    # Generate all days from start to finish
    days = []
    current = start_date
    while current <= finish_date:
        days.append(current)
        current += timedelta(days=1)

    # Calculate allocation for each resource on each day
    allocation = defaultdict(lambda: defaultdict(float))

    for t in tasks:
        task_start = t.get('start')
        task_finish = t.get('finish')
        if not task_start or not task_finish:
            continue

        # Get resources for this task
        res = t.get('resources', '')
        if not res:
            continue

        task_resources = [r.strip() for r in res.split(',')]
        if not task_resources:
            continue

        # Calculate working days for this task (exclude weekends)
        task_days = []
        current = task_start
        while current < task_finish:
            # 0 = Monday, 6 = Sunday
            if current.weekday() < 5:  # Monday-Friday
                task_days.append(current)
            current += timedelta(days=1)

        if not task_days:
            task_days = [task_start]

        # Assume 8 hours per working day, split among resources
        hours_per_day = 8.0 / len(task_resources)

        for resource in task_resources:
            for day in task_days:
                allocation[resource][day] += hours_per_day

    return {
        'resources': resources,
        'days': days,
        'allocation': allocation
    }

def text_to_markdown_table(text, is_yaml=True, project_name="Project"):
    """Convert text (YAML or natural language) to markdown table.

    Args:
        text: Input text (YAML or natural language)
        is_yaml: If True, parse as YAML; if False, parse as natural language
        project_name: Project name to use
    """
    today = datetime.today()

    if is_yaml:
        data = yaml.safe_load(text)
        project_name = list(data.keys())[0]
        phases_raw = data[project_name]
    else:
        # Parse natural language
        data = natural_language_to_yaml(text, project_name)
        phases_raw = data[project_name]

    # If phases_raw is a list, pass as-is; if dict, wrap in a list
    if isinstance(phases_raw, list):
        phases = phases_raw
    elif isinstance(phases_raw, dict):
        phases = [phases_raw]
    else:
        phases = []
    tasks = schedule_tasks(phases)

    # Compute phase timelines
    phase_dates = {}
    for t in tasks:
        phase = t.get('phase')
        start = t.get('start') or today
        finish = t.get('finish') or (start + (t.get('duration') or timedelta(days=1)))
        if phase:
            if phase not in phase_dates:
                phase_dates[phase] = {'start': start, 'end': finish}
            else:
                if start < phase_dates[phase]['start']:
                    phase_dates[phase]['start'] = start
                if finish > phase_dates[phase]['end']:
                    phase_dates[phase]['end'] = finish

    # Markdown table for tasks
    md = f"# {project_name}\n\n| ID | Task Name | Start | Finish | Duration | Resources | % Complete | Comment |\n|----|-----------|-------|--------|----------|-----------|------------|---------|\n"
    for idx, t in enumerate(tasks, start=1):
        start = t.get('start') or today
        finish = t.get('finish') or (start + (t.get('duration') or timedelta(days=1)))
        resources = t.get('resources','')
        if resources:
            resources = ', '.join([r.lstrip('@').strip() for r in resources.split(',')])
        percent = t.get('percent', '')
        comment = t.get('comment','')

        # Use description as task name, fallback to name if no description
        task_name = t.get('description') or t.get('name', '')

        # Make summary task names bold
        if t.get('summary'):
            task_name = f"**{task_name}**"

        # Indent based on level (0=no indent, 1=4 spaces, 2=8 spaces, etc.)
        level = t.get('level', 0)
        if level > 0:
            indent = '&nbsp;' * 4 * level
            task_name = f"{indent}{task_name}"

        md += f"| {idx} | {task_name} | {start.strftime('%Y-%m-%d')} | {finish.strftime('%Y-%m-%d')} | {t.get('duration',timedelta(days=1)).days}d | {resources} | {percent} | {comment} |\n"

    # Timeline output block
    milestones = []
    if phase_dates:
        # Timeline table
        md += "\n# Project Timeline\n\n| Phase | Start | End |\n|-------|-------|-----|\n"
        for phase, dates in phase_dates.items():
            md += f"| {phase} | {dates['start'].strftime('%Y-%m-%d')} | {dates['end'].strftime('%Y-%m-%d')} |\n"
        # Tasks with duration 0 are milestones
        for t in tasks:
            duration = t.get('duration', timedelta(days=1))
            if isinstance(duration, timedelta) and duration.days == 0:
                milestones.append({'name': t.get('description',''), 'date': t.get('start')})
        # End of each phase is a milestone
        for phase, dates in phase_dates.items():
            milestones.append({'name': f"End of {phase}", 'date': dates['end']})
        phase_objs = [{'name': k, 'start': v['start']} for k,v in phase_dates.items()]
        timeline_width = 80
        # Only call min/max if tasks is not empty
        if tasks:
            start_date = min([t.get('start', today) for t in tasks])
            finish_date = max([t.get('finish', today) for t in tasks])
        else:
            start_date = today
            finish_date = today
        # Custom timeline block (header will be rendered below, not here)
        # Timeline line with symbols
        timeline_row, milestone_labels, milestone_dates, milestone_full_dates = render_custom_timeline(phase_objs, milestones, start_date, finish_date, timeline_width)
        # Only show one 'Start' and one 'Finish' label/date above timeline
        # Find unique Start and Finish labels/dates (first and last milestones)
        start_idx = 0
        finish_idx = len(milestone_labels) - 1
        start_date_str = milestone_full_dates[start_idx] if milestone_full_dates else ''
        finish_date_str = milestone_full_dates[finish_idx] if milestone_full_dates else ''
        # Render only one Start and one Finish label/date above timeline
        # Render timeline header only once
        timeline_header = f"{project_name}\nStart{' ' * (timeline_width - 10)}Finish\n{start_date_str}{' ' * (timeline_width - len(start_date_str) - len(finish_date_str))}{finish_date_str}\n"
        md += timeline_header
        md += f"{timeline_row}\n"
        # Show only non-start/finish milestone labels/dates below timeline
        non_sf_labels = []
        for idx, label in enumerate(milestone_labels):
            if idx == start_idx or idx == finish_idx:
                continue
            non_sf_labels.append((idx, label))
        for idx, label in non_sf_labels:
            md += f"{label}\n"
            # Place the full date string for this milestone, right-aligned with the label
            label_end = max([i for i, c in enumerate(label) if c != ' '], default=0)
            date_str = milestone_full_dates[idx] if idx < len(milestone_full_dates) else ''
            date_line = [' '] * timeline_width
            if label_end + len(date_str) > timeline_width:
                start_pos = max(0, timeline_width - len(date_str))
            else:
                start_pos = label_end
            for i, c in enumerate(date_str):
                if start_pos + i < timeline_width:
                    date_line[start_pos + i] = c
            md += f"{''.join(date_line)}\n"
    # Gantt chart output
    timeline_width = 80
    # Only call min/max if tasks is not empty
    if tasks:
        start_date = min([t.get('start', today) for t in tasks])
        finish_date = max([t.get('finish', today) for t in tasks])
    else:
        start_date = today
        finish_date = today
    md += "\n"
    md += render_gantt_chart(tasks, start_date, finish_date, timeline_width)
    return md

def yaml_to_markdown_table(yaml_path):
    today = datetime.today()
    with open(yaml_path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    project_name = list(data.keys())[0]
    phases_raw = data[project_name]
    # If phases_raw is a list, pass as-is; if dict, wrap in a list
    if isinstance(phases_raw, list):
        phases = phases_raw
    elif isinstance(phases_raw, dict):
        phases = [phases_raw]
    else:
        phases = []
    tasks = schedule_tasks(phases)

    # Compute phase timelines
    phase_dates = {}
    for t in tasks:
        phase = t.get('phase')
        start = t.get('start') or today
        finish = t.get('finish') or (start + (t.get('duration') or timedelta(days=1)))
        if phase:
            if phase not in phase_dates:
                phase_dates[phase] = {'start': start, 'end': finish}
            else:
                if start < phase_dates[phase]['start']:
                    phase_dates[phase]['start'] = start
                if finish > phase_dates[phase]['end']:
                    phase_dates[phase]['end'] = finish

    # Markdown table for tasks
    md = f"# {project_name}\n\n| ID | Task Name | Start | Finish | Duration | Resources | % Complete | Comment |\n|----|-----------|-------|--------|----------|-----------|------------|---------|\n"
    for idx, t in enumerate(tasks, start=1):
        start = t.get('start') or today
        finish = t.get('finish') or (start + (t.get('duration') or timedelta(days=1)))
        resources = t.get('resources','')
        if resources:
            resources = ', '.join([r.lstrip('@').strip() for r in resources.split(',')])
        percent = t.get('percent', '')
        comment = t.get('comment','')

        # Use description as task name, fallback to name if no description
        task_name = t.get('description') or t.get('name', '')

        # Make summary task names bold
        if t.get('summary'):
            task_name = f"**{task_name}**"

        # Indent based on level (0=no indent, 1=4 spaces, 2=8 spaces, etc.)
        level = t.get('level', 0)
        if level > 0:
            indent = '&nbsp;' * 4 * level
            task_name = f"{indent}{task_name}"

        md += f"| {idx} | {task_name} | {start.strftime('%Y-%m-%d')} | {finish.strftime('%Y-%m-%d')} | {t.get('duration',timedelta(days=1)).days}d | {resources} | {percent} | {comment} |\n"

    # Timeline output block
    milestones = []
    if phase_dates:
        # Timeline table
        md += "\n# Project Timeline\n\n| Phase | Start | End |\n|-------|-------|-----|\n"
        for phase, dates in phase_dates.items():
            md += f"| {phase} | {dates['start'].strftime('%Y-%m-%d')} | {dates['end'].strftime('%Y-%m-%d')} |\n"
        # Tasks with duration 0 are milestones
        for t in tasks:
            duration = t.get('duration', timedelta(days=1))
            if isinstance(duration, timedelta) and duration.days == 0:
                milestones.append({'name': t.get('description',''), 'date': t.get('start')})
        # End of each phase is a milestone
        for phase, dates in phase_dates.items():
            milestones.append({'name': f"End of {phase}", 'date': dates['end']})
        phase_objs = [{'name': k, 'start': v['start']} for k,v in phase_dates.items()]
        timeline_width = 80
        # Only call min/max if tasks is not empty
        if tasks:
            start_date = min([t.get('start', today) for t in tasks])
            finish_date = max([t.get('finish', today) for t in tasks])
        else:
            start_date = today
            finish_date = today
        # Custom timeline block (header will be rendered below, not here)
        # Timeline line with symbols
        timeline_row, milestone_labels, milestone_dates, milestone_full_dates = render_custom_timeline(phase_objs, milestones, start_date, finish_date, timeline_width)
        # Only show one 'Start' and one 'Finish' label/date above timeline
        # Find unique Start and Finish labels/dates (first and last milestones)
        start_idx = 0
        finish_idx = len(milestone_labels) - 1
        start_date_str = milestone_full_dates[start_idx] if milestone_full_dates else ''
        finish_date_str = milestone_full_dates[finish_idx] if milestone_full_dates else ''
        # Render only one Start and one Finish label/date above timeline
        # Render timeline header only once
        timeline_header = f"{project_name}\nStart{' ' * (timeline_width - 10)}Finish\n{start_date_str}{' ' * (timeline_width - len(start_date_str) - len(finish_date_str))}{finish_date_str}\n"
        md += timeline_header
        md += f"{timeline_row}\n"
        # Show only non-start/finish milestone labels/dates below timeline
        non_sf_labels = []
        for idx, label in enumerate(milestone_labels):
            if idx == start_idx or idx == finish_idx:
                continue
            non_sf_labels.append((idx, label))
        for idx, label in non_sf_labels:
            md += f"{label}\n"
            # Place the full date string for this milestone, right-aligned with the label
            label_end = max([i for i, c in enumerate(label) if c != ' '], default=0)
            date_str = milestone_full_dates[idx] if idx < len(milestone_full_dates) else ''
            date_line = [' '] * timeline_width
            if label_end + len(date_str) > timeline_width:
                start_pos = max(0, timeline_width - len(date_str))
            else:
                start_pos = label_end
            for i, c in enumerate(date_str):
                if start_pos + i < timeline_width:
                    date_line[start_pos + i] = c
            md += f"{''.join(date_line)}\n"
    # Gantt chart output
    timeline_width = 80
    # Only call min/max if tasks is not empty
    if tasks:
        start_date = min([t.get('start', today) for t in tasks])
        finish_date = max([t.get('finish', today) for t in tasks])
    else:
        start_date = today
        finish_date = today
    md += "\n"
    md += render_gantt_chart(tasks, start_date, finish_date, timeline_width)
    return md

if __name__ == "__main__":
    from projects.scheduling_engine.cli import main

    raise SystemExit(main(sys.argv[1:]))
