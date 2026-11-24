"""Authentication layer for ISSATSO+.

Version 1: a Bearer token supplied manually through ISSATSO_BEARER_TOKEN.
To add automatic renewal later, implement another TokenProvider (using the OFFICIAL login flow,
with the student's own credentials) and pass it to IssatsoClient. Nothing else needs to change.
"""
from __future__ import annotations

from typing import Protocol

from pydantic import SecretStr

from app.exceptions import AuthenticationError


class TokenProvider(Protocol):
    def get_token(self) -> str: ...


class StaticTokenProvider:
    def __init__(self, token: SecretStr | str | None):
        self._token = token.get_secret_value() if isinstance(token, SecretStr) else token

    def get_token(self) -> str:
        if not self._token or not self._token.strip():
            raise AuthenticationError(
                "No ISSATSO+ Bearer token configured. Set ISSATSO_BEARER_TOKEN in .env.")
        return self._token.strip()

    def __repr__(self) -> str:  # never leak the token via repr/logging
        return "StaticTokenProvider(token=***)"
