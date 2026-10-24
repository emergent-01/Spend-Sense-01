from fastapi import FastAPI, APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, BeforeValidator, ConfigDict
from typing import Annotated, Optional, List
from datetime import datetime, timezone, timedelta
from calendar import monthrange
from pathlib import Path
from bson import ObjectId
from cryptography.fernet import Fernet
import os, re, io, csv, json, hmac, hashlib, logging, statistics
import bcrypt, jwt

from sms_parser import parse_sms, clean_merchant, CATEGORIES, INCOME_CATEGORIES, IST

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = client[os.environ['DB_NAME']]
JWT_SECRET = os.environ['JWT_SECRET']
FERNET = Fernet(os.environ['ENCRYPTION_KEY'].encode())
HMAC_KEY = os.environ['ENCRYPTION_KEY'].encode()
SPEND_EXCLUDED = ["Transfer"]
ALL_DEBIT_CATEGORIES = CATEGORIES + SPEND_EXCLUDED

app = FastAPI()
logger = logging.getLogger("spendsense")
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')


@app.get("/health", include_in_schema=False)
@app.head("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}

api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)

# ---------------------------------------------------------------- models / helpers
PyObjectId = Annotated[str, BeforeValidator(lambda v: str(v) if isinstance(v, ObjectId) else v)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    @classmethod
    def from_mongo(cls, doc: dict):
        return cls(**doc) if doc else None

    def to_mongo(self) -> dict:
        d = self.model_dump(by_alias=True, exclude_none=False)
        if d.get("_id") is None:
            d.pop("_id", None)
        else:
            d["_id"] = ObjectId(d["_id"])
        return d


class UserDoc(BaseDocument):
    email: str
    password_hash: str
    name: Optional[str] = None
    monthly_income: float = 0
    savings_target: float = 0
    created_at: datetime


class TxDoc(BaseDocument):
    user_id: str
    ts: datetime
    amount: float
    direction: str
    category: str
    needs_review: bool = False
    reimbursable: bool = False
    is_salary: bool = False
    source: str = "sms"
    merchant_key: Optional[str] = None
    sms_hashes: List[str] = []
    enc: str = ""
    created_at: datetime


def enc(d: dict) -> str:
    return FERNET.encrypt(json.dumps(d, default=str).encode()).decode()


def dec(s: str) -> dict:
    try:
        return json.loads(FERNET.decrypt(s.encode()).decode()) if s else {}
    except Exception:
        return {}


def mkey(merchant: Optional[str]) -> Optional[str]:
    if not merchant:
        return None
    norm = re.sub(r"[^A-Z0-9]", "", merchant.upper())
    return hmac.new(HMAC_KEY, norm.encode(), hashlib.sha256).hexdigest()[:32] if norm else None


def now_ist() -> datetime:
    return datetime.now(IST)


def month_str(dt: Optional[datetime] = None) -> str:
    return (dt or now_ist()).astimezone(IST).strftime("%Y-%m")


def month_bounds(month: Optional[str]):
    m = month or month_str()
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", m):
        raise HTTPException(400, "month must be YYYY-MM")
    y, mo = int(m[:4]), int(m[5:7])
    start = datetime(y, mo, 1, tzinfo=IST)
    end = datetime(y + (mo == 12), 1 if mo == 12 else mo + 1, 1, tzinfo=IST)
    return m, start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def tx_out(doc: dict) -> dict:
    t = TxDoc.from_mongo(doc)
    e = dec(t.enc)
    return {
        "id": t.id, "ts": aware(t.ts).isoformat(), "amount": t.amount, "direction": t.direction,
        "category": t.category, "needs_review": t.needs_review, "reimbursable": t.reimbursable,
        "is_salary": t.is_salary, "source": t.source, "merchant_key": t.merchant_key,
        "merchant": e.get("merchant") or ("Unknown payee" if t.direction == "debit" else "Unknown sender"),
        "vpa": e.get("vpa"), "card_last4": e.get("card_last4"), "account": e.get("account"),
        "bank": e.get("bank"), "mode": e.get("mode"), "note": e.get("note") or "",
        "raw": e.get("raw", []), "merged_count": len(t.sms_hashes),
    }


def inr(v: float) -> str:
    v = round(v)
    s = str(abs(int(v)))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        head = re.sub(r"(\d)(?=(\d{2})+$)", r"\1,", head)
        s = head + "," + tail
    return ("-" if v < 0 else "") + "₹" + s


async def current_user(cred: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    if not cred:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(cred.credentials, JWT_SECRET, algorithms=["HS256"])
        uid = payload["sub"]
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    if not ObjectId.is_valid(uid):
        raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"_id": ObjectId(uid)})
    if not user:
        raise HTTPException(401, "User not found")
    user["id"] = str(user["_id"])
    return user


def make_token(uid: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": uid, "iat": now, "exp": now + timedelta(days=30)}, JWT_SECRET, algorithm="HS256")


def user_out(u: dict) -> dict:
    return {"id": str(u["_id"]), "email": u["email"], "name": u.get("name"),
            "monthly_income": u.get("monthly_income", 0), "savings_target": u.get("savings_target", 0)}

# ---------------------------------------------------------------- auth
class RegisterIn(BaseModel):
    email: str
    password: str = Field(min_length=6, max_length=128)
    name: Optional[str] = None


class LoginIn(BaseModel):
    email: str
    password: str


def norm_email(e: str) -> str:
    e = e.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", e):
        raise HTTPException(400, "Enter a valid email")
    return e


@api.post("/auth/register", status_code=201)
async def register(body: RegisterIn):
    email = norm_email(body.email)
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")
    u = UserDoc(email=email, name=(body.name or "").strip() or None,
                password_hash=bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode(),
                created_at=datetime.now(timezone.utc))
    res = await db.users.insert_one(u.to_mongo())
    doc = await db.users.find_one({"_id": res.inserted_id})
    return {"access_token": make_token(str(res.inserted_id)), "user": user_out(doc)}


@api.post("/auth/login")
async def login(body: LoginIn):
    user = await db.users.find_one({"email": body.email.strip().lower()})
    if not user or not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
        raise HTTPException(401, "Invalid email or password")
    return {"access_token": make_token(str(user["_id"])), "user": user_out(user)}


@api.get("/auth/me")
async def me(user=Depends(current_user)):
    return user_out(user)


class SettingsIn(BaseModel):
    monthly_income: Optional[float] = Field(default=None, ge=0)
    savings_target: Optional[float] = Field(default=None, ge=0)
    name: Optional[str] = None


@api.get("/settings")
async def get_settings(user=Depends(current_user)):
    return user_out(user)


@api.put("/settings")
async def put_settings(body: SettingsIn, user=Depends(current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if upd:
        await db.users.update_one({"_id": user["_id"]}, {"$set": upd})
    return user_out(await db.users.find_one({"_id": user["_id"]}))


@api.get("/categories")
async def categories():
    return {"spend": CATEGORIES, "excluded": SPEND_EXCLUDED, "income": INCOME_CATEGORIES}

# ---------------------------------------------------------------- ingestion
class SmsIn(BaseModel):
    body: str
    sender: Optional[str] = ""
    received_at: Optional[float] = None  # epoch ms from device


class IngestIn(BaseModel):
    messages: List[SmsIn]


async def rule_category(uid: str, merchant_key: Optional[str]) -> Optional[str]:
    if not merchant_key:
        return None
    r = await db.merchant_rules.find_one({"user_id": uid, "merchant_key": merchant_key})
    return r["category"] if r else None


async def ingest_one(uid: str, m: SmsIn) -> str:
    body = (m.body or "").strip()
    if not body:
        return "ignored"
    h = hashlib.sha256(f"{uid}|{(m.sender or '').upper()}|{body}".encode()).hexdigest()
    if await db.sms_seen.find_one({"user_id": uid, "hash": h}):
        return "duplicate"
    received = datetime.fromtimestamp(m.received_at / 1000, tz=timezone.utc) if m.received_at else None
    p = parse_sms(m.sender or "", body, received)
    await db.sms_seen.update_one({"user_id": uid, "hash": h}, {"$setOnInsert": {"user_id": uid, "hash": h}}, upsert=True)
    if p["status"] == "ignored":
        return "ignored"
    if p["status"] == "unparsed":
        await db.review_items.insert_one({
            "user_id": uid, "enc": enc({"body": body, "sender": m.sender}), "reason": p.get("reason"),
            "ts": received or datetime.now(timezone.utc), "created_at": datetime.now(timezone.utc)})
        return "review"
    mk = mkey(p["merchant"])
    category = p["category"]
    learned = await rule_category(uid, mk) if p["direction"] == "debit" else None
    if learned:
        category = learned
    needs_review = category is None
    category = category or "Other"
    if p["direction"] == "debit" and re.search(r"credit card (?:bill )?payment|payment (?:received )?towards your|cred club|self transfer|own account", body, re.I):
        category, needs_review = "Transfer", False
    # de-duplicate: card SMS + UPI SMS for one purchase (same amount, direction, within 10 min)
    ts = p["ts"]
    candidates = await db.transactions.find({
        "user_id": uid, "amount": p["amount"], "direction": p["direction"], "source": "sms",
        "ts": {"$gte": ts - timedelta(minutes=10), "$lte": ts + timedelta(minutes=10)}}).to_list(20)
    existing, e = None, {}
    for c in candidates:
        ce = dec(c["enc"])
        same_merchant = not c.get("merchant_key") or not mk or c.get("merchant_key") == mk
        diff_channel = (ce.get("mode") or "") != (p.get("mode") or "")
        if same_merchant or diff_channel:
            existing, e = c, ce
            break
    if existing:
        for f in ["merchant", "vpa", "card_last4", "account", "bank", "mode"]:
            if not e.get(f) and p.get(f):
                e[f] = p[f]
        e["raw"] = (e.get("raw") or []) + [body]
        upd = {"enc": enc(e), "sms_hashes": existing.get("sms_hashes", []) + [h]}
        if existing.get("needs_review") and not needs_review:
            upd.update({"category": category, "needs_review": False})
        if not existing.get("merchant_key") and mk:
            upd["merchant_key"] = mk
        await db.transactions.update_one({"_id": existing["_id"]}, {"$set": upd})
        return "merged"
    t = TxDoc(user_id=uid, ts=ts, amount=p["amount"], direction=p["direction"], category=category,
              needs_review=needs_review, is_salary=p["is_salary"], source="sms", merchant_key=mk, sms_hashes=[h],
              enc=enc({k: p.get(k) for k in ["merchant", "vpa", "card_last4", "account", "bank", "mode"]} | {"raw": [body]}),
              created_at=datetime.now(timezone.utc))
    await db.transactions.insert_one(t.to_mongo())
    return "created"


@api.post("/sms/ingest")
async def ingest(body: IngestIn, user=Depends(current_user)):
    uid = user["id"]
    counts = {"created": 0, "merged": 0, "review": 0, "ignored": 0, "duplicate": 0}
    for m in body.messages[:1000]:
        counts[await ingest_one(uid, m)] += 1
    alerts = await run_alert_checks(user) if counts["created"] or counts["merged"] else []
    return {**counts, "processed": len(body.messages[:1000]), "alerts": alerts}


@api.post("/sms/sample")
async def load_sample(user=Depends(current_user)):
    """Loads realistic sample SMS so the dashboard can be tried in the preview."""
    now = now_ist()
    msgs = []

    def at(days_ago, hh=13, mm=5):
        d = (now - timedelta(days=days_ago)).replace(hour=hh, minute=mm, second=0, microsecond=0)
        return d.timestamp() * 1000, d.strftime("%d-%m-%y")

    for mo in range(3):
        base = mo * 30
        ms, d = at(base + max(now.day - 1, 0), 9, 30)
        msgs.append(("AD-HDFCBK", f"Update! INR 95,000.00 deposited in HDFC Bank A/c XX1234 on {d} for NEFT Cr-CITI0000001-ACME CORP SALARY.Avl bal INR 1,40,000.00", ms))
        ms, d = at(base + max(now.day - 3, 0), 10, 0)
        msgs.append(("AX-AXISBK", f"INR 649.00 debited A/c no. XX5555 {d} 10:00:00 UPI/P2M/41239876{mo}432/NETFLIX Not you? SMS BLOCKUPI to 919951860002", ms))
        ms, d = at(base + max(now.day - 2, 0), 11, 0)
        msgs.append(("JD-SBIUPI", f"Dear UPI user A/C X9876 debited by 22000.0 on date {d} trf to NOBROKER RENT Refno 41234567{mo}901. If not u? call 1800111109. -SBI", ms))
        ms, d = at(base + max(now.day - 4, 0), 7, 0)
        msgs.append(("VM-ICICIB", f"INR 1,500.00 spent using ICICI Bank Card XX4321 on {d} on CULT FIT. Avl Limit: INR 2,34,000.00.", ms))
    daily = [
        ("AD-HDFCBK", "Rs.{a}.00 spent on HDFC Bank Card x1234 at SWIGGY on {d}. Not You? Call 18002586161", [420, 380, 615, 290, 510, 455]),
        ("BZ-KOTAKB", "Sent Rs.{a}.00 from Kotak Bank AC X1111 to zomato.order@kotak on {d}.UPI Ref 4123{r}. Not you, kotak.com/fraud", [350, 540, 260]),
        ("JD-SBIUPI", "Dear UPI user A/C X9876 debited by {a}.0 on date {d} trf to UBER INDIA Refno 4123{r}. -SBI", [240, 310, 185, 420, 275]),
        ("VM-ICICIB", "INR {a}.00 spent using ICICI Bank Card XX4321 on {d} on AMAZON PAY. Avl Limit: INR 2,30,000.00.", [1899, 2499, 799]),
        ("VK-ICICIB", "ICICI Bank Acct XX4321 debited for Rs {a}.00 on {d}; BigBasket credited. UPI:4123{r}.", [1240, 860, 1530]),
        ("AM-AMEXIN", "Alert: You have spent INR {a}.00 on your AMEX card ** 31007 at MAKEMYTRIP INDIA PVT LTD on {d} at 08:12 PM IST.", [6400]),
        ("AD-HDFCBK", "Sent Rs.{a}.00 From HDFC Bank A/C *1234 To RAHUL SHARMA On {d} Ref 6123{r} Not You? Call 18002586161", [1500]),
    ]
    i = 0
    for sender, tpl, amounts in daily:
        for a in amounts:
            i += 1
            days_ago = (i * 3) % max(now.day, 1) if i % 3 else (i * 5) % 75
            ms, d = at(days_ago, 12 + i % 9, (i * 7) % 60)
            msgs.append((sender, tpl.format(a=a, d=d, r=str(100000 + i * 7919)), ms))
    # same purchase reported by card SMS and UPI SMS -> merged
    ms, d = at(0, 9, 12)
    msgs.append(("VK-KOTAKB", f"Rs.799.00 debited from Kotak Bank AC X1111 for UPI txn to blinkit@ybl on {d}. UPI Ref 412399990001", ms))
    msgs.append(("AD-HDFCBK", f"Rs.799.00 spent on HDFC Bank Card x1234 at BLINKIT on {d}. Not You? Call 18002586161", ms + 120000))
    msgs.append(("AD-HDFCBK", "Your OTP for transaction of Rs 500 is 123456. Do not share it with anyone", ms))
    msgs.append(("AX-AXISBK", "Axis Bank: Your a/c XX5555 was debited towards a transaction. Ref 88123. Call us if not done by you.", ms))
    msgs.append(("AD-HDFCBK", "Sent Rs.560.00 From HDFC Bank A/C *1234 To MR KUMAR STORES On " + d + " Ref 61239990002", ms - 3600000))
    body = IngestIn(messages=[SmsIn(sender=s, body=b, received_at=t) for s, b, t in msgs])
    return await ingest(body, user)

# ---------------------------------------------------------------- transactions
class TxCreate(BaseModel):
    amount: float = Field(gt=0)
    direction: str = "debit"
    merchant: str
    category: str
    date: Optional[str] = None
    note: Optional[str] = ""
    reimbursable: bool = False


class TxPatch(BaseModel):
    category: Optional[str] = None
    apply_to_merchant: bool = False
    reimbursable: Optional[bool] = None
    note: Optional[str] = None
    merchant: Optional[str] = None


def valid_category(direction: str, cat: str):
    allowed = ALL_DEBIT_CATEGORIES if direction == "debit" else INCOME_CATEGORIES
    if cat not in allowed:
        raise HTTPException(400, f"Invalid category for {direction}")


@api.get("/transactions")
async def list_transactions(month: Optional[str] = None, q: Optional[str] = None, category: Optional[str] = None,
                            filter: str = "all", limit: int = 500, user=Depends(current_user)):
    query = {"user_id": user["id"]}
    if month != "all":
        _, s, e = month_bounds(month)
        query["ts"] = {"$gte": s, "$lt": e}
    if category:
        query["category"] = category
    if filter == "review":
        query["needs_review"] = True
    elif filter == "reimbursable":
        query["reimbursable"] = True
    elif filter == "income":
        query["direction"] = "credit"
    elif filter == "expense":
        query["direction"] = "debit"
    docs = await db.transactions.find(query).sort("ts", -1).to_list(min(limit, 2000))
    items = [tx_out(d) for d in docs]
    if q:
        ql = q.lower()
        items = [t for t in items if ql in (t["merchant"] or "").lower() or ql in (t["vpa"] or "").lower()
                 or ql in t["category"].lower() or ql in (t["note"] or "").lower() or ql in str(t["amount"])]
    return items


@api.get("/transactions/{tid}")
async def get_transaction(tid: str, user=Depends(current_user)):
    d = await db.transactions.find_one({"_id": ObjectId(tid), "user_id": user["id"]}) if ObjectId.is_valid(tid) else None
    if not d:
        raise HTTPException(404, "Transaction not found")
    return tx_out(d)


@api.post("/transactions", status_code=201)
async def create_transaction(body: TxCreate, user=Depends(current_user)):
    if body.direction not in ("debit", "credit"):
        raise HTTPException(400, "direction must be debit or credit")
    valid_category(body.direction, body.category)
    ts = datetime.now(timezone.utc)
    if body.date:
        try:
            ts = aware(datetime.fromisoformat(body.date.replace("Z", "+00:00")))
        except ValueError:
            raise HTTPException(400, "Invalid date")
    merchant = clean_merchant(body.merchant) or body.merchant.strip().upper()[:40]
    t = TxDoc(user_id=user["id"], ts=ts, amount=round(body.amount, 2), direction=body.direction, category=body.category,
              reimbursable=body.reimbursable, is_salary=body.category == "Income", source="manual",
              merchant_key=mkey(merchant), enc=enc({"merchant": merchant, "note": body.note, "mode": "manual"}),
              created_at=datetime.now(timezone.utc))
    res = await db.transactions.insert_one(t.to_mongo())
    await run_alert_checks(user)
    return tx_out(await db.transactions.find_one({"_id": res.inserted_id}))


@api.patch("/transactions/{tid}")
async def patch_transaction(tid: str, body: TxPatch, user=Depends(current_user)):
    d = await db.transactions.find_one({"_id": ObjectId(tid), "user_id": user["id"]}) if ObjectId.is_valid(tid) else None
    if not d:
        raise HTTPException(404, "Transaction not found")
    upd, e = {}, dec(d["enc"])
    updated_others = 0
    if body.merchant is not None and body.merchant.strip():
        e["merchant"] = body.merchant.strip().upper()[:40]
        upd["merchant_key"] = mkey(e["merchant"])
    if body.note is not None:
        e["note"] = body.note[:300]
    if body.merchant is not None or body.note is not None:
        upd["enc"] = enc(e)
    if body.reimbursable is not None:
        upd["reimbursable"] = body.reimbursable
    if body.category:
        valid_category(d["direction"], body.category)
        upd.update({"category": body.category, "needs_review": False, "is_salary": body.category == "Income"})
        mk = upd.get("merchant_key") or d.get("merchant_key")
        if body.apply_to_merchant and mk and d["direction"] == "debit":
            await db.merchant_rules.update_one({"user_id": user["id"], "merchant_key": mk},
                                               {"$set": {"category": body.category, "updated_at": datetime.now(timezone.utc)}}, upsert=True)
            r = await db.transactions.update_many(
                {"user_id": user["id"], "merchant_key": mk, "direction": "debit", "_id": {"$ne": d["_id"]}},
                {"$set": {"category": body.category, "needs_review": False}})
            updated_others = r.modified_count
    if upd:
        await db.transactions.update_one({"_id": d["_id"]}, {"$set": upd})
    if body.category:
        await run_alert_checks(user)
    out = tx_out(await db.transactions.find_one({"_id": d["_id"]}))
    out["updated_others"] = updated_others
    return out


@api.delete("/transactions/{tid}")
async def delete_transaction(tid: str, user=Depends(current_user)):
    r = await db.transactions.delete_one({"_id": ObjectId(tid), "user_id": user["id"]}) if ObjectId.is_valid(tid) else None
    if not r or not r.deleted_count:
        raise HTTPException(404, "Transaction not found")
    return {"ok": True}

# ---------------------------------------------------------------- review queue
class ResolveIn(BaseModel):
    amount: float = Field(gt=0)
    direction: str = "debit"
    merchant: str
    category: str


@api.get("/review")
async def review_queue(user=Depends(current_user)):
    items = await db.review_items.find({"user_id": user["id"]}).sort("ts", -1).to_list(500)
    unparsed = [{"id": str(i["_id"]), "ts": aware(i["ts"]).isoformat(), "reason": i.get("reason"), **dec(i["enc"])} for i in items]
    unc = await db.transactions.find({"user_id": user["id"], "needs_review": True}).sort("ts", -1).to_list(500)
    return {"unparsed": unparsed, "uncategorized": [tx_out(d) for d in unc], "count": len(unparsed) + len(unc)}


@api.post("/review/{rid}/resolve")
async def resolve_review(rid: str, body: ResolveIn, user=Depends(current_user)):
    item = await db.review_items.find_one({"_id": ObjectId(rid), "user_id": user["id"]}) if ObjectId.is_valid(rid) else None
    if not item:
        raise HTTPException(404, "Item not found")
    if body.direction not in ("debit", "credit"):
        raise HTTPException(400, "direction must be debit or credit")
    valid_category(body.direction, body.category)
    raw = dec(item["enc"])
    merchant = clean_merchant(body.merchant) or body.merchant.strip().upper()[:40]
    t = TxDoc(user_id=user["id"], ts=aware(item["ts"]), amount=round(body.amount, 2), direction=body.direction,
              category=body.category, source="sms", merchant_key=mkey(merchant), is_salary=body.category == "Income",
              enc=enc({"merchant": merchant, "raw": [raw.get("body", "")], "mode": "manual"}), created_at=datetime.now(timezone.utc))
    res = await db.transactions.insert_one(t.to_mongo())
    await db.review_items.delete_one({"_id": item["_id"]})
    await run_alert_checks(user)
    return tx_out(await db.transactions.find_one({"_id": res.inserted_id}))


@api.delete("/review/{rid}")
async def dismiss_review(rid: str, user=Depends(current_user)):
    r = await db.review_items.delete_one({"_id": ObjectId(rid), "user_id": user["id"]}) if ObjectId.is_valid(rid) else None
    if not r or not r.deleted_count:
        raise HTTPException(404, "Item not found")
    return {"ok": True}

# ---------------------------------------------------------------- budgets
class BudgetIn(BaseModel):
    category: str
    amount: float = Field(ge=0)


async def spend_by_category(uid: str, month: Optional[str]) -> dict:
    _, s, e = month_bounds(month)
    rows = await db.transactions.aggregate([
        {"$match": {"user_id": uid, "direction": "debit", "ts": {"$gte": s, "$lt": e}}},
        {"$group": {"_id": "$category", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}]).to_list(50)
    return {r["_id"]: {"total": round(r["total"], 2), "count": r["count"]} for r in rows}


def month_progress(month: str):
    y, mo = int(month[:4]), int(month[5:7])
    dim = monthrange(y, mo)[1]
    n = now_ist()
    cur = month_str(n)
    day = n.day if month == cur else (dim if month < cur else 0)
    return day, dim


async def compute_budgets(uid: str, month: Optional[str]) -> list:
    m, _, _ = month_bounds(month)
    spend = await spend_by_category(uid, m)
    budgets = {b["category"]: b["amount"] for b in await db.budgets.find({"user_id": uid}).to_list(50)}
    day, dim = month_progress(m)
    out = []
    for c in CATEGORIES:
        amt = budgets.get(c, 0)
        spent = spend.get(c, {}).get("total", 0)
        pct = round(spent / amt * 100, 1) if amt else 0
        projected = round(spent / day * dim, 2) if day else spent
        expected_pct = round(day / dim * 100, 1) if dim else 0
        status = "none" if not amt else ("over" if pct >= 100 else "danger" if pct >= 90 else "warning" if pct >= 70 or (projected > amt and day >= 5) else "ok")
        out.append({"category": c, "budget": amt, "spent": spent, "pct": pct, "remaining": round(amt - spent, 2),
                    "projected": projected, "expected_pct": expected_pct, "status": status,
                    "count": spend.get(c, {}).get("count", 0), "day": day, "days_in_month": dim})
    return out


@api.get("/budgets")
async def get_budgets(month: Optional[str] = None, user=Depends(current_user)):
    items = await compute_budgets(user["id"], month)
    tb = sum(i["budget"] for i in items)
    ts_ = sum(i["spent"] for i in items if i["budget"])
    return {"month": month_bounds(month)[0], "items": items, "total_budget": tb, "total_spent_budgeted": round(ts_, 2),
            "total_spent": round(sum(i["spent"] for i in items), 2)}


@api.put("/budgets")
async def put_budget(body: BudgetIn, user=Depends(current_user)):
    if body.category not in CATEGORIES:
        raise HTTPException(400, "Invalid category")
    if body.amount == 0:
        await db.budgets.delete_one({"user_id": user["id"], "category": body.category})
    else:
        await db.budgets.update_one({"user_id": user["id"], "category": body.category},
                                    {"$set": {"amount": round(body.amount, 2)}}, upsert=True)
    alerts = await run_alert_checks(user)
    return {"ok": True, "alerts": alerts}

# ---------------------------------------------------------------- recurring
class RecurringIn(BaseModel):
    merchant_key: str
    status: str  # active | cancelled | ignored
    merchant: Optional[str] = None
    amount: Optional[float] = None
    day: Optional[int] = None


async def compute_recurring(uid: str) -> list:
    n = now_ist()
    since = (n - timedelta(days=190)).astimezone(timezone.utc)
    docs = await db.transactions.find({"user_id": uid, "direction": "debit", "ts": {"$gte": since},
                                       "merchant_key": {"$ne": None}}).to_list(5000)
    overrides = {o["merchant_key"]: o for o in await db.recurring_overrides.find({"user_id": uid}).to_list(500)}
    groups = {}
    for d in docs:
        groups.setdefault(d["merchant_key"], []).append(d)
    cur = month_str(n)
    out = []
    for mk, txs in groups.items():
        ov = overrides.get(mk)
        if ov and ov["status"] == "ignored":
            continue
        months = {month_str(aware(t["ts"])) for t in txs}
        amounts = [t["amount"] for t in txs]
        med = statistics.median(amounts)
        similar = all(abs(a - med) <= max(0.25 * med, 50) for a in amounts)
        hint = any(k in (dec(txs[0]["enc"]).get("merchant") or "").lower() for k in
                   ["netflix", "spotify", "hotstar", "prime", "youtube", "gym", "cult", "rent", "sip", "insurance", "emi", "broadband", "nobroker"])
        detected = len(months) >= 2 and len(txs) <= len(months) * 1.5 and (similar or hint)
        if not detected and not ov:
            continue
        latest = max(txs, key=lambda t: t["ts"])
        days = [aware(t["ts"]).astimezone(IST).day for t in txs]
        exp_day = int(ov.get("day") or statistics.median(days)) if ov else int(statistics.median(days))
        charged_this_month = [t for t in txs if month_str(aware(t["ts"])) == cur]
        status = ov["status"] if ov else "active"
        warning = None
        if status == "active" and not charged_this_month and n.day > min(exp_day + 5, 28):
            warning = "missing"
        if status == "cancelled" and ov.get("cancelled_at") and any(aware(t["ts"]) > aware(ov["cancelled_at"]) for t in txs):
            warning = "still_charging"
        out.append({"merchant_key": mk, "merchant": dec(latest["enc"]).get("merchant") or "Unknown",
                    "category": latest["category"], "amount": round(ov.get("amount") or med, 2) if ov else round(med, 2),
                    "expected_day": exp_day, "months_seen": len(months), "last_charged": aware(latest["ts"]).isoformat(),
                    "charged_this_month": bool(charged_this_month), "status": status, "warning": warning,
                    "source": "manual" if ov and not detected else "detected"})
    # manual overrides with no recent tx
    for mk, ov in overrides.items():
        if mk not in groups and ov["status"] == "active":
            out.append({"merchant_key": mk, "merchant": ov.get("merchant") or "Unknown", "category": "Other",
                        "amount": ov.get("amount") or 0, "expected_day": ov.get("day") or 1, "months_seen": 0,
                        "last_charged": None, "charged_this_month": False, "status": "active",
                        "warning": "missing" if n.day > min((ov.get("day") or 1) + 5, 28) else None, "source": "manual"})
    out.sort(key=lambda r: (r["status"] != "active", -r["amount"]))
    return out


@api.get("/recurring")
async def get_recurring(user=Depends(current_user)):
    items = await compute_recurring(user["id"])
    active = [i for i in items if i["status"] == "active"]
    return {"items": items, "monthly_total": round(sum(i["amount"] for i in active), 2),
            "remaining_this_month": round(sum(i["amount"] for i in active if not i["charged_this_month"]), 2)}


@api.put("/recurring")
async def put_recurring(body: RecurringIn, user=Depends(current_user)):
    if body.status not in ("active", "cancelled", "ignored"):
        raise HTTPException(400, "Invalid status")
    s = {"status": body.status, "updated_at": datetime.now(timezone.utc)}
    if body.status == "cancelled":
        s["cancelled_at"] = datetime.now(timezone.utc)
    for f in ("merchant", "amount", "day"):
        if getattr(body, f) is not None:
            s[f] = getattr(body, f)
    await db.recurring_overrides.update_one({"user_id": user["id"], "merchant_key": body.merchant_key}, {"$set": s}, upsert=True)
    return {"ok": True}

# ---------------------------------------------------------------- alerts
async def add_alert(uid: str, key: str, kind: str, title: str, message: str, severity: str, hidden=False) -> Optional[dict]:
    doc = {"user_id": uid, "key": key, "type": kind, "title": title, "message": message, "severity": severity,
           "read": hidden, "hidden": hidden, "created_at": datetime.now(timezone.utc)}
    r = await db.alerts.update_one({"user_id": uid, "key": key}, {"$setOnInsert": doc}, upsert=True)
    if r.upserted_id and not hidden:
        return {"id": str(r.upserted_id), "type": kind, "title": title, "message": message, "severity": severity,
                "created_at": doc["created_at"].isoformat(), "read": False}
    return None


async def run_alert_checks(user: dict) -> list:
    uid = user["id"]
    new = []
    m = month_str()
    for b in await compute_budgets(uid, m):
        if not b["budget"]:
            continue
        crossed = [t for t in (70, 90, 100) if b["pct"] >= t]
        for t in crossed:
            top = t == crossed[-1]
            pace = "ahead of pace" if b["pct"] > b["expected_pct"] + 5 else "on pace"
            if t >= 100:
                title = f"{b['category']} budget exceeded"
                msg = f"You've spent {inr(b['spent'])} of {inr(b['budget'])} on {b['category']} by day {b['day']} of {b['days_in_month']}."
            else:
                title = f"{t}% of {b['category']} budget used"
                msg = (f"{t}% of {b['category']} budget used on day {b['day']} of the month ({inr(b['spent'])} of {inr(b['budget'])}). "
                       f"You're {pace} — at this rate you'll spend {inr(b['projected'])} by month end.")
            a = await add_alert(uid, f"budget:{b['category']}:{m}:{t}", "budget", title, msg,
                                "error" if t >= 100 else "warning", hidden=not top)
            if a:
                new.append(a)
    for r in await compute_recurring(uid):
        if r["warning"] == "missing":
            a = await add_alert(uid, f"recurring:missing:{r['merchant_key']}:{m}", "recurring", f"{r['merchant']} charge not seen",
                                f"Expected around day {r['expected_day']} ({inr(r['amount'])}) but no charge yet this month.", "warning")
        elif r["warning"] == "still_charging":
            a = await add_alert(uid, f"recurring:still:{r['merchant_key']}:{m}", "recurring", f"{r['merchant']} is still charging",
                                f"You marked this as cancelled, but a charge of {inr(r['amount'])} came in.", "error")
        else:
            a = None
        if a:
            new.append(a)
    new.extend(await weekly_summary_alert(user))
    return new


async def weekly_stats(uid: str) -> dict:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=7)
    rows = await db.transactions.aggregate([
        {"$match": {"user_id": uid, "direction": "debit", "category": {"$nin": SPEND_EXCLUDED}, "ts": {"$gte": start, "$lt": end}}},
        {"$group": {"_id": "$category", "total": {"$sum": "$amount"}}}, {"$sort": {"total": -1}}]).to_list(20)
    total = round(sum(r["total"] for r in rows), 2)
    budgets = await compute_budgets(uid, None)
    at_risk = [b["category"] for b in budgets if b["status"] in ("warning", "danger", "over")]
    return {"total": total, "top": [{"category": r["_id"], "total": round(r["total"], 2)} for r in rows[:3]], "at_risk": at_risk}


async def weekly_summary_alert(user: dict) -> list:
    n = now_ist()
    week = f"{n.isocalendar()[0]}-W{n.isocalendar()[1]:02d}"
    if await db.alerts.find_one({"user_id": user["id"], "key": f"weekly:{week}"}):
        return []
    if not await db.transactions.find_one({"user_id": user["id"]}):
        return []
    s = await weekly_stats(user["id"])
    top = ", ".join(f"{t['category']} {inr(t['total'])}" for t in s["top"]) or "no spends"
    risk = f" At risk: {', '.join(s['at_risk'])}." if s["at_risk"] else " All budgets on track."
    a = await add_alert(user["id"], f"weekly:{week}", "weekly", "Your weekly summary",
                        f"Spent {inr(s['total'])} in the last 7 days. Top: {top}.{risk}", "info")
    return [a] if a else []


@api.get("/alerts")
async def get_alerts(user=Depends(current_user)):
    await run_alert_checks(user)
    docs = await db.alerts.find({"user_id": user["id"], "hidden": {"$ne": True}}).sort("created_at", -1).to_list(200)
    items = [{"id": str(d["_id"]), "type": d["type"], "title": d["title"], "message": d["message"], "severity": d["severity"],
              "read": d.get("read", False), "created_at": aware(d["created_at"]).isoformat()} for d in docs]
    return {"items": items, "unread": sum(1 for i in items if not i["read"])}


@api.post("/alerts/read-all")
async def read_alerts(user=Depends(current_user)):
    await db.alerts.update_many({"user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}


@api.get("/summary/weekly")
async def weekly(user=Depends(current_user)):
    return await weekly_stats(user["id"])

# ---------------------------------------------------------------- overview
@api.get("/overview")
async def overview(month: Optional[str] = None, user=Depends(current_user)):
    uid = user["id"]
    m, s, e = month_bounds(month)
    spend = await spend_by_category(uid, m)
    spent = round(sum(v["total"] for k, v in spend.items() if k not in SPEND_EXCLUDED), 2)
    inc = await db.transactions.aggregate([
        {"$match": {"user_id": uid, "direction": "credit", "category": "Income", "ts": {"$gte": s, "$lt": e}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}]).to_list(1)
    recorded = round(inc[0]["total"], 2) if inc else 0
    expected = user.get("monthly_income", 0) or 0
    income = recorded if recorded > 0 else expected
    rec = await compute_recurring(uid)
    committed = round(sum(r["amount"] for r in rec if r["status"] == "active" and not r["charged_this_month"]), 2) if m == month_str() else 0
    savings = user.get("savings_target", 0) or 0
    safe = round(income - committed - savings - spent, 2)
    day, dim = month_progress(m)
    days_left = max(dim - day + 1, 1) if m == month_str() else 0
    budgets = await compute_budgets(uid, m)
    review_count = await db.review_items.count_documents({"user_id": uid}) + \
        await db.transactions.count_documents({"user_id": uid, "needs_review": True})
    unread = await db.alerts.count_documents({"user_id": uid, "read": False, "hidden": {"$ne": True}})
    recent = await db.transactions.find({"user_id": uid}).sort("ts", -1).to_list(5)
    by_cat = sorted([{"category": k, "spent": v["total"], "count": v["count"]} for k, v in spend.items() if k not in SPEND_EXCLUDED],
                    key=lambda x: -x["spent"])
    return {"month": m, "income": income, "income_recorded": recorded, "income_expected": expected,
            "income_source": "recorded" if recorded > 0 else "expected", "spent": spent, "committed": committed,
            "savings_target": savings, "safe_to_spend": safe, "daily_safe": round(safe / days_left, 2) if days_left and safe > 0 else 0,
            "days_left": days_left, "day": day, "days_in_month": dim, "by_category": by_cat, "budgets": budgets,
            "recurring": [r for r in rec if r["status"] == "active"][:5], "review_count": review_count,
            "unread_alerts": unread, "recent": [tx_out(d) for d in recent],
            "has_data": bool(await db.transactions.find_one({"user_id": uid}))}

# ---------------------------------------------------------------- export
@api.get("/export/reimbursable")
async def export_reimbursable(month: Optional[str] = None, user=Depends(current_user)):
    q = {"user_id": user["id"], "reimbursable": True}
    if month and month != "all":
        _, s, e = month_bounds(month)
        q["ts"] = {"$gte": s, "$lt": e}
    docs = await db.transactions.find(q).sort("ts", 1).to_list(2000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Date", "Merchant", "Amount", "Category", "Note"])
    total = 0
    for d in docs:
        t = tx_out(d)
        total += t["amount"]
        w.writerow([datetime.fromisoformat(t["ts"]).astimezone(IST).strftime("%Y-%m-%d"), t["merchant"], f"{t['amount']:.2f}", t["category"], t["note"]])
    w.writerow([])
    w.writerow(["Total", "", f"{total:.2f}", "", ""])
    fname = f"spendsense-reimbursable-{month or 'all'}.csv"
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=False, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.transactions.create_index([("user_id", 1), ("ts", -1)])
    await db.transactions.create_index([("user_id", 1), ("merchant_key", 1)])
    await db.sms_seen.create_index([("user_id", 1), ("hash", 1)], unique=True)
    await db.alerts.create_index([("user_id", 1), ("key", 1)], unique=True)
    await db.budgets.create_index([("user_id", 1), ("category", 1)], unique=True)
    await db.merchant_rules.create_index([("user_id", 1), ("merchant_key", 1)], unique=True)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
