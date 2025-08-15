

# --- Imports and Router Setup ---
from fastapi import APIRouter, Depends, HTTPException, status, Request, Form
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from db import get_user_by_username, get_projects_by_username, get_project_with_products, add_product_to_project, get_db
from models import UserInDB

router = APIRouter()
templates = Jinja2Templates(directory="templates")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# --- Helper to get user id from UserInDB ---
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
    add_product_to_project(project_id, product_name.strip())
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
    from db import get_db
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

