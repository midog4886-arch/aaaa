"""Text helpers shared across routes."""

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
