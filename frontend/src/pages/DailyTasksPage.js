import React from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import DailyActions from '../components/DailyActions';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';

export default function DailyTasksPage() {
  const { language } = useLanguage();
  const { isAdmin, user } = useAuth();
  const ar = language === 'ar';
  const allowed = permission => isAdmin || user?.permissions?.includes(permission);
  return <Layout title={ar ? 'مهام اليوم' : 'Today’s tasks'}>
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-5">
        <h1 className="text-2xl font-bold">{ar ? 'مهام اليوم' : 'Today’s tasks'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{ar ? 'تابع الحالات التي تحتاج إجراءً بحسب الفرع المحدد وصلاحياتك. تتحدث البيانات كل دقيقة.' : 'Follow up on actionable cases for your selected branch and permissions. Data refreshes every minute.'}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {allowed('members') && <Link className="rounded-lg border px-4 py-2 text-sm hover:bg-muted" to="/admin/members">{ar ? 'ملفات الأعضاء' : 'Member files'}</Link>}
          {allowed('invoices') && <Link className="rounded-lg border px-4 py-2 text-sm hover:bg-muted" to="/admin/invoices">{ar ? 'الفواتير' : 'Invoices'}</Link>}
        </div>
      </div>
      <DailyActions />
    </div>
  </Layout>;
}
