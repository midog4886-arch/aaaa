"""Text helpers shared across routes."""
import re

# Map Arabic-Indic (U+0660-0669) and Persian/Extended Arabic-Indic
# (U+06F0-06F9) digits to ASCII. Hardware barcode scanners emulate a
# keyboard, so on an Arabic keyboard layout the scanned numbers arrive as
# Arabic-Indic digits which never match ASCII-stored member codes.
_ARABIC_TO_ASCII_DIGITS = str.maketrans(
    "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹",
    "01234567890123456789",
)


def normalize_digits(value):
    """Return ``value`` with any Arabic/Persian digits converted to ASCII."""
    if not value or not isinstance(value, str):
        return value
    return value.translate(_ARABIC_TO_ASCII_DIGITS)


# ---------------------------------------------------------------------------
# Arabic keyboard layout reverse mapping.
#
# A hardware barcode scanner acts as a keyboard wedge: it emits keystrokes, so
# when the OS/tablet input language is Arabic an ASCII member code like
# "DEFA-B7-0047" is typed through the Arabic (101) layout and arrives mangled
# (e.g. uppercase D/F become brackets, letters become Arabic letters, etc.).
# These tables map each Arabic-layout output character back to the Latin letter
# printed on the same physical key, so we can recover the original code.
# ---------------------------------------------------------------------------

# Lam-Alef ligatures (B/T/G keys) decode to a single Latin letter; handle the
# two-codepoint sequences before single-character mapping.
_AR_KB_LIGATURES = [
    ("لإ", "T"), ("لأ", "G"), ("لآ", "B"), ("لا", "B"),
]

_AR_KB_MAP = {
    # Unshifted Arabic letters -> Latin (same physical key)
    "ض": "Q", "ص": "W", "ث": "E", "ق": "R", "ف": "T", "غ": "Y",
    "ع": "U", "ه": "I", "خ": "O", "ح": "P", "ج": "[", "د": "]",
    "ش": "A", "س": "S", "ي": "D", "ب": "F", "ل": "G", "ا": "H",
    "ت": "J", "ن": "K", "م": "L", "ك": ";", "ط": "'",
    "ئ": "Z", "ء": "X", "ؤ": "C", "ر": "V", "ى": "N", "ة": "M",
    "و": ",", "ز": ".", "ظ": "/",
    # Shifted Arabic forms (diacritics / hamza letters / tatweel) -> Latin
    "َ": "Q", "ً": "W", "ُ": "E", "ٌ": "R", "إ": "Y", "ِ": "A",
    "ٍ": "S", "أ": "H", "ـ": "J", "،": "K", "آ": "N", "ْ": "X",
    "؛": "P", "؟": "/",
    # Shifted ASCII punctuation that maps to a Latin key (D/F/C/V/U/I/O...)
    "]": "D", "[": "F", "}": "C", "{": "V", "`": "U", "÷": "I",
    "×": "O", "~": "Z",
}

_ARABIC_SCRIPT_RE = re.compile(r"[\u0600-\u06FF]")


def dearabize_keyboard(value):
    """Recover a Latin member code typed through an Arabic keyboard layout.

    Only applied when ``value`` actually contains Arabic-script characters, so a
    clean ASCII code (e.g. decoded by the camera) is returned untouched. The
    result is digit-normalized and uppercased to match stored member codes.
    """
    if not value or not isinstance(value, str):
        return value
    if not _ARABIC_SCRIPT_RE.search(value):
        return value
    text = value
    for lig, latin in _AR_KB_LIGATURES:
        text = text.replace(lig, latin)
    out = "".join(_AR_KB_MAP.get(ch, ch) for ch in text)
    return normalize_digits(out).upper().strip()
