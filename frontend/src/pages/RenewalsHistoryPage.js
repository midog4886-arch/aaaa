import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { whatsappAPI, branchesAPI } from '../services/api';
import { toast } from 'sonner';
import {
  History,
  Search,
  Loader2,
  Download,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  RefreshCcw,
  Filter,
} from 'lucide-react';

const PAGE_SIZE = 100;

const RenewalsHistoryPage = () => {
  const { language } = useLanguage();
  const { token, isAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [memberFilter, setMemberFilter] = useState('');
  const [activityFilter, setActivityFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('all');
  const [manualFilter, setManualFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [branches, setBranches] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exporting, setExporting] = useState(false);

  const buildFilters = useCallback(() => {
    const filters = {};
    if (memberFilter) filters.member_id = memberFilter;
    if (activityFilter) filters.activity_name = activityFilter;
    if (channelFilter !== 'all') filters.channel = channelFilter;
    if (manualFilter === 'manual') filters.manual = 'true';
    if (manualFilter === 'auto') filters.manual = 'false';
    if (isAdmin && branchFilter && branchFilter !== 'all') filters.branch_id = branchFilter;
    if (startDate) filters.start_date = startDate;
    if (endDate) filters.end_date = endDate;
    return filters;
  }, [memberFilter, activityFilter, channelFilter, manualFilter, branchFilter, isAdmin, startDate, endDate]);

  const loadData = useCallback(async (newOffset = 0) => {
    setLoading(true);
    try {
      const filters = buildFilters();
      filters.limit = PAGE_SIZE;
      filters.offset = newOffset;
      const response = await whatsappAPI.getReminderHistory(filters);
      setRows(response.data.rows || []);
      setTotal(response.data.total || 0);
      setOffset(newOffset);
    } catch (error) {
      console.error('Failed to load reminder history:', error);
      toast.error(language === 'ar' ? 'فشل تحميل السجل' : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [buildFilters, language]);

  useEffect(() => {
    loadData(0);
    if (isAdmin) {
      branchesAPI.getAll()
        .then(r => setBranches(Array.isArray(r.data) ? r.data : (r.data?.branches || [])))
        .catch(() => setBranches([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApplyFilters = () => loadData(0);

  const handleResetFilters = () => {
    setMemberFilter('');
    setActivityFilter('');
    setChannelFilter('all');
    setManualFilter('all');
    setBranchFilter('all');
    setStartDate('');
    setEndDate('');
    setSearchTerm('');
    setTimeout(() => loadData(0), 0);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const url = whatsappAPI.reminderHistoryExportUrl(buildFilters());
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = `renewal_reminders_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success(language === 'ar' ? 'تم التصدير' : 'Exported');
    } catch (error) {
      console.error(error);
      toast.error(language === 'ar' ? 'فشل التصدير' : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const filteredRows = searchTerm
    ? rows.filter(r =>
        (r.member_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.activity_name || '').toLowerCase().includes(searchTerm.toLowerCase())
      )
    : rows;

  const formatTimestamp = (ts) => {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return ts;
      return d.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-GB', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return ts;
    }
  };

  const channelLabel = (ch) => {
    if (ch === 'whatsapp') return language === 'ar' ? 'واتساب' : 'WhatsApp';
    if (ch === 'push') return language === 'ar' ? 'إشعار' : 'Push';
    if (ch === 'portal') return language === 'ar' ? 'البوابة' : 'Portal';
    if (ch === 'intent') return language === 'ar' ? 'محاولة' : 'Intent';
    return ch || '—';
  };

  const senderLabel = (sentBy) => {
    if (!sentBy) return '—';
    if (sentBy.system) return language === 'ar' ? 'النظام (تلقائي)' : 'System (auto)';
    return sentBy.name || sentBy.username || '—';
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <Layout title={language === 'ar' ? 'سجل تذكيرات التجديد' : 'Renewal Reminders Log'}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Link to="/admin/renewals">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 me-1" />
              {language === 'ar' ? 'العودة للتجديدات' : 'Back to Renewals'}
            </Button>
          </Link>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <History className="w-4 h-4" />
            {language === 'ar'
              ? `إجمالي السجلات: ${total.toLocaleString('ar-SA')}`
              : `Total records: ${total.toLocaleString()}`}
          </div>
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Filter className="w-4 h-4" />
              {language === 'ar' ? 'تصفية' : 'Filters'}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Input
                placeholder={language === 'ar' ? 'رمز/معرّف العضو' : 'Member ID'}
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
              />
              <Input
                placeholder={language === 'ar' ? 'اسم النشاط' : 'Activity name'}
                value={activityFilter}
                onChange={(e) => setActivityFilter(e.target.value)}
              />
              <Select value={channelFilter} onValueChange={setChannelFilter}>
                <SelectTrigger>
                  <SelectValue placeholder={language === 'ar' ? 'القناة' : 'Channel'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'كل القنوات' : 'All channels'}</SelectItem>
                  <SelectItem value="whatsapp">{language === 'ar' ? 'واتساب' : 'WhatsApp'}</SelectItem>
                  <SelectItem value="push">{language === 'ar' ? 'إشعار' : 'Push'}</SelectItem>
                  <SelectItem value="portal">{language === 'ar' ? 'البوابة' : 'Portal'}</SelectItem>
                  <SelectItem value="intent">{language === 'ar' ? 'محاولة' : 'Intent'}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={manualFilter} onValueChange={setManualFilter}>
                <SelectTrigger>
                  <SelectValue placeholder={language === 'ar' ? 'النوع' : 'Type'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'الكل' : 'All'}</SelectItem>
                  <SelectItem value="manual">{language === 'ar' ? 'يدوي' : 'Manual'}</SelectItem>
                  <SelectItem value="auto">{language === 'ar' ? 'تلقائي' : 'Automatic'}</SelectItem>
                </SelectContent>
              </Select>
              {isAdmin && (
                <Select value={branchFilter} onValueChange={setBranchFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'ar' ? 'الفرع' : 'Branch'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{language === 'ar' ? 'كل الفروع' : 'All branches'}</SelectItem>
                    {branches.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {(language === 'ar' && (b.name_ar || b.nameAr)) || b.name || b.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex flex-col">
                <label className="text-xs text-muted-foreground mb-1">
                  {language === 'ar' ? 'من تاريخ' : 'From date'}
                </label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="flex flex-col">
                <label className="text-xs text-muted-foreground mb-1">
                  {language === 'ar' ? 'إلى تاريخ' : 'To date'}
                </label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div className="relative sm:col-span-2">
                <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-muted-foreground" />
                <Input
                  className="ps-10"
                  placeholder={language === 'ar' ? 'بحث في النتائج (اسم العضو/النشاط)' : 'Search in results (member/activity)'}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={handleResetFilters}>
                <RefreshCcw className="w-4 h-4 me-1" />
                {language === 'ar' ? 'إعادة ضبط' : 'Reset'}
              </Button>
              <Button size="sm" onClick={handleApplyFilters} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <Filter className="w-4 h-4 me-1" />}
                {language === 'ar' ? 'تطبيق' : 'Apply'}
              </Button>
              <Button size="sm" variant="secondary" onClick={handleExport} disabled={exporting || total === 0}>
                {exporting ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <Download className="w-4 h-4 me-1" />}
                {language === 'ar' ? 'تصدير Excel' : 'Export Excel'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-start">{language === 'ar' ? 'التاريخ والوقت' : 'Timestamp'}</th>
                    <th className="px-3 py-2 text-start">{language === 'ar' ? 'العضو' : 'Member'}</th>
                    <th className="px-3 py-2 text-start">{language === 'ar' ? 'النشاط' : 'Activity'}</th>
                    <th className="px-3 py-2 text-center">{language === 'ar' ? 'القناة' : 'Channel'}</th>
                    <th className="px-3 py-2 text-center">{language === 'ar' ? 'أيام قبل الانتهاء' : 'Days before'}</th>
                    <th className="px-3 py-2 text-center">{language === 'ar' ? 'النوع' : 'Type'}</th>
                    <th className="px-3 py-2 text-center">{language === 'ar' ? 'النتيجة' : 'Result'}</th>
                    <th className="px-3 py-2 text-start">{language === 'ar' ? 'أُرسل بواسطة' : 'Sent by'}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="text-center py-12">
                      <Loader2 className="w-5 h-5 animate-spin inline" />
                    </td></tr>
                  ) : filteredRows.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">
                      {language === 'ar' ? 'لا توجد سجلات تطابق التصفية.' : 'No records match the filters.'}
                    </td></tr>
                  ) : (
                    filteredRows.map((r, idx) => (
                      <tr key={idx} className="border-t hover:bg-muted/30">
                        <td className="px-3 py-2 whitespace-nowrap">{formatTimestamp(r.timestamp)}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{r.member_name || '—'}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{r.member_id}</div>
                        </td>
                        <td className="px-3 py-2">{r.activity_name || '—'}</td>
                        <td className="px-3 py-2 text-center">
                          <Badge variant="secondary">{channelLabel(r.channel)}</Badge>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {r.days_before !== null && r.days_before !== undefined ? r.days_before : '—'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Badge variant={r.manual ? 'default' : 'outline'}>
                            {r.manual
                              ? (language === 'ar' ? 'يدوي' : 'Manual')
                              : (language === 'ar' ? 'تلقائي' : 'Auto')}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {r.success ? (
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                              {language === 'ar' ? 'نجح' : 'Sent'}
                            </Badge>
                          ) : (
                            <Badge variant="destructive">
                              {language === 'ar' ? 'فشل' : 'Failed'}
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">{senderLabel(r.sent_by)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between p-3 border-t bg-muted/20">
                <div className="text-xs text-muted-foreground">
                  {language === 'ar'
                    ? `صفحة ${currentPage} من ${totalPages}`
                    : `Page ${currentPage} of ${totalPages}`}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset === 0 || loading}
                    onClick={() => loadData(Math.max(0, offset - PAGE_SIZE))}
                  >
                    <ChevronRight className="w-4 h-4 rtl:hidden" />
                    <ChevronLeft className="w-4 h-4 ltr:hidden" />
                    {language === 'ar' ? 'السابق' : 'Previous'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset + PAGE_SIZE >= total || loading}
                    onClick={() => loadData(offset + PAGE_SIZE)}
                  >
                    {language === 'ar' ? 'التالي' : 'Next'}
                    <ChevronLeft className="w-4 h-4 rtl:hidden" />
                    <ChevronRight className="w-4 h-4 ltr:hidden" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default RenewalsHistoryPage;
