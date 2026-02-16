import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ArrowRight, Shield, Lock, Eye, UserCheck, Mail, Phone } from 'lucide-react';

const PrivacyPolicy = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white p-4 sticky top-0 z-10 shadow-lg">
        <div className="flex items-center gap-3 max-w-4xl mx-auto">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="text-white hover:bg-white/20"
          >
            <ArrowRight className="w-6 h-6" />
          </Button>
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6" />
            <h1 className="text-xl font-bold">سياسة الخصوصية</h1>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-8">
        {/* Introduction */}
        <section className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Shield className="w-6 h-6 text-orange-500" />
            مقدمة
          </h2>
          <p className="text-gray-600 leading-relaxed">
            نحن في أكاديمية أداء الأبطال العالمية للرياضة نلتزم بحماية خصوصيتك. توضح سياسة الخصوصية هذه كيفية جمع واستخدام وحماية معلوماتك الشخصية عند استخدام تطبيقنا وخدماتنا.
          </p>
          <p className="text-gray-500 text-sm mt-4">
            آخر تحديث: فبراير 2026
          </p>
        </section>

        {/* Data Collection */}
        <section className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Eye className="w-6 h-6 text-blue-500" />
            البيانات التي نجمعها
          </h2>
          <div className="space-y-4 text-gray-600">
            <div className="bg-blue-50 rounded-lg p-4">
              <h3 className="font-bold text-blue-800 mb-2">البيانات الشخصية:</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>الاسم الكامل</li>
                <li>رقم الهاتف</li>
                <li>تاريخ الميلاد</li>
                <li>الجنس</li>
                <li>عنوان البريد الإلكتروني (اختياري)</li>
              </ul>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <h3 className="font-bold text-green-800 mb-2">بيانات الاشتراك:</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>الأنشطة المسجل بها</li>
                <li>تواريخ الاشتراك</li>
                <li>سجل الحضور</li>
                <li>نقاط الولاء</li>
              </ul>
            </div>
            <div className="bg-orange-50 rounded-lg p-4">
              <h3 className="font-bold text-orange-800 mb-2">بيانات الاستخدام:</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>سجل تسجيل الدخول</li>
                <li>الصفحات المزارة</li>
                <li>نوع الجهاز والمتصفح</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Data Usage */}
        <section className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <UserCheck className="w-6 h-6 text-green-500" />
            كيف نستخدم بياناتك
          </h2>
          <div className="space-y-3 text-gray-600">
            <p className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              إدارة حسابك واشتراكاتك في الأكاديمية
            </p>
            <p className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              إرسال إشعارات حول مواعيد التدريب والتجديدات
            </p>
            <p className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              تتبع حضورك ونقاط الولاء الخاصة بك
            </p>
            <p className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              التواصل معك بخصوص خدماتنا
            </p>
            <p className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              تحسين خدماتنا وتجربة المستخدم
            </p>
          </div>
        </section>

        {/* Data Protection */}
        <section className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Lock className="w-6 h-6 text-purple-500" />
            حماية البيانات
          </h2>
          <div className="space-y-4 text-gray-600">
            <p>نتخذ إجراءات أمنية صارمة لحماية بياناتك:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-purple-50 rounded-lg p-4">
                <h3 className="font-bold text-purple-800 mb-2">🔐 التشفير</h3>
                <p className="text-sm">جميع البيانات مشفرة أثناء النقل والتخزين</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-4">
                <h3 className="font-bold text-purple-800 mb-2">🛡️ الوصول المحدود</h3>
                <p className="text-sm">فقط الموظفون المصرح لهم يمكنهم الوصول للبيانات</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-4">
                <h3 className="font-bold text-purple-800 mb-2">💾 النسخ الاحتياطي</h3>
                <p className="text-sm">نسخ احتياطي منتظم لحماية بياناتك</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-4">
                <h3 className="font-bold text-purple-800 mb-2">🔍 المراقبة</h3>
                <p className="text-sm">مراقبة مستمرة للأنظمة لاكتشاف أي اختراق</p>
              </div>
            </div>
          </div>
        </section>

        {/* Data Sharing */}
        <section className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">مشاركة البيانات</h2>
          <div className="space-y-3 text-gray-600">
            <p className="font-semibold text-red-600">❌ لا نبيع بياناتك الشخصية لأي طرف ثالث.</p>
            <p>قد نشارك بياناتك فقط في الحالات التالية:</p>
            <ul className="list-disc list-inside space-y-2 mr-4">
              <li>مع مقدمي الخدمات الذين يساعدوننا في تشغيل التطبيق (بموجب اتفاقيات سرية)</li>
              <li>عند الطلب من الجهات الحكومية المختصة وفقاً للقانون</li>
              <li>لحماية حقوقنا وسلامة المستخدمين</li>
            </ul>
          </div>
        </section>

        {/* User Rights */}
        <section className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">حقوقك</h2>
          <div className="space-y-3 text-gray-600">
            <p>لديك الحق في:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-2">
                <span className="text-2xl">📋</span>
                <span>الوصول إلى بياناتك الشخصية</span>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-2">
                <span className="text-2xl">✏️</span>
                <span>تصحيح بياناتك غير الدقيقة</span>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-2">
                <span className="text-2xl">🗑️</span>
                <span>طلب حذف بياناتك</span>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-2">
                <span className="text-2xl">🚫</span>
                <span>الاعتراض على معالجة بياناتك</span>
              </div>
            </div>
          </div>
        </section>

        {/* Contact */}
        <section className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Mail className="w-6 h-6 text-orange-500" />
            تواصل معنا
          </h2>
          <p className="text-gray-600 mb-4">
            إذا كان لديك أي أسئلة حول سياسة الخصوصية أو ترغب في ممارسة حقوقك، يرجى التواصل معنا:
          </p>
          <div className="space-y-3">
            <a 
              href="tel:0566238384" 
              className="flex items-center gap-3 bg-green-50 rounded-lg p-4 hover:bg-green-100 transition-colors"
            >
              <Phone className="w-6 h-6 text-green-600" />
              <span className="text-green-700 font-semibold">0566238384</span>
            </a>
            <a 
              href="mailto:support@gcsp-academy.com" 
              className="flex items-center gap-3 bg-blue-50 rounded-lg p-4 hover:bg-blue-100 transition-colors"
            >
              <Mail className="w-6 h-6 text-blue-600" />
              <span className="text-blue-700 font-semibold">support@gcsp-academy.com</span>
            </a>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center text-gray-500 text-sm py-6">
          <p>© 2026 أكاديمية أداء الأبطال العالمية للرياضة</p>
          <p>جميع الحقوق محفوظة</p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
