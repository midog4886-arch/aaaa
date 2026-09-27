import React, { useState } from 'react';
import { registrationRequestsAPI } from '../services/api';
import { toast } from 'sonner';

export default function RegistrationManagement({ request, assignees, onChanged }) {
  const [assignee, setAssignee] = useState(request.assignee_id || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await registrationRequestsAPI.manage(request.id, { assignee_id: assignee || null, expected_assignee_id: request.assignee_id || null, note });
      setNote(''); toast.success('تم حفظ المسؤول والملاحظات'); await onChanged();
    } catch (error) { toast.error(error.response?.data?.detail || 'تعذّر الحفظ'); }
    finally { setBusy(false); }
  };
  return <div className="mt-3 space-y-2 border-t pt-3 text-sm">
    <label className="block">الموظف المسؤول
      <select aria-label="الموظف المسؤول" value={assignee} disabled={busy} onChange={e => setAssignee(e.target.value)} className="m-2 rounded border p-2">
        <option value="">دون مسؤول</option>
        {assignees.filter(u => u.is_admin || (u.branch_ids || []).includes(request.branch_id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    </label>
    <textarea aria-label="ملاحظة داخلية" placeholder="ملاحظة داخلية عن التواصل" value={note} disabled={busy} onChange={e => setNote(e.target.value)} maxLength={2000} className="w-full rounded border p-2" />
    <button onClick={save} disabled={busy} className="rounded bg-emerald-600 px-4 py-2 text-white">{busy ? 'جارٍ الحفظ…' : 'حفظ المتابعة'}</button>
    <h4 className="font-semibold">سجل المتابعة</h4>
    {request.followup_first_sent_at && <p className="rounded bg-violet-50 p-2">أُرسلت المتابعة الأولى · {new Date(request.followup_first_sent_at).toLocaleString('ar-SA')}</p>}
    {request.followup_second_sent_at && <p className="rounded bg-violet-50 p-2">أُرسلت المتابعة الثانية · {new Date(request.followup_second_sent_at).toLocaleString('ar-SA')}</p>}
    {request.followup_automatic_sent_at && <p className="rounded bg-violet-50 p-2">آخر إرسال متابعة مؤكد · {new Date(request.followup_automatic_sent_at).toLocaleString('ar-SA')}</p>}
    {request.followup_staff_contacted_at && <p className="rounded bg-sky-50 p-2">تم تسجيل التواصل يدويًا · {new Date(request.followup_staff_contacted_at).toLocaleString('ar-SA')}</p>}
    {(request.staff_history || []).slice().reverse().map((event, i) => <p key={i} className="rounded bg-gray-50 p-2">{event.text} — {event.actor} · {new Date(event.at).toLocaleString('ar-SA')}</p>)}
    {!request.staff_history?.length && <p className="text-gray-500">لا توجد ملاحظات داخلية بعد.</p>}
  </div>;
}
