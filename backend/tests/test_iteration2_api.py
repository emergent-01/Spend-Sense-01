# SpendSense iteration 2: Google-session auth, SMS preview/confirm + merchant learning, tx PATCH, filters, P2P
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
DEMO_TOKEN = "test_session_demo_spendsense"


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(os.environ["MONGO_URL"])
    yield c[os.environ["DB_NAME"]]
    c.close()


@pytest.fixture(scope="module")
def user(mongo):
    """Fresh isolated TEST_ user + session seeded directly in Mongo."""
    uid = f"TEST_user_{uuid.uuid4().hex[:8]}"
    tok = f"TEST_session_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    mongo.users.insert_one({"user_id": uid, "email": f"{uid.lower()}@example.com", "name": "Test User", "created_at": now})
    mongo.user_sessions.insert_one({"session_token": tok, "user_id": uid, "expires_at": now + timedelta(days=7), "created_at": now})
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    yield {"uid": uid, "token": tok, "s": s}
    for col in ["transactions", "merchant_rules", "sms_seen", "review_items", "recurring_overrides", "alerts", "budgets"]:
        mongo[col].delete_many({"user_id": uid})
    mongo.user_sessions.delete_many({"user_id": uid})
    mongo.users.delete_many({"user_id": uid})


# ---------------- auth
class TestAuth:
    def test_session_invalid(self):
        r = requests.post(f"{API}/auth/session", json={"session_id": "bogus_123"})
        assert r.status_code == 401

    def test_me_demo(self):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {DEMO_TOKEN}"})
        assert r.status_code == 200
        assert r.json()["email"] == "demo@spendsense.in"

    def test_me_no_token(self):
        assert requests.get(f"{API}/auth/me").status_code == 401

    def test_old_routes_removed(self):
        for p in ["login", "register"]:
            r = requests.post(f"{API}/auth/{p}", json={"email": "a@b.c", "password": "x"})
            assert r.status_code in (404, 405), (p, r.status_code)

    def test_logout_deletes_session(self, mongo):
        uid = f"TEST_lo_{uuid.uuid4().hex[:6]}"
        tok = f"TEST_lo_{uuid.uuid4().hex}"
        now = datetime.now(timezone.utc)
        mongo.users.insert_one({"user_id": uid, "email": f"{uid.lower()}@example.com", "created_at": now})
        mongo.user_sessions.insert_one({"session_token": tok, "user_id": uid, "expires_at": now + timedelta(days=1), "created_at": now})
        h = {"Authorization": f"Bearer {tok}"}
        assert requests.get(f"{API}/auth/me", headers=h).status_code == 200
        assert requests.post(f"{API}/auth/logout", headers=h).json()["ok"] is True
        assert requests.get(f"{API}/auth/me", headers=h).status_code == 401
        mongo.users.delete_many({"user_id": uid})


SWIGGY = "Rs.450.00 debited from A/c XX1234 on 15-10-25 to VPA swiggy@icici (UPI Ref 512345678901). -HDFC Bank"
SWIGGY2 = "Rs.320.00 debited from A/c XX1234 on 18-10-25 to VPA swiggy@icici (UPI Ref 512345678999). -HDFC Bank"
P2P = "Sent Rs.900.00 From HDFC Bank A/C *1234 To PRIYA NAIR On 20/10/26 Ref 99"


# ---------------- SMS preview / confirm / learning
class TestSmsFlow:
    def test_preview_no_save(self, user):
        s = user["s"]
        r = s.post(f"{API}/sms/preview", json={"messages": [{"body": SWIGGY, "sender": "VM-HDFCBK"},
                                                             {"body": "Your OTP is 123456", "sender": "VM-HDFCBK"}]})
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert items[0]["status"] == "parsed" and items[0]["amount"] == 450.0
        assert items[0]["duplicate"] is False and items[0]["learned"] is False
        print("preview item0:", items[0]["merchant"], items[0]["category"], "item1:", items[1]["status"])
        assert items[1]["status"] in ("ignored", "unparsed")
        assert s.get(f"{API}/transactions?month=all").json() == []

    def test_confirm_learn_and_409(self, user):
        s = user["s"]
        # existing same-merchant tx via ingest first
        r = s.post(f"{API}/sms/ingest", json={"messages": [{"body": SWIGGY2, "sender": "VM-HDFCBK"}]})
        assert r.json()["created"] == 1
        r = s.post(f"{API}/sms/confirm", json={"body": SWIGGY, "sender": "VM-HDFCBK", "amount": 455, "direction": "debit",
                                               "merchant": "SWIGGY", "category": "Shopping", "business": True, "learn": True})
        assert r.status_code == 201, r.text
        d = r.json()
        print("confirm:", d["status"], d["learned_others"], d["transaction"]["merchant"])
        assert d["transaction"]["amount"] == 455 and d["transaction"]["category"] == "Shopping"
        assert d["transaction"]["business"] is True
        assert d["learned_others"] >= 1
        r2 = s.post(f"{API}/sms/confirm", json={"body": SWIGGY, "sender": "VM-HDFCBK", "amount": 455, "direction": "debit",
                                                "merchant": "SWIGGY", "category": "Shopping", "business": True})
        assert r2.status_code == 409
        txs = s.get(f"{API}/transactions?month=all").json()
        assert all(t["category"] == "Shopping" and t["business"] for t in txs if (t["merchant"] or "").upper().startswith("SWIGGY")), txs

    def test_ingest_uses_learned_rule(self, user):
        s = user["s"]
        body = "Rs.199.00 debited from A/c XX1234 on 19-10-25 to VPA swiggy@icici (UPI Ref 512345670000). -HDFC Bank"
        pv = s.post(f"{API}/sms/preview", json={"messages": [{"body": body, "sender": "VM-HDFCBK"}]}).json()["items"][0]
        print("preview learned:", pv.get("learned"), pv.get("category"), pv.get("business"))
        assert pv["learned"] is True and pv["category"] == "Shopping" and pv["business"] is True
        assert s.post(f"{API}/sms/ingest", json={"messages": [{"body": body, "sender": "VM-HDFCBK"}]}).json()["created"] == 1
        t = [t for t in s.get(f"{API}/transactions?month=all").json() if t["amount"] == 199.0][0]
        assert t["category"] == "Shopping" and t["business"] is True

    def test_p2p_detected_and_excluded(self, user):
        s = user["s"]
        pv = s.post(f"{API}/sms/preview", json={"messages": [{"body": P2P, "sender": "VM-HDFCBK"}]}).json()["items"][0]
        print("P2P preview:", pv.get("status"), pv.get("merchant"), pv.get("category"))
        assert pv["category"] == "Transfer / P2P"
        before = s.get(f"{API}/overview").json()
        s.post(f"{API}/sms/ingest", json={"messages": [{"body": P2P, "sender": "VM-HDFCBK", "received_at": time.time() * 1000}]})
        t = [t for t in s.get(f"{API}/transactions?month=all").json() if t["amount"] == 900.0]
        assert t and t[0]["category"] == "Transfer / P2P"
        after = s.get(f"{API}/overview").json()
        assert after["spent"] == before["spent"]
        assert "personal_spent" in after and "business_spent" in after
        assert round(after["personal_spent"] + after["business_spent"], 2) == after["spent"]
        cats = s.get(f"{API}/categories").json()
        assert "Transfer / P2P" in cats["excluded"]


# ---------------- PATCH / filters / recurring
class TestTxPatch:
    def _mk(self, s, merchant, amt, cat="Food"):
        r = s.post(f"{API}/transactions", json={"amount": amt, "merchant": merchant, "category": cat, "direction": "debit"})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def test_business_apply_merchant(self, user):
        s = user["s"]
        a, b = self._mk(s, "TEST CAFE", 100), self._mk(s, "TEST CAFE", 120)
        r = s.patch(f"{API}/transactions/{a}", json={"business": True, "apply_business_to_merchant": False})
        assert r.json()["business"] is True and r.json()["updated_others"] == 0
        assert s.get(f"{API}/transactions/{b}").json()["business"] is False
        r = s.patch(f"{API}/transactions/{a}", json={"business": True, "apply_business_to_merchant": True})
        assert r.json()["updated_others"] >= 1
        assert s.get(f"{API}/transactions/{b}").json()["business"] is True
        # future tx from same merchant via SMS? manual create doesn't apply rules; check filter
        biz = s.get(f"{API}/transactions?filter=business").json()
        per = s.get(f"{API}/transactions?filter=personal").json()
        assert all(t["business"] for t in biz) and any(t["id"] == b for t in biz)
        assert all(not t["business"] and t["direction"] == "debit" for t in per)
        ov = s.get(f"{API}/overview").json()
        assert ov["business_spent"] >= 220

    def test_category_apply_merchant(self, user):
        s = user["s"]
        a, b = self._mk(s, "TEST BOOKS", 300), self._mk(s, "TEST BOOKS", 250)
        r = s.patch(f"{API}/transactions/{a}", json={"category": "Shopping", "apply_to_merchant": True})
        assert r.status_code == 200 and r.json()["category"] == "Shopping"
        assert s.get(f"{API}/transactions/{b}").json()["category"] == "Shopping"

    def test_recurring_toggle(self, user):
        s = user["s"]
        a = self._mk(s, "TEST GYMX", 999)
        r = s.patch(f"{API}/transactions/{a}", json={"recurring": True})
        assert r.status_code == 200 and r.json()["is_recurring"] is True
        assert s.get(f"{API}/transactions/{a}").json()["is_recurring"] is True
        rec = s.get(f"{API}/recurring").json()["items"]
        assert any("GYMX" in (i["merchant"] or "") and i["status"] == "active" for i in rec)
        r = s.patch(f"{API}/transactions/{a}", json={"recurring": False})
        assert r.json()["is_recurring"] is False
        rec = s.get(f"{API}/recurring").json()["items"]
        assert not any("GYMX" in (i["merchant"] or "") and i["status"] == "active" for i in rec)

    def test_patch_invalid(self, user):
        s = user["s"]
        assert s.patch(f"{API}/transactions/000000000000000000000000", json={"business": True}).status_code == 404
        a = self._mk(s, "TEST INV", 10)
        assert s.patch(f"{API}/transactions/{a}", json={"category": "NotACat"}).status_code == 400

    def test_export_reimbursable(self, user):
        s = user["s"]
        a = self._mk(s, "TEST TAXI", 400, "Transport" if "Transport" in s.get(f"{API}/categories").json()["spend"] else "Other")
        s.patch(f"{API}/transactions/{a}", json={"reimbursable": True})
        r = s.get(f"{API}/export/reimbursable")
        assert r.status_code == 200, r.text
        assert r.text.strip() != ""
