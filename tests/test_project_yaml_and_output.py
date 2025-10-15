import pytest
import yaml
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
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
    # Accept either '# Project Timeline' or the project name as a valid header
    assert ('# Project Timeline' in output) or ('# House move' in output)
    assert '# Gantt Chart' in output
    assert '| # | Phase | Task | Start | Finish | Duration | Resources |' in output
    # Check for a typical Gantt chart line in the output
    assert '|============' in output or '|====' in output or '|-' in output
    assert '|' in output  # Gantt chart bars
    # Check resources
    assert 'Kevin' in output
    assert 'Jenni' in output
    # Check percent complete
    assert '10d' in output or '14d' in output  # duration
    # Check comments
    assert 'Visit 3 houses' in output
    # Check dependencies
    assert 'pack' in output or 'mortgage' in output
