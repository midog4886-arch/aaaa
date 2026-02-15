# 🏆 Champions Academy - دليل النشر على Railway

## المتطلبات
- حساب على [Railway](https://railway.app)
- حساب على [MongoDB Atlas](https://www.mongodb.com/atlas) (مجاني)

---

## 📋 خطوات النشر

### الخطوة 1: إنشاء قاعدة بيانات MongoDB Atlas (مجاني)

1. اذهب إلى [MongoDB Atlas](https://www.mongodb.com/atlas)
2. أنشئ حساب مجاني
3. أنشئ Cluster جديد (اختر Free Tier)
4. أنشئ Database User:
   - اذهب إلى Database Access
   - أضف مستخدم جديد (احفظ اسم المستخدم وكلمة المرور)
5. اسمح بالاتصال من أي IP:
   - اذهب إلى Network Access
   - أضف `0.0.0.0/0`
6. احصل على Connection String:
   - اضغط Connect → Connect your application
   - انسخ الرابط (سيكون مثل: `mongodb+srv://username:password@cluster.xxxxx.mongodb.net/`)

---

### الخطوة 2: النشر على Railway

1. اذهب إلى [Railway](https://railway.app)
2. سجل دخول بحساب GitHub
3. اضغط "New Project"
4. اختر "Deploy from GitHub repo"
5. اختر مستودع التطبيق
6. بعد إنشاء المشروع، اذهب إلى "Variables" وأضف:

```
MONGO_URL=mongodb+srv://username:password@cluster.xxxxx.mongodb.net/
DB_NAME=champions_academy
JWT_SECRET_KEY=your-secret-key-here-make-it-long-and-random
PORT=8000
```

7. اضغط "Deploy"

---

### الخطوة 3: إعداد النطاق

1. في Railway، اذهب إلى Settings → Domains
2. اضغط "Generate Domain" للحصول على رابط مجاني
3. أو أضف نطاقك الخاص

---

## 🔧 المتغيرات البيئية المطلوبة

| المتغير | الوصف | مثال |
|---------|-------|------|
| `MONGO_URL` | رابط MongoDB Atlas | `mongodb+srv://user:pass@cluster.mongodb.net/` |
| `DB_NAME` | اسم قاعدة البيانات | `champions_academy` |
| `JWT_SECRET_KEY` | مفتاح سري للتشفير | `my-super-secret-key-123` |
| `PORT` | منفذ الخادم | `8000` |

---

## 📱 روابط التطبيق بعد النشر

- **لوحة التحكم**: `https://your-app.railway.app/login`
- **بوابة الأعضاء**: `https://your-app.railway.app/portal/login`

---

## 🔐 بيانات الدخول الافتراضية

- **اسم المستخدم**: `242456`
- **كلمة المرور**: `242456`

---

## ❓ استكشاف الأخطاء

### التطبيق لا يعمل؟
1. تحقق من Logs في Railway
2. تأكد من صحة `MONGO_URL`
3. تأكد من إضافة IP `0.0.0.0/0` في MongoDB Atlas

### خطأ في الاتصال بقاعدة البيانات؟
1. تأكد من صحة اسم المستخدم وكلمة المرور في `MONGO_URL`
2. تأكد من أن الـ Cluster يعمل في MongoDB Atlas

---

## 💡 نصائح

- Railway يعطيك $5 مجاناً كل شهر
- MongoDB Atlas مجاني حتى 512MB
- يمكنك إيقاف التطبيق في أي وقت لتوفير الرصيد

---

## 📞 الدعم

إذا واجهت مشاكل، تواصل معنا على:
- Discord: https://discord.gg/VzKfwCXC4A
- Email: support@emergent.sh
