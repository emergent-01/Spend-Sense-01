"""Indian bank / card / UPI transaction SMS parser and merchant categorizer."""
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

IST = timezone(timedelta(hours=5, minutes=30))

CATEGORIES = ["Food", "Groceries", "Transport", "Shopping", "Bills & Utilities",
              "Entertainment", "Health", "Travel", "Rent", "Other"]
INCOME_CATEGORIES = ["Income", "Refund", "Transfer In"]

BANKS = {
    "HDFC": ["HDFC"], "ICICI": ["ICICI"], "SBI": ["SBI", "SBIN", "SBICRD", "SBIUPI", "SBMSMS", "ATMSBI", "CBSSBI"],
    "Axis": ["AXIS", "AXISBK"], "Kotak": ["KOTAK", "KOTAKB", "KMBL"], "Amex": ["AMEX", "AMERICAN EXPRESS"],
    "Yes Bank": ["YESBNK", "YES BANK"], "IndusInd": ["INDUS"], "IDFC": ["IDFC"], "PNB": ["PNB"],
    "Bank of Baroda": ["BOB", "BARODA"], "Canara": ["CANARA", "CANBNK"], "AU Bank": ["AUBANK"],
    "Federal": ["FEDBNK", "FEDERAL"], "RBL": ["RBL"], "OneCard": ["ONECRD", "ONECARD"],
    "Paytm": ["PAYTM", "PYTM"], "PhonePe": ["PHONPE"], "GPay": ["GPAY"],
}

FIN_SENDER_TOKENS = [t for v in BANKS.values() for t in v] + [
    "BANK", "BNK", "CARD", "CRD", "UPI", "NEFT", "IMPS", "SLRY", "SALARY", "CITI", "SCBANK", "HSBC", "DBS"]

IGNORE_PATTERNS = [
    r"\botp\b", r"one[\s-]?time[\s-]?password", r"verification code", r"\bcode is\b", r"do not share",
    r"pre[\s-]?approved", r"apply now", r"\boffer\b", r"\bwin\b", r"cashback of upto", r"click here to",
    r"out for delivery", r"\bdelivered\b", r"\bshipped\b", r"\bdispatched\b",
    r"will be debited", r"is due", r"due date", r"minimum amount due", r"statement (?:for|is generated)",
    r"has requested (?:money|rs|inr)", r"collect request", r"request of", r"emi conversion",
    r"failed", r"declined", r"unsuccessful", r"reversal initiated",
]

TXN_HINTS = r"debited|credited|spent|paid|sent|withdrawn|received|deposited|purchase|charged|txn|transaction|transferred|refund|debit|credit"

AMOUNT_RE = re.compile(r"(?:rs\.?|inr|₹)\s*:?\s*([\d,]+(?:\.\d{1,2})?)", re.I)
AMOUNT_BY_RE = re.compile(r"(?:debited|credited|spent|paid|sent|charged)\s+(?:by|with|for|of)?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)", re.I)
DEBIT_RE = re.compile(r"\b(debited|spent|paid|sent|withdrawn|purchase|charged|debit|dr|transferred to|trf to|txn of)\b", re.I)
CREDIT_RE = re.compile(r"\b(credited|received|deposited|refund(?:ed)?|credit|cr|added to)\b", re.I)
CARD_RE = re.compile(r"(?:card|cc|crd)\b[^0-9]{0,25}?(?:x+|\*+|ending(?: with)?|no\.?|#)?\s*(\d{4,5})\b", re.I)
ACCT_RE = re.compile(r"(?:a/c|acct|account|ac|a/c no\.?)\s*(?:no\.?)?\s*(?:[x\*]+)?\s*[x\*]*(\d{3,6})\b", re.I)
VPA_RE = re.compile(r"\b([a-z0-9][a-z0-9.\-_]{1,60}@[a-z]{2,15})\b(?!\.)", re.I)

MERCHANT_PATTERNS = [
    re.compile(r"neft\s*cr-[A-Za-z0-9]+-([A-Za-z0-9 &.]{2,40}?)(?:\s+sal(?:ary)?\b|\.|\s+avl|$)", re.I),
    re.compile(r"\bIST\s+([A-Za-z0-9][A-Za-z0-9 &'.\-]{1,40}?)\s+(?:avl|available)\b", re.I),
    re.compile(r";\s*([A-Za-z0-9][A-Za-z0-9 &'.\-]{1,40}?)\s+credited", re.I),
    re.compile(r"\bat\s+([A-Za-z0-9][A-Za-z0-9 &'._*\-/]{1,40}?)\s+(?:on|dated|via|ref|txn|\.|,|avl|for)\b", re.I),
    re.compile(r"\bat\s+([A-Za-z0-9][A-Za-z0-9 &'._*\-/]{1,40}?)(?:\.|,|$)", re.I),
    re.compile(r"UPI/(?:P2M|P2A|DR|CR)?/?\d*/([A-Za-z0-9 .&'\-]{2,40}?)(?:/|\s|$)", re.I),
    re.compile(r"\b(?:trf to|transfer to|transferred to|paid to|sent to|to vpa|to)\s+([A-Za-z0-9][A-Za-z0-9 &'._@\-]{1,40}?)\s*(?:on\b|ref\b|upi\b|refno|ref no|via\b|\.|,|\(|-|$)", re.I),
    re.compile(r"\b(?:from|by)\s+(?:vpa\s+)?([A-Za-z0-9][A-Za-z0-9 &'._@\-]{1,40}?)\s*(?:on\b|ref\b|upi\b|refno|\.|,|\(|$)", re.I),
    re.compile(r"\binfo[:\s-]+([A-Za-z0-9][A-Za-z0-9 &'._*\-/]{1,40}?)(?:\.|,|$)", re.I),
    re.compile(r"\btowards\s+([A-Za-z0-9][A-Za-z0-9 &'._\-]{1,40}?)(?:\.|,|\s+on\b|$)", re.I),
    re.compile(r"\bon\s+([A-Z][A-Z0-9 &'._*\-]{2,40}?)\.\s*(?:avl|available|bal)", re.I),
]

BAD_MERCHANT = re.compile(r"^(your|you|a/c|ac|acct|account|card|bank|the|rs|inr|upi|imps|neft|x+\d*|\d+|self|mobile|ref|beneficiary|vpa)$", re.I)

CATEGORY_KEYWORDS = {
    "Food": ["swiggy", "zomato", "eatsure", "dominos", "domino", "pizza", "mcdonald", "kfc", "burger", "starbucks", "cafe",
             "restaurant", "barbeque", "haldiram", "chaayos", "dunkin", "subway", "faasos", "box8", "biryani", "eatclub", "food", "bakery", "tea"],
    "Groceries": ["bigbasket", "blinkit", "grofers", "zepto", "instamart", "dmart", "jiomart", "reliance fresh", "more retail",
                  "spencer", "nature's basket", "milkbasket", "country delight", "grocery", "supermarket", "kirana", "fresh"],
    "Transport": ["uber", "ola", "rapido", "metro", "irctc rail", "fastag", "petrol", "fuel", "hpcl", "bpcl", "iocl", "indian oil",
                  "shell", "parking", "namma yatri", "blusmart", "redbus", "toll"],
    "Shopping": ["amazon", "flipkart", "myntra", "ajio", "nykaa", "meesho", "tatacliq", "croma", "reliance digital", "decathlon",
                 "ikea", "lenskart", "firstcry", "snapdeal", "shoppers stop", "lifestyle", "westside", "zara", "h&m", "uniqlo", "mall"],
    "Bills & Utilities": ["electricity", "bescom", "tata power", "adani", "msedcl", "bses", "airtel", "jio", "vodafone", " vi ", "bsnl",
                          "broadband", "act fibernet", "recharge", "gas", "indane", "mahanagar", "water", "dth", "tata play",
                          "insurance", "lic", "bill", "billdesk", "postpaid", "credit card payment", "cred", "emi", "loan"],
    "Entertainment": ["netflix", "hotstar", "prime video", "spotify", "youtube", "bookmyshow", "pvr", "inox", "sonyliv", "zee5",
                      "jiocinema", "apple.com", "google play", "steam", "playstation", "gaana", "audible", "movie"],
    "Health": ["apollo", "pharmeasy", "1mg", "netmeds", "medplus", "practo", "hospital", "clinic", "pharmacy", "medical",
               "diagnostic", "lab", "cult.fit", "cultfit", "cult fit", "gym", "fitness", "healthify", "dental"],
    "Travel": ["makemytrip", "goibibo", "cleartrip", "yatra", "ixigo", "indigo", "air india", "vistara", "akasa", "spicejet",
               "irctc", "oyo", "airbnb", "booking.com", "agoda", "hotel", "taj", "marriott", "airport", "easemytrip"],
    "Rent": ["rent", "nobroker", "nestaway", "housing.com", "landlord", "society maintenance", "maintenance"],
}

RECURRING_HINTS = ["netflix", "spotify", "hotstar", "prime", "youtube", "gym", "cult", "rent", "sip", "mutual fund", "insurance",
                   "lic", "emi", "broadband", "airtel", "jio", "zerodha", "groww", "nach", "ach", "autopay", "si "]

MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def detect_bank(sender: str, body: str) -> Optional[str]:
    s = (sender or "").upper()
    b = body.upper()
    for bank, toks in BANKS.items():
        if any(t in s for t in toks):
            return bank
    for bank, toks in BANKS.items():
        if any(re.search(r"\b" + re.escape(t) + r"\b", b) for t in toks):
            return bank
    return None


def is_financial_sender(sender: str) -> bool:
    if not sender:
        return True  # pasted text: unknown sender, rely on content
    s = sender.upper().strip()
    if re.fullmatch(r"\+?\d{8,15}", s):
        return False  # personal phone numbers
    core = s.split("-")[-2] if s.endswith("-S") or s.endswith("-T") else s.split("-")[-1]
    return any(t in core for t in FIN_SENDER_TOKENS) or any(t in s for t in FIN_SENDER_TOKENS)


def classify(sender: str, body: str) -> str:
    """Return 'ignore' | 'transaction'."""
    text = body.lower()
    if not is_financial_sender(sender):
        return "ignore"
    for p in IGNORE_PATTERNS:
        if re.search(p, text):
            return "ignore"
    if not re.search(TXN_HINTS, text):
        return "ignore"
    if not (AMOUNT_RE.search(body) or AMOUNT_BY_RE.search(body)):
        return "ignore" if not re.search(r"debited|credited|spent", text) else "transaction"
    return "transaction"


def _amount(body: str) -> Optional[float]:
    # prefer amount near a txn verb; skip "avl bal"/"limit" amounts
    candidates = []
    for m in AMOUNT_RE.finditer(body):
        before = body[max(0, m.start() - 25):m.start()].lower()
        if re.search(r"(avl|available|bal|balance|limit|lmt)\W*$", before) or re.search(r"(avl|bal|limit)", before[-12:]):
            continue
        candidates.append(m.group(1))
    if not candidates:
        m = AMOUNT_BY_RE.search(body)
        if m:
            candidates.append(m.group(1))
    for c in candidates:
        try:
            v = float(c.replace(",", "").rstrip("."))
            if v > 0:
                return v
        except ValueError:
            continue
    return None


def _direction(body: str) -> Optional[str]:
    d = DEBIT_RE.search(body)
    c = CREDIT_RE.search(body)
    if d and c:
        # "debited from A/c ... credited to VPA" -> debit; "credited to your a/c" -> credit
        return "debit" if d.start() < c.start() else "credit"
    if d:
        return "debit"
    if c:
        return "credit"
    return None


def clean_merchant(raw: str) -> Optional[str]:
    if not raw:
        return None
    m = raw.strip(" .,-:/*")
    if "@" in m:  # VPA -> handle part
        m = m.split("@")[0]
        m = re.sub(r"[._\-]+", " ", m)
        m = re.sub(r"\d{5,}", "", m)
    m = re.sub(r"\b(upi|pvt|ltd|private|limited|india|payments?|technologies|tech|retail|services|online|www|com|in)\b", " ", m, flags=re.I)
    m = re.sub(r"\b\d{6,}\b", "", m)
    m = re.sub(r"[*_]+", " ", m)
    m = re.sub(r"\s+", " ", m).strip(" .,-/")
    if len(m) < 2 or BAD_MERCHANT.match(m):
        return None
    return m.upper()[:40]


def _merchant(body: str, vpa: Optional[str]) -> Optional[str]:
    for p in MERCHANT_PATTERNS:
        for m in p.finditer(body):
            cand = clean_merchant(m.group(1))
            if cand and not re.match(r"^(A/C|AC|ACCT|CARD|YOUR|X+\d*)\b", cand):
                # avoid dates captured as merchant
                if re.match(r"^\d{1,2}[\-/ ]", cand) or cand.lower()[:3] in MONTHS and re.search(r"\d", cand):
                    continue
                return cand
    if vpa:
        return clean_merchant(vpa)
    return None


def _date(body: str) -> Optional[datetime]:
    pats = [
        (r"\b(\d{4})-(\d{2})-(\d{2})\b", "ymd"),
        (r"\b(\d{1,2})[\-/](\d{1,2})[\-/](\d{2,4})\b", "dmy"),
        (r"\b(\d{1,2})[\-\s]?([A-Za-z]{3})[a-z]*[\-\s,]?\s?(\d{2,4})\b", "dMy"),
    ]
    for p, kind in pats:
        m = re.search(p, body)
        if not m:
            continue
        try:
            if kind == "ymd":
                y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            elif kind == "dmy":
                d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            else:
                d, mon, y = int(m.group(1)), m.group(2).lower(), int(m.group(3))
                if mon not in MONTHS:
                    continue
                mo = MONTHS[mon]
            if y < 100:
                y += 2000
            hh, mm = 12, 0
            t = re.search(r"(?<![\d\-])(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?", body, re.I)
            if t:
                hh, mm = int(t.group(1)), int(t.group(2))
                if t.group(3) and t.group(3).lower() == "pm" and hh < 12:
                    hh += 12
                if t.group(3) and t.group(3).lower() == "am" and hh == 12:
                    hh = 0
            return datetime(y, mo, d, hh % 24, mm, tzinfo=IST).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def categorize(merchant: Optional[str], body: str, direction: str) -> Optional[str]:
    text = f" {(merchant or '').lower()} "
    if direction == "credit":
        low = body.lower()
        if re.search(r"salary|\bsal\b|payroll|slry", low):
            return "Income"
        if re.search(r"refund|reversal|cashback", low):
            return "Refund"
        return "Transfer In"
    for cat, kws in CATEGORY_KEYWORDS.items():
        if any(k in text for k in kws):
            return cat
    low = body.lower()
    if re.search(r"\b(rent)\b", low):
        return "Rent"
    if re.search(r"electricity|bill ?pay|broadband|recharge|insurance premium", low):
        return "Bills & Utilities"
    return None


def parse_sms(sender: str, body: str, received_at: Optional[datetime] = None) -> dict:
    """Returns {'status': 'ignored'|'parsed'|'unparsed', ...fields}"""
    body = (body or "").strip()
    if not body or classify(sender, body) == "ignore":
        return {"status": "ignored"}
    amount = _amount(body)
    direction = _direction(body)
    if amount is None or direction is None:
        return {"status": "unparsed", "reason": "amount" if amount is None else "direction"}
    vpa_m = VPA_RE.search(body)
    vpa = vpa_m.group(1).lower() if vpa_m and not re.search(r"\.(com|in|net|org)$", vpa_m.group(1), re.I) else None
    card = CARD_RE.search(body)
    acct = ACCT_RE.search(body)
    merchant = _merchant(body, vpa)
    ts = received_at or _date(body) or datetime.now(timezone.utc)
    low = body.lower()
    mode = "card" if card and re.search(r"card|\bcc\b", low) else ("upi" if re.search(r"\bupi\b|vpa|@", low) else
           ("netbanking" if re.search(r"neft|imps|rtgs|net ?banking", low) else ("atm" if "atm" in low else "account")))
    category = categorize(merchant, body, direction)
    if not merchant and category == "Income":
        merchant = "SALARY"
    return {
        "status": "parsed",
        "amount": round(amount, 2),
        "direction": direction,
        "merchant": merchant,
        "vpa": vpa,
        "card_last4": card.group(1)[-4:] if card else None,
        "account": acct.group(1)[-4:] if acct else None,
        "bank": detect_bank(sender, body),
        "mode": mode,
        "ts": ts,
        "category": category,
        "is_salary": category == "Income",
        "recurring_hint": any(h in f" {(merchant or '').lower()} {low} " for h in RECURRING_HINTS),
    }
