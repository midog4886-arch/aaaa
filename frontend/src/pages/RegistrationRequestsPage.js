import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { branchesAPI, registrationRequestsAPI } from '../services/api';
import { toast } from 'sonner';
import { Loader2, Phone, Calendar, Clock, Trash2, FileText, Link2, Copy, QrCode, Inbox, UserPlus } from 'lucide-react';

export const RegistrationRequestsPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.is_admin;

  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLink, setShowLink] = useState(false);
  const [linkBranch, setLinkBranch] = useState('');

  const tenantSlug = (() => { try { return localStorage.getItem('tenant_slug') || 'default'; } catch { return 'default'; } })();

  useEffect(() => {
    branchesAPI.getAll().then(res => {
      setBranches(res.data || []);
      if (res.data && res.data.length === 1) setLinkBranch(res.data[0].id);
    }).catch(() => {});
  }, []);

  const loadRequests = async () => {
    setLoading(true);
    try {
      const params = { status: 'pending' };
      if (isAdmin && selectedBranch !== 'all') params.branch_filter = selectedBranch;
      const res = await registrationRequestsAPI.getAll(params);
      setRequests(res.data || []);
    } catch (e) {
      toast.error('تعذّر تحميل الطلبات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRequests(); /* eslint-disable-next-line */ }, [selectedBranch]);

  const branchName = (id) => {
    const b = branches.find(x => x.id === id);
    return b ? (b.name_ar || b.name) : '—';
  };

  const registrationLink = useMemo(() => {
    if (!linkBranch) return '';
    return `${window.location.origin}/register/${tenantSlug}/${linkBranch}`;
  }, [linkBranch, tenantSlug]);

  const copyLink = async () => {
    if (!registrationLink) { toast.error('اختر الفرع أولاً'); return; }
    try {
      await navigator.clipboard.writeText(registrationLink);
      toast.success('تم نسخ الرابط');
    } catch {
      toast.error('تعذّر النسخ');
    }
  };

  const handleProcess = async (req) => {
    const daysTxt = (req.preferred_days || []).join('، ');
    const noteLines = [];
    if (req.activity_name) noteLines.push(`النشاط المطلوب: ${req.activity_name}`);
    if (daysTxt) noteLines.push(`الأيام المفضّلة: ${daysTxt}`);
    if (req.preferred_time) noteLines.push(`الموعد المفضّل: ${req.preferred_time}`);
    if (req.notes) noteLines.push(`ملاحظات ولي الأمر: ${req.notes}`);
    if (req.marketer_name) noteLines.push(`إحالة من مسوّق: ${req.marketer_name}${req.marketer_discount_percent ? ` (خصم ${req.marketer_discount_percent}%)` : ''}`);
    const prefill = {
      request_id: req.id,
      customer_name: req.customer_name,
      customer_phone: req.customer_phone,
      nationality: req.nationality || '',
      branch_id: req.branch_id,
      notes: noteLines.join('\n'),
      marketer_id: req.marketer_id || '',
      marketer_name: req.marketer_name || '',
      marketer_discount_percent: req.marketer_discount_percent || 0,
    };
    try { sessionStorage.setItem('prefill_registration', JSON.stringify(prefill)); } catch {}
    try {
      await registrationRequestsAPI.updateStatus(req.id, 'processed');
      setRequests(prev => prev.filter(r => r.id !== req.id));
    } catch {
      toast.error('تعذّر تحديث حالة الطلب');
    }
    navigate('/admin/invoices');
  };

  const handleDelete = async (req) => {
    if (!window.confirm(`حذف طلب "${req.customer_name}"؟`)) return;
    try {
      await registrationRequestsAPI.delete(req.id);
      setRequests(prev => prev.filter(r => r.id !== req.id));
      toast.success('تم حذف الطلب');
    } catch {
      toast.error('تعذّر الحذف');
    }
  };

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-5xl mx-auto" dir="rtl">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <div className="flex items-center gap-2">
            <Inbox className="w-6 h-6 text-emerald-600" />
            <h1 className="text-xl font-bold">طلبات التسجيل الجديدة</h1>
            {requests.length > 0 && (
              <span className="bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full px-2 py-0.5">{requests.length}</span>
            )}
          </div>
          <Button variant="outline" onClick={() => setShowLink(v => !v)} className="gap-1.5">
            <Link2 className="w-4 h-4" /> رابط التسجيل العام
          </Button>
        </div>

        {showLink && (
          <Card className="mb-5 border-emerald-200">
            <CardContent className="p-4">
              <p className="text-sm text-gray-600 mb-3">شارك هذا الرابط (أو الـ QR) مع أولياء الأمور ليسجّلوا بياناتهم بأنفسهم، وتظهر طلباتهم هنا للمراجعة.</p>
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <div className="flex-1 w-full space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">اختر الفرع</label>
                    <Select value={linkBranch} onValueChange={setLinkBranch}>
                      <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                      <SelectContent>
                        {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {registrationLink && (
                    <div className="flex items-center gap-2">
                      <input readOnly value={registrationLink}
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs bg-gray-50" dir="ltr" />
                      <Button size="sm" onClick={copyLink} className="gap-1.5 shrink-0"><Copy className="w-3.5 h-3.5" /> نسخ</Button>
                    </div>
                  )}
                </div>
                {registrationLink && (
                  <div className="bg-white p-3 rounded-lg border shrink-0 mx-auto">
                    <QRCodeSVG value={registrationLink} size={140} level="M" includeMargin={false} />
                    <p className="text-[10px] text-center text-gray-400 mt-1 flex items-center justify-center gap-1"><QrCode className="w-3 h-3" /> امسح للتسجيل</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {isAdmin && branches.length > 1 && (
          <div className="mb-4 max-w-xs">
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الفروع</SelectItem>
                {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-emerald-600" /></div>
        ) : requests.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Inbox className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm">لا توجد طلبات تسجيل جديدة</p>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map(req => (
              <Card key={req.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-800">{req.customer_name}</h3>
                        {isAdmin && <span className="text-[11px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">{branchName(req.branch_id)}</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                        <span className="flex items-center gap-1" dir="ltr"><Phone className="w-3.5 h-3.5" />{req.customer_phone}</span>
                        {req.activity_name && <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5" />{req.activity_name}</span>}
                        {(req.preferred_days || []).length > 0 && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{(req.preferred_days || []).join('، ')}</span>}
                        {req.preferred_time && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{req.preferred_time}</span>}
                      </div>
                      {req.notes && <p className="mt-2 text-xs text-gray-500 bg-gray-50 rounded p-2">{req.notes}</p>}
                      <p className="mt-2 text-[11px] text-gray-400">{new Date(req.created_at).toLocaleString('ar-EG')}</p>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <Button size="sm" onClick={() => handleProcess(req)} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                        <UserPlus className="w-3.5 h-3.5" /> معالجة وإنشاء فاتورة
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleDelete(req)} className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50">
                        <Trash2 className="w-3.5 h-3.5" /> حذف
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default RegistrationRequestsPage;
