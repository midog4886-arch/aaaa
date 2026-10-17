import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { MessageCircle, RefreshCcw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import './BranchWhatsAppStatus.css';

const LABELS = {
  connected: { ar: 'متصل', en: 'Connected' },
  disconnected: { ar: 'غير متصل', en: 'Disconnected' },
  unavailable: { ar: 'تعذر التحقق', en: 'Check unavailable' },
  unconfigured: { ar: 'غير مهيأ', en: 'Not configured' },
  disabled: { ar: 'معطل', en: 'Disabled' },
  ready: { ar: 'جاهز عبر Cloud API', en: 'Cloud API ready' },
};

export default function BranchWhatsAppStatus() {
  const { token, user } = useAuth();
  const { language } = useLanguage();
  const [branches, setBranches] = useState([]);
  const [checkedAt, setCheckedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async (signal) => {
    try {
      const { data } = await axios.get('/api/whatsapp/branch-provider/overview', { signal });
      if (signal?.aborted) return;
      setBranches(data.branches || []);
      setCheckedAt(data.checked_at || null);
      setError(false);
    } catch (err) {
      if (signal?.aborted || err?.code === 'ERR_CANCELED') return;
      setError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setBranches([]);
    refresh(controller.signal);
    const timer = window.setInterval(() => refresh(controller.signal), 60000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [refresh, token, user?.id]);

  return (
    <section className="branch-whatsapp-status" aria-label={language === 'ar' ? 'حالة واتساب الفروع' : 'Branch WhatsApp status'}>
      <div className="branch-whatsapp-status__header">
        <div className="branch-whatsapp-status__title"><MessageCircle size={19} aria-hidden="true" />
          <h2>{language === 'ar' ? 'حالة واتساب الفروع' : 'Branch WhatsApp status'}</h2>
        </div>
        <button type="button" onClick={() => refresh()} className="branch-whatsapp-status__refresh" aria-label={language === 'ar' ? 'تحديث حالة واتساب' : 'Refresh WhatsApp status'}>
          <RefreshCcw size={14} aria-hidden="true" /> {language === 'ar' ? 'تحديث' : 'Refresh'}
        </button>
      </div>
      {checkedAt && <p className="branch-whatsapp-status__time">{language === 'ar' ? 'آخر فحص:' : 'Last checked:'} {new Date(checkedAt).toLocaleTimeString(language === 'ar' ? 'ar-SA' : 'en-US', { hour: 'numeric', minute: '2-digit' })}</p>}
      {error && <p className="branch-whatsapp-status__notice" role="status">{language === 'ar' ? 'تعذر تحديث الحالات الآن. المعروض آخر نتيجة متاحة.' : 'Could not refresh. Showing the last available result.'}</p>}
      {loading && <p className="branch-whatsapp-status__notice">{language === 'ar' ? 'جارٍ فحص الاتصال…' : 'Checking connections…'}</p>}
      {!loading && !error && branches.length === 0 && <p className="branch-whatsapp-status__notice">{language === 'ar' ? 'لا توجد فروع متاحة.' : 'No branches available.'}</p>}
      {branches.length > 0 && <div className="branch-whatsapp-status__grid">
        {branches.map((branch) => {
          const state = LABELS[branch.state] ? branch.state : 'unavailable';
          return <div key={branch.branch_id} className="branch-whatsapp-status__branch">
            <span className="branch-whatsapp-status__name" title={branch.branch_name}>{branch.branch_name}</span>
            <span className={`branch-whatsapp-status__badge branch-whatsapp-status__badge--${state}`}>
              <span className="branch-whatsapp-status__dot" aria-hidden="true" />{LABELS[state][language === 'ar' ? 'ar' : 'en']}
            </span>
          </div>;
        })}
      </div>}
    </section>
  );
}
