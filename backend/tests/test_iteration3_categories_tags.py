# SpendSense iteration 3: custom categories CRUD, inline business learn, batch-tag, per-merchant learning
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"
COLS = ["transactions", "merchant_rules", "sms_seen", "review_items", "recurring_overrides", "alerts", "budgets",
        "custom_categories"]


def sms(vpa, amt, ref):
    return f"Rs.{amt}.00 debited from A/c XX1234 on 18-10-25 to VPA {vpa} (UPI Ref {ref}). -HDFC Bank"


CREDIT = "Rs.5000.00 credited to A/c XX1234 on 18-10-25 by VPA rahul@okaxis (UPI Ref 777000111). -HDFC Bank"


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(os.environ["MONGO_URL"])
    yield c[os.environ["DB_NAME"]]
    c.close()


def _mk_user(mongo):
    uid = f"TEST_user_{uuid.uuid4().hex[:8]}"
    tok = f"TEST_session_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    mongo.users.insert_one({"user_id": uid, "email": f"{uid.lower()}@example.com", "name": "Test", "created_at": now})
    mongo.user_sessions.insert_one({"session_token": tok, "user_id": uid, "expires_at": now + timedelta(days=7), "created_at": now})
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return {"uid": uid, "s": s}


@pytest.fixture(scope="module")
def users(mongo):
    a, b = _mk_user(mongo), _mk_user(mongo)
    yield a, b
    for u in (a, b):
        for col in COLS:
            mongo[col].delete_many({"user_id": u["uid"]})
        mongo.user_sessions.delete_many({"user_id": u["uid"]})
        mongo.users.delete_many({"user_id": u["uid"]})


def ingest(s, body):
    r = s.post(f"{API}/sms/ingest", json={"messages": [{"body": body, "sender": "VM-HDFCBK", "received_at": time.time() * 1000}]})
    assert r.status_code == 200, r.text
    return r.json()


def tx_by_amount(s, amt):
    return [t for t in s.get(f"{API}/transactions?month=all").json() if t["amount"] == amt][0]


# ---------------- custom categories CRUD
class TestCategories:
    def test_get_shape(self, users):
        d = users[0]["s"].get(f"{API}/categories").json()
        for k in ("spend", "builtin", "excluded", "income", "custom"):
            assert k in d, d
        assert d["custom"] == [] and d["spend"] == d["builtin"]

    def test_auth_required(self):
        assert requests.get(f"{API}/categories").status_code == 401

    def test_create_and_validate(self, users):
        s = users[0]["s"]
        r = s.post(f"{API}/categories", json={"name": "  Pet   Care "})
        assert r.status_code == 201, r.text
        assert r.json()["name"] == "Pet Care"
        d = s.get(f"{API}/categories").json()
        assert "Pet Care" in d["spend"] and d["custom"][0]["name"] == "Pet Care"
        assert s.post(f"{API}/categories", json={"name": "food"}).status_code == 409
        assert s.post(f"{API}/categories", json={"name": "pet care"}).status_code == 409
        assert s.post(f"{API}/categories", json={"name": "income"}).status_code == 409
        assert s.post(f"{API}/categories", json={"name": "   "}).status_code == 400
        assert s.post(f"{API}/categories", json={"name": "x" * 31}).status_code == 400
        assert s.post(f"{API}/categories", json={"name": "x" * 30}).status_code == 201

    def test_custom_usable_everywhere(self, users):
        s = users[0]["s"]
        r = s.post(f"{API}/transactions", json={"amount": 111, "merchant": "TEST_PETSHOP", "category": "Pet Care"})
        assert r.status_code == 201 and r.json()["category"] == "Pet Care", r.text
        ingest(s, sms("dogvet@icici", 222, "512340000001"))
        t = tx_by_amount(s, 222.0)
        r = s.patch(f"{API}/transactions/{t['id']}", json={"category": "Pet Care"})
        assert r.status_code == 200 and r.json()["category"] == "Pet Care"
        r = s.post(f"{API}/sms/confirm", json={"body": sms("catfood@icici", 333, "512340000002"), "sender": "VM-HDFCBK",
                                               "amount": 333, "direction": "debit", "merchant": "CATFOOD",
                                               "category": "Pet Care", "learn": False})
        assert r.status_code == 201 and r.json()["transaction"]["category"] == "Pet Care", r.text
        assert s.put(f"{API}/budgets", json={"category": "Pet Care", "amount": 2000}).status_code == 200
        items = {i["category"]: i for i in s.get(f"{API}/budgets").json()["items"]}
        assert items["Pet Care"]["budget"] == 2000 and items["Pet Care"]["spent"] >= 111
        assert s.patch(f"{API}/transactions/{t['id']}", json={"category": "Nope"}).status_code == 400
        assert s.put(f"{API}/budgets", json={"category": "Nope", "amount": 10}).status_code == 400

    def test_other_users_category_invalid(self, users):
        sb = users[1]["s"]
        r = sb.post(f"{API}/transactions", json={"amount": 50, "merchant": "TEST_X", "category": "Pet Care"})
        assert r.status_code == 400
        assert sb.put(f"{API}/budgets", json={"category": "Pet Care", "amount": 10}).status_code == 400
        cid = users[0]["s"].get(f"{API}/categories").json()["custom"][0]["id"]
        assert sb.patch(f"{API}/categories/{cid}", json={"name": "Hack"}).status_code == 404
        assert sb.delete(f"{API}/categories/{cid}").status_code == 404

    def test_rename_cascades(self, users, mongo):
        s, uid = users[0]["s"], users[0]["uid"]
        cid = s.get(f"{API}/categories").json()["custom"][0]["id"]
        # merchant rule with the category
        t = tx_by_amount(s, 222.0)
        s.patch(f"{API}/transactions/{t['id']}", json={"category": "Pet Care", "apply_to_merchant": True})
        assert s.patch(f"{API}/categories/{cid}", json={"name": "food"}).status_code == 409
        assert s.patch(f"{API}/categories/{cid}", json={"name": "PET CARE"}).status_code == 200  # case-only rename of self
        r = s.patch(f"{API}/categories/{cid}", json={"name": "Pets"})
        assert r.status_code == 200 and r.json()["name"] == "Pets"
        txs = s.get(f"{API}/transactions?month=all").json()
        assert not [x for x in txs if x["category"] in ("Pet Care", "PET CARE")]
        assert len([x for x in txs if x["category"] == "Pets"]) == 3
        items = {i["category"]: i for i in s.get(f"{API}/budgets").json()["items"]}
        assert items["Pets"]["budget"] == 2000 and "Pet Care" not in items
        assert mongo.merchant_rules.count_documents({"user_id": uid, "category": "Pets"}) >= 1
        assert mongo.merchant_rules.count_documents({"user_id": uid, "category": {"$in": ["Pet Care", "PET CARE"]}}) == 0

    def test_delete_moves_to_other(self, users, mongo):
        s, uid = users[0]["s"], users[0]["uid"]
        cid = [c for c in s.get(f"{API}/categories").json()["custom"] if c["name"] == "Pets"][0]["id"]
        r = s.delete(f"{API}/categories/{cid}")
        assert r.status_code == 200 and r.json()["moved_to_other"] == 3, r.text
        assert "Pets" not in s.get(f"{API}/categories").json()["spend"]
        assert all(t["category"] != "Pets" for t in s.get(f"{API}/transactions?month=all").json())
        assert mongo.budgets.count_documents({"user_id": uid, "category": "Pets"}) == 0
        assert s.delete(f"{API}/categories/{cid}").status_code == 404
        assert s.delete(f"{API}/categories/notanid").status_code == 404


# ---------------- inline business flip + learning
class TestBusinessLearning:
    def test_inline_learn_future_only(self, users):
        s = users[1]["s"]
        ingest(s, sms("uber@axis", 401, "612340000001"))
        ingest(s, sms("uber@axis", 402, "612340000002"))
        t1, t2 = tx_by_amount(s, 401.0), tx_by_amount(s, 402.0)
        assert t1["merchant"] == t2["merchant"] and t1["business"] is False
        r = s.patch(f"{API}/transactions/{t1['id']}", json={"business": True, "learn_business": True})
        assert r.status_code == 200 and r.json()["business"] is True and r.json()["updated_others"] == 0
        assert tx_by_amount(s, 402.0)["business"] is False  # past untouched
        ingest(s, sms("uber@axis", 403, "612340000003"))
        assert tx_by_amount(s, 403.0)["business"] is True  # future learned

    def test_flip_back_personal(self, users):
        s = users[1]["s"]
        t = tx_by_amount(s, 403.0)
        assert s.patch(f"{API}/transactions/{t['id']}", json={"business": False, "learn_business": True}).json()["business"] is False
        ingest(s, sms("uber@axis", 404, "612340000004"))
        assert tx_by_amount(s, 404.0)["business"] is False

    def test_credit_cannot_be_tagged(self, users):
        s = users[1]["s"]
        ingest(s, CREDIT)
        c = tx_by_amount(s, 5000.0)
        assert c["direction"] == "credit"
        assert s.patch(f"{API}/transactions/{c['id']}", json={"business": True}).status_code == 400


# ---------------- batch tag
class TestBatchTag:
    def test_batch_tag_and_learn(self, users):
        s = users[1]["s"]
        ingest(s, sms("ola@ybl", 501, "712340000001"))
        ingest(s, sms("irctc@sbi", 502, "712340000002"))
        a, b, c = tx_by_amount(s, 501.0), tx_by_amount(s, 502.0), tx_by_amount(s, 5000.0)
        other = users[0]["s"].get(f"{API}/transactions?month=all").json()[0]
        r = s.post(f"{API}/transactions/batch-tag",
                   json={"ids": [a["id"], b["id"], c["id"], other["id"], "bad"], "business": True, "learn": True})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["matched"] == 2 and d["updated"] == 2 and d["merchants_learned"] == 2, d
        assert tx_by_amount(s, 501.0)["business"] and tx_by_amount(s, 502.0)["business"]
        assert tx_by_amount(s, 5000.0)["business"] is False
        o2 = [t for t in users[0]["s"].get(f"{API}/transactions?month=all").json() if t["id"] == other["id"]][0]
        assert o2["business"] == other["business"]
        ingest(s, sms("ola@ybl", 503, "712340000003"))
        ingest(s, sms("irctc@sbi", 504, "712340000004"))
        assert tx_by_amount(s, 503.0)["business"] and tx_by_amount(s, 504.0)["business"]

    def test_batch_no_learn_and_validation(self, users):
        s = users[1]["s"]
        a = tx_by_amount(s, 503.0)
        d = s.post(f"{API}/transactions/batch-tag", json={"ids": [a["id"]], "business": False, "learn": False}).json()
        assert d["updated"] == 1 and d["merchants_learned"] == 0
        ingest(s, sms("ola@ybl", 505, "712340000005"))
        assert tx_by_amount(s, 505.0)["business"] is True  # rule unchanged
        assert s.post(f"{API}/transactions/batch-tag", json={"ids": [], "business": True}).status_code in (400, 422)

    def test_apply_business_to_merchant_past(self, users):
        s = users[1]["s"]
        a = tx_by_amount(s, 501.0)
        r = s.patch(f"{API}/transactions/{a['id']}", json={"business": False, "apply_business_to_merchant": True})
        assert r.status_code == 200 and r.json()["updated_others"] >= 1
        assert all(not t["business"] for t in s.get(f"{API}/transactions?month=all").json() if t["merchant"] == a["merchant"])
