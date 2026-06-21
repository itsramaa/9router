"""Test proxy URL validation to prevent command injection attacks.

Tests for AUDIT-003 fix.
"""

import sys
from pathlib import Path

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.validation import validate_proxy_url


def test_valid_proxies():
    """Test that valid proxy URLs are accepted."""
    valid_proxies = [
        "http://proxy.example.com:8080",
        "https://secure.proxy.com:443",
        "socks5://socks.proxy.com:1080",
        "socks4://socks4.proxy.com:1080",
        "http://user:pass@proxy.example.com:8080",
        "http://user.name:pass_word@proxy.example.com:8080",
        "http://192.168.1.1:8080",
        "http://proxy.example.com",  # No port is OK
    ]
    
    for proxy in valid_proxies:
        is_valid, error = validate_proxy_url(proxy)
        assert is_valid, f"Valid proxy rejected: {proxy} ({error})"
        print(f"[OK] Valid: {proxy}")


def test_invalid_proxies():
    """Test that dangerous proxy URLs are rejected."""
    invalid_proxies = [
        # Command injection attempts
        ("", "Proxy URL is required"),
        ("; rm -rf /; #", "Invalid characters detected"),
        ("$(malicious)", "Invalid characters detected"),
        ("`backtick`", "Invalid characters detected"),
        ("http://valid.com; cat /etc/passwd", "Invalid characters detected"),
        ("http://valid.com && evil", "Invalid characters detected"),
        ("http://valid.com | grep secret", "Invalid characters detected"),
        ("http://valid.com > /tmp/out", "Invalid characters detected"),
        
        # Invalid schemes
        ("ftp://proxy.com", "Invalid scheme"),
        ("file:///etc/passwd", "Invalid scheme"),
        ("javascript:alert(1)", "Invalid characters detected"),  # Colon caught by char filter
        
        # Invalid formats
        ("not-a-url", "Invalid scheme"),
        ("http://", "Proxy URL must include hostname"),
        ("http://proxy.com:99999", "Invalid port"),
        ("http://proxy.com:0", "Invalid port"),
        
        # Too long
        ("http://" + "a" * 500 + ".com:8080", "Proxy URL too long"),
    ]
    
    for proxy, expected_error in invalid_proxies:
        is_valid, error = validate_proxy_url(proxy)
        assert not is_valid, f"Invalid proxy accepted: {proxy}"
        assert expected_error in error, f"Wrong error for {proxy}: {error}"
        print(f"[OK] Rejected: {proxy[:50]} ({error})")


def test_sql_injection_patterns():
    """Test SQL injection patterns are blocked."""
    sql_injections = [
        "'; DROP TABLE users; --",
        "' OR '1'='1",
        "1'; DELETE FROM accounts; --",
        "admin'--",
    ]
    
    for injection in sql_injections:
        is_valid, error = validate_proxy_url(injection)
        assert not is_valid, f"SQL injection accepted: {injection}"
        assert "Invalid characters detected" in error
        print(f"[OK] Blocked SQL injection: {injection}")


if __name__ == "__main__":
    print("Testing AUDIT-003 fix: Proxy URL validation\n")
    
    print("=== Valid Proxies ===")
    test_valid_proxies()
    
    print("\n=== Invalid Proxies (Command Injection) ===")
    test_invalid_proxies()
    
    print("\n=== SQL Injection Patterns ===")
    test_sql_injection_patterns()
    
    print("\n[SUCCESS] All tests passed! Command injection prevented.")
