import os
import logging
from logging.config import dictConfig
from typing import Optional

# Explicitly load .env file if it exists
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # dotenv not installed, but we'll continue anyway
    pass

def setup_logging(log_level: Optional[str] = None):
    """
    Set up application logging configuration
    
    Args:
        log_level: Log level, if not provided, it will be read from LOG_LEVEL environment variable
    """
    # Get log level from environment variable, default to INFO if not provided and environment variable doesn't exist
    if log_level is None:
        log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    else:
        log_level = log_level.upper()
    
    # Ensure log level is valid
    valid_levels = ["DEBUG", "INFO", "WARNING", "WARN", "ERROR", "CRITICAL"]
    if log_level not in valid_levels:
        print(f"Warning: Invalid log level '{log_level}', using default level 'INFO'")
        log_level = "INFO"
    
    # Create logs directory (if it doesn't exist)
    logs_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "logs")
    os.makedirs(logs_dir, exist_ok=True)
    
    # Set up logging configuration
    log_config = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "standard": {
                "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
            },
            "json": {
                "format": '{"timestamp": "%(asctime)s", "logger": "%(name)s", "level": "%(levelname)s", "message": "%(message)s"}'
            }
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "standard",
                "level": log_level
            },
            "file": {
                "class": "logging.FileHandler",
                "filename": os.path.join(logs_dir, f"rag_v_{logging.Formatter().formatTime(logging.LogRecord('','','','','','','',''), '%Y-%m-%d')}.log"),
                "formatter": "standard",
                "level": log_level,
                "encoding": "utf-8"
            }
        },
        "root": {
            "handlers": ["file"],
            "level": log_level
        },
        # Set log levels for specific modules
        "loggers": {
            "uvicorn": {
                "handlers": ["file"],
                "level": log_level,
                "propagate": False
            },
            # Disable httpx/requests logging
            "httpx": {
                "handlers": ["file"],
                "level": log_level,
                "propagate": False
            },
            "httpcore": {
                "handlers": ["file"],
                "level": log_level,
                "propagate": False
            },
            "requests": {
                "handlers": ["file"],
                "level": log_level,
                "propagate": False
            },
            "fastapi": {
                "handlers": ["file"],
                "level": log_level,
                "propagate": False
            },
            "src": {
                "handlers": ["file"],
                "level": log_level,
                "propagate": False
            },
        }
    }
    
    # Apply logging configuration
    dictConfig(log_config)
    
    return log_level

def get_logger(name: str):
    """
    Get a logger with the given name
    
    Args:
        name: Name of the logger
        
    Returns:
        Logger instance
    """
    return logging.getLogger(name)

# If this module is run directly, perform a simple test
if __name__ == "__main__":
    setup_logging()
    test_logger = get_logger("test.logger")
    test_logger.debug("This is a debug log")
    test_logger.info("This is an info log")
    test_logger.warning("This is a warning log")
    test_logger.error("This is an error log")