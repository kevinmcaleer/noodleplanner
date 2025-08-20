#!/usr/bin/env python
"""CLI tool to generate a GitHub issue markdown body for a bug file in docs/bugs/open.

Usage:
  python scripts/create_bug_issue.py BUG-0001

Outputs the issue markdown to stdout. Redirect or copy-paste into GitHub.

Planned future enhancement: call GitHub API directly if GITHUB_TOKEN and repo slug are configured.
"""
from __future__ import annotations
import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUGS_OPEN_DIR = ROOT / 'docs' / 'bugs' / 'open'

FRONT_MATTER_RE = re.compile(r'^---\n(.*?)\n---\n', re.DOTALL)

ISSUE_TEMPLATE = """Title: {id}: {title}\n\n````markdown\n### Bug ID\n{id}\n\n### Title\n{title}\n\n### Summary\n{summary}\n\n### Environment\n{environment}\n\n### Steps to Reproduce\n{steps}\n\n### Expected\n{expected}\n\n### Actual\n{actual}\n\n### Impact\n{impact}\n\n### Suspected Cause\n{suspected}\n\n### Workaround\n{workaround}\n\n### Suggested Tests\n{tests}\n\n### Metadata\n- Severity: {severity}\n- Priority: {priority}\n- Area: {area}\n- Component: {component}\n- Version: {version}\n- Reported: {reported}\n\n### Source File\n{source_path}\n````\n\nLabels: bug, {area}, {component}\n"""

def parse_sections(md: str) -> dict:
    # Remove front matter to parse body sections
    body = FRONT_MATTER_RE.sub('', md).strip()
    # Simple section splitter on '## '
    sections = {}
    current = None
    lines = body.splitlines()
    for line in lines:
        if line.startswith('## '):
            current = line[3:].strip()
            sections[current] = []
        else:
            if current:
                sections[current].append(line)
    for k in list(sections.keys()):
        sections[k] = '\n'.join([line for line in sections[k]]).strip()
    return sections

def parse_front_matter(md: str) -> dict:
    m = FRONT_MATTER_RE.match(md)
    data = {}
    if not m:
        return data
    for line in m.group(1).splitlines():
        if not line.strip() or line.strip().startswith('#'):
            continue
        if ':' in line:
            key, val = line.split(':', 1)
            data[key.strip()] = val.strip()
    return data

def build_issue(markdown_path: Path) -> str:
    content = markdown_path.read_text(encoding='utf-8')
    fm = parse_front_matter(content)
    sections = parse_sections(content)
    def get(section_name, default='(not provided)'):
        return sections.get(section_name, default) or default
    # Improved title extraction: first markdown H1 after front matter
    body_after_fm = FRONT_MATTER_RE.sub('', content)
    title = fm.get('id', 'Bug')
    for line in body_after_fm.splitlines():
        if line.strip().startswith('# '):
            candidate = line.strip()[2:].strip()
            if candidate:
                title = candidate
                break
    return ISSUE_TEMPLATE.format(
        id=fm.get('id', 'BUG-XXXX'),
        title=title,
        summary=get('Summary'),
        environment=get('Environment'),
        steps=get('Steps to Reproduce'),
        expected=get('Expected Result'),
        actual=get('Actual Result'),
        impact=get('Impact'),
        suspected=get('Suspected Cause (Optional)'),
        workaround=get('Workaround'),
        tests=get('Suggested Tests'),
        severity=fm.get('severity', 'TBD'),
        priority=fm.get('priority', 'TBD'),
        area=fm.get('area', 'general'),
        component=fm.get('component', 'core'),
        version=fm.get('version', '0.0.0'),
        reported=fm.get('reported', ''),
        source_path=str(markdown_path.relative_to(ROOT))
    )


def main():
    # Basic arg parsing: create_bug_issue.py [--create] [--gh] BUG-ID
    args = sys.argv[1:]
    if not args:
        print('Usage: python scripts/create_bug_issue.py [--create] [--gh] BUG-0001', file=sys.stderr)
        sys.exit(1)
    create_remote = False
    use_gh = False
    if args[0] == '--create':
        create_remote = True
        args = args[1:]
    if args and args[0] == '--gh':
        use_gh = True
        args = args[1:]
    if len(args) != 1:
        print('Usage: python scripts/create_bug_issue.py [--create] [--gh] BUG-0001', file=sys.stderr)
        sys.exit(1)
    bug_id = args[0].strip()
    pattern = f"{bug_id.lower()}.md"
    # Accept either exact file name or search by id inside open dir
    found = None
    for p in BUGS_OPEN_DIR.glob('*.md'):
        if p.name.lower() == pattern.lower():
            found = p
            break
        text = p.read_text(encoding='utf-8')
        if f"id: {bug_id}" in text:
            found = p
            break
    if not found:
        print(f"Bug file for {bug_id} not found in {BUGS_OPEN_DIR}", file=sys.stderr)
        sys.exit(2)
    issue_md = build_issue(found)
    print(issue_md)

    if create_remote:
        import os
        import json
        import urllib.request
        import urllib.error
        repo = os.environ.get('GITHUB_REPO', 'kevinmcaleer/noodleplanner')
        token = os.environ.get('GITHUB_TOKEN')
        if not token:
            print('GITHUB_TOKEN not set; skipping remote creation.', file=sys.stderr)
            return
        # Split out title and body
        first_line, _, rest = issue_md.partition('\n')
        title = first_line.replace('Title: ', '').strip()
        body = rest.strip()
        labels = []
        # Extract labels line if present
        for line in issue_md.splitlines()[::-1]:
            if line.lower().startswith('labels:'):
                labels = [label.strip() for label in line.split(':',1)[1].split(',')]
                break
        payload = json.dumps({"title": title, "body": body, "labels": labels}).encode('utf-8')
        req = urllib.request.Request(
            f'https://api.github.com/repos/{repo}/issues',
            data=payload,
            headers={
                'Authorization': f'Bearer {token}',
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'User-Agent': 'create-bug-issue-script'
            }
        )
        try:
            with urllib.request.urlopen(req) as resp:
                resp_data = json.loads(resp.read().decode('utf-8'))
                html_url = resp_data.get('html_url')
                number = resp_data.get('number')
                print(f'Created GitHub issue #{number}: {html_url}', file=sys.stderr)
        except urllib.error.HTTPError as e:
            print(f'Failed to create issue: {e.code} {e.read().decode()}', file=sys.stderr)
        except (urllib.error.URLError, ValueError) as ex:
            print(f'Error creating issue: {ex}', file=sys.stderr)
    elif use_gh:
        import subprocess
        import tempfile
        import os
    # Parse title and body
        first_line, _, rest = issue_md.partition('\n')
        title = first_line.replace('Title: ', '').strip()
        body = rest.strip()
        labels = []
        for line in issue_md.splitlines()[::-1]:
            if line.lower().startswith('labels:'):
                labels = [label.strip() for label in line.split(':',1)[1].split(',')]
                break
        cmd = ['gh', 'issue', 'create', '--title', title]
        # Write body to temp file for reliable multiline handling
        with tempfile.NamedTemporaryFile('w', delete=False, encoding='utf-8') as tf:
            tf.write(body)
            temp_path = tf.name
        cmd += ['--body-file', temp_path]
        for label in labels:
            if label:
                cmd += ['--label', label]
        repo_env = os.environ.get('GITHUB_REPO')
        if repo_env:
            cmd += ['--repo', repo_env]
        try:
            subprocess.run(cmd, check=True)
            print('Created issue via gh CLI.', file=sys.stderr)
        except FileNotFoundError:
            print('gh CLI not found. Install GitHub CLI or omit --gh.', file=sys.stderr)
        except subprocess.CalledProcessError as e:
            print(f'gh issue create failed (exit {e.returncode}).', file=sys.stderr)
        finally:
            try:
                os.unlink(temp_path)
            except OSError:
                pass

if __name__ == '__main__':
    main()
