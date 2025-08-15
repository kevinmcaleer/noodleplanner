import requests

BASE_URL = "http://localhost:8000"

# Assumes a running server and a project with at least two products, one parent and one child

def test_edit_description_does_not_break_connection():
    # 1. Get project and products
    r = requests.get(f"{BASE_URL}/projects/1", params={"ajax": 1})
    assert r.status_code == 200
    products = r.json()["products"] if r.headers.get('content-type') == 'application/json' else []
    parent = next((p for p in products if p['plan_id'] is None), None)
    child = next((p for p in products if p['plan_id'] == (parent['id'] if parent else None)), None)
    assert parent and child

    # 2. Edit child's description
    payload = {"description": "Updated description"}
    r2 = requests.post(f"{BASE_URL}/projects/update-product-order/{child['id']}", json=payload)
    assert r2.status_code == 200

    # 3. Fetch products again
    r3 = requests.get(f"{BASE_URL}/projects/1", params={"ajax": 1})
    products2 = r3.json()["products"] if r3.headers.get('content-type') == 'application/json' else []
    child2 = next((p for p in products2 if p['id'] == child['id']), None)
    assert child2['plan_id'] == parent['id']
    print("Test passed: Editing description does not break connection.")

if __name__ == "__main__":
    test_edit_description_does_not_break_connection()
