import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { membersAPI } from '../../services/api';
import { toast } from 'sonner';

export default function SessionTransferDialog({ member, activity, language, onClose, onComplete }) {
  const ar = language === 'ar';
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState([]);
  const [recipient, setRecipient] = useState('');
  const [sessions, setSessions] = useState('');
  const [reason, setReason] = useState('');
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (!search.trim()) { setOptions([]); return; }
      membersAPI.getAll({ search: search.trim(), branch_filter: member.branch_id, picker_only: true })
        .then(({ data }) => { if (active) setOptions(data.filter(m => m.id !== member.id && m.branch_id === member.branch_id)); })
        .catch(() => { if (active) setError(ar ? 'تعذر البحث عن المستلم' : 'Recipient search failed'); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [search, member.id, member.branch_id, ar]);
  const change = (setter, value) => { requestVersion.current += 1; setter(value); setReview(null); setError(''); };
  const submit = async (confirm) => {
    const version = requestVersion.current;
    setBusy(true); setError('');
    try {
      const { data } = await membersAPI.transferSessions(member.id, activity.activity_id, confirm ? 'confirm' : 'preview', {
        recipient_id: recipient, sessions: Number(sessions), reason: reason.trim(), ...(confirm ? { preview_token: review.preview_token } : {}),
      });
      if (confirm) { toast.success(ar ? 'تم نقل الحصص بنجاح' : 'Sessions transferred'); await onComplete(); }
      else if (version === requestVersion.current) setReview(data);
    } catch (e) {
      setReview(null);
      setError(typeof e.response?.data?.detail === 'string' ? e.response.data.detail : (ar ? 'تعذر النقل؛ راجع الرصيد وحاول مجددًا' : 'Transfer failed; review balances and retry'));
    } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir={ar ? 'rtl' : 'ltr'}>
      <DialogHeader><DialogTitle>{ar ? 'نقل حصص لمشترك آخر' : 'Transfer sessions to another member'}</DialogTitle>
        <DialogDescription>{ar ? 'اختر المستلم ثم راجع الرصيد قبل التأكيد.' : 'Choose a recipient and review balances before confirming.'}</DialogDescription>
      </DialogHeader>
      <p className="text-sm">{member.name_ar || member.name} — {activity.activity_name}</p>
      <p className="text-sm text-muted-foreground">{ar ? 'النقل داخل نفس الفرع. تبقى الفواتير والحضور السابق كما هما، ولا تتغير صلاحية الحصص.' : 'Same branch only. Past invoices and attendance remain unchanged; sessions keep their expiry.'}</p>
      <fieldset disabled={busy} className="space-y-3">
        <Label htmlFor="session-recipient-search">{ar ? 'ابحث عن المستلم بالاسم أو رقم العضوية أو الجوال' : 'Search recipient by name, member code or phone'}</Label>
        <Input id="session-recipient-search" value={search} onChange={e => { change(setSearch, e.target.value); setRecipient(''); }} />
        <Label htmlFor="session-recipient">{ar ? 'المشترك المستلم' : 'Recipient'}</Label>
        <select id="session-recipient" className="w-full border rounded-md p-2 bg-white" value={recipient} onChange={e => change(setRecipient, e.target.value)}>
          <option value="">{ar ? 'اختر المستلم' : 'Select recipient'}</option>
          {options.map(m => <option key={m.id} value={m.id}>{m.name_ar || m.name}</option>)}
        </select>
        <Label htmlFor="session-amount">{ar ? 'عدد الحصص' : 'Sessions'}</Label>
        <Input id="session-amount" type="number" min="1" step="1" value={sessions} onChange={e => change(setSessions, e.target.value)} />
        <Label htmlFor="session-reason">{ar ? 'سبب النقل' : 'Reason'}</Label>
        <Input id="session-reason" maxLength={500} value={reason} onChange={e => change(setReason, e.target.value)} />
      </fieldset>
      {error && <p role="alert" className="text-red-700 bg-red-50 p-3 rounded-md">{error}</p>}
      {review && <div className="bg-blue-50 border rounded-md p-3 space-y-2" data-testid="session-transfer-review">
        <p>{review.sender_name}: {review.sender_before} ← {review.sender_after}</p>
        <p>{review.recipient_name}: {review.recipient_before} ← {review.recipient_after}</p>
        <p>{ar ? 'الحصص المنقولة' : 'Transferred sessions'}: {review.sessions}</p>
        <p>{ar ? 'تاريخ انتهاء الحصص' : 'Expiry'}: {review.end_date}</p>
      </div>}
      <DialogFooter className="gap-2">
        <Button variant="outline" disabled={busy} onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</Button>
        <Button disabled={busy || !recipient || !Number.isInteger(Number(sessions)) || Number(sessions) < 1 || !reason.trim()} onClick={() => submit(Boolean(review))}>
          {busy ? (ar ? 'جارٍ المراجعة...' : 'Working...') : review ? (ar ? 'تأكيد نقل الحصص' : 'Confirm transfer') : (ar ? 'معاينة الرصيد قبل النقل' : 'Preview balances')}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
