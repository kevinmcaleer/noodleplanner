import os
import sys
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import app as app_module
from db import create_tables

def setup_module(module):
    create_tables()

def test_pfd_tab_renders_products(tmp_path, monkeypatch):
    # Use a temp DB for isolation
    test_db = tmp_path / 'pfd_test.db'
    monkeypatch.setenv('NOODLEPLANNER_DB', str(test_db))
    create_tables()
    client = TestClient(app_module.app)
    # Register and login a user
    client.post('/register', data={'username': 'pfduser', 'fullname': 'PFD User', 'password': 'secret'})
    client.post('/login', data={'username': 'pfduser', 'password': 'secret'})
    # Create a project
    resp = client.post('/projects/create', data={'project_name': 'PFD Project'})
    assert resp.status_code in (200, 302)
    # Find project id
    projects_resp = client.get('/projects')
    assert 'PFD Project' in projects_resp.text
    import re
    match = re.search(r'/projects/(\d+)', projects_resp.text)
    assert match, 'Project link not found in projects page'
    project_id = match.group(1)
    # Add a product
    client.post(f'/projects/{project_id}/products', data={'product_name': 'Widget'})
    # Access the flow-canvas tab
    flow_resp = client.get(f'/projects/{project_id}/flow-canvas')
    assert flow_resp.status_code == 200
    # The product name should appear in the HTML (even if not connected)
    assert 'Widget' in flow_resp.text, 'Product name not rendered in PFD tab HTML'
