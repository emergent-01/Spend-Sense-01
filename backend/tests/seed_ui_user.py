# Seeds an isolated UI test user (TEST_ui_user) with a session token and sample SMS data
import os
from datetime import datetime, timedelta, timezone
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
API = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
uid, tok = "TEST_ui_user", "TEST_ui_session_token"
now = datetime.now(timezone.utc)
for col in ["transactions", "merchant_rules", "sms_seen", "review_items", "recurring_overrides", "alerts", "budgets"]:
    db[col].delete_many({"user_id": uid})
db.users.update_one({"user_id": uid}, {"$set": {"user_id": uid, "email": "test_ui_user@example.com", "name": "UI Tester",
                                                "monthly_income": 80000, "created_at": now}}, upsert=True)
db.user_sessions.update_one({"session_token": tok}, {"$set": {"session_token": tok, "user_id": uid,
                                                               "expires_at": now + timedelta(days=7), "created_at": now}}, upsert=True)
r = requests.post(f"{API}/sms/sample", headers={"Authorization": f"Bearer {tok}"})
print("sample:", r.status_code, r.text[:200])
txs = requests.get(f"{API}/transactions", headers={"Authorization": f"Bearer {tok}"}).json()
print("tx count:", len(txs), [(t["merchant"], t["category"], t["business"]) for t in txs[:6]])
