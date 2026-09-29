import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { invoicesAPI } from '../../../../services/api';
import { toast } from 'sonner';

const money = value => (Number(value) || 0).toFixed(2);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const balance = invoice => Math.max(0, Math.round(((invoice?.total || 0) - (invoice?.paid_amount || 0)) * 100) / 100);

export function InvoiceBalanceDialog({ invoice, open, onOpenChange, onChanged }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(invoice);
  const paymentId = useRef(null);
  useEffect(() => { setCurrent(invoice); setDueDate(invoice?.payment_due_date || ''); setAmount(''); paymentId.current = null; }, [invoice?.id, open]);
  if (!invoice) return null;
  const remaining = balance(current);
  const savePayment = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || Math.abs(Math.round(value * 100) - value * 100) > 1e-6 || value > remaining) {
      toast.error('أدخل مبلغًا صحيحًا لا يتجاوز المتبقي'); return;
    }
    if (!paymentId.current) paymentId.current = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    setBusy(true);
    try {
      if (Math.round(value * 100) === Math.round(remaining * 100)) {
        await invoicesAPI.payRemaining(invoice.id, { amount: value, method, reference, payment_id: paymentId.current });
        const latest = await invoicesAPI.getById(invoice.id);
        setCurrent(latest.data);
      } else {
        const result = await invoicesAPI.recordPayment(invoice.id, { amount: value, method, reference, due_date: dueDate || null, payment_id: paymentId.current });
        setCurrent(result.data.invoice);
      }
      paymentId.current = null; setAmount(''); setReference(''); toast.success('تم تسجيل الدفعة وتحديث الرصيد'); await onChanged();
    } catch (error) { toast.error(error.response?.data?.detail || 'تعذر تسجيل الدفعة؛ تحقق من الفاتورة قبل إعادة المحاولة'); }
    finally { setBusy(false); }
  };
  const saveFollowup = async () => {
    if (!note.trim()) { toast.error('أدخل ملاحظة المتابعة'); return; }
    setBusy(true);
    try { await invoicesAPI.recordPaymentFollowup(invoice.id, { note: note.trim(), due_date: dueDate || null });
      const latest = await invoicesAPI.getById(invoice.id); setCurrent(latest.data); setNote(''); toast.success('تم حفظ المتابعة'); await onChanged();
    } catch (error) { toast.error(error.response?.data?.detail || 'تعذر حفظ المتابعة'); }
    finally { setBusy(false); }
  };
  const printReceipt = row => {
    const page = window.open('', '_blank');
    if (!page) return toast.error('اسمح بفتح نافذة الطباعة');
    page.document.write(`<html dir="rtl"><meta charset="utf-8"><title>سند دفعة</title><style>body{font-family:Arial;padding:40px;max-width:650px;margin:auto;line-height:2}h1{color:#14345b}section{border:1px solid #ddd;border-radius:12px;padding:20px}</style><h1>أكاديمية أداء الأبطال — سند دفعة</h1><section><div>الفاتورة: ${escapeHtml(current.invoice_number || current.id)}</div><div>العميل: ${escapeHtml(current.customer_name_ar || current.member_name)}</div><div>المبلغ المستلم: ${money(row.amount)} ر.س</div><div>طريقة الدفع: ${escapeHtml(row.method)}</div><div>التاريخ: ${escapeHtml(new Date(row.created_at).toLocaleString('ar-SA'))}</div><div>المرجع: ${escapeHtml(row.reference || '—')}</div><div>سجلها: ${escapeHtml(row.created_by)}</div></section><script>window.onload=()=>window.print()</script></html>`);
    page.document.close();
  };
  const phone = String(current?.customer_phone || '').replace(/\D/g, '');
  const message = `مرحبًا، المتبقي على فاتورة أكاديمية أداء الأبطال رقم ${current?.invoice_number || ''} هو ${money(remaining)} ر.س${dueDate ? `، وموعد السداد ${dueDate}` : ''}.`;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" dir="rtl">
    <DialogHeader><DialogTitle>دفعات الفاتورة ومتابعة المتبقي</DialogTitle></DialogHeader>
    <div className="grid grid-cols-3 gap-2 text-center text-sm">
      <div className="rounded-xl bg-slate-50 p-3">الإجمالي<strong className="block">{money(current?.total)} ر.س</strong></div>
      <div className="rounded-xl bg-emerald-50 p-3">المدفوع<strong className="block text-emerald-700">{money(current?.paid_amount)} ر.س</strong></div>
      <div className="rounded-xl bg-amber-50 p-3">المتبقي<strong className="block text-amber-700">{money(remaining)} ر.س</strong></div>
    </div>
    {remaining > 0 && <div className="space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">تسجيل دفعة جديدة</h3>
      <div className="grid grid-cols-2 gap-3"><div><Label>المبلغ المستلم</Label><Input type="number" min="0.01" max={remaining} step="0.01" value={amount} onChange={e => { setAmount(e.target.value); paymentId.current = null; }} /></div><div><Label>طريقة الدفع</Label><select className="w-full rounded-md border p-2" value={method} onChange={e => setMethod(e.target.value)}><option value="cash">نقدي</option><option value="card">بطاقة</option><option value="transfer">تحويل</option></select></div></div>
      <div><Label>رقم العملية أو المرجع (اختياري)</Label><Input value={reference} onChange={e => setReference(e.target.value)} /></div>
      <Button disabled={busy} onClick={savePayment}>تسجيل الدفعة</Button>
    </div>}
    <div className="space-y-2 rounded-xl border p-4"><h3 className="font-semibold">متابعة المبلغ المتبقي</h3><Label>موعد السداد</Label><Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /><Label>ملاحظة أو وعد بالسداد</Label><Input value={note} onChange={e => setNote(e.target.value)} placeholder="مثال: تم الاتصال ووعد بالسداد الخميس" /><div className="flex gap-2"><Button variant="outline" disabled={busy || remaining === 0} onClick={saveFollowup}>حفظ المتابعة</Button>{phone && remaining > 0 && <a className="rounded-md border px-3 py-2 text-sm text-emerald-700" href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">فتح واتساب للتذكير</a>}</div><p className="text-xs text-muted-foreground">فتح واتساب لا يسجل إرسالًا مؤكدًا. سجّل نتيجة التواصل في الملاحظة.</p></div>
    <div className="space-y-2"><h3 className="font-semibold">سجل الدفعات</h3>{!(current?.payment_records || []).length && <p className="text-sm text-muted-foreground">لم تُسجل دفعات بعد.</p>}{(current?.payment_records || []).slice().reverse().map(row => <div key={row.id} className="flex items-center justify-between rounded-lg border p-2 text-sm"><span>{money(row.amount)} ر.س · {new Date(row.created_at).toLocaleDateString('ar-SA')} · {row.created_by}</span><Button size="sm" variant="outline" onClick={() => printReceipt(row)}>طباعة سند</Button></div>)}</div>
    {!!current?.payment_followups?.length && <div className="space-y-1 text-sm"><h3 className="font-semibold">سجل المتابعة</h3>{current.payment_followups.slice().reverse().map((row, i) => <p key={i} className="rounded bg-slate-50 p-2">{row.note} — {row.actor} · {new Date(row.at).toLocaleString('ar-SA')}</p>)}</div>}
  </DialogContent></Dialog>;
}
