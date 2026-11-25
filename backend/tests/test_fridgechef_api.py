"""FridgeChef backend regression tests (auth, profile, pantry, scans, plans, shopping)."""
import os
import time
import uuid

import pytest
import requests
from dotenv import dotenv_values

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or dotenv_values("/app/frontend/.env")["EXPO_PUBLIC_BACKEND_URL"]).rstrip("/")
IMG = "/tmp/fridge.jpg"
DEMO = {"email": "demo@fridgechef.app", "password": "demo1234"}
CREATED_USERS = []


def _register():
    email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": "pass1234", "name": "TEST_User"})
    assert r.status_code == 201, r.text
    d = r.json()
    CREATED_USERS.append(d["user"]["id"])
    return email, {"Authorization": f"Bearer {d['access_token']}"}, d


@pytest.fixture(scope="module")
def user():
    return _register()


@pytest.fixture(scope="module")
def user2():
    return _register()


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    # delete only our TEST users + their data by id
    from pymongo import MongoClient
    from bson import ObjectId
    env = dotenv_values("/app/backend/.env")
    db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
    for uid in CREATED_USERS:
        for c in ["pantry_items", "meal_plans", "recipes", "shopping_items", "leftover_scans"]:
            db[c].delete_many({"user_id": uid})
        db.files.delete_many({"owner_id": uid})
        db.users.delete_one({"_id": ObjectId(uid)})


# ---- auth
class TestAuth:
    def test_register_returns_token_and_profile(self, user):
        _, _, d = user
        assert d["access_token"] and d["user"]["email"].startswith("test_")
        assert d["user"]["profile"]["name"] == "TEST_User"
        assert d["user"]["profile"]["onboarded"] is False

    def test_register_duplicate_409(self, user):
        r = requests.post(f"{BASE_URL}/api/auth/register", json={"email": user[0].upper(), "password": "pass1234"})
        assert r.status_code == 409

    def test_login_demo_and_me(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json=DEMO)
        assert r.status_code == 200
        tok = r.json()["access_token"]
        me = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert me.status_code == 200 and me.json()["email"] == DEMO["email"]

    def test_login_wrong_password_401(self):
        assert requests.post(f"{BASE_URL}/api/auth/login", json={**DEMO, "password": "nope"}).status_code == 401

    def test_me_without_token_401(self):
        assert requests.get(f"{BASE_URL}/api/auth/me").status_code == 401
        assert requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": "Bearer bad"}).status_code == 401


# ---- profile
class TestProfile:
    def test_put_get_profile(self, user):
        h = user[1]
        body = {"name": "TEST_User", "household_size": 50, "weekly_budget": 120, "currency": "$", "appliances": ["Stove", "Microwave"],
                "family_mode": True, "allergies": ["Peanuts"], "diets": ["Vegetarian"], "onboarded": True}
        r = requests.put(f"{BASE_URL}/api/profile", json=body, headers=h)
        assert r.status_code == 200 and r.json()["household_size"] == 20  # clamped
        g = requests.get(f"{BASE_URL}/api/profile", headers=h).json()
        assert g["family_mode"] is True and g["allergies"] == ["Peanuts"] and g["onboarded"] is True


# ---- pantry
class TestPantry:
    def test_pantry_crud_and_isolation(self, user, user2):
        h, h2 = user[1], user2[1]
        r = requests.post(f"{BASE_URL}/api/pantry", json={"name": "TEST_Milk", "quantity": "1L", "category": "Dairy", "expiry_date": "2026-01-02"}, headers=h)
        assert r.status_code == 200
        item = r.json()
        assert item["id"] and item["category"] == "Dairy" and "_id" not in item
        bad = requests.post(f"{BASE_URL}/api/pantry", json={"name": "TEST_X", "category": "Bogus"}, headers=h).json()
        assert bad["category"] == "Other"
        b = requests.post(f"{BASE_URL}/api/pantry/bulk", json={"items": [{"name": "TEST_Eggs", "quantity": "12"}, {"name": "TEST_Spinach", "category": "Produce", "expiry_date": "2026-01-01"}, {"name": " "}]}, headers=h)
        assert b.status_code == 200 and b.json()["added"] == 2
        lst = requests.get(f"{BASE_URL}/api/pantry", headers=h).json()
        assert len(lst) == 4 and lst[0]["name"] == "TEST_Spinach"  # sorted by expiry
        u = requests.put(f"{BASE_URL}/api/pantry/{item['id']}", json={"name": "TEST_Milk2", "quantity": "2L", "category": "Dairy"}, headers=h)
        assert u.status_code == 200 and u.json()["name"] == "TEST_Milk2" and u.json()["expiry_date"] is None
        # isolation
        assert requests.get(f"{BASE_URL}/api/pantry", headers=h2).json() == []
        assert requests.put(f"{BASE_URL}/api/pantry/{item['id']}", json={"name": "hack"}, headers=h2).status_code == 404
        assert requests.delete(f"{BASE_URL}/api/pantry/{item['id']}", headers=h2).status_code == 404
        assert requests.delete(f"{BASE_URL}/api/pantry/{item['id']}", headers=h).status_code == 200
        assert requests.delete(f"{BASE_URL}/api/pantry/{item['id']}", headers=h).status_code == 404
        assert requests.delete(f"{BASE_URL}/api/pantry/notanid", headers=h).status_code == 404
        assert len(requests.get(f"{BASE_URL}/api/pantry", headers=h).json()) == 3

    def test_pantry_validation(self, user):
        assert requests.post(f"{BASE_URL}/api/pantry", json={"name": ""}, headers=user[1]).status_code == 422
        assert requests.get(f"{BASE_URL}/api/pantry").status_code == 401


# ---- scans (AI)
class TestScans:
    def test_scan_pantry(self, user):
        with open(IMG, "rb") as f:
            r = requests.post(f"{BASE_URL}/api/scan/pantry", files={"file": ("fridge.jpg", f, "image/jpeg")}, headers=user[1], timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        print("scan items:", d["items"][:5], "photo:", d["photo_path"])
        assert len(d["items"]) > 0
        assert all("expiry_date" in i and i["name"] for i in d["items"])

    def test_scan_empty_file_400(self, user):
        r = requests.post(f"{BASE_URL}/api/scan/pantry", files={"file": ("e.jpg", b"", "image/jpeg")}, headers=user[1])
        assert r.status_code == 400

    def test_scan_leftovers_and_get_recipe(self, user, user2):
        with open(IMG, "rb") as f:
            r = requests.post(f"{BASE_URL}/api/scan/leftovers", files={"file": ("left.jpg", f, "image/jpeg")}, headers=user[1], timeout=150)
        assert r.status_code == 200, r.text
        d = r.json()
        print("leftovers:", d["leftovers"], [x["title"] for x in d["recipes"]])
        assert len(d["recipes"]) >= 1
        rid = d["recipes"][0]["id"]
        g = requests.get(f"{BASE_URL}/api/recipes/{rid}", headers=user[1])
        assert g.status_code == 200 and g.json()["title"] == d["recipes"][0]["title"] and g.json()["source"] == "leftover"
        assert requests.get(f"{BASE_URL}/api/recipes/{rid}", headers=user2[1]).status_code == 404
        assert len(requests.get(f"{BASE_URL}/api/recipes", headers=user[1]).json()) >= 1


# ---- shopping (manual) + plans (AI, async)
class TestShoppingAndPlan:
    def test_shopping_crud(self, user2):
        h = user2[1]
        a = requests.post(f"{BASE_URL}/api/shopping", json={"name": "TEST_Bread", "quantity": "1", "aisle": "Bakery"}, headers=h).json()
        b = requests.post(f"{BASE_URL}/api/shopping", json={"name": "TEST_Apples", "aisle": "zzz"}, headers=h).json()
        assert b["aisle"] == "Other" and a["checked"] is False
        p = requests.patch(f"{BASE_URL}/api/shopping/{a['id']}", json={"checked": True}, headers=h)
        assert p.status_code == 200 and p.json()["checked"] is True
        lst = requests.get(f"{BASE_URL}/api/shopping", headers=h).json()
        assert {i["name"] for i in lst} == {"TEST_Bread", "TEST_Apples"}
        c = requests.delete(f"{BASE_URL}/api/shopping/checked", headers=h)
        assert c.status_code == 200 and c.json()["deleted"] == 1
        assert requests.delete(f"{BASE_URL}/api/shopping/{b['id']}", headers=h).status_code == 200
        assert requests.get(f"{BASE_URL}/api/shopping", headers=h).json() == []
        assert requests.patch(f"{BASE_URL}/api/shopping/{b['id']}", json={"checked": True}, headers=h).status_code == 404

    def test_plan_current_empty(self, user2):
        d = requests.get(f"{BASE_URL}/api/plans/current", headers=user2[1]).json()
        assert d == {"plan": None, "latest_ready": None}

    def test_demo_has_ready_plan(self):
        tok = requests.post(f"{BASE_URL}/api/auth/login", json=DEMO).json()["access_token"]
        d = requests.get(f"{BASE_URL}/api/plans/current", headers={"Authorization": f"Bearer {tok}"}).json()
        assert d["latest_ready"] and len(d["latest_ready"]["days"]) == 7
        ings = " ".join(i["name"].lower() for day in d["latest_ready"]["days"] for m in day["meals"] for i in m["ingredients"])
        assert "peanut" not in ings  # demo has Peanuts allergy

    def test_generate_plan_async(self, user):
        h = user[1]
        requests.put(f"{BASE_URL}/api/profile", json={"name": "TEST_User", "household_size": 3, "weekly_budget": 90, "appliances": ["Stove", "Microwave"],
                     "family_mode": True, "allergies": ["Peanuts"], "diets": ["Vegetarian"], "onboarded": True}, headers=h)
        requests.post(f"{BASE_URL}/api/shopping", json={"name": "TEST_Manual_Item"}, headers=h)
        r = requests.post(f"{BASE_URL}/api/plans/generate", headers=h)
        assert r.status_code == 200 and r.json()["status"] == "generating"
        r2 = requests.post(f"{BASE_URL}/api/plans/generate", headers=h)  # dedupe while generating
        assert r2.json()["id"] == r.json()["id"]
        plan = None
        for _ in range(40):
            time.sleep(5)
            plan = requests.get(f"{BASE_URL}/api/plans/current", headers=h).json()["plan"]
            if plan["status"] != "generating":
                break
        assert plan["status"] == "ready", plan
        assert len(plan["days"]) == 7 and all(len(d["meals"]) >= 1 for d in plan["days"])
        meal = plan["days"][0]["meals"][0]
        assert requests.get(f"{BASE_URL}/api/recipes/{meal['id']}", headers=h).status_code == 200
        titles = [m["title"].lower() for d in plan["days"] for m in d["meals"]]
        print("dup titles:", len(titles) - len(set(titles)), "cost:", plan["total_cost"])
        all_ings = " ".join(i["name"].lower() for d in plan["days"] for m in d["meals"] for i in m["ingredients"])
        assert "peanut" not in all_ings
        meats = [w for w in ["chicken", "beef", "pork", "bacon", "fish", "salmon", "tuna", "shrimp", "ham", "turkey"] if w in all_ings]
        print("meat in vegetarian plan:", meats)
        shop = requests.get(f"{BASE_URL}/api/shopping", headers=h).json()
        assert len(shop) > 0
        print("manual item kept after plan generation:", any(s["name"] == "TEST_Manual_Item" for s in shop))
