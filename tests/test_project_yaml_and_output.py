import pytest
import yaml
from project_validator import validate_project_yaml
import scheduling_engine
from pathlib import Path

def test_valid_project_yaml():
    # Load a valid sample YAML
    sample_path = Path('docs/examples/minimal_project.sample.yaml')
    with open(sample_path, encoding='utf-8') as f:
        data = yaml.safe_load(f)
    # Should not raise
    assert validate_project_yaml(data) is True

def test_invalid_project_yaml():
    # Missing required fields
    invalid_yaml = {'Project': [{'Phase': []}]}
    with pytest.raises(Exception):
        validate_project_yaml(invalid_yaml)

def test_scheduling_engine_output():
    # Run the scheduling engine and check output contains expected sections
    sample_path = 'docs/examples/minimal_project.sample.yaml'
    output = scheduling_engine.yaml_to_markdown_table(sample_path)
    assert '# Project Timeline' in output
    assert '# Gantt Chart' in output
    assert '| # | Phase | Task | Start | Finish | Duration | Resources |' in output
    assert 'ID  Task Name' in output
    assert '|' in output  # Gantt chart bars
