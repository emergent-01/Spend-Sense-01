# Edge probes for SMS parsing/dedupe (exploratory, prints results)
import os, uuid, requests
from datetime import datetime, timezone, timedelta
API = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
IST = timezone(timedelta(hours=5, minutes=30))
d = datetime.now(IST).strftime("%d-%m-%y")
now = datetime.now(timezone.utc).timestamp() * 1000
r = requests.post(f"{API}/auth/register", json={"email": f"test_{uuid.uuid4().hex[:8]}@ex.com", "password": "pass1234"}).json()
s = requests.Session(); s.headers["Authorization"] = "Bearer " + r["access_token"]
def ing(msgs):
    return s.post(f"{API}/sms/ingest", json={"messages": msgs}).json()
# two separate same-amount same-card purchases at different merchants 3 minutes apart
print("diff merchants same amount:", {k: v for k, v in ing([
    {"sender": "AD-HDFCBK", "body": f"Rs.200.00 spent on HDFC Bank Card x1234 at STARBUCKS on {d}. Not You?", "received_at": now - 300000},
    {"sender": "AD-HDFCBK", "body": f"Rs.200.00 spent on HDFC Bank Card x1234 at CHAAYOS on {d}. Not You?", "received_at": now - 120000}]).items() if k != "alerts"})
# salary credit
print("salary:", {k: v for k, v in ing([{"sender": "AD-HDFCBK", "body": f"Update! INR 85,000.00 deposited in HDFC Bank A/c XX1234 on {d} for NEFT Cr-CITI0000001-ACME CORP SALARY.Avl bal INR 1,40,000.00", "received_at": now - 3600000}]).items() if k != "alerts"})
# credited UPI (refund)
print("upi credit:", {k: v for k, v in ing([{"sender": "VM-ICICIB", "body": f"Dear Customer, Acct XX4321 is credited with Rs 500.00 on {d} from RAHUL SHARMA. UPI:412355555-ICICI Bank.", "received_at": now - 7200000}]).items() if k != "alerts"})
# Kotak debit card
print("kotak card:", {k: v for k, v in ing([{"sender": "BZ-KOTAKB", "body": f"Rs 1,099.00 spent via Kotak Debit Card XX1111 at DECATHLON on {d}. Avl bal Rs 10,000", "received_at": now - 9000000}]).items() if k != "alerts"})
# axis credit card
print("axis cc:", {k: v for k, v in ing([{"sender": "AX-AXISBK", "body": f"Spent INR 2,345.00 Axis Bank Card no. XX9012 {d} 14:22:10 IST PVR CINEMAS Avl Limit: INR 90,000", "received_at": now - 10000000}]).items() if k != "alerts"})
# SBI card
print("sbi card:", {k: v for k, v in ing([{"sender": "AD-SBICRD", "body": f"Rs.4,567.00 spent on your SBI Credit Card ending 5678 at CROMA on {d}. Trxn. not done by you? Report at https://sbicard.com", "received_at": now - 11000000}]).items() if k != "alerts"})
# CC bill payment -> Transfer
print("cc bill:", {k: v for k, v in ing([{"sender": "AD-HDFCBK", "body": f"Rs.15000.00 debited from HDFC Bank A/c XX1234 on {d} towards credit card bill payment. Ref 9988", "received_at": now - 12000000}]).items() if k != "alerts"})
for t in s.get(f"{API}/transactions").json():
    print(t["amount"], t["direction"], t["merchant"], t["category"], t["is_salary"], t["needs_review"], t["merged_count"], t["bank"], t["mode"])
o = s.get(f"{API}/overview").json()
print("overview income", o["income"], o["income_source"], "spent", o["spent"], "safe", o["safe_to_spend"])
