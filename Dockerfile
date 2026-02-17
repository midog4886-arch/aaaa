FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend

ARG CACHEBUST=5

COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./

ENV REACT_APP_BACKEND_URL=""

RUN echo "Cache bust: $CACHEBUST" && npm run build

FROM python:3.11-slim
WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

COPY --from=frontend-builder /app/frontend/build ./static

RUN mkdir -p uploads

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
