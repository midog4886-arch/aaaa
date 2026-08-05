import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { branchesAPI, registrationRequestsAPI } from '../services/api';
import { getPublicBaseUrl } from '../utils/publicUrl';
import { whatsappChatUrl } from '../utils/whatsapp';
import { toast } from 'sonner';
import { Loader2, Phone, Calendar, Clock, Trash2, FileText, Link2, Copy, QrCode, Inbox, UserPlus, Globe, CheckCircle2, Megaphone, Download, Search, X, Archive, ArchiveRestore } from 'lucide-react';

const STATUS_FILTERS = [
  { value: 'pending', label: 'قيد الانتظار' },
  { value: 'processed', label: 'تمت المعالجة' },
  { value: 'all', label: 'الكل' },
  { value: 'archived', label: 'الأرشيف' },
];

const STATUS_BADGE = {
  pending: { label: 'قيد الانتظار', cls: 'bg-amber-100 text-amber-700' },
  processed: { label: 'تمت المعالجة', cls: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'مرفوض', cls: 'bg-red-100 text-red-700' },
  archived: { label: 'مؤرشف', cls: 'bg-gray-200 text-gray-600' },
};

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
  const [multiBranchIds, setMultiBranchIds] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');

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
      const params = { status: statusFilter };
      if (isAdmin && selectedBranch !== 'all') params.branch_filter = selectedBranch;
      const res = await registrationRequestsAPI.getAll(params);
      setRequests(res.data || []);
    } catch (e) {
      toast.error('تعذّر تحميل الطلبات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRequests(); /* eslint-disable-next-line */ }, [selectedBranch, statusFilter]);

  const branchName = (id) => {
    const b = branches.find(x => x.id === id);
    return b ? (b.name_ar || b.name) : '—';
  };

  // Client-side search over the loaded requests: name, phone (Arabic digits
  // normalized), marketer name and requested activity.
  const normalizeDigits = (s) => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const filteredRequests = useMemo(() => {
    const q = normalizeDigits(searchQuery.trim().toLowerCase());
    if (!q) return requests;
    return requests.filter(r => {
      const name = (r.customer_name || '').toLowerCase();
      const phone = normalizeDigits(r.customer_phone || '').replace(/\D/g, '');
      const marketer = (r.marketer_name || '').toLowerCase();
      const activity = (r.activity_name || '').toLowerCase();
      const qDigits = q.replace(/\D/g, '');
      return name.includes(q) || marketer.includes(q) || activity.includes(q) ||
        (qDigits.length >= 3 && phone.includes(qDigits));
    });
  }, [requests, searchQuery]);

  const registrationLink = useMemo(() => {
    if (!linkBranch) return '';
    return `${getPublicBaseUrl()}/register/${tenantSlug}/${linkBranch}`;
  }, [linkBranch, tenantSlug]);

  // Multi-branch link: the visitor sees ONLY the hand-picked subset of branches
  // in the picker (encoded as ?branches=id1,id2). Needs at least two branches to
  // make sense — one branch is just the per-branch link above.
  const multiLink = useMemo(() => {
    if (multiBranchIds.length < 2) return '';
    return `${getPublicBaseUrl()}/register/${tenantSlug}?branches=${multiBranchIds.join(',')}`;
  }, [multiBranchIds, tenantSlug]);

  const toggleMultiBranch = (id) => {
    setMultiBranchIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  // All-branches link tagged for social-media ads: the visitor picks the branch
  // and every request from it is tracked with source = "social_ad".
  const socialLink = useMemo(() => {
    return `${getPublicBaseUrl()}/join/${tenantSlug}`;
  }, [tenantSlug]);

  const copyText = async (text, emptyMsg) => {
    if (!text) { toast.error(emptyMsg || 'لا يوجد رابط'); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast.success('تم نسخ الرابط');
    } catch {
      toast.error('تعذّر النسخ');
    }
  };
  const copyLink = () => copyText(registrationLink, 'اختر الفرع أولاً');
  const copyMultiLink = () => copyText(multiLink, 'اختر فرعين على الأقل');
  const copySocialLink = () => copyText(socialLink);

  // Render the QR SVG onto a padded white canvas and download it as a PNG so it
  // can be dropped into printed flyers / social posts.
  const downloadQRCode = (containerId, filename) => {
    const svg = document.querySelector(`#${containerId} svg`);
    if (!svg) { toast.error('تعذّر تجهيز رمز QR'); return; }
    try {
      const xml = new XMLSerializer().serializeToString(svg);
      const svg64 = 'data:image/svg+xml;base64,' + window.btoa(unescape(encodeURIComponent(xml)));
      const img = new Image();
      const size = 140;
      const pad = 16;
      const scale = 4;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = (size + pad * 2) * scale;
        canvas.height = (size + pad * 2) * scale;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, pad * scale, pad * scale, size * scale, size * scale);
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast.success('تم تحميل رمز QR');
      };
      img.onerror = () => toast.error('تعذّر تحميل رمز QR');
      img.src = svg64;
    } catch {
      toast.error('تعذّر تحميل رمز QR');
    }
  };

  const storePrefill = (req) => {
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
  };

  const handleProcess = async (req) => {
    storePrefill(req);
    try {
      await registrationRequestsAPI.updateStatus(req.id, 'processed');
      if (statusFilter === 'pending') {
        setRequests(prev => prev.filter(r => r.id !== req.id));
      } else {
        setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'processed' } : r));
      }
    } catch {
      toast.error('تعذّر تحديث حالة الطلب');
    }
    navigate('/admin/invoices');
  };

  // Re-open the invoice dialog for an already-"processed" request. The status is set
  // optimistically when the button is first clicked, so a request can be marked
  // processed without an invoice ever being created — this lets staff complete it.
  const handleCreateInvoice = (req) => {
    storePrefill(req);
    navigate('/admin/invoices');
  };

  const handleArchive = async (req) => {
    try {
      await registrationRequestsAPI.updateStatus(req.id, 'archived');
      if (statusFilter !== 'archived') {
        setRequests(prev => prev.filter(r => r.id !== req.id));
      }
      toast.success('تم نقل الطلب إلى الأرشيف');
    } catch {
      toast.error('تعذّرت الأرشفة');
    }
  };

  const handleUnarchive = async (req) => {
    const restoreTo = req.archived_from && req.archived_from !== 'archived' ? req.archived_from : 'pending';
    try {
      await registrationRequestsAPI.updateStatus(req.id, restoreTo);
      setRequests(prev => prev.filter(r => r.id !== req.id));
      toast.success('تمت استعادة الطلب من الأرشيف');
    } catch {
      toast.error('تعذّرت الاستعادة');
    }
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
                  <div className="bg-white p-3 rounded-lg border shrink-0 mx-auto flex flex-col items-center">
                    <div id="qr-registration">
                      <QRCodeSVG value={registrationLink} size={140} level="M" includeMargin={false} />
                    </div>
                    <p className="text-[10px] text-center text-gray-400 mt-1 flex items-center justify-center gap-1"><QrCode className="w-3 h-3" /> امسح للتسجيل</p>
                    <Button size="sm" variant="outline" onClick={() => downloadQRCode('qr-registration', 'registration-qr.png')} className="gap-1.5 mt-2 w-full">
                      <Download className="w-3.5 h-3.5" /> تحميل الرمز
                    </Button>
                  </div>
                )}
              </div>

              <div className="mt-5 pt-4 border-t border-dashed border-gray-200">
                <div className="flex items-center gap-2 mb-1">
                  <Link2 className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-sm font-semibold text-emerald-700">رابط لعدة فروع</h3>
                </div>
                <p className="text-xs text-gray-500 mb-3">اختر مجموعة فروع، ويطلع رابط واحد يعرض للعميل الفروع المختارة فقط ليختار منها (لازم فرعين على الأقل).</p>
                <div className="flex flex-col sm:flex-row gap-4 items-start">
                  <div className="flex-1 w-full space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {branches.map(b => {
                        const on = multiBranchIds.includes(b.id);
                        return (
                          <button type="button" key={b.id} onClick={() => toggleMultiBranch(b.id)}
                            className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-300 hover:border-emerald-400'}`}
                            data-testid={`multi-branch-toggle-${b.id}`}>
                            {b.name_ar || b.name}
                          </button>
                        );
                      })}
                    </div>
                    {multiLink ? (
                      <div className="flex items-center gap-2">
                        <input readOnly value={multiLink}
                          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs bg-gray-50" dir="ltr"
                          data-testid="input-multi-link" />
                        <Button size="sm" onClick={copyMultiLink} className="gap-1.5 shrink-0" data-testid="button-copy-multi-link"><Copy className="w-3.5 h-3.5" /> نسخ</Button>
                      </div>
                    ) : (
                      multiBranchIds.length === 1 && (
                        <p className="text-xs text-amber-600">اختر فرعًا آخر على الأقل لإنشاء رابط متعدد الفروع.</p>
                      )
                    )}
                  </div>
                  {multiLink && (
                    <div className="bg-white p-3 rounded-lg border shrink-0 mx-auto flex flex-col items-center">
                      <div id="qr-multi">
                        <QRCodeSVG value={multiLink} size={140} level="M" includeMargin={false} />
                      </div>
                      <p className="text-[10px] text-center text-gray-400 mt-1 flex items-center justify-center gap-1"><QrCode className="w-3 h-3" /> امسح للتسجيل</p>
                      <Button size="sm" variant="outline" onClick={() => downloadQRCode('qr-multi', 'multi-branch-qr.png')} className="gap-1.5 mt-2 w-full">
                        <Download className="w-3.5 h-3.5" /> تحميل الرمز
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-dashed border-gray-200">
                <div className="flex items-center gap-2 mb-1">
                  <Megaphone className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-sm font-semibold text-indigo-700">رابط الإعلانات (سوشيال ميديا)</h3>
                </div>
                <p className="text-xs text-gray-500 mb-3">ضع هذا الرابط في إعلاناتك على السوشيال ميديا. يختار العميل الفرع بنفسه، وتظهر طلباته هنا بعلامة «إعلان سوشيال ميديا» لتعرف مصدرها.</p>
                <div className="flex flex-col sm:flex-row gap-4 items-start">
                  <div className="flex-1 w-full flex items-center gap-2">
                    <input readOnly value={socialLink}
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs bg-gray-50" dir="ltr"
                      data-testid="input-social-link" />
                    <Button size="sm" onClick={copySocialLink} className="gap-1.5 shrink-0 bg-indigo-600 hover:bg-indigo-700" data-testid="button-copy-social-link">
                      <Copy className="w-3.5 h-3.5" /> نسخ
                    </Button>
                  </div>
                  <div className="bg-white p-3 rounded-lg border shrink-0 mx-auto flex flex-col items-center">
                    <div id="qr-social">
                      <QRCodeSVG value={socialLink} size={140} level="M" includeMargin={false} />
                    </div>
                    <p className="text-[10px] text-center text-gray-400 mt-1 flex items-center justify-center gap-1"><QrCode className="w-3 h-3" /> امسح للتسجيل</p>
                    <Button size="sm" variant="outline" onClick={() => downloadQRCode('qr-social', 'social-qr.png')} className="gap-1.5 mt-2 w-full border-indigo-200 text-indigo-700 hover:bg-indigo-50">
                      <Download className="w-3.5 h-3.5" /> تحميل الرمز
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${statusFilter === f.value ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                data-testid={`req-status-filter-${f.value}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {isAdmin && branches.length > 1 && (
            <div className="max-w-xs">
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الفروع</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالاسم أو رقم الموبايل..."
              className="w-full rounded-lg border border-gray-200 bg-white pr-9 pl-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400"
              data-testid="input-search-requests"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                title="مسح البحث"
                data-testid="button-clear-search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-emerald-600" /></div>
        ) : filteredRequests.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Inbox className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm">{searchQuery.trim() ? 'لا توجد نتائج مطابقة للبحث' : statusFilter === 'processed' ? 'لا توجد طلبات تمت معالجتها' : statusFilter === 'archived' ? 'لا توجد طلبات مؤرشفة' : statusFilter === 'all' ? 'لا توجد طلبات تسجيل' : 'لا توجد طلبات تسجيل جديدة'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRequests.map(req => (
              <Card key={req.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-800">{req.customer_name}</h3>
                        {isAdmin && <span className="text-[11px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">{branchName(req.branch_id)}</span>}
                        {(() => { const b = STATUS_BADGE[req.status] || STATUS_BADGE.pending; return (
                          <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium ${b.cls}`}>{b.label}</span>
                        ); })()}
                        {req.source === 'social_ad' && (
                          <span className="text-[11px] rounded-full px-2 py-0.5 font-medium bg-indigo-100 text-indigo-700 inline-flex items-center gap-1" data-testid={`badge-source-${req.id}`}>
                            <Megaphone className="w-3 h-3" /> إعلان سوشيال ميديا
                          </span>
                        )}
                        {req.marketer_name && (
                          <span className="text-[11px] rounded-full px-2 py-0.5 font-medium bg-emerald-100 text-emerald-700 inline-flex items-center gap-1" data-testid={`badge-marketer-${req.id}`}>
                            🎯 مسوّق: {req.marketer_name}{req.marketer_discount_percent ? ` (خصم ${req.marketer_discount_percent}%)` : ''}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                        {req.customer_phone ? (
                          <a
                            href={whatsappChatUrl(req.customer_phone)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-green-600 hover:text-green-700 hover:underline"
                            dir="ltr"
                            title="فتح محادثة واتساب"
                            data-testid={`link-whatsapp-${req.id}`}
                          >
                            <Phone className="w-3.5 h-3.5" />{req.customer_phone}
                          </a>
                        ) : (
                          <span className="flex items-center gap-1" dir="ltr"><Phone className="w-3.5 h-3.5" />{req.customer_phone}</span>
                        )}
                        {req.nationality && <span className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" />{req.nationality}</span>}
                        {req.activity_name && <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5" />{req.activity_name}</span>}
                        {(req.preferred_days || []).length > 0 && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{(req.preferred_days || []).join('، ')}</span>}
                        {req.preferred_time && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{req.preferred_time}</span>}
                      </div>
                      {req.notes && <p className="mt-2 text-xs text-gray-500 bg-gray-50 rounded p-2">{req.notes}</p>}
                      <p className="mt-2 text-[11px] text-gray-400">{new Date(req.created_at).toLocaleString('ar-EG')}</p>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      {req.status === 'archived' ? (
                        <Button size="sm" variant="outline" onClick={() => handleUnarchive(req)} className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50" data-testid={`button-unarchive-${req.id}`}>
                          <ArchiveRestore className="w-3.5 h-3.5" /> استعادة من الأرشيف
                        </Button>
                      ) : req.status === 'processed' ? (
                        <>
                          <span className="inline-flex items-center gap-1.5 text-emerald-600 text-xs font-medium px-2 py-0.5">
                            <CheckCircle2 className="w-4 h-4" /> تمت المعالجة
                          </span>
                          <Button size="sm" variant="outline" onClick={() => handleCreateInvoice(req)} className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                            <UserPlus className="w-3.5 h-3.5" /> إنشاء فاتورة
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" onClick={() => handleProcess(req)} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                          <UserPlus className="w-3.5 h-3.5" /> معالجة وإنشاء فاتورة
                        </Button>
                      )}
                      {req.status !== 'archived' && (
                        <Button size="sm" variant="outline" onClick={() => handleArchive(req)} className="gap-1.5 text-gray-600 border-gray-300 hover:bg-gray-50" data-testid={`button-archive-${req.id}`}>
                          <Archive className="w-3.5 h-3.5" /> أرشفة
                        </Button>
                      )}
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
