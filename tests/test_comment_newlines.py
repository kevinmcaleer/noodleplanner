"""A task comment is one markdown line: line breaks are stored as a literal ``\\n``."""

from noodle_core.metadata import extract_metadata


def test_escaped_newline_decodes_to_a_line_break():
    assert extract_metadata('Task 2d "one\\ntwo"')["comment"] == "one\ntwo"


def test_escaped_backslash_is_not_a_line_break():
    assert extract_metadata('Task 2d "a\\\\nb C:\\temp"')["comment"] == "a\\nb C:\\temp"
