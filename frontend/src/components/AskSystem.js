import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpLeft, Search, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { askSystemAPI } from '../services/api';
import { pageFor } from './DailyActions';

const EXAMPLES = [
  'كم اشتراكًا يحتاج تجديدًا خلال 7 أيام؟',
  'من يحتاج متابعة بسبب الغياب؟',
  'كم طلب تسجيل ينتظر المراجعة؟',
  'كم محادثة تحتاج ردًا؟',
  'كم محادثة غير مقروءة؟',
  'كم عملية إرسال أو دفع فشلت؟',
];

export default function AskSystem() {
  const { selectedBranchId, user, token, switchBranch } = useAuth();
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  // A response from a former account or branch must never remain visible.
  const scope = `${token || user?.id || 'current'}:${selectedBranchId || 'all'}`;
  useEffect(() => {
    setResult(null);
    setError('');
    setLoading(false);
    requestRef.current += 1;
  }, [scope]);

  const ask = async (text = question) => {
    const clean = text.trim();
    if (clean.length < 3) return;
    setQuestion(clean);
    setResult(null);
    setError('');
    setLoading(true);
    const requestVersion = ++requestRef.current;
    try {
      const response = await askSystemAPI.ask(clean, selectedBranchId);
      if (requestVersion === requestRef.current) setResult(response.data);
    } catch (err) {
      if (requestVersion === requestRef.current) setError(err?.response?.data?.detail || 'تعذر الحصول على الإجابة الآن. حاول مرة أخرى.');
    } finally {
      if (requestVersion === requestRef.current) setLoading(false);
    }
  };

  const openItem = item => {
    if (item.branch_id && selectedBranchId === 'all' && typeof switchBranch === 'function') switchBranch(item.branch_id);
    window.location.assign(pageFor(result.key, item));
  };

  return <section className="rounded-2xl border bg-white p-5 shadow-sm" dir="rtl" aria-labelledby="ask-system-title">
    <div className="flex items-center gap-2 mb-1"><Sparkles size={18} className="text-violet-600" /><h2 id="ask-system-title" className="font-bold text-lg">اسأل النظام</h2></div>
    <p className="text-sm text-muted-foreground mb-4">اسأل عن الإجراءات اليومية؛ الإجابة تُحسب من بيانات فرعك وصلاحياتك.</p>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); ask(); }}>
      <label htmlFor="ask-system-question" className="sr-only">سؤالك للنظام</label>
      <input id="ask-system-question" className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" value={question} onChange={event => setQuestion(event.target.value)} placeholder="مثال: كم محادثة تحتاج ردًا؟" maxLength={300} />
      <button type="submit" disabled={loading || question.trim().length < 3} className="rounded-lg bg-violet-700 px-4 py-2 text-white text-sm disabled:opacity-50 flex items-center gap-2"><Search size={15} />{loading ? 'جارٍ الحساب...' : 'اسأل'}</button>
    </form>
    <div className="flex flex-wrap gap-2 mt-3" aria-label="أسئلة مقترحة">{EXAMPLES.map(example => <button key={example} type="button" onClick={() => ask(example)} disabled={loading} className="rounded-full border px-3 py-1 text-xs text-slate-700 hover:bg-violet-50 disabled:opacity-50">{example}</button>)}</div>
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    {result && <div role="status" className="mt-4 rounded-xl border border-violet-100 bg-violet-50/50 p-4">
      {!result.supported ? <p className="text-sm">{result.message}</p> : <>
        <strong className="text-2xl text-violet-900">{result.answer}</strong>
        <p className="text-sm mt-2">{result.definition}</p>
        <p className="text-xs text-muted-foreground mt-2">تاريخ الحساب: {result.date || 'غير متاح'} · النتائج ضمن صلاحياتك والفرع المحدد</p>
        {result.items?.length > 0 && <div className="mt-3 space-y-2 max-h-72 overflow-y-auto">{result.items.map((item, index) => <div key={item.id || index} className="rounded-lg border bg-white p-2 flex items-center justify-between gap-2"><div className="min-w-0"><strong className="text-sm block">{item.title}</strong><span className="text-xs text-muted-foreground">{item.detail}</span></div><button type="button" onClick={() => openItem(item)} className="shrink-0 text-xs text-violet-800 flex items-center gap-1" aria-label={`فتح ${item.title}`}><ArrowUpLeft size={13} />فتح</button></div>)}</div>}
        {result.has_more && <p className="text-xs text-muted-foreground mt-2">تظهر هنا عينة مختصرة من النتائج.</p>}
      </>}
    </div>}
  </section>;
}
