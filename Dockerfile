FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

COPY . .

RUN pip install --no-cache-dir -r backend/requirements.txt

RUN cd frontend && npm install --legacy-peer-deps --force && \
    npm install ajv@8.12.0 ajv-keywords@5.1.0 --legacy-peer-deps --force && \
    npm run build

RUN mkdir -p backend/static && cp -r frontend/build/* backend/static/

WORKDIR /app/backend

EXPOSE 8000

CMD uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}
