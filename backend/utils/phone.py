"""Phone-number normalization shared by member lookup and WhatsApp Cloud."""

import re


_ARABIC_DIGITS = str.maketrans(
    "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹",
    "01234567890123456789",
)


def normalize_phone(value: str) -> str:
    """Return a bare, comparable Saudi/Egypt mobile number.

    Member records historically contain local numbers while WhatsApp providers
    normally report E.164 digits.  Keep one canonical representation for the
    two countries used by the academy:

    * Saudi ``05xxxxxxxx`` / ``5xxxxxxxx`` -> ``9665xxxxxxxx``
    * Egypt ``01xxxxxxxxx`` -> ``201xxxxxxxxx``

    International ``+`` and ``00`` prefixes, separators, and Arabic-Indic
    digits are accepted.  Unknown but plausible numbers are kept as digits so
    this helper remains useful for legacy records without guessing a country.
    An empty string means the value cannot be used as a phone identifier.
    """
    if value is None:
        return ""
    digits = re.sub(r"\D", "", str(value).translate(_ARABIC_DIGITS))
    if digits.startswith("00"):
        digits = digits[2:]

    if digits.startswith("05") and len(digits) == 10:
        digits = "966" + digits[1:]
    elif digits.startswith("5") and len(digits) == 9:
        digits = "966" + digits
    elif digits.startswith("01") and len(digits) == 11:
        digits = "20" + digits[1:]
    elif digits.startswith("1") and len(digits) == 10:
        # Bare Egyptian mobile numbers are occasionally imported without the
        # leading local zero.
        digits = "20" + digits

    if not (9 <= len(digits) <= 15) or digits.startswith("0"):
        return ""
    return digits


def phone_lookup_values(value: str) -> list[str]:
    """Build exact legacy values that can represent a normalized number."""
    canonical = normalize_phone(value)
    if not canonical:
        return []
    values = [canonical, f"+{canonical}", f"00{canonical}"]
    if canonical.startswith("966") and len(canonical) == 12:
        local = canonical[3:]
        values.extend([f"0{local}", local])
    elif canonical.startswith("20") and len(canonical) == 12:
        local = canonical[2:]
        values.extend([f"0{local}", local])
    return list(dict.fromkeys(values))