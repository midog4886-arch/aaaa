FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend

# Cache bust - change this number to force rebuild
ARG CACHEBUST=3

COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./

# Set REACT_APP_BACKEND_URL to empty string for same-origin deployment
ENV REACT_APP_BACKEND_URL=""

# Force rebuild by echoing cache bust
RUN echo "Cache bust: $CACHEBUST" && npm run build

FROM python:3.11-slim
WORKDIR /app

# Install dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY backend/ ./

# Copy frontend build
COPY --from=frontend-builder /app/frontend/build ./static

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 8000

# Start server
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
