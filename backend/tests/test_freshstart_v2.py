# Fresh Start v2 connected-system tests: plans, calendar, meal actions, generators, shopping, nutrition, rewards, share
import os
import time
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TODAY = date.today().isoformat()
TOMORROW = (date.today() + timedelta(days=1)).isoformat()
S = {}


@pytest.fixture(scope="module")
def c():
    s = requests.Session()
    email = f"TEST_v2_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "test1234", "name": "TEST_v2"})
    assert r.status_code == 201, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    s.put(f"{API}/profile", json={"name": "TEST_v2", "household_size": 2, "weekly_budget": 80, "stores": ["Walmart", "No Frills"], "onboarded": True})
    items = [
        {"name": "Pasta", "quantity": "500 g", "category": "Pantry"},
        {"name": "Tomato sauce", "quantity": "680 ml jar", "category": "Pantry"},
        {"name": "Eggs", "quantity": "12", "category": "Dairy"},
        {"name": "Spinach", "quantity": "300 g bag", "category": "Produce", "expiry_date": TOMORROW},
        {"name": "Cheddar cheese", "quantity": "400 g block", "category": "Dairy"},
    ]
    r = s.post(f"{API}/pantry/bulk", json={"items": items})
    assert r.status_code in (200, 201), r.text
    S["pantry"] = s.get(f"{API}/pantry").json()
    return s


# Plan generation (async) + calendar range
class TestPlan:
    def test_generate_day_plan_pantry_only(self, c):
        r = c.post(f"{API}/plans/generate", json={"scope": "day", "date": TODAY, "mode": "pantry_only", "schedule": {TODAY: ["09:00-17:00 Work"]}, "notes": "quick dinner"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "generating"
        for _ in range(30):
            time.sleep(4)
            p = c.get(f"{API}/plans/current").json().get("plan") or {}
            if p.get("status") and p.get("status") != "generating":
                break
        assert p["status"] == "ready", p
        S["plan"] = p

    def test_calendar_range(self, c):
        r = c.get(f"{API}/calendar/range", params={"start": TODAY, "end": TOMORROW})
        assert r.status_code == 200
        days = r.json()["days"]
        assert [d["date"] for d in days] == [TODAY, TOMORROW]
        meals = days[0]["meals"]
        assert len(meals) >= 3, meals
        assert all(m["status"] == "proposed" for m in meals)
        assert {"totals", "logs"} <= set(days[0])
        S["meals"] = meals

    def test_calendar_bad_date(self, c):
        assert c.get(f"{API}/calendar/range", params={"start": "x", "end": TODAY}).status_code == 422


# Meal actions: accept / decline / move / favorite / eat idempotent / cook / to-shopping / schedule
class TestMealActions:
    def test_accept_decline_move(self, c):
        m = S["meals"]
        assert c.post(f"{API}/recipes/{m[0]['id']}/accept").status_code == 200
        assert c.post(f"{API}/recipes/{m[1]['id']}/decline").status_code == 200
        assert c.post(f"{API}/recipes/{m[2]['id']}/move", json={"date": TOMORROW, "meal_type": "Snack"}).status_code == 200
        days = c.get(f"{API}/calendar/range", params={"start": TODAY, "end": TOMORROW}).json()["days"]
        ids0 = {x["id"]: x for x in days[0]["meals"]}
        assert ids0[m[0]["id"]]["status"] == "accepted"
        assert m[1]["id"] not in ids0
        moved = [x for x in days[1]["meals"] if x["id"] == m[2]["id"]]
        assert moved and moved[0]["meal_type"] == "Snack"

    def test_favorite_toggle_and_list(self, c):
        rid = S["meals"][0]["id"]
        assert c.post(f"{API}/recipes/{rid}/favorite").json()["favorite"] is True
        assert rid in [f["id"] for f in c.get(f"{API}/favorites").json()]

    def test_eat_idempotent(self, c):
        rid = S["meals"][0]["id"]
        rec = c.get(f"{API}/recipes/{rid}").json()
        a = c.post(f"{API}/recipes/{rid}/eat", json={"servings": 1}).json()
        b = c.post(f"{API}/recipes/{rid}/eat", json={"servings": 2}).json()
        assert a["updated"] is False and b["updated"] is True
        assert a["log_id"] == b["log_id"]
        per = c.get(f"{API}/recipes/{rid}").json()["nutrition"]["calories"] or rec["nutrition"]["calories"]
        assert abs(b["calories"] - round(per * 2, 1)) < 1
        logs = [l for l in c.get(f"{API}/calendar/range", params={"start": TODAY, "end": TODAY}).json()["days"][0]["logs"] if l.get("recipe_id") == rid]
        assert len(logs) == 1 and logs[0]["quantity"] == 2

    def test_cook_partial_deduction(self, c):
        rid = S["meals"][0]["id"]
        r = c.post(f"{API}/recipes/{rid}/cook")
        assert r.status_code == 200, r.text
        d = r.json()
        print("pantry_changes:", d["pantry_changes"])
        assert isinstance(d["pantry_changes"], list) and d["points_earned"] >= 10
        after = c.get(f"{API}/pantry").json()
        # partial deduction: most items should remain (not wiped)
        assert len(after) >= len(S["pantry"]) - 2
        assert c.post(f"{API}/recipes/{rid}/cook").status_code == 409

    def test_to_shopping_and_schedule(self, c):
        rid = S["meals"][0]["id"]
        assert "added" in c.post(f"{API}/recipes/{rid}/to-shopping").json()
        r = c.post(f"{API}/recipes/{rid}/schedule", json={"date": TOMORROW, "meal_type": "Lunch"})
        assert r.status_code == 200
        assert r.json()["recipe"]["date"] == TOMORROW and r.json()["recipe"]["id"] != rid


# AI generators: craving, ingredients, swap, manual
class TestGenerators:
    def test_craving(self, c):
        r = c.post(f"{API}/meals/generate", json={"kind": "craving", "prompt": "something cheesy and warm", "context": "under 30 min", "date": TODAY, "meal_type": "Dinner"}, timeout=120)
        assert r.status_code == 200, r.text
        rec = r.json()["recipe"]
        assert rec["title"] and rec["ingredients"] and rec["steps"]
        assert c.get(f"{API}/recipes/{rec['id']}").status_code == 200

    def test_ingredients_pantry_only(self, c):
        ids = [p["id"] for p in S["pantry"] if p["name"] in ("Pasta", "Eggs")]
        r = c.post(f"{API}/meals/generate", json={"kind": "ingredients", "pantry_ids": ids, "allow_extra": False}, timeout=120)
        assert r.status_code == 200, r.text
        rec = r.json()["recipe"]
        print("ingredients:", [(i["name"], i["from_pantry"]) for i in rec["ingredients"]])
        assert rec["ingredients"]

    def test_ingredients_requires_pick(self, c):
        assert c.post(f"{API}/meals/generate", json={"kind": "ingredients", "pantry_ids": []}).status_code == 422

    def test_manual_no_ai(self, c):
        r = c.post(f"{API}/meals/manual", json={"date": TODAY, "meal_type": "Lunch", "title": "TEST_Sandwich", "ingredients": ["bread", "ham"], "ai_fill": False})
        assert r.status_code == 200
        rid = r.json()["recipe"]["id"]
        day = c.get(f"{API}/calendar/range", params={"start": TODAY, "end": TODAY}).json()["days"][0]
        m = [x for x in day["meals"] if x["id"] == rid]
        assert m and m[0]["status"] == "manual"
        assert c.get(f"{API}/recipes/{rid}").json()["title"] == "TEST_Sandwich"

    def test_swap(self, c):
        m = [x for x in S["meals"][3:]] or S["meals"]
        rid = m[0]["id"]
        r = c.post(f"{API}/recipes/{rid}/swap", json={"reason": "too heavy", "craving": "light salad", "ingredients": "spinach"}, timeout=120)
        assert r.status_code == 200, r.text
        new = r.json()["recipe"]
        assert new["id"] != rid and new["status"] == "proposed" and new["date"] == m[0]["date"]


# Shopping: merged duplicates, needed_for, to-pantry, share link
class TestShopping:
    def test_items_shape_and_no_duplicates(self, c):
        items = c.get(f"{API}/shopping").json()
        assert items
        names = [i["name"].lower().strip() for i in items]
        dups = {n for n in names if names.count(n) > 1}
        print("duplicates:", dups, "priced:", sum(1 for i in items if i["prices"]), "/", len(items))
        assert not dups
        assert all("needed_for" in i and "reason" in i and "prices" in i for i in items)
        S["shop"] = items

    def test_item_to_pantry(self, c):
        it = S["shop"][0]
        assert c.post(f"{API}/shopping/{it['id']}/to-pantry").json()["moved"] == 1
        assert it["id"] not in [x["id"] for x in c.get(f"{API}/shopping").json()]
        assert any(p["name"] == it["name"] for p in c.get(f"{API}/pantry").json())

    def test_checked_to_pantry(self, c):
        it = S["shop"][1]
        c.patch(f"{API}/shopping/{it['id']}", json={"checked": True})
        assert c.post(f"{API}/shopping/checked-to-pantry").json()["moved"] >= 1

    def test_share_link(self, c):
        tok = c.post(f"{API}/shopping/share").json()["token"]
        h = requests.get(f"{API}/share/{tok}")
        assert h.status_code == 200 and "text/html" in h.headers["content-type"]
        items = requests.get(f"{API}/share/{tok}/items").json()["items"]
        if items:
            t = requests.post(f"{API}/share/{tok}/items/{items[0]['id']}/toggle")
            assert t.status_code == 200
        c.delete(f"{API}/shopping/share")
        assert requests.get(f"{API}/share/{tok}/items").status_code == 404


# Nutrition estimate + rewards
class TestNutritionRewards:
    def test_estimate_goldfish(self, c):
        r = c.post(f"{API}/nutrition/estimate", json={"text": "goldfish crackers"}, timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        print("estimate:", d)
        assert d["serving_label"] and 20 <= d["serving_g"] <= 40
        assert d["per_100g"]["calories"] > 300 and isinstance(d["unit_grams"], dict)

    def test_rewards_and_claim(self, c):
        r = c.get(f"{API}/rewards").json()
        print("rewards:", {k: v for k, v in r.items() if k != "quests"})
        assert "points" in r and r["quests"]
        done = [q for q in r["quests"] if q.get("complete") and not q.get("claimed")]
        if done:
            assert c.post(f"{API}/rewards/quests/{done[0]['key']}/claim").status_code == 200
        bad = c.post(f"{API}/rewards/quests/nope/claim")
        assert bad.status_code in (400, 404)
