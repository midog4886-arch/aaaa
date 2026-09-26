# Stage 1: Build Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --global npm@10.9.4 --registry=https://registry.npmjs.org --fetch-timeout=30000 --fetch-retries=1 --loglevel=verbose \
    && npm ci --legacy-peer-deps --no-audit --no-fund --registry=https://registry.npmjs.org --fetch-timeout=30000 --fetch-retries=1 --loglevel=verbose \
    || (cat /root/.npm/_logs/*debug*; exit 1)
COPY frontend/public ./public
COPY frontend/src ./src
COPY frontend/plugins ./plugins
COPY frontend/craco.config.js frontend/jsconfig.json frontend/postcss.config.js frontend/tailwind.config.js ./
COPY scripts/post-merge.sh /app/scripts/post-merge.sh
ENV REACT_APP_BACKEND_URL=""
RUN npm run build

# Stage 2: Setup Backend
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

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
