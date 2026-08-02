import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
// eslint-disable-next-line react-hooks/exhaustive-deps
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { reportsAPI, activitiesAPI, exportAPI, branchesAPI } from '../services/api';
import { 
  BarChart3, 
  Calendar,
  Download,
  TrendingUp,
  Receipt,
  Printer,
  RefreshCcw,
  DollarSign,
  ArrowDownCircle,
  Wallet,
  Search,
  Lock,
  Unlock
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';

// Keyword-based activity groups (same convention as the Levels page) so the
// activity filter can select "all swimming" / "all football" / "all karate" at once.
const ACTIVITY_GROUPS = [
  { id: 'swimming', label_ar: 'كل السباحة', label_en: 'All Swimming', keywords: ['سباحة', 'سباحه', 'swim'] },
  { id: 'football', label_ar: 'كل كرة القدم', label_en: 'All Football', keywords: ['قدم', 'كره', 'كرة', 'foot', 'soccer'] },
  { id: 'karate', label_ar: 'كل الكاراتيه', label_en: 'All Karate', keywords: ['كارات', 'كاراتيه', 'كارتيه', 'karate'] },
];
const activityInGroup = (activity, group) => {
  const name = `${activity.name_ar || ''} ${activity.name || ''}`.toLowerCase();
  return group.keywords.some(k => name.includes(k));
};

export const ReportsPage = () => {
  const { t, language } = useLanguage();
  const { selectedBranchId, isAdmin } = useAuth();
  const [report, setReport] = useState(null);
  const [nationalitiesReport, setNationalitiesReport] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activities, setActivities] = useState([]);
  const [branches, setBranches] = useState([]);
  const [branchFilter, setBranchFilter] = useState(selectedBranchId || 'all');
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    start_date: '',
    end_date: '',
    activity_id: 'all'
  });
  
  const [statsUnlocked, setStatsUnlocked] = useState(false);
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const hiddenValue = '••••••';

  const handleUnlockStats = async () => {
    const { verifyOperationPassword } = await import('../utils/operationPassword');
    const ok = await verifyOperationPassword('reports', passwordInput, selectedBranchId);
    if (ok) {
      setStatsUnlocked(true);
      setShowPasswordInput(false);
      setPasswordInput('');
    } else {
      setPasswordInput('');
    }
  };

  const handleLockStats = () => {
    setStatsUnlocked(false);
    setShowPasswordInput(false);
    setPasswordInput('');
  };

  // Detail view states
  const [activeDetail, setActiveDetail] = useState(null); // 'revenue', 'refunds', 'net', 'invoices'

  // Keep the page-level branch filter in sync with the global branch switcher.
  useEffect(() => {
    setBranchFilter(selectedBranchId || 'all');
  }, [selectedBranchId]);

  // When the branch changes, drop an activity selection that belongs to another branch.
  useEffect(() => {
    if (filters.activity_id === 'all' || branchFilter === 'all') return;
    const act = activities.find(a => a.id === filters.activity_id);
    if (act && act.branch_id && act.branch_id !== branchFilter) {
      setFilters(prev => ({ ...prev, activity_id: 'all' }));
    }
  }, [branchFilter, activities]);

  // Load the branch list once (admins get all branches; non-admins are scoped server-side).
  useEffect(() => {
    if (!isAdmin) return;
    branchesAPI.getAll()
      .then(res => setBranches(res.data || []))
      .catch(() => setBranches([]));
  }, [isAdmin]);

  useEffect(() => {
    loadData();
  }, [branchFilter]);

  // Convert the filter value ('all' | 'group:<id>' | activity id) into the
  // activity_id param sent to the backend (comma-separated ids for a group).
  const resolveActivityParam = (value, actsList = activities) => {
    if (!value || value === 'all') return null;
    if (value.startsWith('group:')) {
      const group = ACTIVITY_GROUPS.find(g => g.id === value.slice(6));
      if (!group) return null;
      const ids = (actsList || [])
        .filter(a => branchFilter === 'all' || !a.branch_id || a.branch_id === branchFilter)
        .filter(a => activityInGroup(a, group))
        .map(a => a.id);
      return ids.length ? ids.join(',') : null;
    }
    return value;
  };

  const loadData = async () => {
    try {
      const branchParams = branchFilter && branchFilter !== 'all' ? { branch_filter: branchFilter } : {};
      const filterParams = {};
      if (filters.start_date) filterParams.start_date = filters.start_date;
      if (filters.end_date) filterParams.end_date = filters.end_date;
      const actParam = resolveActivityParam(filters.activity_id);
      if (actParam) filterParams.activity_id = actParam;
      const [reportRes, activitiesRes, nationalitiesRes] = await Promise.all([
        reportsAPI.getFinancial({ ...filterParams, ...branchParams }),
        activitiesAPI.getAll(),
        reportsAPI.getNationalities(branchFilter).catch(() => ({ data: null }))
      ]);
      setReport(reportRes.data);
      setActivities(Array.isArray(activitiesRes.data) ? activitiesRes.data : []);
      setNationalitiesReport(nationalitiesRes.data);
    } catch (error) {
      console.error('Failed to load report:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date) params.end_date = filters.end_date;
      const actParam = resolveActivityParam(filters.activity_id);
      if (actParam) params.activity_id = actParam;
      if (branchFilter && branchFilter !== 'all') params.branch_filter = branchFilter;
      
      const response = await reportsAPI.getFinancial(params);
      setReport(response.data);
    } catch (error) {
      console.error('Failed to filter report:', error);
    } finally {
      setLoading(false);
    }
  };

  const activityColors = ['#0EA5E9', '#22C55E', '#EF4444', '#8B5CF6', '#F97316'];

  const formatCurrency = (amount) => {
    return `${amount?.toLocaleString() || 0} ${t('sar')}`;
  };
  
  const toggleDetail = (type) => {
    setActiveDetail(activeDetail === type ? null : type);
  };

  if (loading) {
    return (
      <Layout title={t('reports')}>
        <div className="flex items-center justify-center h-64">
          <div className="spinner" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('reports')}>
      <div className="space-y-6" data-testid="reports-page">
        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            {/* Quick Date Filters */}
            <div className="flex flex-wrap gap-2 mb-4">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  const today = new Date().toISOString().split('T')[0];
                  setFilters({...filters, start_date: today, end_date: today});
                }}
              >
                {language === 'ar' ? 'اليوم' : 'Today'}
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  const today = new Date();
                  const weekStart = new Date(today);
                  weekStart.setDate(today.getDate() - today.getDay());
                  setFilters({
                    ...filters, 
                    start_date: weekStart.toISOString().split('T')[0], 
                    end_date: today.toISOString().split('T')[0]
                  });
                }}
              >
                {language === 'ar' ? 'هذا الأسبوع' : 'This Week'}
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  const today = new Date();
                  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                  setFilters({
                    ...filters, 
                    start_date: monthStart.toISOString().split('T')[0], 
                    end_date: today.toISOString().split('T')[0]
                  });
                }}
              >
                {language === 'ar' ? 'هذا الشهر' : 'This Month'}
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  const today = new Date();
                  const yearStart = new Date(today.getFullYear(), 0, 1);
                  setFilters({
                    ...filters, 
                    start_date: yearStart.toISOString().split('T')[0], 
                    end_date: today.toISOString().split('T')[0]
                  });
                }}
              >
                {language === 'ar' ? 'هذه السنة' : 'This Year'}
              </Button>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setFilters({start_date: '', end_date: '', activity_id: 'all'})}
              >
                {language === 'ar' ? 'مسح الفلتر' : 'Clear'}
              </Button>
            </div>
            
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-2">
                <Label>{t('from')}</Label>
                <Input
                  type="date"
                  value={filters.start_date}
                  onChange={(e) => setFilters({...filters, start_date: e.target.value})}
                  data-testid="filter-start-date"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('to')}</Label>
                <Input
                  type="date"
                  value={filters.end_date}
                  onChange={(e) => setFilters({...filters, end_date: e.target.value})}
                  data-testid="filter-end-date"
                />
              </div>
              {isAdmin && (
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'الفرع' : 'Branch'}</Label>
                <Select
                  value={branchFilter}
                  onValueChange={(value) => setBranchFilter(value)}
                >
                  <SelectTrigger className="w-[180px]" data-testid="filter-branch">
                    <SelectValue placeholder={language === 'ar' ? 'الفرع' : 'Branch'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{language === 'ar' ? 'كل الفروع' : 'All Branches'}</SelectItem>
                    {branches.map(branch => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {language === 'ar' ? (branch.name_ar || branch.name) : (branch.name || branch.name_ar)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              )}
              <div className="space-y-2">
                <Label>{t('activity_name')}</Label>
                <Select 
                  value={filters.activity_id} 
                  onValueChange={(value) => setFilters({...filters, activity_id: value})}
                >
                  <SelectTrigger className="w-[180px]" data-testid="filter-activity">
                    <SelectValue placeholder={t('activities')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{language === 'ar' ? 'الكل' : 'All'}</SelectItem>
                    {(() => {
                      const visible = activities.filter(a => branchFilter === 'all' || !a.branch_id || a.branch_id === branchFilter);
                      const items = [];
                      const usedIds = new Set();
                      ACTIVITY_GROUPS.forEach(group => {
                        const groupActs = visible.filter(a => activityInGroup(a, group));
                        if (groupActs.length === 0) return;
                        items.push(
                          <SelectItem key={`group:${group.id}`} value={`group:${group.id}`} className="font-bold">
                            {language === 'ar' ? group.label_ar : group.label_en}
                          </SelectItem>
                        );
                        groupActs.forEach(a => {
                          usedIds.add(a.id);
                          items.push(
                            <SelectItem key={a.id} value={a.id} className="ps-6">
                              {language === 'ar' ? a.name_ar : a.name}
                            </SelectItem>
                          );
                        });
                      });
                      const rest = visible.filter(a => !usedIds.has(a.id));
                      rest.forEach(a => {
                        items.push(
                          <SelectItem key={a.id} value={a.id}>
                            {language === 'ar' ? a.name_ar : a.name}
                          </SelectItem>
                        );
                      });
                      return items;
                    })()}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'بحث' : 'Search'}</Label>
                <div className="relative">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input 
                    placeholder={language === 'ar' ? 'بحث بالاسم أو رقم الفاتورة...' : 'Search by name or invoice...'} 
                    value={searchTerm} 
                    onChange={(e) => setSearchTerm(e.target.value)} 
                    className="ps-10 w-[220px]"
                    data-testid="report-search"
                  />
                </div>
              </div>
              <Button onClick={handleFilter} data-testid="apply-filter-btn">
                <Calendar className="w-4 h-4 me-2" />
                {t('filter')}
              </Button>
              {isAdmin && (
              <Button 
                variant="outline" 
                onClick={() => {
                  const token = localStorage.getItem('token');
                  const params = {};
                  if (filters.start_date) params.start_date = filters.start_date;
                  if (filters.end_date) params.end_date = filters.end_date;
                  if (branchFilter && branchFilter !== 'all') params.branch_filter = branchFilter;
                  const actParam = resolveActivityParam(filters.activity_id);
                  if (actParam) params.activity_id = actParam;
                  const url = exportAPI.reports(params) + `&token=${token}`;
                  window.open(url, '_blank');
                }}
                data-testid="export-report-btn"
              >
                <Download className="w-4 h-4 me-2" />
                {language === 'ar' ? 'تصدير Excel' : 'Export Excel'}
              </Button>
              )}
              <Button 
                variant="outline" 
                onClick={() => {
                  const printWindow = window.open('', '', 'width=900,height=700');
                  const revenueRows = report?.revenue_by_activity?.map((r, i) => 
                    `<tr><td>${i+1}</td><td>${r.name}</td><td>${r.total?.toLocaleString() || 0} ر.س</td></tr>`
                  ).join('') || '<tr><td colspan="3">لا توجد بيانات</td></tr>';
                  
                  const refundRows = report?.refund_details?.map((r, i) => 
                    `<tr><td>${i+1}</td><td>#${r.credit_note_number || '-'}</td><td>${r.original_invoice_number || '-'}</td><td>${r.customer_name || '-'}</td><td>${r.refund_amount?.toLocaleString() || 0} ر.س</td><td>${r.reason || '-'}</td><td>${r.created_by || '-'}</td></tr>`
                  ).join('') || '';
                  
                  printWindow.document.write(`
                    <html>
                      <head>
                        <title>التقارير المالية</title>
                        <style>
                          @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap');
                          body { font-family: 'Tajawal', Arial; direction: rtl; padding: 20px; }
                          h1 { color: #F97316; text-align: center; margin-bottom: 10px; }
                          h2 { color: #1E3A8A; text-align: center; font-size: 16px; margin-bottom: 20px; }
                          h3 { color: #1E3A8A; margin-top: 25px; border-bottom: 2px solid #F97316; padding-bottom: 5px; }
                          .summary { display: flex; flex-wrap: wrap; justify-content: space-around; margin-bottom: 30px; padding: 15px; background: #f8fafc; border-radius: 8px; gap: 15px; }
                          .summary-item { text-align: center; min-width: 120px; }
                          .summary-value { font-size: 20px; font-weight: bold; }
                          .summary-value.revenue { color: #F97316; }
                          .summary-value.refund { color: #9333ea; }
                          .summary-value.net { color: #22c55e; }
                          .summary-label { font-size: 11px; color: #666; }
                          table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                          th, td { border: 1px solid #ddd; padding: 8px; text-align: right; font-size: 12px; }
                          th { background: #F97316; color: white; }
                          th.refund { background: #9333ea; }
                          .footer { text-align: center; margin-top: 30px; font-size: 11px; color: #666; }
                          .refund-section { margin-top: 30px; padding: 15px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; }
                          .refund-section h3 { color: #9333ea; border-color: #9333ea; }
                        </style>
                      </head>
                      <body>
                        <h1>شركة اداء الابطال العالمية للرياضة</h1>
                        <h2>التقارير المالية ${filters.start_date ? '(' + filters.start_date + ' - ' + filters.end_date + ')' : ''}</h2>
                        <div class="summary">
                          <div class="summary-item">
                            <div class="summary-value revenue">${report?.total_revenue?.toLocaleString() || 0} ر.س</div>
                            <div class="summary-label">إجمالي الإيرادات</div>
                          </div>
                          <div class="summary-item">
                            <div class="summary-value refund">${report?.total_refunds?.toLocaleString() || 0} ر.س</div>
                            <div class="summary-label">إجمالي المسترجع</div>
                          </div>
                          <div class="summary-item">
                            <div class="summary-value net">${report?.net_revenue?.toLocaleString() || 0} ر.س</div>
                            <div class="summary-label">صافي الإيرادات</div>
                          </div>
                          <div class="summary-item">
                            <div class="summary-value">${report?.invoice_count || 0}</div>
                            <div class="summary-label">عدد الفواتير</div>
                          </div>
                        </div>
                        <h3>الإيرادات حسب النشاط</h3>
                        <table>
                          <thead><tr><th>م</th><th>النشاط</th><th>الإيرادات</th></tr></thead>
                          <tbody>${revenueRows}</tbody>
                        </table>
                        ${report?.refund_count > 0 ? `
                        <div class="refund-section">
                          <h3>إشعارات الدائن (المرتجعات) - ${report?.refund_count || 0} إشعار</h3>
                          <table>
                            <thead><tr><th class="refund">م</th><th class="refund">رقم الإشعار</th><th class="refund">الفاتورة الأصلية</th><th class="refund">العميل</th><th class="refund">المبلغ المسترجع</th><th class="refund">السبب</th><th class="refund">المحرر</th></tr></thead>
                            <tbody>${refundRows}</tbody>
                          </table>
                        </div>
                        ` : ''}
                        <div class="footer">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-SA')}</div>
                      </body>
                    </html>
                  `);
                  printWindow.document.close();
                  printWindow.print();
                }}
                data-testid="print-report-btn"
              >
                <Printer className="w-4 h-4 me-2" />
                {language === 'ar' ? 'طباعة' : 'Print'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Selected Period Display */}
        {(filters.start_date || filters.end_date) && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              <span className="font-medium text-blue-800">
                {language === 'ar' ? 'الفترة المحددة:' : 'Selected Period:'}
              </span>
              <span className="text-blue-600">
                {filters.start_date || (language === 'ar' ? 'البداية' : 'Start')} 
                {' → '} 
                {filters.end_date || (language === 'ar' ? 'النهاية' : 'End')}
              </span>
            </div>
          </div>
        )}

        {/* Lock/Unlock Controls */}
        <div className="flex items-center justify-end gap-2">
          {!statsUnlocked ? (
            showPasswordInput ? (
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-muted-foreground" />
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleUnlockStats()}
                  placeholder={language === 'ar' ? 'كلمة المرور' : 'Password'}
                  className="border rounded px-2 py-1 text-sm w-32"
                  autoFocus
                />
                <Button size="sm" onClick={handleUnlockStats}>
                  {language === 'ar' ? 'دخول' : 'Unlock'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowPasswordInput(false); setPasswordInput(''); }}>✕</Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setShowPasswordInput(true)} className="gap-2">
                <Lock className="w-4 h-4" />
                {language === 'ar' ? 'عرض الأرقام' : 'Show Numbers'}
              </Button>
            )
          ) : (
            <Button variant="outline" size="sm" onClick={handleLockStats} className="gap-2">
              <Unlock className="w-4 h-4" />
              {language === 'ar' ? 'إخفاء الأرقام' : 'Hide Numbers'}
            </Button>
          )}
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className={`stat-card cursor-pointer hover:shadow-lg transition-shadow ${activeDetail === 'revenue' ? 'ring-2 ring-primary' : ''}`} data-testid="total-revenue-card" onClick={() => statsUnlocked && toggleDetail('revenue')}>
            <div className="stat-card-icon bg-primary/10">
              <TrendingUp className="w-6 h-6 text-primary" />
            </div>
            <div className="stat-card-value text-primary">
              {statsUnlocked ? formatCurrency(report?.total_revenue) : hiddenValue}
            </div>
            <div className="stat-card-label">{language === 'ar' ? 'إجمالي الإيرادات' : 'Total Revenue'}</div>
            <div className="text-xs text-muted-foreground mt-1">{statsUnlocked ? (language === 'ar' ? 'اضغط للتفاصيل' : 'Click for details') : ''}</div>
          </Card>

          <Card className={`stat-card cursor-pointer hover:shadow-lg transition-shadow ${activeDetail === 'refunds' ? 'ring-2 ring-purple-500' : ''}`} data-testid="total-refunds-card" onClick={() => statsUnlocked && toggleDetail('refunds')}>
            <div className="stat-card-icon bg-purple-500/10">
              <RefreshCcw className="w-6 h-6 text-purple-500" />
            </div>
            <div className="stat-card-value text-purple-500">
              {statsUnlocked ? formatCurrency(report?.total_refunds) : hiddenValue}
            </div>
            <div className="stat-card-label">{language === 'ar' ? 'إجمالي المسترجع' : 'Total Refunds'}</div>
            <div className="text-xs text-muted-foreground mt-1">{statsUnlocked ? (language === 'ar' ? 'اضغط للتفاصيل' : 'Click for details') : ''}</div>
          </Card>

          <Card className={`stat-card cursor-pointer hover:shadow-lg transition-shadow ${activeDetail === 'net' ? 'ring-2 ring-green-500' : ''}`} data-testid="net-revenue-card" onClick={() => statsUnlocked && toggleDetail('net')}>
            <div className="stat-card-icon bg-green-500/10">
              <Wallet className="w-6 h-6 text-green-500" />
            </div>
            <div className="stat-card-value text-green-500">
              {statsUnlocked ? formatCurrency(report?.net_revenue) : hiddenValue}
            </div>
            <div className="stat-card-label">{language === 'ar' ? 'صافي الإيرادات' : 'Net Revenue'}</div>
            <div className="text-xs text-muted-foreground mt-1">{statsUnlocked ? (language === 'ar' ? 'اضغط للتفاصيل' : 'Click for details') : ''}</div>
          </Card>

          <Card className={`stat-card cursor-pointer hover:shadow-lg transition-shadow ${activeDetail === 'invoices' ? 'ring-2 ring-blue-500' : ''}`} data-testid="invoice-count-card" onClick={() => statsUnlocked && toggleDetail('invoices')}>
            <div className="stat-card-icon bg-blue-500/10">
              <Receipt className="w-6 h-6 text-blue-500" />
            </div>
            <div className="stat-card-value text-blue-500">
              {statsUnlocked ? (report?.invoice_count || 0) : hiddenValue}
            </div>
            <div className="stat-card-label">{t('invoices')}</div>
            <div className="text-xs text-muted-foreground mt-1">{statsUnlocked ? (language === 'ar' ? 'اضغط للتفاصيل' : 'Click for details') : ''}</div>
          </Card>
        </div>

        {/* Revenue Details */}
        {statsUnlocked && activeDetail === 'revenue' && (
          <Card className="border-primary/30 bg-primary/5 animate-in slide-in-from-top-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-primary">
                <TrendingUp className="w-5 h-5" />
                {language === 'ar' ? 'تفاصيل الإيرادات' : 'Revenue Details'}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setActiveDetail(null)}>✕</Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="p-4 bg-white rounded-lg border">
                  <div className="text-2xl font-bold text-primary">{formatCurrency(report?.total_revenue)}</div>
                  <div className="text-sm text-muted-foreground">{language === 'ar' ? 'إجمالي الإيرادات من الفواتير المدفوعة' : 'Total from paid invoices'}</div>
                </div>
                <div className="p-4 bg-white rounded-lg border">
                  <div className="text-2xl font-bold text-primary">{report?.invoice_count || 0}</div>
                  <div className="text-sm text-muted-foreground">{language === 'ar' ? 'عدد الفواتير المدفوعة' : 'Paid invoices count'}</div>
                </div>
              </div>
              {report?.revenue_by_activity?.length > 0 && (
                <div className="overflow-x-auto">
                  <h4 className="font-semibold mb-2">{language === 'ar' ? 'الإيرادات حسب النشاط:' : 'Revenue by Activity:'}</h4>
                  <table className="data-table w-full">
                    <thead>
                      <tr className="bg-primary/10">
                        <th>{language === 'ar' ? 'النشاط' : 'Activity'}</th>
                        <th>{language === 'ar' ? 'عدد الاشتراكات' : 'Subscriptions'}</th>
                        <th>{language === 'ar' ? 'الإيرادات' : 'Revenue'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.revenue_by_activity.map((activity, idx) => (
                        <tr key={idx}>
                          <td className="font-medium">{activity.name}</td>
                          <td>{activity.count}</td>
                          <td className="font-bold text-primary">{activity.total?.toLocaleString()} {t('sar')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Refunds Details */}
        {statsUnlocked && activeDetail === 'refunds' && (
          <Card className="border-purple-200 bg-purple-50/30 animate-in slide-in-from-top-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-purple-700">
                <RefreshCcw className="w-5 h-5" />
                {language === 'ar' ? 'تفاصيل الاسترجاعات' : 'Refunds Details'}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setActiveDetail(null)}>✕</Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="p-4 bg-white rounded-lg border border-purple-200">
                  <div className="text-2xl font-bold text-purple-600">{report?.refund_count || 0}</div>
                  <div className="text-sm text-muted-foreground">{language === 'ar' ? 'عدد عمليات الاسترجاع' : 'Total Refund Operations'}</div>
                </div>
                <div className="p-4 bg-white rounded-lg border border-purple-200">
                  <div className="text-2xl font-bold text-purple-600">{report?.full_refund_count || 0}</div>
                  <div className="text-sm text-muted-foreground">{language === 'ar' ? 'استرجاع كامل' : 'Full Refunds'}</div>
                </div>
                <div className="p-4 bg-white rounded-lg border border-purple-200">
                  <div className="text-2xl font-bold text-purple-600">{report?.partial_refund_count || 0}</div>
                  <div className="text-sm text-muted-foreground">{language === 'ar' ? 'استرجاع جزئي' : 'Partial Refunds'}</div>
                </div>
              </div>
              {report?.refund_details?.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="data-table w-full">
                    <thead>
                      <tr className="bg-purple-100">
                        <th className="text-purple-700">{language === 'ar' ? 'رقم الإشعار' : 'Credit Note #'}</th>
                        <th className="text-purple-700">{language === 'ar' ? 'الفاتورة الأصلية' : 'Original Invoice'}</th>
                        <th className="text-purple-700">{language === 'ar' ? 'العميل' : 'Customer'}</th>
                        <th className="text-purple-700">{language === 'ar' ? 'المسترجع' : 'Refunded'}</th>
                        <th className="text-purple-700">{language === 'ar' ? 'السبب' : 'Reason'}</th>
                        <th className="text-purple-700">{language === 'ar' ? 'المحرر' : 'Created By'}</th>
                        <th className="text-purple-700">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.refund_details.map((refund, idx) => (
                        <tr key={idx}>
                          <td className="font-mono text-sm font-bold text-purple-600">#{refund.credit_note_number || '-'}</td>
                          <td><Badge variant="outline">{refund.original_invoice_number || '-'}</Badge></td>
                          <td>{refund.customer_name || '-'}</td>
                          <td className="font-bold text-purple-600">- {refund.refund_amount} {t('sar')}</td>
                          <td className="text-sm text-muted-foreground">{refund.reason || '-'}</td>
                          <td className="text-sm">{refund.created_by || '-'}</td>
                          <td className="text-sm">{refund.created_at ? new Date(refund.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US') : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">{language === 'ar' ? 'لا توجد إشعارات دائن' : 'No credit notes found'}</div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Net Revenue Details */}
        {statsUnlocked && activeDetail === 'net' && (
          <Card className="border-green-200 bg-green-50/30 animate-in slide-in-from-top-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-green-700">
                <Wallet className="w-5 h-5" />
                {language === 'ar' ? 'تفاصيل صافي الإيرادات' : 'Net Revenue Details'}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setActiveDetail(null)}>✕</Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 bg-white rounded-lg border border-green-200">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-muted-foreground">{language === 'ar' ? 'إجمالي الإيرادات' : 'Total Revenue'}</span>
                    <span className="font-bold text-primary text-lg">{formatCurrency(report?.total_revenue)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-muted-foreground">{language === 'ar' ? 'إجمالي المسترجع (-)' : 'Total Refunds (-)'}</span>
                    <span className="font-bold text-purple-600 text-lg">- {formatCurrency(report?.total_refunds)}</span>
                  </div>
                  <div className="flex justify-between items-center py-3 mt-2 bg-green-100 rounded-lg px-3">
                    <span className="font-semibold text-green-800">{language === 'ar' ? 'صافي الإيرادات' : 'Net Revenue'}</span>
                    <span className="font-bold text-green-700 text-2xl">{formatCurrency(report?.net_revenue)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white rounded-lg border">
                    <div className="text-xl font-bold text-blue-600">{report?.invoice_count || 0}</div>
                    <div className="text-sm text-muted-foreground">{language === 'ar' ? 'فواتير مدفوعة' : 'Paid Invoices'}</div>
                  </div>
                  <div className="p-4 bg-white rounded-lg border">
                    <div className="text-xl font-bold text-purple-600">{report?.refund_count || 0}</div>
                    <div className="text-sm text-muted-foreground">{language === 'ar' ? 'عمليات استرجاع' : 'Refund Operations'}</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Invoices Details */}
        {statsUnlocked && activeDetail === 'invoices' && (
          <Card className="border-blue-200 bg-blue-50/30 animate-in slide-in-from-top-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-blue-700">
                <Receipt className="w-5 h-5" />
                {language === 'ar' ? 'تفاصيل الفواتير' : 'Invoices Details'}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setActiveDetail(null)}>✕</Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="p-4 bg-white rounded-lg border border-blue-200">
                  <div className="text-2xl font-bold text-blue-600">{report?.invoice_count || 0}</div>
                  <div className="text-sm text-muted-foreground">{language === 'ar' ? 'إجمالي الفواتير المدفوعة' : 'Total Paid Invoices'}</div>
                </div>
                <div className="p-4 bg-white rounded-lg border border-blue-200">
                  <div className="text-2xl font-bold text-blue-600">{formatCurrency(report?.total_revenue)}</div>
                  <div className="text-sm text-muted-foreground">{language === 'ar' ? 'إجمالي قيمة الفواتير' : 'Total Invoice Value'}</div>
                </div>
              </div>
              {report?.invoices?.length > 0 ? (
                <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                  <table className="data-table w-full">
                    <thead className="sticky top-0">
                      <tr className="bg-blue-100">
                        <th className="text-blue-700">{language === 'ar' ? 'رقم الفاتورة' : 'Invoice #'}</th>
                        <th className="text-blue-700">{language === 'ar' ? 'العميل' : 'Customer'}</th>
                        <th className="text-blue-700">{language === 'ar' ? 'النشاط' : 'Activity'}</th>
                        <th className="text-blue-700">{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                        <th className="text-blue-700">{language === 'ar' ? 'طريقة الدفع' : 'Payment'}</th>
                        <th className="text-blue-700">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.invoices.map((invoice, idx) => (
                        <tr key={idx}>
                          <td className="font-mono text-sm">#{invoice.id?.slice(0, 8)}</td>
                          <td>{invoice.customer_name_ar || invoice.member_name || '-'}</td>
                          <td className="text-sm">{[...new Set((invoice.items || []).map(it => it.activity_name).filter(Boolean))].join(' / ') || '-'}</td>
                          <td className="font-bold text-blue-600">{invoice.filtered_total ?? invoice.total} {t('sar')}</td>
                          <td>
                            <Badge variant="outline">
                              {invoice.payment_method === 'cash' ? (language === 'ar' ? 'نقداً' : 'Cash') : 
                               invoice.payment_method === 'card' ? (language === 'ar' ? 'بطاقة' : 'Card') : 
                               invoice.payment_method === 'transfer' ? (language === 'ar' ? 'تحويل' : 'Transfer') :
                               invoice.payment_method === 'tabby' ? 'تابي' :
                               invoice.payment_method === 'tamara' ? 'تمارا' :
                               invoice.payment_method}
                            </Badge>
                          </td>
                          <td className="text-sm">{new Date(invoice.paid_at || invoice.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(report.invoice_count || 0) > report.invoices.length && (
                    <p className="text-center text-sm text-muted-foreground mt-2">
                      {language === 'ar' ? `عرض ${report.invoices.length} من ${report.invoice_count} فاتورة — استخدم الفلاتر لتضييق النتائج` : `Showing ${report.invoices.length} of ${report.invoice_count} invoices — use filters to narrow down`}
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">{language === 'ar' ? 'لا توجد فواتير' : 'No invoices found'}</div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Refunds Summary - Old Section Removed, now interactive above */}

        {/* Charts removed */}

        {/* Recent Invoices Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-primary" />
              {t('recent_invoices')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('invoice_number')}</th>
                    <th>{t('member_name')}</th>
                    <th>{t('total')}</th>
                    <th>{t('invoice_date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report?.invoices?.length > 0 ? (
                    report.invoices.slice(0, 10).map(invoice => (
                      <tr key={invoice.id}>
                        <td className="font-mono text-sm">#{invoice.id.slice(0, 8)}</td>
                        <td>{invoice.member_name}</td>
                        <td className="font-bold text-primary">{statsUnlocked ? `${invoice.total} ${t('sar')}` : hiddenValue}</td>
                        <td className="text-sm text-muted-foreground">
                          {new Date(invoice.paid_at || invoice.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="text-center py-8 text-muted-foreground">
                        {t('no_data')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Nationalities per branch */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              {language === 'ar' ? 'الجنسيات حسب الفرع' : 'Nationalities by Branch'}
              {nationalitiesReport && (
                <Badge variant="secondary" className="ms-2">
                  {language === 'ar'
                    ? `إجمالي ${nationalitiesReport.total_members} عضو`
                    : `${nationalitiesReport.total_members} members`}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!nationalitiesReport || (nationalitiesReport.branches || []).length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {language === 'ar' ? 'لا توجد بيانات جنسيات بعد' : 'No nationality data yet'}
              </div>
            ) : (
              <div className="space-y-6">
                {nationalitiesReport.branches.map((b) => (
                  <div key={b.branch_id || 'none'} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold text-base">
                        {b.branch_name || (language === 'ar' ? 'غير محدد' : 'Unspecified')}
                      </h4>
                      <Badge variant="outline">
                        {language === 'ar' ? `${b.total} عضو` : `${b.total} members`}
                      </Badge>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-muted-foreground border-b">
                            <th className="text-start py-2 px-2">{language === 'ar' ? 'الجنسية' : 'Nationality'}</th>
                            <th className="text-start py-2 px-2">{language === 'ar' ? 'العدد' : 'Count'}</th>
                            <th className="text-start py-2 px-2">{language === 'ar' ? 'النسبة' : 'Percentage'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.nationalities.map((n) => (
                            <tr key={n.nationality} className="border-b last:border-0">
                              <td className="py-2 px-2">{n.nationality}</td>
                              <td className="py-2 px-2 font-medium">{n.count}</td>
                              <td className="py-2 px-2 text-muted-foreground">
                                {b.total ? Math.round((n.count / b.total) * 100) : 0}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default ReportsPage;
