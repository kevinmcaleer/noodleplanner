"""Pytest configuration and shared fixtures for all tests.

This module defines session-scoped fixtures that are shared across all tests
to avoid expensive re-initialization overhead. See issue #443.
"""

import pytest
from io import BytesIO
import openpyxl


@pytest.fixture(scope="session")
def sample_excel_workbook():
    """Create a sample Excel workbook for testing imports.
    
    Session-scoped to avoid recreating the workbook for each test.
    This fixture is particularly important for RAID Excel Import tests
    which would normally take ~6s each due to openpyxl overhead.
    """
    workbook = openpyxl.Workbook()
    
    # Create sample sheets
    ws1 = workbook.active
    ws1.title = "Tasks"
    ws1['A1'] = "Task Name"
    ws1['B1'] = "Duration"
    ws1['C1'] = "Resources"
    ws1['A2'] = "Task 1"
    ws1['B2'] = 3
    ws1['C2'] = "John"
    
    ws2 = workbook.create_sheet("Resources")
    ws2['A1'] = "Resource Name"
    ws2['B1'] = "Role"
    ws2['A2'] = "John Doe"
    ws2['B2'] = "Developer"
    
    return workbook


@pytest.fixture(scope="session")
def sample_excel_bytes():
    """Create sample Excel bytes for upload testing.
    
    Session-scoped to share the same byte stream across tests.
    """
    workbook = openpyxl.Workbook()
    ws = workbook.active
    ws['A1'] = "Task Name"
    ws['B1'] = "Duration"
    ws['A2'] = "Task 1"
    ws['B2'] = 3
    
    bytes_io = BytesIO()
    workbook.save(bytes_io)
    bytes_io.seek(0)
    return bytes_io.getvalue()
