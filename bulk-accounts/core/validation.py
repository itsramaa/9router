"""Input validation utilities for bulk-accounts server.

Provides security validation for user inputs to prevent injection attacks.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse
from typing import Tuple


def validate_proxy_url(proxy: str) -> Tuple[bool, str]:
    """
    Strictly validate proxy URL to prevent command injection.
    
    Args:
        proxy: Proxy URL string from user input
        
    Returns:
        Tuple of (is_valid, error_message)
        - (True, "") if valid
        - (False, "error reason") if invalid
        
    Security:
        - Prevents shell metacharacter injection
        - Validates URL structure and components
        - Enforces whitelist of allowed schemes
        
    Examples:
        >>> validate_proxy_url("http://proxy.example.com:8080")
        (True, "")
        
        >>> validate_proxy_url("; rm -rf /; #")
        (False, "Invalid characters detected")
    """
    if not proxy or not isinstance(proxy, str):
        return False, "Proxy URL is required"
    
    # Strip whitespace
    proxy = proxy.strip()
    
    # Check length (reasonable proxy URLs are < 500 chars)
    if len(proxy) > 500:
        return False, "Proxy URL too long (max 500 characters)"
    
    # CRITICAL: Block shell metacharacters to prevent command injection
    dangerous_chars = set(';|&$`(){}[]<>\\"\'\n\r')
    if any(c in proxy for c in dangerous_chars):
        return False, "Invalid characters detected in proxy URL"
    
    # Parse URL structure
    try:
        parsed = urlparse(proxy)
    except Exception:
        return False, "Malformed proxy URL"
    
    # Validate scheme (whitelist only)
    allowed_schemes = {'http', 'https', 'socks4', 'socks5'}
    if not parsed.scheme or parsed.scheme.lower() not in allowed_schemes:
        return False, f"Invalid scheme. Allowed: {', '.join(allowed_schemes)}"
    
    # Validate hostname exists
    if not parsed.hostname:
        return False, "Proxy URL must include hostname"
    
    # Validate hostname format (basic check)
    hostname = parsed.hostname
    if not re.match(r'^[a-zA-Z0-9\-\.]+$', hostname):
        return False, "Invalid hostname format"
    
    # Validate port if present (urlparse raises ValueError for invalid ports)
    try:
        if parsed.port is not None:
            if not (1 <= parsed.port <= 65535):
                return False, f"Invalid port: {parsed.port} (must be 1-65535)"
    except ValueError:
        return False, "Invalid port (must be 1-65535)"
    
    # If username/password present, validate them
    if parsed.username:
        if not re.match(r'^[a-zA-Z0-9\-_\.@]+$', parsed.username):
            return False, "Invalid characters in proxy username"
    
    if parsed.password:
        # Password can have more characters but still block dangerous ones
        if any(c in parsed.password for c in {';', '|', '&', '$', '`', '\n', '\r'}):
            return False, "Invalid characters in proxy password"
    
    return True, ""


def validate_email(email: str) -> Tuple[bool, str]:
    """
    Validate email address format.
    
    Args:
        email: Email address string
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not email or not isinstance(email, str):
        return False, "Email is required"
    
    email = email.strip()
    
    if len(email) > 254:  # RFC 5321
        return False, "Email too long"
    
    # Basic email validation
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(email_pattern, email):
        return False, "Invalid email format"
    
    return True, ""
