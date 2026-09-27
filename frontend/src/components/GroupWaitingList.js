import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
export default function GroupWaitingList() {
  const { selectedBranchId, user } = useAuth(), { language } = useLanguage();
  const ar = language === 'ar';
  const [open, setOpen] = useState(false), [groups, setGroups] = useState([]), [selected, setSelected] = useState(''), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const generation = useRef(0);
  const load = async () => {
    const request = ++generation.current; setBusy(true); setError(false);
    try { const r = await axios.get('/api/operations/groups', { params: selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {} }); if (request === generation.current) setGroups(r.data); }
    catch { if (request === generation.current) setError(true); } finally { if (request === generation.current) setBusy(false); }
  };
  useEffect(() => { setGroups([]); setSelected(''); setCode(''); if (open) load(); return () => { generation.current += 1; }; }, [open, selectedBranchId, user?.id]);
  const group = groups.find(g => g.id === selected);
  const mutate = async id => {
    const request = generation.current;
    setBusy(true);
    try { const path = `/api/operations/groups/${encodeURIComponent(selected)}/waiting`; if (id) await axios.delete(`${path}/${encodeURIComponent(id)}`); else await axios.post(path, { member_id: code.trim() }); if (request === generation.current) { setCode(''); await load(); } }
    catch (e) { if (request === generation.current) toast.error(typeof e.response?.data?.detail === 'string' ? e.response.data.detail : (ar ? 'تعذر تحديث الانتظار' : 'Update failed')); } finally { if (request === generation.current) setBusy(false); }
  };
  return <section className="border rounded-xl p-4 mb-5 bg-card">
    <button type="button" className="font-semibold text-primary" onClick={() => setOpen(!open)}>{ar ? 'سعة المجموعات وقوائم الانتظار' : 'Group capacity & waiting lists'}</button>
    {open && <div className="space-y-3 mt-3">
      <p className="text-xs text-muted-foreground">{ar ? 'السعة تشمل إجمالي الأعضاء المرتبطين بالمجموعة دون تصفية حسب يوم التدريب.' : 'Capacity counts all linked members, without a training-day filter.'}</p>
      {busy && <p role="status">{ar ? 'جارٍ التحديث…' : 'Updating…'}</p>}
      {error && <button type="button" onClick={load}>{ar ? 'تعذر التحميل — إعادة المحاولة' : 'Could not load — Retry'}</button>}
      <select aria-label={ar ? 'المجموعة' : 'Group'} className="w-full border rounded p-2 bg-background" value={selected} onChange={e => setSelected(e.target.value)}><option value="">{ar ? 'اختر مجموعة' : 'Select group'}</option>{groups.map(g => <option key={g.id} value={g.id}>{g.custom_name || g.activity_name} — {g.level_number} — {g.time_slot || ''} — {g.used}/{g.capacity} — {ar ? 'انتظار' : 'waiting'}: {g.waiting_list?.length || 0}</option>)}</select>
      {!busy && !error && !groups.length && <p>{ar ? 'لا توجد مجموعات.' : 'No groups.'}</p>}
      {group && <>
        <p className={group.full ? 'text-amber-700' : 'text-green-700'}>{ar ? `الأماكن المتاحة: ${group.available} | المسجلون: ${group.used}/${group.capacity}` : `Available: ${group.available} | Enrolled: ${group.used}/${group.capacity}`}</p>
        {group.available > 0 && group.waiting_list?.length > 0 && <p>{ar ? 'توجد أماكن متاحة؛ راجع أقدم طلبات الانتظار.' : 'Places available; review the oldest waiting requests.'}</p>}
        <div className="flex gap-2"><input aria-label={ar ? 'رقم العضوية' : 'Member code'} placeholder={ar ? 'رقم العضوية' : 'Member code'} className="border rounded p-2 min-w-0 flex-1 bg-background" value={code} onChange={e => setCode(e.target.value)} /><button type="button" disabled={busy || !code.trim()} onClick={() => mutate()}>{ar ? 'إضافة للانتظار' : 'Add to waiting list'}</button></div>
        <ol>{(group.waiting_list || []).map((entry, i) => <li key={entry.member_id} className="flex justify-between border rounded p-2 mt-2 text-sm"><span>{i + 1}. {entry.name} — {new Date(entry.created_at).toLocaleDateString(ar ? 'ar-SA' : 'en-GB')}</span><button type="button" disabled={busy} onClick={() => mutate(entry.member_id)}>{ar ? 'إزالة' : 'Remove'}</button></li>)}</ol>
        <p className="text-xs text-muted-foreground">{ar ? 'راجع الموعد والاشتراك ثم سجّل العضو بأدوات المجموعة المعتادة وأزله من الانتظار.' : 'Check schedule and subscription, enroll using the existing group tools, then remove from waiting.'}</p>
      </>}
    </div>}
  </section>;
}
