# Champions Academy on Coolify

Build the image from the repository root:

```sh
docker build -t champions-academy:latest .
```

For the app alone in Coolify, use the Dockerfile build pack, root build context, port `8000`,
and health check path `/health`. The image serves both the React frontend
and FastAPI backend. The frontend uses same-origin API requests.

Configure runtime environment variables in Coolify, not in the image:

- `MONGO_URL`: the MongoDB connection URI. The current database client enables
  TLS by default. Set `MONGO_TLS=false` only for the internal Compose database.
- `JWT_SECRET_KEY`: a strong persistent secret used to sign login tokens.
- `PORT=8000`
- `APP_BASE_URL` and `REACT_APP_BACKEND_URL`: the deployed public URL, used by
  backend-generated links.
- Optional integration credentials: Firebase, VAPID, SMTP, WhatsApp, and Sentry.
  Firebase credentials can be supplied as `FIREBASE_SERVICE_ACCOUNT` JSON;
  Firebase messaging also requires the optional `firebase-admin` dependency.

Persist `/app/uploads` and `/app/backups` using Coolify persistent storage.
Database contents stay in MongoDB. This image does not run the separate
WhatsApp Node service; set `WHATSAPP_SERVICE_URL` to that service if needed.

For an included MongoDB database, deploy `docker-compose.yml` using Coolify's
Docker Compose build pack. Configure `MONGO_ROOT_PASSWORD` and `JWT_SECRET_KEY`
as strong secrets in Coolify and set `APP_BASE_URL` to the public app URL.
Use a hexadecimal database password to avoid URI escaping issues. Assign the
public domain to the `app` service on port `8000`. MongoDB has no public port.
All three data directories use named volumes. This creates a new empty database;
existing production data must be migrated separately. Keep the database password
stable after initialization because changing it does not update MongoDB users.

MongoDB runs as a single-node replica set (`rs0`) to support atomic reviewed
subscription edits. Its internal authentication key is persisted in the existing
MongoDB data volume. The health check initializes the replica set once and waits
for a writable primary; the database remains private to the Compose network.

Check `/health`, `/api/health`, and the login page after deployment. The first
endpoint checks liveness; the second checks database availability.

Local environment files, uploads, backups, Android projects, and attached
assets are excluded from the Docker build context. The Dockerfile also copies
only the application source directories so environment files are excluded
when the Dockerfile is supplied directly through the Coolify API.
