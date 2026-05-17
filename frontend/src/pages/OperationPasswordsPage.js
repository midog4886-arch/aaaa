import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Eye, EyeOff, Save, Lock, RotateCcw } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

const API = process.env.REACT_APP_BACKEND_URL || '';

const OperationPasswordsPage = () => {
  const { language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [keys, setKeys] = useState({});
  const [values, setValues] = useState({});
  const [defaultPw, setDefaultPw] = useState('');
  const [show, setShow] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/api/settings/operation-passwords`);
      setKeys(res.data.keys || {});
      setValues(res.data.values || {});
      setDefaultPw(res.data.default || '');
    } catch (e) {
      toast.error(language === 'ar' ? 'فشل تحميل الإعدادات' : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    for (const k of Object.keys(keys)) {
      if (!values[k] || values[k].trim().length < 4) {
        toast.error(language === 'ar' ? `كلمة المرور قصيرة جداً: ${keys[k]}` : `Password too short: ${k}`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await axios.put(`${API}/api/settings/operation-passwords`, { values });
      setValues(res.data.values || values);
      toast.success(language === 'ar' ? 'تم الحفظ' : 'Saved');
    } catch (e) {
      toast.error(e?.response?.data?.detail || (language === 'ar' ? 'فشل الحفظ' : 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const resetOne = (k) => {
    setValues(v => ({ ...v, [k]: defaultPw }));
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">{language === 'ar' ? 'جارٍ التحميل...' : 'Loading...'}</div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto" dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Lock className="w-6 h-6 text-orange-500" />
          {language === 'ar' ? 'كلمات مرور العمليات' : 'Operation Passwords'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {language === 'ar'
            ? 'تحكّم في كلمات المرور التي تُطلب عند تنفيذ العمليات الحساسة. كل أكاديمية تدير كلماتها بشكل مستقل.'
            : 'Manage the passwords required for sensitive operations. Each academy manages its own.'}
        </p>
      </div>

      <div className="bg-white rounded-xl border shadow-sm divide-y">
        {Object.entries(keys).map(([k, label]) => (
          <div key={k} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <div className="font-semibold text-gray-800">{label}</div>
              <div className="text-xs text-gray-400 mt-0.5 font-mono">{k}</div>
            </div>
            <div className="flex items-center gap-2 flex-1">
              <div className="relative flex-1">
                <input
                  type={show[k] ? 'text' : 'password'}
                  value={values[k] || ''}
                  onChange={(e) => setValues(v => ({ ...v, [k]: e.target.value }))}
                  className="w-full px-3 py-2 pe-10 border rounded-lg text-sm font-mono focus:ring-2 focus:ring-orange-200 focus:border-orange-400 outline-none"
                  placeholder="••••••"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShow(s => ({ ...s, [k]: !s[k] }))}
                  className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                >
                  {show[k] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={() => resetOne(k)}
                title={language === 'ar' ? 'إعادة للقيمة الافتراضية' : 'Reset to default'}
                className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={load}
          disabled={saving}
          className="px-4 py-2 text-sm border rounded-lg text-gray-600 hover:bg-gray-50"
        >
          {language === 'ar' ? 'إلغاء التغييرات' : 'Discard'}
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold flex items-center gap-2 disabled:opacity-60"
        >
          <Save className="w-4 h-4" />
          {saving ? (language === 'ar' ? 'جارٍ الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ التغييرات' : 'Save Changes')}
        </button>
      </div>

      <div className="mt-4 text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-3">
        {language === 'ar'
          ? 'ملاحظة: عند ترك أي كلمة فارغة أو إعادتها للوضع الافتراضي ستصبح القيمة الافتراضية (242456). يُفضّل اختيار كلمات قوية لا تقل عن 6 أحرف.'
          : 'Note: Leaving a password empty or resetting it falls back to the default (242456). Prefer strong passwords of 6+ chars.'}
      </div>
    </div>
  );
};

export default OperationPasswordsPage;
