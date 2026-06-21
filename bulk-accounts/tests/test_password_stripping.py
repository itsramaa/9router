"""Test password stripping to prevent exposure via API/WebSocket.

Tests for AUDIT-002 fix.
"""

import sys
from pathlib import Path

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.safe_types import strip_password, strip_passwords


def test_strip_password():
    """Test that strip_password removes password field."""
    raw_account = {
        "email": "user@example.com",
        "password": "secret123",
        "tags": ["premium", "verified"]
    }
    
    safe = strip_password(raw_account)
    
    # Verify password is removed
    assert "password" not in safe, "Password should be stripped"
    assert "email" in safe, "Email should be preserved"
    assert "tags" in safe, "Tags should be preserved"
    assert safe["email"] == "user@example.com"
    assert safe["tags"] == ["premium", "verified"]
    
    print("[OK] Single account password stripped")


def test_strip_passwords_list():
    """Test that strip_passwords removes password from all accounts."""
    raw_accounts = [
        {"email": "user1@example.com", "password": "pass1", "tags": []},
        {"email": "user2@example.com", "password": "pass2", "tags": ["admin"]},
        {"email": "user3@example.com", "password": "pass3", "tags": []},
    ]
    
    safe = strip_passwords(raw_accounts)
    
    # Verify all passwords removed
    assert len(safe) == 3, "Should have 3 accounts"
    for account in safe:
        assert "password" not in account, f"Password found in {account}"
        assert "email" in account, "Email should be present"
    
    print("[OK] Multiple accounts passwords stripped")


def test_strip_empty_account():
    """Test handling of accounts with missing fields."""
    empty = {}
    safe = strip_password(empty)
    
    assert "password" not in safe
    assert safe["email"] == ""
    assert safe["tags"] == []
    
    print("[OK] Empty account handled")


def test_strip_account_without_password():
    """Test account that doesn't have password field."""
    no_pass = {
        "email": "user@example.com",
        "tags": ["basic"]
    }
    
    safe = strip_password(no_pass)
    
    assert "password" not in safe
    assert safe["email"] == "user@example.com"
    assert safe["tags"] == ["basic"]
    
    print("[OK] Account without password handled")


if __name__ == "__main__":
    print("Testing AUDIT-002 fix: Password stripping\n")
    
    print("=== SafeAccount Type Tests ===")
    test_strip_password()
    test_strip_passwords_list()
    test_strip_empty_account()
    test_strip_account_without_password()
    
    print("\n[SUCCESS] All tests passed! Passwords protected.")
