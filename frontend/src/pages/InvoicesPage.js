import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { invoicesAPI, membersAPI, activitiesAPI, exportAPI, productsAPI, branchesAPI, registrationFormsAPI, creditNotesAPI, levelsAPI, coachesAPI } from '../services/api';
import { toast } from 'sonner';
import {
  Plus, Search, Eye, Printer, Receipt, CheckCircle, XCircle, Clock,
  Filter, MessageSquare, X, Trash2, RotateCcw, FileSpreadsheet, Edit,
  FileText, RefreshCcw, ClipboardList, ArrowRightCircle, CreditCard, QrCode, Check, Circle
} from 'lucide-react';
import { COMPANY_INFO } from './invoices/constants';
import { calcEndDate } from './invoices/hooks/useInvoiceForm';
import { useInvoiceForm } from './invoices/hooks/useInvoiceForm';
import { useInvoiceActions } from './invoices/hooks/useInvoiceActions';
import { useViewInvoiceHandlers } from './invoices/hooks/useViewInvoiceHandlers';
import { useRegFormState } from './invoices/hooks/useRegFormState';
import { useQRCardPrint } from './invoices/hooks/useQRCardPrint';
import { useMemberCardPrint } from './invoices/hooks/useMemberCardPrint';
import { AddMemberDialog } from './invoices/components/dialogs/AddMemberDialog';
import { CreateEditInvoiceDialog } from './invoices/components/dialogs/CreateEditInvoiceDialog';
import { ViewInvoiceDialog } from './invoices/components/dialogs/ViewInvoiceDialog';
import { RefundDialog } from './invoices/components/dialogs/RefundDialog';
import { ViewCreditNoteDialog } from './invoices/components/dialogs/ViewCreditNoteDialog';
import { RegFormsPasswordDialog } from './invoices/components/dialogs/RegFormsPasswordDialog';
import { RegistrationFormDialog } from './invoices/components/dialogs/RegistrationFormDialog';
import { ViewRegFormDialog } from './invoices/components/dialogs/ViewRegFormDialog';
import { EditRegFormDialog } from './invoices/components/dialogs/EditRegFormDialog';
import { QRCardDialog } from './invoices/components/dialogs/QRCardDialog';
import { CardPrintDialog } from './invoices/components/dialogs/CardPrintDialog';
import { RegFormCardPrintDialog } from './invoices/components/dialogs/RegFormCardPrintDialog';

import { verifyOperationPassword } from '../utils/operationPassword';

export const InvoicesPage = () => {
  const { t, language } = useLanguage();
  const { user, selectedBranchId, isAdmin } = useAuth();
  const printRef = useRef();

  const [invoices, setInvoices] = useState([]);
  const [members, setMembers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [branches, setBranches] = useState([]);
  const [levels, setLevels] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [products, setProducts] = useState([]);
  const [registrationForms, setRegistrationForms] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [loyaltySettings, setLoyaltySettings] = useState(null);
  const [loyaltyLevelSettings, setLoyaltyLevelSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterActivity, setFilterActivity] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [activeTab, setActiveTab] = useState('invoices');

  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);
  const [addMemberSource, setAddMemberSource] = useState('invoice');
  const [newMemberData, setNewMemberData] = useState({ name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: '' });

  const [showRegFormsPasswordDialog, setShowRegFormsPasswordDialog] = useState(false);
  const [regFormsPasswordInput, setRegFormsPasswordInput] = useState('');

  const loadData = async () => {
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const [invRes, memRes, actRes, prodRes, brRes, rfRes, cnRes, lvRes, coachRes, loyPtsRes, loyLvlRes] = await Promise.all([
        invoicesAPI.getAll(branchParams), membersAPI.getAll(branchParams), activitiesAPI.getAll(), productsAPI.getAll(branchParams),
        branchesAPI.getAll(), registrationFormsAPI.getAll(branchParams), creditNotesAPI.getAll(branchParams), levelsAPI.getAll(branchParams),
        coachesAPI.getAll().catch(() => ({ data: [] })),
        fetch('/api/loyalty/settings/points').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/loyalty/settings/levels').then(r => r.ok ? r.json() : null).catch(() => null)
      ]);
      setInvoices(invRes.data || []); setMembers(memRes.data || []); setActivities(actRes.data || []);
      setProducts(prodRes.data || []); setBranches(brRes.data || []); setRegistrationForms(rfRes.data || []);
      setCreditNotes(cnRes.data || []); setLevels(lvRes.data || []); setCoaches(coachRes.data || []);
      setLoyaltySettings(loyPtsRes); setLoyaltyLevelSettings(loyLvlRes);
    } catch { toast.error(t('error')); } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [selectedBranchId]);

  const location = useLocation();
  const navigate = useNavigate();
  const handledViewIdRef = useRef(null);

  const getBranchName = (branchId) => {
    if (!branchId) return language === 'ar' ? 'الفرع الرئيسي' : 'Main Branch';
    const branch = branches.find(b => b.id === branchId);
    return branch?.name_ar || branch?.name || branchId;
  };

  const getStatusBadge = (status) => {
    const map = {
      paid: { label: t('paid'), icon: CheckCircle, cls: 'bg-green-500/15 text-green-600 border-green-500/30' },
      pending: { label: t('unpaid'), icon: Clock, cls: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
      cancelled: { label: t('cancelled'), icon: XCircle, cls: 'bg-red-500/15 text-red-600 border-red-500/30' },
      refunded: { label: language === 'ar' ? 'مسترجع' : 'Refunded', icon: RefreshCcw, cls: 'bg-purple-500/15 text-purple-600 border-purple-500/30' },
      partially_refunded: { label: language === 'ar' ? 'مسترجع جزئياً' : 'Partially Refunded', icon: RefreshCcw, cls: 'bg-purple-500/15 text-purple-600 border-purple-500/30' }
    };
    const { label, icon: Icon, cls } = map[status] || map.pending;
    return <Badge variant="outline" className={cls}><Icon className="w-3 h-3 me-1" />{label}</Badge>;
  };

  const filteredInvoices = invoices.filter(inv => {
    const matchSearch = !searchTerm || inv.member_name?.toLowerCase().includes(searchTerm.toLowerCase()) || inv.id?.includes(searchTerm) || inv.customer_phone?.includes(searchTerm);
    const matchStatus = filterStatus === 'all' || inv.status === filterStatus;
    const matchActivity = filterActivity === 'all' || inv.items?.some(item => item.activity_id === filterActivity);
    const invDate = inv.created_at ? inv.created_at.split('T')[0] : '';
    const matchStart = !filterStartDate || invDate >= filterStartDate;
    const matchEnd = !filterEndDate || invDate <= filterEndDate;
    return matchSearch && matchStatus && matchActivity && matchStart && matchEnd;
  });

  const qrCardHook = useQRCardPrint({ language });
  const { isQRCardDialogOpen, setIsQRCardDialogOpen, qrCardMember, setQrCardMember, qrCardSubscription, setQrCardSubscription, handleOpenQRCard, handlePrintQRCard, handleSendQRCardWhatsApp } = qrCardHook;

  const memberCardHook = useMemberCardPrint({ members, language });
  const { showCardPrintDialog, setShowCardPrintDialog, cardPrintMember, showRegFormCardPrintDialog, setShowRegFormCardPrintDialog, regFormCardData, setRegFormCardData, handleOpenCardPrint, handleStickerPrint, handleRegFormStickerPrint, handlePrintRegFormCard } = memberCardHook;

  const invoiceActions = useInvoiceActions({ loadData, language, t, isAdmin, getBranchName, setInvoices });
  const {
    selectedInvoice, setSelectedInvoice, qrCode, isViewDialogOpen, setIsViewDialogOpen,
    isRefundDialogOpen, setIsRefundDialogOpen, refundType, setRefundType,
    refundAmount, setRefundAmount, refundReason, setRefundReason, refundSaving,
    isViewCreditNoteDialogOpen, setIsViewCreditNoteDialogOpen, selectedCreditNote,
    handleViewInvoice, handleMarkPaid, handleRestoreInvoice, handleCancelInvoice,
    handleDeleteInvoice, openRefundDialog, handleRefund,
    handleViewCreditNote, handleDeleteCreditNote, handlePrintCreditNote,
    handleExportAllData, handleToggleInvoiceCheck,
  } = invoiceActions;

  const regFormHook = useRegFormState({
    activities, products, levels, selectedBranchId, language, t, loadData,
    loyaltySettings, loyaltyLevelSettings, branches, getBranchName,
    setMembers, setIsAddMemberDialogOpen, setAddMemberSource, setRegistrationForms
  });

  const invoiceForm = useInvoiceForm({
    members, activities, products, levels, selectedBranchId, language, t, loadData,
    setIsViewDialogOpen, setIsAddMemberDialogOpen, setAddMemberSource,
    setQrCardMember, setQrCardSubscription, setIsQRCardDialogOpen
  });

  const [langOverride, setLangOverride] = useState(null);
  useEffect(() => { setLangOverride(null); }, [selectedInvoice?.id]);
  const viewHandlers = useViewInvoiceHandlers({
    selectedInvoice, printRef, qrCode, loyaltySettings, loyaltyLevelSettings,
    language, t, getBranchName, setIsViewDialogOpen, langOverride, branches
  });

  const { isCreateDialogOpen, setIsCreateDialogOpen, isEditMode, selectedMember, setSelectedMember, invoiceItems, setInvoiceItems,
    notes, setNotes, paymentMethod, setPaymentMethod, saving, setSaving, couponCode, setCouponCode, appliedCoupon, setAppliedCoupon,
    couponDiscount, setCouponDiscount, validatingCoupon, itemType, setItemType, feeEditUnlocked, additionalMembers, setAdditionalMembers,
    additionalMemberNewForm, setAdditionalMemberNewForm, levelCapacityWarnings, levelSelectorState, customerNameAr, setCustomerNameAr,
    customerPhone, setCustomerPhone, customerAddress, setCustomerAddress, MAIN_ACTIVITIES_FOR_LEVELS, groupedLevelsForSelector, getGroupedLevelsForDays,
    parseActivityForLevel, subtotal, vatAmount, totalBeforeDiscount, totalDiscount, total, handleMemberSelect, addProductToInvoice,
    addActivityToInvoice, validateCoupon, removeCoupon, updateItemFee, updateItemDate, updateItemWeeks, removeItem, updateItemSchedule,
    updateItemLevel, handleAcceptFullLevel, handleRejectFullLevel, initLevelSelector, selectLevelActivity, selectLevelTime,
    goBackLevelSelector, resetLevelSelector, unlockFeeEdit, handleCreateInvoice, openEditDialog, closeCreateDialog
  } = invoiceForm;

  const { savingPdf, sharingWhatsApp, handleSaveAsPdfOnly, handleSaveAsPdf, handleShareWhatsApp, handleSendWhatsApp, handlePrint, handlePrintRegistrationForm } = viewHandlers;

  // Auto-open an invoice when navigated here with ?view=<invoice_id> (e.g. from global search).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const viewId = params.get('view');
    if (!viewId || loading || !invoices.length) return;
    if (handledViewIdRef.current === viewId) return;
    const inv = invoices.find(i => i.id === viewId || String(i.invoice_number) === String(viewId));
    if (!inv) return;
    handledViewIdRef.current = viewId;
    handleViewInvoice(inv);
    // Clean the param so refreshing the page doesn't re-open the dialog.
    params.delete('view');
    const next = params.toString();
    navigate({ pathname: location.pathname, search: next ? `?${next}` : '' }, { replace: true });
  }, [location.search, loading, invoices, handleViewInvoice, navigate, location.pathname]);

  const { isRegistrationFormDialogOpen, setIsRegistrationFormDialogOpen, isViewRegFormDialogOpen, setIsViewRegFormDialogOpen,
    isEditRegFormDialogOpen, setIsEditRegFormDialogOpen, selectedRegForm, editRegFormId, regFormData, setRegFormData,
    regFormItems, setRegFormItems, regFormDiscount, setRegFormDiscount, regFormNotes, setRegFormNotes, regFormPaymentMethod,
    setRegFormPaymentMethod, regFormCouponCode, setRegFormCouponCode, regFormAppliedCoupon, setRegFormAppliedCoupon,
    regFormCouponDiscount, setRegFormCouponDiscount, regFormItemType, setRegFormItemType, regFormAdditionalMembers, setRegFormAdditionalMembers,
    regFormAdditionalMemberNewForm, setRegFormAdditionalMemberNewForm, regFormLevelWarnings, regFormLevelSelectorState,
    addActivityToRegForm, addProductToRegForm, removeActivityFromRegForm, initRegFormLevelSelector, selectRegFormLevelActivity,
    selectRegFormLevelTime, goBackRegFormLevelSelector, resetRegFormLevelSelector, updateRegFormItemLevel,
    handleAcceptRegFormFullLevel, handleRejectRegFormFullLevel, validateRegFormCoupon, closeRegistrationFormDialog, closeEditRegFormDialog,
    handlePrintNewRegistrationForm, handleSaveRegistrationFormOnly, handleConvertFormToInvoice, handleDeleteRegForm,
    handleViewRegForm, handleSaveRegFormPdf, handlePrintViewedRegForm, handleSendRegFormWhatsApp, handleEditRegForm, handleSaveEditedRegForm,
    handleToggleRegFormCheck
  } = regFormHook;

  const handleTabChange = (tab) => {
    if (tab === 'forms') { setRegFormsPasswordInput(''); setShowRegFormsPasswordDialog(true); return; }
    setActiveTab(tab);
  };

  const handleRegFormsPasswordConfirm = async () => {
    const ok = await verifyOperationPassword('reg_forms', regFormsPasswordInput, selectedBranchId);
    if (!ok) { toast.error(language === 'ar' ? 'كلمة المرور غير صحيحة' : 'Incorrect password'); setRegFormsPasswordInput(''); return; }
    setShowRegFormsPasswordDialog(false); setRegFormsPasswordInput(''); setActiveTab('forms');
  };

  const handleCreateMember = async () => {
    if (!newMemberData.name_ar || !newMemberData.phone) { toast.error(language === 'ar' ? 'أدخل الاسم ورقم الجوال' : 'Enter name and phone'); return; }
    setSaving(true);
    try {
      const itemsToUse = addMemberSource === 'registration' ? regFormItems : invoiceItems;
      const memberActivities = itemsToUse.filter(item => !item.is_product && item.activity_id).map(item => ({ activity_id: item.activity_id, activity_name: item.activity_name, start_date: item.start_date || new Date().toISOString().split('T')[0], end_date: item.end_date || new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0], fee: item.fee || 0, status: 'active', coach_id: '' }));
      const res = await membersAPI.create({ ...newMemberData, age: parseInt(newMemberData.age) || 0, activities: memberActivities, branch_id: selectedBranchId !== 'all' ? selectedBranchId : null });
      const memRes = await membersAPI.getAll(); setMembers(memRes.data);
      if (addMemberSource === 'registration') { setRegFormData({ ...regFormData, customer_name: res.data.name_ar, customer_phone: res.data.phone }); }
      else { setSelectedMember(res.data); setCustomerNameAr(res.data.name_ar); setCustomerPhone(res.data.phone); }
      setIsAddMemberDialogOpen(false); setNewMemberData({ name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: '' });
      toast.success(language === 'ar' ? 'تم إضافة العضو وحفظه في قائمة الأعضاء' : 'Member added and saved to members list');
    } catch { toast.error(t('error')); } finally { setSaving(false); }
  };

  if (loading) return <Layout title={t('invoices')}><div className="flex items-center justify-center h-64"><div className="spinner" /></div></Layout>;

  return (
    <Layout title={t('invoices')}>
      <div className="space-y-6" data-testid="invoices-page">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <div className="flex flex-1 gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder={language === 'ar' ? 'بحث...' : 'Search...'} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="ps-10" />
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
              {isAdmin && (<>
              <Button variant="outline" onClick={handleExportAllData} data-testid="export-all-btn"><FileSpreadsheet className="w-4 h-4 me-2" />{language === 'ar' ? 'تصدير Excel' : 'Export Excel'}</Button>
              <Button variant="outline" onClick={() => { const token = localStorage.getItem('token'); window.open(exportAPI.invoicesPdf() + `&token=${token}`, '_blank'); }}><FileSpreadsheet className="w-4 h-4 me-2" />{language === 'ar' ? 'تصدير PDF' : 'Export PDF'}</Button>
              </>)}
              <Button variant="outline" onClick={() => setIsRegistrationFormDialogOpen(true)} className="bg-gray-800 text-white hover:bg-gray-900" data-testid="create-registration-form-btn"><FileText className="w-4 h-4 me-2" />{language === 'ar' ? 'استمارة تسجيل' : 'Registration Form'}</Button>
              <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="create-invoice-btn"><Plus className="w-4 h-4 me-2" />{t('create_invoice')}</Button>
            </div>
          </div>
          {showAdvancedSearch && (
            <Card className="p-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-2"><Label>{t('activity_name')}</Label>
                  <Select value={filterActivity} onValueChange={setFilterActivity}><SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">{language === 'ar' ? 'الكل' : 'All'}</SelectItem>
                      {(activities || []).filter(a => a.id).map(a => <SelectItem key={a.id} value={a.id}>{language === 'ar' ? a.name_ar : a.name}</SelectItem>)}
                    </SelectContent></Select></div>
                <div className="space-y-2"><Label>{t('from')}</Label><Input type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} className="h-14 text-lg w-48" /></div>
                <div className="space-y-2"><Label>{t('to')}</Label><Input type="date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} className="h-14 text-lg w-48" /></div>
                <Button onClick={loadData}><Search className="w-4 h-4 me-2" />{t('search')}</Button>
              </div>
            </Card>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="invoices"><Receipt className="w-4 h-4 me-2" />{t('invoices')}</TabsTrigger>
            <TabsTrigger value="credit_notes"><RefreshCcw className="w-4 h-4 me-2" />{language === 'ar' ? 'إشعارات الدائن' : 'Credit Notes'}</TabsTrigger>
            <TabsTrigger value="forms"><ClipboardList className="w-4 h-4 me-2" />{language === 'ar' ? 'استمارات التسجيل' : 'Registration Forms'}</TabsTrigger>
          </TabsList>

          <TabsContent value="invoices">
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-start">{language === 'ar' ? 'رقم الفاتورة' : 'Invoice #'}</th>
                        <th className="p-3 text-start">{language === 'ar' ? 'العميل' : 'Customer'}</th>
                        <th className="p-3 text-start">{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                        <th className="p-3 text-start">{t('status')}</th>
                        <th className="p-3 text-start">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                        <th className="p-3 text-start">{language === 'ar' ? 'الإجراءات' : 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInvoices.map(inv => (
                        <tr key={inv.id} className="border-t hover:bg-muted/30">
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <button onClick={() => handleToggleInvoiceCheck(inv.id)} className="text-gray-400 hover:text-green-500 transition-colors">
                                {inv.is_checked ? <Check className="w-4 h-4 text-green-500" /> : <Circle className="w-4 h-4" />}
                              </button>
                              <span className="font-mono text-xs">{inv.invoice_number || inv.id?.slice(-6)}</span>
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="font-medium">{inv.customer_name_ar || inv.member_name}</div>
                            {(inv.guardian_name_ar || inv.guardian_name) && (
                              <div className="text-xs text-blue-600">{language === 'ar' ? 'ولي الأمر' : 'Guardian'}: {inv.guardian_name_ar || inv.guardian_name}</div>
                            )}
                            <div className="text-xs text-muted-foreground">{inv.customer_phone}</div>
                          </td>
                          <td className="p-3 font-semibold">{inv.total?.toFixed(2)} {language === 'ar' ? 'ر.س' : 'SAR'}</td>
                          <td className="p-3">{getStatusBadge(inv.status)}</td>
                          <td className="p-3 text-xs text-muted-foreground">{new Date(inv.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</td>
                          <td className="p-3">
                            <div className="flex gap-1 flex-wrap">
                              <Button variant="ghost" size="sm" onClick={() => handleViewInvoice(inv)}><Eye className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="sm" onClick={() => openEditDialog(inv)}><Edit className="w-4 h-4" /></Button>
                              {inv.status === 'pending' && <Button variant="ghost" size="sm" onClick={() => handleMarkPaid(inv.id)} className="text-green-600"><CheckCircle className="w-4 h-4" /></Button>}
                              {inv.status === 'cancelled' && <Button variant="ghost" size="sm" onClick={() => handleRestoreInvoice(inv.id)} className="text-blue-600"><RotateCcw className="w-4 h-4" /></Button>}
                              {inv.status === 'pending' && <Button variant="ghost" size="sm" onClick={() => handleCancelInvoice(inv.id)} className="text-orange-500"><XCircle className="w-4 h-4" /></Button>}
                              {inv.status === 'paid' && <Button variant="ghost" size="sm" onClick={() => openRefundDialog(inv)} className="text-purple-600"><RefreshCcw className="w-4 h-4" /></Button>}
                              <Button variant="ghost" size="sm" onClick={() => handleSendWhatsApp(inv)} className="text-green-500"><MessageSquare className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="sm" onClick={() => handleOpenCardPrint(inv)} className="text-blue-500"><CreditCard className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="sm" onClick={() => handleOpenQRCard(inv)} className="text-indigo-500"><QrCode className="w-4 h-4" /></Button>
                              {isAdmin && <Button variant="ghost" size="sm" onClick={() => handleDeleteInvoice(inv.id, inv.status, inv.branch_id)} className="text-red-500"><Trash2 className="w-4 h-4" /></Button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredInvoices.length === 0 && (
                        <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">{language === 'ar' ? 'لا توجد فواتير' : 'No invoices found'}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="credit_notes">
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-start">{language === 'ar' ? 'رقم الإشعار' : 'Credit Note #'}</th>
                        <th className="p-3 text-start">{language === 'ar' ? 'الفاتورة الأصلية' : 'Original Invoice'}</th>
                        <th className="p-3 text-start">{language === 'ar' ? 'العميل' : 'Customer'}</th>
                        <th className="p-3 text-start">{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                        <th className="p-3 text-start">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                        <th className="p-3 text-start">{language === 'ar' ? 'الإجراءات' : 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditNotes.map(cn => (
                        <tr key={cn.id} className="border-t hover:bg-muted/30">
                          <td className="p-3 font-mono text-xs">{cn.credit_note_number}</td>
                          <td className="p-3 font-mono text-xs">{cn.original_invoice_number}</td>
                          <td className="p-3">
                            <div className="font-medium">{cn.customer_name_ar}</div>
                            <div className="text-xs text-muted-foreground">{cn.customer_phone}</div>
                          </td>
                          <td className="p-3 font-semibold text-purple-600">{cn.refund_amount?.toFixed(2)} {language === 'ar' ? 'ر.س' : 'SAR'}</td>
                          <td className="p-3 text-xs text-muted-foreground">{new Date(cn.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</td>
                          <td className="p-3">
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" onClick={() => handleViewCreditNote(cn)}><Eye className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="sm" onClick={() => handlePrintCreditNote(cn)}><Printer className="w-4 h-4" /></Button>
                              {isAdmin && <Button variant="ghost" size="sm" onClick={() => handleDeleteCreditNote(cn.id)} className="text-red-500"><Trash2 className="w-4 h-4" /></Button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {creditNotes.length === 0 && (
                        <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">{language === 'ar' ? 'لا توجد إشعارات دائن' : 'No credit notes found'}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="forms">
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-start">{language === 'ar' ? 'رقم الاستمارة' : 'Form #'}</th>
                        <th className="p-3 text-start">{language === 'ar' ? 'العميل' : 'Customer'}</th>
                        <th className="p-3 text-start">{language === 'ar' ? 'الإجمالي' : 'Total'}</th>
                        <th className="p-3 text-start">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                        <th className="p-3 text-start">{language === 'ar' ? 'الإجراءات' : 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registrationForms.map(form => (
                        <tr key={form.id} className="border-t hover:bg-muted/30">
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <button onClick={() => handleToggleRegFormCheck(form.id)} className="text-gray-400 hover:text-green-500 transition-colors">
                                {form.is_checked ? <Check className="w-4 h-4 text-green-500" /> : <Circle className="w-4 h-4" />}
                              </button>
                              <span className="font-mono text-xs">{form.form_number || form.id?.slice(-6)}</span>
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="font-medium">{form.customer_name}</div>
                            <div className="text-xs text-muted-foreground">{form.customer_phone}</div>
                          </td>
                          <td className="p-3 font-semibold">{form.total?.toFixed(2)} {language === 'ar' ? 'ر.س' : 'SAR'}</td>
                          <td className="p-3 text-xs text-muted-foreground">{new Date(form.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</td>
                          <td className="p-3">
                            <div className="flex gap-1 flex-wrap">
                              <Button variant="ghost" size="sm" onClick={() => handleViewRegForm(form)}><Eye className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="sm" onClick={() => handleEditRegForm(form)}><Edit className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="sm" onClick={() => handleSendRegFormWhatsApp(form)} className="text-green-500"><MessageSquare className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="sm" onClick={() => handlePrintRegFormCard(form)} className="text-blue-500"><CreditCard className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="sm" onClick={() => handleConvertFormToInvoice(form.id)} className="text-blue-600"><ArrowRightCircle className="w-4 h-4" /></Button>
                              {isAdmin && <Button variant="ghost" size="sm" onClick={() => handleDeleteRegForm(form.id)} className="text-red-500"><Trash2 className="w-4 h-4" /></Button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {registrationForms.length === 0 && (
                        <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">{language === 'ar' ? 'لا توجد استمارات تسجيل' : 'No registration forms found'}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <CreateEditInvoiceDialog
          isOpen={isCreateDialogOpen} onOpenChange={open => { if (!open) closeCreateDialog(); else setIsCreateDialogOpen(true); }}
          isEditMode={isEditMode} members={members} activities={activities} products={products} levels={levels} coaches={coaches}
          selectedMember={selectedMember} handleMemberSelect={handleMemberSelect}
          customerNameAr={customerNameAr} setCustomerNameAr={setCustomerNameAr}
          customerPhone={customerPhone} setCustomerPhone={setCustomerPhone}
          invoiceItems={invoiceItems} setInvoiceItems={setInvoiceItems}
          itemType={itemType} setItemType={setItemType}
          paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
          couponCode={couponCode} setCouponCode={setCouponCode}
          appliedCoupon={appliedCoupon} setAppliedCoupon={setAppliedCoupon}
          couponDiscount={couponDiscount} setCouponDiscount={setCouponDiscount}
          validatingCoupon={validatingCoupon} notes={notes} setNotes={setNotes}
          subtotal={subtotal} vatAmount={vatAmount} total={total}
          saving={saving} additionalMembers={additionalMembers} setAdditionalMembers={setAdditionalMembers}
          additionalMemberNewForm={additionalMemberNewForm} setAdditionalMemberNewForm={setAdditionalMemberNewForm}
          levelSelectorState={levelSelectorState} levelCapacityWarnings={levelCapacityWarnings}
          feeEditUnlocked={feeEditUnlocked} groupedLevelsForSelector={groupedLevelsForSelector} getGroupedLevelsForDays={getGroupedLevelsForDays}
          addActivityToInvoice={addActivityToInvoice} addProductToInvoice={addProductToInvoice} removeItem={removeItem}
          updateItemDate={updateItemDate} updateItemWeeks={updateItemWeeks} updateItemFee={updateItemFee}
          initLevelSelector={initLevelSelector} goBackLevelSelector={goBackLevelSelector} resetLevelSelector={resetLevelSelector}
          selectLevelActivity={selectLevelActivity} selectLevelTime={selectLevelTime} updateItemLevel={updateItemLevel}
          handleAcceptFullLevel={handleAcceptFullLevel} handleRejectFullLevel={handleRejectFullLevel}
          unlockFeeEdit={unlockFeeEdit} validateCoupon={validateCoupon}
          closeCreateDialog={closeCreateDialog} handleCreateInvoice={handleCreateInvoice}
          calcEndDate={calcEndDate} parseActivityForLevel={parseActivityForLevel}
          language={language} t={t}
        />

        <ViewInvoiceDialog
          isOpen={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}
          selectedInvoice={selectedInvoice} qrCode={qrCode} printRef={printRef}
          getBranchName={getBranchName} getStatusBadge={getStatusBadge}
          onPrint={handlePrint} onShareWhatsApp={handleShareWhatsApp}
          onSaveAsPdf={handleSaveAsPdf} onSaveAsPdfOnly={handleSaveAsPdfOnly}
          onPrintRegistrationForm={handlePrintRegistrationForm}
          onEdit={openEditDialog} onMarkPaid={handleMarkPaid}
          onRestoreInvoice={handleRestoreInvoice} onOpenRefund={openRefundDialog}
          onDelete={handleDeleteInvoice}
          sharingWhatsApp={sharingWhatsApp} savingPdf={savingPdf} saving={saving} isAdmin={isAdmin}
          langOverride={langOverride} setLangOverride={setLangOverride}
          language={language} t={t}
        />

        <RefundDialog
          isOpen={isRefundDialogOpen} onOpenChange={setIsRefundDialogOpen}
          selectedInvoice={selectedInvoice} refundType={refundType} setRefundType={setRefundType}
          refundAmount={refundAmount} setRefundAmount={setRefundAmount}
          refundReason={refundReason} setRefundReason={setRefundReason}
          saving={refundSaving} onRefund={handleRefund} language={language} t={t}
        />

        <ViewCreditNoteDialog
          isOpen={isViewCreditNoteDialogOpen} onOpenChange={setIsViewCreditNoteDialogOpen}
          selectedCreditNote={selectedCreditNote} onPrint={handlePrintCreditNote}
          language={language} t={t}
        />

        <RegFormsPasswordDialog
          isOpen={showRegFormsPasswordDialog} onOpenChange={setShowRegFormsPasswordDialog}
          passwordInput={regFormsPasswordInput} setPasswordInput={setRegFormsPasswordInput}
          onConfirm={handleRegFormsPasswordConfirm} language={language}
        />

        <RegistrationFormDialog
          isOpen={isRegistrationFormDialogOpen} onOpenChange={open => { if (!open) closeRegistrationFormDialog(); else setIsRegistrationFormDialogOpen(true); }}
          editRegFormId={null}
          members={members} activities={activities} products={products} levels={levels}
          regFormData={regFormData} setRegFormData={setRegFormData}
          regFormItems={regFormItems} setRegFormItems={setRegFormItems}
          regFormItemType={regFormItemType} setRegFormItemType={setRegFormItemType}
          regFormPaymentMethod={regFormPaymentMethod} setRegFormPaymentMethod={setRegFormPaymentMethod}
          regFormNotes={regFormNotes} setRegFormNotes={setRegFormNotes}
          regFormCouponCode={regFormCouponCode} setRegFormCouponCode={setRegFormCouponCode}
          regFormAppliedCoupon={regFormAppliedCoupon} setRegFormAppliedCoupon={setRegFormAppliedCoupon}
          regFormCouponDiscount={regFormCouponDiscount} setRegFormCouponDiscount={setRegFormCouponDiscount}
          regFormDiscount={regFormDiscount}
          regFormAdditionalMembers={regFormAdditionalMembers} setRegFormAdditionalMembers={setRegFormAdditionalMembers}
          regFormAdditionalMemberNewForm={regFormAdditionalMemberNewForm} setRegFormAdditionalMemberNewForm={setRegFormAdditionalMemberNewForm}
          regFormLevelSelectorState={regFormLevelSelectorState} regFormLevelWarnings={regFormLevelWarnings}
          addActivityToRegForm={addActivityToRegForm} addProductToRegForm={addProductToRegForm} removeActivityFromRegForm={removeActivityFromRegForm}
          initRegFormLevelSelector={initRegFormLevelSelector} goBackRegFormLevelSelector={goBackRegFormLevelSelector}
          resetRegFormLevelSelector={resetRegFormLevelSelector} selectRegFormLevelActivity={selectRegFormLevelActivity}
          selectRegFormLevelTime={selectRegFormLevelTime} updateRegFormItemLevel={updateRegFormItemLevel}
          handleAcceptRegFormFullLevel={handleAcceptRegFormFullLevel} handleRejectRegFormFullLevel={handleRejectRegFormFullLevel}
          validateRegFormCoupon={validateRegFormCoupon}
          closeRegistrationFormDialog={closeRegistrationFormDialog}
          handleSaveRegistrationFormOnly={handleSaveRegistrationFormOnly}
          handlePrintNewRegistrationForm={handlePrintNewRegistrationForm}
          calcEndDate={calcEndDate} groupedLevelsForSelector={groupedLevelsForSelector} getGroupedLevelsForDays={getGroupedLevelsForDays}
          setAddMemberSource={setAddMemberSource} setIsAddMemberDialogOpen={setIsAddMemberDialogOpen} setMembers={setMembers}
          coaches={coaches}
          language={language} t={t}
        />

        <ViewRegFormDialog
          isOpen={isViewRegFormDialogOpen} onOpenChange={setIsViewRegFormDialogOpen}
          selectedRegForm={selectedRegForm}
          onPrint={handlePrintViewedRegForm} onSavePdf={handleSaveRegFormPdf}
          onSendWhatsApp={handleSendRegFormWhatsApp} onEdit={handleEditRegForm}
          onConvert={id => handleConvertFormToInvoice(id)}
          language={language} t={t}
        />

        <EditRegFormDialog
          isOpen={isEditRegFormDialogOpen} onOpenChange={open => { if (!open) closeEditRegFormDialog(); }}
          regFormData={regFormData} setRegFormData={setRegFormData}
          regFormItems={regFormItems} setRegFormItems={setRegFormItems}
          regFormItemType={regFormItemType} setRegFormItemType={setRegFormItemType}
          regFormPaymentMethod={regFormPaymentMethod} setRegFormPaymentMethod={setRegFormPaymentMethod}
          regFormNotes={regFormNotes} setRegFormNotes={setRegFormNotes}
          regFormDiscount={regFormDiscount} regFormCouponDiscount={regFormCouponDiscount}
          activities={activities} products={products}
          addActivityToRegForm={addActivityToRegForm} addProductToRegForm={addProductToRegForm}
          removeActivityFromRegForm={removeActivityFromRegForm}
          closeEditRegFormDialog={closeEditRegFormDialog} handleSaveEditedRegForm={handleSaveEditedRegForm}
          language={language} t={t}
        />

        <AddMemberDialog
          isOpen={isAddMemberDialogOpen} onOpenChange={setIsAddMemberDialogOpen}
          newMemberData={newMemberData} setNewMemberData={setNewMemberData}
          saving={saving} onSubmit={handleCreateMember} language={language} t={t}
        />

        <QRCardDialog
          isOpen={isQRCardDialogOpen} onOpenChange={open => { if (!open) { setIsQRCardDialogOpen(false); setQrCardSubscription(null); } else setIsQRCardDialogOpen(true); }}
          qrCardMember={qrCardMember} onPrint={handlePrintQRCard} onSendWhatsApp={handleSendQRCardWhatsApp} language={language}
        />

        <CardPrintDialog
          isOpen={showCardPrintDialog} onOpenChange={setShowCardPrintDialog}
          cardPrintMember={cardPrintMember} onPrint={handleStickerPrint} language={language}
        />

        <RegFormCardPrintDialog
          isOpen={showRegFormCardPrintDialog} onOpenChange={setShowRegFormCardPrintDialog}
          regFormCardData={regFormCardData} onPrint={handleRegFormStickerPrint} language={language}
        />
      </div>
    </Layout>
  );
};

export default InvoicesPage;
