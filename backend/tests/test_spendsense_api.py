# SpendSense backend regression tests: auth, SMS ingest/parse/dedupe, transactions, rules, budgets/alerts, overview, recurring, review, export, isolation
import os
import time
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
IST = timezone(timedelta(hours=5, minutes=30))


def _register():
    email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "pass1234", "name": "TEST user"})
    assert r.status_code == 201, r.text
    d = r.json()
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {d['access_token']}"})
    return s, email, d


def _now_ms(offset_min=0):
    return (datetime.now(timezone.utc) + timedelta(minutes=offset_min)).timestamp() * 1000


def _d():
    return datetime.now(IST).strftime("%d-%m-%y")


def _ingest(s, msgs):
    r = s.post(f"{API}/sms/ingest", json={"messages": msgs})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def user_a():
    return _register()


@pytest.fixture(scope="module")
def sample_user():
    s, email, d = _register()
    r = s.post(f"{API}/sms/sample")
    assert r.status_code == 200, r.text
    return s, r.json()


# --- Auth
class TestAuth:
    def test_register_login_me(self, user_a):
        s, email, d = user_a
        assert d["user"]["email"] == email
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": "pass1234"})
        assert r.status_code == 200 and "access_token" in r.json()
        me = s.get(f"{API}/auth/me")
        assert me.status_code == 200 and me.json()["email"] == email

    def test_me_401_and_bad_login(self, user_a):
        assert requests.get(f"{API}/auth/me").status_code == 401
        assert requests.get(f"{API}/auth/me", headers={"Authorization": "Bearer junk"}).status_code == 401
        r = requests.post(f"{API}/auth/login", json={"email": user_a[1], "password": "wrong"})
        assert r.status_code == 401

    def test_duplicate_register(self, user_a):
        r = requests.post(f"{API}/auth/register", json={"email": user_a[1], "password": "pass1234"})
        assert r.status_code == 409

    def test_demo_login(self):
        r = requests.post(f"{API}/auth/login", json={"email": "demo@spendsense.in", "password": "demo1234"})
        assert r.status_code == 200


# --- SMS ingest
class TestIngest:
    def test_formats(self):
        s, _, _ = _register()
        d = _d()
        msgs = [
            {"sender": "AD-HDFCBK", "body": f"Rs.450.00 spent on HDFC Bank Card x1234 at SWIGGY on {d}. Not You? Call 18002586161", "received_at": _now_ms(-300)},
            {"sender": "VM-ICICIB", "body": f"INR 1,234.00 spent using ICICI Bank Card XX4321 on {d} on AMAZON PAY. Avl Limit: INR 2,30,000.00.", "received_at": _now_ms(-250)},
            {"sender": "JD-SBIUPI", "body": f"Dear UPI user A/C X9876 debited by 333.0 on date {d} trf to UBER INDIA Refno 412300001. -SBI", "received_at": _now_ms(-200)},
            {"sender": "AX-AXISBK", "body": f"INR 777.00 debited A/c no. XX5555 {d} 10:00:00 UPI/P2M/412398760432/SPOTIFY Not you?", "received_at": _now_ms(-150)},
            {"sender": "BZ-KOTAKB", "body": f"Sent Rs.288.00 from Kotak Bank AC X1111 to zomato.order@kotak on {d}.UPI Ref 412311111. Not you", "received_at": _now_ms(-100)},
            {"sender": "AM-AMEXIN", "body": f"Alert: You have spent INR 6,111.00 on your AMEX card ** 31007 at MAKEMYTRIP INDIA PVT LTD on {d} at 08:12 PM IST.", "received_at": _now_ms(-50)},
            {"sender": "AD-HDFCBK", "body": "Your OTP for transaction of Rs 500 is 123456. Do not share it with anyone", "received_at": _now_ms()},
            {"sender": "AD-HDFCBK", "body": "Get flat 50% off on your next purchase! Use code SALE. T&C apply", "received_at": _now_ms()},
            {"sender": "AX-AXISBK", "body": "Axis Bank: Your a/c XX5555 was debited towards a transaction. Ref 88123. Call us if not done by you.", "received_at": _now_ms()},
        ]
        r = _ingest(s, msgs)
        assert r["created"] == 6, r
        assert r["ignored"] == 2, r
        assert r["review"] == 1, r
        txs = s.get(f"{API}/transactions").json()
        by_amt = {t["amount"]: t for t in txs}
        assert set(by_amt) >= {450, 1234, 333, 777, 288, 6111}
        assert "SWIGGY" in by_amt[450]["merchant"].upper()
        assert by_amt[450]["category"] == "Food"
        # duplicate same sms
        r2 = _ingest(s, msgs[:1])
        assert r2["duplicate"] == 1

    def test_card_upi_merge(self):
        s, _, _ = _register()
        d = _d()
        r = _ingest(s, [
            {"sender": "VK-KOTAKB", "body": f"Rs.899.00 debited from Kotak Bank AC X1111 for UPI txn to blinkit@ybl on {d}. UPI Ref 412399990001", "received_at": _now_ms(-5)},
            {"sender": "AD-HDFCBK", "body": f"Rs.899.00 spent on HDFC Bank Card x1234 at BLINKIT on {d}. Not You? Call 18002586161", "received_at": _now_ms(-2)},
        ])
        assert r["created"] == 1 and r["merged"] == 1, r
        txs = [t for t in s.get(f"{API}/transactions").json() if t["amount"] == 899]
        assert len(txs) == 1 and txs[0]["merged_count"] == 2


# --- Sample data + transactions list/filter
class TestTransactions:
    def test_sample_and_filters(self, sample_user):
        s, res = sample_user
        assert res["created"] > 10 and res["merged"] >= 1 and res["ignored"] >= 1 and res["review"] >= 1
        allm = s.get(f"{API}/transactions", params={"month": "all"}).json()
        cur = s.get(f"{API}/transactions").json()
        assert len(allm) >= len(cur) > 0
        inc = s.get(f"{API}/transactions", params={"filter": "income"}).json()
        assert inc and all(t["direction"] == "credit" for t in inc)
        food = s.get(f"{API}/transactions", params={"category": "Food", "month": "all"}).json()
        assert food and all(t["category"] == "Food" for t in food)
        q = s.get(f"{API}/transactions", params={"q": "swiggy", "month": "all"}).json()
        assert q and all("swiggy" in t["merchant"].lower() for t in q)
        rv = s.get(f"{API}/transactions", params={"filter": "review", "month": "all"}).json()
        assert all(t["needs_review"] for t in rv)
        assert "_id" not in cur[0]

    def test_recategorize_apply_merchant_and_future(self):
        s, _, _ = _register()
        d = _d()
        _ingest(s, [
            {"sender": "VM-ICICIB", "body": f"INR 111.00 spent using ICICI Bank Card XX4321 on {d} on FOOBAR TRADERS. Avl Limit: INR 2,30,000.00.", "received_at": _now_ms(-120)},
            {"sender": "VM-ICICIB", "body": f"INR 222.00 spent using ICICI Bank Card XX4321 on {d} on FOOBAR TRADERS. Avl Limit: INR 2,29,000.00.", "received_at": _now_ms(-60)},
        ])
        txs = [t for t in s.get(f"{API}/transactions").json() if "FOOBAR" in t["merchant"].upper()]
        assert len(txs) == 2
        r = s.patch(f"{API}/transactions/{txs[0]['id']}", json={"category": "Shopping", "apply_to_merchant": True})
        assert r.status_code == 200 and r.json()["updated_others"] == 1
        other = s.get(f"{API}/transactions/{txs[1]['id']}").json()
        assert other["category"] == "Shopping"
        _ingest(s, [{"sender": "VM-ICICIB", "body": f"INR 333.00 spent using ICICI Bank Card XX4321 on {d} on FOOBAR TRADERS. Avl Limit: INR 2,28,000.00.", "received_at": _now_ms()}])
        new = [t for t in s.get(f"{API}/transactions").json() if t["amount"] == 333]
        assert new and new[0]["category"] == "Shopping"
        assert s.patch(f"{API}/transactions/{txs[0]['id']}", json={"category": "NotACat"}).status_code == 400

    def test_reimbursable_export(self):
        s, _, _ = _register()
        r = s.post(f"{API}/transactions", json={"amount": 1450.5, "merchant": "Office Cab", "category": "Transport", "note": "client visit"})
        assert r.status_code == 201
        tid = r.json()["id"]
        p = s.patch(f"{API}/transactions/{tid}", json={"reimbursable": True, "note": "TEST_note"})
        assert p.json()["reimbursable"] is True and p.json()["note"] == "TEST_note"
        rb = s.get(f"{API}/transactions", params={"filter": "reimbursable"}).json()
        assert len(rb) == 1
        month = datetime.now(IST).strftime("%Y-%m")
        csv = s.get(f"{API}/export/reimbursable", params={"month": month})
        assert csv.status_code == 200 and "text/csv" in csv.headers["content-type"]
        lines = csv.text.strip().splitlines()
        assert lines[0].strip() == "Date,Merchant,Amount,Category,Note"
        assert "1450.50" in lines[1] and "TEST_note" in lines[1]
        # delete -> 404
        assert s.delete(f"{API}/transactions/{tid}").status_code == 200
        assert s.get(f"{API}/transactions/{tid}").status_code == 404


# --- Budgets + alerts
class TestBudgetsAlerts:
    def test_budget_threshold_alerts(self):
        s, _, _ = _register()
        assert s.put(f"{API}/budgets", json={"category": "Food", "amount": 1000}).status_code == 200
        b = s.get(f"{API}/budgets").json()
        food = next(i for i in b["items"] if i["category"] == "Food")
        assert food["budget"] == 1000
        s.post(f"{API}/transactions", json={"amount": 750, "merchant": "Swiggy", "category": "Food"})
        al = s.get(f"{API}/alerts").json()["items"]
        a70 = [a for a in al if a["type"] == "budget" and "70%" in a["title"]]
        assert a70 and "on day" in a70[0]["message"] and "of the month" in a70[0]["message"]
        s.post(f"{API}/transactions", json={"amount": 400, "merchant": "Zomato", "category": "Food"})
        al = s.get(f"{API}/alerts").json()["items"]
        assert any("exceeded" in a["title"] for a in al)
        assert s.put(f"{API}/budgets", json={"category": "Bogus", "amount": 10}).status_code == 400


# --- Overview + settings
class TestOverview:
    def test_safe_to_spend_math(self):
        s, _, _ = _register()
        s.put(f"{API}/settings", json={"monthly_income": 50000, "savings_target": 10000})
        s.post(f"{API}/transactions", json={"amount": 5000, "merchant": "Big Bazaar", "category": "Groceries"})
        o = s.get(f"{API}/overview").json()
        assert o["income"] == 50000 and o["spent"] == 5000 and o["savings_target"] == 10000
        assert o["safe_to_spend"] == round(50000 - o["committed"] - 10000 - 5000, 2) == 35000
        s.put(f"{API}/settings", json={"savings_target": 20000})
        assert s.get(f"{API}/overview").json()["safe_to_spend"] == 25000


# --- Recurring
class TestRecurring:
    def test_detection_and_status(self, sample_user):
        s, _ = sample_user
        r = s.get(f"{API}/recurring").json()
        names = " ".join(i["merchant"].upper() for i in r["items"])
        for k in ("NETFLIX", "NOBROKER", "CULT"):
            assert k in names, names
        nf = next(i for i in r["items"] if "NETFLIX" in i["merchant"].upper())
        assert s.put(f"{API}/recurring", json={"merchant_key": nf["merchant_key"], "status": "cancelled"}).status_code == 200
        r2 = s.get(f"{API}/recurring").json()
        assert next(i for i in r2["items"] if i["merchant_key"] == nf["merchant_key"])["status"] == "cancelled"
        s.put(f"{API}/recurring", json={"merchant_key": nf["merchant_key"], "status": "ignored"})
        r3 = s.get(f"{API}/recurring").json()
        assert all(i["merchant_key"] != nf["merchant_key"] for i in r3["items"])
        assert s.put(f"{API}/recurring", json={"merchant_key": "x", "status": "bad"}).status_code == 400


# --- Review queue
class TestReview:
    def test_resolve_and_dismiss(self):
        s, _, _ = _register()
        _ingest(s, [
            {"sender": "AX-AXISBK", "body": "Axis Bank: Your a/c XX5555 was debited towards a transaction. Ref 1.", "received_at": _now_ms()},
            {"sender": "AX-AXISBK", "body": "Axis Bank: Your a/c XX5555 was debited towards a transaction. Ref 2.", "received_at": _now_ms()},
        ])
        rv = s.get(f"{API}/review").json()
        assert len(rv["unparsed"]) == 2
        a, b = rv["unparsed"]
        r = s.post(f"{API}/review/{a['id']}/resolve", json={"amount": 300, "merchant": "Chai Point", "category": "Food"})
        assert r.status_code == 200 and r.json()["amount"] == 300
        assert s.delete(f"{API}/review/{b['id']}").status_code == 200
        assert s.get(f"{API}/review").json()["unparsed"] == []
        assert s.delete(f"{API}/review/{b['id']}").status_code == 404


# --- Isolation
class TestIsolation:
    def test_user_b_cannot_read_a(self, user_a):
        sa = user_a[0]
        t = sa.post(f"{API}/transactions", json={"amount": 99, "merchant": "Secret", "category": "Other"}).json()
        sb, _, _ = _register()
        assert sb.get(f"{API}/transactions/{t['id']}").status_code == 404
        assert sb.patch(f"{API}/transactions/{t['id']}", json={"note": "hack"}).status_code == 404
        assert sb.delete(f"{API}/transactions/{t['id']}").status_code == 404
        assert all(x["id"] != t["id"] for x in sb.get(f"{API}/transactions", params={"month": "all"}).json())

    def test_invalid_month_param(self, user_a):
        r = user_a[0].get(f"{API}/transactions", params={"month": "bad"})
        assert r.status_code in (400, 422), f"got {r.status_code}"
