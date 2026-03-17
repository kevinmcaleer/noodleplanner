"""Noodle Core - Scheduling engine and format conversion utilities."""

from .scheduling_engine import (
    text_to_markdown_table,
    yaml_to_markdown_table,
    export_to_excel,
    export_to_csv,
    export_timeline_to_powerpoint,
    export_report_to_powerpoint,
    export_portfolio_to_powerpoint,
    export_to_pdf,
    analyze_plan,
    get_next_working_day,
    add_working_days,
    parse_duration,
    extract_metadata,
    detect_dependency_loops,
    schedule_tasks,
    render_custom_timeline,
    calculate_rag_status,
    rag_status_to_colour,
    parse_resource_mappings,
    parse_stakeholders_from_frontmatter,
    calculate_evm,
    natural_language_to_yaml,
    inherit_summary_resources,
    MAX_TASK_COUNT,
    MAX_NESTING_DEPTH,
    MAX_TASK_NAME_LENGTH,
)

from .format_converter import (
    convert_plan_format_to_standard,
    extract_title_from_frontmatter,
    extract_highlights,
    strip_highlights,
    generate_highlights_text,
    update_plan_highlights,
    extract_raid_log,
    strip_raid_log,
    parse_raid_markdown,
    generate_raid_log_text,
    update_plan_raid_log,
    extract_budget,
    strip_budget,
    parse_budget_markdown,
    extract_baseline,
    strip_baseline,
    parse_baseline_markdown,
    generate_baseline_text,
    update_plan_baseline,
)

from .excel_importer import (
    analyze_workbook,
    convert_excel_to_markdown,
    convert_planner_to_markdown,
    detect_planner_worksheet,
    parse_planner_duration,
    parse_planner_dependency,
)

from .msproject import (
    export_to_msproject_xml,
    import_from_msproject_xml,
    import_from_mpp,
    _check_mpxj_available,
)

from .front_matter_parser import FrontMatterParser

from .planning_room import (
    generate_plan_from_planning_room,
)

__version__ = "1.0.0"

__all__ = [
    # Scheduling engine
    "text_to_markdown_table",
    "yaml_to_markdown_table",
    "export_to_excel",
    "export_to_csv",
    "export_timeline_to_powerpoint",
    "export_portfolio_to_powerpoint",
    "export_to_pdf",
    "analyze_plan",
    "get_next_working_day",
    "add_working_days",
    "parse_duration",
    "extract_metadata",
    "detect_dependency_loops",
    "schedule_tasks",
    "render_custom_timeline",
    "calculate_rag_status",
    "rag_status_to_colour",
    "parse_resource_mappings",
    "parse_stakeholders_from_frontmatter",
    "calculate_evm",
    "natural_language_to_yaml",
    "inherit_summary_resources",
    # Format converter
    "convert_plan_format_to_standard",
    "extract_title_from_frontmatter",
    "extract_highlights",
    "strip_highlights",
    "generate_highlights_text",
    "update_plan_highlights",
    "extract_raid_log",
    "strip_raid_log",
    "parse_raid_markdown",
    "generate_raid_log_text",
    "update_plan_raid_log",
    "extract_budget",
    "strip_budget",
    "parse_budget_markdown",
    "extract_baseline",
    "strip_baseline",
    "parse_baseline_markdown",
    "generate_baseline_text",
    "update_plan_baseline",
    # Excel importer
    "analyze_workbook",
    "convert_excel_to_markdown",
    "convert_planner_to_markdown",
    "detect_planner_worksheet",
    "parse_planner_duration",
    "parse_planner_dependency",
    # MS Project
    "export_to_msproject_xml",
    "import_from_msproject_xml",
    "import_from_mpp",
    "_check_mpxj_available",
    # Front matter parser
    "FrontMatterParser",
    # Planning room
    "generate_plan_from_planning_room",
]
