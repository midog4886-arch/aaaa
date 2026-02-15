# 🌐 نشر بوابة الأعضاء على GitHub Pages

## المتطلبات
- حساب GitHub
- Git مثبت على جهازك

## خطوات النشر

### 1️⃣ إنشاء مستودع GitHub جديد

1. اذهب إلى [github.com/new](https://github.com/new)
2. أدخل اسم المستودع: `member-portal` (أو أي اسم تريده)
3. اجعله **Public**
4. اضغط **Create repository**

### 2️⃣ تنزيل ملفات البوابة

يمكنك تنزيل الملفات من Emergent:
- اذهب إلى لوحة التحكم في Emergent
- اضغط على **Download Code**
- فك الضغط عن الملفات

### 3️⃣ رفع الملفات إلى GitHub

```bash
# افتح Terminal في مجلد member-portal-deploy

# تهيئة Git
git init
git add .
git commit -m "Initial commit - Member Portal"

# ربط المستودع البعيد (استبدل YOUR_USERNAME باسم مستخدمك)
git remote add origin https://github.com/YOUR_USERNAME/member-portal.git

# رفع الملفات
git branch -M main
git push -u origin main
```

### 4️⃣ تفعيل GitHub Pages

1. اذهب إلى **Settings** في المستودع
2. من القائمة الجانبية اختر **Pages**
3. في **Source** اختر:
   - Branch: `gh-pages`
   - Folder: `/ (root)`
4. اضغط **Save**

### 5️⃣ نشر التطبيق

```bash
# تثبيت الحزم
npm install

# بناء ونشر
npm run deploy
```

### 6️⃣ الرابط النهائي

بعد النشر، ستجد البوابة على:
```
https://YOUR_USERNAME.github.io/member-portal/
```

---

## ⚙️ تغيير رابط الـ Backend

إذا أردت تغيير رابط الـ Backend، عدّل الملف:
`src/services/api.js`

```javascript
const API_URL = 'https://your-backend-url.com';
```

---

## 🔄 تحديث البوابة

لتحديث البوابة بعد أي تغييرات:

```bash
npm run deploy
```

---

## ❓ مشاكل شائعة

### الصفحة فارغة بعد النشر
- تأكد من أن `homepage` في `package.json` صحيح
- امسح cache المتصفح: `Ctrl + Shift + R`

### خطأ في الـ API
- تأكد من أن رابط الـ Backend صحيح في `src/services/api.js`
- تأكد من أن الـ Backend يسمح بـ CORS من GitHub Pages

---

## 📱 PWA (تثبيت كتطبيق)

المستخدمون يمكنهم تثبيت البوابة كتطبيق على هواتفهم:
- على iPhone: اضغط مشاركة → "Add to Home Screen"
- على Android: سيظهر إشعار "Install App"
