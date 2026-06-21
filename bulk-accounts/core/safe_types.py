"""Safe account types without password exposure.

Provides password-stripped account types for WebSocket broadcasts and API responses.
"""

from __future__ import annotations

from typing import TypedDict, List, Optional


class Account(TypedDict, total=False):
    """Raw account with password - for internal use only."""
    email: str
    password: str
    tags: List[str]


class SafeAccount(TypedDict, total=False):
    """Password-stripped account - safe for WebSocket/API."""
    email: str
    tags: List[str]


def strip_password(account: dict) -> SafeAccount:
    """
    Remove password from account dict for safe transmission.
    
    Args:
        account: Raw account dictionary that may contain password
        
    Returns:
        SafeAccount without password field
        
    Security:
        Prevents accidental password exposure via WebSocket broadcasts,
        API responses, or logging.
        
    Example:
        >>> raw = {"email": "user@example.com", "password": "secret123", "tags": []}
        >>> safe = strip_password(raw)
        >>> safe
        {"email": "user@example.com", "tags": []}
        >>> "password" in safe
        False
    """
    return {
        "email": account.get("email", ""),
        "tags": account.get("tags", [])
    }


def strip_passwords(accounts: List[dict]) -> List[SafeAccount]:
    """
    Remove passwords from list of accounts.
    
    Args:
        accounts: List of raw account dictionaries
        
    Returns:
        List of SafeAccount without password fields
    """
    return [strip_password(acc) for acc in accounts]
