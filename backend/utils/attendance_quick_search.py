"""Rank branch-scoped member matches for quick attendance search."""
import re
import unicodedata

from utils.text import normalize_digits, dearabize_keyboard
from utils.phone import normalize_phone


def normalized_name(value):
    text = unicodedata.normalize("NFKC", normalize_digits(str(value or ""))).casefold()
    text = re.sub(r"[\u064b-\u065f\u0670\u0640]", "", text)
    text = text.translate(str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي"}))
    return " ".join(re.findall(r"[\w\u0600-\u06ff]+", text))


def candidate_query(term):
    """Keep the DB query bounded to likely names/codes/phones."""
    value = normalize_digits(str(term or "")).strip()
    words = normalized_name(value).split()
    variants = [value]
    keyboard_code = dearabize_keyboard(value)
    if keyboard_code != value:
        variants.append(keyboard_code)
    clauses = []
    for variant in variants:
        escaped = re.escape(variant)
        clauses.append({"member_code": {"$regex": escaped, "$options": "i"}})
    digits = re.sub(r"\D", "", value)
    if len(digits) >= 4:
        clauses.append({"phone": {"$regex": r"\D*".join(map(re.escape, digits[-9:]))}})
    for word in words[:2]:
        if len(word) < 2:
            continue
        pattern = "".join("[اأإآٱ]" if char == "ا" else "[يى]" if char == "ي" else re.escape(char) for char in word)
        for field in ("name_ar", "name"):
            clauses.append({field: {"$regex": pattern, "$options": "i"}})
    return {"$or": clauses}


def match_rank(member, term):
    value = normalize_digits(str(term or "")).strip()
    code = normalize_digits(str(member.get("member_code") or "")).casefold()
    code_terms = {value.casefold(), dearabize_keyboard(value).casefold()}
    if code and code in code_terms:
        return 0
    query_phone = normalize_phone(value)
    member_phone = normalize_phone(member.get("phone"))
    if query_phone and query_phone == member_phone:
        return 1
    names = [normalized_name(member.get("name_ar")), normalized_name(member.get("name"))]
    wanted = normalized_name(value)
    if wanted and wanted in names:
        return 2
    if code and any(code.startswith(part) for part in code_terms if part):
        return 3
    if wanted and any(name.startswith(wanted) for name in names):
        return 4
    tokens = wanted.split()
    if tokens and any(all(token in name.split() or token in name for token in tokens) for name in names):
        return 5
    digits = re.sub(r"\D", "", value)
    if len(digits) >= 4 and digits in re.sub(r"\D", "", str(member.get("phone") or "")):
        return 6
    if code and any(part in code for part in code_terms if part):
        return 7
    return None
