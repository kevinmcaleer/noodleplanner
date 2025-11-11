"""Noodle Core - Scheduling engine and format conversion utilities."""

from .scheduling_engine import (
    text_to_markdown_table,
    yaml_to_markdown_table,
    export_to_excel,
    export_timeline_to_powerpoint,
    export_to_pdf,
    analyze_plan,
    get_next_working_day,
    add_working_days,
    parse_duration,
    extract_metadata,
    schedule_tasks,
    render_custom_timeline,
    calculate_rag_status,
    parse_resource_mappings,
)

from .format_converter import (
    convert_plan_format_to_standard,
    extract_title_from_frontmatter,
)

__version__ = "1.0.0"

__all__ = [
    # Scheduling engine
    "text_to_markdown_table",
    "yaml_to_markdown_table",
    "export_to_excel",
    "export_timeline_to_powerpoint",
    "export_to_pdf",
    "analyze_plan",
    "get_next_working_day",
    "add_working_days",
    "parse_duration",
    "extract_metadata",
    "schedule_tasks",
    "render_custom_timeline",
    "calculate_rag_status",
    "parse_resource_mappings",
    # Format converter
    "convert_plan_format_to_standard",
    "extract_title_from_frontmatter",
]
