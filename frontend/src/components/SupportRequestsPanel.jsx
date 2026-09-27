import React, { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';

const BASE = '/api/member-portal/support-requests';
const statuses = { open: 'جديد', in_progress: 'قيد المعالجة', resolved: 'تم الحل', closed: 'مغلق' };
const requestUuid = () => {
  if (window.crypto.randomUUID) return window.crypto.randomUUID();
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

function RequestRow({ ticket, staff, api, onSaved }) {
  const [status, setStatus] = useState(ticket.status);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const actionId = useRef(null);
  const save = async () => {
    setBusy(true); setError('');
    try {
      actionId.current = actionId.current || requestUuid();
      const res = await api.patch(`${BASE}/admin/${ticket.id}`, { status, reply, request_id: actionId.current }, { timeout: 15000 });
      setReply(''); actionId.current = null; onSaved(res.data);
    } catch { setError('تعذّر حفظ الرد. حاول مرة أخرى.'); }
    finally { setBusy(false); }
  };
  return <article className="rounded-xl border p-4 space-y-3" data-testid="support-request">
    <div className="flex flex-wrap justify-between gap-2"><strong dir="ltr">{ticket.number}</strong><span className="rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-900">{statuses[ticket.status]}</span></div>
    <h3 className="font-bold">{ticket.subject}</h3>
    {staff && <p className="text-sm">العضو: {ticket.member_name}</p>}
    <p className="whitespace-pre-wrap break-words">{ticket.body}</p>
    <p className="text-xs opacity-70">آخر تحديث: {new Date(ticket.updated_at).toLocaleString('ar-SA')}</p>
    {(ticket.messages || []).map(message => <div key={message.id} className="rounded-lg bg-blue-50 p-3 text-blue-950"><strong>رد الدعم</strong><p className="whitespace-pre-wrap break-words">{message.body}</p><small>{new Date(message.created_at).toLocaleString('ar-SA')}</small></div>)}
    {staff && <div className="space-y-2">
      <label className="block">حالة الطلب<select aria-label={`حالة ${ticket.number}`} className="block w-full rounded border bg-background p-2" value={status} onChange={e => { setStatus(e.target.value); actionId.current = null; }} disabled={busy}>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <textarea aria-label={`رد ${ticket.number}`} className="w-full rounded border bg-background p-3" rows={3} maxLength={4000} value={reply} onChange={e => { setReply(e.target.value); actionId.current = null; }} disabled={busy} placeholder="رد على العضو" />
      <Button onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الحالة والرد'}</Button>
    </div>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
  </article>;
}

export default function SupportRequestsPanel({ api, staff = false }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [filter, setFilter] = useState('all');
  const [success, setSuccess] = useState('');
  const requestId = useRef(null);
  const refresh = async () => {
    setLoading(true); setError('');
    try { const res = await api.get(BASE + (staff ? '/admin' : ''), { timeout: 15000 }); setTickets(res.data); }
    catch { setError('تعذّر تحميل الطلبات. تحقق من الاتصال ثم أعد المحاولة.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, [api, staff]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async e => {
    e.preventDefault(); setError(''); setSuccess('');
    if (subject.trim().length < 3 || body.trim().length < 5) { setError('اكتب عنوانًا ووصفًا واضحًا للطلب'); return; }
    setBusy(true);
    try {
      requestId.current = requestId.current || requestUuid();
      const res = await api.post(BASE, { subject: subject.trim(), body: body.trim(), request_id: requestId.current }, { timeout: 15000 });
      setTickets(previous => [res.data, ...previous.filter(row => row.id !== res.data.id)]);
      setSuccess(`تم إرسال طلبك، رقم المتابعة: ${res.data.number}`);
      setSubject(''); setBody(''); requestId.current = null;
    } catch { setError('تعذّر إرسال الطلب. بياناتك محفوظة في الحقول؛ حاول مرة أخرى.'); }
    finally { setBusy(false); }
  };
  return <section className="rounded-xl border bg-background p-4 space-y-4" dir="rtl">
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">{staff ? 'طلبات دعم الأعضاء' : 'طلبات الدعم والمتابعة'}</h2><Button variant="outline" onClick={refresh} disabled={loading}>تحديث الطلبات</Button></div>
    {!staff && <form onSubmit={submit} className="space-y-3">
      <label className="block">عنوان الطلب<Input value={subject} maxLength={160} disabled={busy} onChange={e => { setSubject(e.target.value); requestId.current = null; }} /></label>
      <label className="block">وصف المشكلة<textarea className="block w-full rounded-lg border bg-background p-3" value={body} rows={4} maxLength={4000} disabled={busy} onChange={e => { setBody(e.target.value); requestId.current = null; }} /></label>
      <Button disabled={busy} type="submit">{busy ? 'جارٍ الإرسال…' : 'إرسال طلب دعم'}</Button>
    </form>}
    {success && <p role="status" className="text-green-700">{success}</p>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <label className="block">عرض الطلبات<select className="ms-2 rounded border bg-background p-2" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">كل الحالات</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    {loading ? <p>جارٍ تحميل الطلبات…</p> : !tickets.length && !error ? <p>لا توجد طلبات دعم بعد.</p> : tickets.filter(ticket => filter === 'all' || ticket.status === filter).map(ticket => <RequestRow key={ticket.id} ticket={ticket} api={api} staff={staff} onSaved={saved => setTickets(previous => previous.map(row => row.id === saved.id ? saved : row))} />)}
  </section>;
}
