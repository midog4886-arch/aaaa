import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { invoicesAPI, membersAPI, activitiesAPI, exportAPI } from '../services/api';
import { toast } from 'sonner';
import { 
  Plus, Search, Eye, Printer, Loader2, Receipt, CheckCircle, XCircle, Clock,
  Filter, MessageSquare, X, UserPlus, Trash2, RotateCcw, FileSpreadsheet
} from 'lucide-react';

const COMPANY_INFO = {
  name_ar: "أكاديمية أداء الأبطال العالمية",
  name_en: "Global Champions Sports Performance",
  tax_number: "312655637900003",
  commercial_reg: "7043630230",
  vat_rate: 15
};

export const InvoicesPage = () => {
  const { t, language } = useLanguage();
  const [invoices, setInvoices] = useState([]);
  const [members, setMembers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterActivity, setFilterActivity] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [saving, setSaving] = useState(false);
  const [qrCode, setQrCode] = useState(null);
  
  const [customerNameAr, setCustomerNameAr] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  
  const [newMemberData, setNewMemberData] = useState({
    name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: ''
  });
  
  const printRef = useRef();

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    try {
      const [invoicesRes, membersRes, activitiesRes] = await Promise.all([
        invoicesAPI.getAll(), membersAPI.getAll(), activitiesAPI.getAll()
      ]);
      setInvoices(invoicesRes.data);
      setMembers(membersRes.data);
      setActivities(activitiesRes.data);
    } catch (error) {
      toast.error(t('error'));
    } finally {
      setLoading(false);
    }
  };

  const handleMemberSelect = (memberId) => {
    if (memberId === 'new') { setIsAddMemberDialogOpen(true); return; }
    if (memberId === 'none') { setSelectedMember(null); return; }
    const member = members.find(m => m.id === memberId);
    setSelectedMember(member);
    if (member) {
      setCustomerNameAr(member.name_ar || '');
      setCustomerPhone(member.phone || '');
      setCustomerAddress('');
    }
  };

  const addActivityToInvoice = (activityId) => {
    const activity = activities.find(a => a.id === activityId);
    if (!activity) return;
    if (invoiceItems.find(item => item.activity_id === activityId)) {
      toast.error(language === 'ar' ? 'النشاط مضاف مسبقاً' : 'Activity already added');
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const endDate = nextMonth.toISOString().split('T')[0];
    
    setInvoiceItems([...invoiceItems, {
      activity_id: activity.id,
      activity_name: language === 'ar' ? activity.name_ar : activity.name,
      fee: activity.monthly_fee,
      period: `${today} - ${endDate}`,
      start_date: today,
      end_date: endDate
    }]);
  };

  const updateItemFee = (index, newFee) => {
    const updated = [...invoiceItems];
    updated[index].fee = parseFloat(newFee) || 0;
    setInvoiceItems(updated);
  };

  const updateItemDate = (index, field, value) => {
    const updated = [...invoiceItems];
    updated[index][field] = value;
    updated[index].period = `${updated[index].start_date} - ${updated[index].end_date}`;
    setInvoiceItems(updated);
  };

  const removeItem = (index) => setInvoiceItems(invoiceItems.filter((_, i) => i !== index));

  const calculateTotals = () => {
    const subtotal = invoiceItems.reduce((sum, item) => sum + item.fee, 0);
    const afterDiscount = subtotal - (parseFloat(discount) || 0);
    const vatAmount = Math.round(afterDiscount * (COMPANY_INFO.vat_rate / 100) * 100) / 100;
    const total = Math.round((afterDiscount + vatAmount) * 100) / 100;
    return { subtotal, afterDiscount, vatAmount, total };
  };

  const handleCreateMember = async () => {
    if (!newMemberData.name_ar || !newMemberData.phone) {
      toast.error(language === 'ar' ? 'أدخل الاسم ورقم الجوال' : 'Enter name and phone');
      return;
    }
    setSaving(true);
    try {
      const response = await membersAPI.create({ ...newMemberData, age: parseInt(newMemberData.age) || 0, activities: [] });
      const membersRes = await membersAPI.getAll();
      setMembers(membersRes.data);
      setSelectedMember(response.data);
      setCustomerNameAr(response.data.name_ar);
      setCustomerPhone(response.data.phone);
      setIsAddMemberDialogOpen(false);
      setNewMemberData({ name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: '' });
      toast.success(t('success'));
    } catch (error) {
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateInvoice = async () => {
    if (invoiceItems.length === 0) {
      toast.error(language === 'ar' ? 'أضف نشاط واحد على الأقل' : 'Add at least one activity');
      return;
    }
    if (!customerNameAr) {
      toast.error(language === 'ar' ? 'أدخل اسم العميل' : 'Enter customer name');
      return;
    }
    setSaving(true);
    try {
      await invoicesAPI.create({
        member_id: selectedMember?.id || null,
        items: invoiceItems,
        discount: parseFloat(discount) || 0,
        notes, payment_method: paymentMethod,
        customer_name_ar: customerNameAr, customer_phone: customerPhone, customer_address: customerAddress
      });
      toast.success(t('success'));
      loadData();
      closeCreateDialog();
    } catch (error) {
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  };

  const handleMarkPaid = async (invoiceId) => {
    try { await invoicesAPI.pay(invoiceId); toast.success(t('success')); loadData(); } catch { toast.error(t('error')); }
  };

  const handleRestoreInvoice = async (invoiceId) => {
    try { await invoicesAPI.restore(invoiceId); toast.success(language === 'ar' ? 'تم استرجاع الفاتورة' : 'Invoice restored'); loadData(); } catch { toast.error(t('error')); }
  };

  const handleDeleteInvoice = async (invoiceId) => {
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من حذف الفاتورة نهائياً؟' : 'Are you sure you want to permanently delete this invoice?')) return;
    try { await invoicesAPI.delete(invoiceId); toast.success(language === 'ar' ? 'تم حذف الفاتورة' : 'Invoice deleted'); loadData(); setIsViewDialogOpen(false); } catch { toast.error(t('error')); }
  };

  const handleCancelInvoice = async (invoiceId) => {
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من إلغاء الفاتورة؟' : 'Cancel this invoice?')) return;
    try { await invoicesAPI.cancel(invoiceId); toast.success(language === 'ar' ? 'تم إلغاء الفاتورة' : 'Invoice cancelled'); loadData(); } catch { toast.error(t('error')); }
  };

  const loadQRCode = async (invoiceId) => {
    try {
      const response = await invoicesAPI.getQR(invoiceId);
      setQrCode(response.data.qr_image);
    } catch { setQrCode(null); }
  };

  const handleViewInvoice = async (invoice) => {
    setSelectedInvoice(invoice);
    setIsViewDialogOpen(true);
    loadQRCode(invoice.id);
  };

  const handleSendWhatsApp = (invoice) => {
    const phone = invoice.customer_phone || '';
    if (!phone) { toast.error(language === 'ar' ? 'لا يوجد رقم جوال' : 'No phone number'); return; }
    const formattedPhone = phone.replace(/^0/, '966');
    const vatAmount = invoice.vat_amount || 0;
    const message = `فاتورة من ${COMPANY_INFO.name_ar}\n━━━━━━━━━━━━━━\nرقم الفاتورة: #${invoice.id.slice(0, 8)}\nالعميل: ${invoice.customer_name_ar || invoice.member_name}\n━━━━━━━━━━━━━━\nالمجموع: ${invoice.subtotal} ر.س\nالخصم: ${invoice.discount} ر.س\nضريبة القيمة المضافة (15%): ${vatAmount} ر.س\n━━━━━━━━━━━━━━\nالإجمالي: ${invoice.total} ر.س\nالحالة: ${invoice.status === 'paid' ? '✅ مدفوعة' : '⏳ غير مدفوعة'}\n━━━━━━━━━━━━━━\nالرقم الضريبي: ${COMPANY_INFO.tax_number}\nالسجل التجاري: ${COMPANY_INFO.commercial_reg}`;
    window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handlePrint = () => {
    const printContent = printRef.current;
    const printWindow = window.open('', '', 'width=800,height=600');
    printWindow.document.write(`<html><head><title>فاتورة</title><style>@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');@page{size:A4;margin:10mm}body{font-family:'Tajawal',Arial,sans-serif;direction:rtl;padding:15px;max-width:800px;margin:0 auto;font-size:11px}.company-name{font-size:16px;font-weight:bold;color:#1E3A8A}.company-info{font-size:9px;color:#666;margin-top:3px}.invoice-details{text-align:left;font-size:10px}.customer-info{background:#f8fafc;padding:10px;border-radius:6px;margin-bottom:10px}.customer-info h4{margin:0 0 5px 0;color:#1E3A8A;font-size:12px}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:6px 8px;border:1px solid #e2e8f0;text-align:right;font-size:10px}th{background:#f1f5f9;font-weight:600}.totals{margin-top:10px}.totals-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #e2e8f0;font-size:11px}.totals-row.vat{color:#059669}.totals-row.total{font-size:14px;font-weight:bold;color:#F97316;border-top:2px solid #1E3A8A;border-bottom:none;padding-top:8px}.footer{margin-top:15px;padding-top:10px;border-top:1px solid #e2e8f0;text-align:center;font-size:9px;color:#666}.qr-code{text-align:center;margin-top:10px}.qr-code img{width:80px;height:80px}</style></head><body>${printContent.innerHTML}</body></html>`);
    printWindow.document.close();
    printWindow.print();
  };

  const handleExportAllData = () => {
    const token = localStorage.getItem('token');
    const url = exportAPI.allData() + `?token=${token}`;
    window.open(url, '_blank');
  };

  const closeCreateDialog = () => {
    setIsCreateDialogOpen(false); setSelectedMember(null); setInvoiceItems([]);
    setDiscount(0); setNotes(''); setPaymentMethod('cash');
    setCustomerNameAr(''); setCustomerPhone(''); setCustomerAddress('');
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      paid: { label: t('paid'), icon: CheckCircle, class: 'bg-green-500/15 text-green-600 border-green-500/30' },
      pending: { label: t('unpaid'), icon: Clock, class: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
      cancelled: { label: t('cancelled'), icon: XCircle, class: 'bg-red-500/15 text-red-600 border-red-500/30' }
    };
    const { label, icon: Icon, class: className } = statusMap[status] || statusMap.pending;
    return <Badge variant="outline" className={className}><Icon className="w-3 h-3 me-1" />{label}</Badge>;
  };

  const filteredInvoices = invoices.filter(invoice => {
    const matchesSearch = !searchTerm || invoice.member_name?.toLowerCase().includes(searchTerm.toLowerCase()) || invoice.id?.includes(searchTerm) || invoice.customer_phone?.includes(searchTerm);
    const matchesStatus = filterStatus === 'all' || invoice.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const { subtotal, vatAmount, total } = calculateTotals();

  if (loading) return <Layout title={t('invoices')}><div className="flex items-center justify-center h-64"><div className="spinner" /></div></Layout>;

  return (
    <Layout title={t('invoices')}>
      <div className="space-y-6" data-testid="invoices-page">
        {/* Header */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <div className="flex flex-1 gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder={language === 'ar' ? 'بحث...' : 'Search...'} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="ps-10" />
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'الكل' : 'All'}</SelectItem>
                  <SelectItem value="pending">{t('unpaid')}</SelectItem>
                  <SelectItem value="paid">{t('paid')}</SelectItem>
                  <SelectItem value="cancelled">{t('cancelled')}</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}><Filter className="w-4 h-4" /></Button>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={handleExportAllData} data-testid="export-all-btn">
                <FileSpreadsheet className="w-4 h-4 me-2" />{language === 'ar' ? 'تصدير Excel' : 'Export All'}
              </Button>
              <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="create-invoice-btn">
                <Plus className="w-4 h-4 me-2" />{t('create_invoice')}
              </Button>
            </div>
          </div>
          {showAdvancedSearch && (
            <Card className="p-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-2"><Label>{t('activity_name')}</Label>
                  <Select value={filterActivity} onValueChange={setFilterActivity}><SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">{language === 'ar' ? 'الكل' : 'All'}</SelectItem>
                      {activities.map(a => <SelectItem key={a.id} value={a.id}>{language === 'ar' ? a.name_ar : a.name}</SelectItem>)}
                    </SelectContent></Select></div>
                <div className="space-y-2"><Label>{t('from')}</Label><Input type="date" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} /></div>
                <div className="space-y-2"><Label>{t('to')}</Label><Input type="date" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} /></div>
                <Button onClick={loadData}><Search className="w-4 h-4 me-2" />{t('search')}</Button>
                <Button variant="outline" onClick={() => { setSearchTerm(''); setFilterStatus('all'); setFilterActivity('all'); setFilterStartDate(''); setFilterEndDate(''); loadData(); }}><X className="w-4 h-4 me-2" />{language === 'ar' ? 'مسح' : 'Clear'}</Button>
              </div>
            </Card>
          )}
        </div>

        {/* Invoices Table */}
        <Card><CardContent className="p-0"><div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr>
              <th>{t('invoice_number')}</th><th>{language === 'ar' ? 'العميل' : 'Customer'}</th><th>{t('phone')}</th>
              <th>{language === 'ar' ? 'الإجمالي' : 'Total'}</th><th>{t('invoice_status')}</th><th>{t('invoice_date')}</th><th></th>
            </tr></thead>
            <tbody>
              {filteredInvoices.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">{t('no_data')}</td></tr> :
                filteredInvoices.map(invoice => (
                  <tr key={invoice.id}>
                    <td className="font-mono text-sm">#{invoice.id.slice(0, 8)}</td>
                    <td className="font-medium">{invoice.customer_name_ar || invoice.member_name}</td>
                    <td dir="ltr" className="text-sm">{invoice.customer_phone || '-'}</td>
                    <td className="font-bold text-primary">{invoice.total} {t('sar')}</td>
                    <td>{getStatusBadge(invoice.status)}</td>
                    <td className="text-sm text-muted-foreground">{new Date(invoice.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</td>
                    <td>
                      <div className="action-buttons">
                        <button className="action-button" onClick={() => handleViewInvoice(invoice)} title={language === 'ar' ? 'عرض' : 'View'}><Eye className="w-4 h-4" /></button>
                        <button className="action-button text-green-600" onClick={() => handleSendWhatsApp(invoice)} title={language === 'ar' ? 'واتساب' : 'WhatsApp'}><MessageSquare className="w-4 h-4" /></button>
                        {invoice.status === 'pending' && (<>
                          <button className="action-button text-green-600" onClick={() => handleMarkPaid(invoice.id)} title={language === 'ar' ? 'تم الدفع' : 'Mark Paid'}><CheckCircle className="w-4 h-4" /></button>
                          <button className="action-button text-amber-600" onClick={() => handleCancelInvoice(invoice.id)} title={language === 'ar' ? 'إلغاء' : 'Cancel'}><XCircle className="w-4 h-4" /></button>
                        </>)}
                        {invoice.status === 'cancelled' && (
                          <button className="action-button text-blue-600" onClick={() => handleRestoreInvoice(invoice.id)} title={language === 'ar' ? 'استرجاع' : 'Restore'}><RotateCcw className="w-4 h-4" /></button>
                        )}
                        <button className="action-button text-red-600" onClick={() => handleDeleteInvoice(invoice.id)} title={language === 'ar' ? 'حذف' : 'Delete'}><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div></CardContent></Card>

        {/* Create Invoice Dialog */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{t('create_invoice')}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>{language === 'ar' ? 'اختر العضو' : 'Select member'}</Label>
                <Select value={selectedMember?.id || 'none'} onValueChange={handleMemberSelect}>
                  <SelectTrigger><SelectValue placeholder={t('member_name')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{language === 'ar' ? '-- بدون عضو --' : '-- No member --'}</SelectItem>
                    <SelectItem value="new" className="text-primary font-medium"><UserPlus className="w-4 h-4 inline me-2" />{language === 'ar' ? 'إضافة عضو جديد' : 'Add new member'}</SelectItem>
                    {members.map(m => <SelectItem key={m.id} value={m.id}>{language === 'ar' ? m.name_ar : m.name} - {m.phone}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <Card className="p-4 border-primary/20 bg-primary/5">
                <h4 className="font-semibold mb-3 flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" />{language === 'ar' ? 'بيانات العميل' : 'Customer Data'}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>{language === 'ar' ? 'اسم العميل *' : 'Customer Name *'}</Label><Input value={customerNameAr} onChange={(e) => setCustomerNameAr(e.target.value)} required /></div>
                  <div className="space-y-2"><Label>{t('phone')}</Label><Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} type="tel" dir="ltr" /></div>
                  <div className="space-y-2 sm:col-span-2"><Label>{language === 'ar' ? 'العنوان' : 'Address'}</Label><Input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} /></div>
                </div>
              </Card>

              <div className="space-y-2"><Label>{language === 'ar' ? 'إضافة نشاط' : 'Add activity'}</Label>
                <Select onValueChange={addActivityToInvoice}><SelectTrigger><SelectValue placeholder={language === 'ar' ? 'اختر نشاط' : 'Select activity'} /></SelectTrigger>
                  <SelectContent>{activities.map(a => <SelectItem key={a.id} value={a.id}>{language === 'ar' ? a.name_ar : a.name} - {a.monthly_fee} {t('sar')}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              {invoiceItems.length > 0 && (
                <div className="space-y-2"><Label>{language === 'ar' ? 'الأنشطة' : 'Items'}</Label>
                  <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
                    {invoiceItems.map((item, idx) => (
                      <div key={idx} className="p-3 bg-background rounded-lg border space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="font-medium">{item.activity_name}</p>
                          <Button variant="ghost" size="icon" onClick={() => removeItem(idx)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="space-y-1"><Label className="text-xs">{language === 'ar' ? 'تاريخ البداية' : 'Start Date'}</Label>
                            <Input type="date" value={item.start_date} onChange={(e) => updateItemDate(idx, 'start_date', e.target.value)} className="h-8 text-sm" /></div>
                          <div className="space-y-1"><Label className="text-xs">{language === 'ar' ? 'تاريخ النهاية' : 'End Date'}</Label>
                            <Input type="date" value={item.end_date} onChange={(e) => updateItemDate(idx, 'end_date', e.target.value)} className="h-8 text-sm" /></div>
                          <div className="space-y-1"><Label className="text-xs">{language === 'ar' ? 'المبلغ' : 'Fee'}</Label>
                            <Input type="number" value={item.fee} onChange={(e) => updateItemFee(idx, e.target.value)} className="h-8 text-sm" /></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>{t('discount')} ({t('sar')})</Label><Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} min="0" /></div>
                <div className="space-y-2"><Label>{t('payment_method')}</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="cash">{t('cash')}</SelectItem><SelectItem value="card">{t('card')}</SelectItem><SelectItem value="transfer">{t('transfer')}</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2"><Label>{t('notes')}</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

              {invoiceItems.length > 0 && (
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <div className="flex justify-between text-sm mb-2"><span>{t('subtotal')}</span><span>{subtotal.toFixed(2)} {t('sar')}</span></div>
                  {discount > 0 && <div className="flex justify-between text-sm mb-2 text-muted-foreground"><span>{t('discount')}</span><span>- {parseFloat(discount).toFixed(2)} {t('sar')}</span></div>}
                  <div className="flex justify-between text-sm mb-2 text-green-600"><span>{language === 'ar' ? `ضريبة القيمة المضافة (${COMPANY_INFO.vat_rate}%)` : `VAT (${COMPANY_INFO.vat_rate}%)`}</span><span>{vatAmount.toFixed(2)} {t('sar')}</span></div>
                  <div className="flex justify-between text-lg font-bold border-t pt-2"><span>{t('total')}</span><span className="text-primary">{total.toFixed(2)} {t('sar')}</span></div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeCreateDialog}>{t('cancel')}</Button>
              <Button onClick={handleCreateInvoice} disabled={saving || invoiceItems.length === 0 || !customerNameAr}>
                {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}{t('create_invoice')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add New Member Dialog */}
        <Dialog open={isAddMemberDialogOpen} onOpenChange={setIsAddMemberDialogOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{t('add_member')}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>{language === 'ar' ? 'اسم العضو *' : 'Name *'}</Label><Input value={newMemberData.name_ar} onChange={(e) => setNewMemberData({...newMemberData, name_ar: e.target.value})} required /></div>
                <div className="space-y-2"><Label>{t('phone')} *</Label><Input value={newMemberData.phone} onChange={(e) => setNewMemberData({...newMemberData, phone: e.target.value})} type="tel" dir="ltr" required /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>{language === 'ar' ? 'ولي الأمر' : 'Guardian'}</Label><Input value={newMemberData.guardian_name_ar} onChange={(e) => setNewMemberData({...newMemberData, guardian_name_ar: e.target.value})} /></div>
                <div className="space-y-2"><Label>{t('age')}</Label><Input value={newMemberData.age} onChange={(e) => setNewMemberData({...newMemberData, age: e.target.value})} type="number" /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddMemberDialogOpen(false)}>{t('cancel')}</Button>
              <Button onClick={handleCreateMember} disabled={saving}>{saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}{t('save')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* View Invoice Dialog */}
        <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Receipt className="w-5 h-5 text-primary" />{t('invoice_number')}: #{selectedInvoice?.id.slice(0, 8)}</DialogTitle></DialogHeader>
            {selectedInvoice && (
              <div ref={printRef} className="p-4">
                <div className="flex justify-between items-start border-b-2 border-primary pb-4 mb-4">
                  <div>
                    <div className="text-lg font-bold text-blue-900">{COMPANY_INFO.name_ar}</div>
                    <div className="text-xs text-muted-foreground">{language === 'ar' ? 'الرقم الضريبي' : 'Tax No'}: {COMPANY_INFO.tax_number}<br/>{language === 'ar' ? 'السجل التجاري' : 'CR'}: {COMPANY_INFO.commercial_reg}</div>
                  </div>
                  <div className="text-sm text-end">
                    <p><strong>{t('invoice_number')}:</strong> #{selectedInvoice.id.slice(0, 8)}</p>
                    <p><strong>{t('invoice_date')}:</strong> {new Date(selectedInvoice.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</p>
                    <div className="mt-2">{getStatusBadge(selectedInvoice.status)}</div>
                  </div>
                </div>

                <div className="mb-4 p-3 bg-muted/50 rounded-lg">
                  <h4 className="font-semibold mb-2 text-blue-900">{language === 'ar' ? 'بيانات العميل' : 'Customer'}</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <p><strong>{language === 'ar' ? 'الاسم' : 'Name'}:</strong> {selectedInvoice.customer_name_ar || selectedInvoice.member_name}</p>
                    <p><strong>{t('phone')}:</strong> <span dir="ltr">{selectedInvoice.customer_phone || '-'}</span></p>
                    {selectedInvoice.customer_address && <p className="col-span-2"><strong>{language === 'ar' ? 'العنوان' : 'Address'}:</strong> {selectedInvoice.customer_address}</p>}
                  </div>
                </div>

                <table className="w-full border-collapse mb-4">
                  <thead><tr className="bg-muted"><th className="border p-2 text-start">{t('activity_name')}</th><th className="border p-2 text-start">{language === 'ar' ? 'الفترة' : 'Period'}</th><th className="border p-2 text-start">{language === 'ar' ? 'المبلغ' : 'Amount'}</th></tr></thead>
                  <tbody>{selectedInvoice.items.map((item, idx) => <tr key={idx}><td className="border p-2">{item.activity_name}</td><td className="border p-2">{item.period}</td><td className="border p-2">{item.fee} {t('sar')}</td></tr>)}</tbody>
                </table>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between py-1 border-b"><span>{t('subtotal')}:</span><span>{selectedInvoice.subtotal} {t('sar')}</span></div>
                  {selectedInvoice.discount > 0 && <div className="flex justify-between py-1 border-b text-muted-foreground"><span>{t('discount')}:</span><span>- {selectedInvoice.discount} {t('sar')}</span></div>}
                  <div className="flex justify-between py-1 border-b text-green-600"><span>{language === 'ar' ? `ضريبة القيمة المضافة (${COMPANY_INFO.vat_rate}%)` : `VAT (${COMPANY_INFO.vat_rate}%)`}:</span><span>{selectedInvoice.vat_amount || 0} {t('sar')}</span></div>
                  <div className="flex justify-between py-2 text-xl font-bold text-primary border-t-2 border-blue-900"><span>{t('total')}:</span><span>{selectedInvoice.total} {t('sar')}</span></div>
                </div>

                {qrCode && <div className="qr-code text-center mt-4 pt-4 border-t"><p className="text-xs text-muted-foreground mb-2">{language === 'ar' ? 'رمز QR للفاتورة الإلكترونية' : 'E-Invoice QR Code'}</p><img src={qrCode} alt="QR Code" className="w-20 h-20 mx-auto" /></div>}

                <div className="mt-4 pt-4 border-t text-center text-xs text-muted-foreground">
                  <p>{COMPANY_INFO.name_ar} | {COMPANY_INFO.name_en}</p>
                  <div className="flex justify-center gap-6 mt-2"><span>{language === 'ar' ? 'الرقم الضريبي' : 'Tax Number'}: {COMPANY_INFO.tax_number}</span><span>{language === 'ar' ? 'السجل التجاري' : 'Commercial Reg'}: {COMPANY_INFO.commercial_reg}</span></div>
                </div>
              </div>
            )}
            <DialogFooter className="flex-wrap gap-2">
              <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>{t('close')}</Button>
              <Button variant="outline" onClick={() => handleSendWhatsApp(selectedInvoice)}><MessageSquare className="w-4 h-4 me-2" />{language === 'ar' ? 'واتساب' : 'WhatsApp'}</Button>
              <Button variant="outline" onClick={handlePrint}><Printer className="w-4 h-4 me-2" />{t('print')}</Button>
              {selectedInvoice?.status === 'cancelled' && <Button variant="outline" onClick={() => handleRestoreInvoice(selectedInvoice.id)}><RotateCcw className="w-4 h-4 me-2" />{language === 'ar' ? 'استرجاع' : 'Restore'}</Button>}
              {selectedInvoice?.status === 'pending' && <Button onClick={() => handleMarkPaid(selectedInvoice.id)}><CheckCircle className="w-4 h-4 me-2" />{language === 'ar' ? 'تم الدفع' : 'Mark Paid'}</Button>}
              <Button variant="destructive" onClick={() => handleDeleteInvoice(selectedInvoice?.id)}><Trash2 className="w-4 h-4 me-2" />{language === 'ar' ? 'حذف' : 'Delete'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default InvoicesPage;
