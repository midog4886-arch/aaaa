import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { toast } from 'sonner';
import { 
  accountsAPI, 
  suppliersAPI, 
  purchaseInvoicesAPI, 
  supplierPaymentsAPI,
  journalEntriesAPI,
  accountingReportsAPI,
  productsAPI,
  exportAccountingAPI,
  reportsAPI,
  internalExpensesAPI
} from '../services/api';

// Tab components
const TABS = {
  ACCOUNTS: 'accounts',
  SUPPLIERS: 'suppliers',
  PURCHASES: 'purchases',
  PAYMENTS: 'payments',
  EXPENSES: 'expenses',
  JOURNAL: 'journal',
  REPORTS: 'reports',
  VAT: 'vat'
};

const ACCOUNT_TYPES = [
  { value: 'assets', label: 'الأصول', color: 'bg-blue-100 text-blue-800' },
  { value: 'liabilities', label: 'الخصوم', color: 'bg-red-100 text-red-800' },
  { value: 'equity', label: 'حقوق الملكية', color: 'bg-purple-100 text-purple-800' },
  { value: 'revenue', label: 'الإيرادات', color: 'bg-green-100 text-green-800' },
  { value: 'expenses', label: 'المصروفات', color: 'bg-orange-100 text-orange-800' }
];

const JOURNAL_TYPES = [
  { value: 'purchases', label: 'يومية المشتريات' },
  { value: 'sales', label: 'يومية المبيعات' },
  { value: 'general', label: 'يومية عامة' },
  { value: 'payment', label: 'يومية المدفوعات' },
  { value: 'receipt', label: 'يومية المقبوضات' }
];

export default function AccountingPage() {
  const { selectedBranchId, token } = useAuth();
  const [activeTab, setActiveTab] = useState(TABS.ACCOUNTS);
  
  // Data states
  const [accounts, setAccounts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState([]);
  const [journalEntries, setJournalEntries] = useState([]);
  const [products, setProducts] = useState([]);
  const [salesReport, setSalesReport] = useState(null);
  const [vatReport, setVatReport] = useState(null);
  const [financialReport, setFinancialReport] = useState(null);
  const [internalExpenses, setInternalExpenses] = useState([]);
  const [expenseTypes, setExpenseTypes] = useState([]);
  const [expensesSummary, setExpensesSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // Dialog states
  const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false);
  const [isSupplierDialogOpen, setIsSupplierDialogOpen] = useState(false);
  const [isPurchaseDialogOpen, setIsPurchaseDialogOpen] = useState(false);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [isJournalDialogOpen, setIsJournalDialogOpen] = useState(false);
  const [isViewInvoiceDialogOpen, setIsViewInvoiceDialogOpen] = useState(false);
  const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false);
  const [isPostToAccountingDialogOpen, setIsPostToAccountingDialogOpen] = useState(false);
  
  // Form states
  const [editingAccount, setEditingAccount] = useState(null);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [editingExpense, setEditingExpense] = useState(null);
  const [selectedExpenses, setSelectedExpenses] = useState([]);
  const [expenseForm, setExpenseForm] = useState({
    expense_date: new Date().toISOString().split('T')[0],
    expense_type: '',
    description: '',
    amount: 0,
    payment_method: 'cash',
    executor_name: '',
    cost_center: '',
    notes: '',
    receipt_image: null
  });
  
  // Filter states
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [supplierFilter, setSupplierFilter] = useState('');
  const [journalTypeFilter, setJournalTypeFilter] = useState('');
  const [expenseStatusFilter, setExpenseStatusFilter] = useState('');
  const [expenseTypeFilter, setExpenseTypeFilter] = useState('');
  
  // Form data
  const [accountForm, setAccountForm] = useState({
    code: '', name_ar: '', name: '', account_type: 'assets', 
    parent_id: '', is_parent: false, description: ''
  });
  
  const [supplierForm, setSupplierForm] = useState({
    name_ar: '', name: '', phone: '', email: '', address: '',
    tax_number: '', commercial_reg: '', contact_person: '',
    notes: '', credit_limit: 0, payment_terms: 30
  });
  
  const [purchaseForm, setPurchaseForm] = useState({
    supplier_id: '', supplier_invoice_number: '', invoice_date: '',
    due_date: '', items: [{ product_id: '', description: '', quantity: 1, unit_price: 0, tax_rate: 15 }],
    payment_method: 'credit', notes: '', branch_id: ''
  });
  
  const [paymentForm, setPaymentForm] = useState({
    supplier_id: '', purchase_invoice_id: '', amount: 0,
    payment_date: '', payment_method: 'cash', reference: '', notes: ''
  });

  // Journal form for manual entries
  const [journalForm, setJournalForm] = useState({
    entry_date: new Date().toISOString().split('T')[0],
    description: '',
    reference_number: '',
    journal_type: 'general',
    lines: [
      { account_id: '', debit: 0, credit: 0, description: '' },
      { account_id: '', debit: 0, credit: 0, description: '' }
    ]
  });
  
  // Edit states
  const [editingJournal, setEditingJournal] = useState(null);
  const [editingPurchaseInvoice, setEditingPurchaseInvoice] = useState(null);
  const [isEditPurchaseDialogOpen, setIsEditPurchaseDialogOpen] = useState(false);

  // Fetch data
  const fetchAccounts = useCallback(async () => {
    try {
      const params = {};
      if (selectedBranchId && selectedBranchId !== 'all') params.branch_filter = selectedBranchId;
      const res = await accountsAPI.getAll(params);
      setAccounts(res.data);
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  }, [selectedBranchId]);

  const fetchSuppliers = useCallback(async () => {
    try {
      const params = {};
      if (selectedBranchId && selectedBranchId !== 'all') params.branch_filter = selectedBranchId;
      const res = await suppliersAPI.getAll(params);
      setSuppliers(res.data);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    }
  }, [selectedBranchId]);

  const fetchPurchaseInvoices = useCallback(async () => {
    try {
      const params = {};
      if (selectedBranchId && selectedBranchId !== 'all') params.branch_filter = selectedBranchId;
      if (dateFilter.start) params.start_date = dateFilter.start;
      if (dateFilter.end) params.end_date = dateFilter.end;
      if (supplierFilter) params.supplier_id = supplierFilter;
      const res = await purchaseInvoicesAPI.getAll(params);
      setPurchaseInvoices(res.data);
    } catch (error) {
      console.error('Error fetching purchase invoices:', error);
    }
  }, [selectedBranchId, dateFilter, supplierFilter]);

  const fetchJournalEntries = useCallback(async () => {
    try {
      const params = {};
      if (selectedBranchId && selectedBranchId !== 'all') params.branch_filter = selectedBranchId;
      if (dateFilter.start) params.start_date = dateFilter.start;
      if (dateFilter.end) params.end_date = dateFilter.end;
      if (journalTypeFilter) params.journal_type = journalTypeFilter;
      const res = await journalEntriesAPI.getAll(params);
      setJournalEntries(res.data);
    } catch (error) {
      console.error('Error fetching journal entries:', error);
    }
  }, [selectedBranchId, dateFilter, journalTypeFilter]);

  const fetchProducts = useCallback(async () => {
    try {
      const params = {};
      if (selectedBranchId && selectedBranchId !== 'all') params.branch_filter = selectedBranchId;
      const res = await productsAPI.getAll(params);
      setProducts(res.data);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  }, [selectedBranchId]);

  const fetchSalesReport = useCallback(async () => {
    try {
      const params = {};
      if (selectedBranchId && selectedBranchId !== 'all') params.branch_filter = selectedBranchId;
      if (dateFilter.start) params.start_date = dateFilter.start;
      if (dateFilter.end) params.end_date = dateFilter.end;
      const res = await accountingReportsAPI.getSalesReport(params);
      setSalesReport(res.data);
    } catch (error) {
      console.error('Error fetching sales report:', error);
    }
  }, [selectedBranchId, dateFilter]);

  const fetchVatReport = useCallback(async () => {
    try {
      const params = {};
      if (selectedBranchId && selectedBranchId !== 'all') params.branch_filter = selectedBranchId;
      if (dateFilter.start) params.start_date = dateFilter.start;
      if (dateFilter.end) params.end_date = dateFilter.end;
      const res = await accountingReportsAPI.getVatReport(params);
      setVatReport(res.data);
    } catch (error) {
      console.error('Error fetching VAT report:', error);
    }
  }, [selectedBranchId, dateFilter]);

  const fetchFinancialReport = useCallback(async () => {
    try {
      const params = {};
      if (selectedBranchId && selectedBranchId !== 'all') params.branch_id = selectedBranchId;
      if (dateFilter.start) params.start_date = dateFilter.start;
      if (dateFilter.end) params.end_date = dateFilter.end;
      const res = await reportsAPI.getFinancial(params);
      setFinancialReport(res.data);
    } catch (error) {
      console.error('Error fetching financial report:', error);
    }
  }, [selectedBranchId, dateFilter]);

  // Fetch internal expenses
  const fetchInternalExpenses = useCallback(async () => {
    try {
      const params = {};
      if (selectedBranchId && selectedBranchId !== 'all') params.branch_filter = selectedBranchId;
      if (dateFilter.start) params.start_date = dateFilter.start;
      if (dateFilter.end) params.end_date = dateFilter.end;
      if (expenseStatusFilter) params.status = expenseStatusFilter;
      if (expenseTypeFilter) params.expense_type = expenseTypeFilter;
      const res = await internalExpensesAPI.getAll(params);
      setInternalExpenses(res.data);
    } catch (error) {
      console.error('Error fetching internal expenses:', error);
    }
  }, [selectedBranchId, dateFilter, expenseStatusFilter, expenseTypeFilter]);

  // Fetch expenses summary
  const fetchExpensesSummary = useCallback(async () => {
    try {
      const params = {};
      if (selectedBranchId && selectedBranchId !== 'all') params.branch_filter = selectedBranchId;
      if (dateFilter.start) params.start_date = dateFilter.start;
      if (dateFilter.end) params.end_date = dateFilter.end;
      const res = await internalExpensesAPI.getSummary(params);
      setExpensesSummary(res.data);
    } catch (error) {
      console.error('Error fetching expenses summary:', error);
    }
  }, [selectedBranchId, dateFilter]);

  // Fetch expense types
  const fetchExpenseTypes = useCallback(async () => {
    try {
      const res = await internalExpensesAPI.getTypes();
      setExpenseTypes(res.data);
    } catch (error) {
      console.error('Error fetching expense types:', error);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchAccounts(), fetchSuppliers(), fetchProducts(), fetchExpenseTypes()]).finally(() => setLoading(false));
  }, [fetchAccounts, fetchSuppliers, fetchProducts, fetchExpenseTypes]);

  useEffect(() => {
    if (activeTab === TABS.PURCHASES) fetchPurchaseInvoices();
    if (activeTab === TABS.JOURNAL) fetchJournalEntries();
    if (activeTab === TABS.REPORTS) { fetchSalesReport(); fetchFinancialReport(); }
    if (activeTab === TABS.VAT) fetchVatReport();
    if (activeTab === TABS.EXPENSES) { fetchInternalExpenses(); fetchExpensesSummary(); }
  }, [activeTab, fetchPurchaseInvoices, fetchJournalEntries, fetchSalesReport, fetchVatReport, fetchFinancialReport, fetchInternalExpenses, fetchExpensesSummary]);

  // Account handlers
  const handleSaveAccount = async () => {
    try {
      if (editingAccount) {
        await accountsAPI.update(editingAccount.id, accountForm);
        toast.success('تم تحديث الحساب');
      } else {
        await accountsAPI.create(accountForm);
        toast.success('تم إضافة الحساب');
      }
      setIsAccountDialogOpen(false);
      setEditingAccount(null);
      setAccountForm({ code: '', name_ar: '', name: '', account_type: 'assets', parent_id: '', is_parent: false, description: '' });
      fetchAccounts();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'حدث خطأ');
    }
  };

  const handleDeleteAccount = async (id) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا الحساب؟')) return;
    try {
      await accountsAPI.delete(id);
      toast.success('تم حذف الحساب');
      fetchAccounts();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'لا يمكن حذف الحساب');
    }
  };

  const handleSeedAccounts = async () => {
    if (!window.confirm('هل تريد إنشاء شجرة الحسابات الافتراضية؟')) return;
    try {
      await accountsAPI.seedDefault();
      toast.success('تم إنشاء شجرة الحسابات الافتراضية');
      fetchAccounts();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'شجرة الحسابات موجودة مسبقاً');
    }
  };

  // Supplier handlers
  const handleSaveSupplier = async () => {
    try {
      if (editingSupplier) {
        await suppliersAPI.update(editingSupplier.id, supplierForm);
        toast.success('تم تحديث المورد');
      } else {
        await suppliersAPI.create(supplierForm);
        toast.success('تم إضافة المورد');
      }
      setIsSupplierDialogOpen(false);
      setEditingSupplier(null);
      setSupplierForm({ name_ar: '', name: '', phone: '', email: '', address: '', tax_number: '', commercial_reg: '', contact_person: '', notes: '', credit_limit: 0, payment_terms: 30 });
      fetchSuppliers();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'حدث خطأ');
    }
  };

  const handleDeleteSupplier = async (id) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا المورد؟')) return;
    try {
      await suppliersAPI.delete(id);
      toast.success('تم حذف المورد');
      fetchSuppliers();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'لا يمكن حذف المورد');
    }
  };

  // Purchase Invoice handlers
  const handleSavePurchaseInvoice = async () => {
    try {
      if (!purchaseForm.supplier_id) {
        toast.error('يرجى اختيار المورد');
        return;
      }
      if (!purchaseForm.invoice_date) {
        toast.error('يرجى تحديد تاريخ الفاتورة');
        return;
      }
      if (purchaseForm.items.length === 0 || purchaseForm.items.every(i => !i.description)) {
        toast.error('يرجى إضافة بند واحد على الأقل');
        return;
      }
      
      // Add branch_id to the form
      const dataToSend = {
        ...purchaseForm,
        branch_id: selectedBranchId !== 'all' ? selectedBranchId : ''
      };
      
      await purchaseInvoicesAPI.create(dataToSend);
      toast.success('تم إنشاء فاتورة المشتريات');
      setIsPurchaseDialogOpen(false);
      setPurchaseForm({
        supplier_id: '', supplier_invoice_number: '', invoice_date: '',
        due_date: '', items: [{ product_id: '', description: '', quantity: 1, unit_price: 0, tax_rate: 15 }],
        payment_method: 'credit', notes: '', branch_id: ''
      });
      fetchPurchaseInvoices();
      fetchSuppliers();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'حدث خطأ');
    }
  };

  const handleDeletePurchaseInvoice = async (id) => {
    if (!window.confirm('هل أنت متأكد من حذف هذه الفاتورة؟')) return;
    try {
      await purchaseInvoicesAPI.delete(id);
      toast.success('تم حذف الفاتورة');
      fetchPurchaseInvoices();
      fetchSuppliers();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'لا يمكن حذف الفاتورة');
    }
  };

  // Payment handlers
  const handleSavePayment = async () => {
    try {
      if (!paymentForm.supplier_id) {
        toast.error('يرجى اختيار المورد');
        return;
      }
      if (!paymentForm.amount || paymentForm.amount <= 0) {
        toast.error('يرجى إدخال مبلغ صحيح');
        return;
      }
      if (!paymentForm.payment_date) {
        toast.error('يرجى تحديد تاريخ السداد');
        return;
      }
      
      await supplierPaymentsAPI.create(paymentForm);
      toast.success('تم تسجيل السداد');
      setIsPaymentDialogOpen(false);
      setPaymentForm({ supplier_id: '', purchase_invoice_id: '', amount: 0, payment_date: '', payment_method: 'cash', reference: '', notes: '' });
      fetchSuppliers();
      fetchPurchaseInvoices();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'حدث خطأ');
    }
  };

  // Purchase item handlers
  const addPurchaseItem = () => {
    setPurchaseForm(prev => ({
      ...prev,
      items: [...prev.items, { product_id: '', description: '', quantity: 1, unit_price: 0, tax_rate: 15 }]
    }));
  };

  const removePurchaseItem = (index) => {
    setPurchaseForm(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  const updatePurchaseItem = (index, field, value) => {
    setPurchaseForm(prev => ({
      ...prev,
      items: prev.items.map((item, i) => i === index ? { ...item, [field]: value } : item)
    }));
  };

  // Calculate purchase totals
  const calculatePurchaseTotals = () => {
    let subtotal = 0;
    let tax = 0;
    purchaseForm.items.forEach(item => {
      const itemSubtotal = item.quantity * item.unit_price;
      const itemTax = itemSubtotal * (item.tax_rate / 100);
      subtotal += itemSubtotal;
      tax += itemTax;
    });
    return { subtotal, tax, total: subtotal + tax };
  };

  // ============ JOURNAL ENTRY HANDLERS ============
  
  // Add journal line
  const addJournalLine = () => {
    setJournalForm(prev => ({
      ...prev,
      lines: [...prev.lines, { account_id: '', debit: 0, credit: 0, description: '' }]
    }));
  };

  // Remove journal line
  const removeJournalLine = (index) => {
    if (journalForm.lines.length <= 2) {
      toast.error('يجب أن يحتوي القيد على سطرين على الأقل');
      return;
    }
    setJournalForm(prev => ({
      ...prev,
      lines: prev.lines.filter((_, i) => i !== index)
    }));
  };

  // Update journal line
  const updateJournalLine = (index, field, value) => {
    setJournalForm(prev => ({
      ...prev,
      lines: prev.lines.map((line, i) => i === index ? { ...line, [field]: value } : line)
    }));
  };

  // Calculate journal totals
  const calculateJournalTotals = () => {
    const totalDebit = journalForm.lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0);
    const totalCredit = journalForm.lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0);
    return { totalDebit, totalCredit, isBalanced: Math.abs(totalDebit - totalCredit) < 0.01 };
  };

  // Save journal entry (create or update)
  const handleSaveJournalEntry = async () => {
    try {
      const { totalDebit, totalCredit, isBalanced } = calculateJournalTotals();
      
      if (!journalForm.entry_date) {
        toast.error('يرجى تحديد تاريخ القيد');
        return;
      }
      if (!journalForm.description) {
        toast.error('يرجى إدخال وصف القيد');
        return;
      }
      if (!isBalanced) {
        toast.error('القيد غير متوازن - إجمالي المدين يجب أن يساوي إجمالي الدائن');
        return;
      }
      if (totalDebit === 0) {
        toast.error('يرجى إدخال مبالغ في القيد');
        return;
      }
      
      // Validate lines
      const validLines = journalForm.lines.filter(l => l.account_id && (l.debit > 0 || l.credit > 0));
      if (validLines.length < 2) {
        toast.error('يجب أن يحتوي القيد على سطرين على الأقل بمبالغ');
        return;
      }
      
      // Prepare lines with account info
      const linesWithAccountInfo = validLines.map(line => {
        const account = accounts.find(a => a.id === line.account_id);
        return {
          account_id: line.account_id,
          account_code: account?.code || '',
          account_name: account?.name_ar || '',
          debit: parseFloat(line.debit) || 0,
          credit: parseFloat(line.credit) || 0,
          description: line.description || journalForm.description
        };
      });
      
      const data = {
        entry_date: journalForm.entry_date,
        description: journalForm.description,
        reference_number: journalForm.reference_number,
        journal_type: journalForm.journal_type,
        lines: linesWithAccountInfo,
        branch_id: selectedBranchId !== 'all' ? selectedBranchId : ''
      };
      
      if (editingJournal) {
        await journalEntriesAPI.update(editingJournal.id, data);
        toast.success('تم تحديث القيد');
      } else {
        await journalEntriesAPI.create(data);
        toast.success('تم إنشاء القيد');
      }
      
      setIsJournalDialogOpen(false);
      resetJournalForm();
      fetchJournalEntries();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'حدث خطأ');
    }
  };

  // Reset journal form
  const resetJournalForm = () => {
    setJournalForm({
      entry_date: new Date().toISOString().split('T')[0],
      description: '',
      reference_number: '',
      journal_type: 'general',
      lines: [
        { account_id: '', debit: 0, credit: 0, description: '' },
        { account_id: '', debit: 0, credit: 0, description: '' }
      ]
    });
    setEditingJournal(null);
  };

  // Open journal for editing
  const openEditJournal = (entry) => {
    setEditingJournal(entry);
    setJournalForm({
      entry_date: entry.entry_date,
      description: entry.description || '',
      reference_number: entry.reference_number || '',
      journal_type: entry.journal_type || 'general',
      lines: entry.lines.map(l => ({
        account_id: l.account_id,
        debit: l.debit || 0,
        credit: l.credit || 0,
        description: l.description || ''
      }))
    });
    setIsJournalDialogOpen(true);
  };

  // ============ EDIT PURCHASE INVOICE HANDLERS ============
  
  // Open purchase invoice for editing
  const openEditPurchaseInvoice = (invoice) => {
    setEditingPurchaseInvoice(invoice);
    setPurchaseForm({
      supplier_id: invoice.supplier_id,
      supplier_invoice_number: invoice.supplier_invoice_number || '',
      invoice_date: invoice.invoice_date,
      due_date: invoice.due_date || '',
      items: invoice.items.map(item => ({
        product_id: item.product_id || '',
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_rate: item.tax_rate || 15
      })),
      payment_method: invoice.payment_method || 'credit',
      notes: invoice.notes || '',
      branch_id: invoice.branch_id || ''
    });
    setIsEditPurchaseDialogOpen(true);
  };

  // Save edited purchase invoice
  const handleUpdatePurchaseInvoice = async () => {
    try {
      if (!editingPurchaseInvoice) return;
      
      if (!purchaseForm.supplier_id) {
        toast.error('يرجى اختيار المورد');
        return;
      }
      if (!purchaseForm.invoice_date) {
        toast.error('يرجى تحديد تاريخ الفاتورة');
        return;
      }
      if (purchaseForm.items.length === 0 || purchaseForm.items.every(i => !i.description)) {
        toast.error('يرجى إضافة بند واحد على الأقل');
        return;
      }
      
      const dataToSend = {
        ...purchaseForm,
        branch_id: purchaseForm.branch_id || (selectedBranchId !== 'all' ? selectedBranchId : '')
      };
      
      await purchaseInvoicesAPI.update(editingPurchaseInvoice.id, dataToSend);
      toast.success('تم تحديث فاتورة المشتريات');
      setIsEditPurchaseDialogOpen(false);
      setEditingPurchaseInvoice(null);
      setPurchaseForm({
        supplier_id: '', supplier_invoice_number: '', invoice_date: '',
        due_date: '', items: [{ product_id: '', description: '', quantity: 1, unit_price: 0, tax_rate: 15 }],
        payment_method: 'credit', notes: '', branch_id: ''
      });
      fetchPurchaseInvoices();
      fetchJournalEntries();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'حدث خطأ في التحديث');
    }
  };

  // Render tabs
  const renderTabContent = () => {
    switch (activeTab) {
      case TABS.ACCOUNTS:
        return renderAccountsTab();
      case TABS.SUPPLIERS:
        return renderSuppliersTab();
      case TABS.PURCHASES:
        return renderPurchasesTab();
      case TABS.PAYMENTS:
        return renderPaymentsTab();
      case TABS.EXPENSES:
        return renderInternalExpensesTab();
      case TABS.JOURNAL:
        return renderJournalTab();
      case TABS.REPORTS:
        return renderReportsTab();
      case TABS.VAT:
        return renderVatTab();
      default:
        return null;
    }
  };

  // Export to Excel handler
  const handleExportExcel = (type) => {
    const params = { token };
    if (dateFilter.start) params.start_date = dateFilter.start;
    if (dateFilter.end) params.end_date = dateFilter.end;
    
    let url;
    switch (type) {
      case 'sales':
        url = exportAccountingAPI.sales(params);
        break;
      case 'purchases':
        url = exportAccountingAPI.purchases(params);
        break;
      case 'vat':
        url = exportAccountingAPI.vat(params);
        break;
      default:
        return;
    }
    
    window.open(url, '_blank');
    toast.success('جاري تحميل التقرير...');
  };

  // Accounts Tab
  const renderAccountsTab = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">شجرة الحسابات</h2>
        <div className="flex gap-2">
          {accounts.length === 0 && (
            <Button onClick={handleSeedAccounts} className="bg-green-600 hover:bg-green-700">
              إنشاء شجرة افتراضية
            </Button>
          )}
          <Button onClick={() => { setEditingAccount(null); setAccountForm({ code: '', name_ar: '', name: '', account_type: 'assets', parent_id: '', is_parent: false, description: '' }); setIsAccountDialogOpen(true); }} className="bg-blue-600 hover:bg-blue-700">
            + إضافة حساب
          </Button>
        </div>
      </div>
      
      {/* Accounts grouped by type */}
      {ACCOUNT_TYPES.map(type => {
        const typeAccounts = accounts.filter(a => a.account_type === type.value);
        if (typeAccounts.length === 0) return null;
        
        return (
          <div key={type.value} className="border rounded-lg overflow-hidden">
            <div className={`p-3 ${type.color} font-bold`}>{type.label}</div>
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-right">رقم الحساب</th>
                  <th className="p-2 text-right">اسم الحساب</th>
                  <th className="p-2 text-right">النوع</th>
                  <th className="p-2 text-right">الرصيد</th>
                  <th className="p-2 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {typeAccounts.map(account => (
                  <tr key={account.id} className={`border-t ${account.is_parent ? 'bg-gray-50 font-semibold' : ''}`}>
                    <td className="p-2">{account.code}</td>
                    <td className="p-2" style={{ paddingRight: account.parent_id ? '30px' : '8px' }}>
                      {account.is_parent ? '📁' : '📄'} {account.name_ar}
                    </td>
                    <td className="p-2">{account.is_parent ? 'حساب رئيسي' : 'حساب فرعي'}</td>
                    <td className="p-2">{(account.balance || 0).toLocaleString()} ر.س</td>
                    <td className="p-2 text-center">
                      <Button variant="ghost" size="sm" onClick={() => {
                        setEditingAccount(account);
                        setAccountForm(account);
                        setIsAccountDialogOpen(true);
                      }}>✏️</Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteAccount(account.id)} className="text-red-600">🗑️</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );

  // Suppliers Tab
  const renderSuppliersTab = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">الموردين</h2>
        <Button onClick={() => { setEditingSupplier(null); setSupplierForm({ name_ar: '', name: '', phone: '', email: '', address: '', tax_number: '', commercial_reg: '', contact_person: '', notes: '', credit_limit: 0, payment_terms: 30 }); setIsSupplierDialogOpen(true); }} className="bg-blue-600 hover:bg-blue-700">
          + إضافة مورد
        </Button>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full border rounded-lg">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 text-right">اسم المورد</th>
              <th className="p-3 text-right">الجوال</th>
              <th className="p-3 text-right">الرقم الضريبي</th>
              <th className="p-3 text-right">إجمالي المشتريات</th>
              <th className="p-3 text-right">المدفوع</th>
              <th className="p-3 text-right">المستحق</th>
              <th className="p-3 text-center">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map(supplier => (
              <tr key={supplier.id} className="border-t hover:bg-gray-50">
                <td className="p-3 font-semibold">{supplier.name_ar}</td>
                <td className="p-3" dir="ltr">{supplier.phone}</td>
                <td className="p-3">{supplier.tax_number || '-'}</td>
                <td className="p-3">{(supplier.total_purchases || 0).toLocaleString()} ر.س</td>
                <td className="p-3 text-green-600">{(supplier.total_paid || 0).toLocaleString()} ر.س</td>
                <td className="p-3 text-red-600 font-bold">{(supplier.balance || 0).toLocaleString()} ر.س</td>
                <td className="p-3 text-center">
                  <Button variant="ghost" size="sm" onClick={() => {
                    setEditingSupplier(supplier);
                    setSupplierForm(supplier);
                    setIsSupplierDialogOpen(true);
                  }}>✏️</Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteSupplier(supplier.id)} className="text-red-600">🗑️</Button>
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && (
              <tr><td colSpan="7" className="p-8 text-center text-gray-500">لا يوجد موردين</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  // Purchases Tab
  const renderPurchasesTab = () => {
    const totals = purchaseInvoices.reduce((acc, inv) => ({
      subtotal: acc.subtotal + (inv.subtotal || 0),
      tax: acc.tax + (inv.tax_amount || 0),
      total: acc.total + (inv.total || 0),
      paid: acc.paid + (inv.paid_amount || 0),
      remaining: acc.remaining + (inv.remaining_amount || 0)
    }), { subtotal: 0, tax: 0, total: 0, paid: 0, remaining: 0 });

    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <h2 className="text-xl font-bold">فواتير المشتريات</h2>
          <Button onClick={() => setIsPurchaseDialogOpen(true)} className="bg-green-600 hover:bg-green-700">
            + فاتورة مشتريات جديدة
          </Button>
        </div>
        
        {/* Filters */}
        <div className="flex gap-4 flex-wrap p-4 bg-gray-50 rounded-lg">
          <div>
            <label className="text-sm text-gray-600">من تاريخ</label>
            <Input type="date" value={dateFilter.start} onChange={e => setDateFilter(prev => ({ ...prev, start: e.target.value }))} className="w-40" />
          </div>
          <div>
            <label className="text-sm text-gray-600">إلى تاريخ</label>
            <Input type="date" value={dateFilter.end} onChange={e => setDateFilter(prev => ({ ...prev, end: e.target.value }))} className="w-40" />
          </div>
          <div>
            <label className="text-sm text-gray-600">المورد</label>
            <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} className="border rounded p-2 w-48">
              <option value="">جميع الموردين</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name_ar}</option>)}
            </select>
          </div>
          <Button variant="outline" onClick={() => { setDateFilter({ start: '', end: '' }); setSupplierFilter(''); }}>
            مسح الفلاتر
          </Button>
        </div>
        
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg text-center">
            <div className="text-sm text-gray-600">الصافي</div>
            <div className="text-xl font-bold text-blue-600">{totals.subtotal.toLocaleString()} ر.س</div>
          </div>
          <div className="bg-orange-50 p-4 rounded-lg text-center">
            <div className="text-sm text-gray-600">الضريبة</div>
            <div className="text-xl font-bold text-orange-600">{totals.tax.toLocaleString()} ر.س</div>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg text-center">
            <div className="text-sm text-gray-600">الإجمالي</div>
            <div className="text-xl font-bold text-purple-600">{totals.total.toLocaleString()} ر.س</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg text-center">
            <div className="text-sm text-gray-600">المدفوع</div>
            <div className="text-xl font-bold text-green-600">{totals.paid.toLocaleString()} ر.س</div>
          </div>
          <div className="bg-red-50 p-4 rounded-lg text-center">
            <div className="text-sm text-gray-600">المستحق</div>
            <div className="text-xl font-bold text-red-600">{totals.remaining.toLocaleString()} ر.س</div>
          </div>
        </div>
        
        {/* Invoices Table */}
        <div className="overflow-x-auto">
          <table className="w-full border rounded-lg">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3 text-right">رقم الفاتورة</th>
                <th className="p-3 text-right">المورد</th>
                <th className="p-3 text-right">التاريخ</th>
                <th className="p-3 text-right">الصافي</th>
                <th className="p-3 text-right">الضريبة</th>
                <th className="p-3 text-right">الإجمالي</th>
                <th className="p-3 text-right">الحالة</th>
                <th className="p-3 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {purchaseInvoices.map(inv => (
                <tr key={inv.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 font-mono">{inv.invoice_number}</td>
                  <td className="p-3">{inv.supplier_name}</td>
                  <td className="p-3">{inv.invoice_date}</td>
                  <td className="p-3">{(inv.subtotal || 0).toLocaleString()}</td>
                  <td className="p-3">{(inv.tax_amount || 0).toLocaleString()}</td>
                  <td className="p-3 font-bold">{(inv.total || 0).toLocaleString()}</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs ${
                      inv.status === 'paid' ? 'bg-green-100 text-green-800' :
                      inv.status === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {inv.status === 'paid' ? 'مدفوعة' : inv.status === 'partial' ? 'جزئي' : 'معلقة'}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <Button variant="ghost" size="sm" onClick={() => { setSelectedInvoice(inv); setIsViewInvoiceDialogOpen(true); }}>👁️</Button>
                    {inv.status === 'pending' && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => openEditPurchaseInvoice(inv)} className="text-blue-600">✏️</Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDeletePurchaseInvoice(inv.id)} className="text-red-600">🗑️</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {purchaseInvoices.length === 0 && (
                <tr><td colSpan="8" className="p-8 text-center text-gray-500">لا توجد فواتير مشتريات</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Payments Tab
  const renderPaymentsTab = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">سداد الموردين</h2>
        <Button onClick={() => setIsPaymentDialogOpen(true)} className="bg-blue-600 hover:bg-blue-700">
          + تسجيل سداد
        </Button>
      </div>
      
      {/* Suppliers with balance */}
      <div className="grid gap-4">
        {suppliers.filter(s => s.balance > 0).map(supplier => (
          <div key={supplier.id} className="border rounded-lg p-4 bg-white shadow-sm">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg">{supplier.name_ar}</h3>
                <p className="text-gray-500">{supplier.phone}</p>
              </div>
              <div className="text-left">
                <div className="text-sm text-gray-500">المستحق</div>
                <div className="text-2xl font-bold text-red-600">{supplier.balance.toLocaleString()} ر.س</div>
              </div>
              <Button onClick={() => {
                setPaymentForm(prev => ({ ...prev, supplier_id: supplier.id, amount: supplier.balance, payment_date: new Date().toISOString().split('T')[0] }));
                setIsPaymentDialogOpen(true);
              }} className="bg-green-600 hover:bg-green-700">
                سداد
              </Button>
            </div>
          </div>
        ))}
        {suppliers.filter(s => s.balance > 0).length === 0 && (
          <div className="text-center p-8 text-gray-500 bg-gray-50 rounded-lg">
            لا توجد مستحقات للموردين
          </div>
        )}
      </div>
    </div>
  );

  // Journal Entries Tab
  const renderJournalTab = () => {
    const totalDebit = journalEntries.reduce((sum, e) => sum + (e.total_debit || 0), 0);
    const totalCredit = journalEntries.reduce((sum, e) => sum + (e.total_credit || 0), 0);

    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <h2 className="text-xl font-bold">القيود المحاسبية</h2>
          <Button onClick={() => setIsJournalDialogOpen(true)} className="bg-purple-600 hover:bg-purple-700">
            + قيد يدوي
          </Button>
        </div>
        
        {/* Filters */}
        <div className="flex gap-4 flex-wrap p-4 bg-gray-50 rounded-lg">
          <div>
            <label className="text-sm text-gray-600">من تاريخ</label>
            <Input type="date" value={dateFilter.start} onChange={e => setDateFilter(prev => ({ ...prev, start: e.target.value }))} className="w-40" />
          </div>
          <div>
            <label className="text-sm text-gray-600">إلى تاريخ</label>
            <Input type="date" value={dateFilter.end} onChange={e => setDateFilter(prev => ({ ...prev, end: e.target.value }))} className="w-40" />
          </div>
          <div>
            <label className="text-sm text-gray-600">نوع اليومية</label>
            <select value={journalTypeFilter} onChange={e => setJournalTypeFilter(e.target.value)} className="border rounded p-2 w-48">
              <option value="">جميع اليوميات</option>
              {JOURNAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        
        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg text-center">
            <div className="text-sm text-gray-600">إجمالي المدين</div>
            <div className="text-xl font-bold text-blue-600">{totalDebit.toLocaleString()} ر.س</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg text-center">
            <div className="text-sm text-gray-600">إجمالي الدائن</div>
            <div className="text-xl font-bold text-green-600">{totalCredit.toLocaleString()} ر.س</div>
          </div>
          <div className={`p-4 rounded-lg text-center ${totalDebit === totalCredit ? 'bg-green-100' : 'bg-red-100'}`}>
            <div className="text-sm text-gray-600">التوازن</div>
            <div className={`text-xl font-bold ${totalDebit === totalCredit ? 'text-green-600' : 'text-red-600'}`}>
              {totalDebit === totalCredit ? '✓ متوازن' : '✗ غير متوازن'}
            </div>
          </div>
        </div>
        
        {/* Entries */}
        <div className="space-y-4">
          {journalEntries.map(entry => (
            <div key={entry.id} className="border rounded-lg overflow-hidden bg-white">
              <div className="bg-gray-100 p-3 flex justify-between items-center">
                <div>
                  <span className="font-mono font-bold">{entry.entry_number}</span>
                  <span className="mx-2 text-gray-400">|</span>
                  <span>{entry.entry_date}</span>
                  <span className="mx-2 text-gray-400">|</span>
                  <span className="text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    {JOURNAL_TYPES.find(t => t.value === entry.journal_type)?.label || entry.journal_type}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {entry.reference_number && (
                    <span className="text-sm text-gray-500">المرجع: {entry.reference_number}</span>
                  )}
                  {/* Edit button - only for manual entries */}
                  {!entry.reference_type && !entry.reference_id && (
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => openEditJournal(entry)}
                      className="text-blue-600 hover:bg-blue-50"
                    >
                      ✏️ تعديل
                    </Button>
                  )}
                </div>
              </div>
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 text-right">الحساب</th>
                    <th className="p-2 text-right">البيان</th>
                    <th className="p-2 text-center w-32">مدين</th>
                    <th className="p-2 text-center w-32">دائن</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.lines?.map((line, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-2">
                        <span className="text-gray-500">{line.account_code}</span> - {line.account_name}
                      </td>
                      <td className="p-2 text-sm text-gray-600">{line.description}</td>
                      <td className="p-2 text-center">{line.debit > 0 ? line.debit.toLocaleString() : '-'}</td>
                      <td className="p-2 text-center">{line.credit > 0 ? line.credit.toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 font-bold">
                  <tr>
                    <td colSpan="2" className="p-2 text-left">المجموع</td>
                    <td className="p-2 text-center">{entry.total_debit?.toLocaleString()}</td>
                    <td className="p-2 text-center">{entry.total_credit?.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}
          {journalEntries.length === 0 && (
            <div className="text-center p-8 text-gray-500 bg-gray-50 rounded-lg">
              لا توجد قيود محاسبية
            </div>
          )}
        </div>
      </div>
    );
  };

  // Reports Tab
  const renderReportsTab = () => (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">التقارير المحاسبية</h2>
      
      <div className="grid md:grid-cols-3 gap-4">
        <div className="border rounded-lg p-6 bg-gradient-to-br from-blue-50 to-blue-100 cursor-pointer hover:shadow-lg transition" onClick={() => setActiveTab(TABS.JOURNAL)}>
          <div className="text-4xl mb-2">📒</div>
          <h3 className="font-bold text-lg">تقرير القيود اليومية</h3>
          <p className="text-sm text-gray-600">عرض جميع القيود المحاسبية مع الفلترة</p>
        </div>
        
        <div className="border rounded-lg p-6 bg-gradient-to-br from-green-50 to-green-100 cursor-pointer hover:shadow-lg transition" onClick={() => setActiveTab(TABS.PURCHASES)}>
          <div className="text-4xl mb-2">🧾</div>
          <h3 className="font-bold text-lg">تقرير المشتريات</h3>
          <p className="text-sm text-gray-600">فواتير المشتريات والمستحقات</p>
        </div>
        
        <div className="border rounded-lg p-6 bg-gradient-to-br from-purple-50 to-purple-100 cursor-pointer hover:shadow-lg transition" onClick={() => setActiveTab(TABS.SUPPLIERS)}>
          <div className="text-4xl mb-2">👥</div>
          <h3 className="font-bold text-lg">تقرير أرصدة الموردين</h3>
          <p className="text-sm text-gray-600">المستحقات للموردين</p>
        </div>
      </div>
      
      {/* Quick Stats */}
      <div className="grid md:grid-cols-4 gap-4 mt-8">
        <div className="bg-white border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-blue-600">{accounts.length}</div>
          <div className="text-gray-500">عدد الحسابات</div>
        </div>
        <div className="bg-white border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-green-600">{suppliers.length}</div>
          <div className="text-gray-500">عدد الموردين</div>
        </div>
        <div className="bg-white border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-purple-600">{purchaseInvoices.length}</div>
          <div className="text-gray-500">فواتير المشتريات</div>
        </div>
        <div className="bg-white border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-red-600">
            {suppliers.reduce((sum, s) => sum + (s.balance || 0), 0).toLocaleString()}
          </div>
          <div className="text-gray-500">المستحق للموردين (ر.س)</div>
        </div>
      </div>
      
      {/* Sales Report Section */}
      <div className="mt-8 border rounded-lg p-6 bg-white">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">📊 تقرير المبيعات</h3>
          <div className="flex gap-2">
            <Button onClick={() => handleExportExcel('sales')} className="bg-green-600 hover:bg-green-700">
              📥 Export Excel
            </Button>
          </div>
        </div>
        
        {/* Date Filters */}
        <div className="flex gap-4 mb-4 flex-wrap">
          <div>
            <label className="text-sm text-gray-600">من تاريخ</label>
            <Input type="date" value={dateFilter.start} onChange={e => setDateFilter(prev => ({ ...prev, start: e.target.value }))} className="w-40" />
          </div>
          <div>
            <label className="text-sm text-gray-600">إلى تاريخ</label>
            <Input type="date" value={dateFilter.end} onChange={e => setDateFilter(prev => ({ ...prev, end: e.target.value }))} className="w-40" />
          </div>
          <Button variant="outline" onClick={fetchSalesReport}>تحديث</Button>
        </div>
        
        {salesReport && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <div className="bg-blue-50 p-3 rounded text-center">
                <div className="text-sm text-gray-500">الفواتير</div>
                <div className="text-xl font-bold">{salesReport.summary?.invoices_count || 0}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded text-center">
                <div className="text-sm text-gray-500">الصافي</div>
                <div className="text-xl font-bold">{(salesReport.summary?.total_subtotal || 0).toLocaleString()}</div>
              </div>
              <div className="bg-yellow-50 p-3 rounded text-center">
                <div className="text-sm text-gray-500">الخصم</div>
                <div className="text-xl font-bold">{(salesReport.summary?.total_discount || 0).toLocaleString()}</div>
              </div>
              <div className="bg-orange-50 p-3 rounded text-center">
                <div className="text-sm text-gray-500">الضريبة</div>
                <div className="text-xl font-bold">{(salesReport.summary?.total_vat || 0).toLocaleString()}</div>
              </div>
              <div className="bg-green-50 p-3 rounded text-center">
                <div className="text-sm text-gray-500">الإجمالي</div>
                <div className="text-xl font-bold text-green-600">{(salesReport.summary?.total_amount || 0).toLocaleString()}</div>
              </div>
            </div>
            
            {/* By Payment Method */}
            {salesReport.by_payment_method && Object.keys(salesReport.by_payment_method).length > 0 && (
              <div className="mb-4">
                <h4 className="font-semibold mb-2">حسب طريقة الدفع</h4>
                <div className="flex gap-4 flex-wrap">
                  {Object.entries(salesReport.by_payment_method).map(([method, data]) => (
                    <div key={method} className="border rounded p-3 min-w-32">
                      <div className="text-sm text-gray-500">{method}</div>
                      <div className="font-bold">{data.count} فاتورة</div>
                      <div className="text-green-600">{data.total.toLocaleString()} ر.س</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* By Activity */}
            {salesReport.by_activity && Object.keys(salesReport.by_activity).length > 0 && (
              <div>
                <h4 className="font-semibold mb-2">حسب النشاط</h4>
                <div className="flex gap-4 flex-wrap">
                  {Object.entries(salesReport.by_activity).map(([activity, data]) => (
                    <div key={activity} className="border rounded p-3 min-w-32">
                      <div className="text-sm text-gray-500">{activity}</div>
                      <div className="font-bold">{data.count} اشتراك</div>
                      <div className="text-blue-600">{data.total.toLocaleString()} ر.س</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Refunds Section */}
      <div className="mt-4 border rounded-lg p-6 bg-white">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <span className="text-red-500">↩️</span> المسترجعات (Credit Notes)
        </h3>
        
        {financialReport ? (
          <>
            {/* Refunds Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-red-50 p-4 rounded-lg text-center">
                <div className="text-sm text-gray-600">إجمالي المسترجعات</div>
                <div className="text-xl font-bold text-red-600">{(financialReport.total_refunds || 0).toLocaleString()} ر.س</div>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg text-center">
                <div className="text-sm text-gray-600">عدد المسترجعات</div>
                <div className="text-xl font-bold">{financialReport.refund_count || 0}</div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg text-center">
                <div className="text-sm text-gray-600">صافي الإيرادات</div>
                <div className="text-xl font-bold text-green-600">{(financialReport.net_revenue || 0).toLocaleString()} ر.س</div>
              </div>
              <div className="bg-blue-50 p-4 rounded-lg text-center">
                <div className="text-sm text-gray-600">نسبة الاسترجاع</div>
                <div className="text-xl font-bold text-blue-600">
                  {financialReport.total_revenue > 0 
                    ? ((financialReport.total_refunds / financialReport.total_revenue) * 100).toFixed(1) 
                    : 0}%
                </div>
              </div>
            </div>

            {/* Refund Details */}
            {financialReport.refund_details && financialReport.refund_details.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full border rounded">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="p-2 text-right">رقم الإشعار</th>
                      <th className="p-2 text-right">رقم الفاتورة الأصلية</th>
                      <th className="p-2 text-right">العميل</th>
                      <th className="p-2 text-right">المبلغ المسترجع</th>
                      <th className="p-2 text-right">التاريخ</th>
                      <th className="p-2 text-right">بواسطة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {financialReport.refund_details.map((refund, idx) => (
                      <tr key={idx} className="border-t hover:bg-gray-50">
                        <td className="p-2 font-mono text-sm">{refund.credit_note_number}</td>
                        <td className="p-2 font-mono text-sm">{refund.original_invoice_number}</td>
                        <td className="p-2">{refund.customer_name}</td>
                        <td className="p-2 font-bold text-red-600">{refund.refund_amount?.toLocaleString()} ر.س</td>
                        <td className="p-2">{refund.created_at?.split('T')[0]}</td>
                        <td className="p-2 text-sm text-gray-500">{refund.created_by}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(!financialReport.refund_details || financialReport.refund_details.length === 0) && (
              <div className="text-center py-6 text-gray-500 bg-gray-50 rounded-lg">
                لا توجد مسترجعات في هذه الفترة
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-6 text-gray-500">جاري التحميل...</div>
        )}
      </div>
      
      {/* Purchases Export */}
      <div className="mt-4 border rounded-lg p-6 bg-white">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold">🧾 تقرير المشتريات</h3>
          <Button onClick={() => handleExportExcel('purchases')} className="bg-blue-600 hover:bg-blue-700">
            📥 Export Excel
          </Button>
        </div>
      </div>
    </div>
  );

  // VAT Report Tab
  const renderVatTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">🧾 إقرار ضريبة القيمة المضافة (VAT)</h2>
        <Button onClick={() => handleExportExcel('vat')} className="bg-purple-600 hover:bg-purple-700">
          📥 Export Excel
        </Button>
      </div>
      
      {/* Date Filters */}
      <div className="flex gap-4 flex-wrap p-4 bg-gray-50 rounded-lg">
        <div>
          <label className="text-sm text-gray-600">من تاريخ</label>
          <Input type="date" value={dateFilter.start} onChange={e => setDateFilter(prev => ({ ...prev, start: e.target.value }))} className="w-40" />
        </div>
        <div>
          <label className="text-sm text-gray-600">إلى تاريخ</label>
          <Input type="date" value={dateFilter.end} onChange={e => setDateFilter(prev => ({ ...prev, end: e.target.value }))} className="w-40" />
        </div>
        <Button variant="outline" onClick={fetchVatReport}>تحديث التقرير</Button>
      </div>
      
      {vatReport ? (
        <>
          {/* Company Info */}
          <div className="bg-gray-100 p-4 rounded-lg">
            <h3 className="font-bold text-lg mb-2">{vatReport.company_info?.name}</h3>
            <p className="text-sm">الرقم الضريبي: {vatReport.company_info?.tax_number}</p>
            <p className="text-sm">الفترة: {vatReport.period?.start_date} إلى {vatReport.period?.end_date}</p>
          </div>
          
          {/* Sales Section */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-green-600 text-white p-3 font-bold">
              📈 المبيعات (ضريبة المخرجات)
            </div>
            <div className="p-4">
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-sm text-gray-500">عدد الفواتير</div>
                  <div className="text-2xl font-bold">{vatReport.sales?.invoices_count || 0}</div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-gray-500">الصافي</div>
                  <div className="text-2xl font-bold">{(vatReport.sales?.subtotal || 0).toLocaleString()}</div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-gray-500">الضريبة 15%</div>
                  <div className="text-2xl font-bold text-green-600">{(vatReport.sales?.vat_amount || 0).toLocaleString()}</div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-gray-500">الإجمالي</div>
                  <div className="text-2xl font-bold">{(vatReport.sales?.total || 0).toLocaleString()}</div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Purchases Section */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-blue-600 text-white p-3 font-bold">
              📉 المشتريات (ضريبة المدخلات)
            </div>
            <div className="p-4">
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-sm text-gray-500">عدد الفواتير</div>
                  <div className="text-2xl font-bold">{vatReport.purchases?.invoices_count || 0}</div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-gray-500">الصافي</div>
                  <div className="text-2xl font-bold">{(vatReport.purchases?.subtotal || 0).toLocaleString()}</div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-gray-500">الضريبة 15%</div>
                  <div className="text-2xl font-bold text-blue-600">{(vatReport.purchases?.vat_amount || 0).toLocaleString()}</div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-gray-500">الإجمالي</div>
                  <div className="text-2xl font-bold">{(vatReport.purchases?.total || 0).toLocaleString()}</div>
                </div>
              </div>
            </div>
          </div>
          
          {/* VAT Summary */}
          <div className="border-2 border-purple-500 rounded-lg overflow-hidden">
            <div className="bg-purple-600 text-white p-3 font-bold">
              🧮 ملخص الإقرار الضريبي
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="font-semibold">ضريبة المخرجات (على المبيعات):</span>
                  <span className="text-xl font-bold text-green-600">{(vatReport.vat_summary?.output_vat || 0).toLocaleString()} ر.س</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="font-semibold">ضريبة المدخلات (على المشتريات):</span>
                  <span className="text-xl font-bold text-blue-600">({(vatReport.vat_summary?.input_vat || 0).toLocaleString()}) ر.س</span>
                </div>
                <div className="flex justify-between items-center py-4 bg-gray-50 rounded-lg px-4">
                  <span className="text-xl font-bold">صافي الضريبة المستحقة:</span>
                  <span className={`text-3xl font-bold ${(vatReport.vat_summary?.net_vat || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {(vatReport.vat_summary?.net_vat || 0).toLocaleString()} ر.س
                  </span>
                </div>
                <div className="text-center p-4 rounded-lg bg-gray-100">
                  <span className={`text-lg font-bold ${(vatReport.vat_summary?.net_vat || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {vatReport.vat_summary?.vat_status}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center p-12 bg-gray-50 rounded-lg">
          <div className="text-4xl mb-4">📋</div>
          <p className="text-gray-500">اختر الفترة واضغط "تحديث التقرير" لعرض إقرار الضريبة</p>
        </div>
      )}
    </div>
  );

  const purchaseTotals = calculatePurchaseTotals();

  return (
    <Layout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">📊 المحاسبة</h1>
        
        {/* Tabs Navigation */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {[
            { key: TABS.ACCOUNTS, label: 'شجرة الحسابات', icon: '📂' },
            { key: TABS.SUPPLIERS, label: 'الموردين', icon: '👥' },
            { key: TABS.PURCHASES, label: 'فواتير المشتريات', icon: '🧾' },
            { key: TABS.PAYMENTS, label: 'السداد', icon: '💳' },
            { key: TABS.EXPENSES, label: 'المصروفات الداخلية', icon: '💸' },
            { key: TABS.JOURNAL, label: 'القيود', icon: '📒' },
            { key: TABS.REPORTS, label: 'التقارير', icon: '📈' },
            { key: TABS.VAT, label: 'إقرار الضريبة', icon: '🧾' }
          ].map(tab => (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? 'default' : 'outline'}
              onClick={() => setActiveTab(tab.key)}
              className={activeTab === tab.key ? 'bg-orange-500 hover:bg-orange-600' : ''}
            >
              {tab.icon} {tab.label}
            </Button>
          ))}
        </div>
        
        {/* Tab Content */}
        {loading ? (
          <div className="flex justify-center p-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
          </div>
        ) : (
          renderTabContent()
        )}
      </div>
      
      {/* Account Dialog */}
      <Dialog open={isAccountDialogOpen} onOpenChange={setIsAccountDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingAccount ? 'تعديل الحساب' : 'إضافة حساب جديد'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">رقم الحساب *</label>
                <Input value={accountForm.code} onChange={e => setAccountForm(prev => ({ ...prev, code: e.target.value }))} placeholder="مثال: 1110" />
              </div>
              <div>
                <label className="text-sm font-medium">نوع الحساب *</label>
                <select value={accountForm.account_type} onChange={e => setAccountForm(prev => ({ ...prev, account_type: e.target.value }))} className="w-full border rounded p-2">
                  {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">اسم الحساب (عربي) *</label>
              <Input value={accountForm.name_ar} onChange={e => setAccountForm(prev => ({ ...prev, name_ar: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">اسم الحساب (إنجليزي)</label>
              <Input value={accountForm.name} onChange={e => setAccountForm(prev => ({ ...prev, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">الحساب الرئيسي</label>
              <select value={accountForm.parent_id || ''} onChange={e => setAccountForm(prev => ({ ...prev, parent_id: e.target.value }))} className="w-full border rounded p-2">
                <option value="">بدون (حساب رئيسي)</option>
                {accounts.filter(a => a.is_parent).map(a => <option key={a.id} value={a.id}>{a.code} - {a.name_ar}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_parent" checked={accountForm.is_parent} onChange={e => setAccountForm(prev => ({ ...prev, is_parent: e.target.checked }))} />
              <label htmlFor="is_parent">هذا حساب رئيسي (يحتوي حسابات فرعية)</label>
            </div>
            <div>
              <label className="text-sm font-medium">الوصف</label>
              <Input value={accountForm.description} onChange={e => setAccountForm(prev => ({ ...prev, description: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setIsAccountDialogOpen(false)}>إلغاء</Button>
              <Button onClick={handleSaveAccount} className="bg-blue-600 hover:bg-blue-700">حفظ</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Supplier Dialog */}
      <Dialog open={isSupplierDialogOpen} onOpenChange={setIsSupplierDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingSupplier ? 'تعديل المورد' : 'إضافة مورد جديد'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">اسم المورد (عربي) *</label>
                <Input value={supplierForm.name_ar} onChange={e => setSupplierForm(prev => ({ ...prev, name_ar: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">اسم المورد (إنجليزي)</label>
                <Input value={supplierForm.name} onChange={e => setSupplierForm(prev => ({ ...prev, name: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">الجوال *</label>
                <Input value={supplierForm.phone} onChange={e => setSupplierForm(prev => ({ ...prev, phone: e.target.value }))} dir="ltr" />
              </div>
              <div>
                <label className="text-sm font-medium">البريد الإلكتروني</label>
                <Input type="email" value={supplierForm.email} onChange={e => setSupplierForm(prev => ({ ...prev, email: e.target.value }))} dir="ltr" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">العنوان</label>
              <Input value={supplierForm.address} onChange={e => setSupplierForm(prev => ({ ...prev, address: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">الرقم الضريبي</label>
                <Input value={supplierForm.tax_number} onChange={e => setSupplierForm(prev => ({ ...prev, tax_number: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">السجل التجاري</label>
                <Input value={supplierForm.commercial_reg} onChange={e => setSupplierForm(prev => ({ ...prev, commercial_reg: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">جهة الاتصال</label>
                <Input value={supplierForm.contact_person} onChange={e => setSupplierForm(prev => ({ ...prev, contact_person: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">مدة السداد (أيام)</label>
                <Input type="number" value={supplierForm.payment_terms} onChange={e => setSupplierForm(prev => ({ ...prev, payment_terms: parseInt(e.target.value) || 30 }))} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">ملاحظات</label>
              <textarea value={supplierForm.notes} onChange={e => setSupplierForm(prev => ({ ...prev, notes: e.target.value }))} className="w-full border rounded p-2" rows="2" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setIsSupplierDialogOpen(false)}>إلغاء</Button>
              <Button onClick={handleSaveSupplier} className="bg-blue-600 hover:bg-blue-700">حفظ</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Purchase Invoice Dialog */}
      <Dialog open={isPurchaseDialogOpen} onOpenChange={setIsPurchaseDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>فاتورة مشتريات جديدة</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="col-span-2">
                <label className="text-sm font-medium">المورد *</label>
                <select value={purchaseForm.supplier_id} onChange={e => setPurchaseForm(prev => ({ ...prev, supplier_id: e.target.value }))} className="w-full border rounded p-2">
                  <option value="">اختر المورد</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name_ar}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">رقم فاتورة المورد</label>
                <Input value={purchaseForm.supplier_invoice_number} onChange={e => setPurchaseForm(prev => ({ ...prev, supplier_invoice_number: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">طريقة الدفع</label>
                <select value={purchaseForm.payment_method} onChange={e => setPurchaseForm(prev => ({ ...prev, payment_method: e.target.value }))} className="w-full border rounded p-2">
                  <option value="credit">آجل</option>
                  <option value="cash">نقدي</option>
                  <option value="transfer">تحويل بنكي</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">تاريخ الفاتورة *</label>
                <Input type="date" value={purchaseForm.invoice_date} onChange={e => setPurchaseForm(prev => ({ ...prev, invoice_date: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">تاريخ الاستحقاق</label>
                <Input type="date" value={purchaseForm.due_date} onChange={e => setPurchaseForm(prev => ({ ...prev, due_date: e.target.value }))} />
              </div>
            </div>
            
            {/* Items */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="font-medium">البنود</label>
                <Button type="button" variant="outline" size="sm" onClick={addPurchaseItem}>+ إضافة بند</Button>
              </div>
              <table className="w-full border rounded">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2 text-right">المنتج</th>
                    <th className="p-2 text-right">الوصف</th>
                    <th className="p-2 text-center w-20">الكمية</th>
                    <th className="p-2 text-center w-28">السعر</th>
                    <th className="p-2 text-center w-20">الضريبة %</th>
                    <th className="p-2 text-center w-28">الإجمالي</th>
                    <th className="p-2 w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseForm.items.map((item, idx) => {
                    const itemSubtotal = item.quantity * item.unit_price;
                    const itemTax = itemSubtotal * (item.tax_rate / 100);
                    const itemTotal = itemSubtotal + itemTax;
                    return (
                      <tr key={idx} className="border-t">
                        <td className="p-2">
                          <select value={item.product_id} onChange={e => {
                            const product = products.find(p => p.id === e.target.value);
                            updatePurchaseItem(idx, 'product_id', e.target.value);
                            if (product) {
                              updatePurchaseItem(idx, 'description', product.name_ar);
                              updatePurchaseItem(idx, 'unit_price', product.cost || 0);
                            }
                          }} className="w-full border rounded p-1 text-sm">
                            <option value="">اختر أو أدخل يدوياً</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.name_ar}</option>)}
                          </select>
                        </td>
                        <td className="p-2">
                          <Input value={item.description} onChange={e => updatePurchaseItem(idx, 'description', e.target.value)} className="text-sm" placeholder="وصف البند" />
                        </td>
                        <td className="p-2">
                          <Input type="number" min="1" value={item.quantity} onChange={e => updatePurchaseItem(idx, 'quantity', parseInt(e.target.value) || 1)} className="text-center text-sm" />
                        </td>
                        <td className="p-2">
                          <Input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => updatePurchaseItem(idx, 'unit_price', parseFloat(e.target.value) || 0)} className="text-center text-sm" />
                        </td>
                        <td className="p-2">
                          <Input type="number" min="0" max="100" value={item.tax_rate} onChange={e => updatePurchaseItem(idx, 'tax_rate', parseFloat(e.target.value) || 0)} className="text-center text-sm" />
                        </td>
                        <td className="p-2 text-center font-semibold">{itemTotal.toFixed(2)}</td>
                        <td className="p-2">
                          {purchaseForm.items.length > 1 && (
                            <Button variant="ghost" size="sm" onClick={() => removePurchaseItem(idx)} className="text-red-600">✕</Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {/* Totals */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex justify-between py-1">
                <span>المجموع الفرعي:</span>
                <span>{purchaseTotals.subtotal.toFixed(2)} ر.س</span>
              </div>
              <div className="flex justify-between py-1">
                <span>ضريبة القيمة المضافة:</span>
                <span>{purchaseTotals.tax.toFixed(2)} ر.س</span>
              </div>
              <div className="flex justify-between py-1 font-bold text-lg border-t pt-2">
                <span>الإجمالي:</span>
                <span>{purchaseTotals.total.toFixed(2)} ر.س</span>
              </div>
            </div>
            
            <div>
              <label className="text-sm font-medium">ملاحظات</label>
              <textarea value={purchaseForm.notes} onChange={e => setPurchaseForm(prev => ({ ...prev, notes: e.target.value }))} className="w-full border rounded p-2" rows="2" />
            </div>
            
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setIsPurchaseDialogOpen(false)}>إلغاء</Button>
              <Button onClick={handleSavePurchaseInvoice} className="bg-green-600 hover:bg-green-700">حفظ الفاتورة</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Payment Dialog */}
      <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>تسجيل سداد للمورد</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">المورد *</label>
              <select value={paymentForm.supplier_id} onChange={e => {
                setPaymentForm(prev => ({ ...prev, supplier_id: e.target.value }));
              }} className="w-full border rounded p-2">
                <option value="">اختر المورد</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name_ar} (المستحق: {s.balance?.toLocaleString()} ر.س)</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">المبلغ *</label>
                <Input type="number" min="0" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <label className="text-sm font-medium">تاريخ السداد *</label>
                <Input type="date" value={paymentForm.payment_date} onChange={e => setPaymentForm(prev => ({ ...prev, payment_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">طريقة الدفع</label>
                <select value={paymentForm.payment_method} onChange={e => setPaymentForm(prev => ({ ...prev, payment_method: e.target.value }))} className="w-full border rounded p-2">
                  <option value="cash">نقدي</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                  <option value="check">شيك</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">المرجع</label>
                <Input value={paymentForm.reference} onChange={e => setPaymentForm(prev => ({ ...prev, reference: e.target.value }))} placeholder="رقم الشيك / الحوالة" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">ملاحظات</label>
              <textarea value={paymentForm.notes} onChange={e => setPaymentForm(prev => ({ ...prev, notes: e.target.value }))} className="w-full border rounded p-2" rows="2" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setIsPaymentDialogOpen(false)}>إلغاء</Button>
              <Button onClick={handleSavePayment} className="bg-green-600 hover:bg-green-700">تسجيل السداد</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* View Invoice Dialog */}
      <Dialog open={isViewInvoiceDialogOpen} onOpenChange={setIsViewInvoiceDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>تفاصيل فاتورة المشتريات</DialogTitle>
          </DialogHeader>
          {selectedInvoice && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><strong>رقم الفاتورة:</strong> {selectedInvoice.invoice_number}</div>
                <div><strong>رقم فاتورة المورد:</strong> {selectedInvoice.supplier_invoice_number || '-'}</div>
                <div><strong>المورد:</strong> {selectedInvoice.supplier_name}</div>
                <div><strong>التاريخ:</strong> {selectedInvoice.invoice_date}</div>
                <div><strong>تاريخ الاستحقاق:</strong> {selectedInvoice.due_date || '-'}</div>
                <div><strong>الحالة:</strong> 
                  <span className={`mr-2 px-2 py-1 rounded text-xs ${
                    selectedInvoice.status === 'paid' ? 'bg-green-100 text-green-800' :
                    selectedInvoice.status === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {selectedInvoice.status === 'paid' ? 'مدفوعة' : selectedInvoice.status === 'partial' ? 'جزئي' : 'معلقة'}
                  </span>
                </div>
              </div>
              
              <table className="w-full border rounded">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2 text-right">البند</th>
                    <th className="p-2 text-center">الكمية</th>
                    <th className="p-2 text-center">السعر</th>
                    <th className="p-2 text-center">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.items?.map((item, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-2">{item.description}</td>
                      <td className="p-2 text-center">{item.quantity}</td>
                      <td className="p-2 text-center">{item.unit_price?.toLocaleString()}</td>
                      <td className="p-2 text-center">{item.total?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              <div className="bg-gray-50 p-4 rounded">
                <div className="flex justify-between py-1"><span>المجموع الفرعي:</span><span>{selectedInvoice.subtotal?.toLocaleString()} ر.س</span></div>
                <div className="flex justify-between py-1"><span>الضريبة:</span><span>{selectedInvoice.tax_amount?.toLocaleString()} ر.س</span></div>
                <div className="flex justify-between py-1 font-bold border-t pt-2"><span>الإجمالي:</span><span>{selectedInvoice.total?.toLocaleString()} ر.س</span></div>
                <div className="flex justify-between py-1 text-green-600"><span>المدفوع:</span><span>{selectedInvoice.paid_amount?.toLocaleString()} ر.س</span></div>
                <div className="flex justify-between py-1 text-red-600 font-bold"><span>المتبقي:</span><span>{selectedInvoice.remaining_amount?.toLocaleString()} ر.س</span></div>
              </div>
              
              {selectedInvoice.notes && (
                <div className="bg-yellow-50 p-3 rounded">
                  <strong>ملاحظات:</strong> {selectedInvoice.notes}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Manual Journal Entry Dialog */}
      <Dialog open={isJournalDialogOpen} onOpenChange={(open) => { 
        if (!open) resetJournalForm(); 
        setIsJournalDialogOpen(open); 
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-purple-600">📝</span>
              {editingJournal ? 'تعديل القيد المحاسبي' : 'قيد محاسبي يدوي جديد'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Entry Header */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="text-sm font-medium">تاريخ القيد *</label>
                <Input 
                  type="date" 
                  value={journalForm.entry_date} 
                  onChange={e => setJournalForm(prev => ({ ...prev, entry_date: e.target.value }))}
                  className="h-12"
                />
              </div>
              <div>
                <label className="text-sm font-medium">نوع اليومية</label>
                <select 
                  value={journalForm.journal_type} 
                  onChange={e => setJournalForm(prev => ({ ...prev, journal_type: e.target.value }))}
                  className="w-full border rounded p-2 h-12"
                >
                  {JOURNAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium">رقم المرجع</label>
                <Input 
                  value={journalForm.reference_number} 
                  onChange={e => setJournalForm(prev => ({ ...prev, reference_number: e.target.value }))}
                  placeholder="اختياري"
                />
              </div>
            </div>
            
            <div>
              <label className="text-sm font-medium">البيان / الوصف *</label>
              <Input 
                value={journalForm.description} 
                onChange={e => setJournalForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="وصف القيد المحاسبي"
              />
            </div>

            {/* Journal Lines */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium">بنود القيد</label>
                <Button size="sm" variant="outline" onClick={addJournalLine}>
                  + إضافة سطر
                </Button>
              </div>
              <div className="border rounded overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="p-2 text-right">الحساب</th>
                      <th className="p-2 text-right">البيان</th>
                      <th className="p-2 text-center w-32">مدين</th>
                      <th className="p-2 text-center w-32">دائن</th>
                      <th className="p-2 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {journalForm.lines.map((line, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="p-2">
                          <select 
                            value={line.account_id} 
                            onChange={e => updateJournalLine(idx, 'account_id', e.target.value)}
                            className="w-full border rounded p-1.5 text-sm"
                          >
                            <option value="">اختر الحساب</option>
                            {accounts.filter(a => !a.is_parent).map(a => (
                              <option key={a.id} value={a.id}>{a.code} - {a.name_ar}</option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2">
                          <Input 
                            value={line.description} 
                            onChange={e => updateJournalLine(idx, 'description', e.target.value)}
                            placeholder="بيان السطر"
                            className="text-sm"
                          />
                        </td>
                        <td className="p-2">
                          <Input 
                            type="number" 
                            min="0" 
                            step="0.01"
                            value={line.debit || ''} 
                            onChange={e => {
                              const val = parseFloat(e.target.value) || 0;
                              updateJournalLine(idx, 'debit', val);
                              if (val > 0) updateJournalLine(idx, 'credit', 0);
                            }}
                            className="text-center text-sm"
                          />
                        </td>
                        <td className="p-2">
                          <Input 
                            type="number" 
                            min="0" 
                            step="0.01"
                            value={line.credit || ''} 
                            onChange={e => {
                              const val = parseFloat(e.target.value) || 0;
                              updateJournalLine(idx, 'credit', val);
                              if (val > 0) updateJournalLine(idx, 'debit', 0);
                            }}
                            className="text-center text-sm"
                          />
                        </td>
                        <td className="p-2">
                          {journalForm.lines.length > 2 && (
                            <Button variant="ghost" size="sm" onClick={() => removeJournalLine(idx)} className="text-red-600">✕</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-bold">
                    <tr>
                      <td colSpan="2" className="p-2 text-left">المجموع</td>
                      <td className="p-2 text-center">{calculateJournalTotals().totalDebit.toFixed(2)}</td>
                      <td className="p-2 text-center">{calculateJournalTotals().totalCredit.toFixed(2)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Balance Check */}
            <div className={`p-3 rounded-lg text-center ${calculateJournalTotals().isBalanced ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {calculateJournalTotals().isBalanced 
                ? '✓ القيد متوازن' 
                : `✗ القيد غير متوازن - الفرق: ${Math.abs(calculateJournalTotals().totalDebit - calculateJournalTotals().totalCredit).toFixed(2)} ر.س`}
            </div>
            
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { resetJournalForm(); setIsJournalDialogOpen(false); }}>إلغاء</Button>
              <Button onClick={handleSaveJournalEntry} className="bg-purple-600 hover:bg-purple-700" disabled={!calculateJournalTotals().isBalanced}>
                {editingJournal ? 'تحديث القيد' : 'حفظ القيد'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Purchase Invoice Dialog */}
      <Dialog open={isEditPurchaseDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setEditingPurchaseInvoice(null);
          setPurchaseForm({
            supplier_id: '', supplier_invoice_number: '', invoice_date: '',
            due_date: '', items: [{ product_id: '', description: '', quantity: 1, unit_price: 0, tax_rate: 15 }],
            payment_method: 'credit', notes: '', branch_id: ''
          });
        }
        setIsEditPurchaseDialogOpen(open);
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تعديل فاتورة المشتريات - {editingPurchaseInvoice?.invoice_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Same form as create but for editing */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">المورد *</label>
                <select value={purchaseForm.supplier_id} onChange={e => setPurchaseForm(prev => ({ ...prev, supplier_id: e.target.value }))} className="w-full border rounded p-2">
                  <option value="">اختر المورد</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name_ar}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">رقم فاتورة المورد</label>
                <Input value={purchaseForm.supplier_invoice_number} onChange={e => setPurchaseForm(prev => ({ ...prev, supplier_invoice_number: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium">تاريخ الفاتورة *</label>
                <Input type="date" value={purchaseForm.invoice_date} onChange={e => setPurchaseForm(prev => ({ ...prev, invoice_date: e.target.value }))} className="h-12" />
              </div>
              <div>
                <label className="text-sm font-medium">تاريخ الاستحقاق</label>
                <Input type="date" value={purchaseForm.due_date} onChange={e => setPurchaseForm(prev => ({ ...prev, due_date: e.target.value }))} className="h-12" />
              </div>
              <div>
                <label className="text-sm font-medium">طريقة الدفع</label>
                <select value={purchaseForm.payment_method} onChange={e => setPurchaseForm(prev => ({ ...prev, payment_method: e.target.value }))} className="w-full border rounded p-2">
                  <option value="cash">نقدي</option>
                  <option value="credit">آجل</option>
                </select>
              </div>
            </div>
            
            {/* Items Table */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium">بنود الفاتورة</label>
                <Button size="sm" variant="outline" onClick={addPurchaseItem}>+ إضافة بند</Button>
              </div>
              <div className="border rounded overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="p-2 text-right min-w-[200px]">الوصف</th>
                      <th className="p-2 text-center w-24">الكمية</th>
                      <th className="p-2 text-center w-28">السعر</th>
                      <th className="p-2 text-center w-20">الضريبة %</th>
                      <th className="p-2 text-center w-28">الإجمالي</th>
                      <th className="p-2 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseForm.items.map((item, idx) => {
                      const itemSubtotal = item.quantity * item.unit_price;
                      const itemTax = itemSubtotal * (item.tax_rate / 100);
                      const itemTotal = itemSubtotal + itemTax;
                      return (
                        <tr key={idx} className="border-t">
                          <td className="p-2">
                            <Input value={item.description} onChange={e => updatePurchaseItem(idx, 'description', e.target.value)} placeholder="وصف البند" className="text-sm" />
                          </td>
                          <td className="p-2">
                            <Input type="number" min="1" value={item.quantity} onChange={e => updatePurchaseItem(idx, 'quantity', parseInt(e.target.value) || 1)} className="text-center text-sm" />
                          </td>
                          <td className="p-2">
                            <Input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => updatePurchaseItem(idx, 'unit_price', parseFloat(e.target.value) || 0)} className="text-center text-sm" />
                          </td>
                          <td className="p-2">
                            <Input type="number" min="0" max="100" value={item.tax_rate} onChange={e => updatePurchaseItem(idx, 'tax_rate', parseFloat(e.target.value) || 0)} className="text-center text-sm" />
                          </td>
                          <td className="p-2 text-center font-semibold">{itemTotal.toFixed(2)}</td>
                          <td className="p-2">
                            {purchaseForm.items.length > 1 && (
                              <Button variant="ghost" size="sm" onClick={() => removePurchaseItem(idx)} className="text-red-600">✕</Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            
            {/* Totals */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex justify-between py-1">
                <span>المجموع الفرعي:</span>
                <span>{calculatePurchaseTotals().subtotal.toFixed(2)} ر.س</span>
              </div>
              <div className="flex justify-between py-1">
                <span>ضريبة القيمة المضافة:</span>
                <span>{calculatePurchaseTotals().tax.toFixed(2)} ر.س</span>
              </div>
              <div className="flex justify-between py-1 font-bold text-lg border-t pt-2">
                <span>الإجمالي:</span>
                <span>{calculatePurchaseTotals().total.toFixed(2)} ر.س</span>
              </div>
            </div>
            
            <div>
              <label className="text-sm font-medium">ملاحظات</label>
              <textarea value={purchaseForm.notes} onChange={e => setPurchaseForm(prev => ({ ...prev, notes: e.target.value }))} className="w-full border rounded p-2" rows="2" />
            </div>
            
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setIsEditPurchaseDialogOpen(false)}>إلغاء</Button>
              <Button onClick={handleUpdatePurchaseInvoice} className="bg-blue-600 hover:bg-blue-700">تحديث الفاتورة</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
