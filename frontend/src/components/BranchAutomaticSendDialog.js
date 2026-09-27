import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { whatsappAPI, branchesAPI } from '../services/api';

export const normalizeRecipientPhone = value => {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('00')) phone = phone.slice(2);
  if (phone.startsWith('0')) phone = `966${phone.slice(1)}`;
  return /^\d{8,15}$/.test(phone) ? phone : '';
};

export async function branchReady(branchId) {
  let status = (await whatsappAPI.getBranchCloudAvailability(branchId)).data;
  if (['waha', 'whatsflow'].includes(status.provider)) {
    if (!status.enabled || !status.configured) return false;
    const live = (await branchesAPI.getProviderStatus(branchId)).data;
    return live.connected === true;
  }
  return status.provider === 'meta_cloud' && status.enabled && status.configured && status.template_configured;
}

async function attemptKey(fingerprint, keys) {
  if (keys.current.has(fingerprint)) return keys.current.get(fingerprint);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  const storageKey = `wa-inbox-attempt:${localStorage.getItem('tenant_slug') || 'default'}:${hash}`;
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* Memory key still prevents duplicate retries. */ }
  const valid = saved && typeof saved.key === 'string' && Date.now() - saved.createdAt < 86400000;
  const key = valid ? saved.key : `inbox-${crypto.randomUUID()}`;
  keys.current.set(fingerprint, key);
  try { sessionStorage.setItem(storageKey, JSON.stringify({ key, createdAt: valid ? saved.createdAt : Date.now() })); } catch { /* Storage can be disabled. */ }
  return key;
}

export default function BranchAutomaticSendDialog({ recipients, message, branches, language, attemptKeys, onClose, onQueued }) {
  const ar = language === 'ar';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    const grouped = new Map();
    let invalid = 0;
    recipients.forEach(member => {
      const phone = normalizeRecipientPhone(member.phone);
      if (!phone || !member.branch_id) { invalid += 1; return; }
      if (!grouped.has(member.branch_id)) grouped.set(member.branch_id, new Map());
      const group = grouped.get(member.branch_id);
      const existing = group.get(phone);
      if (existing) existing.memberIds.push(member.id);
      else group.set(phone, { phone, message: message.trim(), id: member.id, member_id: member.id,
        name: member.name_ar || member.name || '', memberIds: [member.id] });
    });
    const groups = Array.from(grouped, ([branchId, phones]) => ({ branchId, recipients: Array.from(phones.values()),
      name: (branches.find(b => b.id === branchId)?.name_ar || branches.find(b => b.id === branchId)?.name || branchId), queued: 0, uncertain: false }));
    Promise.all(groups.map(async row => {
      try { return { ...row, ready: Boolean(await branchReady(row.branchId)) }; }
      catch { return { ...row, ready: false }; }
    })).then(result => {
      if (active) { setRows(result); setLoading(false); if (invalid) setError(ar ? `${invalid} مستلم بدون رقم صالح أو فرع؛ لن يُرسل لهم.` : `${invalid} recipients have no valid phone or branch and will be excluded.`); }
    });
    return () => { active = false; };
  }, [recipients, message, branches, ar]);
  const send = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setDone(false);
    const next = rows.map(row => ({ ...row }));
    for (const row of next) {
      if (!row.ready || row.queued === row.recipients.length) continue;
      try {
        if (!await branchReady(row.branchId)) { row.ready = false; continue; }
        for (let offset = row.queued; offset < row.recipients.length; offset += 200) {
          const batch = row.recipients.slice(offset, offset + 200);
          const payload = batch.map(({ memberIds, ...recipient }) => recipient);
          const fingerprint = JSON.stringify([row.branchId, payload]);
          // Retain the key after timeouts: retrying the same payload reconciles
          // the existing job instead of creating a duplicate send.
          await whatsappAPI.sendBranchCloudBulk(row.branchId, payload, await attemptKey(fingerprint, attemptKeys), {
            campaign_title: ar ? 'رسالة من شاشة واتساب' : 'WhatsApp message', branch_name: row.name,
          });
          row.queued = offset + batch.length; row.uncertain = false;
          onQueued(batch.flatMap(recipient => recipient.memberIds));
        }
      } catch { row.uncertain = true; }
    }
    setRows(next); setBusy(false); setDone(true); lock.current = false;
  };
  const available = rows.some(row => row.ready && row.queued < row.recipients.length);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" dir={ar ? 'rtl' : 'ltr'}>
      <DialogHeader><DialogTitle>{ar ? 'إرسال تلقائي من الفروع المتصلة' : 'Send automatically from connected branches'}</DialogTitle>
        <DialogDescription>{ar ? 'كل رسالة تُرسل من رقم فرع المستلم. الأرقام المتكررة داخل الفرع تستقبل رسالة واحدة.' : 'Each message uses the recipient’s branch number. Shared numbers in a branch receive one message.'}</DialogDescription></DialogHeader>
      <p className="whitespace-pre-wrap rounded-md border p-3 text-sm">{message}</p>
      {loading ? <p>{ar ? 'جارٍ التحقق من اتصال الفروع...' : 'Checking branch connections...'}</p> : rows.map(row => <div key={row.branchId} className="rounded-md border p-3 space-y-1 text-sm">
        <p className="font-semibold">{row.name} — {row.recipients.length} {ar ? 'رقم' : 'numbers'}</p>
        <p>{row.ready ? (ar ? 'متصل — جاهز للإرسال التلقائي' : 'Connected — ready') : (ar ? 'غير متصل أو غير مهيأ — لن يُرسل تلقائيًا' : 'Disconnected or unconfigured — excluded')}</p>
        {row.queued > 0 && <p className="text-green-700">{ar ? 'أضيف لقائمة الإرسال' : 'Queued'}: {row.queued}</p>}
        {row.uncertain && <p role="alert" className="text-amber-800">{ar ? 'تعذر تأكيد الإضافة. أعد التحقق بنفس المحاولة؛ لن تُنشأ قائمة مكررة.' : 'Enqueue could not be confirmed. Retry reconciles the same job.'}</p>}
      </div>)}
      {error && <p className="text-amber-800 text-sm">{error}</p>}
      <p className="text-sm text-muted-foreground">{ar ? 'تُرسل الرسائل تباعًا وفق حدود الفرع. الإضافة للقائمة لا تعني التسليم، ولن يُفتح واتساب يدويًا.' : 'Messages are dispatched in order within branch limits. Queued does not mean delivered.'}</p>
      {done && <a href="/admin/whatsapp-bulk" className="text-blue-700 underline">{ar ? 'متابعة قوائم الإرسال' : 'View sending queues'}</a>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={onClose}>{ar ? 'إغلاق' : 'Close'}</Button>
        <Button disabled={loading || busy || !available || message.trim().length > 4096} onClick={send}>
          {busy ? (ar ? 'جارٍ الإضافة...' : 'Queuing...') : rows.some(r => r.uncertain) ? (ar ? 'إعادة التحقق بنفس المحاولة' : 'Reconcile same attempt') : (ar ? 'تأكيد الإرسال من الفروع المتصلة' : 'Confirm connected branches')}
        </Button>
      </div>
    </DialogContent>
  </Dialog>;
}
