# Iteration 3 retest: share revoke, background AI pricing, quantity normalisation, craving honoured, nutrition estimate
import os
import time
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TOMORROW = (date.today() + timedelta(days=1)).isoformat()
S = {}


@pytest.fixture(scope="module")
def c():
    s = requests.Session()
    email = f"TEST_it3_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "test1234", "name": "TEST_it3"})
    assert r.status_code == 201, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    s.put(f"{API}/profile", json={"name": "TEST_it3", "household_size": 2, "weekly_budget": 80, "stores": ["Walmart", "No Frills"], "onboarded": True})
    s.post(f"{API}/pantry/bulk", json={"items": [{"name": "Rice", "quantity": "1 kg", "category": "Pantry"}]})
    return s


# FIX 1: share revoke via POST, token then 404
class TestShareRevoke:
    def test_share_then_revoke(self, c):
        r = c.post(f"{API}/shopping/share")
        assert r.status_code == 200, r.text
        tok = r.json()["token"]
        assert c.get(f"{API}/share/{tok}/items").status_code == 200
        r = c.post(f"{API}/shopping/share/revoke")
        assert r.status_code == 200 and r.json().get("ok") is True, r.text
        r = requests.get(f"{API}/share/{tok}/items")
        assert r.status_code == 404, r.text
        # new share gets a fresh token
        r = c.post(f"{API}/shopping/share")
        assert r.json()["token"] != tok
        c.post(f"{API}/shopping/share/revoke")


# FIX 4: craving honoured
class TestCraving:
    def test_creamy_chicken_curry(self, c):
        r = c.post(f"{API}/meals/generate", json={"kind": "craving", "prompt": "creamy chicken curry", "meal_type": "Dinner", "date": TOMORROW}, timeout=120)
        assert r.status_code == 200, r.text
        rec = r.json()["recipe"]
        S["recipe"] = rec
        title = rec["title"].lower()
        ings = " ".join(i["name"].lower() for i in rec["ingredients"])
        print("CRAVING TITLE:", rec["title"], "| ings:", ings[:200], "| shopping_added:", r.json()["shopping_added"])
        assert "curry" in title or "tikka" in title or "korma" in title, rec["title"]
        assert "pasta" not in title
        assert "chicken" in (title + ings)


# FIX 2 + 3: background pricing fills prices per store and cleans combined quantities
class TestPricing:
    def test_manual_add_gets_prices(self, c):
        r = c.post(f"{API}/shopping", json={"name": "TEST_Greek yogurt", "quantity": "750 g", "aisle": "Dairy"})
        assert r.status_code == 200, r.text
        S["manual_id"] = r.json()["id"]
        assert r.json()["prices"] == {} or isinstance(r.json()["prices"], dict)

    def test_merge_and_wait_for_pricing(self, c):
        # second recipe needing chicken to force a combined quantity
        r = c.post(f"{API}/meals/manual", json={"date": TOMORROW, "meal_type": "Lunch", "title": "TEST_Chicken salad", "ingredients": ["300 g chicken breast", "1 head lettuce"], "ai_fill": False, "add_to_shopping": True}, timeout=60)
        assert r.status_code in (200, 201), r.text
        S["manual_recipe"] = r.json()
        deadline = time.time() + 120
        items = []
        while time.time() < deadline:
            items = c.get(f"{API}/shopping").json()
            unpriced = [i["name"] for i in items if not (i.get("prices") or {}).get("Walmart") or not (i.get("prices") or {}).get("No Frills")]
            if items and not unpriced:
                break
            time.sleep(10)
        for i in items:
            print("ITEM:", i["name"], "|", i["quantity"], "|", i.get("prices"), "| needed_for:", [n.get("quantity") for n in i.get("needed_for", [])])
        unpriced = [i["name"] for i in items if not (i.get("prices") or {}).get("Walmart") or not (i.get("prices") or {}).get("No Frills")]
        assert not unpriced, f"unpriced after 120s: {unpriced}"
        y = next(i for i in items if i["id"] == S["manual_id"])
        assert y["est_cost"] > 0
        S["items"] = items

    def test_combined_quantity_clean(self, c):
        items = S.get("items") or pytest.skip("no items")
        multi = [i for i in items if len(i.get("needed_for") or []) > 1]
        print("MULTI:", [(i["name"], i["quantity"]) for i in multi])
        for i in multi:
            assert " + " not in i["quantity"], i


# FIX 5: nutrition estimate robust to '30 g'
class TestNutrition:
    def test_estimate(self, c):
        r = c.post(f"{API}/nutrition/estimate", json={"text": "Goldfish crackers 30 g"}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d["serving_g"], float) and d["serving_g"] > 0
        assert d["per_100g"]["calories"] > 0
        assert all(isinstance(v, float) for v in d["unit_grams"].values())


# Regression: eat + accept/decline + cleanup
class TestRegression:
    def test_accept_eat_decline(self, c):
        rec = S.get("recipe") or pytest.skip("no recipe")
        rid = rec["id"]
        assert c.post(f"{API}/recipes/{rid}/accept").status_code == 200
        r = c.post(f"{API}/recipes/{rid}/eat", json={"servings": 1})
        assert r.status_code == 200, r.text
        assert c.post(f"{API}/recipes/{rid}/decline").status_code == 200

    def test_cleanup(self, c):
        for i in c.get(f"{API}/shopping").json():
            c.delete(f"{API}/shopping/{i['id']}")
        assert c.get(f"{API}/shopping").json() == []


# FIX 3: combined quantity across two recipes sharing ingredients is normalised (no ' + ' chains, no double count)
class TestCombinedQuantity:
    def test_two_recipes_combined(self, c):
        ids = []
        for p in ("garlic butter chicken with rice", "garlic chicken stir fry with rice"):
            r = c.post(f"{API}/meals/generate", json={"kind": "craving", "prompt": p, "meal_type": "Dinner"}, timeout=120)
            assert r.status_code == 200, r.text
            ids.append(r.json()["recipe"]["id"])
            print("RECIPE:", r.json()["recipe"]["title"], [(i["name"], i["quantity"], i["from_pantry"]) for i in r.json()["recipe"]["ingredients"]])
        for rid in ids:
            r = c.post(f"{API}/recipes/{rid}/to-shopping")
            assert r.status_code == 200, r.text
            print("ADDED:", r.json())
        # idempotent second call
        assert c.post(f"{API}/recipes/{ids[0]}/to-shopping").json()["added"] == 0
        items = c.get(f"{API}/shopping").json()
        print("RAW MULTI:", [(i["name"], i["quantity"]) for i in items if len(i.get("needed_for") or []) > 1])
        deadline = time.time() + 120
        while time.time() < deadline:
            time.sleep(10)
            items = c.get(f"{API}/shopping").json()
            multi = [i for i in items if len(i.get("needed_for") or []) > 1]
            if all(" + " not in i["quantity"] for i in multi) and all((i.get("prices") or {}).get("Walmart") for i in items):
                break
        for i in items:
            print("ITEM:", i["name"], "|", i["quantity"], "|", i.get("prices"), "| needed_for:", [n.get("quantity") for n in i.get("needed_for", [])])
        multi = [i for i in items if len(i.get("needed_for") or []) > 1]
        assert multi, "expected at least one merged item"
        for i in multi:
            assert " + " not in i["quantity"], i
        for i in c.get(f"{API}/shopping").json():
            c.delete(f"{API}/shopping/{i['id']}")
