from pathlib import Path
import os
import logging
from dotenv import load_dotenv

logger = logging.getLogger("database")

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env', override=True)

# ── Choose connection method ──────────────────────────────────────────────────
# If ATLAS_APP_ID + ATLAS_API_KEY are set → use HTTP Data API (port 443)
# Otherwise → use Motor native driver (port 27017)

ATLAS_APP_ID = os.environ.get('ATLAS_APP_ID', '')
ATLAS_API_KEY = os.environ.get('ATLAS_API_KEY', '')
DB_NAME = os.environ.get('DB_NAME', 'champions_academy')

if ATLAS_APP_ID and ATLAS_API_KEY:
    logger.info("Using Atlas Data API (HTTPS) for database connection")
    from atlas_http_client import AtlasClient
    _client = AtlasClient(
        app_id=ATLAS_APP_ID,
        api_key=ATLAS_API_KEY,
        data_source=os.environ.get('ATLAS_DATA_SOURCE', 'Cluster0'),
    )
    db = _client[DB_NAME]
else:
    logger.info("Using Motor (native MongoDB) for database connection")
    from motor.motor_asyncio import AsyncIOMotorClient
    import certifi
    mongo_url = os.environ['MONGO_URL']
    _motor_client = AsyncIOMotorClient(
        mongo_url,
        tls=True,
        tlsAllowInvalidCertificates=True,
        serverSelectionTimeoutMS=30000,
        connectTimeoutMS=20000,
        socketTimeoutMS=20000,
    )
    db = _motor_client[DB_NAME]

# JWT Config
JWT_SECRET = os.environ.get('JWT_SECRET_KEY', 'default_secret')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Stripe Config
STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY', '')

# Uploads directory
UPLOADS_DIR = ROOT_DIR / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)
EXPENSES_DIR = UPLOADS_DIR / "expenses"
EXPENSES_DIR.mkdir(exist_ok=True)
