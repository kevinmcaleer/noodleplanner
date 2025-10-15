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
    percent_match = re.search(r'\bp(\d{1,3})\b', task_str)
    if percent_match:
        meta['percent'] = int(percent_match.group(1))
    date_match = re.search(r'(\d{4}-\d{2}-\d{2})', task_str)
    if date_match:
        meta['due'] = date_match.group(1)
        meta['start'] = parse_date(date_match.group(1))
    duration_match = re.search(r':p(\d+)d', task_str)
    if duration_match:
        meta['duration'] = timedelta(days=int(duration_match.group(1)))
    desc_match = re.match(r"\*?(.*?)(@|#|!|p|\d{4}-\d{2}-\d{2}|:p\d+d|$)", task_str)
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
    tasks = []
    # If the input is a list of dicts or strings, treat each as a top-level task
    if isinstance(phases, list):
        for entry in phases:
            if isinstance(entry, dict):
                for task_name, task_str in entry.items():
                    if isinstance(task_str, dict):
                        # Nested dict, treat each subtask
                        for sub_name, sub_str in task_str.items():
                            meta = extract_metadata(sub_str, sub_name)
                            meta['phase'] = ''
                            tasks.append(meta)
                    elif isinstance(task_str, list):
                        # List of subtasks
                        for sub_str in task_str:
                            if isinstance(sub_str, dict):
                                for sub_name, sub_val in sub_str.items():
                                    meta = extract_metadata(sub_val, sub_name)
                                    meta['phase'] = ''
                                    tasks.append(meta)
                            elif isinstance(sub_str, str):
                                meta = extract_metadata(sub_str, task_name)
                                meta['phase'] = ''
                                tasks.append(meta)
                    elif isinstance(task_str, str):
                        meta = extract_metadata(task_str, task_name)
                        meta['phase'] = ''
                        tasks.append(meta)
            elif isinstance(entry, str):
                meta = extract_metadata(entry)
                meta['phase'] = ''
                meta['name'] = meta.get('description', entry)
                tasks.append(meta)
    # If the input is a list of dicts with phases, handle as before
    else:
        for phase in phases:
            if isinstance(phase, dict):
                for phase_name, items in phase.items():
                    if isinstance(items, list):
                        for task_entry in items:
                            if isinstance(task_entry, dict):
                                for task_name, task_str in task_entry.items():
                                    meta = extract_metadata(task_str, task_name)
                                    meta['phase'] = phase_name
                                    tasks.append(meta)
                            elif isinstance(task_entry, str):
                                meta = extract_metadata(task_entry)
                                meta['phase'] = phase_name
                                meta['name'] = meta.get('description', task_entry)
                                tasks.append(meta)
                    elif isinstance(items, dict):
                        for task_name, task_str in items.items():
                            meta = extract_metadata(task_str, task_name)
                            meta['phase'] = phase_name
                            tasks.append(meta)
                    elif isinstance(items, str):
                        meta = extract_metadata(items)
                        meta['phase'] = phase_name
                        meta['name'] = meta.get('description', items)
                        tasks.append(meta)
    # Schedule all main tasks
    name_lookup = {t['name']: t for t in tasks if 'name' in t}
    for idx, t in enumerate(tasks):
        if t.get('sequential'):
            # Find previous non-summary task in the same phase (or top-level)
            prev = None
            for j in range(idx-1, -1, -1):
                if (tasks[j].get('phase') == t.get('phase')) and not tasks[j].get('summary'):
                    prev = tasks[j]
                    break
            if prev and 'finish' in prev:
                t['start'] = prev['finish']
            elif prev:
                t['start'] = prev.get('finish', datetime.now())
            else:
                t['start'] = datetime.now()
            t['finish'] = t['start'] + (t.get('duration') or timedelta(days=1))
        elif 'start' in t:
            t['finish'] = t['start'] + (t.get('duration') or timedelta(days=1))
        elif 'depends' in t and t['depends']:
            dep_finishes = [name_lookup[n]['finish'] for n in t['depends'] if n in name_lookup and 'finish' in name_lookup[n]]
            if dep_finishes:
                t['start'] = max(dep_finishes)
                t['finish'] = t['start'] + (t.get('duration') or timedelta(days=1))
            else:
                t['start'] = datetime.now()
                t['finish'] = t['start'] + (t.get('duration') or timedelta(days=1))
        else:
            if idx > 0:
                prev = tasks[idx-1]
                t['start'] = prev.get('finish', datetime.now())
            else:
                t['start'] = datetime.now()
            t['finish'] = t['start'] + (t.get('duration') or timedelta(days=1))
        if 'duration' not in t or not t['duration']:
            t['duration'] = timedelta(days=1)
    # Only create summary tasks for tasks with children (phases with >1 subtask)
    summary_tasks = []
    if not isinstance(phases, list):
        for phase in phases:
            if isinstance(phase, dict):
                for phase_name, items in phase.items():
                    phase_subtasks = [t for t in tasks if t.get('phase') == phase_name and not t.get('summary')]
                    if len(phase_subtasks) > 1:
                        phase_start = min([t['start'] for t in phase_subtasks if 'start' in t])
                        phase_finish = max([t['finish'] for t in phase_subtasks if 'finish' in t])
                        phase_duration = phase_finish - phase_start
                        percents = [t.get('percent', 0) for t in phase_subtasks if 'percent' in t]
                        percent = int(sum(percents) / len(percents)) if percents else 0
                        summary_tasks.append({
                            'name': phase_name,
                            'description': f"{phase_name} (summary)",
                            'phase': phase_name,
                            'start': phase_start,
                            'finish': phase_finish,
                            'duration': phase_duration,
                            'resources': '',
                            'percent': percent,
                            'comment': '',
                            'summary': True
                        })
    # Insert each summary task immediately before its subtasks
    ordered_tasks = []
    if summary_tasks:
        for phase in phases:
            if isinstance(phase, dict):
                for phase_name, items in phase.items():
                    summary = next((s for s in summary_tasks if s['phase'] == phase_name), None)
                    if summary:
                        ordered_tasks.append(summary)
                    for t in tasks:
                        if t.get('phase') == phase_name and not t.get('summary'):
                            ordered_tasks.append(t)
    else:
        ordered_tasks = tasks
    return ordered_tasks

# --- Gantt chart rendering ---
def render_gantt_chart(tasks, start_date, finish_date, width=80):
    chart = "# Gantt Chart\n\n"
    total_days = (finish_date - start_date).days or 1
    # Determine max ID width
    max_id_width = max([len(str(t.get('name',''))) for t in tasks] + [2])
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
    chart += f"{'ID':<{max_id_width}}  Task Name           |" + ''.join(week_row) + '|\n'
    chart += '-' * (max_id_width + 2 + 18 + width) + '\n'  # Adjust horizontal line
    # Track last summary task for indentation
    last_summary_phase = None
    for t in tasks:
        bar_start = int((t['start'] - start_date).days / total_days * (width-1))
        bar_end = int((t['finish'] - start_date).days / total_days * (width-1))
        line = [' '] * width
        percent = t.get('percent', 0)
        indent = ''
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
            last_summary_phase = t.get('phase')
            indent = ''
        else:
            # Regular task: show progress with '=' and '-' based on percent
            progress_end = bar_start + int((bar_end - bar_start) * percent / 100)
            # Indent if this task belongs to the last summary phase
            if last_summary_phase and t.get('phase') == last_summary_phase:
                indent = '    '
            for i in range(bar_start, bar_end+1):
                if i < width:
                    if i <= progress_end:
                        line[i] = '='
                    else:
                        line[i] = '-'
        task_id = str(t.get('name',''))
        label = f"{indent}{t.get('description','')}"
        line_str = ''.join(line)
        chart += f"{task_id:<{max_id_width}}  {label[:18]:<18} |{line_str}|\n"
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
    md = f"# {project_name}\n\n| # | Phase | Task | Start | Finish | Duration | Resources | % Complete | Comment |\n|---|-------|------|-------|--------|----------|-----------|------------|---------|\n"
    for t in tasks:
        start = t.get('start') or today
        finish = t.get('finish') or (start + (t.get('duration') or timedelta(days=1)))
        resources = t.get('resources','')
        if resources:
            resources = ', '.join([r.lstrip('@').strip() for r in resources.split(',')])
        percent = t.get('percent', '')
        comment = t.get('comment','')
        md += f"| {str(t.get('name',''))} | {t.get('phase','')} | {t.get('description','')} | {start.strftime('%Y-%m-%d')} | {finish.strftime('%Y-%m-%d')} | {t.get('duration',timedelta(days=1)).days}d | {resources} | {percent} | {comment} |\n"

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
