"""
Simple in-memory sliding-window rate limiter for Smart School AI Agent API.
Prevents accidental credit exhaustion and request flooding without permanent databases.
"""

import time
from collections import defaultdict
from backend.config import RATE_LIMIT_PER_MINUTE
from backend.utils.logger import logger

_request_history: dict[str, list[float]] = defaultdict(list)


def is_rate_limited(client_ip: str) -> bool:
    """
    Check if a client IP has exceeded the allowed requests per minute.
    Cleans up timestamps older than 60 seconds automatically.
    """
    now = time.time()
    window_start = now - 60.0
    
    # Filter out old requests
    timestamps = [t for t in _request_history[client_ip] if t > window_start]
    _request_history[client_ip] = timestamps
    
    if len(timestamps) >= RATE_LIMIT_PER_MINUTE:
        logger.warning(f"Rate limit exceeded for client: {client_ip} ({len(timestamps)} reqs in last min)")
        return True
        
    _request_history[client_ip].append(now)
    return False
