#!/usr/bin/env python3
"""Synchronize bug markdown files between open/ and fixed/ folders and update index.

Rules:
- A bug file lives in exactly one of open/ or fixed/ based on its front-matter status.
- If status == fixed (or closed), ensure file is in fixed/ and not in open/.
- If status == open or in-progress, ensure file is in open/ and not in fixed/.
- Update index.md table rows and metrics (Open count, Fixed count).
- Preserve existing columns; fill Fixed column with short commit hash if present in doc (first 8 chars of a 40-hex commit in body or 'Commit:' line).

Idempotent: running multiple times yields no changes after first sync.
"""
from __future__ import annotations
import re
from pathlib import Path
import shutil
import sys

BUGS_DIR = Path(__file__).resolve().parent.parent / 'docs' / 'bugs'
OPEN_DIR = BUGS_DIR / 'open'
FIXED_DIR = BUGS_DIR / 'fixed'
INDEX_FILE = BUGS_DIR / 'index.md'

STATUS_FIXED = {'fixed', 'closed', 'wontfix'}
STATUS_OPEN = {'open', 'in-progress'}

FRONT_MATTER_RE = re.compile(r'^---\n(.*?)\n---', re.DOTALL)
FIELD_RE = re.compile(r'^(\w+):\s*(.*)$')
COMMIT_RE = re.compile(r'([0-9a-f]{7,40})')


def parse_front_matter(text: str) -> dict:
    m = FRONT_MATTER_RE.match(text)
    if not m:
        return {}
    meta = {}
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        fm = FIELD_RE.match(line)
        if fm:
            key, val = fm.group(1).lower(), fm.group(2).strip()
            meta[key] = val
    return meta


def find_commit_hash(text: str) -> str | None:
    # Prefer 'Commit:' or 'Fixed in commit:' lines
    for line in text.splitlines():
        if 'commit:' in line.lower():
            m = COMMIT_RE.search(line)
            if m:
                return m.group(1)[:8]
    # Fallback: first 40-hex anywhere
    m = COMMIT_RE.search(text)
    return m.group(1)[:8] if m else None


def collect_bug_files():
    files = []
    for folder in (OPEN_DIR, FIXED_DIR):
        if folder.exists():
            for f in folder.glob('*.md'):
                files.append(f)
    return files


def sync_locations(files):
    moves = []
    for f in files:
        text = f.read_text(encoding='utf-8')
        meta = parse_front_matter(text)
        status = meta.get('status', '').lower()
        bug_id = meta.get('id')
        if not bug_id:
            continue
        target_dir = OPEN_DIR if status in STATUS_OPEN else FIXED_DIR if status in STATUS_FIXED else None
        if not target_dir:
            continue
        if f.parent != target_dir:
            target_dir.mkdir(parents=True, exist_ok=True)
            dest = target_dir / f.name
            shutil.move(str(f), dest)
            moves.append((f, dest))
    return moves


def build_index(rows):
    header = [
        '# Bug Index',
        '',
        '| ID | Title | Status | Severity | Priority | Opened | Fixed | Component |',
        '|----|-------|--------|----------|----------|--------|-------|-----------|',
    ]
    for r in sorted(rows, key=lambda x: x['id']):
        fixed_col = r.get('fixed_commit') or r.get('fixed_date') or ''
        header.append(f"| {r['id']} | {r['title']} | {r['status']} | {r['severity']} | {r['priority']} | {r['opened']} | {fixed_col} | {r['component']} |")
    return '\n'.join(header) + '\n\n_Update this table whenever a bug is added or resolved._\n\n## Legend\n\n- Status: open, in-progress, fixed, closed, wontfix\n- Severity: critical, high, medium, low, trivial\n- Priority: P0 (immediate), P1 (soon), P2 (normal), P3 (later)\n\n## Metrics (Generated)\n\n'


def write_index(rows):
    open_count = sum(1 for r in rows if r['status'] in STATUS_OPEN)
    fixed_count = sum(1 for r in rows if r['status'] in STATUS_FIXED)
    regression_rate = '0%'  # Placeholder for future metric
    content = build_index(rows)
    content += f"- Open: {open_count}\n- Fixed: {fixed_count}\n- Regression Rate: {regression_rate}\n"
    INDEX_FILE.write_text(content, encoding='utf-8')


def gather_rows(files):
    rows = []
    for f in files:
        text = f.read_text(encoding='utf-8')
        meta = parse_front_matter(text)
        if not meta.get('id'):
            continue
        body_after_fm = FRONT_MATTER_RE.sub('', text, count=1)
        rows.append({
            'id': meta.get('id'),
            'title': extract_title(body_after_fm) or meta.get('id'),
            'status': meta.get('status', ''),
            'severity': meta.get('severity', ''),
            'priority': meta.get('priority', ''),
            'opened': meta.get('reported', ''),
            'fixed_date': meta.get('fixed', ''),
            'component': meta.get('component', ''),
            'fixed_commit': find_commit_hash(text) if meta.get('status','').lower() in STATUS_FIXED else '',
        })
    return rows


def extract_title(body: str) -> str | None:
    for line in body.splitlines():
        if line.startswith('# '):
            return line[2:].strip()
    return None


def main():
    OPEN_DIR.mkdir(parents=True, exist_ok=True)
    FIXED_DIR.mkdir(parents=True, exist_ok=True)
    files = collect_bug_files()
    sync_locations(files)
    # recollect in case of moves
    files = collect_bug_files()
    rows = gather_rows(files)
    write_index(rows)
    print(f"Synced {len(rows)} bugs. Index updated at {INDEX_FILE}.")

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
