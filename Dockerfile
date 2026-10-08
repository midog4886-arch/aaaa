# Stage 1: Build Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --global npm@10.9.4 --registry=https://registry.npmjs.org --fetch-timeout=30000 --fetch-retries=1 --loglevel=verbose \
    && npm ci --no-audit --no-fund --registry=https://registry.npmjs.org --fetch-timeout=30000 --fetch-retries=1 --loglevel=verbose \
    || (cat /root/.npm/_logs/*debug*; exit 1)
COPY frontend/public ./public
COPY frontend/src ./src
COPY frontend/plugins ./plugins
COPY frontend/craco.config.js frontend/jsconfig.json frontend/postcss.config.js frontend/tailwind.config.js ./
COPY scripts/post-merge.sh /app/scripts/post-merge.sh
ENV REACT_APP_BACKEND_URL=""
RUN CI=false npm run build

# Stage 2: Setup Backend
FROM python:3.12-slim AS backend-base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ENV=production

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/*.py ./
COPY backend/routes ./routes
COPY backend/models ./models
COPY backend/middleware ./middleware
COPY backend/services ./services
COPY backend/utils ./utils
COPY scripts/recover_four_post_migration.py ./scripts/recover_four_post_migration.py
COPY backend/scripts/repair_duplicate_closure_2026.py ./scripts/repair_duplicate_closure_2026.py
COPY backend/scripts/backfill_waha_inbound.py ./scripts/backfill_waha_inbound.py

# A failing registration-to-card workflow stops the image build before deploy.
# The test layer is separate, so pytest and test fixtures stay out of production.
FROM backend-base AS backend-tests
RUN pip install --no-cache-dir pytest==8.4.2
COPY backend/tests ./tests
COPY --from=frontend-builder /app/frontend/build ./static
RUN MONGO_URL=mongodb://127.0.0.1:27017 MONGO_TLS=false SESSION_SECRET=predeploy-test \
    python -m pytest \
    tests/test_registration_forms_unit.py \
    tests/test_registration_journey.py \
    tests/test_invoice_pay_notify_unit.py -q \
    && touch /tmp/predeploy-tests-passed

FROM backend-base
COPY --from=backend-tests /tmp/predeploy-tests-passed /tmp/predeploy-tests-passed

# Create static folder and copy frontend build
RUN mkdir -p static uploads backups
COPY --from=frontend-builder /app/frontend/build ./static
RUN MONGO_URL=mongodb://127.0.0.1:27017 MONGO_TLS=false python -c "import server"

# Expose port
EXPOSE 8000

# Set environment variable
ENV PORT=8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/health', timeout=4)"

# Start server
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
