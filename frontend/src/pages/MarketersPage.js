import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { marketersAPI, branchesAPI } from '../services/api';
import { getPublicBaseUrl } from '../utils/publicUrl';
import { toast } from 'sonner';
import {
  Loader2, Plus, Pencil, Trash2, Copy, Link2, Megaphone, Phone, Percent,
  BadgeDollarSign, Wallet, Users, ChevronDown, ChevronUp, Receipt,
} from 'lucide-react';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'نقداً' },
  { value: 'transfer', label: 'تحويل بنكي' },
  { value: 'check', label: 'شيك' },
];

const emptyForm = { name: '', phone: '', referral_code: '', discount_percent: '', commission_percent: '', branch_id: '', notes: '' };

export const MarketersPage = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isAdmin = user?.is_admin;

  const tenantSlug = (() => { try { return localStorage.getItem('tenant_slug') || 'default'; } catch { return 'default'; } })();

  const [loading, setLoading] = useState(true);
  const [marketers, setMarketers] = useState([]);
  const [branches, setBranches] = useState([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // Per-marketer expanded commission report
  const [expandedId, setExpandedId] = useState(null);
  const [commissions, setCommissions] = useState([]);
  const [loadingCommissions, setLoadingCommissions] = useState(false);
  const [linkBranchByMarketer, setLinkBranchByMarketer] = useState({});

  // Payout dialog
  const [payoutMarketer, setPayoutMarketer] = useState(null);
  const [payoutForm, setPayoutForm] = useState({ payment_method: 'cash', payment_date: '', reference: '', notes: '' });
  const [payingOut, setPayingOut] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [mRes, bRes] = await Promise.all([
        marketersAPI.getAll(),
        branchesAPI.getAll().catch(() => ({ data: [] })),
      ]);
      setMarketers(mRes.data || []);
      setBranches(bRes.data || []);
    } catch (e) {
      toast.error('تعذّر تحميل المسوّقين');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const branchName = (id) => {
    if (!id) return 'كل الفروع';
    const b = branches.find(x => x.id === id);
    return b ? (b.name_ar || b.name) : '—';
  };

  const openCreate = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (m) => {
    setEditing(m);
    setForm({
      name: m.name || '',
      phone: m.phone || '',
      referral_code: m.referral_code || '',
      discount_percent: m.discount_percent ?? '',
      commission_percent: m.commission_percent ?? '',
      branch_id: m.branch_id || '',
      notes: m.notes || '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('اسم المسوّق مطلوب'); return; }
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      referral_code: (form.referral_code || '').trim(),
      discount_percent: parseFloat(form.discount_percent) || 0,
      commission_percent: parseFloat(form.commission_percent) || 0,
      notes: form.notes.trim(),
    };
    if (isAdmin) payload.branch_id = form.branch_id || null;
    setSaving(true);
    try {
      if (editing) {
        await marketersAPI.update(editing.id, payload);
        toast.success('تم تحديث المسوّق');
      } else {
        await marketersAPI.create(payload);
        toast.success('تم إضافة المسوّق');
      }
      setDialogOpen(false);
      await loadData();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'تعذّر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (m) => {
    if (!window.confirm(`حذف المسوّق "${m.name}"؟ لن يتم حذف العمولات المسجّلة.`)) return;
    try {
      await marketersAPI.delete(m.id);
      setMarketers(prev => prev.filter(x => x.id !== m.id));
      toast.success('تم حذف المسوّق');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'تعذّر الحذف');
    }
  };

  const toggleStatus = async (m) => {
    try {
      const newStatus = m.status === 'inactive' ? 'active' : 'inactive';
      await marketersAPI.update(m.id, { status: newStatus });
      setMarketers(prev => prev.map(x => x.id === m.id ? { ...x, status: newStatus } : x));
      toast.success(newStatus === 'active' ? 'تم التفعيل' : 'تم الإيقاف');
    } catch (e) {
      toast.error('تعذّر تغيير الحالة');
    }
  };

  const referralLink = (m) => {
    const branchForLink = m.branch_id || linkBranchByMarketer[m.id] || (branches.length === 1 ? branches[0].id : '');
    if (!branchForLink) return '';
    return `${getPublicBaseUrl()}/register/${tenantSlug}/${branchForLink}?ref=${encodeURIComponent(m.referral_code)}`;
  };

  const copyText = async (text, okMsg) => {
    if (!text) { toast.error('اختر الفرع أولاً'); return; }
    try { await navigator.clipboard.writeText(text); toast.success(okMsg); }
    catch { toast.error('تعذّر النسخ'); }
  };

  const toggleExpand = async (m) => {
    if (expandedId === m.id) { setExpandedId(null); return; }
    setExpandedId(m.id);
    setLoadingCommissions(true);
    setCommissions([]);
    try {
      const res = await marketersAPI.commissions(m.id);
      setCommissions(res.data || []);
    } catch (e) {
      toast.error('تعذّر تحميل العمولات');
    } finally {
      setLoadingCommissions(false);
    }
  };

  const openPayout = (m) => {
    if ((m.due_amount || 0) <= 0) { toast.error('لا توجد عمولات مستحقة للصرف'); return; }
    setPayoutMarketer(m);
    setPayoutForm({ payment_method: 'cash', payment_date: new Date().toISOString().split('T')[0], reference: '', notes: '' });
  };

  const handlePayout = async () => {
    if (!payoutMarketer) return;
    setPayingOut(true);
    try {
      const res = await marketersAPI.payout(payoutMarketer.id, payoutForm);
      toast.success(`تم صرف ${res.data.paid_amount} ر.س — سند رقم ${res.data.voucher?.voucher_number || ''}`);
      setPayoutMarketer(null);
      await loadData();
      if (expandedId === payoutMarketer.id) {
        const cRes = await marketersAPI.commissions(payoutMarketer.id);
        setCommissions(cRes.data || []);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'تعذّر صرف العمولة');
    } finally {
      setPayingOut(false);
    }
  };

  const totals = useMemo(() => marketers.reduce((acc, m) => {
    acc.due += m.due_amount || 0;
    acc.paid += m.paid_amount || 0;
    acc.referrals += m.referrals || 0;
    return acc;
  }, { due: 0, paid: 0, referrals: 0 }), [marketers]);

  return (
    <Layout title={t('marketers')}>
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5" dir="rtl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Megaphone className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">المسوّقون بالعمولة</h1>
              <p className="text-sm text-muted-foreground">إدارة المسوّقين وروابط الإحالة والعمولات</p>
            </div>
          </div>
          <Button onClick={openCreate} data-testid="button-add-marketer">
            <Plus className="w-4 h-4 ms-1" /> إضافة مسوّق
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card><CardContent className="p-4 flex items-center gap-3">
            <Users className="w-8 h-8 text-blue-500" />
            <div><p className="text-2xl font-bold">{totals.referrals}</p><p className="text-xs text-muted-foreground">إجمالي الإحالات</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <Wallet className="w-8 h-8 text-amber-500" />
            <div><p className="text-2xl font-bold">{totals.due.toFixed(2)}</p><p className="text-xs text-muted-foreground">عمولات مستحقة (ر.س)</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <BadgeDollarSign className="w-8 h-8 text-emerald-500" />
            <div><p className="text-2xl font-bold">{totals.paid.toFixed(2)}</p><p className="text-xs text-muted-foreground">عمولات مدفوعة (ر.س)</p></div>
          </CardContent></Card>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : marketers.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground">
            <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>لا يوجد مسوّقون بعد. أضف مسوّقاً للبدء.</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {marketers.map((m) => (
              <Card key={m.id} data-testid={`card-marketer-${m.id}`}>
                <CardContent className="p-4">
                  <div className="flex flex-col lg:flex-row lg:items-start gap-4 justify-between">
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-lg">{m.name}</h3>
                        <Badge variant={m.status === 'inactive' ? 'secondary' : 'default'}>
                          {m.status === 'inactive' ? 'موقوف' : 'نشط'}
                        </Badge>
                        <Badge variant="outline" className="font-mono">{m.referral_code}</Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                        {m.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {m.phone}</span>}
                        <span className="flex items-center gap-1"><Percent className="w-3.5 h-3.5" /> خصم {m.discount_percent}%</span>
                        <span className="flex items-center gap-1"><BadgeDollarSign className="w-3.5 h-3.5" /> عمولة {m.commission_percent}%</span>
                        <span>الفرع: {branchName(m.branch_id)}</span>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
                        <span className="text-blue-600">إحالات: {m.referrals || 0}</span>
                        <span className="text-amber-600">مستحق: {(m.due_amount || 0).toFixed(2)} ر.س</span>
                        <span className="text-emerald-600">مدفوع: {(m.paid_amount || 0).toFixed(2)} ر.س</span>
                      </div>

                      {/* Referral link */}
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        {!m.branch_id && branches.length > 1 && (
                          <Select value={linkBranchByMarketer[m.id] || ''} onValueChange={(v) => setLinkBranchByMarketer(prev => ({ ...prev, [m.id]: v }))}>
                            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="اختر فرع للرابط" /></SelectTrigger>
                            <SelectContent>
                              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                        <Button variant="outline" size="sm" onClick={() => copyText(m.referral_code, 'تم نسخ كود الإحالة')}>
                          <Copy className="w-3.5 h-3.5 ms-1" /> نسخ الكود
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => copyText(referralLink(m), 'تم نسخ رابط الإحالة')}>
                          <Link2 className="w-3.5 h-3.5 ms-1" /> نسخ رابط التسجيل
                        </Button>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button variant="outline" size="sm" onClick={() => toggleExpand(m)} data-testid={`button-report-${m.id}`}>
                        <Receipt className="w-3.5 h-3.5 ms-1" /> العمولات
                        {expandedId === m.id ? <ChevronUp className="w-3.5 h-3.5 ms-1" /> : <ChevronDown className="w-3.5 h-3.5 ms-1" />}
                      </Button>
                      <Button variant="default" size="sm" disabled={(m.due_amount || 0) <= 0} onClick={() => openPayout(m)} data-testid={`button-payout-${m.id}`}>
                        <Wallet className="w-3.5 h-3.5 ms-1" /> صرف عمولة
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleStatus(m)}>
                        {m.status === 'inactive' ? 'تفعيل' : 'إيقاف'}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(m)}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(m)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                    </div>
                  </div>

                  {/* Commission report */}
                  {expandedId === m.id && (
                    <div className="mt-4 border-t pt-3">
                      {loadingCommissions ? (
                        <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
                      ) : commissions.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">لا توجد عمولات مسجّلة لهذا المسوّق بعد.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-muted-foreground border-b">
                                <th className="text-start py-2 font-medium">العضو</th>
                                <th className="text-start py-2 font-medium">رقم الفاتورة</th>
                                <th className="text-start py-2 font-medium">الأساس</th>
                                <th className="text-start py-2 font-medium">النسبة</th>
                                <th className="text-start py-2 font-medium">العمولة</th>
                                <th className="text-start py-2 font-medium">الحالة</th>
                              </tr>
                            </thead>
                            <tbody>
                              {commissions.map((c) => (
                                <tr key={c.id} className="border-b last:border-0">
                                  <td className="py-2">{c.member_name || '—'}</td>
                                  <td className="py-2 font-mono text-xs">{c.invoice_number || '—'}</td>
                                  <td className="py-2">{(c.base_amount || 0).toFixed(2)}</td>
                                  <td className="py-2">{c.commission_percent}%</td>
                                  <td className="py-2 font-semibold">{(c.commission_amount || 0).toFixed(2)}</td>
                                  <td className="py-2">
                                    <Badge variant={c.status === 'paid' ? 'default' : 'secondary'}>
                                      {c.status === 'paid' ? `مدفوع (${c.voucher_number || ''})` : 'مستحق'}
                                    </Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? 'تعديل المسوّق' : 'إضافة مسوّق جديد'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>اسم المسوّق *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="الاسم" data-testid="input-marketer-name" />
            </div>
            <div className="space-y-1.5">
              <Label>رقم الجوال</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="05xxxxxxxx" dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label>كود الإحالة</Label>
              <Input
                value={form.referral_code}
                onChange={(e) => setForm({ ...form, referral_code: e.target.value.toUpperCase() })}
                placeholder={editing ? '' : 'يُولّد تلقائيًا إذا تُرك فارغاً'}
                dir="ltr"
                className="font-mono uppercase"
                data-testid="input-marketer-referral-code"
              />
              <p className="text-xs text-muted-foreground">حروف إنجليزية وأرقام فقط (3–20). اتركه فارغاً للتوليد التلقائي.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>نسبة الخصم %</Label>
                <Input type="number" min="0" max="100" value={form.discount_percent} onChange={(e) => setForm({ ...form, discount_percent: e.target.value })} placeholder="0" />
                <p className="text-xs text-muted-foreground">تُطبّق على أول فاتورة فقط</p>
              </div>
              <div className="space-y-1.5">
                <Label>نسبة العمولة %</Label>
                <Input type="number" min="0" max="100" value={form.commission_percent} onChange={(e) => setForm({ ...form, commission_percent: e.target.value })} placeholder="0" />
                <p className="text-xs text-muted-foreground">من صافي أول فاتورة (قبل الضريبة)</p>
              </div>
            </div>
            {isAdmin && (
              <div className="space-y-1.5">
                <Label>الفرع</Label>
                <Select value={form.branch_id || 'all'} onValueChange={(v) => setForm({ ...form, branch_id: v === 'all' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="كل الفروع" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الفروع (مشترك)</SelectItem>
                    {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>ملاحظات</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="اختياري" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="button-save-marketer">
              {saving && <Loader2 className="w-4 h-4 ms-1 animate-spin" />} حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payout dialog */}
      <Dialog open={!!payoutMarketer} onOpenChange={(o) => { if (!o) setPayoutMarketer(null); }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>صرف عمولة — {payoutMarketer?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-center">
              <p className="text-sm text-amber-800">المبلغ المستحق للصرف</p>
              <p className="text-2xl font-bold text-amber-700">{(payoutMarketer?.due_amount || 0).toFixed(2)} ر.س</p>
            </div>
            <div className="space-y-1.5">
              <Label>طريقة الدفع</Label>
              <Select value={payoutForm.payment_method} onValueChange={(v) => setPayoutForm({ ...payoutForm, payment_method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>تاريخ الصرف</Label>
              <Input type="date" value={payoutForm.payment_date} onChange={(e) => setPayoutForm({ ...payoutForm, payment_date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>مرجع / رقم العملية</Label>
              <Input value={payoutForm.reference} onChange={(e) => setPayoutForm({ ...payoutForm, reference: e.target.value })} placeholder="اختياري" />
            </div>
            <div className="space-y-1.5">
              <Label>ملاحظات</Label>
              <Input value={payoutForm.notes} onChange={(e) => setPayoutForm({ ...payoutForm, notes: e.target.value })} placeholder="اختياري" />
            </div>
            <p className="text-xs text-muted-foreground">سيتم إنشاء سند صرف وتعليم جميع العمولات المستحقة كمدفوعة.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayoutMarketer(null)}>إلغاء</Button>
            <Button onClick={handlePayout} disabled={payingOut} data-testid="button-confirm-payout">
              {payingOut && <Loader2 className="w-4 h-4 ms-1 animate-spin" />} تأكيد الصرف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

export default MarketersPage;
