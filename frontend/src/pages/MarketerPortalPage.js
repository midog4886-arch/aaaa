import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config/api';
import {
  Loader2, Megaphone, Users, Wallet, BadgeDollarSign, Percent,
  Copy, Link2, Receipt, AlertCircle,
} from 'lucide-react';

const fmt = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const MarketerPortalPage = () => {
  const { tenantSlug, token } = useParams();

  const api = useMemo(() => axios.create({
    baseURL: API_URL || '',
    headers: { 'X-Tenant-Slug': tenantSlug || 'default' },
  }), [tenantSlug]);

  const logoUrl = `${API_URL || ''}/api/tenant/branding/logo?slug=${encodeURIComponent(tenantSlug || 'default')}`;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api.get(`/api/public/marketer-portal/${encodeURIComponent(token)}`);
        if (active) setData(res.data);
      } catch (e) {
        if (active) setError(e?.response?.data?.detail || 'تعذّر تحميل البيانات. تأكّد من صحة الرابط.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [api, token]);

  const referralLink = useMemo(() => {
    if (!data?.marketer) return '';
    const code = data.marketer.referral_code;
    const branch = data.marketer.branch_id;
    if (!code) return '';
    const base = `${window.location.origin}/register/${tenantSlug}`;
    return branch ? `${base}/${branch}?ref=${encodeURIComponent(code)}` : `${base}?ref=${encodeURIComponent(code)}`;
  }, [data, tenantSlug]);

  const copy = async (text, msg) => {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); window.alert(msg); }
    catch { window.alert('تعذّر النسخ'); }
  };

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div dir="rtl" className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-6 text-center">
        <AlertCircle className="w-12 h-12 text-red-400 mb-3" />
        <h1 className="text-lg font-bold text-slate-700">رابط غير صالح</h1>
        <p className="text-sm text-slate-500 mt-1">{error || 'تعذّر العثور على البيانات.'}</p>
      </div>
    );
  }

  const m = data.marketer;
  const s = data.stats || {};
  const commissions = data.commissions || [];

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 pb-10">
      {/* Header */}
      <div className="bg-gradient-to-l from-emerald-600 to-emerald-500 text-white">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center gap-4">
          <img
            src={logoUrl}
            alt="logo"
            className="w-14 h-14 rounded-xl bg-white/20 object-contain p-1"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Megaphone className="w-5 h-5" />
              <h1 className="text-lg font-bold truncate">بوابة المسوّق</h1>
            </div>
            <p className="text-sm text-white/90 truncate">مرحباً {m.name}</p>
          </div>
          <span className="text-xs bg-white/20 rounded-full px-3 py-1 font-mono">{m.referral_code}</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 -mt-4 space-y-4">
        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col items-center text-center">
            <Users className="w-6 h-6 text-blue-500 mb-1" />
            <p className="text-xl font-bold">{s.referrals || 0}</p>
            <p className="text-xs text-slate-500">إجمالي الإحالات</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col items-center text-center">
            <BadgeDollarSign className="w-6 h-6 text-slate-500 mb-1" />
            <p className="text-xl font-bold">{fmt(s.total_commission)}</p>
            <p className="text-xs text-slate-500">إجمالي العمولات (ر.س)</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col items-center text-center">
            <Wallet className="w-6 h-6 text-amber-500 mb-1" />
            <p className="text-xl font-bold text-amber-600">{fmt(s.due_amount)}</p>
            <p className="text-xs text-slate-500">مستحقة (ر.س)</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col items-center text-center">
            <BadgeDollarSign className="w-6 h-6 text-emerald-500 mb-1" />
            <p className="text-xl font-bold text-emerald-600">{fmt(s.paid_amount)}</p>
            <p className="text-xs text-slate-500">مدفوعة (ر.س)</p>
          </div>
        </div>

        {/* Terms + referral link */}
        <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
          <div className="flex items-center gap-4 text-sm text-slate-600 flex-wrap">
            <span className="flex items-center gap-1"><Percent className="w-4 h-4" /> خصم للعميل: {m.discount_percent}%</span>
            <span className="flex items-center gap-1"><BadgeDollarSign className="w-4 h-4" /> عمولتك: {m.commission_percent}%</span>
          </div>
          {referralLink && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">رابط التسجيل الخاص بك — شاركه مع عملائك:</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={referralLink}
                  dir="ltr"
                  className="flex-1 text-xs bg-slate-50 border rounded-lg px-3 py-2 truncate"
                />
                <button
                  onClick={() => copy(referralLink, 'تم نسخ رابط التسجيل')}
                  className="shrink-0 inline-flex items-center gap-1 text-sm bg-emerald-600 text-white rounded-lg px-3 py-2"
                >
                  <Link2 className="w-4 h-4" /> نسخ
                </button>
                <button
                  onClick={() => copy(m.referral_code, 'تم نسخ كود الإحالة')}
                  className="shrink-0 inline-flex items-center gap-1 text-sm bg-slate-100 text-slate-700 rounded-lg px-3 py-2"
                >
                  <Copy className="w-4 h-4" /> الكود
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Commission history */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <Receipt className="w-5 h-5 text-slate-500" />
            <h2 className="font-bold">سجل العمولات</h2>
          </div>
          {commissions.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">لا توجد عمولات مسجّلة بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 border-b">
                    <th className="text-start py-2 font-medium">العميل</th>
                    <th className="text-start py-2 font-medium">العمولة (ر.س)</th>
                    <th className="text-start py-2 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2">{c.member_name || '—'}</td>
                      <td className="py-2 font-semibold">{fmt(c.commission_amount)}</td>
                      <td className="py-2">
                        <span className={`text-xs rounded-full px-2 py-0.5 ${c.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {c.status === 'paid' ? 'مدفوعة' : 'مستحقة'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 pt-2">هذه صفحة خاصة بك — لا تشارك الرابط مع أحد.</p>
      </div>
    </div>
  );
};

export default MarketerPortalPage;
