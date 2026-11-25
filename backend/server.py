import asyncio
import base64
import json
import logging
import os
import re
import uuid
from contextlib import suppress
from datetime import datetime, timedelta, timezone, date
from pathlib import Path
from typing import Annotated, Any, List, Optional

import bcrypt
import jwt
import requests
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field
from pymongo import ASCENDING, DESCENDING, IndexModel
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("fridgechef")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_EXPIRE_MINUTES = int(os.environ["JWT_EXPIRE_MINUTES"])
EMERGENT_KEY = os.environ["EMERGENT_LLM_KEY"]
APP_NAME = os.environ["APP_NAME"]
GEMINI_MODEL = "gemini-3-flash-preview"

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
storage_key: Optional[str] = None
AI_SEMAPHORE = asyncio.Semaphore(1)  # the AI proxy allows limited concurrent requests per key
BACKGROUND_TASKS: set = set()

INDEXES: dict[str, list[IndexModel]] = {
    "users": [IndexModel([("email", ASCENDING)], name="email_unique", unique=True)],
    "pantry_items": [IndexModel([("user_id", ASCENDING), ("expiry_date", ASCENDING)], name="user_expiry")],
    "meal_plans": [IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_created")],
    "recipes": [
        IndexModel([("id", ASCENDING)], name="id_unique", unique=True),
        IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_created"),
    ],
    "shopping_items": [IndexModel([("user_id", ASCENDING), ("aisle", ASCENDING)], name="user_aisle")],
    "leftover_scans": [IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_created")],
    "files": [IndexModel([("storage_path", ASCENDING)], name="path")],
    "points_events": [IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_created")],
    "quest_claims": [IndexModel([("user_id", ASCENDING), ("week", ASCENDING), ("key", ASCENDING)], name="claim_unique", unique=True)],
    "meal_logs": [IndexModel([("user_id", ASCENDING), ("date", ASCENDING)], name="user_date")],
    "calendar_entries": [IndexModel([("user_id", ASCENDING), ("date", ASCENDING)], name="user_date")],
    "share_links": [IndexModel([("token", ASCENDING)], name="token_unique", unique=True)],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)


# ---------------------------------------------------------------- Mongo models
def _oid_to_str(v: Any) -> str:
    return str(v) if isinstance(v, ObjectId) else v


PyObjectId = Annotated[str, BeforeValidator(_oid_to_str)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    @classmethod
    def from_mongo(cls, doc: dict):
        return cls.model_validate(doc)

    def to_mongo(self) -> dict:
        d = self.model_dump(by_alias=True, exclude={"id"})
        if self.id:
            d["_id"] = ObjectId(self.id)
        return d


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Profile(BaseModel):
    name: str = ""
    household_size: int = 2
    weekly_budget: float = 80
    currency: str = "$"
    appliances: List[str] = ["Stove", "Oven", "Microwave"]
    family_mode: bool = False
    allergies: List[str] = []
    diets: List[str] = []
    stores: List[str] = []
    onboarded: bool = False


class UserDoc(BaseDocument):
    email: str
    password_hash: str
    created_at: str
    profile: Profile = Profile()


class PantryItem(BaseDocument):
    user_id: str
    name: str
    quantity: str = ""
    category: str = "Other"
    expiry_date: Optional[str] = None  # YYYY-MM-DD
    created_at: str


class Ingredient(BaseModel):
    name: str
    quantity: str = ""
    from_pantry: bool = False


class Nutrition(BaseModel):
    calories: float = 0
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    fiber: float = 0


class Recipe(BaseModel):
    date: str = ""
    status: str = ""  # proposed | accepted | manual | declined | "" (unscheduled)
    favorite: bool = False
    eaten_log_id: str = ""
    cooked: bool = False
    nutrition: Nutrition = Nutrition()
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = ""
    source: str = "plan"
    meal_type: str = "Dinner"
    title: str
    description: str = ""
    time_minutes: int = 30
    servings: int = 2
    est_cost: float = 0
    appliance: str = ""
    ingredients: List[Ingredient] = []
    steps: List[str] = []
    uses_expiring: List[str] = []
    created_at: str = Field(default_factory=now_iso)


class PlanDay(BaseModel):
    day: str
    date: str
    meals: List[Recipe] = []


class MealPlan(BaseDocument):
    user_id: str
    status: str = "generating"  # generating | ready | failed
    error: str = ""
    week_start: str
    days: List[PlanDay] = []
    total_cost: float = 0
    tips: List[str] = []
    scope: str = "week"
    mode: str = "pantry_plus"
    grocery: dict = {}
    created_at: str


class ShoppingItem(BaseDocument):
    user_id: str
    name: str
    quantity: str = ""
    aisle: str = "Other"
    est_cost: float = 0
    checked: bool = False
    source: str = "manual"  # manual | plan
    needed_for: List[dict] = []
    reason: str = "missing"  # missing | top_up | manual
    pantry_have: str = ""
    product: str = ""
    prices: dict = {}
    created_at: str


class LeftoverScan(BaseDocument):
    user_id: str
    photo_path: str = ""
    leftovers: List[str] = []
    recipe_ids: List[str] = []
    created_at: str


# ---------------------------------------------------------------- request bodies
class RegisterBody(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=6, max_length=128)
    name: str = ""


class LoginBody(BaseModel):
    email: str
    password: str


class PantryIn(BaseModel):
    name: str = Field(min_length=1)
    quantity: str = ""
    category: str = "Other"
    expiry_date: Optional[str] = None


class PantryBulkIn(BaseModel):
    items: List[PantryIn]


class ShoppingIn(BaseModel):
    name: str = Field(min_length=1)
    quantity: str = ""
    aisle: str = "Other"


class ShoppingPatch(BaseModel):
    checked: bool


# ---------------------------------------------------------------- auth
bearer = HTTPBearer(auto_error=False)


def make_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": user_id, "iat": now, "exp": now + timedelta(minutes=JWT_EXPIRE_MINUTES)}, JWT_SECRET, algorithm="HS256")


def decode_token(token: str) -> str:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        uid = payload.get("sub")
        if not uid or not ObjectId.is_valid(uid):
            raise ValueError()
        return uid
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session")


async def current_user(creds: Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer)]) -> UserDoc:
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated")
    uid = decode_token(creds.credentials)
    doc = await db.users.find_one({"_id": ObjectId(uid)})
    if not doc:
        raise HTTPException(status_code=401, detail="User no longer exists")
    return UserDoc.from_mongo(doc)


def public_user(u: UserDoc) -> dict:
    return {"id": u.id, "email": u.email, "profile": u.profile.model_dump()}


# ---------------------------------------------------------------- storage
def init_storage() -> str:
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> tuple[bytes, str]:
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


async def store_photo(user_id: str, data: bytes, content_type: str, filename: str) -> str:
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "jpg").lower()[:5]
    path = f"{APP_NAME}/uploads/{user_id}/{uuid.uuid4()}.{ext}"
    try:
        result = await run_in_threadpool(put_object, path, data, content_type)
        stored = result.get("path", path)
        await db.files.insert_one({"storage_path": stored, "owner_id": user_id, "content_type": content_type, "original_filename": filename, "is_deleted": False, "created_at": now_iso()})
        return stored
    except Exception as exc:  # scanning should still work if storage fails
        logger.error("photo upload failed: %s", exc)
        return ""


# ---------------------------------------------------------------- AI helpers
def parse_json(text: str) -> Any:
    t = text.strip()
    t = re.sub(r"^```(?:json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    try:
        return json.loads(t)
    except Exception:
        m = re.search(r"(\{.*\}|\[.*\])", t, re.S)
        if m:
            return json.loads(m.group(1))
        raise


async def ask_gemini(system: str, prompt: str, image_b64: Optional[str] = None) -> Any:
    from emergentintegrations.llm.chat import ImageContent, LlmChat, StreamDone, TextDelta, UserMessage

    msg = UserMessage(text=prompt, file_contents=[ImageContent(image_base64=image_b64)]) if image_b64 else UserMessage(text=prompt)
    last_exc: Exception = RuntimeError("AI unavailable")
    for attempt in range(4):
        try:
            async with AI_SEMAPHORE:
                chat = LlmChat(api_key=EMERGENT_KEY, session_id=str(uuid.uuid4()), system_message=system).with_model("gemini", GEMINI_MODEL)
                out = []
                async for ev in chat.stream_message(msg):
                    if isinstance(ev, TextDelta):
                        out.append(ev.content)
                    elif isinstance(ev, StreamDone):
                        break
            return parse_json("".join(out))
        except Exception as exc:
            last_exc = exc
            if "429" not in str(exc) and "concurrent" not in str(exc).lower() and attempt >= 1:
                break
            await asyncio.sleep(2 * (attempt + 1))
    raise last_exc


def profile_context(p: Profile) -> str:
    lines = [
        f"Household size: {p.household_size} people",
        f"Weekly food budget: {p.currency}{p.weekly_budget:g}",
        f"Cooking appliances available (ONLY use these): {', '.join(p.appliances) or 'Stove'}",
    ]
    if p.family_mode:
        lines.append(f"FAMILY MODE ON. Strict allergies (never include): {', '.join(p.allergies) or 'none'}")
        lines.append(f"Dietary restrictions (always respect): {', '.join(p.diets) or 'none'}")
    return "\n".join(lines)


def pantry_context(items: List[PantryItem]) -> str:
    today = date.today()
    rows = []
    for it in items:
        tag = ""
        if it.expiry_date:
            with suppress(Exception):
                d = (date.fromisoformat(it.expiry_date) - today).days
                tag = f" (expires in {d} days)" if d >= 0 else " (EXPIRED)"
        rows.append(f"- {it.name} {it.quantity}{tag}".strip())
    return "\n".join(rows) or "(pantry is empty)"


RECIPE_SCHEMA = '{"meal_type":"Breakfast|Lunch|Snack|Dinner","title":str,"description":str (1 sentence),"time_minutes":int,"servings":int,"est_cost":number,"appliance":str,"ingredients":[{"name":str,"quantity":str (exact measurement e.g. 2 tbsp, 200 g),"from_pantry":bool}],"steps":[str (max 6 short steps)],"uses_expiring":[str],"nutrition":{"calories":number,"protein":number,"carbs":number,"fat":number,"fiber":number} (per serving, grams)}'

CATEGORIES = ["Produce", "Dairy", "Meat", "Seafood", "Bakery", "Pantry", "Frozen", "Drinks", "Condiments", "Snacks", "Other"]


# ---------------------------------------------------------------- app
app = FastAPI()


@app.get("/health", include_in_schema=False)
@app.head("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


api = APIRouter(prefix="/api")


@api.get("/")
async def root():
    return {"message": "Fresh Start API"}


# ---- auth
@api.post("/auth/register", status_code=201)
async def register(body: RegisterBody):
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=422, detail="Enter a valid email")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already registered")
    user = UserDoc(email=email, password_hash=bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode(), created_at=now_iso(), profile=Profile(name=body.name.strip()))
    try:
        res = await db.users.insert_one(user.to_mongo())
    except Exception as exc:
        if "duplicate" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Email already registered")
        raise
    user.id = str(res.inserted_id)
    return {"access_token": make_token(user.id), "user": public_user(user)}


@api.post("/auth/login")
async def login(body: LoginBody):
    doc = await db.users.find_one({"email": body.email.strip().lower()})
    if not doc or not bcrypt.checkpw(body.password.encode(), doc["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    user = UserDoc.from_mongo(doc)
    return {"access_token": make_token(user.id), "user": public_user(user)}


@api.get("/auth/me")
async def me(user: UserDoc = Depends(current_user)):
    return public_user(user)


# ---- profile
@api.get("/profile")
async def get_profile(user: UserDoc = Depends(current_user)):
    return user.profile.model_dump()


@api.put("/profile")
async def put_profile(body: Profile, user: UserDoc = Depends(current_user)):
    body.household_size = max(1, min(body.household_size, 20))
    body.weekly_budget = max(0, body.weekly_budget)
    await db.users.update_one({"_id": ObjectId(user.id)}, {"$set": {"profile": body.model_dump()}})
    return body.model_dump()


# ---- pantry
@api.get("/pantry")
async def list_pantry(user: UserDoc = Depends(current_user)):
    docs = await db.pantry_items.find({"user_id": user.id}).to_list(1000)
    items = [PantryItem.from_mongo(d).model_dump() for d in docs]
    items.sort(key=lambda x: (x["expiry_date"] is None, x["expiry_date"] or "", x["name"].lower()))
    return items


def new_pantry(user_id: str, p: PantryIn) -> PantryItem:
    cat = p.category if p.category in CATEGORIES else "Other"
    return PantryItem(user_id=user_id, name=p.name.strip(), quantity=p.quantity.strip(), category=cat, expiry_date=p.expiry_date or None, created_at=now_iso())


@api.post("/pantry")
async def add_pantry(body: PantryIn, user: UserDoc = Depends(current_user)):
    item = new_pantry(user.id, body)
    res = await db.pantry_items.insert_one(item.to_mongo())
    item.id = str(res.inserted_id)
    return item.model_dump()


@api.post("/pantry/bulk")
async def add_pantry_bulk(body: PantryBulkIn, user: UserDoc = Depends(current_user)):
    items = [new_pantry(user.id, p) for p in body.items if p.name.strip()]
    if items:
        await db.pantry_items.insert_many([i.to_mongo() for i in items])
    return {"added": len(items)}


@api.put("/pantry/{item_id}")
async def update_pantry(item_id: str, body: PantryIn, user: UserDoc = Depends(current_user)):
    if not ObjectId.is_valid(item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    upd = new_pantry(user.id, body).model_dump(exclude={"id", "created_at", "user_id"})
    res = await db.pantry_items.find_one_and_update({"_id": ObjectId(item_id), "user_id": user.id}, {"$set": upd}, return_document=True)
    if not res:
        raise HTTPException(status_code=404, detail="Item not found")
    return PantryItem.from_mongo(res).model_dump()


@api.delete("/pantry/{item_id}")
async def delete_pantry(item_id: str, user: UserDoc = Depends(current_user)):
    if not ObjectId.is_valid(item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    res = await db.pantry_items.delete_one({"_id": ObjectId(item_id), "user_id": user.id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}


async def read_image(file: UploadFile) -> tuple[bytes, str]:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty photo")
    if len(data) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Photo is too large")
    ctype = file.content_type or "image/jpeg"
    if not ctype.startswith("image/"):
        ctype = "image/jpeg"
    return data, ctype


# ---- scans
@api.post("/scan/pantry")
async def scan_pantry(file: UploadFile = File(...), user: UserDoc = Depends(current_user)):
    data, ctype = await read_image(file)
    photo_path = await store_photo(user.id, data, ctype, file.filename or "scan.jpg")
    system = "You are a precise kitchen inventory assistant. You identify food items in photos of fridges, pantries and cupboards. Respond with JSON only."
    prompt = (
        "List every distinct food or drink item visible in this photo. For each estimate quantity and how many days until it likely expires "
        f"(fresh produce short, canned/dry goods long). Category must be one of {CATEGORIES}.\n"
        'Return JSON: {"items":[{"name":str,"quantity":str,"category":str,"expiry_days":int}]}. If no food is visible return {"items":[]}.'
    )
    try:
        result = await ask_gemini(system, prompt, base64.b64encode(data).decode())
    except Exception as exc:
        logger.error("scan_pantry AI failed: %s", exc)
        raise HTTPException(status_code=502, detail="We couldn't read that photo. Please try again.")
    today = date.today()
    items = []
    for it in (result.get("items") or [])[:60]:
        name = str(it.get("name", "")).strip()
        if not name:
            continue
        days = it.get("expiry_days")
        exp = (today + timedelta(days=int(days))).isoformat() if isinstance(days, (int, float)) else None
        cat = it.get("category") if it.get("category") in CATEGORIES else "Other"
        items.append({"name": name.title() if name.islower() else name, "quantity": str(it.get("quantity") or ""), "category": cat, "expiry_date": exp})
    if items:
        await award(user.id, "scan", 5)
    return {"photo_path": photo_path, "items": items}


async def recent_titles(user_id: str, limit: int = 60) -> List[str]:
    docs = await db.recipes.find({"user_id": user_id}, {"title": 1, "_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return list({d["title"] for d in docs})


def clean_recipe(raw: dict, user_id: str, source: str) -> Recipe:
    ings = []
    for i in raw.get("ingredients") or []:
        if isinstance(i, dict) and i.get("name"):
            ings.append(Ingredient(name=str(i["name"]), quantity=str(i.get("quantity") or ""), from_pantry=bool(i.get("from_pantry"))))
    mt = str(raw.get("meal_type") or "Dinner").title()
    return Recipe(
        user_id=user_id,
        source=source,
        meal_type=mt if mt in ("Breakfast", "Lunch", "Snack", "Dinner") else "Dinner",
        title=str(raw.get("title") or "Untitled meal"),
        description=str(raw.get("description") or ""),
        time_minutes=int(raw.get("time_minutes") or 30),
        servings=int(raw.get("servings") or 2),
        est_cost=float(raw.get("est_cost") or 0),
        appliance=str(raw.get("appliance") or ""),
        ingredients=ings,
        steps=[str(s) for s in (raw.get("steps") or [])][:10],
        uses_expiring=[str(s) for s in (raw.get("uses_expiring") or [])],
        nutrition=clean_nutrition(raw.get("nutrition")),
    )


def clean_nutrition(raw: Any) -> Nutrition:
    raw = raw if isinstance(raw, dict) else {}
    out = {}
    for k in ("calories", "protein", "carbs", "fat", "fiber"):
        try:
            out[k] = round(max(0.0, num(raw.get(k) or raw.get("fibre" if k == "fiber" else k))), 1)
        except Exception:
            out[k] = 0.0
    return Nutrition(**out)


@api.post("/scan/leftovers")
async def scan_leftovers(file: UploadFile = File(...), user: UserDoc = Depends(current_user)):
    data, ctype = await read_image(file)
    photo_path = await store_photo(user.id, data, ctype, file.filename or "leftovers.jpg")
    pantry = [PantryItem.from_mongo(d) for d in await db.pantry_items.find({"user_id": user.id}).to_list(300)]
    avoid = await recent_titles(user.id)
    system = "You are a creative, budget-savvy home chef who transforms leftovers into brand new meals. Respond with JSON only."
    prompt = (
        "Identify the leftover foods in this photo, then invent 3 NEW meals that reuse them (not just reheating).\n"
        f"{profile_context(user.profile)}\n\nOther ingredients available in the pantry:\n{pantry_context(pantry)}\n\n"
        f"Do NOT repeat any of these previous meals: {', '.join(avoid) or 'none'}\n"
        f'Return JSON: {{"leftovers":[str],"recipes":[{RECIPE_SCHEMA}]}}. Mark leftovers/pantry items as from_pantry=true.'
    )
    try:
        result = await ask_gemini(system, prompt, base64.b64encode(data).decode())
    except Exception as exc:
        logger.error("scan_leftovers AI failed: %s", exc)
        raise HTTPException(status_code=502, detail="We couldn't read that photo. Please try again.")
    recipes = [clean_recipe(r, user.id, "leftover") for r in (result.get("recipes") or [])[:4] if isinstance(r, dict)]
    if recipes:
        await db.recipes.insert_many([r.model_dump() for r in recipes])
    scan = LeftoverScan(user_id=user.id, photo_path=photo_path, leftovers=[str(x) for x in result.get("leftovers") or []], recipe_ids=[r.id for r in recipes], created_at=now_iso())
    await db.leftover_scans.insert_one(scan.to_mongo())
    if recipes:
        await award(user.id, "leftover", 5)
    return {"leftovers": scan.leftovers, "recipes": [r.model_dump() for r in recipes], "photo_path": photo_path}


# ---- recipes
@api.get("/recipes/{recipe_id}")
async def get_recipe(recipe_id: str, user: UserDoc = Depends(current_user)):
    doc = await db.recipes.find_one({"id": recipe_id, "user_id": user.id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return Recipe(**doc).model_dump()


@api.get("/recipes")
async def list_leftover_recipes(source: str = Query("leftover"), user: UserDoc = Depends(current_user)):
    docs = await db.recipes.find({"user_id": user.id, "source": source}, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)
    return [Recipe(**d).model_dump() for d in docs]


# ---- meal plans
@api.get("/plans/current")
async def current_plan(user: UserDoc = Depends(current_user)):
    latest = await db.meal_plans.find_one({"user_id": user.id}, sort=[("created_at", -1)])
    if not latest:
        return {"plan": None, "latest_ready": None}
    latest_m = MealPlan.from_mongo(latest).model_dump()
    if latest_m["status"] == "ready":
        return {"plan": latest_m, "latest_ready": latest_m}
    ready = await db.meal_plans.find_one({"user_id": user.id, "status": "ready"}, sort=[("created_at", -1)])
    return {"plan": latest_m, "latest_ready": MealPlan.from_mongo(ready).model_dump() if ready else None}


# ---- shopping
@api.get("/shopping")
async def list_shopping(user: UserDoc = Depends(current_user)):
    docs = await db.shopping_items.find({"user_id": user.id}).sort([("aisle", 1), ("name", 1)]).to_list(500)
    stores = stores_of(user.profile)
    if any(not d.get("checked") and any(not (d.get("prices") or {}).get(st) for st in stores) for d in docs):
        schedule_pricing(user.id)
    return [ShoppingItem.from_mongo(d).model_dump() for d in docs]


@api.post("/shopping")
async def add_shopping(body: ShoppingIn, user: UserDoc = Depends(current_user)):
    for d in await db.shopping_items.find({"user_id": user.id, "checked": False}).to_list(1000):
        if names_match(body.name, d["name"]):
            return ShoppingItem.from_mongo(d).model_dump()
    item = ShoppingItem(user_id=user.id, name=body.name.strip(), quantity=body.quantity.strip(), aisle=body.aisle if body.aisle in CATEGORIES else "Other", created_at=now_iso())
    res = await db.shopping_items.insert_one(item.to_mongo())
    item.id = str(res.inserted_id)
    schedule_pricing(user.id)
    return item.model_dump()


@api.patch("/shopping/{item_id}")
async def patch_shopping(item_id: str, body: ShoppingPatch, user: UserDoc = Depends(current_user)):
    if not ObjectId.is_valid(item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    res = await db.shopping_items.find_one_and_update({"_id": ObjectId(item_id), "user_id": user.id}, {"$set": {"checked": body.checked}}, return_document=True)
    if not res:
        raise HTTPException(status_code=404, detail="Item not found")
    return ShoppingItem.from_mongo(res).model_dump()


@api.delete("/shopping/checked")
async def clear_checked(user: UserDoc = Depends(current_user)):
    res = await db.shopping_items.delete_many({"user_id": user.id, "checked": True})
    return {"deleted": res.deleted_count}


@api.delete("/shopping/{item_id}")
async def delete_shopping(item_id: str, user: UserDoc = Depends(current_user)):
    if not ObjectId.is_valid(item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    res = await db.shopping_items.delete_one({"_id": ObjectId(item_id), "user_id": user.id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}


# ================================================================ v2 features
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def check_date(d: str) -> str:
    if not DATE_RE.match(d or ""):
        raise HTTPException(status_code=422, detail="Date must be YYYY-MM-DD")
    return d


def names_match(a: str, b: str) -> bool:
    a, b = a.lower().strip(), b.lower().strip()
    if not a or not b:
        return False
    if a == b or a in b or b in a:
        return True
    aw = {w.rstrip("s") for w in re.findall(r"[a-z]+", a) if len(w) > 2}
    bw = {w.rstrip("s") for w in re.findall(r"[a-z]+", b) if len(w) > 2}
    return bool(aw & bw) and (len(aw) == 1 or len(bw) == 1)


def num(v: Any, default: float = 0.0) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d+(?:\.\d+)?", str(v or ""))
    return float(m.group()) if m else default


PRICING: dict[str, bool] = {}


def schedule_pricing(user_id: str):
    """Background: price unpriced shopping items at every preferred store and tidy combined quantities."""
    if PRICING.get(user_id) is not None:
        PRICING[user_id] = True  # rerun after current pass
        return
    PRICING[user_id] = False
    task = asyncio.create_task(_price_loop(user_id))
    BACKGROUND_TASKS.add(task)
    task.add_done_callback(BACKGROUND_TASKS.discard)


async def _price_loop(user_id: str):
    try:
        while True:
            await price_items(user_id)
            if not PRICING.get(user_id):
                break
            PRICING[user_id] = False
    except Exception as exc:
        logger.error("pricing failed: %s", exc)
    finally:
        PRICING.pop(user_id, None)


async def price_items(user_id: str):
    udoc = await db.users.find_one({"_id": ObjectId(user_id)})
    prof = Profile(**(udoc or {}).get("profile", {}))
    stores = stores_of(prof)
    docs = await db.shopping_items.find({"user_id": user_id, "checked": False}).to_list(500)
    todo = [d for d in docs if any(not (d.get("prices") or {}).get(st) for st in stores) or " + " in (d.get("quantity") or "")][:40]
    if not todo:
        return
    lines = "\n".join(f"- id={d['_id']} | {d['name']} | needed: " + ("; ".join(n.get("quantity", "") for n in d.get("needed_for") or [] if n.get("quantity")) or d.get("quantity", "")) for d in todo)
    res = await ask_gemini(
        "You are a grocery pricing assistant for Canadian and US supermarkets. JSON only.",
        f"Stores: {', '.join(stores)}. Currency {prof.currency}.\nFor each item: total_quantity = one clean combined amount to buy (sum the needed amounts sensibly, e.g. '115 g; 320 g' -> '435 g (buy 450 g block)'); "
        "product = a typical product with package size; prices = realistic current shelf price at EVERY store (non-zero); aisle one of " + str(CATEGORIES) + ".\n" + lines +
        '\nReturn JSON {"items":[{"id":str,"total_quantity":str,"product":str,"aisle":str,"prices":{store:number}}]}',
    )
    ids = {str(d["_id"]) for d in todo}
    for it in res.get("items") or []:
        if not isinstance(it, dict) or it.get("id") not in ids:
            continue
        prices = {str(k): round(num(v), 2) for k, v in (it.get("prices") or {}).items() if num(v) > 0}
        upd: dict = {"prices": prices, "est_cost": min(prices.values()) if prices else 0}
        if it.get("total_quantity"):
            upd["quantity"] = str(it["total_quantity"])
        if it.get("product"):
            upd["product"] = str(it["product"])
        if it.get("aisle") in CATEGORIES:
            upd["aisle"] = it["aisle"]
        await db.shopping_items.update_one({"_id": ObjectId(it["id"]), "user_id": user_id}, {"$set": upd})


# ---- points / quests / badges
class PointsEvent(BaseDocument):
    user_id: str
    type: str  # cook | rescue | log | scan | leftover | entry | quest
    points: int
    amount: int = 1
    date: str
    created_at: str


async def award(user_id: str, etype: str, points: int, amount: int = 1) -> int:
    ev = PointsEvent(user_id=user_id, type=etype, points=points, amount=amount, date=date.today().isoformat(), created_at=now_iso())
    await db.points_events.insert_one(ev.to_mongo())
    if points:
        await db.users.update_one({"_id": ObjectId(user_id)}, {"$inc": {"points": points}})
    return points


QUESTS = [
    {"key": "cook3", "title": "Cook 3 planned meals", "metric": "cook", "target": 3, "points": 30, "icon": "flame"},
    {"key": "rescue5", "title": "Rescue 5 expiring items", "metric": "rescue", "target": 5, "points": 40, "icon": "leaf"},
    {"key": "log5", "title": "Log meals on 5 different days", "metric": "log_days", "target": 5, "points": 30, "icon": "nutrition"},
    {"key": "scan1", "title": "Scan your fridge or leftovers", "metric": "scan", "target": 1, "points": 10, "icon": "scan"},
    {"key": "entry2", "title": "Add 2 meals to your calendar", "metric": "entry", "target": 2, "points": 15, "icon": "calendar"},
]

BADGES = [
    {"key": "first_feast", "title": "First Feast", "desc": "Cook your first planned meal", "metric": "cook", "target": 1, "icon": "restaurant"},
    {"key": "kitchen_hero", "title": "Kitchen Hero", "desc": "Cook 25 planned meals", "metric": "cook", "target": 25, "icon": "trophy"},
    {"key": "waste_warrior", "title": "Waste Warrior", "desc": "Rescue 10 expiring items", "metric": "rescue", "target": 10, "icon": "leaf"},
    {"key": "macro_master", "title": "Macro Master", "desc": "Log 20 meals", "metric": "log", "target": 20, "icon": "barbell"},
    {"key": "scan_star", "title": "Scan Star", "desc": "Do 5 scans", "metric": "scan", "target": 5, "icon": "star"},
    {"key": "quest_champ", "title": "Quest Champ", "desc": "Complete 5 quests", "metric": "quest", "target": 5, "icon": "ribbon"},
    {"key": "centurion", "title": "Pomegranate Pro", "desc": "Earn 500 points", "metric": "points", "target": 500, "icon": "diamond"},
]

LEVELS = ["Fresh Sprout", "Home Cook", "Kitchen Pro", "Pantry Master", "Head Chef", "Legend"]


def week_bounds() -> tuple[str, str, str]:
    today = date.today()
    start = today - timedelta(days=today.weekday())
    y, w, _ = today.isocalendar()
    return start.isoformat(), (start + timedelta(days=6)).isoformat(), f"{y}-W{w:02d}"


def metrics_from(events: List[dict]) -> dict:
    m = {"cook": 0, "rescue": 0, "log": 0, "scan": 0, "entry": 0, "quest": 0, "points": 0}
    log_days = set()
    for e in events:
        t = e["type"]
        m["points"] += e.get("points", 0)
        if t == "cook":
            m["cook"] += 1
        elif t == "rescue":
            m["rescue"] += e.get("amount", 1)
        elif t == "log":
            m["log"] += 1
            log_days.add(e["date"])
        elif t in ("scan", "leftover"):
            m["scan"] += 1
        elif t in ("entry", "quest"):
            m[t] += 1
    m["log_days"] = len(log_days)
    return m


@api.get("/rewards")
async def rewards(user: UserDoc = Depends(current_user)):
    events = await db.points_events.find({"user_id": user.id}, {"_id": 0}).to_list(10000)
    life = metrics_from(events)
    ws, we, wk = week_bounds()
    week = metrics_from([e for e in events if ws <= e["date"] <= we])
    claimed = {c["key"] for c in await db.quest_claims.find({"user_id": user.id, "week": wk}, {"_id": 0}).to_list(50)}
    doc = await db.users.find_one({"_id": ObjectId(user.id)}, {"points": 1})
    points = int((doc or {}).get("points", 0))
    level_idx = min(points // 150, len(LEVELS) - 1)
    quests = [
        {**q, "progress": min(week[q["metric"]], q["target"]), "complete": week[q["metric"]] >= q["target"], "claimed": q["key"] in claimed}
        for q in QUESTS
    ]
    badges = [{**b, "progress": min(life[b["metric"]], b["target"]), "earned": life[b["metric"]] >= b["target"]} for b in BADGES]
    recent = sorted(events, key=lambda e: e["created_at"], reverse=True)[:10]
    return {
        "points": points,
        "level": LEVELS[level_idx],
        "level_number": level_idx + 1,
        "next_level_at": (level_idx + 1) * 150 if level_idx < len(LEVELS) - 1 else None,
        "week": wk,
        "quests": quests,
        "badges": badges,
        "recent": [{"type": e["type"], "points": e["points"], "date": e["date"]} for e in recent],
    }


@api.post("/rewards/quests/{key}/claim")
async def claim_quest(key: str, user: UserDoc = Depends(current_user)):
    q = next((x for x in QUESTS if x["key"] == key), None)
    if not q:
        raise HTTPException(status_code=404, detail="Quest not found")
    ws, we, wk = week_bounds()
    events = await db.points_events.find({"user_id": user.id, "date": {"$gte": ws, "$lte": we}}, {"_id": 0}).to_list(5000)
    if metrics_from(events)[q["metric"]] < q["target"]:
        raise HTTPException(status_code=400, detail="Quest not complete yet")
    try:
        await db.quest_claims.insert_one({"user_id": user.id, "week": wk, "key": key, "created_at": now_iso()})
    except Exception:
        raise HTTPException(status_code=409, detail="Already claimed this week")
    await award(user.id, "quest", q["points"])
    return {"points_earned": q["points"]}


# ---- shopping helpers
async def find_recipe(user_id: str, recipe_id: str) -> Recipe:
    doc = await db.recipes.find_one({"id": recipe_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return Recipe(**doc)


# ---- cook a meal
class MealLog(BaseDocument):
    user_id: str
    date: str
    meal_type: str = "Snack"
    name: str
    calories: float = 0
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    fiber: float = 0
    recipe_id: str = ""
    quantity: float = 1
    unit: str = "serving"
    created_at: str


async def create_log(user_id: str, body: dict) -> dict:
    log = MealLog(user_id=user_id, created_at=now_iso(), **body)
    res = await db.meal_logs.insert_one(log.to_mongo())
    log.id = str(res.inserted_id)
    today_logs = await db.points_events.count_documents({"user_id": user_id, "type": "log", "date": date.today().isoformat()})
    await award(user_id, "log", 5 if today_logs < 4 else 0)
    return log.model_dump()


# ---- swap a meal
# ---- meal log + nutrition
class LogIn(BaseModel):
    date: str
    meal_type: str = "Snack"
    name: str = Field(min_length=1, max_length=120)
    calories: float = Field(0, ge=0, le=10000)
    protein: float = Field(0, ge=0, le=1000)
    carbs: float = Field(0, ge=0, le=1000)
    fat: float = Field(0, ge=0, le=1000)
    fiber: float = Field(0, ge=0, le=1000)
    quantity: float = Field(1, ge=0, le=100000)
    unit: str = "serving"


@api.post("/logs")
async def add_log(body: LogIn, user: UserDoc = Depends(current_user)):
    check_date(body.date)
    return await create_log(user.id, body.model_dump())


@api.get("/logs")
async def list_logs(date_: str = Query(..., alias="date"), user: UserDoc = Depends(current_user)):
    check_date(date_)
    docs = await db.meal_logs.find({"user_id": user.id, "date": date_}).sort("created_at", 1).to_list(200)
    return [MealLog.from_mongo(d).model_dump() for d in docs]


@api.delete("/logs/{log_id}")
async def delete_log(log_id: str, user: UserDoc = Depends(current_user)):
    if not ObjectId.is_valid(log_id):
        raise HTTPException(status_code=404, detail="Log not found")
    res = await db.meal_logs.delete_one({"_id": ObjectId(log_id), "user_id": user.id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Log not found")
    return {"ok": True}


# ================================================================ v3: connected planner
MEAL_TYPES = ("Breakfast", "Lunch", "Snack", "Dinner")
ACTIVE = ["proposed", "accepted", "manual"]


async def load_pantry(user_id: str) -> List[PantryItem]:
    return [PantryItem.from_mongo(d) for d in await db.pantry_items.find({"user_id": user_id}).to_list(1000)]


async def merge_shopping(user_id: str, items: List[dict], source: str = "plan") -> int:
    """Insert or combine shopping items. item keys: name, quantity, recipe_id, recipe_title, reason, pantry_have, aisle, est_cost, product, prices."""
    existing = [ShoppingItem.from_mongo(d) for d in await db.shopping_items.find({"user_id": user_id, "checked": False}).to_list(1000)]
    changed = 0
    for it in items:
        name = str(it.get("name") or "").strip()
        if not name:
            continue
        need = {"recipe_id": it.get("recipe_id", ""), "title": it.get("recipe_title", ""), "quantity": str(it.get("quantity") or "")}
        match = next((e for e in existing if names_match(name, e.name)), None)
        if match:
            if need["recipe_id"] and any(n.get("recipe_id") == need["recipe_id"] for n in match.needed_for):
                continue
            qty = match.quantity
            if need["quantity"] and need["quantity"] != qty:
                qty = f"{qty} + {need['quantity']}" if qty else need["quantity"]
            match.needed_for.append(need)
            match.quantity = qty
            upd = {"needed_for": match.needed_for, "quantity": qty}
            if it.get("prices") and not match.prices:
                upd.update(prices=it["prices"], product=str(it.get("product") or ""), est_cost=float(it.get("est_cost") or 0))
            await db.shopping_items.update_one({"_id": ObjectId(match.id)}, {"$set": upd})
        else:
            aisle = it.get("aisle") if it.get("aisle") in CATEGORIES else "Other"
            prices = {str(k): round(float(v), 2) for k, v in (it.get("prices") or {}).items() if isinstance(v, (int, float)) and v > 0}
            est = float(it.get("est_cost") or (min(prices.values()) if prices else 0))
            si = ShoppingItem(
                user_id=user_id, name=name, quantity=need["quantity"], aisle=aisle, est_cost=est, source=source,
                needed_for=[need] if (need["recipe_id"] or need["title"]) else [], reason=it.get("reason") or "missing",
                pantry_have=str(it.get("pantry_have") or ""), product=str(it.get("product") or ""), prices=prices, created_at=now_iso(),
            )
            res = await db.shopping_items.insert_one(si.to_mongo())
            si.id = str(res.inserted_id)
            existing.append(si)
        changed += 1
    return changed


async def recipe_to_shop(user_id: str, r: Recipe) -> int:
    pantry = await load_pantry(user_id)
    items = []
    for i in r.ingredients:
        if i.from_pantry or set(re.findall(r"[a-z]+", i.name.lower())) <= {"salt", "pepper", "black", "and", "water", "oil", "cooking", "vegetable", "olive", "to", "taste", "kosher", "sea", "ground"}:
            continue
        have = next((p for p in pantry if names_match(i.name, p.name)), None)
        items.append({"name": i.name, "quantity": i.quantity, "recipe_id": r.id, "recipe_title": r.title, "reason": "top_up" if have else "missing", "pantry_have": (have.quantity or "some") if have else ""})
    n = await merge_shopping(user_id, items)
    schedule_pricing(user_id)
    return n


async def unlink_shopping(user_id: str, recipe_ids: List[str]):
    docs = await db.shopping_items.find({"user_id": user_id, "checked": False, "needed_for.recipe_id": {"$in": recipe_ids}}).to_list(1000)
    for d in docs:
        left = [n for n in d.get("needed_for", []) if n.get("recipe_id") not in recipe_ids]
        if not left and d.get("source") != "manual":
            await db.shopping_items.delete_one({"_id": d["_id"]})
        else:
            await db.shopping_items.update_one({"_id": d["_id"]}, {"$set": {"needed_for": left, "quantity": " + ".join(n["quantity"] for n in left if n.get("quantity")) or d.get("quantity", "")}})


def stores_of(p: Profile) -> List[str]:
    return p.stores or ["Walmart", "No Frills"]


def grocery_rules(p: Profile) -> str:
    return (
        f"Price every shopping item at these grocery stores: {', '.join(stores_of(p))}, in {p.currency}, using realistic current shelf prices for a typical product "
        "(give product name with package size). The prices object MUST contain a non-zero price for EVERY one of these stores, and store_totals MUST include every store."
    )


# ---- plan generation
class PlanIn(BaseModel):
    scope: str = "week"  # week | day
    date: Optional[str] = None
    mode: str = "pantry_plus"  # pantry_only | pantry_plus
    schedule: dict = {}  # {date: ["09:00-17:00 Work", ...]}
    notes: str = ""


async def run_plan(plan_id: str, user: UserDoc, body: PlanIn):
    try:
        pantry = await load_pantry(user.id)
        avoid = await recent_titles(user.id)
        start = date.fromisoformat(body.date) if body.date else date.today()
        dates = [start + timedelta(days=i) for i in range(7 if body.scope == "week" else 1)]
        iso = [d.isoformat() for d in dates]
        accepted = await db.recipes.find({"user_id": user.id, "date": {"$in": iso}, "status": {"$in": ["accepted", "manual"]}}, {"_id": 0, "date": 1, "meal_type": 1, "title": 1}).to_list(200)
        taken = {(a["date"], a["meal_type"]) for a in accepted}
        sched = "\n".join(f"- {d}: {', '.join(v) or 'free'}" for d, v in (body.schedule or {}).items() if d in iso)
        pantry_rule = (
            "Use ONLY ingredients already in the pantry (water, salt, pepper and cooking oil allowed). The shopping_list must be empty."
            if body.mode == "pantry_only"
            else "Prioritise pantry ingredients; add new ingredients only when needed and keep them cheap."
        )
        slots = [f"{d.strftime('%A')} {d.isoformat()}: " + ", ".join(m for m in MEAL_TYPES if (d.isoformat(), m) not in taken) for d in dates]
        system = "You are an expert, budget-conscious family meal planner and nutritionist. Respond with compact JSON only."
        prompt = (
            "Plan meals for these open slots:\n" + "\n".join(slots) + "\n"
            f"{profile_context(user.profile)}\n\nPantry (with quantities):\n{pantry_context(pantry)}\n\n"
            f"Rules: {pantry_rule} Ingredients expiring soonest MUST be used first (list them in uses_expiring). "
            "Mark from_pantry=true only if the pantry has ENOUGH; if the pantry has some but not enough, from_pantry=false and include it in the shopping list with reason \"top_up\". "
            "Scale servings to the household size and give nutrition PER SERVING. Snacks are simple (<=10 min). No repeated titles"
            + (f"; avoid: {', '.join(avoid)}" if avoid else "")
            + ".\n"
            + (f"The user's calendar (busy times):\n{sched}\nFit time_minutes to the free time each day: busy days → quick meals (<=20 min); free evenings → longer recipes; account for events right before/after meals.\n" if sched else "")
            + (f"User notes: {body.notes}\n" if body.notes else "")
            + f"{grocery_rules(user.profile)} Keep the TOTAL shopping cost within the weekly budget ({user.profile.currency}{user.profile.weekly_budget:g}"
            + (" scaled to one day" if body.scope == "day" else "")
            + "); if over, swap in cheaper ingredients that keep nutrition and list those substitutions.\n"
            f'Return JSON: {{"days":[{{"date":"YYYY-MM-DD","meals":[{RECIPE_SCHEMA}]}}],'
            '"shopping_list":[{"name":str,"quantity":str (combined total),"aisle":str,"reason":"missing|top_up","pantry_have":str,"for_meals":[meal title],"product":str,"prices":{store:number}}],'
            '"store_totals":{store:number},"cheapest_store":str,"substitutions":[str],"tips":[str]}. '
            f"aisle one of {CATEGORIES}."
        )
        result = await ask_gemini(system, prompt)
        old = await db.recipes.find({"user_id": user.id, "date": {"$in": iso}, "status": "proposed"}, {"id": 1}).to_list(500)
        old_ids = [o["id"] for o in old]
        if old_ids:
            await db.recipes.update_many({"id": {"$in": old_ids}}, {"$set": {"status": "declined"}})
            await unlink_shopping(user.id, old_ids)
        recipes: List[Recipe] = []
        for rd in result.get("days") or []:
            if not isinstance(rd, dict) or rd.get("date") not in iso:
                continue
            for m in rd.get("meals") or []:
                if isinstance(m, dict):
                    r = clean_recipe(m, user.id, "plan")
                    if (rd["date"], r.meal_type) in taken:
                        continue
                    r.date, r.status = rd["date"], "proposed"
                    recipes.append(r)
        if not recipes:
            raise ValueError("AI returned no meals")
        await db.recipes.insert_many([r.model_dump() for r in recipes])
        by_title = {r.title.lower(): r for r in recipes}
        shop = []
        if body.mode != "pantry_only":
            for s in result.get("shopping_list") or []:
                if not isinstance(s, dict) or not s.get("name"):
                    continue
                fm = [by_title.get(str(t).lower()) for t in s.get("for_meals") or []]
                fm = [r for r in fm if r] or [None]
                for i, r in enumerate(fm):
                    shop.append({**s, "recipe_id": r.id if r else "", "recipe_title": r.title if r else "", "quantity": s.get("quantity") if i == 0 else ""})
            await merge_shopping(user.id, shop)
            schedule_pricing(user.id)
        grocery = {
            "store_totals": {str(k): round(float(v), 2) for k, v in (result.get("store_totals") or {}).items() if isinstance(v, (int, float)) and v > 0},
            "cheapest_store": str(result.get("cheapest_store") or ""),
            "substitutions": [str(x) for x in result.get("substitutions") or []][:6],
            "budget": user.profile.weekly_budget,
        }
        total = min(grocery["store_totals"].values()) if grocery["store_totals"] else 0
        await db.meal_plans.update_one({"_id": ObjectId(plan_id)}, {"$set": {"status": "ready", "total_cost": total, "grocery": grocery, "tips": [str(t) for t in result.get("tips") or []][:5]}})
    except Exception:
        logger.exception("plan generation failed")
        await db.meal_plans.update_one({"_id": ObjectId(plan_id)}, {"$set": {"status": "failed", "error": "Could not build your plan. Please try again."}})


@api.post("/plans/generate")
async def generate_plan(body: PlanIn = PlanIn(), user: UserDoc = Depends(current_user)):
    if body.date:
        check_date(body.date)
    existing = await db.meal_plans.find_one({"user_id": user.id, "status": "generating"})
    if existing and datetime.now(timezone.utc) - datetime.fromisoformat(existing["created_at"]) < timedelta(minutes=4):
        return MealPlan.from_mongo(existing).model_dump()
    plan = MealPlan(user_id=user.id, week_start=body.date or date.today().isoformat(), scope=body.scope, mode=body.mode, created_at=now_iso())
    res = await db.meal_plans.insert_one(plan.to_mongo())
    plan.id = str(res.inserted_id)
    task = asyncio.create_task(run_plan(plan.id, user, body))
    BACKGROUND_TASKS.add(task)
    task.add_done_callback(BACKGROUND_TASKS.discard)
    return plan.model_dump()


# ---- calendar range (day/week view)
@api.get("/calendar/range")
async def calendar_range(start: str, end: str, user: UserDoc = Depends(current_user)):
    check_date(start)
    check_date(end)
    meals = await db.recipes.find({"user_id": user.id, "date": {"$gte": start, "$lte": end}, "status": {"$in": ACTIVE}}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    logs = await db.meal_logs.find({"user_id": user.id, "date": {"$gte": start, "$lte": end}}).sort("created_at", 1).to_list(2000)
    days = []
    d = date.fromisoformat(start)
    while d.isoformat() <= end and len(days) < 42:
        k = d.isoformat()
        dl = [MealLog.from_mongo(x).model_dump() for x in logs if x["date"] == k]
        days.append({
            "date": k,
            "meals": [Recipe(**m).model_dump() for m in meals if m["date"] == k],
            "logs": dl,
            "totals": {n: round(sum(x[n] for x in dl), 1) for n in ("calories", "protein", "carbs", "fat", "fiber")},
        })
        d += timedelta(days=1)
    return {"days": days}


# ---- meal actions
class MoveIn(BaseModel):
    date: str
    meal_type: Optional[str] = None


@api.post("/recipes/{recipe_id}/accept")
async def accept_meal(recipe_id: str, user: UserDoc = Depends(current_user)):
    await find_recipe(user.id, recipe_id)
    await db.recipes.update_one({"id": recipe_id, "user_id": user.id}, {"$set": {"status": "accepted"}})
    return {"ok": True}


@api.post("/recipes/{recipe_id}/decline")
async def decline_meal(recipe_id: str, user: UserDoc = Depends(current_user)):
    await find_recipe(user.id, recipe_id)
    await db.recipes.update_one({"id": recipe_id, "user_id": user.id}, {"$set": {"status": "declined"}})
    await unlink_shopping(user.id, [recipe_id])
    return {"ok": True}


@api.post("/recipes/{recipe_id}/move")
async def move_meal(recipe_id: str, body: MoveIn, user: UserDoc = Depends(current_user)):
    check_date(body.date)
    await find_recipe(user.id, recipe_id)
    upd = {"date": body.date}
    if body.meal_type in MEAL_TYPES:
        upd["meal_type"] = body.meal_type
    await db.recipes.update_one({"id": recipe_id, "user_id": user.id}, {"$set": upd})
    return {"ok": True}


@api.post("/recipes/{recipe_id}/favorite")
async def toggle_favorite(recipe_id: str, user: UserDoc = Depends(current_user)):
    r = await find_recipe(user.id, recipe_id)
    await db.recipes.update_one({"id": recipe_id, "user_id": user.id}, {"$set": {"favorite": not r.favorite}})
    return {"favorite": not r.favorite}


@api.get("/favorites")
async def favorites(user: UserDoc = Depends(current_user)):
    docs = await db.recipes.find({"user_id": user.id, "favorite": True}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [Recipe(**d).model_dump() for d in docs]


@api.post("/recipes/{recipe_id}/schedule")
async def schedule_recipe(recipe_id: str, body: MoveIn, user: UserDoc = Depends(current_user)):
    check_date(body.date)
    r = await find_recipe(user.id, recipe_id)
    copy = r.model_copy(update={"id": str(uuid.uuid4()), "date": body.date, "status": "accepted", "favorite": False, "cooked": False, "eaten_log_id": "", "created_at": now_iso(), "meal_type": body.meal_type if body.meal_type in MEAL_TYPES else r.meal_type})
    await db.recipes.insert_one(copy.model_dump())
    added = await recipe_to_shop(user.id, copy)
    return {"recipe": copy.model_dump(), "shopping_added": added}


@api.post("/recipes/{recipe_id}/to-shopping")
async def recipe_to_shopping(recipe_id: str, user: UserDoc = Depends(current_user)):
    return {"added": await recipe_to_shop(user.id, await find_recipe(user.id, recipe_id))}


class EatIn(BaseModel):
    servings: float = Field(1, gt=0, le=20)


@api.post("/recipes/{recipe_id}/eat")
async def eat_meal(recipe_id: str, body: EatIn, user: UserDoc = Depends(current_user)):
    r = await find_recipe(user.id, recipe_id)
    nut = r.nutrition.model_dump()
    if not nut.get("calories"):
        with suppress(Exception):
            est = await ask_gemini("You are a dietitian. JSON only.", f"Nutrition for ONE serving of '{r.title}' made with: " + ", ".join(f"{i.quantity} {i.name}" for i in r.ingredients) + f" (recipe makes {r.servings} servings). Return JSON {{\"calories\":number,\"protein\":number,\"carbs\":number,\"fat\":number,\"fiber\":number}}")
            nut = clean_nutrition(est).model_dump()
            await db.recipes.update_one({"id": r.id}, {"$set": {"nutrition": nut}})
    vals = {k: round(v * body.servings, 1) for k, v in nut.items()}
    day = date.today().isoformat()  # logged when actually eaten
    if r.eaten_log_id and ObjectId.is_valid(r.eaten_log_id) and await db.meal_logs.find_one({"_id": ObjectId(r.eaten_log_id), "user_id": user.id}):
        await db.meal_logs.update_one({"_id": ObjectId(r.eaten_log_id)}, {"$set": {**vals, "quantity": body.servings, "unit": "serving"}})
        return {"updated": True, "log_id": r.eaten_log_id, **vals}
    log = await create_log(user.id, {"date": day, "meal_type": r.meal_type, "name": r.title, "recipe_id": r.id, "quantity": body.servings, "unit": "serving", **vals})
    await db.recipes.update_one({"id": r.id}, {"$set": {"eaten_log_id": log["id"]}})
    return {"updated": False, "log_id": log["id"], **vals}


@api.post("/recipes/{recipe_id}/cook")
async def cook_recipe(recipe_id: str, user: UserDoc = Depends(current_user)):
    r = await find_recipe(user.id, recipe_id)
    if r.cooked:
        raise HTTPException(status_code=409, detail="Already marked as cooked")
    pantry = await load_pantry(user.id)
    changes, rescued = [], 0
    if pantry:
        plist = "\n".join(f"- id={p.id} | {p.name} | {p.quantity or 'unknown amount'}" for p in pantry)
        ings = "\n".join(f"- {i.quantity} {i.name}" for i in r.ingredients)
        try:
            res = await ask_gemini(
                "You track kitchen inventory precisely. JSON only.",
                f"The user cooked '{r.title}' using:\n{ings}\n\nPantry:\n{plist}\n\n"
                "For each pantry item that was used, estimate what remains (e.g. a 500 ml sauce bottle minus 2 tbsp leaves ~470 ml). "
                "Only mark used_up when essentially nothing is left. Ignore pantry items not used.\n"
                'Return JSON {"updates":[{"id":str,"remaining":str,"used_up":bool}]}',
            )
            changes = [u for u in res.get("updates") or [] if isinstance(u, dict) and u.get("id") in {p.id for p in pantry}]
        except Exception as exc:
            logger.error("pantry deduction failed: %s", exc)
    today = date.today()
    pmap = {p.id: p for p in pantry}
    summary = []
    for u in changes:
        p = pmap[u["id"]]
        if p.expiry_date:
            with suppress(Exception):
                if (date.fromisoformat(p.expiry_date) - today).days <= 3:
                    rescued += 1
        if u.get("used_up"):
            await db.pantry_items.delete_one({"_id": ObjectId(p.id), "user_id": user.id})
            summary.append(f"{p.name}: used up")
        else:
            await db.pantry_items.update_one({"_id": ObjectId(p.id), "user_id": user.id}, {"$set": {"quantity": str(u.get("remaining") or p.quantity)}})
            summary.append(f"{p.name}: {u.get('remaining')} left")
    await db.recipes.update_one({"id": recipe_id, "user_id": user.id}, {"$set": {"cooked": True, "status": "accepted" if r.status == "proposed" else r.status}})
    pts = await award(user.id, "cook", 10)
    if rescued:
        pts += await award(user.id, "rescue", 5 * rescued, amount=rescued)
    return {"pantry_changes": summary, "rescued": rescued, "points_earned": pts}


class SwapIn(BaseModel):
    reason: str = ""
    craving: str = ""
    ingredients: str = ""


async def ai_recipe(user: UserDoc, ask: str, avoid: List[str]) -> Recipe:
    pantry = await load_pantry(user.id)
    prompt = (
        f"{ask}\n{profile_context(user.profile)}\n\nPantry (with quantities):\n{pantry_context(pantry)}\n\n"
        "Mark from_pantry=true only when the pantry has enough of it. Give exact measurements, nutrition PER SERVING and servings for the household."
        + (f" Must be different from: {', '.join(avoid)}." if avoid else "")
        + f"\nReturn JSON: {RECIPE_SCHEMA}"
    )
    raw = await ask_gemini("You are a creative, budget-savvy home chef and nutritionist. JSON only.", prompt)
    if isinstance(raw, dict) and isinstance(raw.get("recipe"), dict):
        raw = raw["recipe"]
    return clean_recipe(raw, user.id, "ai")


@api.post("/recipes/{recipe_id}/swap")
async def swap_recipe(recipe_id: str, body: SwapIn, user: UserDoc = Depends(current_user)):
    r = await find_recipe(user.id, recipe_id)
    fb = "\n".join(x for x in [f"Why they don't want it: {body.reason}" if body.reason else "", f"Craving instead: {body.craving}" if body.craving else "", f"Ingredients to use/avoid: {body.ingredients}" if body.ingredients else ""] if x)
    try:
        new = await ai_recipe(user, f"Replace the {r.meal_type} '{r.title}' with ONE better-matching {r.meal_type} recipe.\nUser feedback (follow it closely):\n{fb or 'Just wants something different.'}", [r.title] + await recent_titles(user.id, 20))
    except Exception as exc:
        logger.error("swap failed: %s", exc)
        raise HTTPException(status_code=502, detail="Couldn't find a swap right now. Please try again.")
    new.source, new.meal_type, new.date, new.status = r.source if r.source != "manual" else "ai", r.meal_type, r.date, "proposed"
    await db.recipes.insert_one(new.model_dump())
    await db.recipes.update_one({"id": r.id}, {"$set": {"status": "declined"}})
    await unlink_shopping(user.id, [r.id])
    added = await recipe_to_shop(user.id, new) if new.date else 0
    return {"recipe": new.model_dump(), "shopping_added": added}


class GenIn(BaseModel):
    kind: str = "craving"  # craving | ingredients
    prompt: str = ""
    context: str = ""
    pantry_ids: List[str] = []
    allow_extra: bool = True
    meal_type: str = "Dinner"
    date: Optional[str] = None


@api.post("/meals/generate")
async def generate_meal(body: GenIn, user: UserDoc = Depends(current_user)):
    mt = body.meal_type if body.meal_type in MEAL_TYPES else "Dinner"
    if body.kind == "ingredients":
        picked = [p for p in await load_pantry(user.id) if p.id in body.pantry_ids]
        if not picked:
            raise HTTPException(status_code=422, detail="Pick at least one ingredient")
        ask = f"Create ONE {mt} recipe built around these pantry ingredients: " + ", ".join(f"{p.name} ({p.quantity or 'some'})" for p in picked) + ". "
        ask += "You may add a few extra ingredients the user must buy (from_pantry=false)." if body.allow_extra else "Use ONLY the pantry (plus water/salt/pepper/oil). No extra purchases."
    else:
        if len(body.prompt.strip()) < 2:
            raise HTTPException(status_code=422, detail="Describe what you're craving")
        ask = f"Create ONE {mt} recipe that delivers EXACTLY this craving: {body.prompt.strip()}. Honour the dish type and flavours requested; use pantry items only where they fit the craving and add the missing ingredients to buy (from_pantry=false)."
    if body.context.strip():
        ask += f"\nExtra context from the user (follow it): {body.context.strip()}"
    try:
        r = await ai_recipe(user, ask, await recent_titles(user.id, 20))
    except Exception as exc:
        logger.error("generate meal failed: %s", exc)
        raise HTTPException(status_code=502, detail="Couldn't create a meal right now. Please try again.")
    r.meal_type = mt
    if body.date:
        r.date, r.status = check_date(body.date), "proposed"
    await db.recipes.insert_one(r.model_dump())
    added = await recipe_to_shop(user.id, r) if body.date else 0
    return {"recipe": r.model_dump(), "shopping_added": added}


class ManualIn(BaseModel):
    date: str
    meal_type: str = "Dinner"
    title: str = Field(min_length=1, max_length=120)
    ingredients: List[str] = []
    notes: str = ""
    ai_fill: bool = True
    add_to_shopping: bool = True


@api.post("/meals/manual")
async def add_manual(body: ManualIn, user: UserDoc = Depends(current_user)):
    check_date(body.date)
    ings = [i.strip() for i in body.ingredients if i.strip()][:40]
    r = None
    if body.ai_fill:
        with suppress(Exception):
            r = await ai_recipe(user, f"Write the full recipe for '{body.title}' ({body.meal_type})." + (f" It uses: {', '.join(ings)}." if ings else "") + (f" Notes: {body.notes}" if body.notes else ""), [])
            r.title = body.title.strip()
    if r is None:
        def split_q(t: str) -> Ingredient:
            m = re.match(r"^\s*([\d./½¼¾]+\s*(?:g|kg|ml|mL|l|L|oz|lbs?|cups?|tbsp|tsp|cloves?|cans?|packs?)?)\s+(.+)$", t)
            return Ingredient(name=m.group(2), quantity=m.group(1)) if m else Ingredient(name=t)
        r = Recipe(user_id=user.id, title=body.title.strip(), description=body.notes, ingredients=[split_q(i) for i in ings])
    r.source, r.status, r.date = "manual", "manual", body.date
    r.meal_type = body.meal_type if body.meal_type in MEAL_TYPES else "Dinner"
    await db.recipes.insert_one(r.model_dump())
    added = await recipe_to_shop(user.id, r) if body.add_to_shopping else 0
    await award(user.id, "entry", 3)
    return {"recipe": r.model_dump(), "shopping_added": added}


@api.delete("/meals/{recipe_id}")
async def delete_meal(recipe_id: str, user: UserDoc = Depends(current_user)):
    await find_recipe(user.id, recipe_id)
    await db.recipes.update_one({"id": recipe_id, "user_id": user.id}, {"$set": {"status": "declined"}})
    await unlink_shopping(user.id, [recipe_id])
    return {"ok": True}


# ---- shopping → pantry
async def shopping_to_pantry(user_id: str, docs: List[dict]) -> int:
    for d in docs:
        item = ShoppingItem.from_mongo(d)
        await db.pantry_items.insert_one(PantryItem(user_id=user_id, name=item.name, quantity=item.product or item.quantity, category=item.aisle if item.aisle in CATEGORIES else "Other", created_at=now_iso()).to_mongo())
        await db.shopping_items.delete_one({"_id": d["_id"]})
    return len(docs)


@api.post("/shopping/{item_id}/to-pantry")
async def item_to_pantry(item_id: str, user: UserDoc = Depends(current_user)):
    if not ObjectId.is_valid(item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    doc = await db.shopping_items.find_one({"_id": ObjectId(item_id), "user_id": user.id})
    if not doc:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"moved": await shopping_to_pantry(user.id, [doc])}


@api.post("/shopping/checked-to-pantry")
async def checked_to_pantry(user: UserDoc = Depends(current_user)):
    docs = await db.shopping_items.find({"user_id": user.id, "checked": True}).to_list(500)
    return {"moved": await shopping_to_pantry(user.id, docs)}


# ---- nutrition estimate with serving sizes
class EstimateIn(BaseModel):
    text: str = Field(min_length=2, max_length=500)


EST_SCHEMA = (
    '{"name":str,"serving_label":str (e.g. "1 serving (30 g)"),"serving_g":number,"density_g_per_ml":number,'
    '"unit_grams":{"handful":number,"bag":number,"pinch":number,"scoop":number,"bowlful":number,"package":number,"cup":number},'
    '"per_100g":{"calories":number,"protein":number,"carbs":number,"fat":number,"fiber":number},"suggested_quantity":number,"suggested_unit":str}'
)


async def estimate_food(text: str, image_b64: Optional[str] = None) -> dict:
    res = await ask_gemini(
        "You are a registered dietitian with packaged-food knowledge. JSON only.",
        f"Food: {text or 'the food in the photo'}\nUse the product's label serving if it's a known product (e.g. Goldfish crackers = 30 g), otherwise a typical serving. "
        "unit_grams are realistic gram weights of ONE of each unit for THIS food. suggested_unit must be one of: serving, g, kg, mL, L, cups, oz, lbs, handful, bag, pinch, scoop, bowlful, package. "
        f"If the user mentions an amount (e.g. 'two handfuls'), set suggested_quantity/unit to it.\nReturn JSON: {EST_SCHEMA}",
        image_b64,
    )
    per = clean_nutrition(res.get("per_100g")).model_dump()
    ug = {k: num(v) for k, v in (res.get("unit_grams") or {}).items() if num(v) > 0}
    return {
        "name": str(res.get("name") or text or "Food")[:80],
        "serving_label": str(res.get("serving_label") or ""),
        "serving_g": num(res.get("serving_g"), 100),
        "density_g_per_ml": num(res.get("density_g_per_ml"), 1),
        "unit_grams": ug,
        "per_100g": per,
        "suggested_quantity": num(res.get("suggested_quantity"), 1),
        "suggested_unit": str(res.get("suggested_unit") or "serving"),
    }


@api.post("/nutrition/estimate")
async def nutrition_estimate(body: EstimateIn, user: UserDoc = Depends(current_user)):
    try:
        return await estimate_food(body.text)
    except Exception as exc:
        logger.error("estimate failed: %s", exc)
        raise HTTPException(status_code=502, detail="Couldn't estimate that food. Try again or enter numbers yourself.")


@api.post("/nutrition/estimate-photo")
async def nutrition_estimate_photo(file: UploadFile = File(...), user: UserDoc = Depends(current_user)):
    data, _ = await read_image(file)
    try:
        return await estimate_food("", base64.b64encode(data).decode())
    except Exception as exc:
        logger.error("estimate photo failed: %s", exc)
        raise HTTPException(status_code=502, detail="Couldn't read that photo. Try describing the food instead.")


# ---- shareable shopping list (public link, anyone can tick)
@api.post("/shopping/share")
async def create_share(user: UserDoc = Depends(current_user)):
    doc = await db.share_links.find_one({"user_id": user.id, "active": True})
    if not doc:
        doc = {"token": uuid.uuid4().hex, "user_id": user.id, "active": True, "created_at": now_iso()}
        await db.share_links.insert_one(doc)
    return {"token": doc["token"], "path": f"/api/share/{doc['token']}"}


@api.post("/shopping/share/revoke")
async def revoke_share(user: UserDoc = Depends(current_user)):
    await db.share_links.update_many({"user_id": user.id}, {"$set": {"active": False}})
    return {"ok": True}


async def share_owner(token: str) -> str:
    doc = await db.share_links.find_one({"token": token, "active": True})
    if not doc:
        raise HTTPException(status_code=404, detail="This shared list is no longer available")
    return doc["user_id"]


@api.get("/share/{token}/items")
async def share_items(token: str):
    uid = await share_owner(token)
    owner = await db.users.find_one({"_id": ObjectId(uid)}, {"profile.name": 1})
    docs = await db.shopping_items.find({"user_id": uid}).sort([("aisle", 1), ("name", 1)]).to_list(500)
    items = [{k: v for k, v in ShoppingItem.from_mongo(d).model_dump().items() if k in ("id", "name", "quantity", "aisle", "checked")} for d in docs]
    return {"owner": ((owner or {}).get("profile") or {}).get("name") or "Your household", "items": items}


@api.post("/share/{token}/items/{item_id}/toggle")
async def share_toggle(token: str, item_id: str):
    uid = await share_owner(token)
    if not ObjectId.is_valid(item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    doc = await db.shopping_items.find_one({"_id": ObjectId(item_id), "user_id": uid})
    if not doc:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.shopping_items.update_one({"_id": doc["_id"]}, {"$set": {"checked": not doc.get("checked", False)}})
    return {"checked": not doc.get("checked", False)}


SHARE_HTML = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fresh Start · Shopping list</title>
<style>
body{margin:0;font-family:-apple-system,Segoe UI,Nunito,sans-serif;background:#FFFCF9;color:#2D2426}
header{background:#FF4D79;color:#fff;padding:28px 20px 22px}
h1{margin:0;font-size:26px}p.sub{margin:6px 0 0;opacity:.9}
main{padding:16px 16px 40px;max-width:560px;margin:0 auto}
h2{font-size:17px;margin:22px 4px 8px}
.card{background:#fff;border:1px solid #F2E3E7;border-radius:18px;overflow:hidden}
label{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid #F5EAEF;min-height:30px;cursor:pointer;font-weight:700}
label:last-child{border-bottom:0}
input{width:24px;height:24px;accent-color:#FF4D79}
.q{color:#8A7B80;font-weight:400;font-size:13px;margin-left:auto}
.done{text-decoration:line-through;color:#8A7B80}
.bar{height:10px;background:#FFE5EC;border-radius:5px;margin-top:14px;overflow:hidden}.bar div{height:10px;background:#FFC857}
.err{padding:40px 20px;text-align:center}
</style></head><body>
<header><h1>&#127822; Fresh Start</h1><p class="sub" id="sub">Loading shopping list…</p><div class="bar"><div id="fill" style="width:0"></div></div></header>
<main id="main"></main>
<script>
const T="__TOKEN__";
async function load(){
  const r=await fetch(`/api/share/${T}/items`);
  if(!r.ok){document.getElementById('main').innerHTML='<div class="err">This shared list is no longer available.</div>';document.getElementById('sub').textContent='';return}
  const d=await r.json();const groups={};
  d.items.forEach(i=>{(groups[i.aisle]=groups[i.aisle]||[]).push(i)});
  const done=d.items.filter(i=>i.checked).length;
  document.getElementById('sub').textContent=`${d.owner}'s list · ${done}/${d.items.length} picked up`;
  document.getElementById('fill').style.width=(d.items.length?done/d.items.length*100:0)+'%';
  const m=document.getElementById('main');m.innerHTML='';
  if(!d.items.length){m.innerHTML='<div class="err">Nothing on the list right now.</div>'}
  Object.keys(groups).sort().forEach(a=>{
    const h=document.createElement('h2');h.textContent=a;m.appendChild(h);
    const c=document.createElement('div');c.className='card';
    groups[a].forEach(i=>{
      const l=document.createElement('label');const cb=document.createElement('input');cb.type='checkbox';cb.checked=i.checked;
      const s=document.createElement('span');s.textContent=i.name;if(i.checked)s.className='done';
      const q=document.createElement('span');q.className='q';q.textContent=i.quantity||'';
      cb.onchange=async()=>{await fetch(`/api/share/${T}/items/${i.id}/toggle`,{method:'POST'});load()};
      l.append(cb,s,q);c.appendChild(l)});
    m.appendChild(c)});
}
load();setInterval(load,15000);
</script></body></html>"""


@api.get("/share/{token}", include_in_schema=False)
async def share_page(token: str):
    safe = re.sub(r"[^a-f0-9]", "", token)
    return Response(content=SHARE_HTML.replace("__TOKEN__", safe), media_type="text/html")


# ---- files (photos)
@api.get("/files/{path:path}")
async def get_file(path: str, token: Optional[str] = Query(None), creds: Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer)] = None):
    raw = creds.credentials if creds else token
    if not raw:
        raise HTTPException(status_code=401, detail="Not authenticated")
    uid = decode_token(raw)
    rec = await db.files.find_one({"storage_path": path, "owner_id": uid, "is_deleted": False})
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")
    data, ctype = await run_in_threadpool(get_object, path)
    return Response(content=data, media_type=rec.get("content_type", ctype), headers={"Cache-Control": "private, max-age=86400"})


app.include_router(api)

app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    app.state.index_task = asyncio.create_task(ensure_indexes())
    try:
        await run_in_threadpool(init_storage)
        logger.info("object storage ready")
    except Exception as exc:
        logger.error("storage init failed: %s", exc)


@app.on_event("shutdown")
async def shutdown_db_client():
    app.state.index_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.index_task
    client.close()
