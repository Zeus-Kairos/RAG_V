import os
import sys
import threading
import warnings

import uvicorn
from src.utils.logging_config import setup_logging
from dotenv import load_dotenv

load_dotenv()

log_level = setup_logging()

# Ignore all UserWarnings
warnings.filterwarnings("ignore", category=UserWarning)

# Add src directory to Python path
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

# API server configuration
API_HOST = os.getenv("API_HOST", "127.0.0.1")
API_PORT = int(os.getenv("API_PORT", "8000"))

# Start the API server in a separate thread
def start_api_server():
    """Start the FastAPI server"""
    uvicorn.run(
        "src.api.main:app",
        host=API_HOST,
        port=API_PORT,
        log_level=log_level.lower(),
        reload=True,
        reload_dirs=["./src"],
    )

if __name__ == "__main__":   
    start_api_server()