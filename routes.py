
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from models import User, UserInDB
from db import get_user_by_username, add_test_user, create_tables, get_projects_by_username
from fastapi import Request

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

@router.get("/projects")
async def list_user_projects(request: Request, token: str = Depends(oauth2_scheme)):
    user = get_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    projects = get_projects_by_username(user.username)
    return {"projects": projects}

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

@router.post("/logout")
async def logout():
    # In a real app, you would handle token blacklisting or session invalidation
    return {"message": "Logged out successfully"}
