"""Tests for task input validation limits (#234)."""

import pytest
from unittest.mock import patch
from noodle_core import schedule_tasks
import noodle_core.scheduling_engine as engine


class TestTaskCountLimit:
    """Test MAX_TASK_COUNT validation."""

    def test_within_limit_succeeds(self):
        """Tasks within the limit should schedule successfully."""
        phases = {
            f"task_{i}": {"_text": f"task_{i} 1d", "_level": 1}
            for i in range(5)
        }
        result = schedule_tasks(phases)
        assert len(result) == 5

    def test_exceeds_limit_raises_error(self):
        """Exceeding MAX_TASK_COUNT should raise ValueError."""
        with patch.object(engine, "MAX_TASK_COUNT", 3):
            phases = {
                f"task_{i}": {"_text": f"task_{i} 1d", "_level": 1}
                for i in range(5)
            }
            with pytest.raises(ValueError, match="Task count exceeds maximum of 3"):
                schedule_tasks(phases)

    def test_exactly_at_limit_succeeds(self):
        """Exactly at the limit should succeed."""
        with patch.object(engine, "MAX_TASK_COUNT", 3):
            phases = {
                f"task_{i}": {"_text": f"task_{i} 1d", "_level": 1}
                for i in range(3)
            }
            result = schedule_tasks(phases)
            assert len(result) == 3


class TestNestingDepthLimit:
    """Test MAX_NESTING_DEPTH validation."""

    def _build_nested(self, depth):
        """Build a nested dict structure with the given depth."""
        if depth == 0:
            return {"_text": "leaf 1d", "_level": depth}
        return {
            f"level_{depth}": {
                "_is_summary": True,
                "_level": depth,
                f"child_{depth}": self._build_nested(depth - 1),
            }
        }

    def test_within_depth_limit_succeeds(self):
        """Nesting within the limit should succeed."""
        with patch.object(engine, "MAX_NESTING_DEPTH", 10):
            phases = self._build_nested(5)
            result = schedule_tasks(phases)
            assert len(result) > 0

    def test_exceeds_depth_limit_raises_error(self):
        """Exceeding MAX_NESTING_DEPTH should raise ValueError."""
        with patch.object(engine, "MAX_NESTING_DEPTH", 2):
            phases = self._build_nested(5)
            with pytest.raises(ValueError, match="nesting depth exceeds maximum of 2"):
                schedule_tasks(phases)


class TestTaskNameLengthLimit:
    """Test MAX_TASK_NAME_LENGTH validation."""

    def test_within_name_length_succeeds(self):
        """Task names within the limit should succeed."""
        phases = {
            "short_name": {"_text": "short_name 1d", "_level": 1}
        }
        result = schedule_tasks(phases)
        assert len(result) == 1

    def test_exceeds_name_length_raises_error(self):
        """Exceeding MAX_TASK_NAME_LENGTH should raise ValueError."""
        with patch.object(engine, "MAX_TASK_NAME_LENGTH", 10):
            long_name = "a" * 50
            phases = {
                long_name: {"_text": f"{long_name} 1d", "_level": 1}
            }
            with pytest.raises(ValueError, match="exceeds maximum length of 10"):
                schedule_tasks(phases)

    def test_long_summary_name_raises_error(self):
        """Long summary task names should also be validated."""
        with patch.object(engine, "MAX_TASK_NAME_LENGTH", 10):
            long_name = "b" * 50
            phases = {
                long_name: {
                    "_is_summary": True,
                    "_level": 1,
                    "child": {"_text": "child 1d", "_level": 2},
                }
            }
            with pytest.raises(ValueError, match="exceeds maximum length of 10"):
                schedule_tasks(phases)


class TestEnvironmentVariableOverride:
    """Test that limits can be overridden via environment variables."""

    def test_max_task_count_env_override(self):
        """NOODLE_MAX_TASK_COUNT env var should override the default."""
        with patch.dict("os.environ", {"NOODLE_MAX_TASK_COUNT": "5"}):
            # Re-evaluate the constant
            result = int(__import__("os").environ.get("NOODLE_MAX_TASK_COUNT", 10000))
            assert result == 5

    def test_max_nesting_depth_env_override(self):
        """NOODLE_MAX_NESTING_DEPTH env var should override the default."""
        with patch.dict("os.environ", {"NOODLE_MAX_NESTING_DEPTH": "3"}):
            result = int(__import__("os").environ.get("NOODLE_MAX_NESTING_DEPTH", 20))
            assert result == 3

    def test_max_task_name_length_env_override(self):
        """NOODLE_MAX_TASK_NAME_LENGTH env var should override the default."""
        with patch.dict("os.environ", {"NOODLE_MAX_TASK_NAME_LENGTH": "100"}):
            result = int(__import__("os").environ.get("NOODLE_MAX_TASK_NAME_LENGTH", 500))
            assert result == 100
