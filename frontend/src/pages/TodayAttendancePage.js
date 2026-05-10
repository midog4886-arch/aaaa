import React, { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { attendanceAPI, branchesAPI } from '../services/api';
import { toast } from 'sonner';
import { CheckCheck, UserX, Users, Search, Phone, MessageCircle, Download, RefreshCcw, Clock } from 'lucide-react';

const TodayAttendancePage = () => {
  const { language } = useLanguage();
  const { selectedBranchId, user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activityFilter, setActivityFilter] = useState('');
  const [branches, setBranches] = useState([]);
  const [tab, setTab] = useState('present');

  const ar = language === 'ar';

  const load = async () => {
    setLoading(true);
    try {
      const params = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const res = await attendanceAPI.getTodaySummary(params);
      setData(res.data);
    } catch (e) {
      toast.error(ar ? 'تعذر تحميل البيانات' : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [selectedBranchId]);

  useEffect(() => {
    if (user?.is_admin) {
      branchesAPI.getAll().then(r => setBranches(r.data || [])).catch(() => {});
    }
  }, [user]);

  const branchName = (id) => branches.find(b => b.id === id)?.name_ar || branches.find(b => b.id === id)?.name || '-';

  const activityOptions = useMemo(() => {
    if (!data) return [];
    const set = new Set();
    (data.present || []).forEach(p => (p.activities || []).forEach(a => a.activity_name && set.add(a.activity_name)));
    (data.expected || []).forEach(e => (e.activities || []).forEach(a => a.activity_name && set.add(a.activity_name)));
    return Array.from(set);
  }, [data]);

  const filterText = (txt) => !search || (txt || '').toLowerCase().includes(search.toLowerCase());

  const presentList = useMemo(() => {
    if (!data) return [];
    return (data.present || []).filter(r =>
      (filterText(r.member_name) || filterText(r.member_code) || filterText(r.phone)) &&
      (!activityFilter || (r.activities || []).some(a => a.activity_name === activityFilter))
    );
  }, [data, search, activityFilter]);

  const absentList = useMemo(() => {
    if (!data) return [];
    return (data.absent || []).filter(r =>
      (filterText(r.member_name) || filterText(r.member_code) || filterText(r.phone)) &&
      (!activityFilter || (r.activities || []).some(a => a.activity_name === activityFilter))
    );
  }, [data, search, activityFilter]);

  const exportCSV = () => {
    const rows = tab === 'present'
      ? [['الكود','الاسم','الجوال','الأنشطة','وقت الدخول','الفرع','المسجل'],
         ...presentList.map(r => [r.member_code, r.member_name, r.phone, (r.activities||[]).map(a=>a.activity_name).join(' / '), (r.activities||[]).map(a=>a.check_in_time).join(' / '), branchName(r.branch_id), r.recorded_by])]
      : [['الكود','الاسم','الجوال','الأنشطة المتوقعة','الفرع'],
         ...absentList.map(r => [r.member_code, r.member_name, r.phone, (r.activities||[]).map(a=>a.activity_name).join(' / '), branchName(r.branch_id)])];
    const csv = '\ufeff' + rows.map(r => r.map(c => `"${(c ?? '').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tab === 'present' ? 'today_present' : 'today_absent'}_${data?.date || ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sendWhatsApp = (phone, name) => {
    const p = (phone || '').replace(/^0/, '966').replace(/\D/g, '');
    if (!p) return toast.error(ar ? 'لا يوجد رقم جوال' : 'No phone');
    const msg = ar
      ? `مرحباً ${name}،\nنلاحظ غيابك اليوم عن التدريب. نأمل عودتك قريباً.\nشركة اداء الابطال العالمية للرياضة`
      : `Hi ${name}, we noticed your absence today. Hope to see you soon.`;
    window.open(`https://wa.me/${p}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  if (loading) return (
    <Layout title={ar ? 'حضور اليوم' : "Today's Attendance"}>
      <div className="flex items-center justify-center h-64"><div className="spinner" /></div>
    </Layout>
  );

  const presentCount = data?.present_count || 0;
  const expectedCount = data?.expected_count || 0;
  const absentCount = data?.absent_count || 0;
  const ratio = expectedCount > 0 ? Math.round((presentCount / (expectedCount || 1)) * 100) : 0;

  return (
    <Layout title={ar ? 'حضور اليوم' : "Today's Attendance"}>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-xl font-bold">{ar ? `حضور اليوم — ${data?.day_name_ar || ''} ${data?.date || ''}` : `Today — ${data?.date}`}</h2>
            <p className="text-xs text-muted-foreground">{ar ? 'يعرض من تم تسجيل حضوره اليوم ومن لم يحضر من المتوقعين حسب الجدول' : 'Shows who attended today and who is expected based on schedule'}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load}><RefreshCcw className="w-4 h-4 ml-1" />{ar ? 'تحديث' : 'Refresh'}</Button>
            <Button variant="outline" size="sm" onClick={exportCSV}><Download className="w-4 h-4 ml-1" />{ar ? 'تصدير' : 'Export'}</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4">
            <div className="flex items-center justify-between"><CheckCheck className="w-6 h-6 text-green-600" /><div className="text-3xl font-bold text-green-600">{presentCount}</div></div>
            <div className="text-sm text-muted-foreground mt-1">{ar ? 'حاضر اليوم' : 'Present today'}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="flex items-center justify-between"><Users className="w-6 h-6 text-blue-600" /><div className="text-3xl font-bold text-blue-600">{expectedCount}</div></div>
            <div className="text-sm text-muted-foreground mt-1">{ar ? 'متوقع حضوره' : 'Expected'}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="flex items-center justify-between"><UserX className="w-6 h-6 text-amber-600" /><div className="text-3xl font-bold text-amber-600">{absentCount}</div></div>
            <div className="text-sm text-muted-foreground mt-1">{ar ? 'غائب اليوم' : 'Absent'}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="flex items-center justify-between"><Clock className="w-6 h-6 text-purple-600" /><div className="text-3xl font-bold text-purple-600">{ratio}%</div></div>
            <div className="text-sm text-muted-foreground mt-1">{ar ? 'نسبة الحضور' : 'Attendance rate'}</div>
          </CardContent></Card>
        </div>

        <Card><CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={ar ? 'بحث بالاسم أو الكود أو الجوال' : 'Search'} className="pr-9" />
          </div>
          <select value={activityFilter} onChange={e => setActivityFilter(e.target.value)} className="border rounded px-3 py-2 text-sm bg-white">
            <option value="">{ar ? 'كل الأنشطة' : 'All activities'}</option>
            {activityOptions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </CardContent></Card>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="present"><CheckCheck className="w-4 h-4 ml-1" />{ar ? `الحاضرون (${presentList.length})` : `Present (${presentList.length})`}</TabsTrigger>
            <TabsTrigger value="absent"><UserX className="w-4 h-4 ml-1" />{ar ? `الغائبون (${absentList.length})` : `Absent (${absentList.length})`}</TabsTrigger>
          </TabsList>

          <TabsContent value="present">
            <Card><CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-right p-3">{ar ? 'العضو' : 'Member'}</th>
                    <th className="text-right p-3">{ar ? 'الكود' : 'Code'}</th>
                    <th className="text-right p-3">{ar ? 'النشاط' : 'Activity'}</th>
                    <th className="text-right p-3">{ar ? 'وقت الدخول' : 'Check-in'}</th>
                    <th className="text-right p-3">{ar ? 'الفرع' : 'Branch'}</th>
                    <th className="text-right p-3">{ar ? 'المسجل' : 'Recorded by'}</th>
                  </tr>
                </thead>
                <tbody>
                  {presentList.length === 0 && (
                    <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">{ar ? 'لا يوجد حضور بعد' : 'No attendance yet'}</td></tr>
                  )}
                  {presentList.map(r => (
                    <tr key={r.member_id} className="border-t hover:bg-muted/30">
                      <td className="p-3 flex items-center gap-2">
                        {r.member_photo ? <img src={r.member_photo} alt="" className="w-8 h-8 rounded-full object-cover" /> : <div className="w-8 h-8 rounded-full bg-muted" />}
                        <div>
                          <div className="font-medium">
                            {r.member_name}
                            {r.guardian_name_ar && (
                              <span className="text-xs text-muted-foreground font-normal ms-2">
                                · {ar ? 'ولي الأمر:' : 'Guardian:'} {r.guardian_name_ar}
                              </span>
                            )}
                          </div>
                          {r.phone && <div className="text-xs text-muted-foreground">{r.phone}</div>}
                        </div>
                      </td>
                      <td className="p-3 font-mono text-xs">{r.member_code}</td>
                      <td className="p-3 text-xs">{(r.activities || []).map(a => a.activity_name).join(' / ')}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {(r.activities || []).map((a, i) => (
                            <Badge key={i} variant="outline" className="bg-green-50 text-green-700 text-xs">{a.check_in_time}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 text-xs">{branchName(r.branch_id)}</td>
                      <td className="p-3 text-xs text-muted-foreground">{r.recorded_by || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="absent">
            <Card><CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-right p-3">{ar ? 'العضو' : 'Member'}</th>
                    <th className="text-right p-3">{ar ? 'الكود' : 'Code'}</th>
                    <th className="text-right p-3">{ar ? 'الأنشطة المتوقعة' : 'Expected activities'}</th>
                    <th className="text-right p-3">{ar ? 'الفرع' : 'Branch'}</th>
                    <th className="text-right p-3">{ar ? 'إجراء' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody>
                  {absentList.length === 0 && (
                    <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">{ar ? 'لا يوجد غائبون 👍' : 'No absentees'}</td></tr>
                  )}
                  {absentList.map(r => (
                    <tr key={r.member_id} className="border-t hover:bg-muted/30">
                      <td className="p-3 flex items-center gap-2">
                        {r.member_photo ? <img src={r.member_photo} alt="" className="w-8 h-8 rounded-full object-cover" /> : <div className="w-8 h-8 rounded-full bg-muted" />}
                        <div>
                          <div className="font-medium">
                            {r.member_name}
                            {r.guardian_name_ar && (
                              <span className="text-xs text-muted-foreground font-normal ms-2">
                                · {ar ? 'ولي الأمر:' : 'Guardian:'} {r.guardian_name_ar}
                              </span>
                            )}
                          </div>
                          {r.phone && <div className="text-xs text-muted-foreground">{r.phone}</div>}
                        </div>
                      </td>
                      <td className="p-3 font-mono text-xs">{r.member_code}</td>
                      <td className="p-3 text-xs">{(r.activities || []).map(a => a.activity_name).join(' / ')}</td>
                      <td className="p-3 text-xs">{branchName(r.branch_id)}</td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          {r.phone && <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => sendWhatsApp(r.phone, r.member_name)}><MessageCircle className="w-3 h-3" /></Button>}
                          {r.phone && <a href={`tel:${r.phone}`}><Button size="sm" variant="outline" className="h-7 px-2"><Phone className="w-3 h-3" /></Button></a>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
};

export default TodayAttendancePage;
