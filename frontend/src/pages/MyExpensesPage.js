import React, { useEffect, useState, useCallback } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Receipt, Clock, CheckCircle2, XCircle, ListChecks } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { internalExpensesAPI } from '../services/api';

const STATUS_META = {
  pending:  { ar: 'بانتظار الاعتماد', en: 'Pending', cls: 'bg-amber-100 text-amber-800', Icon: Clock },
  approved: { ar: 'معتمد',            en: 'Approved', cls: 'bg-emerald-100 text-emerald-800', Icon: CheckCircle2 },
  rejected: { ar: 'مرفوض',            en: 'Rejected', cls: 'bg-red-100 text-red-800', Icon: XCircle },
  posted:   { ar: 'مُرحَّل للمحاسبة', en: 'Posted',   cls: 'bg-blue-100 text-blue-800', Icon: ListChecks },
};

const MyExpensesPage = () => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const today = new Date().toISOString().slice(0, 10);
  const empty = {
    expense_date: today,
    expense_type: '',
    description: '',
    amount: '',
    payment_method: 'cash',
    executor_name: user?.name || user?.username || '',
    cost_center: '',
    notes: '',
    receipt_image: null,
  };
  const [form, setForm] = useState(empty);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter && statusFilter !== 'all' ? { status_filter: statusFilter } : {};
      const res = await internalExpensesAPI.getAll(params);
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      toast.error(language === 'ar' ? 'فشل تحميل المصروفات' : 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  }, [language, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      try {
        const res = await internalExpensesAPI.getTypes();
        const data = res.data;
        const list = Array.isArray(data) ? data : Object.entries(data || {}).map(([k, v]) => ({ key: k, label: v }));
        setTypes(list);
      } catch (e) {
        setTypes([]);
      }
    })();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(empty);
    setIsOpen(true);
  };

  const openEdit = (exp) => {
    if (exp.status !== 'pending') {
      toast.error(language === 'ar' ? 'لا يمكن تعديل مصروف بعد اعتماده' : 'Cannot edit an approved expense');
      return;
    }
    setEditing(exp);
    setForm({
      expense_date: exp.expense_date || today,
      expense_type: exp.expense_type || '',
      description: exp.description || '',
      amount: exp.amount || '',
      payment_method: exp.payment_method || 'cash',
      executor_name: exp.executor_name || '',
      cost_center: exp.cost_center || '',
      notes: exp.notes || '',
      receipt_image: null,
    });
    setIsOpen(true);
  };

  const submit = async () => {
    if (!form.expense_type) { toast.error(language === 'ar' ? 'اختر نوع المصروف' : 'Select expense type'); return; }
    if (!form.description.trim()) { toast.error(language === 'ar' ? 'أدخل وصف المصروف' : 'Enter description'); return; }
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) { toast.error(language === 'ar' ? 'أدخل مبلغ صحيح' : 'Enter a valid amount'); return; }
    if (!form.executor_name.trim()) { toast.error(language === 'ar' ? 'أدخل اسم المنفذ' : 'Enter executor name'); return; }

    const fd = new FormData();
    fd.append('expense_date', form.expense_date);
    fd.append('expense_type', form.expense_type);
    fd.append('description', form.description.trim());
    fd.append('amount', String(amt));
    fd.append('payment_method', form.payment_method);
    fd.append('executor_name', form.executor_name.trim());
    if (form.cost_center) fd.append('cost_center', form.cost_center);
    if (form.notes) fd.append('notes', form.notes);
    if (form.receipt_image) fd.append('receipt_image', form.receipt_image);

    setSaving(true);
    try {
      if (editing) {
        await internalExpensesAPI.update(editing.id, fd);
        toast.success(language === 'ar' ? 'تم تحديث المصروف' : 'Expense updated');
      } else {
        await internalExpensesAPI.create(fd);
        toast.success(language === 'ar' ? 'تم إرسال المصروف بانتظار اعتماد الأدمن' : 'Expense submitted, pending approval');
      }
      setIsOpen(false);
      setForm(empty);
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || (language === 'ar' ? 'فشل الحفظ' : 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (exp) => {
    if (exp.status !== 'pending') {
      toast.error(language === 'ar' ? 'لا يمكن حذف مصروف بعد اعتماده' : 'Cannot delete an approved expense');
      return;
    }
    if (!window.confirm(language === 'ar' ? 'حذف المصروف؟' : 'Delete this expense?')) return;
    try {
      await internalExpensesAPI.delete(exp.id);
      toast.success(language === 'ar' ? 'تم الحذف' : 'Deleted');
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || (language === 'ar' ? 'فشل الحذف' : 'Delete failed'));
    }
  };

  const renderStatus = (s) => {
    const meta = STATUS_META[s] || STATUS_META.pending;
    const Icon = meta.Icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${meta.cls}`}>
        <Icon className="w-3 h-3" />
        {language === 'ar' ? meta.ar : meta.en}
      </span>
    );
  };

  const total = items.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const pendingCount = items.filter(e => e.status === 'pending').length;

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Receipt className="w-6 h-6 text-orange-500" />
              {language === 'ar' ? 'مصروفاتي' : 'My Expenses'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {language === 'ar'
                ? 'قدِّم طلبات مصروفات داخلية وتابع حالتها. كل طلب جديد يحتاج اعتماد من الأدمن قبل ترحيله للمحاسبة.'
                : 'Submit internal expense requests and follow their status. Each new request needs admin approval before posting.'}
            </p>
          </div>
          <Button onClick={openCreate} className="bg-orange-500 hover:bg-orange-600 text-white">
            <Plus className="w-4 h-4 me-1" />
            {language === 'ar' ? 'إضافة مصروف' : 'Add Expense'}
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-white border rounded-xl p-3">
            <div className="text-xs text-gray-500">{language === 'ar' ? 'إجمالي الطلبات' : 'Total Requests'}</div>
            <div className="text-xl font-bold">{items.length}</div>
          </div>
          <div className="bg-white border rounded-xl p-3">
            <div className="text-xs text-gray-500">{language === 'ar' ? 'بانتظار الاعتماد' : 'Pending'}</div>
            <div className="text-xl font-bold text-amber-600">{pendingCount}</div>
          </div>
          <div className="bg-white border rounded-xl p-3 col-span-2">
            <div className="text-xs text-gray-500">{language === 'ar' ? 'إجمالي المبلغ' : 'Total Amount'}</div>
            <div className="text-xl font-bold">{total.toFixed(2)}</div>
          </div>
        </div>

        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <div className="p-3 border-b flex items-center gap-2">
            <span className="text-sm text-gray-600">{language === 'ar' ? 'تصفية حسب الحالة:' : 'Filter by status:'}</span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{language === 'ar' ? 'الكل' : 'All'}</SelectItem>
                <SelectItem value="pending">{language === 'ar' ? 'بانتظار الاعتماد' : 'Pending'}</SelectItem>
                <SelectItem value="approved">{language === 'ar' ? 'معتمد' : 'Approved'}</SelectItem>
                <SelectItem value="rejected">{language === 'ar' ? 'مرفوض' : 'Rejected'}</SelectItem>
                <SelectItem value="posted">{language === 'ar' ? 'مُرحَّل' : 'Posted'}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="p-10 text-center text-gray-500">{language === 'ar' ? 'جارٍ التحميل...' : 'Loading...'}</div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center text-gray-500">{language === 'ar' ? 'لا توجد مصروفات' : 'No expenses yet'}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-start">{language === 'ar' ? 'الرقم' : '#'}</th>
                    <th className="px-3 py-2 text-start">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                    <th className="px-3 py-2 text-start">{language === 'ar' ? 'النوع' : 'Type'}</th>
                    <th className="px-3 py-2 text-start">{language === 'ar' ? 'الوصف' : 'Description'}</th>
                    <th className="px-3 py-2 text-end">{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                    <th className="px-3 py-2 text-center">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                    <th className="px-3 py-2 text-center">{language === 'ar' ? 'إجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(e => (
                    <tr key={e.id} className="border-t hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs">{e.expense_number}</td>
                      <td className="px-3 py-2">{e.expense_date}</td>
                      <td className="px-3 py-2">{e.expense_type}</td>
                      <td className="px-3 py-2 max-w-xs truncate" title={e.description}>{e.description}</td>
                      <td className="px-3 py-2 text-end font-semibold">{Number(e.amount || 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-center">{renderStatus(e.status)}</td>
                      <td className="px-3 py-2 text-center">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            disabled={e.status !== 'pending'}
                            onClick={() => openEdit(e)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                            title={language === 'ar' ? 'تعديل' : 'Edit'}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={e.status !== 'pending'}
                            onClick={() => remove(e)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                            title={language === 'ar' ? 'حذف' : 'Delete'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent className="max-w-lg" dir={language === 'ar' ? 'rtl' : 'ltr'}>
            <DialogHeader>
              <DialogTitle>
                {editing
                  ? (language === 'ar' ? 'تعديل المصروف' : 'Edit Expense')
                  : (language === 'ar' ? 'إضافة مصروف جديد' : 'Add New Expense')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-600">{language === 'ar' ? 'التاريخ' : 'Date'}</label>
                  <Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-gray-600">{language === 'ar' ? 'المبلغ' : 'Amount'}</label>
                  <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-600">{language === 'ar' ? 'نوع المصروف' : 'Expense Type'}</label>
                <Select value={form.expense_type} onValueChange={(v) => setForm({ ...form, expense_type: v })}>
                  <SelectTrigger><SelectValue placeholder={language === 'ar' ? 'اختر النوع' : 'Select type'} /></SelectTrigger>
                  <SelectContent>
                    {types.map(t => {
                      const k = t.key ?? t;
                      const lbl = t.label ?? t;
                      return <SelectItem key={k} value={k}>{lbl}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-gray-600">{language === 'ar' ? 'الوصف' : 'Description'}</label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={language === 'ar' ? 'وصف مختصر' : 'Brief description'} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-600">{language === 'ar' ? 'طريقة الدفع' : 'Payment Method'}</label>
                  <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{language === 'ar' ? 'نقداً' : 'Cash'}</SelectItem>
                      <SelectItem value="transfer">{language === 'ar' ? 'تحويل بنكي' : 'Bank Transfer'}</SelectItem>
                      <SelectItem value="card">{language === 'ar' ? 'بطاقة' : 'Card'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-gray-600">{language === 'ar' ? 'المنفذ' : 'Executor'}</label>
                  <Input value={form.executor_name} onChange={(e) => setForm({ ...form, executor_name: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-600">{language === 'ar' ? 'مركز التكلفة (اختياري)' : 'Cost Center (optional)'}</label>
                <Input value={form.cost_center} onChange={(e) => setForm({ ...form, cost_center: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-600">{language === 'ar' ? 'ملاحظات (اختياري)' : 'Notes (optional)'}</label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-600">{language === 'ar' ? 'صورة الإيصال (اختياري)' : 'Receipt Image (optional)'}</label>
                <Input type="file" accept="image/*" onChange={(e) => setForm({ ...form, receipt_image: e.target.files?.[0] || null })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsOpen(false)} disabled={saving}>
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button onClick={submit} disabled={saving} className="bg-orange-500 hover:bg-orange-600 text-white">
                {saving
                  ? (language === 'ar' ? 'جارٍ الحفظ...' : 'Saving...')
                  : editing
                    ? (language === 'ar' ? 'حفظ التعديل' : 'Save Changes')
                    : (language === 'ar' ? 'إرسال للاعتماد' : 'Submit for Approval')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default MyExpensesPage;
