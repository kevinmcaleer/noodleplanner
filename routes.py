

from fastapi.responses import StreamingResponse, HTMLResponse, RedirectResponse, JSONResponse
import pandas as pd
import io
from fastapi.templating import Jinja2Templates
from db import get_user_by_username, get_projects_by_username, get_project_with_products, add_product_to_project, get_db
from models import UserInDB



# --- Update product parent (plan_id) for dependency tree ---
from fastapi import APIRouter, Depends, HTTPException, status, Request, Form, Body
from fastapi import Path
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
## (Removed duplicate imports)
router = APIRouter()
templates = Jinja2Templates(directory="templates")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# --- Export Product List to Excel ---
@router.get("/projects/{project_id}/export-products-xlsx")
async def export_products_xlsx(request: Request, project_id: int):
    username = request.cookies.get("token")
    if not username:
        return RedirectResponse(url="/login", status_code=302)
    user = get_user(username)
    if not user:
        return RedirectResponse(url="/login", status_code=302)
    project = get_project_with_products(project_id)
    if not project:
        return HTMLResponse("Project not found", status_code=404)
    products = project.get("products", [])
    # (prod_dict removed; not used)
    # Build children map
    from collections import defaultdict
    children = defaultdict(list)
    for p in products:
        parent = p["plan_id"]
        children[parent].append(p)
    # Sort children by sort_order
    for plist in children.values():
        plist.sort(key=lambda x: (x["sort_order"], x["id"]))
    # Depth-first traversal to get ordered list with depth
    def dfs(parent_id, depth, out):
        for p in children.get(parent_id, []):
            out.append({**p, "depth": depth})
            dfs(p["id"], depth+1, out)
    ordered = []
    dfs(None, 0, ordered)
    # Indent name for Excel
    for p in ordered:
        p["indented_name"] = ("    " * p["depth"]) + p["name"]
    # DataFrame for Excel
    df = pd.DataFrame([{k: v for k, v in p.items() if k in ["id", "indented_name", "plan_id", "sort_order"]} for p in ordered])
    df.rename(columns={"indented_name": "name"}, inplace=True)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Products")
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=product-list-{project_id}.xlsx"}
    )

# --- Product Move Endpoints (Up, Down, Indent, Outdent) ---
@router.post("/projects/move-product-up/{product_id}")
async def move_product_up(request: Request, product_id: int = Path(...)):
    username = request.cookies.get("token")
    user = get_user(username) if username else None
    if not user:
        return JSONResponse({"success": False, "error": "Not authenticated"}, status_code=401)
    user_id = get_user_id(user)
    with get_db() as conn:
        cursor = conn.cursor()
        # Get product info
        cursor.execute("SELECT id, project_id, plan_id, sort_order FROM products WHERE id = ?", (product_id,))
        prod = cursor.fetchone()
        if not prod:
            return JSONResponse({"success": False, "error": "Product not found"}, status_code=404)
        _, project_id, plan_id, sort_order = prod
        # Only allow if user owns project
        cursor.execute("SELECT owner FROM projects WHERE id = ?", (project_id,))
        row = cursor.fetchone()
        if not row or row[0] != user_id:
            return JSONResponse({"success": False, "error": "Permission denied"}, status_code=403)
        # Find previous sibling (same parent, lower sort_order)
        cursor.execute("SELECT id, sort_order FROM products WHERE project_id = ? AND (plan_id IS ? OR (plan_id IS NULL AND ? IS NULL)) AND sort_order < ? ORDER BY sort_order DESC LIMIT 1", (project_id, plan_id, plan_id, sort_order))
        prev = cursor.fetchone()
        if not prev:
            return JSONResponse({"success": True, "moved": False})
        prev_id, prev_order = prev
        # Swap sort_order
        cursor.execute("UPDATE products SET sort_order = ? WHERE id = ?", (prev_order, product_id))
        cursor.execute("UPDATE products SET sort_order = ? WHERE id = ?", (sort_order, prev_id))
        conn.commit()
    return JSONResponse({"success": True, "moved": True})

@router.post("/projects/move-product-down/{product_id}")
async def move_product_down(request: Request, product_id: int = Path(...)):
    username = request.cookies.get("token")
    user = get_user(username) if username else None
    if not user:
        return JSONResponse({"success": False, "error": "Not authenticated"}, status_code=401)
    user_id = get_user_id(user)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, project_id, plan_id, sort_order FROM products WHERE id = ?", (product_id,))
        prod = cursor.fetchone()
        if not prod:
            return JSONResponse({"success": False, "error": "Product not found"}, status_code=404)
        _, project_id, plan_id, sort_order = prod
        cursor.execute("SELECT owner FROM projects WHERE id = ?", (project_id,))
        row = cursor.fetchone()
        if not row or row[0] != user_id:
            return JSONResponse({"success": False, "error": "Permission denied"}, status_code=403)
        # Find next sibling (same parent, higher sort_order)
        cursor.execute("SELECT id, sort_order FROM products WHERE project_id = ? AND (plan_id IS ? OR (plan_id IS NULL AND ? IS NULL)) AND sort_order > ? ORDER BY sort_order ASC LIMIT 1", (project_id, plan_id, plan_id, sort_order))
        next = cursor.fetchone()
        if not next:
            return JSONResponse({"success": True, "moved": False})
        next_id, next_order = next
        cursor.execute("UPDATE products SET sort_order = ? WHERE id = ?", (next_order, product_id))
        cursor.execute("UPDATE products SET sort_order = ? WHERE id = ?", (sort_order, next_id))
        conn.commit()
    return JSONResponse({"success": True, "moved": True})

@router.post("/projects/indent-product/{product_id}")
async def indent_product(request: Request, product_id: int = Path(...)):
    username = request.cookies.get("token")
    user = get_user(username) if username else None
    if not user:
        return JSONResponse({"success": False, "error": "Not authenticated"}, status_code=401)
    user_id = get_user_id(user)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, project_id, plan_id, sort_order FROM products WHERE id = ?", (product_id,))
        prod = cursor.fetchone()
        if not prod:
            return JSONResponse({"success": False, "error": "Product not found"}, status_code=404)
        _, project_id, plan_id, sort_order = prod
        cursor.execute("SELECT owner FROM projects WHERE id = ?", (project_id,))
        row = cursor.fetchone()
        if not row or row[0] != user_id:
            return JSONResponse({"success": False, "error": "Permission denied"}, status_code=403)
        # Find previous sibling
        cursor.execute("SELECT id FROM products WHERE project_id = ? AND (plan_id IS ? OR (plan_id IS NULL AND ? IS NULL)) AND sort_order < ? ORDER BY sort_order DESC LIMIT 1", (project_id, plan_id, plan_id, sort_order))
        prev = cursor.fetchone()
        if not prev:
            return JSONResponse({"success": True, "indented": False})
        prev_id = prev[0]
        # Set this product's plan_id to previous sibling's id, and set sort_order to max+1 among new siblings
        cursor.execute("SELECT COALESCE(MAX(sort_order), 0) FROM products WHERE project_id = ? AND plan_id = ?", (project_id, prev_id))
        max_order = cursor.fetchone()[0] or 0
        cursor.execute("UPDATE products SET plan_id = ?, sort_order = ? WHERE id = ?", (prev_id, max_order + 1, product_id))
        conn.commit()
    return JSONResponse({"success": True, "indented": True})

@router.post("/projects/outdent-product/{product_id}")
async def outdent_product(request: Request, product_id: int = Path(...)):
    username = request.cookies.get("token")
    user = get_user(username) if username else None
    if not user:
        return JSONResponse({"success": False, "error": "Not authenticated"}, status_code=401)
    user_id = get_user_id(user)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, project_id, plan_id FROM products WHERE id = ?", (product_id,))
        prod = cursor.fetchone()
        if not prod:
            return JSONResponse({"success": False, "error": "Product not found"}, status_code=404)
        _, project_id, plan_id = prod
        cursor.execute("SELECT owner FROM projects WHERE id = ?", (project_id,))
        row = cursor.fetchone()
        if not row or row[0] != user_id:
            return JSONResponse({"success": False, "error": "Permission denied"}, status_code=403)
        if plan_id is None:
            return JSONResponse({"success": True, "outdented": False})
        # Find parent product's plan_id (grandparent)
        cursor.execute("SELECT plan_id FROM products WHERE id = ?", (plan_id,))
        parent = cursor.fetchone()
        new_plan_id = parent[0] if parent else None
        # Set sort_order to max+1 among new siblings
        cursor.execute("SELECT COALESCE(MAX(sort_order), 0) FROM products WHERE project_id = ? AND (plan_id IS ? OR (plan_id IS NULL AND ? IS NULL))", (project_id, new_plan_id, new_plan_id))
        max_order = cursor.fetchone()[0] or 0
        cursor.execute("UPDATE products SET plan_id = ?, sort_order = ? WHERE id = ?", (new_plan_id, max_order + 1, product_id))
        conn.commit()
    return JSONResponse({"success": True, "outdented": True})

# --- Update product sort_order and parent (plan_id) ---
@router.post("/projects/update-product-order/{product_id}")
async def update_product_order(request: Request, product_id: int, payload: dict = Body(...)):
    username = request.cookies.get("token")
    user = get_user(username) if username else None
    if not user:
        return JSONResponse({"success": False, "error": "Not authenticated"}, status_code=401)
    user_id = get_user_id(user)
    plan_id = payload.get("plan_id", None)
    sort_order = payload.get("sort_order", None)
    # Support updating new fields if present
    description = payload.get("description")
    dependencies = payload.get("dependencies")
    resources = payload.get("resources")
    skills = payload.get("skills")
    derived_from = payload.get("derived_from")
    composed_of = payload.get("composed_of")
    acceptance_criteria = payload.get("acceptance_criteria")
    with get_db() as conn:
        cursor = conn.cursor()
        # Only allow update if user owns the project this product belongs to
        cursor.execute("SELECT p.project_id, pr.owner, p.plan_id, p.sort_order FROM products p JOIN projects pr ON p.project_id = pr.id WHERE p.id = ?", (product_id,))
        row = cursor.fetchone()
        if not row or row[1] != user_id:
            return JSONResponse({"success": False, "error": "Permission denied"}, status_code=403)
        project_id_db = row[0]
        current_plan_id = row[2]
        current_sort_order = row[3]
        # Only update plan_id and sort_order if explicitly provided in payload
        update_fields = []
        update_values = []
        if plan_id is not None:
            update_fields.append("plan_id = ?")
            update_values.append(plan_id)
        if sort_order is not None:
            update_fields.append("sort_order = ?")
            update_values.append(sort_order)
        if description is not None:
            update_fields.append("description = ?")
            update_values.append(description)
        if dependencies is not None:
            update_fields.append("dependencies = ?")
            update_values.append(dependencies)
        if resources is not None:
            update_fields.append("resources = ?")
            update_values.append(resources)
        if skills is not None:
            update_fields.append("skills = ?")
            update_values.append(skills)
        if derived_from is not None:
            update_fields.append("derived_from = ?")
            update_values.append(derived_from)
        if composed_of is not None:
            update_fields.append("composed_of = ?")
            update_values.append(composed_of)
        if acceptance_criteria is not None:
            update_fields.append("acceptance_criteria = ?")
            update_values.append(acceptance_criteria)
        if update_fields:
            update_values.append(product_id)
            cursor.execute(f"UPDATE products SET {', '.join(update_fields)} WHERE id = ?", update_values)

        # Only re-sequence if sort_order or plan_id was changed
        if plan_id is not None or sort_order is not None:
            effective_plan_id = plan_id if plan_id is not None else current_plan_id
            if effective_plan_id is None:
                cursor.execute("SELECT id FROM products WHERE project_id = ? AND plan_id IS NULL ORDER BY sort_order ASC, id ASC", (project_id_db,))
            else:
                cursor.execute("SELECT id FROM products WHERE project_id = ? AND plan_id = ? ORDER BY sort_order ASC, id ASC", (project_id_db, effective_plan_id))
            siblings = [r[0] for r in cursor.fetchall()]
            for idx, sib_id in enumerate(siblings, start=1):
                cursor.execute("UPDATE products SET sort_order = ? WHERE id = ?", (idx, sib_id))

        # Ensure all plan_id references are valid (set to NULL if parent does not exist)
        cursor.execute("UPDATE products SET plan_id = NULL WHERE plan_id IS NOT NULL AND plan_id NOT IN (SELECT id FROM products)")

        conn.commit()
    return JSONResponse({"success": True})
templates = Jinja2Templates(directory="templates")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

@router.post("/projects/delete-product/{product_id}")
async def delete_product(request: Request, product_id: int):
    username = request.cookies.get("token")
    user = get_user(username) if username else None
    if not user:
        return JSONResponse({"success": False, "error": "Not authenticated"}, status_code=401)
    user_id = get_user_id(user)
    with get_db() as conn:
        cursor = conn.cursor()
        # Only allow delete if user owns the project this product belongs to
        cursor.execute("SELECT p.project_id, pr.owner FROM products p JOIN projects pr ON p.project_id = pr.id WHERE p.id = ?", (product_id,))
        row = cursor.fetchone()
        if not row or row[1] != user_id:
            return JSONResponse({"success": False, "error": "Permission denied"}, status_code=403)
        # Outdent all children (set their plan_id to null)
        cursor.execute("UPDATE products SET plan_id = NULL WHERE plan_id = ?", (product_id,))
        # Delete the product
        cursor.execute("DELETE FROM products WHERE id = ?", (product_id,))
        conn.commit()
    return JSONResponse({"success": True})

# --- Update product parent (plan_id) for dependency tree ---






@router.post("/projects/update-product-parent/{product_id}")
async def update_product_parent(request: Request, product_id: int, payload: dict = Body(...)):
    username = request.cookies.get("token")
    user = get_user(username) if username else None
    if not user:
        return JSONResponse({"success": False, "error": "Not authenticated"}, status_code=401)
    user_id = get_user_id(user)
    plan_id = payload.get("plan_id")
    with get_db() as conn:
        cursor = conn.cursor()
        # Only allow update if user owns the project this product belongs to
        cursor.execute("SELECT p.project_id, pr.owner FROM products p JOIN projects pr ON p.project_id = pr.id WHERE p.id = ?", (product_id,))
        row = cursor.fetchone()
        if not row or row[1] != user_id:
            return JSONResponse({"success": False, "error": "Permission denied"}, status_code=403)
        cursor.execute("UPDATE products SET plan_id = ? WHERE id = ?", (plan_id, product_id))
        conn.commit()
    return JSONResponse({"success": True})
def get_user_id(user):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE username = ?', (user.username,))
        row = cursor.fetchone()
        return row[0] if row else None

# --- Rename Endpoints for AJAX Inline Editing ---
@router.post("/rename-project/{project_id}")
async def rename_project(request: Request, project_id: int):
    username = request.cookies.get("token")
    user = get_user(username) if username else None
    if not user:
        return JSONResponse({"success": False, "error": "Not authenticated"}, status_code=401)
    user_id = get_user_id(user)
    data = await request.json()
    new_name = data.get("name", "").strip()
    if not new_name:
        return JSONResponse({"success": False, "error": "Name cannot be empty"}, status_code=400)
    with get_db() as conn:
        cursor = conn.cursor()
        # Only allow renaming if user owns the project
        cursor.execute("SELECT owner FROM projects WHERE id = ?", (project_id,))
        row = cursor.fetchone()
        if not row or row[0] != user_id:
            return JSONResponse({"success": False, "error": "Permission denied"}, status_code=403)
        cursor.execute("UPDATE projects SET name = ? WHERE id = ?", (new_name, project_id))
        conn.commit()
    return JSONResponse({"success": True})

@router.post("/rename-product/{product_id}")
async def rename_product(request: Request, product_id: int):
    username = request.cookies.get("token")
    user = get_user(username) if username else None
    if not user:
        return JSONResponse({"success": False, "error": "Not authenticated"}, status_code=401)
    user_id = get_user_id(user)
    data = await request.json()
    new_name = data.get("name", "").strip()
    if not new_name:
        return JSONResponse({"success": False, "error": "Name cannot be empty"}, status_code=400)
    with get_db() as conn:
        cursor = conn.cursor()
        # Only allow renaming if user owns the project this product belongs to
        cursor.execute("SELECT p.project_id, pr.owner FROM products p JOIN projects pr ON p.project_id = pr.id WHERE p.id = ?", (product_id,))
        row = cursor.fetchone()
        if not row or row[1] != user_id:
            return JSONResponse({"success": False, "error": "Permission denied"}, status_code=403)
        cursor.execute("UPDATE products SET name = ? WHERE id = ?", (new_name, product_id))
        conn.commit()
    return JSONResponse({"success": True})

# --- Planning Room Backend Routes ---
@router.get("/projects/{project_id}", response_class=HTMLResponse)
async def planning_room(request: Request, project_id: int):
    username = request.cookies.get("token")
    if not username:
        return RedirectResponse(url="/login", status_code=302)
    user = get_user(username)
    if not user:
        return RedirectResponse(url="/login", status_code=302)
    project = get_project_with_products(project_id)
    if not project:
        return HTMLResponse("Project not found", status_code=404)
    return templates.TemplateResponse(request, "planning_room.html", {"project": project, "user": user})

@router.post("/projects/{project_id}/products", response_class=HTMLResponse)
async def add_product(request: Request, project_id: int, product_name: str = Form(...)):
    username = request.cookies.get("token")
    if not username:
        return RedirectResponse(url="/login", status_code=302)
    user = get_user(username)
    if not user:
        return RedirectResponse(url="/login", status_code=302)
    if not product_name.strip():
        project = get_project_with_products(project_id)
        return templates.TemplateResponse(request, "planning_room.html", {"project": project, "user": user, "error": "Product name cannot be empty."})
    form = await request.form()
    plan_id = form.get("parent_id")
    if plan_id is not None and plan_id != '':
        if isinstance(plan_id, str):
            try:
                plan_id = int(plan_id)
            except Exception:
                plan_id = None
        else:
            plan_id = None
    else:
        plan_id = None
    add_product_to_project(project_id, product_name.strip(), plan_id)
    project = get_project_with_products(project_id)
    return templates.TemplateResponse(request, "planning_room.html", {"project": project, "user": user, "success": "Product added successfully!"})





@router.post("/projects/create", response_class=HTMLResponse)
async def create_project(request: Request, project_name: str = Form(...)):
    print("DEBUG: /projects/create route hit", flush=True)
    username = request.cookies.get("token")
    print(f"DEBUG: username from cookie: {username}", flush=True)
    if not username:
        print("DEBUG: No username in cookie, redirecting to login", flush=True)
        return RedirectResponse(url="/login", status_code=302)
    user = get_user(username)
    print(f"DEBUG: user from get_user: {user}", flush=True)
    user_id = get_user_id(user) if user else None
    print(f"DEBUG: user_id from user_dict_id: {user_id}", flush=True)
    if not user:
        print("DEBUG: No user found, redirecting to login", flush=True)
        return RedirectResponse(url="/login", status_code=302)
    if not project_name.strip():
        projects = get_projects_by_username(user.username)
        return templates.TemplateResponse(request, "projects.html", {"projects": projects, "user": user, "error": "Project name cannot be empty.", "success": None})
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''INSERT INTO projects (name, owner) VALUES (?, ?)''', (project_name.strip(), user_id))
        conn.commit()
    projects = get_projects_by_username(user.username)
    return templates.TemplateResponse(request, "projects.html", {"projects": projects, "user": user, "error": None, "success": "Project created successfully!"})



@router.get("/register", response_class=HTMLResponse)
async def register_page(request: Request):
    return templates.TemplateResponse(request, "register.html", {"error": None, "success": None})


@router.post("/register", response_class=HTMLResponse)
async def register_submit(request: Request, username: str = Form(...), fullname: str = Form(...), password: str = Form(...)):
    # Check if user exists
    if get_user(username):
        return templates.TemplateResponse(request, "register.html", {"error": "Username already taken", "success": None})
    # Add user to DB
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''INSERT INTO users (username, full_name, hashed_password, disabled) VALUES (?, ?, ?, ?)''',
            (username, fullname, fake_hash_password(password), 0))
        conn.commit()
    return templates.TemplateResponse(request, "register.html", {"error": None, "success": "Registration successful! Please log in."})



@router.get("/", response_class=HTMLResponse)
async def root_redirect(request: Request):
    token = request.cookies.get("token")
    user = get_user(token) if token else None
    if user:
        return RedirectResponse(url="/projects", status_code=302)
    else:
        return RedirectResponse(url="/login", status_code=302)


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse(request, "login.html", {"error": None})


@router.post("/login", response_class=HTMLResponse)
async def login_submit(request: Request, username: str = Form(...), password: str = Form(...)):
    user = authenticate_user(username, password)
    if not user:
        return templates.TemplateResponse(request, "login.html", {"error": "Invalid username or password"})
    response = RedirectResponse(url="/projects", status_code=302)
    response.set_cookie(key="token", value=user.username, httponly=True)
    return response

@router.post("/logout")
async def logout(request: Request):
    response = RedirectResponse(url="/login", status_code=302)
    response.delete_cookie(key="token")
    return response


@router.get("/projects", response_class=HTMLResponse)
async def projects_page(request: Request):
    token = request.cookies.get("token")
    user = get_user(token) if token else None
    if not user:
        return RedirectResponse(url="/login", status_code=302)
    projects = get_projects_by_username(user.username)
    return templates.TemplateResponse(request, "projects.html", {"projects": projects, "user": user})

def fake_hash_password(password: str):
    return "fakehashed" + password

def get_user(username: str):
    user_dict = get_user_by_username(username)
    if user_dict:
        return UserInDB(**user_dict)

def authenticate_user(username: str, password: str):
    user = get_user(username)
    if not user:
        return None
    if user.hashed_password != fake_hash_password(password):
        return None
    return user


@router.post("/token")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = authenticate_user(form_data.username, form_data.password)


    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {"access_token": user.username, "token_type": "bearer"}

@router.get("/users/me")
async def read_users_me(token: str = Depends(oauth2_scheme)):
    user = get_user(token)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid authentication credentials")
    return user

