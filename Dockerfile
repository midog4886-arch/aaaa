FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
# تعيين REACT_APP_BACKEND_URL لسلسلة فارغة للنشر بنفس الأصل
ENV REACT_APP_BACKEND_URL=""
RUN npm run build

FROM python:3.11-slim
WORKDIR /app

# تثبيت التبعيات
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# نسخ الخلفية
COPY backend/ ./

# نسخ بناء الواجهة الأمامية
COPY --from=frontend-builder /app/frontend/build ./static

# إنشاء مجلد التحميلات
RUN mkdir -p uploads

# فتح المنفذ
EXPOSE 8000

# بدء الخادم
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
