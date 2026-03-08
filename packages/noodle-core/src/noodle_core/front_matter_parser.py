"""Consolidated front matter parsing for NoodlePlanner project plans.

Replaces scattered front matter parsing with a single class that provides
a consistent interface for extracting title, highlights, RAID log, baseline,
resource mappings, and key-value pairs from plan text.
"""

import logging
import re
import yaml

from .format_converter import (
    extract_highlights,
    extract_raid_log,
    parse_raid_markdown,
    extract_baseline,
    parse_baseline_markdown,
    _is_valid_yaml_value,
)
from .scheduling_engine import parse_resource_mappings

logger = logging.getLogger(__name__)


class FrontMatterParser:
    """Parse all front matter data from a plan text in a single pass.

    Usage:
        parser = FrontMatterParser(plan_text)
        title = parser.parse_title()
        highlights = parser.parse_highlights()
        raid_items = parser.parse_raid()
        key_values = parser.parse_key_values()
        resource_map = parser.parse_resource_mappings()
        baseline_items = parser.parse_baseline()
    """

    def __init__(self, plan_text: str):
        self._plan_text = plan_text
        self._front_matter_lines = None
        self._cached_key_values = None

    def _extract_front_matter_lines(self) -> list[str]:
        """Extract raw front matter lines between --- delimiters."""
        if self._front_matter_lines is not None:
            return self._front_matter_lines

        lines = self._plan_text.split('\n')
        in_front_matter = False
        front_matter_lines = []

        for line in lines:
            if line.strip() == '---':
                if not in_front_matter:
                    in_front_matter = True
                    continue
                else:
                    break
            if in_front_matter:
                front_matter_lines.append(line)

        self._front_matter_lines = front_matter_lines
        return self._front_matter_lines

    def parse_title(self) -> str | None:
        """Extract title from YAML front matter.

        Returns the title string, or None if not found.
        """
        front_matter_lines = self._extract_front_matter_lines()
        if not front_matter_lines:
            return None

        try:
            yaml_text = '\n'.join(front_matter_lines)
            frontmatter = yaml.safe_load(yaml_text)
            if isinstance(frontmatter, dict):
                for key, value in frontmatter.items():
                    if key.lower() == 'title' and value is not None:
                        return str(value)
        except yaml.YAMLError:
            for line in front_matter_lines:
                if ':' in line:
                    key, value = line.split(':', 1)
                    if key.strip().lower() == 'title':
                        title = value.strip()
                        if title and _is_valid_yaml_value(title):
                            return title

        return None

    def parse_highlights(self) -> list:
        """Extract highlights from the plan text.

        Returns a list of highlight dicts with date, author, and content fields.
        """
        return extract_highlights(self._plan_text)

    def parse_raid(self) -> list:
        """Extract and parse RAID log items from the plan text.

        Returns a list of RAID item dicts.
        """
        try:
            raid_log_text = extract_raid_log(self._plan_text)
            if raid_log_text:
                return parse_raid_markdown(raid_log_text)
        except (ValueError, KeyError) as e:
            logger.warning(f"Failed to parse RAID log from plan text: {e}")
        return []

    def parse_baseline(self) -> list:
        """Extract and parse baseline items from the plan text.

        Returns a list of baseline item dicts.
        """
        try:
            baseline_text = extract_baseline(self._plan_text)
            if baseline_text:
                return parse_baseline_markdown(baseline_text)
        except (ValueError, KeyError) as e:
            logger.warning(f"Failed to parse baseline from plan text: {e}")
        return []

    def parse_key_values(self) -> dict:
        """Parse key-value pairs from front matter.

        Returns a dict of lowercase keys to stripped string values.
        """
        if self._cached_key_values is not None:
            return self._cached_key_values

        front_matter = {}
        for line in self._extract_front_matter_lines():
            if ':' in line:
                key, value = line.split(':', 1)
                front_matter[key.strip().lower()] = value.strip()

        self._cached_key_values = front_matter
        return self._cached_key_values

    def parse_resource_mappings(self) -> dict:
        """Parse resource mappings from front matter.

        Returns a dict mapping short names to full names.
        """
        return parse_resource_mappings(self._plan_text)
