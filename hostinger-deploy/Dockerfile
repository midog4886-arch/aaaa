# Stage 1: Build Frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend/ ./frontend/
ENV REACT_APP_BACKEND_URL=""
RUN cd frontend && npm run build

# Stage 2: Setup Backend and serve
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements and install
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./

# Copy frontend build to static folder
COPY --from=frontend-builder /app/frontend/build ./static

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 8000

# Start server
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
