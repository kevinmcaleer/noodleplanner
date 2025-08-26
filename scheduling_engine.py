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
def extract_metadata(task_str):
    # Extract metadata from the task string
    meta = {}
    # Find t: [date]
    t_match = re.search(r"t: \[([^\]]+)\]", task_str)
    if t_match:
        meta['start'] = parse_date(t_match.group(1).split(',')[0].strip())
    # Find d: PxxD or duration: PxxD
    d_match = re.search(r"d: (P\d+D)", task_str)
    if not d_match:
        d_match = re.search(r"duration: (P\d+D)", task_str)
    if d_match:
        meta['duration'] = parse_duration(d_match.group(1))
    # Find resources (comma separated names after last comma)
    parts = [p.strip() for p in task_str.split(',')]
    if len(parts) > 2 and not any(':' in p for p in parts[-1:]):
        meta['resources'] = parts[-1]
    # Find depends: [n]
    dep_match = re.search(r"depends: \[([^\]]+)\]", task_str)
    if dep_match:
        meta['depends'] = [int(x.strip()) for x in dep_match.group(1).split(',') if x.strip().isdigit()]
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
    # Flatten all tasks, build dependency graph
    tasks = []
    for phase in phases:
        for phase_name, items in phase.items():
            for item in items:
                meta = extract_metadata(item)
                meta['phase'] = phase_name
                tasks.append(meta)
    # Build lookup by number
    num_lookup = {t['number']: t for t in tasks if 'number' in t}
    # Schedule
    for t in tasks:
        # If start is provided, use it
        if 'start' in t:
            t['finish'] = t['start'] + (t.get('duration') or timedelta(days=1))
        # If depends, start after finish of dependency
        elif 'depends' in t and t['depends']:
            dep_finishes = [num_lookup[n]['finish'] for n in t['depends'] if 'finish' in num_lookup[n]]
            if dep_finishes:
                t['start'] = max(dep_finishes)
                t['finish'] = t['start'] + (t.get('duration') or timedelta(days=1))
        # If sequential (+), start after previous
        elif item.startswith('*') and tasks:
            prev = tasks[tasks.index(t)-1]
            t['start'] = prev['finish']
            t['finish'] = t['start'] + (t.get('duration') or timedelta(days=1))
        else:
            # Default: start after previous in phase
            idx = tasks.index(t)
            if idx > 0:
                prev = tasks[idx-1]
                t['start'] = prev.get('finish', datetime.now())
            else:
                t['start'] = datetime.now()
            t['finish'] = t['start'] + (t.get('duration') or timedelta(days=1))
    return tasks
import yaml
import re
from datetime import datetime, timedelta
from dateutil.parser import parse as parse_date

DURATION_REGEX = re.compile(r"P(?:\d+D)?(?:\d+H)?(?:\d+M)?(?:\d+S)?")

# ...existing code...








def yaml_to_markdown_table(yaml_path):
    today = datetime.today()
    with open(yaml_path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    project_name = list(data.keys())[0]
    phases = data[project_name]
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
    md = f"# {project_name}\n\n| # | Phase | Task | Start | Finish | Duration | Resources |\n|---|-------|------|-------|--------|----------|-----------|\n"
    for t in tasks:
        start = t.get('start') or today
        finish = t.get('finish') or (start + (t.get('duration') or timedelta(days=1)))
        md += f"| {t.get('number','')} | {t.get('phase','')} | {t.get('description','')} | {start.strftime('%Y-%m-%d')} | {finish.strftime('%Y-%m-%d')} | {t.get('duration',timedelta(days=1)).days}d | {t.get('resources','')} |\n"

    # Timeline output block
    if phase_dates:
        # Timeline table
        md += "\n# Project Timeline\n\n| Phase | Start | End |\n|-------|-------|-----|\n"
        for phase, dates in phase_dates.items():
            md += f"| {phase} | {dates['start'].strftime('%Y-%m-%d')} | {dates['end'].strftime('%Y-%m-%d')} |\n"

        # Gather milestones and phase starts
        milestones = []
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
        start_date = min([v['start'] for v in phase_dates.values()])
        finish_date = max([v['end'] for v in phase_dates.values()])
    # Custom timeline block (header will be rendered below, not here)
        # Timeline line with symbols
        timeline_row, milestone_labels, milestone_dates, milestone_full_dates = render_custom_timeline(phase_objs, milestones, start_date, finish_date, timeline_width)
        # Only show one 'Start' and one 'Finish' label/date above timeline
        # Find unique Start and Finish labels/dates (first and last milestones)
        start_idx = 0
        finish_idx = len(milestone_labels) - 1
        start_label = milestone_labels[start_idx] if milestone_labels else ''
        finish_label = milestone_labels[finish_idx] if milestone_labels else ''
        start_date_str = milestone_full_dates[start_idx] if milestone_full_dates else ''
        finish_date_str = milestone_full_dates[finish_idx] if milestone_full_dates else ''
        # Render only one Start and one Finish label/date above timeline
        # Render timeline header only once
        # Render timeline header only once, before timeline row
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
            label_end = max([i for i, c in enumerate(label) if c != ' '], default=idx)
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
    start_date = min([t.get('start', today) for t in tasks])
    finish_date = max([t.get('finish', today) for t in tasks])
    md += "\n"
    md += render_gantt_chart(tasks, start_date, finish_date, timeline_width)
    return md
# --- Gantt chart rendering ---
def render_gantt_chart(tasks, start_date, finish_date, width=80):
    chart = "# Gantt Chart\n\n"
    total_days = (finish_date - start_date).days or 1
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
    chart += 'ID  Task Name           |' + ''.join(week_row) + '|\n'
    chart += '-' * (24 + width) + '\n'  # Added horizontal line after the heading
    # Chart rows
    for t in tasks:
        bar_start = int((t['start'] - start_date).days / total_days * (width-1))
        bar_end = int((t['finish'] - start_date).days / total_days * (width-1))
        line = [' '] * width
        for i in range(bar_start, bar_end+1):
            if 0 <= i < width:
                line[i] = '='
        task_id = str(t.get('number',''))
        label = f"{t.get('description','')}"
        line_str = ''.join(line)
        chart += f"{task_id:<3} {label[:18]:<18} |{line_str}|\n"
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

if __name__ == "__main__":
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else "docs/examples/minimal_project.sample.yaml"
    print(yaml_to_markdown_table(path))
