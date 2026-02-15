FROM node:16-alpine AS frontend-builder
WORKDIR /app/frontend

RUN npm install -g yarn

COPY frontend/package.json ./
RUN yarn install --ignore-engines
COPY frontend/ ./
RUN yarn build

FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir qrcode Pillow pywebpush

COPY backend/ ./

COPY --from=frontend-builder /app/frontend/build ./static

RUN mkdir -p uploads

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
