import os
from typing import Tuple
import dotenv
from src.utils.logging_config import get_logger

logger = get_logger(__name__)

# Load environment variables
dotenv.load_dotenv()

# Define supported file formats from environment or use defaults
SUPPORTED_FORMATS = set(os.getenv("SUPPORTED_FORMATS", ".txt,.pdf,.md,.docx,.pptx,.xlsx,.html,.htm,.csv").split(","))

# Define maximum file size from environment or use default (100MB)
MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE", str(100 * 1024 * 1024)))

MAX_FILES_PER_UPLOAD = int(os.getenv("MAX_FILES_PER_UPLOAD", "20"))



