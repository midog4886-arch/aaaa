# 🚀 دليل نشر التطبيق على Hostinger VPS

## 📋 المتطلبات
- Hostinger VPS (Ubuntu 22.04)
- وصول SSH
- Domain (اختياري)

---

## 🔧 الخطوة 1: الاتصال بـ VPS

```bash
ssh root@YOUR_VPS_IP
```

---

## 🔧 الخطوة 2: تثبيت Docker

```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install docker-compose -y

# Verify installation
docker --version
docker-compose --version
```

---

## 🔧 الخطوة 3: إنشاء مجلد التطبيق

```bash
mkdir -p /var/www/gcsp-academy
cd /var/www/gcsp-academy
```

---

## 🔧 الخطوة 4: نسخ الملفات

### الطريقة 1: من GitHub
```bash
git clone https://github.com/midog4886-arch/aaaa.git .
```

### الطريقة 2: رفع الملفات يدوياً
استخدم FileZilla أو SCP لنقل الملفات

---

## 🔧 الخطوة 5: إعداد ملف البيئة

```bash
nano .env
```

أضف هذه المتغيرات:
```
MONGO_URL=mongodb+srv://YOUR_MONGODB_URL
DB_NAME=242456
JWT_SECRET_KEY=your-secret-key-here
PORT=8000
```

احفظ: `Ctrl+X` → `Y` → `Enter`

---

## 🔧 الخطوة 6: بناء وتشغيل التطبيق

```bash
# Build the application
docker-compose build

# Start the application
docker-compose up -d

# Check if running
docker-compose ps

# View logs
docker-compose logs -f
```

---

## 🔧 الخطوة 7: إعداد Nginx (للـ Domain)

```bash
apt install nginx -y

nano /etc/nginx/sites-available/gcsp-academy
```

أضف:
```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

تفعيل الموقع:
```bash
ln -s /etc/nginx/sites-available/gcsp-academy /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

---

## 🔧 الخطوة 8: إعداد SSL (HTTPS)

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d your-domain.com -d www.your-domain.com
```

---

## 🔧 الخطوة 9: إعداد Firewall

```bash
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
```

---

## 📋 أوامر مفيدة

### إعادة تشغيل التطبيق
```bash
cd /var/www/gcsp-academy
docker-compose restart
```

### عرض السجلات
```bash
docker-compose logs -f
```

### إيقاف التطبيق
```bash
docker-compose down
```

### تحديث التطبيق
```bash
git pull
docker-compose build
docker-compose up -d
```

---

## 🔐 بيانات الدخول

| الحقل | القيمة |
|-------|--------|
| اسم المستخدم | 242456 |
| كلمة المرور | 242456 |

---

## ❓ مشاكل شائعة

### 1. التطبيق لا يعمل
```bash
docker-compose logs
```

### 2. خطأ في قاعدة البيانات
تأكد من صحة `MONGO_URL` في ملف `.env`

### 3. Port 80 مستخدم
```bash
systemctl stop apache2
systemctl disable apache2
```

---

## 📞 الدعم

للمساعدة، تواصل عبر:
- support@gcsp-academy.com
- 0566238384
