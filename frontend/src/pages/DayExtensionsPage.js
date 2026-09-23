import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import api, { membersAPI, branchesAPI, activitiesAPI, whatsappAPI } from '../services/api';
import { whatsappChatUrl } from '../utils/whatsapp';
import { toast } from 'sonner';
import {
  CalendarOff, Plus, Trash2, Play, Clock, User, Users,
  CalendarDays, CheckCircle, History, Loader2, MessageCircle, Send,
  ChevronDown, ChevronUp, Phone, AlertTriangle
} from 'lucide-react';

const REASON_LABELS = {
  ar: { holiday: 'إجازة رسمية', maintenance: 'صيانة', emergency: 'طارئ', other: 'أخرى' },
  en: { holiday: 'Official Holiday', maintenance: 'Maintenance', emergency: 'Emergency', other: 'Other' }
};

const REASON_COLORS = {
  holiday: 'bg-blue-100 text-blue-800',
  maintenance: 'bg-orange-100 text-orange-800',
  emergency: 'bg-red-100 text-red-800',
  other: 'bg-gray-100 text-gray-800'
};

// The WhatsApp helper owns country-code normalization. Keep the additional
// validation here so masked, incomplete, or malformed values can never become
// a manual-chat link (especially for users without the phone permission).
const getManualWhatsAppUrl = (phone, canViewPhones, message) => {
  if (!canViewPhones || !phone || /[•*xX]/.test(String(phone))) return '';
  if (typeof whatsappChatUrl !== 'function') return '';
  const rawPhone = String(phone).trim();
  const rawDigits = rawPhone.replace(/\D/g, '');
  const explicitInternational = rawPhone.startsWith('+') || rawDigits.startsWith('00');
  const url = whatsappChatUrl(phone, message);
  if (typeof url !== 'string') return '';
  const match = url.match(/^https:\/\/wa\.me\/(\d+)(?:\?|$)/);
  if (!match || match[1].length < 10 || match[1].length > 15) return '';
  // Stored academy phones are Saudi local numbers (or already normalized);
  // other country codes are accepted only when explicitly marked international.
  if (!explicitInternational && !/^9665\d{8}$/.test(match[1])) return '';
  return url;
};

// Keep browser-opened notices in lockstep with the automatic closure queue's
// personalization. The queue appends this English evidence section too.
const personalizeClosureMessage = (template, member) => {
  const changes = member?.activity_changes?.length
    ? member.activity_changes.map(change => ({
        activity: change.activity_name,
        missed_sessions: change.missed_sessions,
        old_end: change.old_end_date,
        new_end: change.new_end_date
      }))
    : (member?.details || []);
  const detail = (changes[0] || {});
  const values = {
    name: member?.name || '',
    days: detail.missed_sessions || '',
    new_end: detail.new_end || '',
    old_end: detail.old_end || '',
    activity: detail.activity || ''
  };
  let message = template || '';
  Object.entries(values).forEach(([key, value]) => {
    message = message.split(`{${key}}`).join(String(value));
  });
  if (!message.includes('— English —')) {
    const lines = [
      '— English —',
      'Subscription extension notice',
      `Member: ${values.name}`
    ];
    changes.forEach(item => {
      lines.push(
        `Activity: ${item.activity || '—'}`,
        `Sessions to compensate: ${item.missed_sessions || 0}`,
        `Previous end date: ${item.old_end || '—'}`,
        `New end date: ${item.new_end || '—'}`
      );
    });
    message += `\n\n${lines.join('\n')}`;
  }
  return message;
};

export default function DayExtensionsPage() {
  const { language } = useLanguage();
  const {
    selectedBranchId: globalBranchId,
    isAdmin,
    user
  } = useAuth();
  const canViewPhones = isAdmin || user?.is_admin === true || (user?.permissions || []).includes('member-phones');
  const t = (ar, en) => language === 'ar' ? ar : en;

  const [closures, setClosures] = useState([]);
  const [logs, setLogs] = useState([]);
  const [members, setMembers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('closures');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showManualDialog, setShowManualDialog] = useState(false);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);

  const defaultClosure = {
    title_ar: '', title_en: '', reason: 'holiday', start_date: '', end_date: '', notes: '',
    scope: 'all', activity_ids: [], activity_names: [], stop_type: 'full_day', stop_hours: 0, affected_times: [],
    branch_id: 'all'
  };
  const [newClosure, setNewClosure] = useState({ ...defaultClosure });
  const [manualExt, setManualExt] = useState({ member_id: '', days: 1, reason: '', activity_id: '' });
  const [applyBranch, setApplyBranch] = useState(globalBranchId || 'all');

  useEffect(() => {
    if (globalBranchId) setApplyBranch(globalBranchId);
  }, [globalBranchId]);
  const [showResultDialog, setShowResultDialog] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [availableTimes, setAvailableTimes] = useState([]);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [previewClosure, setPreviewClosure] = useState(null);
  const [expandedClosures, setExpandedClosures] = useState({});
  const [memberSearch, setMemberSearch] = useState({});
  const [previewResult, setPreviewResult] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [waMessage, setWaMessage] = useState('');
  const [whatsappMode, setWhatsappMode] = useState('automatic');
  const [sendingWa, setSendingWa] = useState(false);
  const sendInFlight = useRef(false);
  const manualOpened = useRef(new Set());
  const [, redrawManual] = useState(0);
  // Same selected tenant as services/api.js X-Tenant-Slug (set by LoginPage),
  // not an optional user property that could collapse tenants into one key.
  const manualKey = (member) => `closure-wa-open:${localStorage.getItem('tenant_slug') || 'default'}:${previewClosure?.id}:${member.member_id}`;
  const wasOpened = (member) => {
    const key = manualKey(member);
    try { return manualOpened.current.has(key) || localStorage.getItem(key) === 'opened'; }
    catch { return manualOpened.current.has(key); }
  };
  const [waJobs, setWaJobs] = useState([]);
  const [waJobsPollVersion, setWaJobsPollVersion] = useState(0);
  const [excludedMemberIds, setExcludedMemberIds] = useState([]);
  const previewRequest = useRef(0);
  const [previewSelection, setPreviewSelection] = useState(null);
  const selectionKey = (closure, branch, exclusions) => JSON.stringify([
    closure?.id, closure?.start_date, closure?.end_date, branch, [...exclusions].sort()
  ]);
  const previewMatchesSelection = previewSelection === selectionKey(previewClosure, applyBranch, excludedMemberIds);
  const [showSkippedList, setShowSkippedList] = useState(false);
  const [previewIsStale, setPreviewIsStale] = useState(false);
  const [previewConflictMessage, setPreviewConflictMessage] = useState('');
  const [noticeReady, setNoticeReady] = useState(false);
  const noticeRequest = useRef(0);
  const refreshNoticeSummaries = useCallback(async () => {
    const request = ++noticeRequest.current;
    try {
      const response = await api.dayExtensions.getClosures({ summary_only: true });
      if (request !== noticeRequest.current) return;
      const rows = response.data || [];
      setClosures(current => current.map(closure => ({
        ...closure,
        notice_summary: rows.find(row => row.id === closure.id)?.notice_summary
      })));
      setWaJobs(rows.flatMap(c => c.notice_summary?.jobs || []));
      setNoticeReady(rows.every(c => c.notice_summary && c.notice_summary.state !== 'loading'));
    } catch (error) {
      if (request !== noticeRequest.current) return;
      setNoticeReady(false);
      toast.error(t('تعذر تحديث حالة الرسائل', 'Could not refresh message status'));
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setNoticeReady(false);
      const [closuresRes, branchesRes] = await Promise.all([
        api.dayExtensions.getClosures({ include_notice_summary: false }),
        branchesAPI.getAll()
      ]);
      setClosures(Array.isArray(closuresRes.data) ? closuresRes.data : []);
      setWaJobs((closuresRes.data || []).flatMap(c => c.notice_summary?.jobs || []));
      setBranches(Array.isArray(branchesRes.data) ? branchesRes.data : []);
      refreshNoticeSummaries();
    } catch (error) {
      console.error('DayExtensions loadData error:', error);
      toast.error(t('خطأ في تحميل البيانات', 'Error loading data'));
    } finally {
      setLoading(false);
    }
  }, [refreshNoticeSummaries]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => () => { noticeRequest.current += 1; }, []);

  useEffect(() => {
    let cancelled = false;
    const requests = [];
    const load = (request, setter) => requests.push(request.then(response => {
      if (!cancelled) setter(Array.isArray(response.data) ? response.data : []);
    }));
    if (activeTab === 'logs') load(api.dayExtensions.getLogs(), setLogs);
    if (showManualDialog) load(membersAPI.getAll({ exclude_photo: true, picker_only: true }), setMembers);
    if (showCreateDialog || showManualDialog) load(activitiesAPI.getAll(), setActivities);
    if (showCreateDialog) load(api.dayExtensions.getAvailableTimes(), setAvailableTimes);
    Promise.all(requests).catch(() => {
      if (!cancelled) toast.error(t('خطأ في تحميل البيانات', 'Error loading data'));
    });
    return () => { cancelled = true; };
  }, [activeTab, showCreateDialog, showManualDialog]);

  const handleCreateClosure = async () => {
    if (!newClosure.title_ar || !newClosure.start_date || !newClosure.end_date) {
      toast.error(t('أكمل جميع الحقول المطلوبة', 'Fill all required fields'));
      return;
    }
    if (newClosure.scope === 'specific' && (!newClosure.activity_ids || newClosure.activity_ids.length === 0)) {
      toast.error(t('اختر نشاط واحد على الأقل', 'Select at least one activity'));
      return;
    }
    if (newClosure.stop_type === 'specific_times' && (!newClosure.affected_times || newClosure.affected_times.length === 0)) {
      toast.error(t('اختر موعد واحد على الأقل', 'Select at least one time'));
      return;
    }
    setSaving(true);
    try {
      await api.dayExtensions.createClosure(newClosure);
      toast.success(t('تم إضافة فترة الإغلاق', 'Closure period added'));
      setShowCreateDialog(false);
      setNewClosure({ ...defaultClosure });
      loadData();
    } catch (error) {
      toast.error(t('خطأ في الإضافة', 'Error adding'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClosure = async (id) => {
    if (!window.confirm(t('هل تريد حذف فترة الإغلاق؟', 'Delete this closure?'))) return;
    try {
      await api.dayExtensions.deleteClosure(id);
      toast.success(t('تم الحذف', 'Deleted'));
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.detail || t('خطأ في الحذف', 'Error deleting'));
    }
  };

  const buildDefaultMessage = (closure) => {
    const title = closure.title_ar || closure.title_en || '';
    return `السلام عليكم {name}،\nنود إفادتكم بأنه نظراً لـ "${title}" بتاريخ ${closure.start_date} → ${closure.end_date}، تم ترحيل اشتراككم {days} يوم/أيام.\nتاريخ الانتهاء الجديد: {new_end}\nشكراً لكم 🏆\nأكاديمية أداء الأبطال`;
  };

  const handlePreviewExtension = async (closure) => {
    const request = ++previewRequest.current;
    setNoticeReady(false);
    refreshNoticeSummaries();
    setPreviewClosure(closure);
    setPreviewResult(null);
    setExcludedMemberIds([]);
    setPreviewIsStale(false);
    setShowSkippedList(false);
    setWaMessage(buildDefaultMessage(closure));
    setWhatsappMode('automatic');
    setShowPreviewDialog(true);
    setPreviewing(true);
    try {
      const res = await api.dayExtensions.applyExtension({
        closure_id: closure.id,
        days: closure.days,
        branch_id: applyBranch,
        dry_run: true,
        excluded_member_ids: []
      });
      if (request !== previewRequest.current) return;
      setPreviewResult(res.data || res);
      setPreviewSelection(selectionKey(closure, applyBranch, []));
    } catch (error) {
      if (request !== previewRequest.current) return;
      toast.error(t('خطأ في المعاينة', 'Preview error'));
      setShowPreviewDialog(false);
    } finally {
      if (request === previewRequest.current) setPreviewing(false);
    }
  };

  const refreshPreview = useCallback(async (closure, branchId, exclusions) => {
    if (!closure) return;
    const request = ++previewRequest.current;
    setPreviewing(true);
    setPreviewIsStale(false);
    try {
      const res = await api.dayExtensions.applyExtension({
        closure_id: closure.id,
        days: closure.days,
        branch_id: branchId,
        dry_run: true,
        excluded_member_ids: exclusions
      });
      if (request !== previewRequest.current) return;
      setPreviewResult(res.data || res);
      setPreviewSelection(selectionKey(closure, branchId, exclusions));
    } catch (error) {
      if (request !== previewRequest.current) return;
      setPreviewResult(null);
      toast.error(t('تعذر تحديث المعاينة. حاول مرة أخرى.', 'Could not refresh the preview. Try again.'));
    } finally {
      if (request === previewRequest.current) setPreviewing(false);
    }
  }, [language]);

  useEffect(() => {
    if (!showPreviewDialog || !previewClosure) return undefined;
    // Opening the dialog performs the first request itself. Subsequent selection
    // changes must produce a new token before applying.
    if (!previewResult && previewing) return undefined;
    const timer = window.setTimeout(() => {
      refreshPreview(previewClosure, applyBranch, excludedMemberIds);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [
    applyBranch,
    excludedMemberIds,
    previewClosure?.start_date,
    previewClosure?.end_date
  ]);

  const handleSendWhatsAppFromPreview = async () => {
    if (sendInFlight.current || automaticLocked) return;
    if (!previewResult || !previewResult.extended_members?.length) {
      toast.error(t('لا يوجد مستلمون', 'No recipients'));
      return;
    }
    if (!waMessage.trim()) {
      toast.error(t('أدخل نص الرسالة', 'Enter message text'));
      return;
    }
    const recipientCount = previewResult.extended_members.filter(m => m.phone && !excludedMemberIds.includes(m.member_id)).length;
    if (recipientCount === 0) {
      toast.error(t('لا يوجد أرقام جوال', 'No phone numbers'));
      return;
    }
    if (!window.confirm(t(
      `ستتم إضافة ${recipientCount} رسالة إلى قائمة الإرسال التلقائي للفرع بفاصل دقيقة واحدة على الأقل، وقد يزيد الانتظار بسبب رسائل أخرى أو قيود الإرسال. هذا ليس فتح واتساب يدويًا. الإضافة لا تعني أن الرسائل أُرسلت بعد. هل تريد المتابعة؟`,
      `Queue ${recipientCount} message(s) automatically at least one minute apart? Other queued messages or sending limits may increase the wait. This does not open WhatsApp manually. Queued does not mean sent.`
    ))) return;
    sendInFlight.current = true;
    noticeRequest.current += 1;
    setNoticeReady(false);
    setSendingWa(true);
    try {
      const response = await whatsappAPI.enqueueClosureNotices({
        closure_id: previewClosure.id,
        branch_id: applyBranch,
        message: waMessage,
        excluded_member_ids: excludedMemberIds
      });
      const jobs = response.data?.jobs || [];
      setWaJobs(current => [...jobs, ...current.filter(old => !jobs.some(job => job.id === old.id))]);
      setWaJobsPollVersion(value => value + 1);
      const skipped = response.data?.skipped_without_phone || 0;
      if (response.data?.existing && !response.data?.queued) {
        toast.info(t('قائمة موجودة بالفعل؛ لم تُضف رسائل جديدة', 'Existing queue; no new messages queued'));
      } else toast.success(t(
        `تمت الإضافة إلى قائمة الانتظار؛ لم يتم تطبيق الترحيل${skipped ? ` (تم تخطي ${skipped} بدون جوال)` : ''}`,
        `Queued; the extension was not applied${skipped ? ` (${skipped} without a phone skipped)` : ''}`
      ));
      await refreshNoticeSummaries();
    } catch (error) {
      toast.error(error.response?.data?.detail || t('تعذر إضافة الرسائل إلى قائمة الانتظار', 'Could not queue messages'));
    } finally {
      sendInFlight.current = false;
      setSendingWa(false);
    }
  };

  useEffect(() => {
    if (!waJobs.length) return undefined;
    const active = waJobs.filter(job => ['initializing', 'pending', 'processing', 'paused'].includes(job.status));
    if (!active.length) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (!cancelled) {
        try {
          await refreshNoticeSummaries();
        } catch {
          toast.error(t('تعذر تحديث حالة الرسائل', 'Could not refresh message status'));
        }
        setWaJobsPollVersion(value => value + 1);
      }
    }, 30000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [waJobs, waJobsPollVersion, refreshNoticeSummaries]);

  const handleConfirmApplyFromPreview = async () => {
    if (!previewClosure || !previewResult?.preview_token || previewIsStale || previewing || !previewMatchesSelection) return;
    if (!window.confirm(t(
      'سيتم الآن تعديل تواريخ الاشتراكات وترحيل الفترات المدفوعة المتداخلة. لن تتغير الفواتير أو إجمالي المبالغ المدفوعة. هل تريد التطبيق؟',
      'This will now change subscription dates and postpone overlapping prepaid periods. Invoices and paid totals will not change. Apply now?'
    ))) return;
    setApplying(true);
    try {
      const res = await api.dayExtensions.applyExtension({
        closure_id: previewClosure.id,
        days: previewClosure.days,
        branch_id: applyBranch,
        dry_run: false,
        excluded_member_ids: excludedMemberIds,
        preview_token: previewResult.preview_token
      });
      const result = res.data || res;
      setApplyResult({
        days: previewClosure.days,
        closureTitle: previewClosure.title_ar || previewClosure.title_en || '',
        extended_count: result.extended_count || 0,
        extended_members: result.extended_members || [],
        skipped_count: result.skipped_count || 0,
        skipped_members: result.skipped_members || []
      });
      setShowPreviewDialog(false);
      setShowResultDialog(true);
      loadData();
    } catch (error) {
      if (error.response?.status === 409) {
        setPreviewIsStale(true);
        setPreviewResult(current => current ? { ...current, preview_token: null } : current);
        const detail = error.response?.data?.detail;
        const conflictMessages = {
          'Closure was already applied': [
            'تم تطبيق فترة الإغلاق بالفعل. أعد تحميل القائمة للتحقق من النتيجة.',
            'This closure was already applied. Reload the list to check the result.'
          ],
          'Member subscriptions changed; preview again': [
            'تعذر مطابقة اشتراكات العضو عند الحفظ. حدّث المعاينة وراجعها قبل التأكيد مجدداً.',
            'Member subscriptions could not be matched when saving. Refresh and review before confirming again.'
          ],
          'Level subscription changed; preview again': [
            'تعذر مطابقة اشتراك المستوى عند الحفظ. حدّث المعاينة وراجعها؛ إذا تكرر الخطأ فتحقق من ارتباطات المستويات.',
            'A level subscription could not be matched when saving. Refresh and review; if this repeats, check the level links.'
          ],
          'Subscriptions changed concurrently; preview again': [
            'حدث تعارض أثناء حفظ الترحيل. لم يكتمل التطبيق. حدّث المعاينة وراجعها قبل التأكيد مجدداً.',
            'A conflict occurred while saving the extension. Application did not complete. Refresh and review before confirming again.'
          ],
          'Preview is required before applying this closure': [
            'يجب إنشاء معاينة ومراجعتها قبل تطبيق الإغلاق.',
            'Generate and review a preview before applying this closure.'
          ],
        };
        const knownSourceConflict = ['Preview is stale; preview and confirm again', 'Preview sources changed; preview and confirm again'].includes(detail);
        const message = conflictMessages[detail]
          ? t(...conflictMessages[detail])
          : knownSourceConflict || !detail
            ? t(
              'انتهت صلاحية المعاينة أو تغيرت البيانات. حدّث المعاينة ثم راجعها قبل التطبيق.',
              'The preview is stale or data changed. Refresh and review it before applying.'
            )
            : `${t('تعذر التطبيق بسبب تعارض:', 'Application conflict:')} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
        setPreviewConflictMessage(message);
        toast.error(message);
      } else {
        toast.error(error.response?.data?.detail || t('خطأ في الترحيل', 'Error applying extension'));
      }
    } finally {
      setApplying(false);
    }
  };

  const cancelWhatsAppJob = async (job) => {
    try {
      await whatsappAPI.cancelBranchCloudJob(job.branch_id, job.id);
      // Keep existing recipient evidence locked until the authoritative summary
      // reload completes; a raw cancellation response has no recipient_states.
      await refreshNoticeSummaries();
      toast.success(t('أُلغي المتبقي المعلّق', 'Remaining pending messages cancelled'));
    } catch (error) {
      toast.error(error.response?.data?.detail || t('تعذر الإلغاء', 'Could not cancel'));
    }
  };

  const closureForJob = (job) => {
    const closureId = (job.idempotency_key || '').replace(/^closure_notice_/, '');
    return closures.find(closure => closure.id === closureId);
  };
  const currentClosure = closures.find(c => c.id === previewClosure?.id) || previewClosure;
  const currentNoticeReady = noticeReady && currentClosure?.notice_summary &&
    currentClosure.notice_summary.state !== 'loading';
  const previewJobs = waJobs.filter(job => job.idempotency_key === `closure_notice_${previewClosure?.id}`);
  const selectedNoticeBranches = currentClosure?.branch_id && currentClosure.branch_id !== 'all'
    ? [currentClosure.branch_id]
    : applyBranch !== 'all' ? [applyBranch]
      : currentClosure?.notice_summary?.scope_branch_ids || branches.map(b => b.id || b._id);
  const automaticLocked = !currentNoticeReady || (selectedNoticeBranches.length > 0 &&
    selectedNoticeBranches.every(id => previewJobs.some(job => job.branch_id === id)));
  // Old jobs lack member identity. Conservatively lock manual links for their
  // branch rather than guess which phone was accepted or may still be queued.
  const manualQueueLocked = (member) => {
    if (!currentNoticeReady) return true;
    const branch = member.branch_id || members.find(m => (m.id || m._id) === member.member_id)?.branch_id;
    return previewJobs.some(job => (!branch || job.branch_id === branch) &&
      (!job.recipient_states || job.legacy_recipient_identity ||
       Object.prototype.hasOwnProperty.call(job.recipient_states, member.member_id)));
  };
  const noticeStateLabel = (summary) => {
    if (!noticeReady || !summary || summary.state === 'loading') return t('جارٍ التحقق من حالة الرسائل', 'Checking message status');
    if (!summary?.jobs?.length) return t('لم يرسل — لم يُضف للقائمة', 'Not sent — not queued');
    if (summary.state === 'zero_recipients') return t('لم يرسل — لا يوجد مستلمون', 'Not sent — zero recipients');
    if (summary.state === 'unknown' || summary.state === 'completed_with_failures') {
      return t('يحتاج مراجعة — لا تعاود الإرسال', 'Needs review — do not resend');
    }
    if (summary.state === 'pending') return t('قيد الإرسال', 'Sending in progress');
    if (summary.state === 'completed') return t('تم الإرسال — قبول المزود فقط', 'Sent — provider acceptance only');
    return t('يحتاج مراجعة', 'Needs review');
  };

  const handleManualExtension = async () => {
    if (!manualExt.member_id || !manualExt.days || !manualExt.reason) {
      toast.error(t('أكمل جميع الحقول', 'Fill all fields'));
      return;
    }
    setSaving(true);
    try {
      await api.dayExtensions.manualExtension({
        ...manualExt,
        activity_id: manualExt.activity_id || null
      });
      toast.success(t('تم ترحيل الأيام بنجاح', 'Days extended successfully'));
      setShowManualDialog(false);
      setManualExt({ member_id: '', days: 1, reason: '', activity_id: '' });
      loadData();
    } catch (error) {
      toast.error(t('خطأ', 'Error'));
    } finally {
      setSaving(false);
    }
  };

  const calcDays = (start, end) => {
    if (!start || !end) return 0;
    return Math.floor((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1;
  };

  const calcExtensionDays = () => {
    const totalDays = calcDays(newClosure.start_date, newClosure.end_date);
    if (totalDays <= 0) return 0;
    if (newClosure.stop_type === 'partial' && newClosure.stop_hours > 0) {
      return Math.round((newClosure.stop_hours / 24) * totalDays * 10) / 10;
    }
    return totalDays;
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarOff className="w-7 h-7 text-primary" />
              {t('ترحيل الأيام', 'Day Extensions')}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {t('إدارة الإجازات والإغلاقات وترحيل الأيام للمشتركين', 'Manage closures and extend member subscriptions')}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setShowManualDialog(true)} variant="outline" className="border-blue-400 text-blue-700">
              <User className="w-4 h-4 me-2" />
              {t('ترحيل يدوي لعضو', 'Manual Extension')}
            </Button>
            <Button onClick={() => setShowCreateDialog(true)} className="bg-primary">
              <Plus className="w-4 h-4 me-2" />
              {t('إضافة فترة إغلاق', 'Add Closure')}
            </Button>
          </div>
        </div>
        {waJobs.length > 0 && (
          <Card className="p-4 space-y-2" data-testid="closure-whatsapp-job-progress">
            <Label>{t('حالة قوائم رسائل الإغلاق', 'Closure message queue status')}</Label>
            {waJobs.slice(0, 10).map(job => {
              const jobClosure = closureForJob(job);
              return (
                <div key={job.id} className="rounded-md border p-3 text-xs">
                  <div className="font-medium">
                    {jobClosure?.title_ar || jobClosure?.title_en || t('إغلاق', 'Closure')}
                    {' · '}
                    {branches.find(branch => (branch.id || branch._id) === job.branch_id)?.name_ar || job.branch_id}
                    {' · '}{job.status}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {t('معلّق', 'Pending')}: {job.pending || 0} · {t('مقبول لدى المزود', 'Provider accepted')}: {job.sent || 0} · {t('فشل', 'Failed')}: {job.failed || 0} · {t('غير معروف', 'Unknown')}: {job.unknown || 0}
                  </div>
                  {job.pending > 0 && (
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => cancelWhatsAppJob(job)}>
                      {t('إلغاء المتبقي', 'Cancel remaining')}
                    </Button>
                  )}
                </div>
              );
            })}
          </Card>
        )}

        <div className="flex gap-2 border-b pb-2">
          <Button variant={activeTab === 'closures' ? 'default' : 'ghost'} size="sm" onClick={() => setActiveTab('closures')}>
            <CalendarDays className="w-4 h-4 me-1" />
            {t('الإغلاقات', 'Closures')} ({closures.length})
          </Button>
          <Button variant={activeTab === 'logs' ? 'default' : 'ghost'} size="sm" onClick={() => setActiveTab('logs')}>
            <History className="w-4 h-4 me-1" />
            {t('سجل الترحيل', 'Extension Log')} ({logs.length})
          </Button>
        </div>

        {activeTab === 'closures' && (
          <div className="space-y-4">
            {branches.length > 1 && (
              <div className="flex items-center gap-2">
                <Label className="text-sm">{t('الفرع:', 'Branch:')}</Label>
                <select
                  className="border rounded-md px-3 py-2 text-sm bg-white"
                  value={applyBranch}
                  onChange={(e) => setApplyBranch(e.target.value)}
                >
                  <option value="all">{t('جميع الفروع', 'All Branches')}</option>
                  {branches.map(b => (
                    <option key={b.id || b._id} value={b.id || b._id}>{b.name_ar || b.name || ''}</option>
                  ))}
                </select>
              </div>
            )}

            {closures.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                <CalendarOff className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>{t('لا توجد فترات إغلاق مسجلة', 'No closures recorded')}</p>
              </Card>
            ) : (
              <div className="grid gap-4">
                {closures.map(closure => (
                  <Card key={closure.id} className={`p-4 ${closure.applied ? 'border-green-300 bg-green-50/30' : 'border-orange-300'}`}>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <h3 className="font-bold text-lg">{closure.title_ar || ''}</h3>
                          <Badge variant="outline">
                            {!closure.branch_id || closure.branch_id === 'all'
                              ? t('جميع الفروع', 'All Branches')
                              : closure.branch_name || branches.find(b => (b.id || b._id) === closure.branch_id)?.name_ar || closure.branch_id}
                          </Badge>
                          <div className="w-full text-xs text-muted-foreground" data-testid={`closure-notice-status-${closure.id}`}>
                            {t('واتساب (مستلمون):', 'WhatsApp (recipients):')}{' '}
                            {closure.notice_summary?.jobs?.length ? <>
                              {t('مقبول لدى المزود وليس تأكيد تسليم', 'Accepted, not confirmed delivered')}: {closure.notice_summary.sent || 0} ·{' '}
                              {t('معلق', 'Pending')}: {closure.notice_summary.pending || 0} ·{' '}
                              {t('فشل', 'Failed')}: {closure.notice_summary.failed || 0} ·{' '}
                              {t('ملغى', 'Cancelled')}: {closure.notice_summary.cancelled || 0} ·{' '}
                              {t('غير معروف — لا تعاود الإرسال', 'Unknown — do not resend')}: {closure.notice_summary.unknown || 0} ·{' '}
                              {t('تسليم مؤكد', 'Confirmed delivered')}: {closure.notice_summary.delivered || 0}
                              {' · '}<Badge variant="outline">{noticeStateLabel(closure.notice_summary)}</Badge>
                            </> : noticeStateLabel(closure.notice_summary)}
                          </div>
                          <Badge className={REASON_COLORS[closure.reason] || REASON_COLORS.other}>
                            {(language === 'ar' ? REASON_LABELS.ar : REASON_LABELS.en)[closure.reason] || closure.reason || ''}
                          </Badge>
                          {closure.scope === 'specific' && (closure.activity_names?.length > 0 || closure.activity_name) && (
                            <>
                              {(closure.activity_names || [closure.activity_name]).filter(Boolean).map((name, idx) => (
                                <Badge key={idx} className="bg-purple-100 text-purple-800">
                                  {name}
                                </Badge>
                              ))}
                            </>
                          )}
                          {closure.stop_type === 'specific_times' && closure.affected_times?.length > 0 && (
                            closure.affected_times.map((time, idx) => (
                              <Badge key={idx} className="bg-yellow-100 text-yellow-800">
                                <Clock className="w-3 h-3 me-1" />
                                {time}
                              </Badge>
                            ))
                          )}
                          {closure.stop_type === 'partial' && (
                            <Badge className="bg-yellow-100 text-yellow-800">
                              <Clock className="w-3 h-3 me-1" />
                              {closure.stop_hours} {t('ساعات', 'hrs')}
                            </Badge>
                          )}
                          {closure.applied && (
                            <Badge className="bg-green-600 text-white">
                              <CheckCircle className="w-3 h-3 me-1" />
                              {t('تم الترحيل', 'Applied')}
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <CalendarDays className="w-4 h-4" />
                            {closure.start_date} → {closure.end_date}
                          </span>
                          <span className="flex items-center gap-1 font-medium text-primary">
                            <Clock className="w-4 h-4" />
                            {t('ترحيل:', 'Extension:')} {closure.days} {t('يوم', 'days')}
                          </span>
                          {closure.applied && (
                            <span className="flex items-center gap-1 text-green-700">
                              <Users className="w-4 h-4" />
                              {closure.applied_count || 0} {t('مشترك', 'members')}
                            </span>
                          )}
                        </div>
                        {closure.applied && (
                          <div className="mt-2 inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-green-100 text-green-800">
                            <CheckCircle className="w-3 h-3" />
                            {t('تم التطبيق', 'Applied on')}: {closure.applied_at ? new Date(closure.applied_at).toLocaleString(language === 'ar' ? 'ar-SA' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                            {closure.applied_by && (
                              <span className="ms-1">• {t('بواسطة', 'by')} {closure.applied_by}</span>
                            )}
                          </div>
                        )}
                        {closure.applied && (
                          <div className="mt-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-7 border-green-300 text-green-800 hover:bg-green-50"
                              onClick={() => setExpandedClosures(prev => ({ ...prev, [closure.id]: !prev[closure.id] }))}
                            >
                              {expandedClosures[closure.id] ? <ChevronUp className="w-3 h-3 me-1" /> : <ChevronDown className="w-3 h-3 me-1" />}
                              {expandedClosures[closure.id]
                                ? t('إخفاء تفاصيل الأعضاء', 'Hide member details')
                                : t('عرض تفاصيل الأعضاء المُرحَّلين', 'Show extended members details')}
                            </Button>
                            {expandedClosures[closure.id] && (
                              <div className="mt-3 border rounded-lg bg-green-50/40 p-3 space-y-2">
                                {!Array.isArray(closure.affected_members) || closure.affected_members.length === 0 ? (
                                  <p className="text-xs text-muted-foreground text-center py-2">
                                    {t('لا توجد بيانات محفوظة لأعضاء هذا الترحيل (ترحيل قديم قبل تفعيل الميزة).', 'No saved member data for this extension (legacy extension before this feature).')}
                                  </p>
                                ) : (
                                  <>
                                    <div className="flex items-center gap-2">
                                      <Input
                                        placeholder={t('بحث بالاسم أو ولي الأمر أو الجوال…', 'Search name / guardian / phone…')}
                                        value={memberSearch[closure.id] || ''}
                                        onChange={(e) => setMemberSearch(prev => ({ ...prev, [closure.id]: e.target.value }))}
                                        className="h-8 text-xs"
                                      />
                                      <Badge className="bg-green-100 text-green-800 whitespace-nowrap text-xs">
                                        {closure.affected_members.length} {t('عضو', 'members')}
                                      </Badge>
                                    </div>
                                    <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
                                      {closure.affected_members
                                        .filter(em => {
                                          const q = (memberSearch[closure.id] || '').trim().toLowerCase();
                                          if (!q) return true;
                                          return [em.name, em.guardian_name, em.phone].some(v => (v || '').toLowerCase().includes(q));
                                        })
                                        .map((em, idx) => (
                                          <div key={em.member_id || idx} className="bg-white border rounded p-2 text-xs">
                                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                              <div className="font-semibold text-gray-800 flex items-center gap-1.5">
                                                <User className="w-3.5 h-3.5 text-green-700" />
                                                {em.name || t('بدون اسم', 'No name')}
                                                {em.guardian_name && (
                                                  <span className="text-gray-500 font-normal">• {t('ولي الأمر:', 'Guardian:')} {em.guardian_name}</span>
                                                )}
                                              </div>
                                              {em.phone && (
                                                <span className="text-gray-500 flex items-center gap-1">
                                                  <Phone className="w-3 h-3" /> {em.phone}
                                                </span>
                                              )}
                                            </div>
                                            {Array.isArray(em.details) && em.details.length > 0 && (
                                              <div className="mt-1.5 space-y-1">
                                                {em.details.map((d, di) => (
                                                  <div key={di} className="flex flex-wrap items-center gap-1.5 text-[11px] bg-green-50 rounded px-2 py-1">
                                                    <Badge className="bg-purple-100 text-purple-800 text-[10px]">{d.activity}</Badge>
                                                    <span className="text-gray-600">{d.old_end}</span>
                                                    <span className="text-green-700 font-bold">→</span>
                                                    <span className="text-green-800 font-semibold">{d.new_end}</span>
                                                    {d.missed_sessions > 0 && (
                                                      <Badge className="bg-blue-100 text-blue-800 text-[10px]">
                                                        +{d.missed_sessions} {t('يوم', 'days')}
                                                      </Badge>
                                                    )}
                                                    {d.training_days && d.training_days !== 'غير محدد' && (
                                                      <span className="text-gray-500">• {d.training_days}</span>
                                                    )}
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {!closure.applied && (
                          <div className="mt-2 inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-orange-100 text-orange-800">
                            <Clock className="w-3 h-3" />
                            {t('لم يتم الترحيل بعد — اضغط "ترحيل للجميع"', 'Not applied yet — click "Apply to All"')}
                          </div>
                        )}
                        {closure.notes && <p className="text-sm text-muted-foreground mt-1">{closure.notes}</p>}
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={() => handlePreviewExtension(closure)} disabled={applying || previewing} variant="outline" className="border-blue-500 text-blue-700 hover:bg-blue-50">
                          <Users className="w-4 h-4 me-1" />
                          {t('معاينة وإرسال واتساب', 'Preview & WhatsApp')}
                        </Button>
                        {!closure.applied && (
                          <>
                            <Button onClick={() => handlePreviewExtension(closure)} disabled={applying || previewing} className="bg-green-600 hover:bg-green-700">
                              {previewing ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <Play className="w-4 h-4 me-1" />}
                              {t('معاينة قبل الترحيل', 'Preview before applying')}
                            </Button>
                            <Button variant="ghost" size="sm" className="text-red-500" onClick={() => handleDeleteClosure(closure.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="space-y-3">
            {logs.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>{t('لا يوجد سجل ترحيل', 'No extension logs')}</p>
              </Card>
            ) : (
              logs.map(log => (
                <Card key={log.id || Math.random()} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {log.type === 'closure' ? (
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                          <Users className="w-5 h-5 text-blue-700" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                          <User className="w-5 h-5 text-purple-700" />
                        </div>
                      )}
                      <div>
                        {log.type === 'closure' ? (
                          <p className="font-medium">
                            {t('ترحيل جماعي', 'Bulk Extension')} - {log.closure_title || ''}
                            <span className="text-green-600 font-bold ms-2">+{log.days} {t('يوم', 'days')}</span>
                            {log.activity_name && (
                              <Badge className="bg-purple-100 text-purple-800 ms-2 text-xs">
                                {log.activity_name}
                              </Badge>
                            )}
                            {log.stop_type === 'partial' && (
                              <Badge className="bg-yellow-100 text-yellow-800 ms-1 text-xs">
                                {log.stop_hours} {t('ساعات/يوم', 'hrs/day')}
                              </Badge>
                            )}
                          </p>
                        ) : (
                          <p className="font-medium">
                            {t('ترحيل يدوي', 'Manual')} - {log.member_name || ''}
                            <span className="text-green-600 font-bold ms-2">+{log.days} {t('يوم', 'days')}</span>
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {log.type === 'closure' && log.members_count ? `${log.members_count} ${t('مشترك', 'members')} | ` : ''}
                          {log.type === 'manual' && log.reason ? `${log.reason} | ` : ''}
                          {t('بواسطة', 'by')} {log.applied_by || ''} | {log.created_at ? new Date(log.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US') : ''}
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {showPreviewDialog && (
          <Dialog open={showPreviewDialog} onOpenChange={(o) => { if (!o) { ++previewRequest.current; setShowPreviewDialog(false); setPreviewClosure(null); setPreviewResult(null); setExcludedMemberIds([]); } }}>
            <DialogContent className="w-[calc(100vw-1rem)] min-w-0 max-w-3xl max-h-[calc(100dvh-1rem)] overflow-x-hidden overflow-y-auto [&>*]:min-w-0">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  {t('معاينة الترحيل وإرسال واتساب', 'Preview Extension & Send WhatsApp')}
                </DialogTitle>
              </DialogHeader>

              {previewing ? (
                <div className="py-12 text-center">
                  <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
                  <p className="text-sm text-muted-foreground mt-2">{t('جارٍ حساب المشتركين المتأثرين...', 'Calculating affected members...')}</p>
                </div>
              ) : previewResult ? (
                <div className="min-w-0 space-y-4">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                    <p className="font-semibold">
                      {t('المعاينة فقط — لم يتم تطبيق أي تغيير بعد', 'Preview only — no changes have been applied')}
                    </p>
                    <p className="mt-1">
                      {t(
                        'سيُعوّض الاشتراك الحالي أولاً، ثم تُرحّل أي فترة مدفوعة متداخلة مع الحفاظ على الفواتير وإجمالي المبالغ المدفوعة دون تغيير.',
                        'The current subscription is compensated first, then any overlapping prepaid period is postponed. Invoices and paid totals remain unchanged.'
                      )}
                    </p>
                  </div>
                  {branches.length > 1 && (
                    <div className="grid gap-1 sm:max-w-sm">
                      <Label htmlFor="closure-preview-branch">
                        {t('الفرع المشمول في المعاينة', 'Branch included in preview')}
                      </Label>
                      <select
                        id="closure-preview-branch"
                        className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                        value={applyBranch}
                        onChange={(event) => setApplyBranch(event.target.value)}
                        disabled={previewing || applying}
                      >
                        <option value="all">{t('جميع الفروع', 'All Branches')}</option>
                        {branches.map(branch => (
                          <option key={branch.id || branch._id} value={branch.id || branch._id}>
                            {branch.name_ar || branch.name || branch.name_en || ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {previewIsStale && (
                    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                      <p className="font-semibold">
                        {t('المعاينة لم تعد صالحة. يجب تحديثها ومراجعتها من جديد.', 'This preview is no longer valid. Refresh and review it again.')}
                      </p>
                      {previewConflictMessage && <p className="mt-1">{previewConflictMessage}</p>}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2 border-red-300"
                        onClick={() => refreshPreview(previewClosure, applyBranch, excludedMemberIds)}
                      >
                        {t('تحديث المعاينة', 'Refresh preview')}
                      </Button>
                    </div>
                  )}
                  {(() => {
                    const allMembers = previewResult.extended_members || [];
                    const activeMembers = allMembers.filter(m => !excludedMemberIds.includes(m.member_id));
                    const excludedCount = excludedMemberIds.length;
                    return (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-center">
                          <p className="text-xs text-muted-foreground">{t('سيتم ترحيلهم', 'Will be extended')}</p>
                          <p className="text-2xl font-bold text-blue-700">{activeMembers.length}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-center">
                          <p className="text-xs text-muted-foreground">{t('لديهم رقم جوال', 'With phone')}</p>
                          <p className="text-2xl font-bold text-green-700">{activeMembers.filter(m => m.phone).length}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-center">
                          <p className="text-xs text-muted-foreground">{t('مستبعدون يدوياً', 'Manually excluded')}</p>
                          <p className="text-2xl font-bold text-red-700">{excludedCount}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-orange-50 border border-orange-200 text-center">
                          <p className="text-xs text-muted-foreground">{t('تم استثناؤهم', 'Skipped')}</p>
                          <p className="text-2xl font-bold text-orange-700">{previewResult.skipped_count || 0}</p>
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <MessageCircle className="w-4 h-4 text-green-600" />
                      {t('نص رسالة الواتساب', 'WhatsApp Message')}
                    </Label>
                    <Textarea
                      value={waMessage}
                      onChange={(e) => setWaMessage(e.target.value)}
                      rows={6}
                      className="mt-1 text-sm"
                      placeholder={t('أدخل نص الرسالة...', 'Enter message...')}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('متغيرات متاحة:', 'Available variables:')} <code className="bg-muted px-1">{'{name}'}</code> <code className="bg-muted px-1">{'{days}'}</code> <code className="bg-muted px-1">{'{new_end}'}</code> <code className="bg-muted px-1">{'{old_end}'}</code> <code className="bg-muted px-1">{'{activity}'}</code>
                    </p>
                  </div>

                  <div className="rounded-lg border bg-muted/20 p-3 space-y-2" data-testid="closure-whatsapp-mode">
                    <Label className="text-sm font-medium">
                      {t('طريقة فتح/إرسال واتساب', 'WhatsApp delivery mode')}
                    </Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant={whatsappMode === 'automatic' ? 'default' : 'outline'}
                        className="w-full justify-center"
                        onClick={() => setWhatsappMode('automatic')}
                      >
                        <Send className="w-4 h-4 me-1" />
                        {t('إرسال تلقائي عبر القائمة', 'Automatic queue')}
                      </Button>
                      <Button
                        type="button"
                        variant={whatsappMode === 'manual' ? 'default' : 'outline'}
                        className={`w-full justify-center ${whatsappMode === 'manual' ? 'bg-green-600 hover:bg-green-700' : 'border-green-500 text-green-700'}`}
                        onClick={() => setWhatsappMode('manual')}
                      >
                        <MessageCircle className="w-4 h-4 me-1" />
                        {t('فتح يدوي لكل عضو', 'Open chats manually')}
                      </Button>
                    </div>
                    {whatsappMode === 'manual' ? (
                      <p className="text-xs text-muted-foreground">
                        {t(
                          'يفتح كل زر محادثة واحدة فقط برسالة مخصصة. الفتح لا يعني أن الرسالة أُرسلت أو تم تسليمها.',
                          'Each button opens one chat with its personalized message. Opening a chat does not mean the message was sent or delivered.'
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {t(
                          'سيستخدم الإرسال التلقائي قائمة الفرع الموقوتة. الإضافة للقائمة لا تعني الإرسال أو التسليم.',
                          'Automatic sending uses the paced branch queue. Queueing does not mean the message was sent or delivered.'
                        )}
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-sm font-medium">{t('التغييرات حسب الفرع والعضو', 'Changes by branch and member')}</Label>
                      {excludedMemberIds.length > 0 && (
                        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setExcludedMemberIds([])}>
                          {t('استعادة المستبعدين', 'Restore excluded')} ({excludedMemberIds.length})
                        </button>
                      )}
                    </div>
                    <div className="max-w-full min-w-0 max-h-[420px] overflow-x-hidden overflow-y-auto border rounded-lg divide-y" data-testid="closure-impact-preview">
                      {(previewResult.extended_members || []).length === 0 ? (
                        <p className="p-4 text-center text-sm text-muted-foreground">{t('لا يوجد مشتركون متأثرون', 'No affected members')}</p>
                      ) : (
                        Object.entries((previewResult.extended_members || []).reduce((groups, member) => {
                          const key = member.branch_id || 'unknown';
                          if (!groups[key]) groups[key] = {
                            name: member.branch_name || t('فرع غير محدد', 'Unknown branch'),
                            members: []
                          };
                          groups[key].members.push(member);
                          return groups;
                        }, {})).map(([branchId, group]) => (
                          <div key={branchId} className="divide-y">
                            <div className="sticky top-0 z-10 bg-slate-100 px-3 py-2 text-sm font-bold">
                              {t('الفرع:', 'Branch:')} {group.name} ({group.members.length})
                            </div>
                            {group.members.map((m, idx) => {
                          const activityChanges = m.activity_changes || (m.details || []).map(detail => ({
                            activity_id: detail.activity_id,
                            activity_name: detail.activity,
                            old_end_date: detail.old_end,
                            new_end_date: detail.new_end,
                            missed_sessions: detail.missed_sessions
                          }));
                          const isExcluded = excludedMemberIds.includes(m.member_id);
                          const toggleExclude = () => {
                            setExcludedMemberIds(prev => prev.includes(m.member_id)
                              ? prev.filter(x => x !== m.member_id)
                              : [...prev, m.member_id]);
                          };
                          return (
                            <div key={m.member_id || idx} className={`min-w-0 p-3 text-sm hover:bg-muted/30 ${isExcluded ? 'opacity-50 bg-red-50/40' : ''}`}>
                              <div className="flex flex-col items-stretch justify-between gap-2 sm:flex-row sm:items-start">
                              <div className="flex-1 min-w-0">
                                <p className={`font-medium ${isExcluded ? 'line-through text-muted-foreground' : ''}`}>
                                  {m.name || '-'}
                                  {m.guardian_name ? <span className="text-xs text-muted-foreground font-normal ms-2">· {t('ولي الأمر:', 'Guardian:')} {m.guardian_name}</span> : null}
                                </p>
                                <div className="mt-2 space-y-1">
                                  {activityChanges.map((change, changeIndex) => (
                                    <div key={`${change.activity_id || change.activity_name}-${changeIndex}`} className="min-w-0 break-words rounded bg-blue-50 p-2 text-xs">
                                      <span className="font-semibold">{change.activity_name || t('نشاط غير محدد', 'Unknown activity')}</span>
                                      <span className="mx-1">·</span>
                                      {t('نهاية الاشتراك:', 'Subscription end:')} {change.old_end_date || '—'} → <strong>{change.new_end_date || '—'}</strong>
                                      <span className="ms-2">{t('حصص فائتة:', 'Missed sessions:')} {change.missed_sessions ?? '—'}</span>
                                    </div>
                                  ))}
                                  {(m.deferred_periods || []).map((period, periodIndex) => (
                                    <div key={`${period.invoice_id || period.activity_id}-${periodIndex}`} className="min-w-0 break-words rounded border border-purple-200 bg-purple-50 p-2 text-xs">
                                      <p className="font-semibold text-purple-900">
                                        {t('فترة مدفوعة مؤجلة', 'Prepaid period postponed')} · {period.activity_name || t('نشاط غير محدد', 'Unknown activity')}
                                      </p>
                                      <p>{t('البداية:', 'Start:')} {period.old_start_date || '—'} → <strong>{period.new_start_date || '—'}</strong></p>
                                      <p>{t('النهاية:', 'End:')} {period.old_end_date || '—'} → <strong>{period.new_end_date || '—'}</strong></p>
                                      {period.invoice_id && <p className="break-all text-muted-foreground">{t('رقم الفاتورة:', 'Invoice:')} {period.invoice_id}</p>}
                                    </div>
                                  ))}
                                  {(m.warnings || []).map((warning, warningIndex) => (
                                    <p key={warningIndex} className="flex min-w-0 items-start gap-1 break-words rounded bg-amber-50 p-2 text-xs text-amber-900">
                                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                      {t('تنبيه جدول غير معروف:', 'Unknown schedule warning:')} {warning}
                                    </p>
                                  ))}
                                </div>
                              </div>
                               <div className="flex items-center gap-2 ms-2 flex-wrap justify-end">
                                 <span className="text-xs text-muted-foreground" dir="ltr">
                                   {canViewPhones || !m.phone || String(m.phone).includes('•')
                                     ? (m.phone || t('بدون جوال', 'no phone'))
                                     : t('رقم محمي', 'Protected phone')}
                                 </span>
                                 {whatsappMode === 'manual' && (() => {
                                   const messageReady = Boolean(waMessage.trim());
                                   const personalizedMessage = personalizeClosureMessage(waMessage, m);
                                   const queueLocked = manualQueueLocked(m) || sendingWa;
                                   const manualUrl = !queueLocked && !isExcluded && messageReady
                                     ? getManualWhatsAppUrl(m.phone, canViewPhones, personalizedMessage)
                                     : '';
                                   const reason = isExcluded
                                     ? t('مستبعد من الإرسال', 'Excluded')
                                     : !messageReady
                                       ? t('أدخل نص الرسالة أولاً', 'Enter a message first')
                                     : !canViewPhones
                                       ? t('تحتاج صلاحية عرض أرقام الأعضاء', 'Member phone permission required')
                                       : !m.phone
                                         ? t('لا يوجد رقم جوال', 'No phone number')
                                         : !manualUrl
                                           ? t('رقم الجوال غير صالح', 'Invalid phone number')
                                           : '';
                                   return queueLocked ? (
                                     <span className="text-xs text-amber-800">
                                       {t('الإرسال التلقائي مسجل؛ الفتح اليدوي مقفل لمنع التكرار', 'Automatic notice recorded; manual opening locked to prevent duplicates')}
                                     </span>
                                   ) : manualUrl ? (
                                     <Button
                                       asChild
                                       size="sm"
                                       variant="outline"
                                       className="h-8 px-2 text-xs border-green-500 text-green-700 hover:bg-green-50"
                                     >
                                       <a
                                         href={manualUrl}
                                         onClick={(event) => {
                                           if (sendInFlight.current || manualQueueLocked(m)) { event.preventDefault(); return; }
                                           if (wasOpened(m) && !window.confirm(t('فُتحت المحادثة سابقاً فقط، ولا نعرف إن أُرسلت الرسالة. إعادة الفتح؟', 'Previously opened only; sending is unverified. Reopen chat?'))) {
                                             event.preventDefault(); return;
                                           }
                                           const key = manualKey(m);
                                           manualOpened.current.add(key);
                                           try { localStorage.setItem(key, 'opened'); } catch { /* In-memory lock remains. */ }
                                           redrawManual(value => value + 1);
                                         }}
                                         target="_blank"
                                         rel="noopener noreferrer"
                                         title={personalizedMessage}
                                         aria-label={t(`فتح محادثة واتساب لـ ${m.name || ''}`, `Open WhatsApp chat for ${m.name || ''}`)}
                                         data-testid={`manual-whatsapp-${m.member_id || idx}`}
                                       >
                                         <MessageCircle className="w-3.5 h-3.5 me-1" />
                                         {wasOpened(m) ? t('فُتحت فقط — إعادة الفتح', 'Opened only — reopen') : t('فتح واتساب (ليس إرسالاً)', 'Open WhatsApp (not sent)')}
                                       </a>
                                     </Button>
                                   ) : (
                                     <div className="flex items-center gap-1">
                                       <Button
                                         type="button"
                                         size="sm"
                                         variant="outline"
                                         className="h-8 px-2 text-xs"
                                         disabled
                                         title={reason}
                                         aria-label={reason}
                                       >
                                         <MessageCircle className="w-3.5 h-3.5 me-1" />
                                         {t('فتح واتساب', 'Open WhatsApp')}
                                       </Button>
                                       <span className="text-[10px] text-muted-foreground max-w-[120px]">
                                         {reason}
                                       </span>
                                     </div>
                                   );
                                 })()}
                               </div>
                              {isExcluded ? (
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-primary" onClick={toggleExclude}>
                                  {t('استعادة', 'Restore')}
                                </Button>
                              ) : (
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600 hover:bg-red-100 hover:text-red-700" onClick={toggleExclude} title={t('استبعاد', 'Exclude')}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                              </div>
                            </div>
                          );
                            })}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {(previewResult.skipped_members || []).length > 0 && (
                    <div className="border rounded-lg">
                      <button
                        type="button"
                        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/30"
                        onClick={() => setShowSkippedList(v => !v)}
                      >
                        <span className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-orange-600" />
                          {t('المستثنون تلقائياً', 'Auto-skipped')} ({previewResult.skipped_members.length})
                        </span>
                        {showSkippedList ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      {showSkippedList && (
                        <div className="max-h-[200px] overflow-y-auto border-t divide-y">
                          {previewResult.skipped_members.map((s, i) => (
                            <div key={i} className="p-2 text-sm">
                              <p className="font-medium">{s.name || '-'}</p>
                              <p className="text-xs text-orange-700 mt-0.5">
                                {t('السبب:', 'Reason:')} {s.reason || t('لا يوجد تقاطع مع أيام الإغلاق', 'No overlap with closure days')}
                              </p>
                              {s.training_days ? (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {t('أيام التدريب:', 'Training days:')} {s.training_days}
                                  {s.member_time ? ` · ${s.member_time}` : ''}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : null}

              <DialogFooter className="sticky bottom-0 z-20 -mx-6 -mb-6 min-w-0 flex-col gap-2 border-t bg-background px-6 py-4 sm:flex-row">
                <Button variant="outline" onClick={() => setShowPreviewDialog(false)} disabled={sendingWa || applying}>
                  {t('إغلاق', 'Close')}
                </Button>
                {whatsappMode === 'automatic' ? (
                  <Button
                    onClick={handleSendWhatsAppFromPreview}
                    disabled={automaticLocked || previewing || sendingWa || !previewResult || !(previewResult.extended_members || []).some(m => m.phone)}
                    title={automaticLocked ? t('قائمة موجودة بالفعل؛ لن تعاد محاولة الفشل أو النتائج غير المعروفة', 'Already queued; failed or unknown jobs will not be restarted') : ''}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {sendingWa ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <Send className="w-4 h-4 me-1" />}
                    {t('إرسال واتساب للجميع', 'Send WhatsApp to All')}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground text-center sm:text-end flex-1">
                    {t(
                      'استخدم زر "فتح واتساب" بجانب كل عضو لإرسال الرسالة يدوياً.',
                      'Use the “Open WhatsApp” button beside each member to send manually.'
                    )}
                  </p>
                )}
                {!previewClosure?.applied && (
                  <Button
                    onClick={handleConfirmApplyFromPreview}
                    disabled={previewing || applying || !previewResult || !previewResult.extended_count || !previewResult.preview_token || previewIsStale || !previewMatchesSelection}
                    className="bg-primary"
                  >
                    {applying ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <Play className="w-4 h-4 me-1" />}
                    {t('تأكيد الترحيل', 'Confirm Extension')}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {showCreateDialog && (
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CalendarOff className="w-5 h-5" />
                  {t('إضافة فترة إغلاق / توقف', 'Add Closure / Stoppage')}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>{t('العنوان *', 'Title *')}</Label>
                  <Input value={newClosure.title_ar} onChange={(e) => setNewClosure({ ...newClosure, title_ar: e.target.value })} placeholder={t('مثال: إجازة عيد الفطر', 'e.g. Eid Holiday')} />
                </div>
                <div>
                  <Label>{t('السبب', 'Reason')}</Label>
                  <select
                    className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                    value={newClosure.reason}
                    onChange={(e) => setNewClosure({ ...newClosure, reason: e.target.value })}
                  >
                    <option value="holiday">{t('إجازة رسمية', 'Official Holiday')}</option>
                    <option value="maintenance">{t('صيانة', 'Maintenance')}</option>
                    <option value="emergency">{t('طارئ', 'Emergency')}</option>
                    <option value="other">{t('أخرى', 'Other')}</option>
                  </select>
                </div>

                <div>
                  <Label>{t('الفرع', 'Branch')}</Label>
                  <select
                    className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                    value={newClosure.branch_id}
                    onChange={(e) => {
                      const bid = e.target.value;
                      // Keep only selected activities still visible for the new branch
                      // (branch-scoped OR global activities).
                      const visible = new Set(
                        activities
                          .filter(a => bid === 'all' || !a.branch_id || a.branch_id === bid)
                          .map(a => a.id || a._id)
                      );
                      const ids = [];
                      const names = [];
                      (newClosure.activity_ids || []).forEach((aid, i) => {
                        if (visible.has(aid)) {
                          ids.push(aid);
                          names.push((newClosure.activity_names || [])[i]);
                        }
                      });
                      setNewClosure({ ...newClosure, branch_id: bid, activity_ids: ids, activity_names: names });
                    }}
                  >
                    <option value="all">{t('جميع الفروع', 'All Branches')}</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{language === 'ar' ? b.name_ar : b.name}</option>
                    ))}
                  </select>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg space-y-3 border">
                  <Label className="font-bold text-sm">{t('نطاق التوقف', 'Scope')}</Label>
                  <div className="flex gap-3">
                    <Button
                      type="button" size="sm"
                      variant={newClosure.scope === 'all' ? 'default' : 'outline'}
                      onClick={() => setNewClosure({ ...newClosure, scope: 'all', activity_ids: [], activity_names: [] })}
                    >
                      <Users className="w-4 h-4 me-1" />
                      {t('جميع الأنشطة', 'All Activities')}
                    </Button>
                    <Button
                      type="button" size="sm"
                      variant={newClosure.scope === 'specific' ? 'default' : 'outline'}
                      onClick={() => setNewClosure({ ...newClosure, scope: 'specific' })}
                    >
                      {t('أنشطة محددة', 'Specific Activities')}
                    </Button>
                  </div>
                  {newClosure.scope === 'specific' && (
                    <div>
                      <Label className="text-xs">{t('اختر الأنشطة * (يمكن اختيار أكثر من نشاط)', 'Select Activities * (multiple allowed)')}</Label>
                      <div className="mt-2 max-h-48 overflow-y-auto border rounded-md p-2 bg-white space-y-1">
                        {activities.filter(a =>
                          newClosure.branch_id === 'all' || !a.branch_id || a.branch_id === newClosure.branch_id
                        ).map(a => {
                          const aId = a.id || a._id;
                          const aName = a.name_ar || a.name || '';
                          const isSelected = (newClosure.activity_ids || []).includes(aId);
                          return (
                            <label key={aId} className={`flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-slate-50 ${isSelected ? 'bg-blue-50 border border-blue-200' : ''}`}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  const ids = [...(newClosure.activity_ids || [])];
                                  const names = [...(newClosure.activity_names || [])];
                                  if (isSelected) {
                                    const idx = ids.indexOf(aId);
                                    ids.splice(idx, 1);
                                    names.splice(idx, 1);
                                  } else {
                                    ids.push(aId);
                                    names.push(aName);
                                  }
                                  setNewClosure({ ...newClosure, activity_ids: ids, activity_names: names });
                                }}
                                className="w-4 h-4 text-blue-600 rounded"
                              />
                              <span className="text-sm">{aName}</span>
                            </label>
                          );
                        })}
                      </div>
                      {(newClosure.activity_ids || []).length > 0 && (
                        <p className="text-xs text-blue-600 mt-1">
                          {t(`تم اختيار ${newClosure.activity_ids.length} نشاط`, `${newClosure.activity_ids.length} activities selected`)}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="p-3 bg-slate-50 rounded-lg space-y-3 border">
                  <Label className="font-bold text-sm">{t('نوع التوقف', 'Stop Type')}</Label>
                  <div className="flex gap-3 flex-wrap">
                    <Button
                      type="button" size="sm"
                      variant={newClosure.stop_type === 'full_day' ? 'default' : 'outline'}
                      onClick={() => setNewClosure({ ...newClosure, stop_type: 'full_day', stop_hours: 0, affected_times: [] })}
                    >
                      <CalendarDays className="w-4 h-4 me-1" />
                      {t('يوم كامل', 'Full Day')}
                    </Button>
                    <Button
                      type="button" size="sm"
                      variant={newClosure.stop_type === 'specific_times' ? 'default' : 'outline'}
                      onClick={() => setNewClosure({ ...newClosure, stop_type: 'specific_times', stop_hours: 0 })}
                    >
                      <Clock className="w-4 h-4 me-1" />
                      {t('مواعيد محددة', 'Specific Times')}
                    </Button>
                  </div>
                  {newClosure.stop_type === 'specific_times' && (
                    <div>
                      <Label className="text-xs">{t('اختر المواعيد المتأثرة بالتوقف * (من المستويات)', 'Select affected session times * (from levels)')}</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {availableTimes.map(item => {
                          const isSelected = (newClosure.affected_times || []).includes(item.time);
                          return (
                            <button
                              key={item.time}
                              type="button"
                              onClick={() => {
                                const current = [...(newClosure.affected_times || [])];
                                if (isSelected) {
                                  const idx = current.indexOf(item.time);
                                  current.splice(idx, 1);
                                } else {
                                  current.push(item.time);
                                }
                                setNewClosure({ ...newClosure, affected_times: current });
                              }}
                              className={`px-3 py-2 text-sm rounded-lg border-2 transition-all ${isSelected ? 'bg-blue-500 text-white border-blue-500 shadow-md' : 'bg-white hover:bg-slate-50 border-gray-200'}`}
                            >
                              <div className="font-bold">{item.time}</div>
                              <div className={`text-xs ${isSelected ? 'text-blue-100' : 'text-gray-400'}`}>
                                {item.count} {t('لاعب', 'players')}
                              </div>
                            </button>
                          );
                        })}
                        {availableTimes.length === 0 && (
                          <p className="text-xs text-muted-foreground">{t('لا توجد مواعيد في المستويات', 'No times found in levels')}</p>
                        )}
                      </div>
                      {(newClosure.affected_times || []).length > 0 && (
                        <p className="text-xs text-blue-600 mt-2 font-medium">
                          {t(
                            `تم اختيار ${newClosure.affected_times.length} موعد: ${newClosure.affected_times.join('، ')}`,
                            `${newClosure.affected_times.length} times selected: ${newClosure.affected_times.join(', ')}`
                          )}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('سيتم ترحيل فقط المشتركين الذين مواعيدهم في الأوقات المختارة', 'Only members with sessions at selected times will be extended')}
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t('من تاريخ *', 'From *')}</Label>
                    <Input type="date" value={newClosure.start_date} onChange={(e) => setNewClosure({ ...newClosure, start_date: e.target.value })} />
                  </div>
                  <div>
                    <Label>{t('إلى تاريخ *', 'To *')}</Label>
                    <Input type="date" value={newClosure.end_date} onChange={(e) => setNewClosure({ ...newClosure, end_date: e.target.value })} />
                  </div>
                </div>
                {newClosure.start_date && newClosure.end_date && (
                  <div className="p-3 bg-blue-50 rounded-lg text-center space-y-1">
                    <div className="text-sm text-muted-foreground">
                      {t('فترة التوقف:', 'Stop period:')} {calcDays(newClosure.start_date, newClosure.end_date)} {t('يوم', 'days')}
                      {newClosure.stop_type === 'partial' && newClosure.stop_hours > 0 && (
                        <span className="ms-1">× {newClosure.stop_hours} {t('ساعات/يوم', 'hrs/day')}</span>
                      )}
                    </div>
                    <div>
                      <span className="text-2xl font-bold text-blue-700">{calcExtensionDays()}</span>
                      <span className="text-sm text-blue-600 ms-2">{t('يوم ترحيل', 'extension days')}</span>
                    </div>
                  </div>
                )}
                <div>
                  <Label>{t('ملاحظات', 'Notes')}</Label>
                  <textarea
                    className="w-full min-h-[60px] border rounded-md px-3 py-2 text-sm bg-white"
                    value={newClosure.notes}
                    onChange={(e) => setNewClosure({ ...newClosure, notes: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>{t('إلغاء', 'Cancel')}</Button>
                <Button onClick={handleCreateClosure} disabled={saving}>
                  {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {t('حفظ', 'Save')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {showManualDialog && (
          <Dialog open={showManualDialog} onOpenChange={setShowManualDialog}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  {t('ترحيل يدوي لعضو', 'Manual Extension for Member')}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>{t('اختر العضو *', 'Select Member *')}</Label>
                  <select
                    className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                    value={manualExt.member_id || ''}
                    onChange={(e) => setManualExt({ ...manualExt, member_id: e.target.value })}
                  >
                    <option value="">{t('-- اختر --', '-- Select --')}</option>
                    {members.filter(m => m.status === 'active').map(m => (
                      <option key={m.id || m._id} value={m.id || m._id}>{m.name_ar || m.name || ''} - {m.phone || ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>{t('النشاط (اختياري)', 'Activity (optional)')}</Label>
                  <select
                    className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                    value={manualExt.activity_id || 'all'}
                    onChange={(e) => setManualExt({ ...manualExt, activity_id: e.target.value === 'all' ? '' : e.target.value })}
                  >
                    <option value="all">{t('جميع الأنشطة', 'All Activities')}</option>
                    {activities.map(a => (
                      <option key={a.id || a._id} value={a.id || a._id}>{a.name_ar || a.name || ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>{t('عدد الأيام *', 'Number of Days *')}</Label>
                  <Input type="number" min="1" value={manualExt.days} onChange={(e) => setManualExt({ ...manualExt, days: parseInt(e.target.value) || 1 })} />
                </div>
                <div>
                  <Label>{t('السبب *', 'Reason *')}</Label>
                  <Input value={manualExt.reason} onChange={(e) => setManualExt({ ...manualExt, reason: e.target.value })} placeholder={t('مثال: إصابة / سفر', 'e.g. Injury / Travel')} />
                </div>
                {manualExt.member_id && manualExt.days > 0 && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm text-green-800">
                      {manualExt.activity_id ? t(
                        `سيتم تمديد اشتراك النشاط المحدد بـ ${manualExt.days} أيام`,
                        `Selected activity subscription extended by ${manualExt.days} days`
                      ) : t(
                        `سيتم تمديد جميع الاشتراكات النشطة بـ ${manualExt.days} أيام`,
                        `All active subscriptions extended by ${manualExt.days} days`
                      )}
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowManualDialog(false)}>{t('إلغاء', 'Cancel')}</Button>
                <Button onClick={handleManualExtension} disabled={saving} className="bg-green-600 hover:bg-green-700">
                  {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {t('ترحيل', 'Extend')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {showResultDialog && applyResult && (
          <Dialog open={showResultDialog} onOpenChange={setShowResultDialog}>
            <DialogContent className="w-[calc(100vw-1rem)] min-w-0 max-w-2xl max-h-[calc(100dvh-1rem)] overflow-x-hidden overflow-y-auto [&>*]:min-w-0">
              <DialogHeader>
                <DialogTitle className="text-center">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
                  <div className="text-xl">{t('تم الترحيل بنجاح', 'Extension Applied Successfully')}</div>
                </DialogTitle>
              </DialogHeader>
              <div className="min-w-0 space-y-4">
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-center">
                  <p className="text-lg font-bold text-green-800">
                    {t(`${applyResult.closureTitle}`, applyResult.closureTitle)}
                  </p>
                  <p className="text-green-700 mt-1">
                    {t(
                      `تم تطبيق التعويض لـ ${applyResult.extended_count} مشترك حسب أيام التدريب الفعلية`,
                      `Compensation applied to ${applyResult.extended_count} members according to their actual training days`
                    )}
                  </p>
                </div>

                {applyResult.extended_members.length > 0 && (
                  <div>
                    <h3 className="font-bold mb-2 text-base">
                      <Users className="w-5 h-5 inline me-1" />
                      {t('المشتركين المتأثرين', 'Affected Members')} ({applyResult.extended_count})
                    </h3>
                    <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg border">
                      <table className="min-w-[680px] w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="p-2 text-right">#</th>
                            <th className="p-2 text-right">{t('الاسم', 'Name')}</th>
                            <th className="p-2 text-right">{t('النشاط', 'Activity')}</th>
                            <th className="p-2 text-right">{t('أيام التدريب', 'Training Days')}</th>
                            <th className="p-2 text-right">{t('حصص فائتة', 'Missed')}</th>
                            <th className="p-2 text-right">{t('قبل', 'Before')}</th>
                            <th className="p-2 text-right">{t('بعد', 'After')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {applyResult.extended_members.map((m, idx) => (
                            m.details && m.details.length > 0 ? m.details.map((d, dIdx) => (
                              <tr key={`${idx}-${dIdx}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                {dIdx === 0 && (
                                  <>
                                    <td className="p-2 border-t" rowSpan={m.details.length}>{idx + 1}</td>
                                    <td className="p-2 border-t font-medium" rowSpan={m.details.length}>
                                      {m.name}
                                      {m.phone && <div className="text-xs text-gray-500">{m.phone}</div>}
                                    </td>
                                  </>
                                )}
                                <td className="p-2 border-t text-xs">{d.activity || '-'}</td>
                                <td className="p-2 border-t text-xs text-blue-600">{d.training_days || '-'}</td>
                                <td className="p-2 border-t text-xs font-bold text-orange-600">{d.missed_sessions || 0}</td>
                                <td className="p-2 border-t text-red-600 text-xs">{d.old_end}</td>
                                <td className="p-2 border-t text-green-600 text-xs font-medium">{d.new_end}</td>
                              </tr>
                            )) : (
                              <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="p-2 border-t">{idx + 1}</td>
                                <td className="p-2 border-t font-medium">{m.name}</td>
                                <td className="p-2 border-t">-</td>
                                <td className="p-2 border-t">-</td>
                                <td className="p-2 border-t">-</td>
                                <td className="p-2 border-t">-</td>
                                <td className="p-2 border-t">-</td>
                              </tr>
                            )
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {applyResult.skipped_members && applyResult.skipped_members.length > 0 && (
                  <div>
                    <h3 className="font-bold mb-2 text-sm text-gray-600">
                      {t(`مشتركين لم يتأثروا (${applyResult.skipped_count}) - أيام تدريبهم لا تتقاطع مع الإغلاق`,
                         `Unaffected members (${applyResult.skipped_count}) - training days don't overlap with closure`)}
                    </h3>
                    <div className="flex flex-wrap gap-1">
                      {applyResult.skipped_members.map((s, i) => (
                        <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                          {s.name} {s.member_time ? `(${s.member_time})` : s.training_days ? `(${s.training_days})` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {applyResult.extended_count === 0 && (!applyResult.skipped_members || applyResult.skipped_members.length === 0) && (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-center">
                    <p className="text-yellow-800">{t('لم يتأثر أي مشترك بهذا الترحيل', 'No members were affected by this extension')}</p>
                  </div>
                )}
              </div>
               <DialogFooter className="sticky bottom-0 z-20 -mx-6 -mb-6 border-t bg-background px-6 py-4">
                <Button onClick={() => setShowResultDialog(false)} className="bg-orange-500 hover:bg-orange-600">
                  {t('إغلاق', 'Close')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </Layout>
  );
}