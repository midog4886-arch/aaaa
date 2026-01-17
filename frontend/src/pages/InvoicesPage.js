import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { invoicesAPI, membersAPI, activitiesAPI, paymentsAPI, exportAPI } from '../services/api';
import { toast } from 'sonner';
import { 
  Plus, 
  Search,
  Eye,
  Printer,
  CreditCard,
  Loader2,
  Receipt,
  CheckCircle,
  XCircle,
  Clock,
  Trophy,
  Download,
  Filter,
  MessageSquare,
  X
} from 'lucide-react';

export const InvoicesPage = () => {
  const { t, language } = useLanguage();
  const [searchParams] = useSearchParams();
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
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedActivities, setSelectedActivities] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [saving, setSaving] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  
  // Customer data fields
  const [customerName, setCustomerName] = useState('');
  const [customerNameAr, setCustomerNameAr] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  
  const printRef = useRef();

  useEffect(() => {
    loadData();
    
    // Check for payment callback
    const sessionId = searchParams.get('session_id');
    const invoiceId = searchParams.get('invoice_id');
    if (sessionId && invoiceId) {
      checkPaymentStatus(sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const loadData = async () => {
    try {
      const [invoicesRes, membersRes, activitiesRes] = await Promise.all([
        invoicesAPI.getAll(),
        membersAPI.getAll(),
        activitiesAPI.getAll()
      ]);
      setInvoices(invoicesRes.data);
      setMembers(membersRes.data);
      setActivities(activitiesRes.data);
    } catch (error) {
      console.error('Failed to load data:', error);
      toast.error(t('error'));
    } finally {
      setLoading(false);
    }
  };

  const checkPaymentStatus = async (sessionId) => {
    try {
      const response = await paymentsAPI.getStatus(sessionId);
      if (response.data.payment_status === 'paid') {
        toast.success(language === 'ar' ? 'تم الدفع بنجاح!' : 'Payment successful!');
        loadData();
      }
    } catch (error) {
      console.error('Failed to check payment status:', error);
    }
  };

  // When member is selected, auto-fill customer data
  const handleMemberSelect = (memberId) => {
    const member = members.find(m => m.id === memberId);
    setSelectedMember(member);
    setSelectedActivities([]);
    
    // Auto-fill customer data from member
    if (member) {
      setCustomerName(member.name || '');
      setCustomerNameAr(member.name_ar || '');
      setCustomerPhone(member.phone || '');
      setCustomerEmail(member.email || '');
      setCustomerAddress('');
    }
  };

  const handleCreateInvoice = async () => {
    if (!selectedMember || selectedActivities.length === 0) {
      toast.error(language === 'ar' ? 'اختر العضو والأنشطة' : 'Select member and activities');
      return;
    }
    
    setSaving(true);
    try {
      const items = selectedActivities.map(activity => ({
        activity_id: activity.activity_id,
        activity_name: activity.activity_name,
        fee: activity.fee,
        period: `${activity.start_date} - ${activity.end_date}`
      }));
      
      const invoiceData = {
        member_id: selectedMember.id,
        items,
        discount: parseFloat(discount) || 0,
        notes,
        payment_method: paymentMethod,
        // Customer data
        customer_name: customerName,
        customer_name_ar: customerNameAr,
        customer_phone: customerPhone,
        customer_email: customerEmail,
        customer_address: customerAddress
      };
      
      await invoicesAPI.create(invoiceData);
      toast.success(t('success'));
      loadData();
      closeCreateDialog();
    } catch (error) {
      console.error('Failed to create invoice:', error);
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  };

  const handleMarkPaid = async (invoiceId) => {
    try {
      await invoicesAPI.pay(invoiceId);
      toast.success(t('success'));
      loadData();
    } catch (error) {
      console.error('Failed to mark as paid:', error);
      toast.error(t('error'));
    }
  };

  const handleStripePayment = async (invoiceId) => {
    setProcessingPayment(true);
    try {
      const response = await paymentsAPI.createCheckout(invoiceId);
      if (response.data.url) {
        window.location.href = response.data.url;
      }
    } catch (error) {
      console.error('Failed to create checkout:', error);
      toast.error(t('error'));
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleSendWhatsApp = (invoice) => {
    const phone = invoice.customer_phone || '';
    if (!phone) {
      toast.error(language === 'ar' ? 'لا يوجد رقم جوال' : 'No phone number');
      return;
    }
    
    const formattedPhone = phone.replace(/^0/, '966');
    const message = language === 'ar' 
      ? `مرحباً، فاتورتك من أكاديمية أداء الأبطال العالمية:
رقم الفاتورة: #${invoice.id.slice(0, 8)}
المبلغ: ${invoice.total} ر.س
الحالة: ${invoice.status === 'paid' ? 'مدفوعة' : 'غير مدفوعة'}
شكراً لكم.`
      : `Hello, your invoice from Champions Academy:
Invoice #: ${invoice.id.slice(0, 8)}
Amount: ${invoice.total} SAR
Status: ${invoice.status === 'paid' ? 'Paid' : 'Unpaid'}
Thank you.`;
    
    window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handlePrint = () => {
    const printContent = printRef.current;
    const printWindow = window.open('', '', 'width=800,height=600');
    printWindow.document.write(`
      <html>
        <head>
          <title>${language === 'ar' ? 'فاتورة' : 'Invoice'}</title>
          <style>
            body { font-family: 'Tajawal', Arial, sans-serif; direction: ${language === 'ar' ? 'rtl' : 'ltr'}; padding: 20px; }
            .invoice-header { display: flex; justify-content: space-between; border-bottom: 2px solid #F97316; padding-bottom: 20px; margin-bottom: 20px; }
            .logo { font-size: 24px; font-weight: bold; color: #F97316; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { padding: 12px; border: 1px solid #ddd; text-align: ${language === 'ar' ? 'right' : 'left'}; }
            th { background: #f5f5f5; }
            .total-row { font-weight: bold; font-size: 18px; }
            .customer-info { background: #f9f9f9; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
          </style>
        </head>
        <body>${printContent.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleExport = () => {
    const token = localStorage.getItem('token');
    const params = {};
    if (filterStatus !== 'all') params.status = filterStatus;
    if (filterStartDate) params.start_date = filterStartDate;
    if (filterEndDate) params.end_date = filterEndDate;
    
    const url = exportAPI.invoices(params) + `&token=${token}`;
    window.open(url, '_blank');
  };

  const handleSearch = async () => {
    setLoading(true);
    try {
      const params = {};
      if (searchTerm) params.q = searchTerm;
      if (filterStatus !== 'all') params.status = filterStatus;
      if (filterActivity !== 'all') params.activity_id = filterActivity;
      if (filterStartDate) params.start_date = filterStartDate;
      if (filterEndDate) params.end_date = filterEndDate;
      
      const response = await invoicesAPI.search(params);
      setInvoices(response.data);
    } catch (error) {
      console.error('Search failed:', error);
      // Fall back to client-side filtering
    } finally {
      setLoading(false);
    }
  };

  const resetFilters = () => {
    setSearchTerm('');
    setFilterStatus('all');
    setFilterActivity('all');
    setFilterStartDate('');
    setFilterEndDate('');
    loadData();
  };

  const closeCreateDialog = () => {
    setIsCreateDialogOpen(false);
    setSelectedMember(null);
    setSelectedActivities([]);
    setDiscount(0);
    setNotes('');
    setPaymentMethod('cash');
    setCustomerName('');
    setCustomerNameAr('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerAddress('');
  };

  const toggleActivitySelection = (activity) => {
    setSelectedActivities(prev => {
      const exists = prev.find(a => a.activity_id === activity.activity_id);
      if (exists) {
        return prev.filter(a => a.activity_id !== activity.activity_id);
      }
      return [...prev, activity];
    });
  };

  const calculateTotal = () => {
    const subtotal = selectedActivities.reduce((sum, a) => sum + a.fee, 0);
    return subtotal - (parseFloat(discount) || 0);
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      paid: { label: t('paid'), icon: CheckCircle, class: 'bg-green-500/15 text-green-600 border-green-500/30' },
      pending: { label: t('unpaid'), icon: Clock, class: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
      cancelled: { label: t('cancelled'), icon: XCircle, class: 'bg-red-500/15 text-red-600 border-red-500/30' }
    };
    const { label, icon: Icon, class: className } = statusMap[status] || statusMap.pending;
    return (
      <Badge variant="outline" className={className}>
        <Icon className="w-3 h-3 me-1" />
        {label}
      </Badge>
    );
  };

  // Client-side filtering for basic search
  const filteredInvoices = invoices.filter(invoice => {
    const matchesSearch = !searchTerm || 
      invoice.member_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      invoice.id?.includes(searchTerm) ||
      invoice.customer_phone?.includes(searchTerm);
    const matchesStatus = filterStatus === 'all' || invoice.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <Layout title={t('invoices')}>
        <div className="flex items-center justify-center h-64">
          <div className="spinner" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('invoices')}>
      <div className="space-y-6" data-testid="invoices-page">
        {/* Header */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <div className="flex flex-1 gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={language === 'ar' ? 'بحث برقم الفاتورة أو اسم العضو أو الجوال...' : 'Search by invoice #, member name or phone...'}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="ps-10"
                  data-testid="search-invoices"
                />
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[150px]" data-testid="filter-status">
                  <SelectValue placeholder={t('invoice_status')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('invoice_status')}</SelectItem>
                  <SelectItem value="pending">{t('unpaid')}</SelectItem>
                  <SelectItem value="paid">{t('paid')}</SelectItem>
                  <SelectItem value="cancelled">{t('cancelled')}</SelectItem>
                </SelectContent>
              </Select>
              <Button 
                variant="outline" 
                onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
              >
                <Filter className="w-4 h-4 me-2" />
                {language === 'ar' ? 'بحث متقدم' : 'Advanced Search'}
              </Button>
            </div>
            
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExport} data-testid="export-invoices-btn">
                <Download className="w-4 h-4 me-2" />
                {language === 'ar' ? 'تصدير Excel' : 'Export Excel'}
              </Button>
              <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="create-invoice-btn">
                <Plus className="w-4 h-4 me-2" />
                {t('create_invoice')}
              </Button>
            </div>
          </div>

          {/* Advanced Search Panel */}
          {showAdvancedSearch && (
            <Card className="p-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-2">
                  <Label>{t('activity_name')}</Label>
                  <Select value={filterActivity} onValueChange={setFilterActivity}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder={t('activities')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{language === 'ar' ? 'الكل' : 'All'}</SelectItem>
                      {activities.map(activity => (
                        <SelectItem key={activity.id} value={activity.id}>
                          {language === 'ar' ? activity.name_ar : activity.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('from')}</Label>
                  <Input
                    type="date"
                    value={filterStartDate}
                    onChange={(e) => setFilterStartDate(e.target.value)}
                    data-testid="filter-start-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('to')}</Label>
                  <Input
                    type="date"
                    value={filterEndDate}
                    onChange={(e) => setFilterEndDate(e.target.value)}
                    data-testid="filter-end-date"
                  />
                </div>
                <Button onClick={handleSearch} data-testid="search-btn">
                  <Search className="w-4 h-4 me-2" />
                  {t('search')}
                </Button>
                <Button variant="outline" onClick={resetFilters}>
                  <X className="w-4 h-4 me-2" />
                  {language === 'ar' ? 'مسح الفلاتر' : 'Clear Filters'}
                </Button>
              </div>
            </Card>
          )}
        </div>

        {/* Invoices List */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('invoice_number')}</th>
                    <th>{t('member_name')}</th>
                    <th>{t('phone')}</th>
                    <th>{t('total')}</th>
                    <th>{t('invoice_status')}</th>
                    <th>{t('invoice_date')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-muted-foreground">
                        {t('no_data')}
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.map(invoice => (
                      <tr key={invoice.id} data-testid={`invoice-row-${invoice.id}`}>
                        <td className="font-mono text-sm">
                          #{invoice.id.slice(0, 8)}
                        </td>
                        <td className="font-medium">{invoice.member_name}</td>
                        <td dir="ltr" className="text-sm">{invoice.customer_phone || '-'}</td>
                        <td className="font-bold text-primary">
                          {invoice.total} {t('sar')}
                        </td>
                        <td>{getStatusBadge(invoice.status)}</td>
                        <td className="text-sm text-muted-foreground">
                          {new Date(invoice.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}
                        </td>
                        <td>
                          <div className="action-buttons">
                            <button 
                              className="action-button"
                              onClick={() => {
                                setSelectedInvoice(invoice);
                                setIsViewDialogOpen(true);
                              }}
                              data-testid={`view-invoice-${invoice.id}`}
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button 
                              className="action-button text-green-600"
                              onClick={() => handleSendWhatsApp(invoice)}
                              title={language === 'ar' ? 'إرسال واتساب' : 'Send WhatsApp'}
                            >
                              <MessageSquare className="w-4 h-4" />
                            </button>
                            {invoice.status === 'pending' && (
                              <>
                                <button 
                                  className="action-button text-green-600"
                                  onClick={() => handleMarkPaid(invoice.id)}
                                  data-testid={`mark-paid-${invoice.id}`}
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </button>
                                <button 
                                  className="action-button text-blue-600"
                                  onClick={() => handleStripePayment(invoice.id)}
                                  disabled={processingPayment}
                                  data-testid={`stripe-pay-${invoice.id}`}
                                >
                                  <CreditCard className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Create Invoice Dialog */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('create_invoice')}</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              {/* Select Member */}
              <div className="space-y-2">
                <Label>{t('member_name')}</Label>
                <Select 
                  value={selectedMember?.id || ''} 
                  onValueChange={handleMemberSelect}
                >
                  <SelectTrigger data-testid="select-member">
                    <SelectValue placeholder={t('member_name')} />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map(member => (
                      <SelectItem key={member.id} value={member.id}>
                        {language === 'ar' ? member.name_ar : member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Customer Data Section */}
              {selectedMember && (
                <Card className="p-4 border-primary/20 bg-primary/5">
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-primary" />
                    {language === 'ar' ? 'بيانات العميل في الفاتورة' : 'Customer Data for Invoice'}
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{language === 'ar' ? 'اسم العميل (عربي)' : 'Customer Name (Arabic)'}</Label>
                      <Input
                        value={customerNameAr}
                        onChange={(e) => setCustomerNameAr(e.target.value)}
                        data-testid="customer-name-ar"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{language === 'ar' ? 'اسم العميل (English)' : 'Customer Name (English)'}</Label>
                      <Input
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        data-testid="customer-name-en"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('phone')}</Label>
                      <Input
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        type="tel"
                        dir="ltr"
                        data-testid="customer-phone"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('email')}</Label>
                      <Input
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        type="email"
                        dir="ltr"
                        data-testid="customer-email"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>{language === 'ar' ? 'العنوان' : 'Address'}</Label>
                      <Input
                        value={customerAddress}
                        onChange={(e) => setCustomerAddress(e.target.value)}
                        data-testid="customer-address"
                      />
                    </div>
                  </div>
                </Card>
              )}

              {/* Member Activities */}
              {selectedMember && selectedMember.activities?.length > 0 && (
                <div className="space-y-2">
                  <Label>{t('member_activities')}</Label>
                  <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
                    {selectedMember.activities.map((activity, idx) => (
                      <div 
                        key={idx}
                        className={`flex items-center justify-between p-3 bg-background rounded-lg border cursor-pointer transition-colors ${
                          selectedActivities.find(a => a.activity_id === activity.activity_id)
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        }`}
                        onClick={() => toggleActivitySelection(activity)}
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox 
                            checked={!!selectedActivities.find(a => a.activity_id === activity.activity_id)}
                            onCheckedChange={() => toggleActivitySelection(activity)}
                          />
                          <div>
                            <p className="font-medium">{activity.activity_name}</p>
                            <p className="text-sm text-muted-foreground">
                              {activity.start_date} - {activity.end_date}
                            </p>
                          </div>
                        </div>
                        <span className="font-bold text-primary">
                          {activity.fee} {t('sar')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Discount & Payment Method */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('discount')} ({t('sar')})</Label>
                  <Input
                    type="number"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    min="0"
                    data-testid="invoice-discount"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('payment_method')}</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger data-testid="payment-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{t('cash')}</SelectItem>
                      <SelectItem value="card">{t('card')}</SelectItem>
                      <SelectItem value="transfer">{t('transfer')}</SelectItem>
                      <SelectItem value="stripe">{t('online')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label>{t('notes')}</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  data-testid="invoice-notes"
                />
              </div>

              {/* Total */}
              {selectedActivities.length > 0 && (
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <div className="flex justify-between text-sm mb-2">
                    <span>{t('subtotal')}</span>
                    <span>{selectedActivities.reduce((sum, a) => sum + a.fee, 0)} {t('sar')}</span>
                  </div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>{t('discount')}</span>
                    <span>- {discount || 0} {t('sar')}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>{t('total')}</span>
                    <span className="text-primary">{calculateTotal()} {t('sar')}</span>
                  </div>
                </div>
              )}
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={closeCreateDialog}>
                {t('cancel')}
              </Button>
              <Button 
                onClick={handleCreateInvoice} 
                disabled={saving || !selectedMember || selectedActivities.length === 0}
                data-testid="save-invoice-btn"
              >
                {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                {t('create_invoice')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* View Invoice Dialog */}
        <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-primary" />
                {t('invoice_number')}: #{selectedInvoice?.id.slice(0, 8)}
              </DialogTitle>
            </DialogHeader>
            
            {selectedInvoice && (
              <div ref={printRef} className="invoice-print">
                {/* Invoice Header */}
                <div className="invoice-header">
                  <div className="flex items-center gap-3">
                    <Trophy className="w-8 h-8 text-primary" />
                    <div>
                      <h2 className="invoice-logo">{t('academy_name_short')}</h2>
                      <p className="text-sm text-muted-foreground">
                        {t('academy_name')}
                      </p>
                    </div>
                  </div>
                  <div className="invoice-details text-sm">
                    <p><strong>{t('invoice_number')}:</strong> #{selectedInvoice.id.slice(0, 8)}</p>
                    <p><strong>{t('invoice_date')}:</strong> {new Date(selectedInvoice.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</p>
                    <div className="mt-2">{getStatusBadge(selectedInvoice.status)}</div>
                  </div>
                </div>

                {/* Customer Info */}
                <div className="customer-info mb-4 p-3 bg-muted/50 rounded-lg">
                  <h4 className="font-semibold mb-2">{language === 'ar' ? 'بيانات العميل' : 'Customer Information'}</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <p><strong>{t('member_name')}:</strong> {selectedInvoice.customer_name_ar || selectedInvoice.member_name}</p>
                    <p><strong>{t('phone')}:</strong> <span dir="ltr">{selectedInvoice.customer_phone || '-'}</span></p>
                    {selectedInvoice.customer_email && (
                      <p><strong>{t('email')}:</strong> <span dir="ltr">{selectedInvoice.customer_email}</span></p>
                    )}
                    {selectedInvoice.customer_address && (
                      <p><strong>{language === 'ar' ? 'العنوان' : 'Address'}:</strong> {selectedInvoice.customer_address}</p>
                    )}
                  </div>
                </div>

                {/* Items Table */}
                <table className="invoice-table">
                  <thead>
                    <tr>
                      <th>{t('activity_name')}</th>
                      <th>{language === 'ar' ? 'الفترة' : 'Period'}</th>
                      <th>{t('monthly_fee')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedInvoice.items.map((item, idx) => (
                      <tr key={idx}>
                        <td>{item.activity_name}</td>
                        <td>{item.period}</td>
                        <td>{item.fee} {t('sar')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totals */}
                <div className="invoice-total space-y-2">
                  <div className="flex justify-between">
                    <span>{t('subtotal')}:</span>
                    <span>{selectedInvoice.subtotal} {t('sar')}</span>
                  </div>
                  {selectedInvoice.discount > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>{t('discount')}:</span>
                      <span>- {selectedInvoice.discount} {t('sar')}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xl font-bold border-t pt-2 total-row">
                    <span>{t('total')}:</span>
                    <span className="text-primary">{selectedInvoice.total} {t('sar')}</span>
                  </div>
                </div>

                {selectedInvoice.notes && (
                  <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                    <p className="text-sm"><strong>{t('notes')}:</strong> {selectedInvoice.notes}</p>
                  </div>
                )}
              </div>
            )}
            
            <DialogFooter className="no-print">
              <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>
                {t('close')}
              </Button>
              <Button variant="outline" onClick={() => handleSendWhatsApp(selectedInvoice)} data-testid="whatsapp-invoice-btn">
                <MessageSquare className="w-4 h-4 me-2" />
                {language === 'ar' ? 'إرسال واتساب' : 'Send WhatsApp'}
              </Button>
              <Button onClick={handlePrint} data-testid="print-invoice-btn">
                <Printer className="w-4 h-4 me-2" />
                {t('print')}
              </Button>
              {selectedInvoice?.status === 'pending' && (
                <Button 
                  onClick={() => handleStripePayment(selectedInvoice.id)}
                  disabled={processingPayment}
                  data-testid="pay-invoice-btn"
                >
                  {processingPayment ? (
                    <Loader2 className="w-4 h-4 me-2 animate-spin" />
                  ) : (
                    <CreditCard className="w-4 h-4 me-2" />
                  )}
                  {t('pay_now')}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default InvoicesPage;
