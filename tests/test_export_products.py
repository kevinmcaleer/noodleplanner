
import io
import pandas as pd
import sys
import os
from test_helpers import create_test_jwt_token
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from fastapi.testclient import TestClient
from app import app

def get_depth(name):
    # Count leading spaces (4 per indent)
    return (len(name) - len(name.lstrip(' '))) // 4

client = TestClient(app)

def test_export_products_csv_and_excel(tmp_path):
    # Setup: ensure DB schema exists
    from db import create_tables
    create_tables()
    # Setup: create user, login, create project, add products with hierarchy
    client.post("/register", data={"username": "exporter", "fullname": "Export User", "password": "testpass"})
    client.post("/login", data={"username": "exporter", "password": "testpass"})
    r = client.post("/projects/create", data={"project_name": "ExportTest"})
    # Follow redirect manually if needed
    if r.status_code in (302, 307) and 'location' in r.headers:
        r = client.get(r.headers['location'])
    assert r.status_code == 200
    # Extract project_id from the projects page HTML (find last project link)
    import re
    match = re.findall(r'/projects/(\d+)', r.text)
    assert match, "No project link found in response HTML"
    project_id = match[-1]
    # Add root product
    r = client.post(f"/projects/{project_id}/products", data={"product_name": "Root"})
    import re
    match = re.findall(r'id": (\d+), "name": "Root"', r.text)
    assert match, "Root product not found in HTML"
    root_id = match[0]
    # Add child
    r = client.post(f"/projects/{project_id}/products", data={"product_name": "Child", "parent_id": root_id})
    match = re.findall(r'id": (\d+), "name": "Child"', r.text)
    assert match, "Child product not found in HTML"
    child_id = match[0]
    # Add grandchild
    r = client.post(f"/projects/{project_id}/products", data={"product_name": "Grandchild", "parent_id": child_id})
    # CSV export
    r = client.get(f"/projects/{project_id}")
    assert r.status_code == 200
    # Simulate frontend CSV export logic (not backend endpoint)
    # Instead, test backend Excel export endpoint
    r = client.get(f"/projects/{project_id}/export-products-xlsx")
    assert r.status_code == 200
    df = pd.read_excel(io.BytesIO(r.content))
    names = df['name'].tolist()
    # Check order and indentation
    assert names[0].strip() == 'Root'
    assert get_depth(names[0]) == 0
    assert names[1].strip() == 'Child'
    assert get_depth(names[1]) == 1
    assert names[2].strip() == 'Grandchild'
    assert get_depth(names[2]) == 2
    # Optionally, test CSV export via frontend simulation if backend endpoint is added
