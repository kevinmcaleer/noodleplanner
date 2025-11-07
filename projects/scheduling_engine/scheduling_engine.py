import yaml
import re
from datetime import datetime, timedelta
from dateutil.parser import parse as parse_date
import sys
import logging
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill
from openpyxl.utils import get_column_letter
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.shapes import MSO_SHAPE
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

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
    # Support both !"comment" and "comment" formats
    comment_match = re.search(r'!(?:"([^"]+)"|\'([^\']+)\')', task_str)
    if comment_match:
        meta['comment'] = comment_match.group(1) if comment_match.group(1) is not None else comment_match.group(2)
    else:
        # Also support plain quoted text as comments
        comment_match = re.search(r'"([^"]+)"', task_str)
        if comment_match:
            meta['comment'] = comment_match.group(1)
        else:
            comment_match = re.search(r"'([^']+)'", task_str)
            if comment_match:
                meta['comment'] = comment_match.group(1)

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

    desc_match = re.match(r"\*?(.*?)(@|#|!|\"|\d{4}-\d{2}-\d{2}|:p\d+d|\d+[dwm]|\d+%|$)", task_str)
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
            duration = t.get('duration') if 'duration' in t else timedelta(days=1)
            t['finish'] = t['start'] + duration

        elif 'start' in t:
            # Has explicit start date
            duration = t.get('duration') if 'duration' in t else timedelta(days=1)
            t['finish'] = t['start'] + duration

        elif 'depends' in t and t['depends']:
            # Has dependencies
            dep_finishes = [name_lookup[n]['finish'] for n in t['depends']
                          if n in name_lookup and 'finish' in name_lookup[n]]
            if dep_finishes:
                t['start'] = max(dep_finishes)
            else:
                t['start'] = datetime.now()
            duration = t.get('duration') if 'duration' in t else timedelta(days=1)
            t['finish'] = t['start'] + duration

        else:
            # Default: start after previous task
            if idx > 0 and 'finish' in all_tasks[idx - 1]:
                t['start'] = all_tasks[idx - 1]['finish']
            else:
                t['start'] = datetime.now()
            duration = t.get('duration') if 'duration' in t else timedelta(days=1)
            t['finish'] = t['start'] + duration

        # Ensure duration is set (but allow 0 duration for milestones)
        if 'duration' not in t or t['duration'] is None:
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
            # Ensure task has a name
            if 'name' not in task:
                return
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
def render_gantt_chart(tasks, start_date, finish_date, terminal_width=80):
    chart = "# Gantt Chart\n\n"
    total_days = (finish_date - start_date).days or 1
    # Determine max ID width - use numeric IDs
    max_id_width = max(len(str(len(tasks))), 2)

    # Determine max task name width - use full length of longest task name
    max_name_width = max([len(t.get('description', '')) for t in tasks] + [20])

    # Calculate available width for the chart portion
    # Format: "ID  Task Name |chart|"
    # Components: max_id_width + 2 spaces + max_name_width + " |" + chart + "|"
    overhead = max_id_width + 2 + max_name_width + 3  # ID + spaces + name + " |" + "|"
    chart_width = max(20, terminal_width - overhead)  # Ensure minimum chart width of 20

    # If task names are too long, truncate them
    available_for_name = terminal_width - max_id_width - 2 - 3 - 20  # Leave at least 20 for chart
    if max_name_width > available_for_name and available_for_name > 10:
        max_name_width = available_for_name

    # Week heading row
    week_row = [' '] * chart_width
    week_dates = []
    current = start_date
    while current <= finish_date:
        pos = int((current - start_date).days / total_days * (chart_width-1))
        date_str = current.strftime('%d %b')
        for i, c in enumerate(date_str):
            if pos + i < chart_width:
                week_row[pos + i] = c
        week_dates.append(current)
        current += timedelta(days=7)
    chart += f"{'ID':<{max_id_width}}  {'Task Name':<{max_name_width}} |" + ''.join(week_row) + '|\n'
    chart += '-' * (max_id_width + 2 + max_name_width + 1 + chart_width + 2) + '\n'  # Adjust horizontal line
    for idx, t in enumerate(tasks, start=1):
        # Skip tasks without start or finish dates
        if 'start' not in t or 'finish' not in t:
            continue
        bar_start = int((t['start'] - start_date).days / total_days * (chart_width-1))
        bar_end = int((t['finish'] - start_date).days / total_days * (chart_width-1))
        line = [' '] * chart_width
        percent = t.get('percent', 0)

        # Calculate indentation based on level (0=no indent, 1=4 spaces, 2=8 spaces, etc.)
        level = t.get('level', 0)
        indent = '    ' * (level - 1) if level > 0 else ''

        # Check if this is a milestone (0 duration)
        duration = t.get('duration', timedelta(days=1))
        is_milestone = isinstance(duration, timedelta) and duration.days == 0

        if is_milestone:
            # Milestone: display diamond marker
            if bar_start < chart_width:
                line[bar_start] = '◆'
        elif t.get('summary'):
            # Summary task: use [ and ] for boundaries, show progress
            if bar_start < chart_width:
                line[bar_start] = '['
            if bar_end < chart_width:
                line[bar_end] = ']'
            # Calculate progress: use < instead of <= to handle 0% correctly
            progress_end = bar_start + int((bar_end - bar_start + 1) * percent / 100)
            for i in range(bar_start + 1, bar_end):
                if i < progress_end:
                    line[i] = '='
                else:
                    line[i] = '-'
        else:
            # Regular task: show progress with '=' and '-' based on percent
            # Calculate progress: use < instead of <= to handle 0% correctly
            progress_end = bar_start + int((bar_end - bar_start + 1) * percent / 100)
            for i in range(bar_start, bar_end+1):
                if i < chart_width:
                    if i < progress_end:
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

        # Truncate label if too long
        if len(label) > max_name_width:
            label = label[:max_name_width-1] + '.'

        line_str = ''.join(line)
        chart += f"{task_id:<{max_id_width}}  {label:<{max_name_width}} |{line_str}|\n"
    return chart

def render_resource_sheet(tasks, start_date, finish_date, holidays=None, terminal_width=80):
    """
    Render a resource allocation sheet showing workload per resource over time.
    Non-working days (weekends and holidays) are marked with ░ character.
    """
    if holidays is None:
        holidays = set()

    sheet = "# Resource Sheet\n\n"

    # Extract all resources from tasks
    resource_workload = {}  # {resource_name: [(start_date, finish_date, duration_days)]}
    resource_hours = {}  # {resource_name: total_hours}

    for t in tasks:
        resources = t.get('resources', '')
        if not resources or t.get('summary'):  # Skip summary tasks
            continue

        # Parse resources (can be comma-separated)
        resource_list = [r.strip().lstrip('@') for r in resources.split(',') if r.strip()]

        task_start = t.get('start')
        task_finish = t.get('finish')
        duration = t.get('duration', timedelta(days=1))

        if task_start and task_finish:
            # Calculate hours (8 hours per day for working days)
            working_days = 0
            current_day = task_start
            while current_day < task_finish:
                is_weekend = current_day.weekday() >= 5
                is_holiday = current_day in holidays
                if not (is_weekend or is_holiday):
                    working_days += 1
                current_day += timedelta(days=1)

            task_hours = working_days * 8

            for resource in resource_list:
                if resource not in resource_workload:
                    resource_workload[resource] = []
                    resource_hours[resource] = 0
                resource_workload[resource].append((task_start, task_finish, duration.days))
                resource_hours[resource] += task_hours

    if not resource_workload:
        return ""  # No resources to display

    # Calculate appropriate time scale based on project duration and terminal width
    total_days = (finish_date - start_date).days or 1
    max_name_width = max([len(name) for name in resource_workload.keys()] + [8])
    hours_width = 5  # Width for hours column (e.g., "999h")
    overhead = max_name_width + hours_width + 5  # Name + Hours + " | " + " |" + "|"
    chart_width = max(20, terminal_width - overhead)

    # Determine time scale: day, week, month, or quarter
    if total_days <= chart_width:
        scale = 'day'
        num_periods = total_days
    elif total_days <= chart_width * 7:
        scale = 'week'
        num_periods = (total_days + 6) // 7
    elif total_days <= chart_width * 30:
        scale = 'month'
        num_periods = (total_days + 29) // 30
    else:
        scale = 'quarter'
        num_periods = (total_days + 89) // 90

    chart_width = min(chart_width, num_periods)

    # Build time period headers
    header_row = [' '] * chart_width
    current = start_date

    if scale == 'day':
        # For daily scale, show date numbers at appropriate intervals
        # Build a list of positions where we want to place dates
        date_positions = []
        for i in range(chart_width):
            day = start_date + timedelta(days=i)
            # Show dates at: start, first of month, or every week
            if i == 0 or day.day == 1 or (day.weekday() == 0 and i > 0):
                date_positions.append(i)

        # Place dates with minimum spacing to avoid overlap
        last_end = -3  # Track where last date ended
        for pos in date_positions:
            day = start_date + timedelta(days=pos)
            date_str = day.strftime('%d')
            # Only place if it doesn't overlap with previous date (need at least 1 space)
            if pos > last_end:
                for j, c in enumerate(date_str):
                    if pos + j < chart_width:
                        header_row[pos + j] = c
                last_end = pos + len(date_str) - 1
    else:
        # For week/month/quarter scale
        for i in range(chart_width):
            if scale == 'week':
                date_str = current.strftime('%d')
                period_days = 7
            elif scale == 'month':
                date_str = current.strftime('%b')
                period_days = 30
            else:  # quarter
                quarter = (current.month - 1) // 3 + 1
                date_str = f"Q{quarter}"
                period_days = 90

            for j, c in enumerate(date_str):
                if i + j < chart_width:
                    header_row[i + j] = c

            current += timedelta(days=period_days)

    sheet += f"{'Resource':<{max_name_width}} | {'Hours':>{hours_width}} |" + ''.join(header_row) + "|\n"
    sheet += '-' * (max_name_width + 1 + hours_width + 2 + chart_width + 2) + '\n'

    # Render each resource's allocation
    for resource_name in sorted(resource_workload.keys()):
        line = [' '] * chart_width
        allocations = resource_workload[resource_name]

        # Fill in working days
        for task_start, task_finish, duration_days in allocations:
            if scale == 'day':
                for day_offset in range(duration_days):
                    day = task_start + timedelta(days=day_offset)
                    if day > finish_date:
                        break
                    pos = (day - start_date).days
                    if 0 <= pos < chart_width:
                        # Check if it's a working day
                        is_weekend = day.weekday() >= 5
                        is_holiday = day in holidays

                        if is_weekend or is_holiday:
                            line[pos] = '░'  # Non-working day
                        else:
                            line[pos] = '█'  # Working day
            else:
                # For week/month/quarter scale, show allocation as blocks
                start_period = int((task_start - start_date).days * chart_width / total_days)
                end_period = int((task_finish - start_date).days * chart_width / total_days)

                for pos in range(start_period, min(end_period + 1, chart_width)):
                    if line[pos] == ' ':
                        line[pos] = '█'

        # For daily scale, mark non-working days that aren't already marked
        if scale == 'day':
            for pos in range(chart_width):
                day = start_date + timedelta(days=pos)
                if line[pos] == ' ':
                    is_weekend = day.weekday() >= 5
                    is_holiday = day in holidays
                    if is_weekend or is_holiday:
                        line[pos] = '░'

        line_str = ''.join(line)
        hours = resource_hours.get(resource_name, 0)
        sheet += f"{resource_name:<{max_name_width}} | {hours:>{hours_width-1}}h |{line_str}|\n"

    return sheet

def render_custom_timeline(phases, milestones, start_date, finish_date, timeline_width=80):
    # Timeline line
    timeline = ['-'] * timeline_width
    milestone_positions = []
    milestone_data = []
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

    # Process milestones and calculate positions
    for item in all_items:
        pos = int((item['date'] - start_date).days / (finish_date - start_date).days * (timeline_width - 1))
        if item['type'] == 'milestone':
            symbol = '◆'
            timeline[pos] = symbol
            milestone_positions.append(pos)

            # Format date string
            if item['date'].year == start_date.year and item['date'].year == finish_date.year:
                date_str = item['date'].strftime('%-d %b')
            else:
                date_str = item['date'].strftime('%-d %b %Y')

            milestone_data.append({
                'name': item['name'],
                'pos': pos,
                'date': date_str
            })

    # Create title lines above the timeline (right-aligned, with text wrapping to avoid overlap)
    # Exclude Start and Finish as they're shown in the header
    # Strategy: Reserve vertical columns above milestones based on longest word width
    # This prevents overlapping when titles wrap across multiple lines

    max_lines = 10  # Maximum number of lines above timeline
    lines = [[' '] * timeline_width for _ in range(max_lines)]

    # First pass: identify which titles need wrapping and reserve columns
    titles_to_place = []
    reserved_columns = []  # List of (start, end) tuples representing reserved vertical columns

    for m in milestone_data:
        title = m['name']
        pos = m['pos']
        if title not in ('Start', 'Finish'):
            titles_to_place.append({'title': title, 'pos': pos, 'start': max(0, pos - len(title) + 1), 'end': pos})

    # Sort by position to process left to right
    titles_to_place.sort(key=lambda x: x['pos'])

    # Determine which titles need wrapping and reserve their columns
    for item in titles_to_place:
        title = item['title']
        pos = item['pos']
        start_pos = item['start']
        end_pos = item['end']

        # Check if full title would fit on one line without overlapping reserved columns
        overlaps = False
        buffer = 2  # Minimum space between columns
        for col_start, col_end in reserved_columns:
            # Check if this title would overlap with a reserved column (with buffer)
            if not (end_pos + buffer < col_start or start_pos > col_end + buffer):
                overlaps = True
                break

        # Also check if title would be significantly truncated at the left edge
        title_length = len(title)
        available_space = end_pos - start_pos + 1
        if available_space < title_length * 0.7:
            overlaps = True

        # If title needs wrapping, reserve a column based on its longest word
        if overlaps:
            words = title.split()
            longest_word = max(words, key=len) if words else title
            longest_word_len = len(longest_word)

            # Calculate ideal column reservation
            ideal_col_start = max(0, pos - longest_word_len + 1)
            ideal_col_end = pos

            # Check if this ideal column would overlap with existing reservations
            # If so, truncate the column start to avoid overlap
            actual_col_start = ideal_col_start
            for col_start, col_end in reserved_columns:
                # If our ideal column would overlap, adjust start position
                if not (ideal_col_end + buffer < col_start or ideal_col_start > col_end + buffer):
                    # Move our column start to after the existing column (with buffer)
                    actual_col_start = max(actual_col_start, col_end + buffer + 1)

            # Clamp to not exceed the milestone position
            actual_col_start = min(actual_col_start, pos)

            reserved_columns.append((actual_col_start, pos))
            item['needs_wrap'] = True
            item['column'] = (actual_col_start, pos)
        else:
            item['needs_wrap'] = False
            # Reserve the space this title will use on line 0
            reserved_columns.append((start_pos, end_pos))

    # Second pass: place the titles
    # Track what's been placed on each line to enforce spacing
    line_usage = [[] for _ in range(max_lines)]  # List of (start, end) for each line

    for item in titles_to_place:
        title = item['title']
        pos = item['pos']

        if not item['needs_wrap']:
            # Place full title on line 0
            start_pos = item['start']
            for i, c in enumerate(title):
                char_pos = start_pos + i
                if 0 <= char_pos <= pos and char_pos < timeline_width:
                    lines[0][char_pos] = c
            line_usage[0].append((start_pos, pos))
        else:
            # Wrap title across multiple lines within its reserved column
            words = title.split()
            col_start, col_end = item['column']
            col_width = col_end - col_start + 1

            # Place words vertically, bottom to top
            for word_idx, word in enumerate(reversed(words)):
                line_idx = word_idx

                # Try to find a line where this word fits with spacing
                placed = False
                while line_idx < max_lines and not placed:
                    # Truncate word if it's too long for the column
                    display_word = word
                    if len(word) > col_width:
                        # If column is too narrow (less than 3 chars), skip this word
                        if col_width < 3:
                            break
                        # Truncate and add period
                        display_word = word[:max(3, col_width - 1)] + '.'

                    # Right-align word within the reserved column (ending at pos)
                    word_len = len(display_word)
                    word_start = max(col_start, pos - word_len + 1)
                    word_end = word_start + word_len - 1

                    # Check if this word would conflict with other words on this line (need 1 space buffer)
                    conflicts = False
                    for used_start, used_end in line_usage[line_idx]:
                        if not (word_end + 1 < used_start or word_start > used_end + 1):
                            conflicts = True
                            break

                    if not conflicts:
                        # Place the word on this line
                        for i, c in enumerate(display_word):
                            char_pos = word_start + i
                            if col_start <= char_pos <= pos and char_pos < timeline_width:
                                lines[line_idx][char_pos] = c
                        line_usage[line_idx].append((word_start, word_end))
                        placed = True
                    else:
                        # Try the next line up
                        line_idx += 1

                if not placed and line_idx >= max_lines:
                    # Ran out of lines, skip this word
                    pass

    # Convert lines to strings, only include non-empty lines
    title_lines = []
    for line in lines:
        line_str = ''.join(line)
        if line_str.strip():
            title_lines.append(line_str)

    # Remove trailing empty lines
    while title_lines and not title_lines[-1].strip():
        title_lines.pop()

    # Create date line below the timeline (right-aligned, exclude Start and Finish)
    # Check for overlaps and only place non-overlapping dates
    date_line = [' '] * timeline_width
    date_used_ranges = []

    for m in milestone_data:
        # Skip Start and Finish - they're in the header
        if m['name'] in ('Start', 'Finish'):
            continue

        date_str = m['date']
        pos = m['pos']
        # Right-align date to end at position
        start_pos = max(0, pos - len(date_str) + 1)
        end_pos = pos

        # Check if this date would overlap with previous dates (with 1 space buffer)
        overlaps = False
        for used_start, used_end in date_used_ranges:
            if not (end_pos + 1 < used_start or start_pos > used_end + 1):
                overlaps = True
                break

        # Only place if no overlap
        if not overlaps:
            for i, c in enumerate(date_str):
                char_pos = start_pos + i
                if 0 <= char_pos < timeline_width:
                    date_line[char_pos] = c
            date_used_ranges.append((start_pos, end_pos))

    # Prepare return values for compatibility
    milestone_labels = title_lines
    milestone_full_dates = [m['date'] for m in milestone_data]

    return ''.join(timeline), milestone_labels, ''.join(date_line), milestone_full_dates, milestone_positions

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
        has_quotes = '"' in stripped or "'" in stripped
        has_details = '@' in stripped or '%' in stripped or '!' in stripped or '#' in stripped or '2025-' in stripped or '2024-' in stripped or '2026-' in stripped or has_duration or has_quotes

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

def calculate_rag_status(task, current_date=None):
    """Calculate RAG (Red, Amber, Green) status for a task.

    Args:
        task: Task dictionary with start, finish, percent, duration
        current_date: Current date for comparison (defaults to today)

    Returns:
        String: 'Green', 'Amber', or 'Red'
    """
    if current_date is None:
        current_date = datetime.now().date()
    else:
        current_date = current_date.date() if hasattr(current_date, 'date') else current_date

    # Get task details
    start_date = task.get('start')
    finish_date = task.get('finish')
    percent_complete = task.get('percent')

    if not start_date or not finish_date:
        return 'Red'  # No dates defined

    # Convert to date objects
    start_date = start_date.date() if hasattr(start_date, 'date') else start_date
    finish_date = finish_date.date() if hasattr(finish_date, 'date') else finish_date

    # Green: Task is 100% complete
    if percent_complete == 100:
        return 'Green'

    # Green: Task hasn't started yet (start date is in the future)
    if start_date > current_date:
        return 'Green'

    # Red: Start date is in the past and no progress or 0%
    if start_date <= current_date and (percent_complete is None or percent_complete == 0):
        return 'Red'

    # Calculate expected progress
    total_duration = (finish_date - start_date).days
    if total_duration <= 0:
        total_duration = 1  # Avoid division by zero

    elapsed_days = (current_date - start_date).days
    if elapsed_days < 0:
        elapsed_days = 0

    expected_percent = min(100, (elapsed_days / total_duration) * 100)

    # Amber: Actual progress is less than expected
    if percent_complete < expected_percent:
        return 'Amber'

    # Green: On track or ahead
    return 'Green'

def parse_resource_mappings(original_text):
    """Parse resource mappings from YAML front matter.

    Returns a dict mapping short names to full names.
    Example: {'Andy': 'Andy Mcarthy, Lead Developer', 'Bob': 'Bob Smith, Developer, 50%'}
    """
    resource_map = {}

    # Extract YAML front matter
    lines = original_text.split('\n')
    in_frontmatter = False
    in_resources = False

    for line in lines:
        if line.strip() == '---':
            if not in_frontmatter:
                in_frontmatter = True
            else:
                break  # End of front matter
            continue

        if not in_frontmatter:
            continue

        # Check if we're in the Resources section
        if line.strip().startswith('Resources:'):
            in_resources = True
            continue

        # Check if we've left the Resources section
        if in_resources and line and not line.startswith(' ') and not line.startswith('-'):
            in_resources = False

        # Parse resource line
        if in_resources and line.strip().startswith('-'):
            # Format: - @Andy: Andy Mcarthy, Lead Developer
            match = re.match(r'\s*-\s*@(\w+):\s*(.+)', line)
            if match:
                short_name = match.group(1)
                full_info = match.group(2).strip()
                # Extract just the name (before the first comma)
                name_only = full_info.split(',')[0].strip()
                resource_map[short_name] = name_only

    return resource_map

def analyze_plan(text, original_text=None):
    """Analyze a project plan and provide suggestions for improvement.

    Args:
        text: Converted text (without front matter)
        original_text: Original text with front matter

    Returns:
        List of suggestion dictionaries with 'type', 'severity', and 'message'
    """
    suggestions = []

    # Parse the plan
    data = natural_language_to_yaml(text, "Project")
    phases_raw = data["Project"]

    if isinstance(phases_raw, list):
        phases = phases_raw
    elif isinstance(phases_raw, dict):
        phases = [phases_raw]
    else:
        phases = []

    tasks = schedule_tasks(phases)

    # Parse resource mappings from original text
    resource_map = {}
    has_frontmatter = False
    if original_text:
        resource_map = parse_resource_mappings(original_text)
        # Check if front matter exists
        if '---' in original_text:
            has_frontmatter = True

    # Check 1: Missing front matter
    if not has_frontmatter and original_text:
        suggestions.append({
            'type': 'Front Matter',
            'severity': 'Warning',
            'message': 'Plan is missing YAML front matter. Consider adding project metadata, resources, and holidays.'
        })

    # Collect all resources used in tasks
    resources_used = set()
    for task in tasks:
        res = task.get('resources', '')
        if res:
            for r in res.split(','):
                resources_used.add(r.strip())

    # Check 2: Resources without full names/roles in front matter
    if resource_map and resources_used:
        missing_resource_details = resources_used - set(resource_map.keys())
        if missing_resource_details:
            for res in sorted(missing_resource_details):
                suggestions.append({
                    'type': 'Resource Definition',
                    'severity': 'Warning',
                    'message': f'Resource "{res}" is used in tasks but not defined in front matter. Add full name and role.'
                })
    elif resources_used and not resource_map:
        suggestions.append({
            'type': 'Resource Definition',
            'severity': 'Warning',
            'message': f'Resources are used ({", ".join(sorted(resources_used))}) but none are defined in front matter with full names and roles.'
        })

    # Track first non-summary task for dependency checking
    first_task_found = False

    # Analyze each task
    for idx, task in enumerate(tasks):
        task_name = task.get('description', task.get('name', f'Task {idx+1}'))
        is_summary = task.get('summary', False)

        # Skip summary tasks for most checks
        if is_summary:
            continue

        # Check 3: Tasks longer than 20 days
        duration = task.get('duration')
        if isinstance(duration, timedelta) and duration.days > 20:
            suggestions.append({
                'type': 'Task Duration',
                'severity': 'High',
                'message': f'Task "{task_name}" has duration of {duration.days} days. Consider breaking it down into smaller, more manageable tasks (< 20 days).'
            })

        # Check 4: Missing resources
        if not task.get('resources'):
            suggestions.append({
                'type': 'Missing Resource',
                'severity': 'Medium',
                'message': f'Task "{task_name}" has no assigned resource. Assign a team member to this task.'
            })

        # Check 5: Missing percentage complete
        if task.get('percent') is None or task.get('percent') == '':
            suggestions.append({
                'type': 'Missing Progress',
                'severity': 'Low',
                'message': f'Task "{task_name}" has no completion percentage. Add progress tracking (e.g., 0%, 50%, 100%).'
            })

        # Check 6: Missing dependencies (except first task)
        if not first_task_found:
            first_task_found = True
        else:
            has_dependency = task.get('depends') or task.get('sequential')
            if not has_dependency:
                suggestions.append({
                    'type': 'Missing Dependency',
                    'severity': 'Medium',
                    'message': f'Task "{task_name}" has no dependencies. Link it to prerequisite tasks using [depends taskname] or use * for sequential ordering.'
                })

    return suggestions

def export_timeline_to_powerpoint(text, output_path, is_yaml=True, project_name="Project", original_text=None):
    """Export project timeline to PowerPoint format.

    Args:
        text: Input text (YAML or natural language)
        output_path: Path to save the PowerPoint file
        is_yaml: If True, parse as YAML; if False, parse as natural language
        project_name: Project name to use
        original_text: Original text before conversion (for extracting resource mappings)
    """
    # Parse the text to get tasks and project info
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

    # Schedule tasks
    tasks = schedule_tasks(phases)

    if not tasks:
        logger.warning("No tasks found to export")
        return

    # Calculate project dates
    today = datetime.today()
    start_date = min([t.get('start', today) for t in tasks if 'start' in t])
    finish_date = max([t.get('finish', today) for t in tasks if 'finish' in t])
    total_days = (finish_date - start_date).days or 1

    # Compute phase timelines
    phase_dates = {}
    for t in tasks:
        phase = t.get('phase')
        start = t.get('start') or today
        duration = t.get('duration') if 'duration' in t else timedelta(days=1)
        finish = t.get('finish') or (start + duration)
        if phase:
            if phase not in phase_dates:
                phase_dates[phase] = {'start': start, 'end': finish}
            else:
                if start < phase_dates[phase]['start']:
                    phase_dates[phase]['start'] = start
                if finish > phase_dates[phase]['end']:
                    phase_dates[phase]['end'] = finish

    # Collect milestones
    milestones = []
    for t in tasks:
        duration = t.get('duration', timedelta(days=1))
        if isinstance(duration, timedelta) and duration.days == 0:
            milestone_name = t.get('description', t.get('name', ''))
            display_name = milestone_name.replace('_', ' ')
            milestones.append({'name': display_name, 'date': t.get('start')})

    # Create presentation
    prs = Presentation()
    prs.slide_width = Inches(10)
    prs.slide_height = Inches(7.5)

    # Add blank slide
    blank_slide_layout = prs.slide_layouts[6]  # Blank layout
    slide = prs.slides.add_slide(blank_slide_layout)

    # Add title
    title_box = slide.shapes.add_textbox(Inches(0.5), Inches(0.3), Inches(9), Inches(0.6))
    title_frame = title_box.text_frame
    title_frame.text = f"{project_name} Timeline"
    title_para = title_frame.paragraphs[0]
    title_para.font.size = Pt(32)
    title_para.font.bold = True
    title_para.font.color.rgb = RGBColor(54, 96, 146)

    # Timeline dimensions
    timeline_left = Inches(1)
    timeline_top = Inches(2.5)
    timeline_width = Inches(8)
    timeline_height = Inches(0.15)

    # Draw timeline base line
    timeline_line = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        timeline_left,
        timeline_top,
        timeline_width,
        timeline_height
    )
    timeline_line.fill.solid()
    timeline_line.fill.fore_color.rgb = RGBColor(54, 96, 146)
    timeline_line.line.color.rgb = RGBColor(54, 96, 146)

    # Add start and end dates
    start_text = slide.shapes.add_textbox(timeline_left, timeline_top - Inches(0.5), Inches(1.5), Inches(0.3))
    start_frame = start_text.text_frame
    start_frame.text = f"Start\n{start_date.strftime('%d %b %Y')}"
    start_frame.paragraphs[0].font.size = Pt(10)
    start_frame.paragraphs[0].font.bold = True

    end_text = slide.shapes.add_textbox(timeline_left + timeline_width - Inches(1.5), timeline_top - Inches(0.5), Inches(1.5), Inches(0.3))
    end_frame = end_text.text_frame
    end_frame.text = f"Finish\n{finish_date.strftime('%d %b %Y')}"
    end_frame.paragraphs[0].font.size = Pt(10)
    end_frame.paragraphs[0].font.bold = True
    end_frame.paragraphs[0].alignment = PP_ALIGN.RIGHT

    # Add phase boxes
    for phase, dates in phase_dates.items():
        phase_start_pos = (dates['start'] - start_date).days / total_days
        phase_end_pos = (dates['end'] - start_date).days / total_days
        phase_width = (phase_end_pos - phase_start_pos) * timeline_width.inches

        if phase_width < 0.1:
            phase_width = 0.1

        phase_box = slide.shapes.add_shape(
            MSO_SHAPE.RECTANGLE,
            timeline_left + Inches(phase_start_pos * timeline_width.inches),
            timeline_top + Inches(0.4),
            Inches(phase_width),
            Inches(0.5)
        )
        phase_box.fill.solid()
        phase_box.fill.fore_color.rgb = RGBColor(180, 198, 231)
        phase_box.line.color.rgb = RGBColor(54, 96, 146)

        # Add phase name
        phase_frame = phase_box.text_frame
        phase_frame.text = phase.replace('_', ' ')
        phase_frame.paragraphs[0].font.size = Pt(9)
        phase_frame.paragraphs[0].font.bold = True
        phase_frame.paragraphs[0].alignment = PP_ALIGN.CENTER
        phase_frame.vertical_anchor = 1  # Middle

    # Add milestones
    for milestone in milestones:
        m_pos = (milestone['date'] - start_date).days / total_days
        m_left = timeline_left + Inches(m_pos * timeline_width.inches)

        # Add diamond marker
        diamond = slide.shapes.add_shape(
            MSO_SHAPE.DIAMOND,
            m_left - Inches(0.15),
            timeline_top - Inches(0.075),
            Inches(0.3),
            Inches(0.3)
        )
        diamond.fill.solid()
        diamond.fill.fore_color.rgb = RGBColor(192, 0, 0)
        diamond.line.color.rgb = RGBColor(128, 0, 0)

        # Add milestone label above
        m_label = slide.shapes.add_textbox(
            m_left - Inches(0.75),
            timeline_top - Inches(1.2),
            Inches(1.5),
            Inches(0.4)
        )
        m_frame = m_label.text_frame
        m_frame.text = milestone['name']
        m_frame.paragraphs[0].font.size = Pt(9)
        m_frame.paragraphs[0].alignment = PP_ALIGN.CENTER

        # Add milestone date below
        m_date = slide.shapes.add_textbox(
            m_left - Inches(0.5),
            timeline_top + timeline_height + Inches(0.2),
            Inches(1),
            Inches(0.3)
        )
        m_date_frame = m_date.text_frame
        m_date_frame.text = milestone['date'].strftime('%d %b')
        m_date_frame.paragraphs[0].font.size = Pt(8)
        m_date_frame.paragraphs[0].alignment = PP_ALIGN.CENTER

    # Add legend
    legend_top = Inches(6)
    legend_left = Inches(1)

    # Phase legend
    phase_legend_box = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        legend_left,
        legend_top,
        Inches(0.3),
        Inches(0.2)
    )
    phase_legend_box.fill.solid()
    phase_legend_box.fill.fore_color.rgb = RGBColor(180, 198, 231)
    phase_legend_box.line.color.rgb = RGBColor(54, 96, 146)

    phase_legend_text = slide.shapes.add_textbox(legend_left + Inches(0.4), legend_top, Inches(1), Inches(0.2))
    phase_legend_text.text_frame.text = "Phase"
    phase_legend_text.text_frame.paragraphs[0].font.size = Pt(10)

    # Milestone legend
    milestone_legend = slide.shapes.add_shape(
        MSO_SHAPE.DIAMOND,
        legend_left + Inches(2),
        legend_top - Inches(0.05),
        Inches(0.3),
        Inches(0.3)
    )
    milestone_legend.fill.solid()
    milestone_legend.fill.fore_color.rgb = RGBColor(192, 0, 0)
    milestone_legend.line.color.rgb = RGBColor(128, 0, 0)

    milestone_legend_text = slide.shapes.add_textbox(legend_left + Inches(2.4), legend_top, Inches(1), Inches(0.2))
    milestone_legend_text.text_frame.text = "Milestone"
    milestone_legend_text.text_frame.paragraphs[0].font.size = Pt(10)

    # Save presentation
    prs.save(output_path)
    logger.info(f"Exported timeline to PowerPoint: {output_path}")

def export_to_excel(text, output_path, is_yaml=True, project_name="Project", original_text=None):
    """Export project data to Excel format.

    Args:
        text: Input text (YAML or natural language)
        output_path: Path to save the Excel file
        is_yaml: If True, parse as YAML; if False, parse as natural language
        project_name: Project name to use
        original_text: Original text before conversion (for extracting resource mappings)
    """
    # Parse resource mappings from original text if provided
    resource_map = {}
    if original_text:
        resource_map = parse_resource_mappings(original_text)

    # Parse the text to get tasks and project info
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

    # Schedule tasks
    tasks = schedule_tasks(phases)

    # Create workbook
    wb = Workbook()

    # Define styles
    header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    header_alignment = Alignment(horizontal="center", vertical="center")

    # Create Tasks sheet
    ws_tasks = wb.active
    ws_tasks.title = "Tasks"

    # Task headers (removed Phase column, added RAG)
    task_headers = ['ID', 'Task Name', 'Start', 'Finish', 'Duration (days)',
                    'Resources', '% Complete', 'RAG', 'Comment']
    ws_tasks.append(task_headers)

    # Style header row
    for col_num, header in enumerate(task_headers, 1):
        cell = ws_tasks.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = header_alignment

    # Add task data
    task_row_num = 2
    for idx, task in enumerate(tasks, start=1):
        # Calculate duration more robustly
        duration = task.get('duration')
        if isinstance(duration, timedelta):
            duration_days = duration.days
        elif task.get('start') and task.get('finish'):
            # Calculate from date difference
            duration_days = (task.get('finish') - task.get('start')).days
        else:
            duration_days = 0

        # Get task name and apply indentation based on level
        task_name = task.get('description', task.get('name', ''))

        # Convert snake_case to readable names with spaces
        task_name = task_name.replace('_', ' ')

        level = task.get('level', 0)
        if level > 0:
            indent = '  ' * level  # 2 spaces per level
            task_name = f"{indent}{task_name}"

        # Get resources and map to full names if available
        resources_str = task.get('resources', '')
        if resources_str and resource_map:
            # Split multiple resources, map each one, and join back
            resource_list = [r.strip() for r in resources_str.split(',')]
            mapped_resources = [resource_map.get(r, r) for r in resource_list]
            resources_str = ', '.join(mapped_resources)

        # Calculate RAG status (skip for summary tasks)
        if task.get('summary'):
            rag_status = ''
        else:
            rag_status = calculate_rag_status(task)

        row = [
            idx,
            task_name,
            task.get('start').strftime('%Y-%m-%d') if task.get('start') else '',
            task.get('finish').strftime('%Y-%m-%d') if task.get('finish') else '',
            duration_days,
            resources_str,
            task.get('percent', 0) if task.get('percent') else '',
            rag_status,
            task.get('comment', '')
        ]
        ws_tasks.append(row)

        # Bold summary tasks
        if task.get('summary'):
            for col_num in range(1, len(task_headers) + 1):
                cell = ws_tasks.cell(row=task_row_num, column=col_num)
                cell.font = Font(bold=True)

        # Color RAG status cell
        if rag_status:
            rag_col_num = 8  # RAG is the 8th column
            rag_cell = ws_tasks.cell(row=task_row_num, column=rag_col_num)
            if rag_status == 'Green':
                rag_cell.fill = PatternFill(start_color="92D050", end_color="92D050", fill_type="solid")
            elif rag_status == 'Amber':
                rag_cell.fill = PatternFill(start_color="FFC000", end_color="FFC000", fill_type="solid")
            elif rag_status == 'Red':
                rag_cell.fill = PatternFill(start_color="FF0000", end_color="FF0000", fill_type="solid")
                rag_cell.font = Font(color="FFFFFF", bold=True)

        task_row_num += 1

    # Auto-adjust column widths
    for col_num, header in enumerate(task_headers, 1):
        column_letter = get_column_letter(col_num)
        max_length = len(header)
        for row in ws_tasks.iter_rows(min_row=2, max_col=col_num, max_row=ws_tasks.max_row):
            cell_value = str(row[col_num-1].value) if row[col_num-1].value else ''
            max_length = max(max_length, len(cell_value))
        ws_tasks.column_dimensions[column_letter].width = min(max_length + 2, 50)

    # Create Milestones sheet
    ws_milestones = wb.create_sheet("Milestones")
    milestone_headers = ['Milestone', 'Type', 'Date']
    ws_milestones.append(milestone_headers)

    # Style header row
    for col_num, header in enumerate(milestone_headers, 1):
        cell = ws_milestones.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = header_alignment

    # Group tasks by phase to find phase dates
    phase_dates = {}
    for t in tasks:
        phase = t.get('phase')
        if phase:
            if phase not in phase_dates:
                phase_dates[phase] = {'start': t.get('start'), 'end': t.get('finish')}
            else:
                if t.get('start') and (not phase_dates[phase]['start'] or t.get('start') < phase_dates[phase]['start']):
                    phase_dates[phase]['start'] = t.get('start')
                if t.get('finish') and (not phase_dates[phase]['end'] or t.get('finish') > phase_dates[phase]['end']):
                    phase_dates[phase]['end'] = t.get('finish')

    # Add phase milestones
    milestone_entries = []
    for phase, dates in phase_dates.items():
        milestone_entries.append({
            'name': phase,
            'type': 'Phase',
            'date': dates['end']
        })

    # Add summary task milestones
    for t in tasks:
        if t.get('summary'):
            milestone_entries.append({
                'name': t.get('description', t.get('name', '')),
                'type': 'Summary',
                'date': t.get('finish')
            })

    # Add 0-duration milestones
    for t in tasks:
        duration = t.get('duration', timedelta(days=1))
        if isinstance(duration, timedelta) and duration.days == 0:
            milestone_entries.append({
                'name': t.get('description', t.get('name', '')),
                'type': 'Milestone',
                'date': t.get('start')
            })

    # Remove duplicates and sort
    seen = set()
    unique_milestones = []
    for entry in milestone_entries:
        key = (entry['name'], entry['date'])
        if key not in seen:
            seen.add(key)
            unique_milestones.append(entry)

    unique_milestones.sort(key=lambda x: x['date'] if x['date'] else datetime.now())

    # Add milestone data
    for milestone in unique_milestones:
        row = [
            milestone['name'],
            milestone['type'],
            milestone['date'].strftime('%Y-%m-%d') if milestone['date'] else ''
        ]
        ws_milestones.append(row)

    # Auto-adjust column widths
    for col_num, header in enumerate(milestone_headers, 1):
        column_letter = get_column_letter(col_num)
        max_length = len(header)
        for row in ws_milestones.iter_rows(min_row=2, max_col=col_num, max_row=ws_milestones.max_row):
            cell_value = str(row[col_num-1].value) if row[col_num-1].value else ''
            max_length = max(max_length, len(cell_value))
        ws_milestones.column_dimensions[column_letter].width = min(max_length + 2, 50)

    # Create Resources sheet
    if tasks:
        start_date = min([t.get('start', datetime.now()) for t in tasks])
        finish_date = max([t.get('finish', datetime.now()) for t in tasks])

        ws_resources = wb.create_sheet("Resources")
        resource_headers = ['Resource', 'Total Hours', 'Tasks Assigned']
        ws_resources.append(resource_headers)

        # Style header row
        for col_num, header in enumerate(resource_headers, 1):
            cell = ws_resources.cell(row=1, column=col_num)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = header_alignment

        # Calculate resource allocation
        resource_hours = {}
        resource_tasks = {}

        for task in tasks:
            resources_str = task.get('resources', '')
            if resources_str:
                task_resources = [r.strip() for r in resources_str.split(',')]
                duration = task.get('duration', timedelta(days=0))
                if isinstance(duration, timedelta):
                    hours = duration.days * 8.0 / len(task_resources)
                    task_name = task.get('description', task.get('name', ''))

                    for resource in task_resources:
                        resource_hours[resource] = resource_hours.get(resource, 0) + hours
                        if resource not in resource_tasks:
                            resource_tasks[resource] = []
                        resource_tasks[resource].append(task_name)

        # Add resource data
        for resource in sorted(resource_hours.keys()):
            row = [
                resource,
                round(resource_hours[resource], 1),
                ', '.join(resource_tasks[resource])
            ]
            ws_resources.append(row)

        # Auto-adjust column widths
        for col_num, header in enumerate(resource_headers, 1):
            column_letter = get_column_letter(col_num)
            max_length = len(header)
            for row in ws_resources.iter_rows(min_row=2, max_col=col_num, max_row=ws_resources.max_row):
                cell_value = str(row[col_num-1].value) if row[col_num-1].value else ''
                max_length = max(max_length, len(cell_value))
            ws_resources.column_dimensions[column_letter].width = min(max_length + 2, 50)

    # Save workbook
    wb.save(output_path)
    logger.info(f"Exported project data to {output_path}")

def text_to_markdown_table(text, is_yaml=True, project_name="Project", terminal_width=80):
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
        duration = t.get('duration') if 'duration' in t else timedelta(days=1)
        finish = t.get('finish') or (start + duration)
        if phase:
            if phase not in phase_dates:
                phase_dates[phase] = {'start': start, 'end': finish}
            else:
                if start < phase_dates[phase]['start']:
                    phase_dates[phase]['start'] = start
                if finish > phase_dates[phase]['end']:
                    phase_dates[phase]['end'] = finish

    # Markdown table for tasks
    # First pass: Calculate column widths
    # Use shorter headers for better terminal fit
    col_widths = {
        'id': len('ID'),
        'task_name': len('Task Name'),
        'start': len('Start'),
        'finish': len('Finish'),
        'duration': len('Dur'),
        'resources': len('Res'),
        'percent': len('%'),
        'rag': len('RAG'),
        'comment': len('Comment')
    }

    # Prepare task data for rendering
    # Use shorter date format for narrow terminals
    date_format = '%d %b' if terminal_width < 100 else '%Y-%m-%d'

    task_rows = []
    for idx, t in enumerate(tasks, start=1):
        start = t.get('start') or today
        duration = t.get('duration') if 'duration' in t else timedelta(days=1)
        finish = t.get('finish') or (start + duration)
        resources = t.get('resources','')
        if resources:
            resources = ', '.join([r.lstrip('@').strip() for r in resources.split(',')])
        percent = t.get('percent', '')
        comment = t.get('comment','')

        # Calculate RAG status (skip for summary tasks)
        if t.get('summary'):
            rag_status = ''
        else:
            rag_status = calculate_rag_status(t)

        # Use description as task name, fallback to name if no description
        task_name = t.get('description') or t.get('name', '')

        # Indent based on level (0=no indent, 1=2 spaces, 2=4 spaces, etc.)
        level = t.get('level', 0)
        if level > 0:
            indent = '  ' * level  # Use 2 spaces per level for cleaner terminal output
            task_name = f"{indent}{task_name}"

        # Store row data
        row = {
            'id': str(idx),
            'task_name': task_name,
            'start': start.strftime(date_format),
            'finish': finish.strftime(date_format),
            'duration': f"{t.get('duration',timedelta(days=1)).days}d",
            'resources': str(resources),
            'percent': str(percent),
            'rag': rag_status,
            'comment': str(comment)
        }
        task_rows.append(row)

        # Update column widths (except comment which we'll limit later)
        for key, value in row.items():
            if key != 'comment':
                col_widths[key] = max(col_widths[key], len(value))

    # Calculate available width for comment column
    # Account for column separators (| between each column + padding)
    fixed_width = (col_widths['id'] + col_widths['task_name'] + col_widths['start'] +
                   col_widths['finish'] + col_widths['duration'] + col_widths['resources'] +
                   col_widths['percent'] + col_widths['rag'])
    # Add space for separators and padding: 8 columns means 7 separators * 3 chars each = 21
    separators = 7 * 3
    available_for_comment = terminal_width - fixed_width - separators - 5  # Extra buffer

    # Limit comment width
    max_comment_width = max(len('Comment'), min(50, available_for_comment))
    col_widths['comment'] = max_comment_width

    # Truncate comments in task_rows if needed
    for row in task_rows:
        if len(row['comment']) > max_comment_width:
            row['comment'] = row['comment'][:max_comment_width - 3] + '...'

    # Second pass: Generate table with proper padding
    md = f"# {project_name}\n\n"

    # Header row (shorter headers, no leading/trailing |)
    md += f"{'ID':<{col_widths['id']}} | {'Task Name':<{col_widths['task_name']}} | {'Start':<{col_widths['start']}} | {'Finish':<{col_widths['finish']}} | {'Dur':>{col_widths['duration']}} | {'Res':^{col_widths['resources']}} | {'%':^{col_widths['percent']}} | {'RAG':^{col_widths['rag']}} | {'Comment':<{col_widths['comment']}}\n"

    # Separator row (no leading/trailing |)
    md += f"{'-' * (col_widths['id'] + 1)}|{'-' * (col_widths['task_name'] + 2)}|{'-' * (col_widths['start'] + 2)}|{'-' * (col_widths['finish'] + 2)}|{'-' * (col_widths['duration'] + 2)}|{'-' * (col_widths['resources'] + 2)}|{'-' * (col_widths['percent'] + 2)}|{'-' * (col_widths['rag'] + 2)}|{'-' * (col_widths['comment'])}\n"

    # Data rows (no leading/trailing |)
    for row in task_rows:
        md += f"{row['id']:<{col_widths['id']}} | {row['task_name']:<{col_widths['task_name']}} | {row['start']:<{col_widths['start']}} | {row['finish']:<{col_widths['finish']}} | {row['duration']:>{col_widths['duration']}} | {row['resources']:^{col_widths['resources']}} | {row['percent']:^{col_widths['percent']}} | {row['rag']:^{col_widths['rag']}} | {row['comment']:<{col_widths['comment']}}\n"

    # Timeline output block
    milestones = []
    if phase_dates:
        # Build list of milestone entries (phases, summary tasks, and 0-duration tasks)
        milestone_entries = []

        # Add phases
        for phase, dates in phase_dates.items():
            milestone_entries.append({
                'name': phase,
                'start': dates['start'],
                'end': dates['end'],
                'type': 'phase'
            })

        # Add summary tasks
        for t in tasks:
            if t.get('summary'):
                milestone_entries.append({
                    'name': t.get('description', t.get('name', '')),
                    'start': t.get('start'),
                    'end': t.get('finish'),
                    'type': 'summary'
                })

        # Add 0-duration milestones
        for t in tasks:
            duration = t.get('duration', timedelta(days=1))
            if isinstance(duration, timedelta) and duration.days == 0:
                milestone_name = t.get('description', t.get('name', ''))
                # Replace underscores with spaces for display
                display_name = milestone_name.replace('_', ' ')
                milestone_entries.append({
                    'name': display_name,
                    'start': t.get('start'),
                    'end': t.get('start'),  # Same as start for milestones
                    'type': 'milestone'
                })
                milestones.append({'name': display_name, 'date': t.get('start')})

        # Remove duplicates (same name and dates) - keep phases over summaries
        seen = set()
        unique_entries = []
        for entry in milestone_entries:
            key = (entry['name'], entry['start'], entry['end'])
            if key not in seen:
                seen.add(key)
                unique_entries.append(entry)

        milestone_entries = unique_entries

        # Sort by start date
        milestone_entries.sort(key=lambda x: x['start'] if x['start'] else datetime.now())

        # Calculate column widths for Project Milestones table
        timeline_widths = {
            'name': len('Milestone'),
            'start': len('Start'),
            'end': len('End')
        }
        for entry in milestone_entries:
            timeline_widths['name'] = max(timeline_widths['name'], len(entry['name']))
            if entry['start']:
                timeline_widths['start'] = max(timeline_widths['start'], len(entry['start'].strftime(date_format)))
            if entry['end']:
                timeline_widths['end'] = max(timeline_widths['end'], len(entry['end'].strftime(date_format)))

        # Project Milestones header
        md += f"\n# Project Milestones\n\n{'Milestone':<{timeline_widths['name']}} | {'Start':<{timeline_widths['start']}} | {'End':<{timeline_widths['end']}}\n"
        md += f"{'-' * (timeline_widths['name'] + 1)}|{'-' * (timeline_widths['start'] + 2)}|{'-' * (timeline_widths['end'] + 1)}\n"

        for entry in milestone_entries:
            start_str = entry['start'].strftime(date_format) if entry['start'] else ''
            end_str = entry['end'].strftime(date_format) if entry['end'] else ''
            md += f"{entry['name']:<{timeline_widths['name']}} | {start_str:<{timeline_widths['start']}} | {end_str:<{timeline_widths['end']}}\n"

        # End of each phase is also a milestone for the visual timeline
        for phase, dates in phase_dates.items():
            # Replace underscores with spaces for display
            display_phase = phase.replace('_', ' ')
            milestones.append({'name': f"End of {display_phase}", 'date': dates['end']})
        phase_objs = [{'name': k, 'start': v['start']} for k,v in phase_dates.items()]
        timeline_width = terminal_width
        # Only call min/max if tasks is not empty
        if tasks:
            start_date = min([t.get('start', today) for t in tasks])
            finish_date = max([t.get('finish', today) for t in tasks])
        else:
            start_date = today
            finish_date = today
        # Custom timeline block
        timeline_row, milestone_labels, milestone_dates, milestone_full_dates, milestone_positions = render_custom_timeline(phase_objs, milestones, start_date, finish_date, timeline_width)

        # Get Start and Finish dates for header
        start_date_str = milestone_full_dates[0] if milestone_full_dates else ''
        finish_date_str = milestone_full_dates[-1] if milestone_full_dates else ''

        # Create connector line with '|' at all milestone positions
        def create_connector_line():
            connector = [' '] * timeline_width
            for pos in milestone_positions:
                if 0 <= pos < timeline_width:
                    connector[pos] = '|'
            return ''.join(connector)

        # Render timeline header (project name and Start/Finish labels with dates)
        md += f"{project_name}\n"
        md += f"Start{' ' * (timeline_width - 11)}Finish\n"
        md += f"{start_date_str}{' ' * (timeline_width - len(start_date_str) - len(finish_date_str))}{finish_date_str}\n"

        # Render title lines above the timeline (in reverse order so first line is closest to timeline)
        for title_line in reversed(milestone_labels):
            md += f"{title_line}\n"

        # Add ONE connector line below all titles, connecting them to the timeline
        if milestone_labels:
            md += f"{create_connector_line()}\n"

        # Render the timeline itself
        md += f"{timeline_row}\n"

        # Calculate and render progress line
        progress_line = [' '] * timeline_width
        total_days = (finish_date - start_date).days or 1

        # Calculate progress for each phase
        for phase, dates in phase_dates.items():
            # Find all tasks in this phase
            phase_tasks = [t for t in tasks if t.get('phase') == phase and not t.get('summary')]

            if phase_tasks:
                # Calculate average progress for the phase
                total_progress = sum([t.get('percent', 0) for t in phase_tasks])
                avg_progress = total_progress / len(phase_tasks) if phase_tasks else 0

                # Calculate phase position on timeline
                phase_start_pos = int((dates['start'] - start_date).days / total_days * (timeline_width - 1))
                phase_end_pos = int((dates['end'] - start_date).days / total_days * (timeline_width - 1))

                # Fill in progress for this phase
                phase_length = phase_end_pos - phase_start_pos + 1
                progress_length = int(phase_length * avg_progress / 100)

                for i in range(phase_start_pos, phase_end_pos + 1):
                    if i < timeline_width:
                        if i < phase_start_pos + progress_length:
                            progress_line[i] = '='
                        else:
                            progress_line[i] = '-'

        md += f"{''.join(progress_line)}\n"

        # Add connector from timeline to dates below
        md += f"{create_connector_line()}\n"

        # Render date line below the timeline
        md += f"{milestone_dates}\n"
    # Gantt chart output
    timeline_width = terminal_width
    # Only call min/max if tasks is not empty
    if tasks:
        start_date = min([t.get('start', today) for t in tasks])
        finish_date = max([t.get('finish', today) for t in tasks])
    else:
        start_date = today
        finish_date = today
    md += "\n"
    md += render_gantt_chart(tasks, start_date, finish_date, timeline_width)
    md += "\n"
    md += render_resource_sheet(tasks, start_date, finish_date, holidays=set(), terminal_width=timeline_width)
    return md

def yaml_to_markdown_table(yaml_path, terminal_width=80):
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
        duration = t.get('duration') if 'duration' in t else timedelta(days=1)
        finish = t.get('finish') or (start + duration)
        if phase:
            if phase not in phase_dates:
                phase_dates[phase] = {'start': start, 'end': finish}
            else:
                if start < phase_dates[phase]['start']:
                    phase_dates[phase]['start'] = start
                if finish > phase_dates[phase]['end']:
                    phase_dates[phase]['end'] = finish

    # Markdown table for tasks
    # First pass: Calculate column widths
    # Use shorter headers for better terminal fit
    col_widths = {
        'id': len('ID'),
        'task_name': len('Task Name'),
        'start': len('Start'),
        'finish': len('Finish'),
        'duration': len('Dur'),
        'resources': len('Res'),
        'percent': len('%'),
        'rag': len('RAG'),
        'comment': len('Comment')
    }

    # Prepare task data for rendering
    # Use shorter date format for narrow terminals
    date_format = '%d %b' if terminal_width < 100 else '%Y-%m-%d'

    task_rows = []
    for idx, t in enumerate(tasks, start=1):
        start = t.get('start') or today
        duration = t.get('duration') if 'duration' in t else timedelta(days=1)
        finish = t.get('finish') or (start + duration)
        resources = t.get('resources','')
        if resources:
            resources = ', '.join([r.lstrip('@').strip() for r in resources.split(',')])
        percent = t.get('percent', '')
        comment = t.get('comment','')

        # Calculate RAG status (skip for summary tasks)
        if t.get('summary'):
            rag_status = ''
        else:
            rag_status = calculate_rag_status(t)

        # Use description as task name, fallback to name if no description
        task_name = t.get('description') or t.get('name', '')

        # Indent based on level (0=no indent, 1=2 spaces, 2=4 spaces, etc.)
        level = t.get('level', 0)
        if level > 0:
            indent = '  ' * level  # Use 2 spaces per level for cleaner terminal output
            task_name = f"{indent}{task_name}"

        # Store row data
        row = {
            'id': str(idx),
            'task_name': task_name,
            'start': start.strftime(date_format),
            'finish': finish.strftime(date_format),
            'duration': f"{t.get('duration',timedelta(days=1)).days}d",
            'resources': str(resources),
            'percent': str(percent),
            'rag': rag_status,
            'comment': str(comment)
        }
        task_rows.append(row)

        # Update column widths (except comment which we'll limit later)
        for key, value in row.items():
            if key != 'comment':
                col_widths[key] = max(col_widths[key], len(value))

    # Calculate available width for comment column
    # Account for column separators (| between each column + padding)
    fixed_width = (col_widths['id'] + col_widths['task_name'] + col_widths['start'] +
                   col_widths['finish'] + col_widths['duration'] + col_widths['resources'] +
                   col_widths['percent'] + col_widths['rag'])
    # Add space for separators and padding: 8 columns means 7 separators * 3 chars each = 21
    separators = 7 * 3
    available_for_comment = terminal_width - fixed_width - separators - 5  # Extra buffer

    # Limit comment width
    max_comment_width = max(len('Comment'), min(50, available_for_comment))
    col_widths['comment'] = max_comment_width

    # Truncate comments in task_rows if needed
    for row in task_rows:
        if len(row['comment']) > max_comment_width:
            row['comment'] = row['comment'][:max_comment_width - 3] + '...'

    # Second pass: Generate table with proper padding
    md = f"# {project_name}\n\n"

    # Header row (shorter headers, no leading/trailing |)
    md += f"{'ID':<{col_widths['id']}} | {'Task Name':<{col_widths['task_name']}} | {'Start':<{col_widths['start']}} | {'Finish':<{col_widths['finish']}} | {'Dur':>{col_widths['duration']}} | {'Res':^{col_widths['resources']}} | {'%':^{col_widths['percent']}} | {'RAG':^{col_widths['rag']}} | {'Comment':<{col_widths['comment']}}\n"

    # Separator row (no leading/trailing |)
    md += f"{'-' * (col_widths['id'] + 1)}|{'-' * (col_widths['task_name'] + 2)}|{'-' * (col_widths['start'] + 2)}|{'-' * (col_widths['finish'] + 2)}|{'-' * (col_widths['duration'] + 2)}|{'-' * (col_widths['resources'] + 2)}|{'-' * (col_widths['percent'] + 2)}|{'-' * (col_widths['rag'] + 2)}|{'-' * (col_widths['comment'])}\n"

    # Data rows (no leading/trailing |)
    for row in task_rows:
        md += f"{row['id']:<{col_widths['id']}} | {row['task_name']:<{col_widths['task_name']}} | {row['start']:<{col_widths['start']}} | {row['finish']:<{col_widths['finish']}} | {row['duration']:>{col_widths['duration']}} | {row['resources']:^{col_widths['resources']}} | {row['percent']:^{col_widths['percent']}} | {row['rag']:^{col_widths['rag']}} | {row['comment']:<{col_widths['comment']}}\n"

    # Timeline output block
    milestones = []
    if phase_dates:
        # Build list of milestone entries (phases, summary tasks, and 0-duration tasks)
        milestone_entries = []

        # Add phases
        for phase, dates in phase_dates.items():
            milestone_entries.append({
                'name': phase,
                'start': dates['start'],
                'end': dates['end'],
                'type': 'phase'
            })

        # Add summary tasks
        for t in tasks:
            if t.get('summary'):
                milestone_entries.append({
                    'name': t.get('description', t.get('name', '')),
                    'start': t.get('start'),
                    'end': t.get('finish'),
                    'type': 'summary'
                })

        # Add 0-duration milestones
        for t in tasks:
            duration = t.get('duration', timedelta(days=1))
            if isinstance(duration, timedelta) and duration.days == 0:
                milestone_name = t.get('description', t.get('name', ''))
                # Replace underscores with spaces for display
                display_name = milestone_name.replace('_', ' ')
                milestone_entries.append({
                    'name': display_name,
                    'start': t.get('start'),
                    'end': t.get('start'),  # Same as start for milestones
                    'type': 'milestone'
                })
                milestones.append({'name': display_name, 'date': t.get('start')})

        # Remove duplicates (same name and dates) - keep phases over summaries
        seen = set()
        unique_entries = []
        for entry in milestone_entries:
            key = (entry['name'], entry['start'], entry['end'])
            if key not in seen:
                seen.add(key)
                unique_entries.append(entry)

        milestone_entries = unique_entries

        # Sort by start date
        milestone_entries.sort(key=lambda x: x['start'] if x['start'] else datetime.now())

        # Calculate column widths for Project Milestones table
        timeline_widths = {
            'name': len('Milestone'),
            'start': len('Start'),
            'end': len('End')
        }
        for entry in milestone_entries:
            timeline_widths['name'] = max(timeline_widths['name'], len(entry['name']))
            if entry['start']:
                timeline_widths['start'] = max(timeline_widths['start'], len(entry['start'].strftime(date_format)))
            if entry['end']:
                timeline_widths['end'] = max(timeline_widths['end'], len(entry['end'].strftime(date_format)))

        # Project Milestones header
        md += f"\n# Project Milestones\n\n{'Milestone':<{timeline_widths['name']}} | {'Start':<{timeline_widths['start']}} | {'End':<{timeline_widths['end']}}\n"
        md += f"{'-' * (timeline_widths['name'] + 1)}|{'-' * (timeline_widths['start'] + 2)}|{'-' * (timeline_widths['end'] + 1)}\n"

        for entry in milestone_entries:
            start_str = entry['start'].strftime(date_format) if entry['start'] else ''
            end_str = entry['end'].strftime(date_format) if entry['end'] else ''
            md += f"{entry['name']:<{timeline_widths['name']}} | {start_str:<{timeline_widths['start']}} | {end_str:<{timeline_widths['end']}}\n"

        # End of each phase is also a milestone for the visual timeline
        for phase, dates in phase_dates.items():
            # Replace underscores with spaces for display
            display_phase = phase.replace('_', ' ')
            milestones.append({'name': f"End of {display_phase}", 'date': dates['end']})
        phase_objs = [{'name': k, 'start': v['start']} for k,v in phase_dates.items()]
        timeline_width = terminal_width
        # Only call min/max if tasks is not empty
        if tasks:
            start_date = min([t.get('start', today) for t in tasks])
            finish_date = max([t.get('finish', today) for t in tasks])
        else:
            start_date = today
            finish_date = today
        # Custom timeline block
        timeline_row, milestone_labels, milestone_dates, milestone_full_dates, milestone_positions = render_custom_timeline(phase_objs, milestones, start_date, finish_date, timeline_width)

        # Get Start and Finish dates for header
        start_date_str = milestone_full_dates[0] if milestone_full_dates else ''
        finish_date_str = milestone_full_dates[-1] if milestone_full_dates else ''

        # Create connector line with '|' at all milestone positions
        def create_connector_line():
            connector = [' '] * timeline_width
            for pos in milestone_positions:
                if 0 <= pos < timeline_width:
                    connector[pos] = '|'
            return ''.join(connector)

        # Render timeline header (project name and Start/Finish labels with dates)
        md += f"{project_name}\n"
        md += f"Start{' ' * (timeline_width - 11)}Finish\n"
        md += f"{start_date_str}{' ' * (timeline_width - len(start_date_str) - len(finish_date_str))}{finish_date_str}\n"

        # Render title lines above the timeline (in reverse order so first line is closest to timeline)
        for title_line in reversed(milestone_labels):
            md += f"{title_line}\n"

        # Add ONE connector line below all titles, connecting them to the timeline
        if milestone_labels:
            md += f"{create_connector_line()}\n"

        # Render the timeline itself
        md += f"{timeline_row}\n"

        # Calculate and render progress line
        progress_line = [' '] * timeline_width
        total_days = (finish_date - start_date).days or 1

        # Calculate progress for each phase
        for phase, dates in phase_dates.items():
            # Find all tasks in this phase
            phase_tasks = [t for t in tasks if t.get('phase') == phase and not t.get('summary')]

            if phase_tasks:
                # Calculate average progress for the phase
                total_progress = sum([t.get('percent', 0) for t in phase_tasks])
                avg_progress = total_progress / len(phase_tasks) if phase_tasks else 0

                # Calculate phase position on timeline
                phase_start_pos = int((dates['start'] - start_date).days / total_days * (timeline_width - 1))
                phase_end_pos = int((dates['end'] - start_date).days / total_days * (timeline_width - 1))

                # Fill in progress for this phase
                phase_length = phase_end_pos - phase_start_pos + 1
                progress_length = int(phase_length * avg_progress / 100)

                for i in range(phase_start_pos, phase_end_pos + 1):
                    if i < timeline_width:
                        if i < phase_start_pos + progress_length:
                            progress_line[i] = '='
                        else:
                            progress_line[i] = '-'

        md += f"{''.join(progress_line)}\n"

        # Add connector from timeline to dates below
        md += f"{create_connector_line()}\n"

        # Render date line below the timeline
        md += f"{milestone_dates}\n"
    # Gantt chart output
    timeline_width = terminal_width
    # Only call min/max if tasks is not empty
    if tasks:
        start_date = min([t.get('start', today) for t in tasks])
        finish_date = max([t.get('finish', today) for t in tasks])
    else:
        start_date = today
        finish_date = today
    md += "\n"
    md += render_gantt_chart(tasks, start_date, finish_date, timeline_width)
    md += "\n"
    md += render_resource_sheet(tasks, start_date, finish_date, holidays=set(), terminal_width=timeline_width)
    return md

if __name__ == "__main__":
    from projects.scheduling_engine.cli import main

    raise SystemExit(main(sys.argv[1:]))
