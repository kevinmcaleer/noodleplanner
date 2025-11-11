"""Command line interface for the scheduling engine tools."""

from __future__ import annotations

import argparse
import logging
import shutil
import sys
from pathlib import Path
from typing import Sequence

from noodle_core import (
    yaml_to_markdown_table,
    text_to_markdown_table,
    export_to_excel,
    analyze_plan,
    export_timeline_to_powerpoint,
    convert_plan_format_to_standard,
)

logger = logging.getLogger(__name__)


def _write_markdown_outputs(markdown: str, target_dir: Path) -> None:
    """Persist markdown sections into separate files mirroring legacy behaviour."""
    project_table: list[str] = []
    timeline: list[str] = []
    gantt: list[str] = []
    section = None
    overall_start = None
    overall_finish = None

    for line in markdown.splitlines():
        if line.startswith("| ") and " Phase " not in line and " Task " not in line:
            parts = line.split("|")
            if len(parts) > 5:
                start_candidate = parts[3].strip()
                finish_candidate = parts[4].strip()
                if start_candidate and finish_candidate:
                    if not overall_start or start_candidate < overall_start:
                        overall_start = start_candidate
                    if not overall_finish or finish_candidate > overall_finish:
                        overall_finish = finish_candidate
        if line.startswith("# Gantt Chart"):
            section = "gantt"
            gantt.append(line)
        elif line.startswith("# Project Timeline"):
            section = "timeline"
            timeline.append(line)
        elif line.startswith("# "):
            section = "project"
            project_table.append(line)
        else:
            if section == "gantt":
                gantt.append(line)
            elif section == "timeline":
                timeline.append(line)
            else:
                project_table.append(line)

    target_dir.mkdir(parents=True, exist_ok=True)

    (target_dir / "project_table.md").write_text(
        "\n".join(project_table).strip() + "\n",
        encoding="utf-8",
    )

    timeline_lines = [line for line in timeline if line.strip()]
    if not timeline_lines and overall_start and overall_finish:
        timeline_lines = [
            f"Project Start: {overall_start}",
            f"Project Finish: {overall_finish}",
        ]
    if timeline_lines:
        (target_dir / "timeline.md").write_text(
            "\n".join(timeline_lines).strip() + "\n",
            encoding="utf-8",
        )

    if gantt:
        (target_dir / "gantt.md").write_text(
            "\n".join(gantt).strip() + "\n",
            encoding="utf-8",
        )

    logger.info(
        "Markdown output written to '%s', '%s', and '%s'.",
        target_dir / "project_table.md",
        target_dir / "timeline.md",
        target_dir / "gantt.md",
    )


def _command_render(args: argparse.Namespace) -> int:
    input_path = args.input_path
    content = input_path.read_text(encoding="utf-8")

    # Get terminal width, default to 80 if not detectable
    terminal_width = shutil.get_terminal_size(fallback=(80, 24)).columns

    # Auto-detect format: if it's valid YAML with typical structure, use YAML parser
    # Otherwise, use natural language parser
    is_yaml = args.format == "yaml" or (args.format == "auto" and _looks_like_yaml(content))

    if is_yaml:
        markdown = yaml_to_markdown_table(str(input_path), terminal_width=terminal_width)
    else:
        # Natural language format - convert from plan.md format if needed
        converted_content = convert_plan_format_to_standard(content)
        project_name = args.project_name or input_path.stem.replace("_", " ").title()
        markdown = text_to_markdown_table(converted_content, is_yaml=False, project_name=project_name, terminal_width=terminal_width, original_text=content)

    if args.split_markdown:
        _write_markdown_outputs(markdown, args.output_dir)
        print(
            f"Markdown output written to '{args.output_dir / 'project_table.md'}', "
            f"'{args.output_dir / 'timeline.md'}', and '{args.output_dir / 'gantt.md'}'."
        )
    else:
        print(markdown)
    return 0


def _looks_like_yaml(content: str) -> bool:
    """Simple heuristic to detect if content looks like YAML."""
    # YAML typically has colons, project/tasks keys, or YAML list markers
    yaml_indicators = ["project:", "tasks:", "resources:", "- id:", "- name:"]
    return any(indicator in content for indicator in yaml_indicators)


SAMPLE_PROJECT = """\
project:
  name: Sample Project
resources:
  - name: alice
  - name: bob
tasks:
  - id: PLAN
    name: Planning
    start: 2025-01-06
    finish: 2025-01-13
    resources: [alice]
  - id: BUILD
    name: Build Prototype
    depends_on: PLAN
    duration: P5D
    resources: [alice, bob]
  - id: REVIEW
    name: Stakeholder Review
    depends_on: BUILD
    duration: P0D
"""


def _command_init(args: argparse.Namespace) -> int:
    target = args.output_path
    if target.exists() and not args.force:
        print(f"{target} already exists. Use --force to overwrite.", file=sys.stderr)
        return 1
    target.write_text(SAMPLE_PROJECT, encoding="utf-8")
    print(f"Created sample project at {target}")
    return 0


def _command_validate(args: argparse.Namespace) -> int:
    # Import lazily to keep CLI lightweight for render/init operations.
    from project_validator import load_yaml_or_front_matter, validate

    data = load_yaml_or_front_matter(str(args.yaml_path))
    issues, _derived = validate(data)
    if not issues:
        print("No validation issues found.")
        return 0
    for issue in issues:
        print(f"{issue.level}: {issue.code} - {issue.message} ({issue.where})")
    return 1 if any(issue.level == "ERROR" for issue in issues) else 0


def _command_export(args: argparse.Namespace) -> int:
    input_path = args.input_path
    output_path = args.output_path
    content = input_path.read_text(encoding="utf-8")

    # Convert plan format (strip front matter) before detection
    converted_content = convert_plan_format_to_standard(content)

    # Auto-detect format: if it's valid YAML with typical structure, use YAML parser
    # Otherwise, use natural language parser
    is_yaml = args.format == "yaml" or (args.format == "auto" and _looks_like_yaml(converted_content))

    project_name = args.project_name or input_path.stem.replace("_", " ").title()

    # Export to Excel (use converted content to ensure front matter is stripped)
    # Pass original content for resource mapping extraction
    export_to_excel(converted_content, str(output_path), is_yaml=is_yaml, project_name=project_name, original_text=content)
    print(f"Exported project data to {output_path}")
    return 0


def _command_export_ppt(args: argparse.Namespace) -> int:
    input_path = args.input_path
    output_path = args.output_path
    content = input_path.read_text(encoding="utf-8")

    # Convert plan format (strip front matter) before detection
    converted_content = convert_plan_format_to_standard(content)

    # Auto-detect format: if it's valid YAML with typical structure, use YAML parser
    # Otherwise, use natural language parser
    is_yaml = args.format == "yaml" or (args.format == "auto" and _looks_like_yaml(converted_content))

    project_name = args.project_name or input_path.stem.replace("_", " ").title()

    # Export to PowerPoint
    export_timeline_to_powerpoint(converted_content, str(output_path), is_yaml=is_yaml, project_name=project_name, original_text=content)
    print(f"Exported timeline to PowerPoint: {output_path}")
    return 0


def _command_analyze(args: argparse.Namespace) -> int:
    input_path = args.input_path
    content = input_path.read_text(encoding="utf-8")

    # Convert plan format (strip front matter) for parsing
    converted_content = convert_plan_format_to_standard(content)

    # Analyze the plan
    suggestions = analyze_plan(converted_content, original_text=content)

    if not suggestions:
        print("✓ No issues found! Your plan looks good.")
        return 0

    # Group suggestions by severity
    high_priority = [s for s in suggestions if s['severity'] == 'High']
    medium_priority = [s for s in suggestions if s['severity'] == 'Medium']
    low_priority = [s for s in suggestions if s['severity'] == 'Low']
    warnings = [s for s in suggestions if s['severity'] == 'Warning']

    print(f"\nPlan Analysis for {input_path.name}")
    print("=" * 80)
    print(f"\nFound {len(suggestions)} suggestion(s) for improvement:\n")

    if high_priority:
        print("HIGH PRIORITY:")
        print("-" * 80)
        for s in high_priority:
            print(f"  [{s['type']}] {s['message']}\n")

    if medium_priority:
        print("MEDIUM PRIORITY:")
        print("-" * 80)
        for s in medium_priority:
            print(f"  [{s['type']}] {s['message']}\n")

    if low_priority:
        print("LOW PRIORITY:")
        print("-" * 80)
        for s in low_priority:
            print(f"  [{s['type']}] {s['message']}\n")

    if warnings:
        print("WARNINGS:")
        print("-" * 80)
        for s in warnings:
            print(f"  [{s['type']}] {s['message']}\n")

    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="scheduling-engine",
        description="CLI for creating and managing YAML-based project schedules.",
    )
    parser.add_argument(
        "--log-level",
        default="WARNING",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        help="Adjust CLI logging verbosity.",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    render = subparsers.add_parser(
        "render",
        help="Render a project file (YAML or natural language) to markdown schedules.",
    )
    render.add_argument("input_path", type=Path, help="Path to the project file (YAML or natural language format).")
    render.add_argument(
        "--format",
        choices=["auto", "yaml", "natural"],
        default="auto",
        help="Input format (auto-detected by default).",
    )
    render.add_argument(
        "--project-name",
        type=str,
        help="Project name (for natural language format; defaults to filename).",
    )
    render.add_argument(
        "--split-markdown",
        action="store_true",
        help="Write markdown sections to project_table.md, timeline.md, and gantt.md.",
    )
    render.add_argument(
        "--output-dir",
        type=Path,
        default=Path("."),
        help="Directory for markdown outputs when using --split-markdown.",
    )
    render.set_defaults(func=_command_render)

    init_cmd = subparsers.add_parser(
        "init",
        help="Create a starter YAML project file.",
    )
    init_cmd.add_argument(
        "output_path",
        type=Path,
        help="Destination path for the sample YAML project.",
    )
    init_cmd.add_argument(
        "--force",
        action="store_true",
        help="Overwrite the file if it already exists.",
    )
    init_cmd.set_defaults(func=_command_init)

    validate_cmd = subparsers.add_parser(
        "validate",
        help="Validate a project file using the validator module.",
    )
    validate_cmd.add_argument("yaml_path", type=Path, help="Project YAML file to validate.")
    validate_cmd.set_defaults(func=_command_validate)

    export_cmd = subparsers.add_parser(
        "export",
        help="Export a project file to Excel format.",
    )
    export_cmd.add_argument("input_path", type=Path, help="Path to the project file (YAML or natural language format).")
    export_cmd.add_argument("output_path", type=Path, help="Path to save the Excel file (e.g., project.xlsx).")
    export_cmd.add_argument(
        "--format",
        choices=["auto", "yaml", "natural"],
        default="auto",
        help="Input format (auto-detected by default).",
    )
    export_cmd.add_argument(
        "--project-name",
        type=str,
        help="Project name (for natural language format; defaults to filename).",
    )
    export_cmd.set_defaults(func=_command_export)

    analyze_cmd = subparsers.add_parser(
        "analyze",
        help="Analyze a project plan and suggest improvements.",
    )
    analyze_cmd.add_argument("input_path", type=Path, help="Path to the project file to analyze.")
    analyze_cmd.set_defaults(func=_command_analyze)

    export_ppt_cmd = subparsers.add_parser(
        "export-ppt",
        help="Export project timeline to PowerPoint format.",
    )
    export_ppt_cmd.add_argument("input_path", type=Path, help="Path to the project file (YAML or natural language format).")
    export_ppt_cmd.add_argument("output_path", type=Path, help="Path to save the PowerPoint file (e.g., timeline.pptx).")
    export_ppt_cmd.add_argument(
        "--format",
        choices=["auto", "yaml", "natural"],
        default="auto",
        help="Input format (auto-detected by default).",
    )
    export_ppt_cmd.add_argument(
        "--project-name",
        type=str,
        help="Project name (for natural language format; defaults to filename).",
    )
    export_ppt_cmd.set_defaults(func=_command_export_ppt)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(level=getattr(logging, args.log_level))
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
