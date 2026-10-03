import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { marketerReferralUrl, marketerPortalUrl } from '../utils/marketerLinks';
import { toast } from 'sonner';
import {
  Loader2, Plus, Pencil, Trash2, Copy, Link2, Megaphone, Phone, Percent,
  BadgeDollarSign, Wallet, Users, ChevronDown, ChevronUp, Receipt, ExternalLink,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'نقداً' },
  { value: 'transfer', label: 'تحويل بنكي' },
  { value: 'check', label: 'شيك' },
];

const emptyForm = { name: '', phone: '', referral_code: '', discount_percent: '', commission_percent: '', branch_ids: [], notes: '' };

const AnalyticsDashboard = ({ analytics, loading }) => {
  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  if (!analytics) return null;
  const s = analytics.summary || {};
  const monthly = analytics.monthly || [];
  const top = analytics.top_marketers || [];
  const cards = [
    { label: 'إجمالي المسوّقين', value: s.total_marketers || 0, icon: Megaphone, color: 'text-blue-500' },
    { label: 'المسوّقون النشطون', value: s.active_marketers || 0, icon: Users, color: 'text-emerald-500' },
    { label: 'إجمالي الإحالات', value: s.total_referrals || 0, icon: Users, color: 'text-indigo-500' },
    { label: 'إجمالي العمولات (ر.س)', value: (s.total_commission || 0).toFixed(2), icon: BadgeDollarSign, color: 'text-slate-500' },
    { label: 'عمولات مستحقة (ر.س)', value: (s.total_due || 0).toFixed(2), icon: Wallet, color: 'text-amber-500' },
    { label: 'عمولات مدفوعة (ر.س)', value: (s.total_paid || 0).toFixed(2), icon: BadgeDollarSign, color: 'text-emerald-600' },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map((c, i) => (
          <Card key={i}><CardContent className="p-4 flex items-center gap-3">
            <c.icon className={`w-7 h-7 ${c.color}`} />
            <div><p className="text-xl font-bold">{c.value}</p><p className="text-xs text-muted-foreground">{c.label}</p></div>
          </CardContent></Card>
        ))}
      </div>

      <Card><CardContent className="p-4">
        <h3 className="font-bold mb-3 text-sm">الإحالات والعمولات — آخر 6 أشهر</h3>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={monthly} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="referrals" name="الإحالات" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="right" dataKey="commission" name="العمولات (ر.س)" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-4">
        <h3 className="font-bold mb-3 text-sm">أفضل المسوّقين</h3>
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">لا توجد بيانات بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-muted-foreground border-b">
                <th className="text-start py-2 font-medium">#</th>
                <th className="text-start py-2 font-medium">المسوّق</th>
                <th className="text-start py-2 font-medium">الإحالات</th>
                <th className="text-start py-2 font-medium">إجمالي العمولات</th>
                <th className="text-start py-2 font-medium">مستحق</th>
                <th className="text-start py-2 font-medium">مدفوع</th>
              </tr></thead>
              <tbody>
                {top.map((m, i) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="py-2">{i + 1}</td>
                    <td className="py-2 font-medium">{m.name} <span className="font-mono text-xs text-muted-foreground">{m.referral_code}</span></td>
                    <td className="py-2">{m.referrals}</td>
                    <td className="py-2 font-semibold">{(m.total_commission || 0).toFixed(2)}</td>
                    <td className="py-2 text-amber-600">{(m.due_amount || 0).toFixed(2)}</td>
                    <td className="py-2 text-emerald-600">{(m.paid_amount || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent></Card>
    </div>
  );
};

export const MarketersPage = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isAdmin = user?.is_admin;
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedMarketerId = searchParams.get('marketer');
  const openMarketer = (id) => {
    setExpandedId(null);
    setSearchParams(id ? { marketer: id } : {});
  };

  const tenantSlug = (() => { try { return localStorage.getItem('tenant_slug') || 'default'; } catch { return 'default'; } })();

  const [loading, setLoading] = useState(true);
  const [marketers, setMarketers] = useState([]);
  const [branches, setBranches] = useState([]);

  // Tabs: list (manage marketers) | analytics (admin dashboard)
  const [activeTab, setActiveTab] = useState('list');
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // Per-marketer expanded commission report
  const [expandedId, setExpandedId] = useState(null);
  const [commissions, setCommissions] = useState([]);
  const [loadingCommissions, setLoadingCommissions] = useState(false);
  const [linkBranchByMarketer, setLinkBranchByMarketer] = useState({});
  const [filterMarketer, setFilterMarketer] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterPeriod, setFilterPeriod] = useState('month');
  const [funnel, setFunnel] = useState(null);
  const [funnelLoading, setFunnelLoading] = useState(false);

  // Payout dialog
  const [payoutMarketer, setPayoutMarketer] = useState(null);
  const [payoutForm, setPayoutForm] = useState({ payment_method: 'cash', payment_date: '', reference: '', notes: '' });
  const [payingOut, setPayingOut] = useState(false);
  const [payoutCommissions, setPayoutCommissions] = useState([]);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutError, setPayoutError] = useState('');
  const payoutSequence = useRef(0);

  const loadData = async () => {
    setLoading(true);
    setAnalytics(null);
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

  useEffect(() => {
    if (activeTab !== 'list') return;
    let active = true;
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
    const params = {
      ...(filterBranch !== 'all' ? { branch_filter: filterBranch } : {}),
      ...(filterPeriod === 'month' ? { start_date: monthStart, end_date: monthEnd } : {}),
    };
    setFunnelLoading(true);
    marketersAPI.funnel(params).then(res => {
      if (active) setFunnel(res.data?.by_marketer || {});
    }).catch(() => {
      if (active) { setFunnel(null); toast.error('تعذّر تحميل مراحل الإحالة'); }
    }).finally(() => { if (active) setFunnelLoading(false); });
    return () => { active = false; };
  }, [activeTab, filterBranch, filterPeriod]);

  useEffect(() => {
    if (activeTab !== 'analytics' || analytics) return;
    setAnalyticsLoading(true);
    marketersAPI.analytics()
      .then((res) => setAnalytics(res.data))
      .catch(() => toast.error('تعذّر تحميل التحليلات'))
      .finally(() => setAnalyticsLoading(false));
  }, [activeTab, analytics]);

  const branchName = (id) => {
    if (!id) return 'كل الفروع';
    const b = branches.find(x => x.id === id);
    return b ? (b.name_ar || b.name) : '—';
  };

  // A marketer's branch list: prefer the new branch_ids[], fall back to legacy branch_id.
  const marketerBranchIds = (m) => (m.branch_ids && m.branch_ids.length) ? m.branch_ids : (m.branch_id ? [m.branch_id] : []);
  const branchNames = (m) => {
    const ids = marketerBranchIds(m);
    if (!ids.length) return 'كل الفروع';
    return ids.map(branchName).join('، ');
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
      branch_ids: marketerBranchIds(m),
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
    if (isAdmin) payload.branch_ids = form.branch_ids || [];
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
    const bids = marketerBranchIds(m);
    let branchForLink;
    if (bids.length === 1) branchForLink = bids[0];
    else if (bids.length > 1) branchForLink = linkBranchByMarketer[m.id] || 'all';
    else branchForLink = linkBranchByMarketer[m.id] || (branches.length === 1 ? branches[0].id : '');
    if (!branchForLink) return '';
    // "all" → the public all-branches link where the visitor picks their own branch.
    return marketerReferralUrl({ baseUrl: getPublicBaseUrl(), tenantSlug, referralCode: m.referral_code, branchId: branchForLink });
  };

  const copyText = async (text, okMsg) => {
    if (!text) { toast.error('اختر الفرع أولاً'); return; }
    try { await navigator.clipboard.writeText(text); toast.success(okMsg); }
    catch { toast.error('تعذّر النسخ'); }
  };

  const portalLink = (m) => marketerPortalUrl({ baseUrl: getPublicBaseUrl(), tenantSlug, token: m.portal_token });

  const copyPortalLink = async (m) => {
    let link = portalLink(m);
    if (!link) {
      try {
        const res = await marketersAPI.portalToken(m.id);
        link = marketerPortalUrl({ baseUrl: getPublicBaseUrl(), tenantSlug, token: res.data.portal_token });
        setMarketers(prev => prev.map(x => x.id === m.id ? { ...x, portal_token: res.data.portal_token } : x));
      } catch { toast.error('تعذّر إنشاء رابط البوابة'); return; }
    }
    copyText(link, 'تم نسخ رابط البوابة الخاص بالمسوّق');
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

  const openPayout = async (m) => {
    if ((m.due_amount || 0) <= 0) { toast.error('لا توجد عمولات مستحقة للصرف'); return; }
    const sequence = ++payoutSequence.current;
    setPayoutMarketer(m);
    setPayoutCommissions([]);
    setPayoutError('');
    setPayoutLoading(true);
    setPayoutForm({ payment_method: 'cash', payment_date: new Date().toISOString().split('T')[0], reference: '', notes: '' });
    try {
      const res = await marketersAPI.commissions(m.id);
      if (sequence === payoutSequence.current) setPayoutCommissions((res.data || []).filter(c => c.status === 'due'));
    } catch {
      if (sequence === payoutSequence.current) setPayoutError('تعذّر تحميل كشف العمولات. حاول مرة أخرى قبل الصرف.');
    } finally {
      if (sequence === payoutSequence.current) setPayoutLoading(false);
    }
  };

  const handlePayout = async () => {
    if (!payoutMarketer || payoutLoading || payoutError || !payoutCommissions.length) return;
    setPayingOut(true);
    try {
      const res = await marketersAPI.payout(payoutMarketer.id, {
        ...payoutForm,
        commission_ids: payoutCommissions.map(c => c.id),
        expected_total: Math.round(payoutCommissions.reduce((sum, c) => sum + Number(c.commission_amount || 0), 0) * 100) / 100,
      });
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

  const visibleMarketers = useMemo(() => marketers.filter(m => {
    if (filterMarketer !== 'all' && m.id !== filterMarketer) return false;
    if (filterBranch !== 'all' && marketerBranchIds(m).length && !marketerBranchIds(m).includes(filterBranch)) return false;
    return true;
  }), [marketers, filterMarketer, filterBranch]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => visibleMarketers.reduce((acc, m) => {
    acc.due += m.due_amount || 0;
    acc.paid += m.paid_amount || 0;
    acc.requests += funnel?.[m.id]?.registration_requests || 0;
    return acc;
  }, { due: 0, paid: 0, requests: 0 }), [visibleMarketers, funnel]);
  const funnelValue = (m, key, money = false) => {
    if (funnelLoading) return '…';
    if (!funnel) return '—';
    const value = funnel[m.id]?.[key] || 0;
    return money ? Number(value).toFixed(2) : value;
  };
  const payoutPreviewTotal = payoutCommissions.reduce((sum, c) => sum + Number(c.commission_amount || 0), 0);

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
          {activeTab === 'list' && (
            <Button onClick={openCreate} data-testid="button-add-marketer">
              <Plus className="w-4 h-4 ms-1" /> إضافة مسوّق
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('list')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${activeTab === 'list' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
            data-testid="tab-marketers-list"
          >المسوّقون</button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${activeTab === 'analytics' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
            data-testid="tab-marketers-analytics"
          >لوحة التحليلات</button>
        </div>

        {activeTab === 'analytics' && (
          <AnalyticsDashboard analytics={analytics} loading={analyticsLoading} />
        )}

        {activeTab === 'list' && (<>
        {selectedMarketerId && <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => openMarketer(null)}>العودة إلى جميع المسوّقين</Button>
          <Button variant="outline" onClick={() => copyText(window.location.href, 'تم نسخ رابط صفحة المسوّق')}><Link2 className="w-3.5 h-3.5 ms-1" /> نسخ رابط الصفحة</Button>
        </div>}
        {!selectedMarketerId && <div className="flex flex-wrap items-end gap-3">
          <div><Label className="text-xs">المسوّق</Label><Select value={filterMarketer} onValueChange={setFilterMarketer}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل المسوّقين</SelectItem>{marketers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">الفرع</Label><Select value={filterBranch} onValueChange={setFilterBranch}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الفروع</SelectItem>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">فترة الإحالات</Label><Select value={filterPeriod} onValueChange={setFilterPeriod}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="month">الشهر الحالي</SelectItem><SelectItem value="all">كل الفترات</SelectItem></SelectContent></Select></div>
        </div>}
        {/* Summary cards */}
        {!selectedMarketerId && <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card><CardContent className="p-4 flex items-center gap-3">
            <Users className="w-8 h-8 text-blue-500" />
            <div><p className="text-2xl font-bold">{funnelLoading ? '…' : funnel ? totals.requests : '—'}</p><p className="text-xs text-muted-foreground">طلبات إحالة في الفترة</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <Wallet className="w-8 h-8 text-amber-500" />
            <div><p className="text-2xl font-bold">{totals.due.toFixed(2)}</p><p className="text-xs text-muted-foreground">عمولات مستحقة — كل الفترات (ر.س)</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <BadgeDollarSign className="w-8 h-8 text-emerald-500" />
            <div><p className="text-2xl font-bold">{totals.paid.toFixed(2)}</p><p className="text-xs text-muted-foreground">عمولات مصروفة — كل الفترات (ر.س)</p></div>
          </CardContent></Card>
        </div>}

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : (selectedMarketerId ? !visibleMarketers.some(m => m.id === selectedMarketerId) : visibleMarketers.length === 0) ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground">
            <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>{selectedMarketerId ? 'المسوّق غير موجود أو غير متاح لك.' : marketers.length ? 'لا يوجد مسوّقون يطابقون الفلاتر.' : 'لا يوجد مسوّقون بعد. أضف مسوّقاً للبدء.'}</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">فتح الرابط يُحتسب من تاريخ تفعيل التتبع فقط. عند اختيار فرع محدد، يبقى عدد فتحات الرابط لجميع فروع المسوّق لأن الزائر قد يختار الفرع لاحقًا.</p>
            {visibleMarketers.filter(m => !selectedMarketerId || m.id === selectedMarketerId).map((m) => (
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
                        {!selectedMarketerId && <Button variant="outline" size="sm" onClick={() => openMarketer(m.id)}>فتح صفحة المسوّق <ExternalLink className="w-3.5 h-3.5 ms-1" /></Button>}
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                        {m.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {m.phone}</span>}
                        <span className="flex items-center gap-1"><Percent className="w-3.5 h-3.5" /> خصم {m.discount_percent}%</span>
                        <span className="flex items-center gap-1"><BadgeDollarSign className="w-3.5 h-3.5" /> عمولة {m.commission_percent}%</span>
                        <span>الفروع: {branchNames(m)}</span>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
                        <span className="text-blue-600">طلبات إحالة: {funnelValue(m, 'registration_requests')}</span>
                        <span className="text-amber-600">مستحق: {(m.due_amount || 0).toFixed(2)} ر.س</span>
                        <span className="text-emerald-600">مدفوع: {(m.paid_amount || 0).toFixed(2)} ر.س</span>
                      </div>
                      {selectedMarketerId && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-sm">
                        <div className="rounded-lg bg-muted/50 p-2"><span className="block text-xs text-muted-foreground">فتحوا رابط الإحالة</span><strong>{funnelValue(m, 'link_visits')}</strong></div>
                        <div className="rounded-lg bg-muted/50 p-2"><span className="block text-xs text-muted-foreground">قدّموا طلب تسجيل</span><strong>{funnelValue(m, 'registration_requests')}</strong></div>
                        <div className="rounded-lg bg-muted/50 p-2"><span className="block text-xs text-muted-foreground">فواتير أولى مرتبطة</span><strong>{funnelValue(m, 'linked_invoices')}</strong></div>
                        <div className="rounded-lg bg-muted/50 p-2"><span className="block text-xs text-muted-foreground">عمولة مسجّلة للفترة</span><strong>{funnelValue(m, 'recorded_commission', true)} ر.س</strong></div>
                      </div>}

                      {/* Referral link */}
                      {selectedMarketerId && <div className="mt-3 flex items-center gap-2 flex-wrap">
                        {(() => {
                          const bids = marketerBranchIds(m);
                          if (bids.length === 1 || branches.length <= 1) return null;
                          const opts = bids.length > 1 ? branches.filter(b => bids.includes(b.id)) : branches;
                          const defaultVal = bids.length > 1 ? 'all' : '';
                          return (
                            <Select value={linkBranchByMarketer[m.id] || defaultVal} onValueChange={(v) => setLinkBranchByMarketer(prev => ({ ...prev, [m.id]: v }))}>
                              <SelectTrigger className="h-8 w-52 text-xs"><SelectValue placeholder="اختر فرع للرابط" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">{bids.length > 1 ? 'كل فروع المسوّق (العميل يختار)' : 'كل الفروع'}</SelectItem>
                                {opts.map(b => <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          );
                        })()}
                        <Button variant="outline" size="sm" onClick={() => copyText(m.referral_code, 'تم نسخ كود الإحالة')}>
                          <Copy className="w-3.5 h-3.5 ms-1" /> نسخ الكود
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => copyText(referralLink(m), 'تم نسخ رابط الإحالة')}>
                          <Link2 className="w-3.5 h-3.5 ms-1" /> نسخ رابط التسجيل
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => copyPortalLink(m)} data-testid={`button-portal-${m.id}`}>
                          <ExternalLink className="w-3.5 h-3.5 ms-1" /> رابط البوابة
                        </Button>
                      </div>}
                    </div>

                    {/* Actions */}
                    {selectedMarketerId && <div className="flex items-center gap-2 flex-wrap">
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
                    </div>}
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
        </>)}
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
                <Label>الفروع</Label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, branch_ids: [] })}
                    data-testid="chip-branch-all"
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${(!form.branch_ids || form.branch_ids.length === 0) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'}`}
                  >
                    كل الفروع (مشترك)
                  </button>
                  {branches.map(b => {
                    const active = (form.branch_ids || []).includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setForm(prev => {
                          const cur = prev.branch_ids || [];
                          const next = cur.includes(b.id) ? cur.filter(x => x !== b.id) : [...cur, b.id];
                          return { ...prev, branch_ids: next };
                        })}
                        data-testid={`chip-branch-${b.id}`}
                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'}`}
                      >
                        {b.name_ar || b.name}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">اختر فرعاً أو أكثر، أو «كل الفروع» ليكون المسوّق مشتركاً في جميع الفروع</p>
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
      <Dialog open={!!payoutMarketer} onOpenChange={(o) => { if (!o) { ++payoutSequence.current; setPayoutMarketer(null); } }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>صرف عمولة — {payoutMarketer?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-center">
              <p className="text-sm text-amber-800">المبلغ المستحق للصرف</p>
              <p className="text-2xl font-bold text-amber-700">{payoutLoading ? '…' : payoutPreviewTotal.toFixed(2)} ر.س</p>
            </div>
            {payoutLoading ? <p className="text-sm text-muted-foreground">جارٍ تحميل كشف العمولات…</p> : payoutError ? <p className="text-sm text-red-600" role="alert">{payoutError}</p> : payoutCommissions.length ? (
              <div className="overflow-x-auto max-h-52 overflow-y-auto">
                <table className="w-full text-sm"><thead><tr className="border-b"><th className="text-start py-2">العضو</th><th className="text-start py-2">الفاتورة</th><th className="text-start py-2">الأساس</th><th className="text-start py-2">العمولة</th></tr></thead><tbody>
                  {payoutCommissions.map(c => <tr key={c.id} className="border-b"><td className="py-2">{c.member_name || '—'}</td><td className="py-2">{c.invoice_number || '—'}</td><td className="py-2">{Number(c.base_amount || 0).toFixed(2)}</td><td className="py-2 font-medium">{Number(c.commission_amount || 0).toFixed(2)}</td></tr>)}
                </tbody></table>
              </div>
            ) : <p className="text-sm text-muted-foreground">لا توجد عمولات مستحقة الآن.</p>}
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
            <p className="text-xs text-muted-foreground">سيتم إنشاء سند صرف للعمولات المعروضة أعلاه فقط. إذا تغيّر الكشف قبل التأكيد سيُطلب منك مراجعته مجددًا.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { ++payoutSequence.current; setPayoutMarketer(null); }}>إلغاء</Button>
            <Button onClick={handlePayout} disabled={payingOut || payoutLoading || !!payoutError || !payoutCommissions.length} data-testid="button-confirm-payout">
              {payingOut && <Loader2 className="w-4 h-4 ms-1 animate-spin" />} تأكيد الصرف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

export default MarketersPage;
