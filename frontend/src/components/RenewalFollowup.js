import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
export default function RenewalFollowup({ memberId, language }) {
  const { selectedBranchId, user } = useAuth();
  const [open, setOpen] = useState(false), [record, setRecord] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const ar = language === 'ar';
  const generation = useRef(0);
  useEffect(() => { setOpen(false); setRecord(null); }, [memberId, selectedBranchId, user?.id]);
  useEffect(() => {
    generation.current += 1;
    if (!open) return;
    let active = true; setBusy(true); setError(false);
    axios.get(`/api/operations/renewals/${encodeURIComponent(memberId)}`).then(r => { if (active) setRecord({ status: 'pending', next_date: '', notes: '', ...r.data }); }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; generation.current += 1; };
  }, [open, memberId, selectedBranchId, user?.id]);
  const save = async () => {
    setBusy(true);
    const request = generation.current;
    try { const r = await axios.put(`/api/operations/renewals/${encodeURIComponent(memberId)}`, { status: record.status, next_date: record.next_date || null, notes: record.notes }); if (request === generation.current) { setRecord(r.data); toast.success(ar ? 'تم حفظ المتابعة' : 'Follow-up saved'); } }
    catch { if (request === generation.current) toast.error(ar ? 'تعذر الحفظ' : 'Save failed'); } finally { if (request === generation.current) setBusy(false); }
  };
  const statuses = [['pending','يحتاج تواصل','Needs contact'],['contacted','تم التواصل','Contacted'],['promised','وعد بالدفع','Promised payment'],['renewed','تم التجديد','Renewed'],['closed','أغلقت المتابعة','Closed']];
  return <div className="border-t pt-2" onClick={e => e.stopPropagation()}>
    <button type="button" className="text-primary text-sm" onClick={() => setOpen(!open)}>{ar ? 'متابعة التجديد' : 'Renewal follow-up'}</button>
    {open && <div className="space-y-2 mt-2">
      {busy && <p role="status">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>}
      {error && <p role="alert">{ar ? 'تعذر التحميل؛ أغلق وافتح للمحاولة.' : 'Could not load; close and reopen to retry.'}</p>}
      {record && !error && <>
        <label className="block text-xs">{ar ? 'حالة المتابعة' : 'Status'}<select className="w-full border rounded p-2 bg-background" value={record.status} onChange={e => setRecord({ ...record, status: e.target.value })}>{statuses.map(s => <option key={s[0]} value={s[0]}>{s[ar ? 1 : 2]}</option>)}</select></label>
        <label className="block text-xs">{ar ? 'موعد المتابعة القادم' : 'Next follow-up'}<input type="date" className="w-full border rounded p-2 bg-background" value={record.next_date || ''} onChange={e => setRecord({ ...record, next_date: e.target.value })} /></label>
        <label className="block text-xs">{ar ? 'ملاحظات' : 'Notes'}<textarea maxLength={2000} className="w-full border rounded p-2 bg-background" value={record.notes} onChange={e => setRecord({ ...record, notes: e.target.value })} /></label>
        {record.owner_name && <p className="text-xs">{ar ? 'مسؤول المتابعة: ' : 'Owner: '}{record.owner_name}</p>}
        <button type="button" disabled={busy} onClick={save} className="border rounded p-2 text-sm">{ar ? 'حفظ وإسناد المتابعة لي' : 'Save and assign to me'}</button>
        <p className="text-xs text-muted-foreground">{ar ? 'حالة المتابعة لا تغيّر الاشتراك أو الدفع.' : 'Follow-up does not change subscription or payment.'}</p>
      </>}
    </div>}
  </div>;
}
