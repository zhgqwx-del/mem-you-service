def quote_shipping(subtotal_fen: int) -> int:
    """Return the standard shipping fee in fen."""
    if type(subtotal_fen) is not int or subtotal_fen < 0:
        raise ValueError("subtotal_fen must be a non-negative integer")

    return 0 if subtotal_fen >= 9900 else 800
