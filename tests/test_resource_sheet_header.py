"""The resource sheet's date header at every time scale (#799).

The sheet switches from one column per day to one per week, month or quarter
once a project outgrows the chart. At those scales a label (``13 nov``,
``Sep``, ``Q3``) is wider than a column, and each label used to be written
at every column, so the next one overwrote all but its first character:
``011200123...``, ``SONDJF...``, ``QQQQ...``. The browser port in
static/pdf-export.js mirrors this code; tests/test_pdf_docx_browser_export.mjs
holds the two to the same output.

Run with: uv run pytest tests/test_resource_sheet_header.py -q
"""

import re
from datetime import datetime, timedelta

import pytest

from noodle_core.renderers import render_resource_sheet

START = datetime(2026, 9, 4)

LABEL = {
    'week': re.compile(r'\d\d [a-z]{3}'),
    'month': re.compile(r'[A-Z][a-z]{2}'),
    'quarter': re.compile(r'Q[1-4]'),
}
PERIOD_DAYS = {'week': 7, 'month': 30, 'quarter': 90}


def period_label(scale, day):
    if scale == 'week':
        return day.strftime('%d %b').lower()
    if scale == 'month':
        return day.strftime('%b')
    return f"Q{(day.month - 1) // 3 + 1}"


def header(days, terminal_width=80, resource='kev'):
    """The chart part of the header row for one resource busy throughout."""
    finish = START + timedelta(days=days)
    tasks = [{'description': 'Work', 'start': START, 'finish': finish,
              'duration': timedelta(days=days), 'resources': resource}]
    sheet = render_resource_sheet(tasks, START, finish, terminal_width=terminal_width)
    row = sheet.split('\n')[2]
    assert row.startswith('Resource'), row
    return row[row.index('|', row.index('Hours')) + 1:-1]


@pytest.mark.parametrize('days, expected', [
    # day scale was already right and is unchanged
    (40, '04 sep    14 sep 21 sep 28 sep 05 oct 12'),
    (200, '04 sep 23 oct 11 dec 29 jan  '),
    (1000, 'Sep Jan May Aug Dec Apr Aug Dec   '),
    (3000, 'Q3 Q2 Q1 Q4 Q3 Q2 Q1 Q4 Q3 Q2 Q1  '),
])
def test_header_at_each_scale(days, expected):
    assert header(days) == expected


# Spans that fall in the same scale at both widths: a 62-column chart at 80,
# 102 at 120, and a scale is picked by how many periods the span needs.
@pytest.mark.parametrize('scale, days', [
    ('week', 150), ('week', 300), ('week', 420),
    ('month', 800), ('month', 1200), ('month', 1800),
    ('quarter', 3100), ('quarter', 5000), ('quarter', 8000),
])
@pytest.mark.parametrize('terminal_width', [80, 120])
def test_every_label_names_the_period_under_it(scale, days, terminal_width):
    """Labels are whole, apart, and each names the period its column starts."""
    row = header(days, terminal_width)
    labels = list(re.finditer(r'\S+(?: [a-z]{3})?', row))
    assert labels, f'no labels in {row!r}'
    assert labels[0].start() == 0, 'the first column is not labelled'
    for m in labels:
        assert LABEL[scale].fullmatch(m.group()), f'{m.group()!r} is not a {scale} label in {row!r}'
        day = START + timedelta(days=m.start() * PERIOD_DAYS[scale])
        assert m.group() == period_label(scale, day), f'wrong label at column {m.start()} in {row!r}'
    for a, b in zip(labels, labels[1:]):
        assert b.start() > a.end(), f'{a.group()!r} and {b.group()!r} touch in {row!r}'


def test_a_chart_narrower_than_a_label_still_shows_where_it_starts():
    # A long name leaves the minimum 20-column chart; 21 days is 3 weeks.
    row = header(21, terminal_width=40, resource='a' * 40)
    assert row == '04 '
