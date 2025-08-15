
from fastapi import APIRouter, Depends, HTTPException, status, Request, Form
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from db import get_user_by_username, get_projects_by_username
from models import UserInDB

router = APIRouter()
templates = Jinja2Templates(directory="templates")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")



from fastapi import APIRouter, Depends, HTTPException, status, Request, Form
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from db import get_user_by_username, get_projects_by_username
from models import UserInDB





# Helper to get user id from UserInDB
def user_dict_id(user):
    # Always fetch the user ID directly from the database for reliability
    from db import get_db
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE username = ?', (user.username,))
        row = cursor.fetchone()
        return row[0] if row else None


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
    user_id = user_dict_id(user) if user else None
    print(f"DEBUG: user_id from user_dict_id: {user_id}", flush=True)
    if not user:
        print("DEBUG: No user found, redirecting to login", flush=True)
        return RedirectResponse(url="/login", status_code=302)
    if not project_name.strip():
        projects = get_projects_by_username(user.username)
        return templates.TemplateResponse(request, "projects.html", {"projects": projects, "error": "Project name cannot be empty.", "success": None})
    from db import get_db
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''INSERT INTO projects (name, owner) VALUES (?, ?)''', (project_name.strip(), user_id))
        conn.commit()
    projects = get_projects_by_username(user.username)
    return templates.TemplateResponse(request, "projects.html", {"projects": projects, "error": None, "success": "Project created successfully!"})



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
    return templates.TemplateResponse(request, "projects.html", {"projects": projects})

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

