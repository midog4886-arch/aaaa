import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { reportsAPI, activitiesAPI } from '../services/api';
import { 
  BarChart3, 
  Calendar,
  Download,
  TrendingUp,
  Receipt
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

export const ReportsPage = () => {
  const { t, language } = useLanguage();
  const [report, setReport] = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    start_date: '',
    end_date: '',
    activity_id: 'all'
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [reportRes, activitiesRes] = await Promise.all([
        reportsAPI.getFinancial(filters),
        activitiesAPI.getAll()
      ]);
      setReport(reportRes.data);
      setActivities(activitiesRes.data);
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
      if (filters.activity_id !== 'all') params.activity_id = filters.activity_id;
      
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
                    {activities.map(activity => (
                      <SelectItem key={activity.id} value={activity.id}>
                        {language === 'ar' ? activity.name_ar : activity.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleFilter} data-testid="apply-filter-btn">
                <Calendar className="w-4 h-4 me-2" />
                {t('filter')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="stat-card" data-testid="total-revenue-card">
            <div className="stat-card-icon bg-primary/10">
              <TrendingUp className="w-6 h-6 text-primary" />
            </div>
            <div className="stat-card-value text-primary">
              {formatCurrency(report?.total_revenue)}
            </div>
            <div className="stat-card-label">{t('total_revenue')}</div>
          </Card>

          <Card className="stat-card" data-testid="invoice-count-card">
            <div className="stat-card-icon bg-blue-500/10">
              <Receipt className="w-6 h-6 text-blue-500" />
            </div>
            <div className="stat-card-value text-blue-500">
              {report?.invoice_count || 0}
            </div>
            <div className="stat-card-label">{t('invoices')}</div>
          </Card>

          <Card className="stat-card" data-testid="activities-count-card">
            <div className="stat-card-icon bg-green-500/10">
              <BarChart3 className="w-6 h-6 text-green-500" />
            </div>
            <div className="stat-card-value text-green-500">
              {report?.revenue_by_activity?.length || 0}
            </div>
            <div className="stat-card-label">{t('activities')}</div>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Revenue by Activity Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-primary" />
                {t('by_activity')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report?.revenue_by_activity?.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={report.revenue_by_activity} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={100} />
                    <Tooltip 
                      formatter={(value) => [`${value} ${t('sar')}`, t('total_revenue')]}
                    />
                    <Bar dataKey="total" fill="#F97316" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state">
                  <BarChart3 className="empty-state-icon" />
                  <p>{t('no_data')}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Revenue Distribution Pie Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                {language === 'ar' ? 'توزيع الإيرادات' : 'Revenue Distribution'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report?.revenue_by_activity?.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={report.revenue_by_activity}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="total"
                      nameKey="name"
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    >
                      {report.revenue_by_activity.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={activityColors[index % activityColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`${value} ${t('sar')}`, t('total_revenue')]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state">
                  <TrendingUp className="empty-state-icon" />
                  <p>{t('no_data')}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

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
                        <td className="font-bold text-primary">{invoice.total} {t('sar')}</td>
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
      </div>
    </Layout>
  );
};

export default ReportsPage;
