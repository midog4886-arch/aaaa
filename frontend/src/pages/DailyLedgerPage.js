import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import api from '../services/api';
import {
  BookOpen, Calendar, ChevronLeft, ChevronRight, Plus, Trash2,
  TrendingUp, TrendingDown, Wallet, Receipt, ArrowDownCircle,
  DollarSign, Lock, Unlock, Download, Search, X, Edit, Save,
  ArrowUpRight, ArrowDownRight, Minus
} from 'lucide-react';

const STATS_PASSWORD = '242456';

const CATEGORY_LABELS = {
  ar: {
    rent: 'إيجار', salaries: 'رواتب', maintenance: 'صيانة', purchases: 'مشتريات',
    utilities: 'خدمات (كهرباء/ماء)', marketing: 'تسويق', equipment: 'معدات',
    transportation: 'نقل ومواصلات', other: 'أخرى'
  },
  en: {
    rent: 'Rent', salaries: 'Salaries', maintenance: 'Maintenance', purchases: 'Purchases',
    utilities: 'Utilities', marketing: 'Marketing', equipment: 'Equipment',
    transportation: 'Transportation', other: 'Other'
  }
};

const PAYMENT_LABELS = {
  ar: { cash: 'نقداً', card: 'بطاقة', transfer: 'تحويل', tabby: 'تابي', tamara: 'تمارا' },
  en: { cash: 'Cash', card: 'Card', transfer: 'Transfer', tabby: 'Tabby', tamara: 'Tamara' }
};

const DAY_NAMES = {
  ar: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
};

const MONTH_NAMES = {
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
};

const hiddenValue = '****';

export const DailyLedgerPage = () => {
  const { language } = useLanguage();
  const { selectedBranchId } = useAuth();
  const isAr = language === 'ar';

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [viewMode, setViewMode] = useState('daily');
  const [calendarMonth, setCalendarMonth] = useState(todayStr.substring(0, 7));
  const [summary, setSummary] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [calendarData, setCalendarData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ description: '', amount: '', category: 'other', notes: '' });
  const [editingExpense, setEditingExpense] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');

  const [statsUnlocked, setStatsUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  const handleUnlock = () => {
    if (passwordInput === STATS_PASSWORD) {
      setStatsUnlocked(true);
      setPasswordError(false);
    } else {
      setPasswordError(true);
    }
  };

  const handleLock = () => {
    setStatsUnlocked(false);
    setPasswordInput('');
  };

  const loadDailySummary = useCallback(async () => {
    try {
      setLoading(true);
      const [summaryRes, comparisonRes] = await Promise.all([
        api.dailyLedger.getSummary(selectedDate, selectedBranchId),
        api.dailyLedger.getComparison(selectedDate, selectedBranchId)
      ]);
      setSummary(summaryRes.data);
      setComparison(comparisonRes.data);
    } catch (err) {
      console.error('Error loading daily summary:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, selectedBranchId]);

  const loadCalendar = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.dailyLedger.getCalendar(calendarMonth, selectedBranchId);
      setCalendarData(res.data);
    } catch (err) {
      console.error('Error loading calendar:', err);
    } finally {
      setLoading(false);
    }
  }, [calendarMonth, selectedBranchId]);

  useEffect(() => {
    if (viewMode === 'daily') loadDailySummary();
    else loadCalendar();
  }, [viewMode, loadDailySummary, loadCalendar]);

  const navigateDate = (dir) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + dir);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const navigateMonth = (dir) => {
    const [y, m] = calendarMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setCalendarMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const handleAddExpense = async () => {
    if (!expenseForm.description || !expenseForm.amount) return;
    try {
      await api.dailyLedger.createExpense({
        date: selectedDate,
        amount: parseFloat(expenseForm.amount),
        category: expenseForm.category,
        description: expenseForm.description,
        notes: expenseForm.notes
      });
      setExpenseForm({ description: '', amount: '', category: 'other', notes: '' });
      setShowAddExpense(false);
      loadDailySummary();
    } catch (err) {
      console.error('Error adding expense:', err);
    }
  };

  const handleDeleteExpense = async (id) => {
    if (!window.confirm(isAr ? 'هل أنت متأكد من حذف هذا المصروف؟' : 'Are you sure you want to delete this expense?')) return;
    try {
      await api.dailyLedger.deleteExpense(id);
      loadDailySummary();
    } catch (err) {
      console.error('Error deleting expense:', err);
    }
  };

  const handleUpdateExpense = async () => {
    if (!editingExpense) return;
    try {
      await api.dailyLedger.updateExpense(editingExpense.id, {
        amount: parseFloat(editingExpense.amount),
        category: editingExpense.category,
        description: editingExpense.description,
        notes: editingExpense.notes
      });
      setEditingExpense(null);
      loadDailySummary();
    } catch (err) {
      console.error('Error updating expense:', err);
    }
  };

  const getComparisonArrow = (current, compare) => {
    if (!compare || compare === 0) return null;
    const diff = ((current - compare) / compare * 100).toFixed(0);
    if (current > compare) return <span className="text-green-600 text-xs flex items-center gap-0.5"><ArrowUpRight className="w-3 h-3" />+{diff}%</span>;
    if (current < compare) return <span className="text-red-600 text-xs flex items-center gap-0.5"><ArrowDownRight className="w-3 h-3" />{diff}%</span>;
    return <span className="text-gray-500 text-xs flex items-center gap-0.5"><Minus className="w-3 h-3" />0%</span>;
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const dayName = DAY_NAMES[language][d.getDay()];
    return `${dayName} - ${d.toLocaleDateString(isAr ? 'ar-SA' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;
  };

  const filteredTransactions = summary?.transactions?.filter(tx => {
    const matchSearch = !searchTerm ||
      tx.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.number?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCategory = filterCategory === 'all' ||
      (tx.type === 'expense' && tx.category === filterCategory) ||
      (tx.type !== 'expense' && filterCategory === 'all');
    return matchSearch && matchCategory;
  }) || [];

  const exportPDF = () => {
    window.print();
  };

  const exportCSV = () => {
    if (!summary) return;
    const headers = [isAr ? 'النوع' : 'Type', isAr ? 'الوصف' : 'Description', isAr ? 'المبلغ' : 'Amount', isAr ? 'الوقت' : 'Time'];
    const rows = summary.transactions.map(tx => [
      tx.type === 'invoice' ? (isAr ? 'فاتورة' : 'Invoice') : tx.type === 'refund' ? (isAr ? 'مرتجع' : 'Refund') : (isAr ? 'مصروف' : 'Expense'),
      tx.description,
      tx.amount,
      tx.time
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-ledger-${selectedDate}.csv`;
    a.click();
  };

  const renderCalendar = () => {
    if (!calendarData) return null;
    const [year, month] = calendarMonth.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells = [];

    for (let i = 0; i < firstDay; i++) cells.push(<div key={`empty-${i}`} className="p-1" />);

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${calendarMonth}-${String(day).padStart(2, '0')}`;
      const dayData = calendarData.days?.find(d => d.date === dateStr);
      const isToday = dateStr === todayStr;
      const isSelected = dateStr === selectedDate;
      const hasData = dayData && dayData.tx_count > 0;

      cells.push(
        <div
          key={day}
          onClick={() => { setSelectedDate(dateStr); setViewMode('daily'); }}
          className={`p-1.5 rounded-lg cursor-pointer transition-all text-center min-h-[70px] border ${
            isSelected ? 'ring-2 ring-primary border-primary' :
            isToday ? 'border-blue-300 bg-blue-50' :
            hasData ? 'border-gray-200 hover:border-primary/50' : 'border-transparent hover:bg-gray-50'
          }`}
        >
          <div className={`text-sm font-bold ${isToday ? 'text-blue-600' : ''}`}>{day}</div>
          {statsUnlocked && hasData && (
            <div className="mt-1 space-y-0.5">
              {dayData.income > 0 && <div className="text-[10px] text-green-600 font-medium">+{dayData.income.toLocaleString()}</div>}
              {dayData.expenses > 0 && <div className="text-[10px] text-red-600 font-medium">-{dayData.expenses.toLocaleString()}</div>}
              <div className={`text-[10px] font-bold ${dayData.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {dayData.net >= 0 ? '+' : ''}{dayData.net.toLocaleString()}
              </div>
            </div>
          )}
          {!statsUnlocked && hasData && (
            <div className="mt-1">
              <div className="text-[10px] text-gray-400">{dayData.tx_count} {isAr ? 'عملية' : 'tx'}</div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-7 gap-1">
        {DAY_NAMES[language].map(d => (
          <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-1">{d}</div>
        ))}
        {cells}
      </div>
    );
  };

  return (
    <Layout>
      <div className="space-y-4 print:space-y-2">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold">{isAr ? 'اليومية المالية' : 'Daily Financial Ledger'}</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant={viewMode === 'daily' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('daily')}
            >
              <Receipt className="w-4 h-4 ml-1" />
              {isAr ? 'عرض يومي' : 'Daily View'}
            </Button>
            <Button
              variant={viewMode === 'calendar' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('calendar')}
            >
              <Calendar className="w-4 h-4 ml-1" />
              {isAr ? 'التقويم الشهري' : 'Monthly Calendar'}
            </Button>
          </div>
        </div>

        {/* Password Lock */}
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {statsUnlocked ? (
                  <Unlock className="w-5 h-5 text-green-600" />
                ) : (
                  <Lock className="w-5 h-5 text-amber-600" />
                )}
                <span className="text-sm font-medium">
                  {statsUnlocked
                    ? (isAr ? 'الأرقام المالية مفتوحة' : 'Financial figures unlocked')
                    : (isAr ? 'أدخل كلمة المرور لعرض الأرقام المالية' : 'Enter password to view financial figures')
                  }
                </span>
              </div>
              {statsUnlocked ? (
                <Button variant="outline" size="sm" onClick={handleLock}>
                  <Lock className="w-4 h-4 ml-1" />
                  {isAr ? 'قفل' : 'Lock'}
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(false); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                    placeholder={isAr ? 'كلمة المرور' : 'Password'}
                    className={`w-32 h-8 text-sm ${passwordError ? 'border-red-500' : ''}`}
                  />
                  <Button size="sm" onClick={handleUnlock}>
                    <Unlock className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {viewMode === 'daily' ? (
          <>
            {/* Date Navigation */}
            <div className="flex items-center justify-between bg-gradient-to-r from-primary/10 to-primary/5 rounded-xl p-3">
              <Button variant="ghost" size="sm" onClick={() => navigateDate(-1)}>
                {isAr ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
              </Button>
              <div className="text-center">
                <div className="font-bold text-lg">{formatDate(selectedDate)}</div>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="mt-1 h-7 w-40 mx-auto text-xs"
                />
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigateDate(1)}>
                {isAr ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
              </Button>
            </div>

            {/* Summary Cards */}
            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[1,2,3,4].map(i => <Card key={i} className="animate-pulse"><CardContent className="p-4 h-24" /></Card>)}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="border-green-200 bg-green-50/50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <TrendingUp className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-green-700">{isAr ? 'إجمالي الدخل' : 'Total Income'}</span>
                    </div>
                    <div className="text-2xl font-bold text-green-700">
                      {statsUnlocked ? `${summary?.total_income?.toLocaleString() || 0} ${isAr ? 'ر.س' : 'SAR'}` : hiddenValue}
                    </div>
                    <div className="text-xs text-green-600 mt-1">
                      {summary?.invoice_count || 0} {isAr ? 'فاتورة' : 'invoices'}
                    </div>
                    {statsUnlocked && comparison && (
                      <div className="flex gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">{isAr ? 'أمس:' : 'Yesterday:'}</span>
                        {getComparisonArrow(summary?.total_income, comparison?.yesterday?.income)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-red-200 bg-red-50/50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <ArrowDownCircle className="w-4 h-4 text-red-600" />
                      <span className="text-sm text-red-700">{isAr ? 'المصروفات' : 'Expenses'}</span>
                    </div>
                    <div className="text-2xl font-bold text-red-700">
                      {statsUnlocked ? `${summary?.total_expenses?.toLocaleString() || 0} ${isAr ? 'ر.س' : 'SAR'}` : hiddenValue}
                    </div>
                    <div className="text-xs text-red-600 mt-1">
                      {summary?.expense_count || 0} {isAr ? 'مصروف' : 'expenses'}
                    </div>
                    {statsUnlocked && comparison && (
                      <div className="flex gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">{isAr ? 'أمس:' : 'Yesterday:'}</span>
                        {getComparisonArrow(summary?.total_expenses, comparison?.yesterday?.expenses)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-purple-200 bg-purple-50/50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <ArrowDownCircle className="w-4 h-4 text-purple-600" />
                      <span className="text-sm text-purple-700">{isAr ? 'المرتجعات' : 'Refunds'}</span>
                    </div>
                    <div className="text-2xl font-bold text-purple-700">
                      {statsUnlocked ? `${summary?.total_refunds?.toLocaleString() || 0} ${isAr ? 'ر.س' : 'SAR'}` : hiddenValue}
                    </div>
                    <div className="text-xs text-purple-600 mt-1">
                      {summary?.refund_count || 0} {isAr ? 'مرتجع' : 'refunds'}
                    </div>
                  </CardContent>
                </Card>

                <Card className={`${(summary?.net_profit || 0) >= 0 ? 'border-blue-200 bg-blue-50/50' : 'border-orange-200 bg-orange-50/50'}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Wallet className="w-4 h-4 text-blue-600" />
                      <span className="text-sm text-blue-700">{isAr ? 'صافي الربح' : 'Net Profit'}</span>
                    </div>
                    <div className={`text-2xl font-bold ${(summary?.net_profit || 0) >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>
                      {statsUnlocked ? `${summary?.net_profit?.toLocaleString() || 0} ${isAr ? 'ر.س' : 'SAR'}` : hiddenValue}
                    </div>
                    {statsUnlocked && comparison && (
                      <div className="flex gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">{isAr ? 'الأسبوع الماضي:' : 'Last week:'}</span>
                        {getComparisonArrow(summary?.net_profit, comparison?.last_week?.net)}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Comparison Card */}
            {statsUnlocked && comparison && (
              <Card className="border-indigo-200 bg-indigo-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-indigo-700">
                    <TrendingUp className="w-4 h-4" />
                    {isAr ? 'المقارنة اليومية' : 'Daily Comparison'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      { label: isAr ? 'اليوم' : 'Today', data: comparison.today, highlight: true },
                      { label: isAr ? 'أمس' : 'Yesterday', data: comparison.yesterday },
                      { label: isAr ? 'نفس اليوم الأسبوع الماضي' : 'Same day last week', data: comparison.last_week }
                    ].map((item, idx) => (
                      <div key={idx} className={`rounded-lg p-3 ${item.highlight ? 'bg-indigo-100 border border-indigo-200' : 'bg-white border'}`}>
                        <div className="text-xs font-semibold text-muted-foreground mb-2">{item.label}</div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-green-600">{isAr ? 'دخل' : 'Income'}</span>
                            <span className="font-bold text-green-700">{item.data?.income?.toLocaleString() || 0}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-red-600">{isAr ? 'مصروفات' : 'Expenses'}</span>
                            <span className="font-bold text-red-700">{item.data?.expenses?.toLocaleString() || 0}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-purple-600">{isAr ? 'مرتجعات' : 'Refunds'}</span>
                            <span className="font-bold text-purple-700">{item.data?.refunds?.toLocaleString() || 0}</span>
                          </div>
                          <hr />
                          <div className="flex justify-between text-sm font-bold">
                            <span>{isAr ? 'صافي' : 'Net'}</span>
                            <span className={item.data?.net >= 0 ? 'text-green-700' : 'text-red-700'}>
                              {item.data?.net?.toLocaleString() || 0}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Income by Payment Method */}
            {statsUnlocked && summary?.income_by_method && Object.keys(summary.income_by_method).length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-primary" />
                    {isAr ? 'الدخل حسب طريقة الدفع' : 'Income by Payment Method'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(summary.income_by_method).map(([method, amount]) => (
                      <div key={method} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border">
                        <span className="text-sm font-medium">{PAYMENT_LABELS[language]?.[method] || method}</span>
                        <Badge variant="secondary" className="font-bold">{amount.toLocaleString()} {isAr ? 'ر.س' : 'SAR'}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Expenses by Category */}
            {statsUnlocked && summary?.expenses_by_category?.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ArrowDownCircle className="w-4 h-4 text-red-500" />
                    {isAr ? 'المصروفات حسب الفئة' : 'Expenses by Category'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {summary.expenses_by_category.map((cat, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-red-50/50 rounded-lg px-3 py-2 border border-red-100">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{CATEGORY_LABELS[language]?.[cat.category] || cat.category}</span>
                          <Badge variant="outline" className="text-xs">{cat.count} {isAr ? 'عملية' : 'items'}</Badge>
                        </div>
                        <span className="font-bold text-red-700">{cat.total.toLocaleString()} {isAr ? 'ر.س' : 'SAR'}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Add Expense + Filters + Export */}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setShowAddExpense(!showAddExpense)} className="bg-red-600 hover:bg-red-700">
                <Plus className="w-4 h-4 ml-1" />
                {isAr ? 'إضافة مصروف' : 'Add Expense'}
              </Button>
              <div className="flex-1" />
              <div className="relative">
                <Search className="w-4 h-4 absolute right-2 top-2 text-muted-foreground" />
                <Input
                  placeholder={isAr ? 'بحث...' : 'Search...'}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-8 w-40 pr-8 text-sm"
                />
              </div>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="h-8 w-32 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isAr ? 'الكل' : 'All'}</SelectItem>
                  {Object.entries(CATEGORY_LABELS[language] || {}).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={exportCSV}>
                <Download className="w-4 h-4 ml-1" />
                CSV
              </Button>
              <Button variant="outline" size="sm" onClick={exportPDF}>
                <Download className="w-4 h-4 ml-1" />
                PDF
              </Button>
            </div>

            {/* Add Expense Form */}
            {showAddExpense && (
              <Card className="border-red-200 bg-red-50/30">
                <CardContent className="p-4">
                  <h3 className="font-bold text-red-700 mb-3 flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    {isAr ? 'إضافة مصروف جديد' : 'Add New Expense'}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <Label className="text-xs">{isAr ? 'الوصف' : 'Description'}</Label>
                      <Input
                        value={expenseForm.description}
                        onChange={(e) => setExpenseForm({...expenseForm, description: e.target.value})}
                        placeholder={isAr ? 'وصف المصروف...' : 'Expense description...'}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{isAr ? 'المبلغ' : 'Amount'}</Label>
                      <Input
                        type="number"
                        value={expenseForm.amount}
                        onChange={(e) => setExpenseForm({...expenseForm, amount: e.target.value})}
                        placeholder="0.00"
                        className="h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{isAr ? 'الفئة' : 'Category'}</Label>
                      <Select value={expenseForm.category} onValueChange={(v) => setExpenseForm({...expenseForm, category: v})}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(CATEGORY_LABELS[language] || {}).map(([key, label]) => (
                            <SelectItem key={key} value={key}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">{isAr ? 'ملاحظات' : 'Notes'}</Label>
                      <Input
                        value={expenseForm.notes}
                        onChange={(e) => setExpenseForm({...expenseForm, notes: e.target.value})}
                        placeholder={isAr ? 'ملاحظات...' : 'Notes...'}
                        className="h-9"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" onClick={handleAddExpense} className="bg-red-600 hover:bg-red-700">
                      <Save className="w-4 h-4 ml-1" />
                      {isAr ? 'حفظ' : 'Save'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowAddExpense(false)}>
                      <X className="w-4 h-4 ml-1" />
                      {isAr ? 'إلغاء' : 'Cancel'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Edit Expense Form */}
            {editingExpense && (
              <Card className="border-yellow-200 bg-yellow-50/30">
                <CardContent className="p-4">
                  <h3 className="font-bold text-yellow-700 mb-3 flex items-center gap-2">
                    <Edit className="w-4 h-4" />
                    {isAr ? 'تعديل المصروف' : 'Edit Expense'}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <Label className="text-xs">{isAr ? 'الوصف' : 'Description'}</Label>
                      <Input
                        value={editingExpense.description}
                        onChange={(e) => setEditingExpense({...editingExpense, description: e.target.value})}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{isAr ? 'المبلغ' : 'Amount'}</Label>
                      <Input
                        type="number"
                        value={editingExpense.amount}
                        onChange={(e) => setEditingExpense({...editingExpense, amount: e.target.value})}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{isAr ? 'الفئة' : 'Category'}</Label>
                      <Select value={editingExpense.category} onValueChange={(v) => setEditingExpense({...editingExpense, category: v})}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(CATEGORY_LABELS[language] || {}).map(([key, label]) => (
                            <SelectItem key={key} value={key}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">{isAr ? 'ملاحظات' : 'Notes'}</Label>
                      <Input
                        value={editingExpense.notes || ''}
                        onChange={(e) => setEditingExpense({...editingExpense, notes: e.target.value})}
                        className="h-9"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" onClick={handleUpdateExpense}>
                      <Save className="w-4 h-4 ml-1" />
                      {isAr ? 'تحديث' : 'Update'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditingExpense(null)}>
                      <X className="w-4 h-4 ml-1" />
                      {isAr ? 'إلغاء' : 'Cancel'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Transactions Table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-primary" />
                  {isAr ? 'جميع المعاملات' : 'All Transactions'}
                  <Badge variant="secondary">{filteredTransactions.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="data-table w-full">
                    <thead>
                      <tr>
                        <th className="text-xs">{isAr ? 'النوع' : 'Type'}</th>
                        <th className="text-xs">{isAr ? 'الرقم' : 'Number'}</th>
                        <th className="text-xs">{isAr ? 'الوصف' : 'Description'}</th>
                        <th className="text-xs">{isAr ? 'المبلغ' : 'Amount'}</th>
                        <th className="text-xs">{isAr ? 'التفاصيل' : 'Details'}</th>
                        <th className="text-xs">{isAr ? 'الوقت' : 'Time'}</th>
                        <th className="text-xs">{isAr ? 'إجراءات' : 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTransactions.length > 0 ? filteredTransactions.map((tx, idx) => (
                        <tr key={idx} className="hover:bg-muted/50">
                          <td>
                            <Badge className={
                              tx.type === 'invoice' ? 'bg-green-100 text-green-700 border-green-200' :
                              tx.type === 'refund' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                              'bg-red-100 text-red-700 border-red-200'
                            }>
                              {tx.type === 'invoice' ? (isAr ? 'فاتورة' : 'Invoice') :
                               tx.type === 'refund' ? (isAr ? 'مرتجع' : 'Refund') :
                               (isAr ? 'مصروف' : 'Expense')}
                            </Badge>
                          </td>
                          <td className="font-mono text-xs">
                            {tx.number ? `#${tx.number}` : '-'}
                          </td>
                          <td className="text-sm font-medium">{tx.description || '-'}</td>
                          <td className={`font-bold ${
                            tx.type === 'invoice' ? 'text-green-700' :
                            tx.type === 'refund' ? 'text-purple-700' : 'text-red-700'
                          }`}>
                            {statsUnlocked ? (
                              <>
                                {tx.type === 'invoice' ? '+' : '-'}{tx.amount?.toLocaleString()} {isAr ? 'ر.س' : 'SAR'}
                              </>
                            ) : hiddenValue}
                          </td>
                          <td className="text-xs text-muted-foreground">
                            {tx.type === 'invoice' && tx.payment_method && (
                              <Badge variant="outline" className="text-xs">
                                {PAYMENT_LABELS[language]?.[tx.payment_method] || tx.payment_method}
                              </Badge>
                            )}
                            {tx.type === 'expense' && (
                              <Badge variant="outline" className="text-xs">
                                {CATEGORY_LABELS[language]?.[tx.category] || tx.category}
                              </Badge>
                            )}
                            {tx.type === 'refund' && tx.reason && (
                              <span className="text-xs">{tx.reason}</span>
                            )}
                          </td>
                          <td className="text-xs text-muted-foreground">
                            {tx.time ? new Date(tx.time).toLocaleTimeString(isAr ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '-'}
                          </td>
                          <td>
                            {tx.type === 'expense' && (
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => setEditingExpense({ id: tx.id, description: tx.description, amount: tx.amount, category: tx.category, notes: tx.notes })}
                                >
                                  <Edit className="w-3 h-3 text-blue-600" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => handleDeleteExpense(tx.id)}
                                >
                                  <Trash2 className="w-3 h-3 text-red-600" />
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={7} className="text-center py-8 text-muted-foreground">
                            {isAr ? 'لا توجد معاملات لهذا اليوم' : 'No transactions for this day'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            {/* Calendar View */}
            <div className="flex items-center justify-between bg-gradient-to-r from-primary/10 to-primary/5 rounded-xl p-3">
              <Button variant="ghost" size="sm" onClick={() => navigateMonth(-1)}>
                {isAr ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
              </Button>
              <div className="text-center">
                <div className="font-bold text-lg">
                  {MONTH_NAMES[language][parseInt(calendarMonth.split('-')[1]) - 1]} {calendarMonth.split('-')[0]}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigateMonth(1)}>
                {isAr ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
              </Button>
            </div>

            {/* Monthly Totals */}
            {statsUnlocked && calendarData?.totals && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="border-green-200 bg-green-50/50">
                  <CardContent className="p-3 text-center">
                    <div className="text-xs text-green-600">{isAr ? 'دخل الشهر' : 'Monthly Income'}</div>
                    <div className="text-lg font-bold text-green-700">{calendarData.totals.income.toLocaleString()}</div>
                  </CardContent>
                </Card>
                <Card className="border-red-200 bg-red-50/50">
                  <CardContent className="p-3 text-center">
                    <div className="text-xs text-red-600">{isAr ? 'مصروفات الشهر' : 'Monthly Expenses'}</div>
                    <div className="text-lg font-bold text-red-700">{calendarData.totals.expenses.toLocaleString()}</div>
                  </CardContent>
                </Card>
                <Card className="border-purple-200 bg-purple-50/50">
                  <CardContent className="p-3 text-center">
                    <div className="text-xs text-purple-600">{isAr ? 'مرتجعات الشهر' : 'Monthly Refunds'}</div>
                    <div className="text-lg font-bold text-purple-700">{calendarData.totals.refunds.toLocaleString()}</div>
                  </CardContent>
                </Card>
                <Card className={`${calendarData.totals.net >= 0 ? 'border-blue-200 bg-blue-50/50' : 'border-orange-200 bg-orange-50/50'}`}>
                  <CardContent className="p-3 text-center">
                    <div className="text-xs text-blue-600">{isAr ? 'صافي الشهر' : 'Monthly Net'}</div>
                    <div className={`text-lg font-bold ${calendarData.totals.net >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>
                      {calendarData.totals.net.toLocaleString()}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Calendar Grid */}
            <Card>
              <CardContent className="p-3">
                {loading ? (
                  <div className="text-center py-10 text-muted-foreground">{isAr ? 'جاري التحميل...' : 'Loading...'}</div>
                ) : (
                  renderCalendar()
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
};

export default DailyLedgerPage;
