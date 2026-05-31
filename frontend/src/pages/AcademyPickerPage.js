import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { Trophy, Loader2, AlertCircle, Building2 } from 'lucide-react';
import { setRememberedMemberPhone } from '../config/api';

const PLATFORM_NAME_AR = 'أكاديميتي';
const PLATFORM_TAGLINE_AR = 'حدّد أكاديميتك للمتابعة';

const AcademyPickerPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [memberCode, setMemberCode] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState(null);
  const [error, setError] = useState('');
  const debounceRef = useRef(null);

  const doLookup = async (codeVal, phoneVal) => {
    setLoading(true);
    setError('');
    setMatches(null);
    try {
      const res = await axios.post('/api/public/lookup-academy', {
        member_code: codeVal.trim(),
        phone: phoneVal.trim(),
      });
      const list = res.data?.matches || [];
      if (list.length === 0) {
        setError('البيانات غير صحيحة. تأكد من رقم العضوية ورقم الجوال أو تواصل مع إدارة أكاديميتك.');
      } else if (list.length === 1) {
        confirmAcademy(list[0]);
      } else {
        setMatches(list);
      }
    } catch (e) {
      if (e?.response?.status === 429) {
        setError('عدد محاولات كبير، حاول بعد دقيقة.');
      } else {
        setError('تعذّر الاتصال بالخادم، حاول مرة أخرى.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const code = memberCode.trim();
    const ph = phone.trim();
    if (code.length < 2 || ph.length < 6) {
      setError('');
      setMatches(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      doLookup(code, ph);
    }, 800);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [memberCode, phone]);

  const confirmAcademy = (match) => {
    try {
      const prevSlug = localStorage.getItem('tenant_slug');
      // Switching to a different academy must drop any session cached for the
      // old one, otherwise the member portal would redirect into a stale
      // (wrong-tenant) dashboard and then hit 403s on every API call.
      if (prevSlug && prevSlug !== match.tenant_slug) {
        localStorage.removeItem('member_token');
        localStorage.removeItem('member_data');
        localStorage.removeItem('member_dashboard_cache_v1');
      }
      localStorage.setItem('tenant_slug', match.tenant_slug);
      localStorage.setItem('academy_confirmed', '1');
      localStorage.setItem('academy_display_name', match.academy_name || '');
      if (match.academy_logo) localStorage.setItem('academy_display_logo', match.academy_logo);
      // Carry the already-verified phone (scoped to the chosen tenant, which
      // we just stored above) so the member portal can log in directly.
      setRememberedMemberPhone(phone.trim());
    } catch (e) {}
    const next = new URLSearchParams(location.search).get('next') || '/member-login';
    navigate(next, { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4" dir="rtl">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 sm:p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
            <Trophy className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">{PLATFORM_NAME_AR}</h1>
          <p className="text-sm text-gray-500 mt-1">{PLATFORM_TAGLINE_AR}</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">رقم العضوية</label>
            <input
              type="text"
              value={memberCode}
              onChange={(e) => setMemberCode(e.target.value)}
              placeholder="مثلاً: ABTL-042"
              className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-base"
              autoComplete="off"
              data-testid="academy-picker-code"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">رقم الجوال</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="05XXXXXXXX"
              dir="ltr"
              className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-base text-right"
              autoComplete="off"
              data-testid="academy-picker-phone"
            />
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-600 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>جاري البحث عن أكاديميتك...</span>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {matches && matches.length > 1 && (
            <div className="space-y-2 pt-2">
              <p className="text-sm font-medium text-gray-700">وُجدت أكثر من أكاديمية، اختر واحدة:</p>
              {matches.map((m) => (
                <button
                  key={m.tenant_slug}
                  type="button"
                  onClick={() => confirmAcademy(m)}
                  className="w-full flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-primary hover:bg-primary/5 transition text-right"
                  data-testid={`academy-match-${m.tenant_slug}`}
                >
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {m.academy_logo ? (
                      <img src={m.academy_logo} alt="" className="w-full h-full object-contain" />
                    ) : (
                      <Building2 className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 text-sm truncate">{m.academy_name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {m.member_name}
                      {m.branch_name ? ` — ${m.branch_name}` : ''}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400 text-center mt-6">
          البيانات تُستخدم للتحقق فقط ولا تُحفظ على هذا الجهاز قبل التأكيد.
        </p>
      </div>
    </div>
  );
};

export default AcademyPickerPage;
