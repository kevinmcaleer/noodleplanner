"""ASCII rendering: Gantt charts, resource sheets, and timelines.

Depends on: date_math (for timedelta usage in rendering).
"""

from datetime import timedelta

from .date_math import _as_date


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

    # Date heading row with smart spacing
    # Try to show all dates, then every other date, then week starts
    def try_place_dates(chart_width, start_date, finish_date, total_days, interval_days):
        """Try to place dates at given interval without overlapping"""
        date_row = [' '] * chart_width
        current = start_date
        placed_dates = []

        while current <= finish_date:
            pos = int((current - start_date).days / total_days * (chart_width-1))
            # Use format "DD mmm " (e.g., "13 nov ") for display
            date_str = current.strftime('%d %b ').lower()

            # Check if we have enough space (7 chars for "DD mmm ")
            if pos + len(date_str) <= chart_width:
                # Check if this overlaps with previously placed dates
                overlaps = False
                for prev_pos, prev_len in placed_dates:
                    if pos < prev_pos + prev_len and pos + len(date_str) > prev_pos:
                        overlaps = True
                        break

                if not overlaps:
                    # Place the date
                    for i, c in enumerate(date_str):
                        if pos + i < chart_width:
                            date_row[pos + i] = c
                    placed_dates.append((pos, len(date_str)))

            current += timedelta(days=interval_days)

        # Return True if we placed at least some dates
        return date_row, len(placed_dates) > 0

    # Try daily, then every other day, then weekly
    date_row = None
    for interval in [1, 2, 7]:
        date_row, success = try_place_dates(chart_width, start_date, finish_date, total_days, interval)
        if success:
            break

    if date_row is None:
        date_row = [' '] * chart_width

    chart += f"{'ID':<{max_id_width}}  {'Task Name':<{max_name_width}} |" + ''.join(date_row) + '|\n'
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
            # Milestone: display diamond marker (ASCII output)
            if bar_start < chart_width:
                line[bar_start] = '\u25c6'
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
                    line[i] = '\u2550'  # U+2550 - Box drawing double horizontal
                else:
                    line[i] = '\u2500'  # U+2500 - Box drawing light horizontal
        else:
            # Regular task: show progress with '=' and '-' based on percent
            # Calculate progress: use < instead of <= to handle 0% correctly
            progress_end = bar_start + int((bar_end - bar_start + 1) * percent / 100)
            for i in range(bar_start, bar_end+1):
                if i < chart_width:
                    if i < progress_end:
                        line[i] = '\u2550'  # U+2550 - Box drawing double horizontal
                    else:
                        line[i] = '\u2500'  # U+2500 - Box drawing light horizontal
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

def render_resource_sheet(tasks, start_date, finish_date, holidays=None, terminal_width=80, resource_map=None):
    """
    Render a resource allocation sheet showing workload per resource over time.
    Non-working days (weekends and holidays) are marked with \u2591 character.

    Args:
        tasks: List of tasks
        start_date: Project start date
        finish_date: Project finish date
        holidays: Set of holiday dates
        terminal_width: Width of terminal for formatting
        resource_map: Dict mapping short names to full names (e.g., {'kev': 'Kevin McAleer'})
    """
    # Plain dates, compared against each day's _as_date() below: the days
    # walked here are the scheduled `datetime`s, and a `date` holiday is
    # never equal to a `datetime`, so no holiday used to be shaded.
    holidays = {_as_date(h) for h in holidays or ()}
    if resource_map is None:
        resource_map = {}

    sheet = "# Resource Sheet\n\n"

    # Extract all resources from tasks
    resource_workload = {}  # {resource_name_lower: [(start_date, finish_date, duration_days)]}
    resource_hours = {}  # {resource_name_lower: total_hours}
    resource_display_names = {}  # {resource_name_lower: original_case_name}

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
            # Calculate hours based on task duration (8 hours per day)
            # Use the duration from the task, which is the planned duration
            if isinstance(duration, timedelta):
                task_hours = duration.days * 8
            else:
                # If duration is not set, calculate from dates
                task_hours = (task_finish - task_start).days * 8

            for resource in resource_list:
                # Normalize to lowercase for case-insensitive comparison
                resource_key = resource.lower()
                # Keep first occurrence's case for display
                if resource_key not in resource_display_names:
                    resource_display_names[resource_key] = resource
                if resource_key not in resource_workload:
                    resource_workload[resource_key] = []
                    resource_hours[resource_key] = 0
                resource_workload[resource_key].append((task_start, task_finish, duration.days))
                resource_hours[resource_key] += task_hours

    if not resource_workload:
        return ""  # No resources to display

    # Calculate appropriate time scale based on project duration and terminal width
    total_days = (finish_date - start_date).days or 1
    # Calculate max width considering both display names and full names from resource_map
    max_name_width = max([len(resource_map.get(key, resource_display_names.get(key, key))) for key in resource_workload.keys()] + [8])
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
        last_end = -7  # Track where last date ended (7 chars for "DD mmm ")
        for pos in date_positions:
            day = start_date + timedelta(days=pos)
            date_str = day.strftime('%d %b ').lower()  # e.g., "13 nov "
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
                date_str = current.strftime('%d %b ').lower()  # e.g., "13 nov "
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
                # Iterate through all calendar days from start to finish
                current_day = task_start
                while current_day < task_finish:
                    if current_day > finish_date:
                        break
                    pos = (current_day - start_date).days
                    if 0 <= pos < chart_width:
                        # Check if it's a working day
                        is_weekend = current_day.weekday() >= 5
                        is_holiday = _as_date(current_day) in holidays

                        if is_weekend or is_holiday:
                            line[pos] = '\u2591'  # Non-working day
                        else:
                            line[pos] = '\u2588'  # Working day
                    current_day += timedelta(days=1)
            else:
                # For week/month/quarter scale, show allocation as blocks
                start_period = int((task_start - start_date).days * chart_width / total_days)
                end_period = int((task_finish - start_date).days * chart_width / total_days)

                for pos in range(start_period, min(end_period + 1, chart_width)):
                    if line[pos] == ' ':
                        line[pos] = '\u2588'

        # For daily scale, mark non-working days that aren't already marked
        if scale == 'day':
            for pos in range(chart_width):
                day = start_date + timedelta(days=pos)
                if line[pos] == ' ':
                    is_weekend = day.weekday() >= 5
                    is_holiday = _as_date(day) in holidays
                    if is_weekend or is_holiday:
                        line[pos] = '\u2591'

        line_str = ''.join(line)
        hours = resource_hours.get(resource_name, 0)
        # First get the display name from task resources, then check resource_map for full name
        display_name = resource_display_names.get(resource_name, resource_name)
        # Use full name from resource_map if available (case-insensitive lookup)
        display_name = resource_map.get(resource_name, display_name)
        sheet += f"{display_name:<{max_name_width}} | {hours:>{hours_width-1}}h |{line_str}|\n"

    return sheet

def render_custom_timeline(phases, milestones, start_date, finish_date, timeline_width=80):
    # Timeline line using box drawing character
    timeline = ['\u2500'] * timeline_width  # U+2500 - Box drawing light horizontal
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
        all_items.append({
            'type': 'milestone',
            'name': milestone['name'],
            'date': milestone['date'],
            'percent': milestone.get('percent', 0)  # Include percent for rendering
        })
    # Add finish milestone
    all_items.append({'type': 'milestone', 'name': 'Finish', 'date': finish_date})
    # Sort by date
    all_items.sort(key=lambda x: x['date'])

    # Process milestones and calculate positions
    # Handle case where start_date equals finish_date (single day plan)
    duration_days = (finish_date - start_date).days
    if duration_days == 0:
        duration_days = 1  # Treat as single day, all items at same position

    for item in all_items:
        pos = int((item['date'] - start_date).days / duration_days * (timeline_width - 1))
        if item['type'] == 'milestone':
            # Use diamond for milestones in ASCII timeline
            symbol = '\u25c6'
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
        all_items.append({
            'type': 'milestone',
            'name': milestone['name'],
            'date': milestone['date'],
            'percent': milestone.get('percent', 0)  # Include percent for rendering
        })
    # Add finish milestone
    all_items.append({'type': 'milestone', 'name': 'Finish', 'date': finish_date})
    # Sort by date
    all_items.sort(key=lambda x: x['date'])
    # Timeline line
    # Place symbols, labels, and dates
    for item in all_items:
        pos = int((item['date'] - start_date).days / (finish_date - start_date).days * (timeline_width - 1))
        if item['type'] == 'milestone':
            # Use diamond for milestones in ASCII timeline
            symbol = '\u25c6'
        else:
            symbol = '\u25a0'
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
