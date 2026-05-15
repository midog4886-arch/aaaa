from pathlib import Path
import os
import logging
from dotenv import load_dotenv

logger = logging.getLogger("database")

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env', override=True)

ATLAS_APP_ID = os.environ.get('ATLAS_APP_ID', '')
ATLAS_API_KEY = os.environ.get('ATLAS_API_KEY', '')
DB_NAME = os.environ.get('DB_NAME', 'champions_academy')
USE_ATLAS_PROXY = os.environ.get('USE_ATLAS_PROXY', '').lower() in ('1', 'true', 'yes')
MONGO_URL = os.environ.get('MONGO_URL', '')

if ATLAS_APP_ID and ATLAS_API_KEY and (USE_ATLAS_PROXY or not MONGO_URL):
    logger.info("Using Atlas Data API (HTTPS) for database connection")
    from atlas_http_client import AtlasClient
    _raw_client = AtlasClient(
        app_id=ATLAS_APP_ID,
        api_key=ATLAS_API_KEY,
        data_source=os.environ.get('ATLAS_DATA_SOURCE', 'Cluster0'),
    )
else:
    logger.info("Using Motor (native MongoDB) for database connection")
    from motor.motor_asyncio import AsyncIOMotorClient
    import certifi
    mongo_url = os.environ['MONGO_URL']
    _raw_client = AsyncIOMotorClient(
        mongo_url,
        tls=True,
        tlsAllowInvalidCertificates=True,
        serverSelectionTimeoutMS=30000,
        connectTimeoutMS=20000,
        socketTimeoutMS=20000,
    )


class TenantDBProxy:
    """Proxy that forwards every collection access to the current tenant's DB.

    Reads ``utils.tenant.get_current_tenant_db_name()`` (a ContextVar set by
    the tenant middleware on every HTTP request) and resolves the underlying
    database fresh on each access. Falls back to the default ``DB_NAME`` when
    no tenant context is set (background tasks, scripts, startup).
    """
    __slots__ = ("_client",)

    def __init__(self, client):
        object.__setattr__(self, "_client", client)

    def _resolve(self):
        from utils.tenant import get_current_tenant_db_name
        return self._client[get_current_tenant_db_name()]

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return getattr(self._resolve(), name)

    def __getitem__(self, name):
        return self._resolve()[name]


db = TenantDBProxy(_raw_client)

JWT_SECRET = os.environ.get('JWT_SECRET_KEY', 'default_secret')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY', '')

UPLOADS_DIR = ROOT_DIR / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)
EXPENSES_DIR = UPLOADS_DIR / "expenses"
EXPENSES_DIR.mkdir(exist_ok=True)
