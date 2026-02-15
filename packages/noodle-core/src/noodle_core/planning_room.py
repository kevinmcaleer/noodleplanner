"""
Planning Room Module

Generates Noodle-formatted plan.md files from markdown outlines and flow diagrams.

This module takes structured outline data (markdown) and dependency flow data (JSON)
and produces a complete plan.md file with proper task hierarchy, resources,
durations, and dependency syntax.
"""

import re
from typing import Dict, List, Any, Optional, Tuple


def parse_markdown_outline(text: str) -> dict:
    """Parse simple markdown-style outline into structured data."""
    if not text or not text.strip():
        raise ValueError("Empty outline")

    lines = text.strip().split('\n')

    project_name = lines[0].strip() if lines else "Untitled Project"
    if not project_name:
        raise ValueError("Empty outline")
    phases = []
    current_phase = None
    task_stack = []

    for line in lines[1:]:
        if not line.strip():
            continue

        stripped = line.lstrip()
        indent_level = (len(line) - len(stripped)) // 2
        content = stripped.lstrip('- ').strip()

        if not content:
            continue

        duration_match = re.search(r'\b(\d+[dwmy])\b', content)
        duration = duration_match.group(1) if duration_match else ''
        resources = re.findall(r'@\w+', content)

        task_name = content
        if duration:
            task_name = task_name.replace(duration, '').strip()
        for res in resources:
            task_name = task_name.replace(res, '').strip()

        task = {
            "name": task_name,
            "duration": duration,
            "resources": resources,
            "children": []
        }

        if indent_level == 0:
            current_phase = {"name": task_name, "tasks": []}
            phases.append(current_phase)
            task_stack = []
        elif indent_level == 1 and current_phase:
            current_phase["tasks"].append(task)
            task_stack = [task]
        elif indent_level > 1 and task_stack:
            while len(task_stack) >= indent_level:
                task_stack.pop()
            if task_stack:
                task_stack[-1]["children"].append(task)
                task_stack.append(task)

    return {"project": {"name": project_name}, "phases": phases}


def generate_plan_from_planning_room(outline_text: str, flow_json: Dict[str, Any]) -> str:
    """
    Generate a complete plan.md from outline markdown and flow diagram.

    Args:
        outline_text: Markdown string containing project outline
        flow_json: Flow diagram data with nodes and edges

    Returns:
        str: Generated plan.md content

    Raises:
        ValueError: If outline is invalid or cannot be parsed
    """
    # Parse markdown
    outline = parse_markdown_outline(outline_text)

    if not outline:
        raise ValueError("Empty outline")

    # Build dependency map from flow edges
    dependency_map = build_dependency_map(flow_json.get('edges', []))

    # Build node metadata map
    node_map = {node.get('taskPath', ''): node for node in flow_json.get('nodes', []) if node.get('taskPath')}

    # Generate plan
    lines = []

    # Add title from project name
    if 'project' in outline and 'name' in outline['project']:
        lines.append(f"# {outline['project']['name']}\n")

    # Add start date
    if 'project' in outline and 'start_date' in outline['project']:
        lines.append(f"start: {outline['project']['start_date']}\n")

    # Add resources
    if 'project' in outline and 'resources' in outline['project']:
        lines.append("")
        for resource in outline['project']['resources']:
            if isinstance(resource, dict):
                res_id = resource.get('id', '')
                res_name = resource.get('name', res_id)
                res_role = resource.get('role', '')
                lines.append(f"@{res_id}: {res_name}, {res_role}")
        lines.append("")

    # Add phases and tasks
    if 'phases' in outline and outline['phases']:
        for phase_idx, phase in enumerate(outline['phases']):
            if not isinstance(phase, dict) or 'name' not in phase:
                continue

            lines.append(f"\n## {phase['name']}")

            if 'tasks' in phase and phase['tasks']:
                task_lines = walk_task_tree(
                    phase['tasks'],
                    indent=0,
                    dependency_map=dependency_map,
                    node_map=node_map,
                    phase_name=f"Phase {phase_idx + 1}: {phase['name']}",
                    parent_path=""
                )
                lines.extend(task_lines)

    return "\n".join(lines)


def build_dependency_map(edges: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    """
    Build a map of task paths to their dependencies.

    Args:
        edges: List of edge dictionaries with source/target node IDs

    Returns:
        Dict mapping task paths to lists of dependency task paths
    """
    # We need to map node IDs to task paths first
    # This will be done in the main generation function
    # For now, return structure keyed by node ID
    dependency_map = {}

    for edge in edges:
        target_id = edge.get('target')
        source_id = edge.get('source')

        if target_id and source_id:
            if target_id not in dependency_map:
                dependency_map[target_id] = []
            dependency_map[target_id].append({
                'source_id': source_id,
                'type': edge.get('type', 'FS'),
                'lag': edge.get('lag', '')
            })

    return dependency_map


def walk_task_tree(
    tasks: List[Dict[str, Any]],
    indent: int,
    dependency_map: Dict[str, Any],
    node_map: Dict[str, Any],
    phase_name: str,
    parent_path: str
) -> List[str]:
    """
    Recursively walk task tree and generate plan lines.

    Args:
        tasks: List of task dictionaries
        indent: Current indentation level
        dependency_map: Map of dependencies by node ID
        node_map: Map of task paths to node data
        phase_name: Name of current phase
        parent_path: Parent task path for nested tasks

    Returns:
        List of plan.md lines for these tasks
    """
    lines = []
    indent_str = "  " * indent

    for task_idx, task in enumerate(tasks):
        if not isinstance(task, dict) or 'name' not in task:
            continue

        # Build task path for dependency lookup
        task_number = f"{parent_path}.{task_idx + 1}" if parent_path else f"{task_idx + 1}"
        task_path = f"{phase_name} > {parent_path} > {task['name']}" if parent_path else f"{phase_name} > {task['name']}"

        # Start task line
        task_line = f"{indent_str}- {task['name']}"

        # Add duration
        if 'duration' in task and task['duration']:
            task_line += f" {task['duration']}"

        # Add resources
        if 'resources' in task and task['resources']:
            resources_str = " ".join(task['resources'])
            task_line += f" {resources_str}"

        # Add dependencies
        dependencies = get_task_dependencies(task_path, node_map, dependency_map)
        if dependencies:
            task_line += format_dependencies(dependencies)

        lines.append(task_line)

        # Recurse into children
        if 'children' in task and task['children']:
            child_lines = walk_task_tree(
                task['children'],
                indent=indent + 1,
                dependency_map=dependency_map,
                node_map=node_map,
                phase_name=phase_name,
                parent_path=task_number
            )
            lines.extend(child_lines)

    return lines


def get_task_dependencies(
    task_path: str,
    node_map: Dict[str, Any],
    dependency_map: Dict[str, Any]
) -> List[Tuple[str, str, str]]:
    """
    Get dependencies for a task by its path.

    Args:
        task_path: Full path of the task
        node_map: Map of task paths to node data
        dependency_map: Map of node IDs to dependencies

    Returns:
        List of tuples: (dependency_name, type, lag)
    """
    # Find node for this task
    if task_path not in node_map:
        return []

    node = node_map[task_path]
    node_id = node.get('id')

    if not node_id or node_id not in dependency_map:
        return []

    # Get dependencies
    deps = dependency_map[node_id]
    result = []

    for dep in deps:
        source_id = dep['source_id']

        # Find source node
        source_node = None
        for path, n in node_map.items():
            if n.get('id') == source_id:
                source_node = n
                break

        if source_node:
            dep_name = source_node.get('name', 'Unknown')
            dep_type = dep.get('type', 'FS')
            dep_lag = dep.get('lag', '')

            result.append((dep_name, dep_type, dep_lag))

    return result


def format_dependencies(dependencies: List[Tuple[str, str, str]]) -> str:
    """
    Format dependencies for plan.md syntax.

    Always uses [depends ...] syntax for dependencies.

    Args:
        dependencies: List of (name, type, lag) tuples

    Returns:
        Formatted dependency string
    """
    if not dependencies:
        return ""

    # Always use [depends ...] syntax
    dep_strs = []
    for name, dep_type, lag in dependencies:
        dep_str = sanitize_task_name(name)

        if dep_type != 'FS':
            dep_str += f"({dep_type})"

        if lag:
            dep_str += f"{lag}"

        dep_strs.append(dep_str)

    return f" [depends {', '.join(dep_strs)}]"


def sanitize_task_name(name: str) -> str:
    """
    Sanitize task name for use in dependency syntax.

    Removes special characters that would break parsing.

    Args:
        name: Task name

    Returns:
        Sanitized task name
    """
    # Remove special characters, replace spaces with underscores
    sanitized = name.replace(' ', '_')
    sanitized = ''.join(c for c in sanitized if c.isalnum() or c == '_')
    return sanitized
