"""Identifier generation. All of it uses the CSPRNG, never `random` --
`access_token` below is the only thing standing between a stranger and a
team's submissions, so it has to be genuinely unguessable.
"""

import secrets
import uuid


def generate_access_token() -> str:
    """128-bit URL-safe team access token. Appears in /t/<token>."""
    return secrets.token_urlsafe(16)


# The alphabet omits 0/O/1/I/L/U -- the characters people misread when
# copying a code off a slide, and U so the generator can't produce an
# unfortunate word. At 4 characters this is ~1M combinations: fine for a
# class-sized namespace with a uniqueness check on insert, and it is not the
# security boundary (the token is).
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"


def generate_short_code(prefix: str = "BDS") -> str:
    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(4))
    return f"{prefix}-{code}"


def generate_session_id() -> str:
    """Opaque admin session cookie value."""
    return secrets.token_urlsafe(32)


def generate_stored_name() -> str:
    """On-disk filename for an upload. Never derived from user input."""
    return str(uuid.uuid4())


def normalize_short_code(raw: str, prefix: str = "BDS") -> str:
    """Normalise a code a student typed: trim, uppercase, and tolerate a
    missing prefix or a space instead of the hyphen, so "bds 7k2p" and
    "7K2P" both work.
    """
    import re

    cleaned = re.sub(r"[\s_]+", "-", raw.strip().upper())
    if re.match(r"^[A-Z]+-[A-Z0-9]+$", cleaned):
        return cleaned
    return f"{prefix}-{re.sub(r'^-+', '', cleaned)}"
