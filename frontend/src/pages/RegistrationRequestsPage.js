import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import RegistrationPaymentLink from '../components/RegistrationPaymentLink';
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
import RegistrationFollowup from '../components/RegistrationFollowup';
import RegistrationManagement from '../components/RegistrationManagement';
import { Loader2, Phone, Calendar, Clock, Trash2, FileText, Link2, Copy, QrCode, Inbox, UserPlus, Globe, CheckCircle2, Megaphone, Download, Search, X, Archive, ArchiveRestore, ExternalLink } from 'lucide-react';

const STATUS_FILTERS = [
  { value: 'pending', label: 'قيد الانتظار' },
  { value: 'followed_up', label: 'تمت المتابعة' },
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
const STAGES = { new: 'جديد', contacted: 'تم التواصل', awaiting_payment: 'بانتظار الدفع', registered: 'مسجل' };

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
  const [shortLink, setShortLink] = useState(null);
  const [linkError, setLinkError] = useState(false);
  const [multiBranchIds, setMultiBranchIds] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [overview, setOverview] = useState({});
  const [assignees, setAssignees] = useState([]);
  const [activityFilter, setActivityFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [sortOrder, setSortOrder] = useState('priority');
  const [groupFamilies, setGroupFamilies] = useState(true);
  const loadSequence = useRef(0);
  const [paymentLinks, setPaymentLinks] = useState([]);
  const [paymentLinksLoaded, setPaymentLinksLoaded] = useState(false);
  const [gatewayReady, setGatewayReady] = useState(false);
  const canManagePayments = Boolean(isAdmin || (user?.permissions || []).includes('invoices'));
  const paymentSequence = useRef(0);
  const loadPaymentLinks = async () => {
    const sequence = ++paymentSequence.current;
    if (!canManagePayments) return;
    try {
      const { data } = await axios.get('/api/payment-links', { params: selectedBranch !== 'all' ? { branch_filter: selectedBranch } : {}, timeout: 15000 });
      if (sequence !== paymentSequence.current) return;
      setPaymentLinks(data.links || []); setGatewayReady(Boolean(data.gateway_ready)); setPaymentLinksLoaded(true);
    } catch { if (sequence === paymentSequence.current) { setPaymentLinksLoaded(false); toast.error('تعذّر تحديث حالات روابط الدفع'); } }
  };
  useEffect(() => { setPaymentLinks([]); setPaymentLinksLoaded(false); loadPaymentLinks(); /* eslint-disable-next-line */ }, [selectedBranch, canManagePayments]);

  const tenantSlug = (() => { try { return localStorage.getItem('tenant_slug') || 'default'; } catch { return 'default'; } })();

  useEffect(() => {
    branchesAPI.getAll().then(res => {
      setBranches(res.data || []);
      if (res.data && res.data.length === 1) setLinkBranch(res.data[0].id);
    }).catch(() => {});
  }, []);

  const loadRequests = async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const params = { status: statusFilter };
      if (isAdmin && selectedBranch !== 'all') params.branch_filter = selectedBranch;
      if (searchQuery.trim()) params.search = searchQuery.trim();
      const res = await registrationRequestsAPI.getAll(params);
      if (sequence !== loadSequence.current) return;
      setRequests(res.data || []);
      const scope = isAdmin && selectedBranch !== 'all' ? { branch_filter: selectedBranch } : {};
      if (registrationRequestsAPI.overview) registrationRequestsAPI.overview(scope).then(r => { if (sequence === loadSequence.current) setOverview(r.data || {}); }).catch(() => toast.error('تعذّر تحديث الملخص'));
      if (registrationRequestsAPI.assignees) registrationRequestsAPI.assignees(scope).then(r => { if (sequence === loadSequence.current) setAssignees(r.data || []); }).catch(() => toast.error('تعذّر تحميل الموظفين'));
    } catch (e) {
      toast.error('تعذّر تحميل الطلبات');
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  };

  useEffect(() => { loadRequests(); /* eslint-disable-next-line */ }, [selectedBranch, statusFilter, searchQuery]);

  const branchName = (id) => {
    const b = branches.find(x => x.id === id);
    return b ? (b.name_ar || b.name) : '—';
  };

  const canViewPhones = Boolean(
    isAdmin || (user?.permissions || []).includes('member-phones')
  );
  const canViewMembers = Boolean(
    isAdmin || (user?.permissions || []).includes('members')
  );

  const formatFollowupTimestamp = (value) => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ar-EG');
  };

  // Client-side search over the loaded requests: name, phone (Arabic digits
  // normalized), marketer name and requested activity.
  const normalizeDigits = (s) => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const filteredRequests = useMemo(() => {
    const q = normalizeDigits(searchQuery.trim().toLowerCase());
    return requests.filter(r => {
      if (activityFilter && r.activity_name !== activityFilter) return false;
      if (ownerFilter && (ownerFilter === 'none' ? Boolean(r.assignee_id) : r.assignee_id !== ownerFilter)) return false;
      if (stageFilter && r.workflow_stage !== stageFilter) return false;
      const day = String(r.created_at || '').slice(0, 10);
      if ((dateFrom && day < dateFrom) || (dateTo && day > dateTo)) return false;
      if (!q) return true;
      const name = (r.customer_name || '').toLowerCase();
      const phone = normalizeDigits(r.customer_phone || '').replace(/\D/g, '');
      const marketer = (r.marketer_name || '').toLowerCase();
      const activity = (r.activity_name || '').toLowerCase();
      const reference = (r.id || '').slice(0, 8).toLowerCase();
      const qDigits = q.replace(/\D/g, '');
      return name.includes(q) || marketer.includes(q) || activity.includes(q) || reference.includes(q.replace(/^#/, '')) ||
        (qDigits.length >= 3 && phone.includes(qDigits));
    }).sort((a, b) => (sortOrder === 'priority' ? Number(Boolean(b.followup_overdue)) - Number(Boolean(a.followup_overdue)) : 0) || (sortOrder === 'oldest' || sortOrder === 'priority' ? new Date(a.created_at) - new Date(b.created_at) : new Date(b.created_at) - new Date(a.created_at)));
  }, [requests, searchQuery, activityFilter, ownerFilter, dateFrom, dateTo, stageFilter, sortOrder]);
  const familyGroups = useMemo(() => {
    const groups = new Map();
    filteredRequests.forEach(r => { const key = groupFamilies ? r.family_key || r.id : r.id; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
    return Array.from(groups.entries());
  }, [filteredRequests, groupFamilies]);

  const registrationLink = useMemo(() => {
    if (!linkBranch || shortLink?.branchId !== linkBranch || shortLink?.tenant !== tenantSlug) return '';
    const path = tenantSlug === 'default' ? '' : `${encodeURIComponent(tenantSlug)}/`;
    return `${getPublicBaseUrl()}/r/${path}${shortLink.slug}?preview=20260929`;
  }, [linkBranch, tenantSlug, shortLink]);

  useEffect(() => {
    if (!showLink || !linkBranch) return undefined;
    let active = true;
    setShortLink(null);
    setLinkError(false);
    registrationRequestsAPI.createLink(linkBranch).then(({ data }) => {
      if (active) setShortLink({ branchId: linkBranch, tenant: tenantSlug, slug: data.slug });
    }).catch(() => { if (active) setLinkError(true); });
    return () => { active = false; };
  }, [showLink, linkBranch, tenantSlug]);

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
    if (req.expected_start_date) noteLines.push(`تاريخ البداية المتوقع: ${req.expected_start_date}`);
    if (req.notes) noteLines.push(`ملاحظات ولي الأمر: ${req.notes}`);
    if (req.marketer_name) noteLines.push(`إحالة من مسوّق: ${req.marketer_name}${req.marketer_discount_percent ? ` (خصم ${req.marketer_discount_percent}%)` : ''}`);
    const prefill = {
      request_id: req.id,
      customer_name: req.customer_name,
      customer_phone: req.customer_phone,
      nationality: req.nationality || '',
      age: req.age || '',
      expected_start_date: req.expected_start_date || '',
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
    // Prefilling is navigation only.  The invoice endpoint receives
    // request_id and performs the authoritative conversion after it has
    // successfully inserted the linked invoice.  Keeping this request in
    // Pending also makes cancel/failure paths safe.
    navigate('/admin/invoices');
  };

  // Historical processed rows without a real linked invoice are normalized by
  // the server back to Pending, so they use the same action as new requests.
  const handleCreateInvoice = (req) => {
    handleProcess(req);
  };

  const handleArchive = async (req) => {
    const reason = window.prompt('سبب إيقاف الطلب أو أرشفته (مطلوب):');
    if (!reason?.trim()) return;
    try {
      await registrationRequestsAPI.updateStatus(req.id, 'archived', reason.trim());
      if (statusFilter !== 'archived') {
        setRequests(prev => prev.filter(r => r.id !== req.id));
      }
      toast.success('تم نقل الطلب إلى الأرشيف');
      await loadRequests();
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
      await loadRequests();
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
      await loadRequests();
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

        <div className="mb-5 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 text-xs leading-6 text-gray-700">
          <strong>متابعة هادئة للطلبات الجديدة فقط:</strong> رسالة بعد 24 ساعة وأخرى أخيرة بعد 3 أيام،
          بين 10 صباحاً و8 مساءً بتوقيت السعودية. تتوقف عند الرد أو المعالجة أو الأرشفة.
          عند التواصل من خارج النظام، اضغط «تم التواصل» لإيقاف المتابعة. فتح رابط واتساب وحده لا يُعدّ تأكيداً للتواصل.
          <p className="mt-1">كل طلب مستقل حتى عند مشاركة رقم الجوال. إنشاء فاتورة مرتبطة بالطلب يُنهي هذا الطلب فقط، مع بقاء حدود التواصل مشتركة للرقم لتجنب تكرار الرسائل.</p>
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
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-emerald-800"><Globe className="w-4 h-4" /><span>موقع الأكاديمية الرسمي</span><span dir="ltr">adaa-alabtal.com</span></div>
                      <a href={registrationLink} target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 rounded-lg bg-white border border-emerald-300 px-4 py-3 font-semibold text-gray-900 hover:bg-emerald-50"><ExternalLink className="w-4 h-4 shrink-0" />التسجيل في {branchName(linkBranch)}</a>
                      {getPublicBaseUrl().startsWith('http://127.0.0.1') && <p className="text-xs text-amber-800">هذه معاينة على جهازك؛ الرابط المنسوخ ورمز QR للتجربة المحلية فقط.</p>}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={copyLink} className="gap-1.5"><Copy className="w-3.5 h-3.5" /> نسخ الرابط</Button>
                        <a href={`https://wa.me/?text=${encodeURIComponent(`سجّل في ${branchName(linkBranch)} عبر الرابط:\n${registrationLink}`)}`}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 gap-1.5"><Phone className="w-3.5 h-3.5" /> مشاركة واتساب</a>
                      </div>
                    </div>
                  )}
                  {linkBranch && !registrationLink && <p role="status" className="text-sm text-gray-500">{linkError ? 'تعذّر تجهيز الرابط. أعد اختيار الفرع للمحاولة.' : 'جارٍ تجهيز رابط الفرع…'}</p>}
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

        <div className="mb-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          {Object.entries({ new: 'طلبات جديدة', overdue: 'متابعة متأخرة', contacted: 'تم التواصل', awaiting_payment: 'بانتظار الدفع', registered: 'تحولت إلى اشتراك' }).map(([key, title]) => <div key={key} className="rounded-xl border bg-white p-3"><p className="text-xs text-gray-500">{title}</p><strong className="text-2xl text-emerald-700">{overview[key] ?? '—'}</strong></div>)}
        </div>
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

        <div className="mb-4 flex flex-wrap gap-3 text-sm">
          <select aria-label="النشاط" value={activityFilter} onChange={e => setActivityFilter(e.target.value)} className="rounded border p-2"><option value="">كل الأنشطة</option>{Array.from(new Set(requests.map(r => r.activity_name).filter(Boolean))).map(a => <option key={a}>{a}</option>)}</select>
          <select aria-label="فلتر المسؤول" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} className="rounded border p-2"><option value="">كل الموظفين</option><option value="none">دون مسؤول</option>{assignees.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <select aria-label="مرحلة التسجيل" value={stageFilter} onChange={e => { setStageFilter(e.target.value); if (e.target.value) setStatusFilter('all'); }} className="rounded border p-2"><option value="">كل مراحل التسجيل</option>{Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <label>من <input aria-label="من تاريخ" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="rounded border p-2" /></label>
          <label>إلى <input aria-label="إلى تاريخ" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="rounded border p-2" /></label>
          <select aria-label="ترتيب الطلبات" value={sortOrder} onChange={e => setSortOrder(e.target.value)} className="rounded border p-2"><option value="priority">المتأخرة أولًا</option><option value="oldest">الأقدم أولًا</option><option value="newest">الأحدث أولًا</option></select>
          <label className="p-2"><input type="checkbox" checked={groupFamilies} onChange={e => setGroupFamilies(e.target.checked)} /> جمع طلبات الأسرة</label>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-emerald-600" /></div>
        ) : filteredRequests.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Inbox className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm">{searchQuery.trim() ? 'لا توجد نتائج مطابقة للبحث' : statusFilter === 'followed_up' ? 'لا توجد طلبات تمت متابعتها' : statusFilter === 'processed' ? 'لا توجد طلبات تمت معالجتها' : statusFilter === 'archived' ? 'لا توجد طلبات مؤرشفة' : statusFilter === 'all' ? 'لا توجد طلبات تسجيل' : 'لا توجد طلبات تسجيل جديدة'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {familyGroups.map(([familyKey, family]) => <section key={familyKey} className={family.length > 1 ? 'rounded-xl border-2 border-sky-100 bg-sky-50/30 p-3 space-y-3' : 'space-y-3'}>
              {family.length > 1 && <p className="font-semibold text-sky-800">طلبات أسرة واحدة · {family.length} طلبات · {branchName(family[0].branch_id)} <span className="text-xs font-normal">كل طفل له تسجيل مستقل</span></p>}
              {family.map(req => (
              <Card key={req.id} className={`overflow-hidden ${req.followup_overdue ? 'border-red-200' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-800">{req.customer_name}</h3>
                        {req.workflow_stage && <span className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-800">{STAGES[req.workflow_stage]}</span>}
                        <span className="text-xs text-gray-500">المسؤول: {req.assignee_name || 'لم يُعيّن'}</span>
                        {req.followup_overdue && <span className="text-xs font-semibold text-red-600">متابعة متأخرة{req.next_followup_at ? ` · ${Math.max(1, Math.floor((Date.now() - new Date(req.next_followup_at).getTime()) / 86400000))} يوم` : ''}</span>}
                        {isAdmin && <span className="text-[11px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">{branchName(req.branch_id)}</span>}
                        {(() => { const b = STATUS_BADGE[req.status] || STATUS_BADGE.pending; return (
                          <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium ${b.cls}`}>{b.label}</span>
                        ); })()}
                        {req.status === 'archived' && req.archived_reason === 'member_phone_match_same_branch' && (
                          <span className="text-[11px] rounded-full px-2 py-0.5 bg-amber-50 text-amber-800">
                            أرشفة سابقة بسبب تطابق الرقم — الطلبات الآن مستقلة ويمكن استعادتها
                          </span>
                        )}
                        {req.status === 'archived' && req.archived_reason && req.archived_reason !== 'member_phone_match_same_branch' && <span className="text-xs text-gray-500">سبب الإيقاف: {req.archived_reason}</span>}
                        {req.followup_staff_contacted && (
                          <span
                            className="text-[11px] rounded-full px-2 py-0.5 font-medium bg-sky-100 text-sky-700 inline-flex items-center gap-1"
                            data-testid={`badge-followup-staff-${req.id}`}
                          >
                            <Phone className="w-3 h-3" /> تم التواصل يدوياً
                            {formatFollowupTimestamp(req.followup_staff_contacted_at) && ` — ${formatFollowupTimestamp(req.followup_staff_contacted_at)}`}
                          </span>
                        )}
                        {req.followup_automatic_sent && (
                          <span
                            className="text-[11px] rounded-full px-2 py-0.5 font-medium bg-violet-100 text-violet-700 inline-flex items-center gap-1"
                            data-testid={`badge-followup-automatic-${req.id}`}
                          >
                            <CheckCircle2 className="w-3 h-3" /> متابعة آلية أُرسلت
                            {formatFollowupTimestamp(req.followup_automatic_sent_at) && ` — ${formatFollowupTimestamp(req.followup_automatic_sent_at)}`}
                          </span>
                        )}
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
                        {req.customer_phone && canViewPhones && !req.customer_phone_masked ? (
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
                        {req.activity_name && <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5" />{req.activity_name}</span>}
                      </div>
                      {canViewMembers && (req.matching_members || []).length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid={`matching-members-${req.id}`}>
                          <span className="text-xs text-gray-500">العضو الموجود:</span>
                          {req.matching_members.map(member => (
                            <Button
                              key={member.id}
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 border-amber-300 text-amber-800 hover:bg-amber-50"
                              onClick={() => navigate(`/admin/members?focus=${encodeURIComponent(member.id)}`)}
                              data-testid={`open-matching-member-${member.id}`}
                            >
                              {member.name || member.code || 'عضو'}
                              {member.code && member.name ? ` (${member.code})` : ''}
                              <ExternalLink className="w-3 h-3" />
                            </Button>
                          ))}
                        </div>
                      )}
                      <details className="mt-3 rounded border p-3"><summary className="cursor-pointer text-sm text-emerald-700">عرض التفاصيل</summary>
                        <p className="mt-2 text-xs">رقم الطلب: {(req.id || '').slice(0, 8).toUpperCase()}</p>
                        {req.expected_start_date && <p className="mt-2 text-xs">البداية المتوقعة: {req.expected_start_date}</p>}
                        {(req.preferred_days || []).length > 0 && <p className="mt-2 text-xs">الأيام المفضلة: {(req.preferred_days || []).join('، ')}</p>}
                        {req.preferred_time && <p className="mt-2 text-xs">الوقت المفضل: {req.preferred_time}</p>}
                        <p className="mt-2 text-xs">{req.nationality} · العمر: {req.age || '—'} سنة</p>
                        {req.notes && <p className="mt-2 text-xs text-gray-500 bg-gray-50 rounded p-2">{req.notes}</p>}
                        <RegistrationManagement key={`${req.id}:${req.assignee_id || ''}`} request={req} assignees={assignees} onChanged={loadRequests} />
                      </details>
                      <p className="mt-2 text-[11px] text-gray-400">{new Date(req.created_at).toLocaleString('ar-EG')}</p>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      {req.status === 'archived' ? (
                        <Button size="sm" variant="outline" onClick={() => handleUnarchive(req)} className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50" data-testid={`button-unarchive-${req.id}`}>
                          <ArchiveRestore className="w-3.5 h-3.5" /> استعادة من الأرشيف
                        </Button>
                      ) : req.status === 'processed' && req.invoice_id ? (
                        <>
                          <span className="inline-flex items-center gap-1.5 text-emerald-600 text-xs font-medium px-2 py-0.5">
                            <CheckCircle2 className="w-4 h-4" /> {req.workflow_stage === 'registered' ? 'اكتمل التسجيل والدفع' : 'الفاتورة بانتظار الدفع'}
                          </span>
                          <Button size="sm" variant="outline" onClick={() => navigate('/admin/invoices')}>فتح الفواتير</Button>
                          {canManagePayments && <RegistrationPaymentLink request={req} links={paymentLinks} loaded={paymentLinksLoaded} gatewayReady={gatewayReady} onChanged={async () => { await loadPaymentLinks(); await loadRequests(); }} />}
                        </>
                      ) : (
                        <Button size="sm" onClick={() => handleCreateInvoice(req)} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                          <UserPlus className="w-3.5 h-3.5" /> معالجة وإنشاء فاتورة
                        </Button>
                      )}
                      {req.status !== 'archived' && (
                        <Button size="sm" variant="outline" onClick={() => handleArchive(req)} className="gap-1.5 text-gray-600 border-gray-300 hover:bg-gray-50" data-testid={`button-archive-${req.id}`}>
                          <Archive className="w-3.5 h-3.5" /> أرشفة
                        </Button>
                      )}
                      <details><summary className="cursor-pointer text-xs text-gray-500">إجراءات إضافية</summary><Button size="sm" variant="outline" onClick={() => handleDelete(req)} className="mt-2 gap-1.5 text-red-600 border-red-200 hover:bg-red-50">
                        <Trash2 className="w-3.5 h-3.5" /> حذف
                      </Button></details>
                    </div>
                  </div>
                  <RegistrationFollowup request={req} onChanged={loadRequests} />
                </CardContent>
              </Card>
            ))}</section>)}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default RegistrationRequestsPage;
