import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
// eslint-disable-next-line react-hooks/exhaustive-deps
import { dashboardAPI, reportsAPI } from '../services/api';
import { 
  Users, 
  Activity, 
  Banknote, 
  AlertTriangle,
  TrendingUp,
  Calendar,
  Phone
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

export const DashboardPage = () => {
  const { t, language } = useLanguage();
  const [stats, setStats] = useState(null);
  const [expiring, setExpiring] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [statsRes, expiringRes] = await Promise.all([
        dashboardAPI.getStats(),
        reportsAPI.getExpiringSubscriptions(7)
      ]);
      setStats(statsRes.data);
      setExpiring(expiringRes.data);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    return `${amount?.toLocaleString() || 0} ${t('sar')}`;
  };

  const activityColors = {
    'السباحة': '#0EA5E9',
    'Swimming': '#0EA5E9',
    'كرة القدم': '#22C55E',
    'Football': '#22C55E',
    'الكاراتيه': '#EF4444',
    'Karate': '#EF4444',
    'الجمباز': '#8B5CF6',
    'Gymnastics': '#8B5CF6',
  };

  if (loading) {
    return (
      <Layout title={t('dashboard')}>
        <div className="flex items-center justify-center h-64">
          <div className="spinner" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('dashboard')}>
      <div className="space-y-6 animate-fade-in" data-testid="dashboard-page">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="stat-card hover-scale" data-testid="stat-members">
            <div className="stat-card-icon bg-primary/10">
              <Users className="w-6 h-6 text-primary" />
            </div>
            <div className="stat-card-value text-primary">
              {stats?.members_count || 0}
            </div>
            <div className="stat-card-label">{t('total_members')}</div>
          </Card>

          <Card className="stat-card hover-scale" data-testid="stat-subscriptions">
            <div className="stat-card-icon bg-green-500/10">
              <Activity className="w-6 h-6 text-green-500" />
            </div>
            <div className="stat-card-value text-green-500">
              {stats?.active_subscriptions || 0}
            </div>
            <div className="stat-card-label">{t('active_subscriptions')}</div>
          </Card>

          <Card className="stat-card hover-scale" data-testid="stat-revenue">
            <div className="stat-card-icon bg-blue-500/10">
              <Banknote className="w-6 h-6 text-blue-500" />
            </div>
            <div className="stat-card-value text-blue-500">
              {formatCurrency(stats?.month_revenue)}
            </div>
            <div className="stat-card-label">{t('monthly_revenue')}</div>
          </Card>

          <Card className="stat-card hover-scale" data-testid="stat-expiring">
            <div className="stat-card-icon bg-amber-500/10">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
            </div>
            <div className="stat-card-value text-amber-500">
              {stats?.expiring_count || 0}
            </div>
            <div className="stat-card-label">{t('expiring_soon')}</div>
          </Card>
        </div>

        {/* Charts and Lists */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Members by Activity Chart */}
          <Card data-testid="chart-activities">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                {t('members_by_activity')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats?.members_by_activity?.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={stats.members_by_activity}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={5}
                      dataKey="count"
                      nameKey="name"
                      label={({ name, count }) => `${name}: ${count}`}
                    >
                      {stats.members_by_activity.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={activityColors[entry.name] || '#64748b'} 
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state">
                  <Activity className="empty-state-icon" />
                  <p>{t('no_data')}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Expiring Subscriptions */}
          <Card data-testid="expiring-subscriptions">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                {t('expiring_subscriptions')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {expiring.length > 0 ? (
                <div className="space-y-3 max-h-[250px] overflow-y-auto">
                  {expiring.slice(0, 5).map((item, index) => (
                    <div 
                      key={index}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-lg animate-slide-in"
                      style={{ animationDelay: `${index * 0.05}s` }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{item.member_name}</p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>{item.activity_name}</span>
                          <span>•</span>
                          <div className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            <span dir="ltr">{item.phone}</span>
                          </div>
                        </div>
                      </div>
                      <Badge 
                        variant="outline" 
                        className={`${item.days_remaining <= 3 ? 'bg-red-500/10 text-red-500 border-red-500/30' : 'bg-amber-500/10 text-amber-500 border-amber-500/30'}`}
                      >
                        <Calendar className="w-3 h-3 me-1" />
                        {item.days_remaining} {t('days')}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <AlertTriangle className="empty-state-icon" />
                  <p>{t('no_data')}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="p-4 text-center">
            <div className="text-2xl font-bold text-primary">{stats?.activities_count || 0}</div>
            <div className="text-sm text-muted-foreground">{t('activities')}</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-2xl font-bold text-green-500">{stats?.coaches_count || 0}</div>
            <div className="text-sm text-muted-foreground">{t('coaches')}</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-2xl font-bold text-blue-500">4</div>
            <div className="text-sm text-muted-foreground">{t('activities')}</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-2xl font-bold text-purple-500">
              {formatCurrency(stats?.month_revenue || 0)}
            </div>
            <div className="text-sm text-muted-foreground">{t('monthly_revenue')}</div>
          </Card>
        </div>
      </div>
    </Layout>
  );
};

export default DashboardPage;
