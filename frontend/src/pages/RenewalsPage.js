import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { notificationsAPI, invoicesAPI, membersAPI, branchesAPI, whatsappAPI, discountsAPI } from '../services/api';
import { calcEndDate } from './invoices/hooks/useInvoiceForm';
import MemberAvatar from '../components/MemberAvatar';
import { toast } from 'sonner';
import {
  RefreshCcw,
  Search,
  Bell,
  AlertTriangle,
  Clock,
  Calendar,
  Phone,
  Loader2,
  MessageCircle,
  Filter,
  X,
  CheckSquare,
  Square,
  Activity,
  History,
} from 'lucide-react';

const extractSessionsPerWeek = (name) => {
  const m = (name || '').match(/(\d+)\s*(?:ايام|أيام|يوم|ساعات|ساعة|ساعه)/);
  return m ? parseInt(m[1], 10) : 0;
};

// Extract the canonical Arabic weekday names out of a schedule string so the
// renewal end-date can snap to a real training day (mirrors the subscription form).
const RENEWAL_DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const RENEWAL_DAY_VARIANTS = {
  'الأحد': ['الأحد', 'الاحد'],
  'الإثنين': ['الإثنين', 'الاثنين'],
  'الثلاثاء': ['الثلاثاء'],
  'الأربعاء': ['الأربعاء', 'الاربعاء'],
  'الخميس': ['الخميس'],
  'الجمعة': ['الجمعة'],
  'السبت': ['السبت'],
};
const parseScheduleDays = (schedule) => {
  if (!schedule || typeof schedule !== 'string') return [];
  return RENEWAL_DAY_NAMES.filter(canon => RENEWAL_DAY_VARIANTS[canon].some(v => schedule.includes(v)));
};

const formatRemainingSessions = (daysRemaining, activityName, language) => {
  const sessionsPerWeek = extractSessionsPerWeek(activityName);
  if (!sessionsPerWeek || daysRemaining <= 0) {
    return language === 'ar'
      ? `${Math.max(0, daysRemaining)} حصة متبقية`
      : `${Math.max(0, daysRemaining)} sessions remaining`;
  }
  const sessions = Math.max(1, Math.ceil((daysRemaining * sessionsPerWeek) / 7));
  if (language === 'ar') {
    if (sessions === 1) return 'حصة واحدة متبقية';
    if (sessions === 2) return 'حصتان متبقيتان';
    if (sessions >= 3 && sessions <= 10) return `${sessions} حصص متبقية`;
    return `${sessions} حصة متبقية`;
  }
  return `${sessions} session${sessions === 1 ? '' : 's'} remaining`;
};

const _renewalsCache = {
  key: null,
  expiring: null,
  expired: null,
  branches: null,
  ts: 0,
};
const _cacheKey = (days, branchId) => `${days || ''}::${branchId || 'all'}`;

const RenewalsPage = () => {
  const { t, language } = useLanguage();
  const { selectedBranchId } = useAuth();
  const navigate = useNavigate();

  const _initialKey = _cacheKey('7', selectedBranchId);
  const _hasCache = _renewalsCache.key === _initialKey && Array.isArray(_renewalsCache.expiring);

  const [loading, setLoading] = useState(!_hasCache);
  const [expiringList, setExpiringList] = useState(_hasCache ? _renewalsCache.expiring : []);
  const [expiredList, setExpiredList] = useState(_hasCache ? _renewalsCache.expired : []);
  const [searchTerm, setSearchTerm] = useState('');
  const [days, setDays] = useState('7');
  const [activeTab, setActiveTab] = useState('expiring');
  const [filterActivity, setFilterActivity] = useState('all');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [branches, setBranches] = useState(_hasCache && Array.isArray(_renewalsCache.branches) ? _renewalsCache.branches : []);

  const [isRenewalDialogOpen, setIsRenewalDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [saving, setSaving] = useState(false);
  const [renewalForm, setRenewalForm] = useState({
    start_date: '',
    end_date: '',
    weeks: 4,
    training_days: [],
    fee: 0,
    notes: '',
    payment_method: 'card'
  });
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  // Multi-select state
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [bulkActing, setBulkActing] = useState(false);

  // Last-reminder map: { "memberId|activityName": { last_sent, channels } }
  const [lastReminders, setLastReminders] = useState({});
  // WhatsApp settings (manual template)
  const [waTemplate, setWaTemplate] = useState(
    'السلام عليكم {name}،\nنود تذكيركم بأن اشتراك ({activity}) في شركة اداء الابطال العالمية للرياضة قارب على الانتهاء بتاريخ {end_date}.\nنرجو التواصل معنا للتجديد.\nشكراً لكم 🏆'
  );

  useEffect(() => {
    loadData();
  }, [days, selectedBranchId]);

  // Auto-prune selections when filters/tabs change so the bulk action count
  // never reflects items that are no longer visible.
  useEffect(() => {
    const visibleKeys = new Set(
      [...expiringList, ...expiredList].map(it =>
        `${it.member_id}|${it.activity_name || ''}|${it.end_date || ''}`
      )
    );
    setSelectedKeys(prev => {
      const pruned = new Set();
      let changed = false;
      prev.forEach(k => {
        if (visibleKeys.has(k)) pruned.add(k);
        else changed = true;
      });
      return changed ? pruned : prev;
    });
  }, [expiringList, expiredList]);

  useEffect(() => {
    // One-time template load. Uses the renewals-scoped endpoint so users
    // with `renewals` permission (but no `whatsapp` permission) can still
    // load the manual reminder template without a 403.
    (async () => {
      try {
        const res = await whatsappAPI.getReminderTemplate().catch(() => ({ data: {} }));
        const tpl = res.data?.manual_reminder_template;
        if (tpl) setWaTemplate(tpl);
      } catch (e) {
        // Non-fatal
      }
    })();
  }, []);

  const reloadLastReminders = async (visibleItems) => {
    try {
      // Prefer the filtered POST endpoint so the server only aggregates the
      // (member, activity) pairs currently shown on the Renewals page.
      // Falls back to the legacy GET if filtered fetch fails.
      let data = [];
      const list = Array.isArray(visibleItems) ? visibleItems : null;
      if (list && list.length) {
        const pairs = list.map(it => ({
          member_id: it.member_id,
          activity_name: it.activity_name || '',
        }));
        try {
          const res = await whatsappAPI.getLastRemindersFiltered(pairs);
          data = res.data || [];
        } catch {
          const res = await whatsappAPI.getLastReminders();
          data = res.data || [];
        }
      } else if (list && list.length === 0) {
        data = [];
      } else {
        const res = await whatsappAPI.getLastReminders();
        data = res.data || [];
      }
      const map = {};
      data.forEach(r => {
        if (!r.member_id) return;
        const key = `${r.member_id}|${r.activity_name || ''}`;
        map[key] = {
          last_sent: r.last_sent,
          last_channel: r.last_channel || null,
          channels: r.channels || [],
          manual: r.manual,
        };
      });
      setLastReminders(map);
    } catch {}
  };

  const loadData = async () => {
    const key = _cacheKey(days, selectedBranchId);
    const cacheHit = _renewalsCache.key === key && Array.isArray(_renewalsCache.expiring);
    if (cacheHit) {
      setExpiringList(_renewalsCache.expiring);
      setExpiredList(_renewalsCache.expired);
      if (Array.isArray(_renewalsCache.branches)) setBranches(_renewalsCache.branches);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const params = { days: parseInt(days) };
      if (selectedBranchId && selectedBranchId !== 'all') {
        params.branch_filter = selectedBranchId;
      }
      const [res, branchRes] = await Promise.all([
        notificationsAPI.getExpiringSubscriptions(params),
        branchesAPI.getAll()
      ]);
      const allItems = res.data || [];
      const branchesData = branchRes.data || [];
      setBranches(branchesData);

      const expiring = allItems.filter(item => item.days_remaining >= 0);
      const expired = allItems.filter(item => item.days_remaining < 0);

      setExpiringList(expiring);
      setExpiredList(expired);

      _renewalsCache.key = key;
      _renewalsCache.expiring = expiring;
      _renewalsCache.expired = expired;
      _renewalsCache.branches = branchesData;
      _renewalsCache.ts = Date.now();

      reloadLastReminders([...expiring, ...expired]);
      try {
        const tplRes = await whatsappAPI.getReminderTemplate();
        const tpl = tplRes?.data?.manual_reminder_template;
        if (tpl) setWaTemplate(tpl);
      } catch {}
    } catch (error) {
      console.error('Failed to load renewals data:', error);
      if (!cacheHit) {
        toast.error(language === 'ar' ? 'حدث خطأ في تحميل البيانات' : 'Failed to load data');
      }
    } finally {
      setLoading(false);
    }
  };

  const groupByBranch = (items) => {
    const groups = {};
    items.forEach(item => {
      const bid = item.branch_id || '__none__';
      if (!groups[bid]) groups[bid] = [];
      groups[bid].push(item);
    });
    return groups;
  };

  const getBranchName = (branchId) => {
    if (!branchId || branchId === '__none__') return language === 'ar' ? 'غير محدد' : 'Unknown Branch';
    const branch = branches.find(b => b.id === branchId);
    return branch ? branch.name : (language === 'ar' ? 'فرع غير معروف' : 'Unknown Branch');
  };

  const getBranchColor = (index) => {
    const colors = [
      'bg-blue-50 border-blue-200 text-blue-800',
      'bg-green-50 border-green-200 text-green-800',
      'bg-purple-50 border-purple-200 text-purple-800',
      'bg-orange-50 border-orange-200 text-orange-800',
      'bg-rose-50 border-rose-200 text-rose-800',
    ];
    return colors[index % colors.length];
  };

  const filterItems = (items) => {
    let filtered = [...items];
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(item =>
        (item.member_name || '').toLowerCase().includes(term) ||
        (item.member_code || '').toLowerCase().includes(term) ||
        (item.phone || '').includes(term)
      );
    }
    if (filterActivity !== 'all') {
      filtered = filtered.filter(item => {
        const name = (item.activity_name || '').toLowerCase();
        const filter = filterActivity.toLowerCase();
        if (filter === 'سباحة') return name.includes('سباح') || name.includes('swimming');
        if (filter === 'كرة قدم') return name.includes('كرة') || name.includes('قدم') || name.includes('football');
        if (filter === 'كاراتيه') return name.includes('كارات') || name.includes('karate');
        return name === filter;
      });
    }
    if (endDateFilter) {
      filtered = filtered.filter(item => (item.end_date || '') === endDateFilter);
    }
    if (activeTab === 'expired') {
      filtered.sort((a, b) => b.days_remaining - a.days_remaining);
    } else {
      filtered.sort((a, b) => a.days_remaining - b.days_remaining);
    }
    return filtered;
  };

  const ACTIVITY_CATEGORIES = [
    { value: 'كرة قدم', label: '⚽ كرة القدم', icon: '⚽' },
    { value: 'سباحة', label: '🏊 السباحة', icon: '🏊' },
    { value: 'كاراتيه', label: '🥋 كاراتيه', icon: '🥋' },
  ];

  const allActivities = [...new Set([...expiringList, ...expiredList].map(i => i.activity_name).filter(Boolean))];

  const getActivityCategory = (name) => {
    if (!name) return null;
    const n = name.toLowerCase();
    if (n.includes('سباح') || n.includes('swimming')) return 'سباحة';
    if (n.includes('كرة') || n.includes('قدم') || n.includes('football')) return 'كرة قدم';
    if (n.includes('كارات') || n.includes('karate')) return 'كاراتيه';
    return null;
  };

  const uncategorizedActivities = allActivities.filter(a => !getActivityCategory(a));

  const getActivityBreakdown = (items) => {
    const counts = {};
    items.forEach(item => {
      const name = item.activity_name || '---';
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => `${name}: ${count}`).join('، ');
  };

  // Urgency thresholds (spec): 0=red, 1–3=orange, 4–7=yellow, 8+=neutral.
  // Already-expired keeps the existing red treatment.
  const getCardBorderColor = (daysRemaining) => {
    if (daysRemaining < 0) return 'border-s-red-500 bg-red-50/30';
    if (daysRemaining === 0) return 'border-s-red-500 bg-red-50/20';
    if (daysRemaining >= 1 && daysRemaining <= 3) return 'border-s-orange-500 bg-orange-50/20';
    if (daysRemaining >= 4 && daysRemaining <= 7) return 'border-s-yellow-500';
    return 'border-s-gray-300';
  };

  // ── Selection helpers ──
  const getKey = (item) => `${item.member_id}|${item.activity_name || ''}|${item.end_date || ''}`;
  const toggleSelect = (item) => {
    const k = getKey(item);
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const selectAllVisible = (items) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      items.forEach(it => next.add(getKey(it)));
      return next;
    });
  };
  const clearSelection = () => setSelectedKeys(new Set());

  // Pull selected items out of the current visible list
  const getSelectedItems = (visible) => visible.filter(it => selectedKeys.has(getKey(it)));

  // Build manual reminder text using the editable WhatsApp template.
  // A branch-specific manual template (if set on the member's branch) overrides
  // the global template; otherwise fall back to the shared global text.
  const buildReminderText = (item) => {
    const endRaw = item.end_date || '';
    const endFmt = endRaw.replace(/-/g, '/');
    const feeNum = Number(item.fee ?? 0) || 0;
    const feeStr = Number.isInteger(feeNum) ? String(feeNum) : feeNum.toFixed(2);
    const branch = (branches || []).find(b => b.id === item.branch_id);
    const branchTpl = (branch?.whatsapp_manual_template || '').trim();
    return (branchTpl || waTemplate || '')
      .replace(/\{name\}/g, item.member_name || '')
      .replace(/\{activity\}/g, item.activity_name || '')
      .replace(/\{days\}/g, String(item.days_remaining ?? 0))
      .replace(/\{end_date\}/g, endFmt)
      .replace(/\{fee\}/g, feeStr);
  };

  // Format the last-attendance date for the likelihood tooltip ("YYYY-MM-DD"
  // or the localized "never attended" string).
  const formatAttendanceDate = (item) => {
    const last = item.last_attendance_date;
    if (!last) return language === 'ar' ? 'لم يحضر مطلقاً' : 'Never attended';
    const d = new Date(last);
    if (isNaN(d.getTime())) return language === 'ar' ? 'لم يحضر مطلقاً' : 'Never attended';
    return d.toISOString().slice(0, 10);
  };

  // Likelihood-of-renewal badge based on last attendance recency.
  // Tooltip text includes the actual last-attendance date (or "never attended").
  const getLikelihood = (item) => {
    const dateLabel = formatAttendanceDate(item);
    const tooltip = language === 'ar'
      ? `آخر حضور: ${dateLabel}`
      : `Last attendance: ${dateLabel}`;
    const last = item.last_attendance_date;
    if (!last) return { label: language === 'ar' ? 'منخفض' : 'Low', cls: 'bg-red-100 text-red-700 border-red-300', dot: '🔴', tooltip };
    const lastD = new Date(last);
    if (isNaN(lastD.getTime())) return { label: language === 'ar' ? 'منخفض' : 'Low', cls: 'bg-red-100 text-red-700 border-red-300', dot: '🔴', tooltip };
    const diffDays = Math.floor((Date.now() - lastD.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 7) return { label: language === 'ar' ? 'مرتفع' : 'High', cls: 'bg-green-100 text-green-700 border-green-300', dot: '🟢', tooltip };
    if (diffDays <= 13) return { label: language === 'ar' ? 'متوسط' : 'Medium', cls: 'bg-yellow-100 text-yellow-700 border-yellow-300', dot: '🟡', tooltip };
    return { label: language === 'ar' ? 'منخفض' : 'Low', cls: 'bg-red-100 text-red-700 border-red-300', dot: '🔴', tooltip };
  };

  // "Last reminder: X days ago" — returns null if never sent
  const getLastReminderInfo = (item) => {
    const key = `${item.member_id}|${item.activity_name || ''}`;
    const rec = lastReminders[key];
    if (!rec || !rec.last_sent) return null;
    const sentAt = new Date(rec.last_sent);
    if (isNaN(sentAt.getTime())) return null;
    const diff = Math.floor((Date.now() - sentAt.getTime()) / (1000 * 60 * 60 * 24));
    return {
      diff,
      channels: rec.channels || [],
      last_channel: rec.last_channel || null,
    };
  };

  // Open one WhatsApp chat (per-card "Remind" button)
  const handleSingleRemind = async (item) => {
    if (!item.phone) {
      toast.error(language === 'ar' ? 'لا يوجد رقم جوال' : 'No phone number');
      return;
    }
    const msg = buildReminderText(item);
    const url = `https://wa.me/966${item.phone.replace(/^0/, '')}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
    // Log only — do NOT trigger backend dispatch (would double-send when WA is connected)
    try {
      await whatsappAPI.sendBulkReminders([{
        member_id: item.member_id,
        activity_name: item.activity_name || '',
        end_date: item.end_date || '',
        days_remaining: item.days_remaining,
        fee: item.fee ?? null,
      }], { logOnly: true });
      reloadLastReminders([...expiringList, ...expiredList]);
    } catch (e) {
      // Already opened the chat; silent on log failure
    }
  };

  // Send reminders to selected (or all visible) members.
  // Posts to backend (logs + push + portal + WhatsApp if connected) and also
  // opens chat windows as a fallback to ensure something happens locally.
  const handleBulkSendReminder = async () => {
    const visible = filterItems(activeTab === 'expiring' ? expiringList : expiredList);
    const target = selectedKeys.size > 0 ? getSelectedItems(visible) : visible;
    if (target.length === 0) {
      toast.info(language === 'ar' ? 'لا توجد اشتراكات للتذكير' : 'No subscriptions to remind');
      return;
    }
    setBulkActing(true);
    try {
      const payload = target.map(it => ({
        member_id: it.member_id,
        activity_name: it.activity_name || '',
        end_date: it.end_date || '',
        days_remaining: it.days_remaining,
        fee: it.fee ?? null,
      }));
      const res = await whatsappAPI.sendBulkReminders(payload);
      const data = res.data || {};
      const parts = [];
      if (data.wa_sent) parts.push(`${data.wa_sent} ${language === 'ar' ? 'واتساب' : 'WhatsApp'}`);
      if (data.push_sent) parts.push(`${data.push_sent} ${language === 'ar' ? 'إشعار' : 'push'}`);
      if (data.portal_inserted) parts.push(`${data.portal_inserted} ${language === 'ar' ? 'بوابة' : 'portal'}`);
      if (parts.length) {
        toast.success(language === 'ar' ? `تم إرسال التذكيرات: ${parts.join('، ')}` : `Reminders sent: ${parts.join(', ')}`);
      }
      // Fallback: if WhatsApp wasn't connected, open chat windows manually
      if (!data.wa_connected) {
        const phoneSeen = new Set();
        let opened = 0;
        target.forEach((it, idx) => {
          if (!it.phone || phoneSeen.has(it.phone)) return;
          phoneSeen.add(it.phone);
          const sameMember = target.filter(x => x.phone === it.phone);
          const activitiesText = sameMember.map(x => x.activity_name).join('، ');
          const msg = buildReminderText({ ...it, activity_name: activitiesText });
          const url = `https://wa.me/966${it.phone.replace(/^0/, '')}?text=${encodeURIComponent(msg)}`;
          setTimeout(() => window.open(url, '_blank'), opened * 400);
          opened++;
        });
        if (opened) toast.success(language === 'ar' ? `تم فتح ${opened} محادثة واتساب` : `Opened ${opened} WhatsApp chats`);
      }
      clearSelection();
      await reloadLastReminders([...expiringList, ...expiredList]);
    } catch (e) {
      console.error('Bulk reminder failed', e);
      toast.error(language === 'ar' ? 'فشل إرسال التذكيرات' : 'Failed to send reminders');
    } finally {
      setBulkActing(false);
    }
  };

  // Bulk renew: confirms then renews each selected item with default 1-month period
  const handleBulkRenew = async () => {
    const visible = filterItems(activeTab === 'expiring' ? expiringList : expiredList);
    const target = getSelectedItems(visible);
    if (target.length === 0) {
      toast.info(language === 'ar' ? 'حدد اشتراكات للتجديد أولاً' : 'Select subscriptions to renew first');
      return;
    }
    const ok = window.confirm(
      language === 'ar'
        ? `سيتم تجديد ${target.length} اشتراك لمدة شهر واحد بالقيمة الحالية لكل اشتراك. هل تريد المتابعة؟`
        : `${target.length} subscriptions will be renewed for 1 month using each subscription's current fee. Continue?`
    );
    if (!ok) return;
    setBulkActing(true);
    let success = 0;
    let failed = 0;
    for (const item of target) {
      try {
        const endDate = new Date(item.end_date);
        const newStart = new Date(endDate);
        newStart.setDate(newStart.getDate() + 1);
        const newEnd = new Date(newStart);
        newEnd.setMonth(newEnd.getMonth() + 1);
        const fee = parseFloat(item.fee || 0);
        const vat = Math.round(fee * 0.15 * 100) / 100;
        const total = Math.round((fee + vat) * 100) / 100;
        const invoiceData = {
          member_id: item.member_id,
          customer_name_ar: item.member_name,
          customer_name: item.member_name,
          customer_phone: item.phone,
          items: [{
            activity_id: item.activity_id || '',
            activity_name: item.activity_name,
            fee,
            period: `${newStart.toISOString().split('T')[0]} - ${newEnd.toISOString().split('T')[0]}`,
            start_date: newStart.toISOString().split('T')[0],
            end_date: newEnd.toISOString().split('T')[0],
            schedule: item.schedule || '',
            is_product: false,
          }],
          subtotal: fee, vat, total, discount: 0,
          status: 'paid', payment_method: 'card',
          notes: language === 'ar' ? `تجديد جماعي - ${item.activity_name}` : `Bulk renewal - ${item.activity_name}`,
        };
        const invRes = await invoicesAPI.create(invoiceData);
        await membersAPI.updateActivity(item.member_id, item.activity_id, {
          activity_id: item.activity_id || '',
          activity_name: item.activity_name,
          start_date: newStart.toISOString().split('T')[0],
          end_date: newEnd.toISOString().split('T')[0],
          fee,
          status: 'active',
          schedule: item.schedule || '',
          training_days: item.training_days || [],
          training_time: item.training_time || '',
          day_times: item.day_times || {},
          level_id: item.level_id || '',
          coach_id: item.coach_id || '',
          invoice_id: invRes.data?.id,
          renewed_from: item.end_date,
        });
        success++;
      } catch (e) {
        console.error('Bulk renew failed for', item.member_name, e);
        failed++;
      }
    }
    setBulkActing(false);
    if (success) toast.success(language === 'ar' ? `تم تجديد ${success} اشتراك` : `${success} subscriptions renewed`);
    if (failed) toast.error(language === 'ar' ? `فشل تجديد ${failed} اشتراك` : `${failed} renewals failed`);
    clearSelection();
    loadData();
  };

  const openRenewalDialog = (item) => {
    const endDate = new Date(item.end_date);
    const newStartDate = new Date(endDate);
    newStartDate.setDate(newStartDate.getDate() + 1);
    const startStr = newStartDate.toISOString().split('T')[0];

    // Mirror the subscription: pick a number of weeks and snap the end date onto a
    // real training day derived from the member's existing schedule.
    const weeks = 4;
    const trainingDays = parseScheduleDays(item.schedule);
    const endStr = calcEndDate(startStr, weeks, trainingDays);

    setSelectedItem(item);
    setRenewalForm({
      start_date: startStr,
      end_date: endStr,
      weeks,
      training_days: trainingDays,
      fee: item.fee || 0,
      notes: '',
      payment_method: 'card'
    });
    setCouponCode('');
    setAppliedCoupon(null);
    setCouponDiscount(0);
    setIsRenewalDialogOpen(true);
  };

  const clearCoupon = () => {
    setAppliedCoupon(null);
    setCouponDiscount(0);
  };

  const validateRenewalCoupon = async () => {
    if (!couponCode.trim()) return;
    const subtotal = parseFloat(renewalForm.fee) || 0;
    if (subtotal <= 0) {
      toast.error(language === 'ar' ? 'أدخل الرسوم أولاً' : 'Enter the fee first');
      return;
    }
    setValidatingCoupon(true);
    try {
      const res = await discountsAPI.validate(couponCode, subtotal, selectedItem?.activity_id ? [selectedItem.activity_id] : []);
      setAppliedCoupon(res.data.discount);
      setCouponDiscount(res.data.discount_amount || 0);
      toast.success(language === 'ar' ? 'تم تطبيق كود الخصم' : 'Coupon applied');
    } catch (error) {
      clearCoupon();
      toast.error(error.response?.data?.detail || (language === 'ar' ? 'كوبون غير صالح' : 'Invalid coupon'));
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleRenewal = async () => {
    if (!selectedItem) return;
    setSaving(true);

    try {
      const subtotal = parseFloat(renewalForm.fee);
      const vatAmount = Math.round(subtotal * 0.15 * 100) / 100;
      const discountAmount = Math.round((couponDiscount || 0) * 100) / 100;
      const total = Math.max(Math.round((subtotal + vatAmount - discountAmount) * 100) / 100, 0);

      const invoiceData = {
        member_id: selectedItem.member_id,
        customer_name_ar: selectedItem.member_name,
        customer_name: selectedItem.member_name,
        customer_phone: selectedItem.phone,
        items: [{
          activity_id: selectedItem.activity_id || '',
          activity_name: selectedItem.activity_name,
          fee: parseFloat(renewalForm.fee),
          period: `${renewalForm.start_date} - ${renewalForm.end_date}`,
          start_date: renewalForm.start_date,
          end_date: renewalForm.end_date,
          schedule: selectedItem.schedule || '',
          is_product: false
        }],
        subtotal: subtotal,
        vat: vatAmount,
        total: total,
        discount: discountAmount,
        discount_code: appliedCoupon?.code || null,
        status: 'paid',
        payment_method: renewalForm.payment_method,
        notes: renewalForm.notes || `تجديد اشتراك ${selectedItem.activity_name}`
      };

      const invoiceRes = await invoicesAPI.create(invoiceData);

      const updatedActivity = {
        activity_id: selectedItem.activity_id || '',
        activity_name: selectedItem.activity_name,
        start_date: renewalForm.start_date,
        end_date: renewalForm.end_date,
        fee: parseFloat(renewalForm.fee),
        status: 'active',
        schedule: selectedItem.schedule || '',
        training_days: selectedItem.training_days || [],
        training_time: selectedItem.training_time || '',
        day_times: selectedItem.day_times || {},
        level_id: selectedItem.level_id || '',
        coach_id: selectedItem.coach_id || '',
        invoice_id: invoiceRes.data?.id,
        renewed_from: selectedItem.end_date
      };

      await membersAPI.updateActivity(selectedItem.member_id, selectedItem.activity_id, updatedActivity);

      toast.success(language === 'ar' ? 'تم تجديد الاشتراك بنجاح' : 'Subscription renewed successfully');
      setIsRenewalDialogOpen(false);
      loadData();
    } catch (error) {
      console.error('Failed to renew subscription:', error);
      toast.error(language === 'ar' ? 'حدث خطأ في تجديد الاشتراك' : 'Failed to renew subscription');
    } finally {
      setSaving(false);
    }
  };

  const currentList = activeTab === 'expiring' ? filterItems(expiringList) : activeTab === 'expired' ? filterItems(expiredList) : [];

  // Per-card renderer (shared between grouped-by-branch and flat layouts)
  const renderCard = (item, idx) => {
    const isExpired = item.days_remaining < 0;
    const k = getKey(item);
    const isSelected = selectedKeys.has(k);
    const likelihood = getLikelihood(item);
    const lastInfo = getLastReminderInfo(item);
    // Urgency gradient — spec: 0=red, 1–3=orange, 4–7=yellow, 8+=neutral.
    // Already-expired keeps the existing red treatment.
    const dr = item.days_remaining;
    let gradientCls = '';
    if (isExpired || dr === 0) gradientCls = 'from-red-100/60 via-red-50/30 to-transparent';
    else if (dr >= 1 && dr <= 3) gradientCls = 'from-orange-100/60 via-orange-50/30 to-transparent';
    else if (dr >= 4 && dr <= 7) gradientCls = 'from-yellow-100/60 via-yellow-50/30 to-transparent';
    else gradientCls = 'from-transparent to-transparent';
    const goToMember = () => {
      if (item.member_id) navigate(`/admin/members?focus=${item.member_id}&from=renewals`);
    };
    const stopAndCall = (fn) => (e) => { e.stopPropagation(); fn(e); };
    return (
      <Card
        key={idx}
        onClick={goToMember}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToMember(); } }}
        className={`overflow-hidden border-s-4 ${getCardBorderColor(item.days_remaining)} bg-gradient-to-bl ${gradientCls} ${isSelected ? 'ring-2 ring-primary' : ''} cursor-pointer hover:shadow-md transition-shadow`}
      >
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={stopAndCall(() => toggleSelect(item))}
                className="text-primary hover:text-primary/80 flex-shrink-0"
                aria-label={language === 'ar' ? 'تحديد' : 'Select'}
              >
                {isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
              </button>
              <MemberAvatar
                photo={item.member_photo}
                name={item.member_name}
                size="sm"
                borderClass="border-primary/20"
                bgClass="bg-primary/10"
                textClass="text-primary"
              />
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{item.member_name}</p>
                <p className="text-xs text-muted-foreground">#{item.member_code}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <Badge
                className={
                  isExpired
                    ? 'bg-red-100 text-red-700 border-red-300'
                    : item.days_remaining === 0
                      ? 'bg-red-100 text-red-700 border-red-300'
                      : item.days_remaining >= 1 && item.days_remaining <= 3
                        ? 'bg-orange-100 text-orange-700 border-orange-300'
                        : item.days_remaining >= 4 && item.days_remaining <= 7
                          ? 'bg-yellow-100 text-yellow-700 border-yellow-300'
                          : 'bg-gray-100 text-gray-700 border-gray-300'
                }
              >
                {isExpired
                  ? (language === 'ar' ? 'منتهي' : 'Expired')
                  : item.days_remaining === 0
                    ? (language === 'ar' ? 'ينتهي اليوم' : 'Expires Today')
                    : (language === 'ar' ? 'ينتهي قريباً' : 'Expiring')}
              </Badge>
              <Badge
                className={`${likelihood.cls} text-[10px]`}
                title={likelihood.tooltip}
              >
                <Activity className="w-3 h-3 me-1" />
                {language === 'ar' ? 'احتمال التجديد:' : 'Likelihood:'} {likelihood.label}
              </Badge>
            </div>
          </div>
          <div className="space-y-1.5 text-sm">
            {item.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="w-3.5 h-3.5" />
                <span>{item.phone}</span>
                <a
                  href={`https://wa.me/966${item.phone.replace(/^0/, '')}?text=${encodeURIComponent(buildReminderText(item))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-green-600 hover:text-green-700 p-0.5 rounded hover:bg-green-50 transition-colors"
                  title={language === 'ar' ? 'واتساب' : 'WhatsApp'}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                </a>
              </div>
            )}
            <div className="flex items-center gap-2 text-muted-foreground">
              <RefreshCcw className="w-3.5 h-3.5" />
              <span>{item.activity_name}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="w-3.5 h-3.5" />
              <span>{item.end_date}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" />
              <span className={`font-medium ${isExpired ? 'text-red-600' : item.days_remaining <= 3 ? 'text-orange-600' : 'text-yellow-600'}`}>
                {isExpired
                  ? (language === 'ar' ? `منتهي منذ ${Math.abs(item.days_remaining)} يوم` : `Expired ${Math.abs(item.days_remaining)} days ago`)
                  : formatRemainingSessions(item.days_remaining, item.activity_name, language)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 border-t">
              <Bell className="w-3 h-3" />
              {lastInfo
                ? (
                  <span
                    title={(() => {
                      const lastCh = lastInfo.last_channel;
                      const allCh = lastInfo.channels || [];
                      const otherCh = allCh.filter(c => c && c !== lastCh);
                      if (lastCh) {
                        const base = language === 'ar' ? `آخر قناة: ${lastCh}` : `Last channel: ${lastCh}`;
                        if (otherCh.length) {
                          const list = otherCh.join(language === 'ar' ? '، ' : ', ');
                          return language === 'ar' ? `${base} (سابقاً: ${list})` : `${base} (also: ${list})`;
                        }
                        return base;
                      }
                      if (allCh.length) {
                        return language === 'ar'
                          ? `القنوات: ${allCh.join('، ')}`
                          : `Channels: ${allCh.join(', ')}`;
                      }
                      return language === 'ar' ? 'لا توجد قنوات مسجلة' : 'No channel info';
                    })()}
                    className="cursor-help"
                  >
                    {language === 'ar' ? 'آخر تذكير: ' : 'Last reminder: '}
                    {lastInfo.diff === 0
                      ? (language === 'ar' ? 'اليوم' : 'today')
                      : (language === 'ar' ? `قبل ${lastInfo.diff} يوم` : `${lastInfo.diff}d ago`)}
                  </span>
                )
                : (
                  <span className="italic opacity-70">
                    {language === 'ar' ? 'لم يُرسل تذكير بعد' : 'No reminder sent yet'}
                  </span>
                )}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button size="sm" className="flex-1 bg-orange-500 hover:bg-orange-600 text-white" onClick={stopAndCall(() => openRenewalDialog(item))}>
              <RefreshCcw className="w-3.5 h-3.5 me-1" />
              {language === 'ar' ? 'تجديد' : 'Renew'}
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={stopAndCall(() => handleSingleRemind(item))}>
              <Bell className="w-3.5 h-3.5 me-1" />
              {language === 'ar' ? 'تذكير' : 'Remind'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  const tabs = [
    { key: 'expiring', label: language === 'ar' ? 'تنتهي قريباً' : 'Expiring Soon', count: expiringList.length, breakdown: getActivityBreakdown(expiringList) },
    { key: 'expired', label: language === 'ar' ? 'منتهية' : 'Expired', count: expiredList.length, breakdown: getActivityBreakdown(expiredList) },
    { key: 'frozen', label: language === 'ar' ? 'نقاط مجمدة' : 'Frozen Points', count: 0, breakdown: '' },
  ];

  const stats = [
    { label: language === 'ar' ? 'تنتهي قريباً' : 'Expiring Soon', value: expiringList.length, icon: Clock, color: 'text-orange-500', bg: 'bg-orange-50' },
    { label: language === 'ar' ? 'منتهية' : 'Expired', value: expiredList.length, icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50' },
    { label: language === 'ar' ? 'نقاط مجمدة' : 'Frozen Points', value: 0, icon: RefreshCcw, color: 'text-blue-500', bg: 'bg-blue-50' },
    { label: language === 'ar' ? 'معرضة للإلغاء' : 'Eligible for Cancellation', value: 0, icon: Bell, color: 'text-purple-500', bg: 'bg-purple-50' },
  ];

  return (
    <Layout title={language === 'ar' ? 'إدارة التجديدات' : 'Renewals Management'}>
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((stat, idx) => (
            <Card key={idx}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center`}>
                    <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={language === 'ar' ? 'بحث بالاسم أو الجوال أو رمز العضو...' : 'Search by name, phone, or member code...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="ps-10"
            />
          </div>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 {language === 'ar' ? 'أيام' : 'days'}</SelectItem>
              <SelectItem value="7">7 {language === 'ar' ? 'أيام' : 'days'}</SelectItem>
              <SelectItem value="14">14 {language === 'ar' ? 'يوم' : 'days'}</SelectItem>
              <SelectItem value="30">30 {language === 'ar' ? 'يوم' : 'days'}</SelectItem>
              <SelectItem value="60">60 {language === 'ar' ? 'يوم' : 'days'}</SelectItem>
              <SelectItem value="90">90 {language === 'ar' ? 'يوم' : 'days'}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterActivity} onValueChange={setFilterActivity}>
            <SelectTrigger className="w-[180px]">
              <Filter className="w-3.5 h-3.5 me-1" />
              <SelectValue placeholder={language === 'ar' ? 'كل الأنشطة' : 'All Activities'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{language === 'ar' ? 'كل الأنشطة' : 'All Activities'}</SelectItem>
              {ACTIVITY_CATEGORIES.map(cat => (
                <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
              ))}
              {uncategorizedActivities.map(act => (
                <SelectItem key={act} value={act}>{act}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Calendar className="absolute top-1/2 -translate-y-1/2 start-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="date"
              value={endDateFilter}
              onChange={(e) => setEndDateFilter(e.target.value)}
              title={language === 'ar' ? 'تاريخ الانتهاء' : 'End Date'}
              aria-label={language === 'ar' ? 'تاريخ الانتهاء' : 'End Date'}
              className={`w-[170px] ps-8 ${endDateFilter ? 'pe-8' : ''}`}
            />
            {endDateFilter && (
              <button
                type="button"
                onClick={() => setEndDateFilter('')}
                className="absolute top-1/2 -translate-y-1/2 end-2 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                title={language === 'ar' ? 'مسح التاريخ' : 'Clear date'}
                aria-label={language === 'ar' ? 'مسح التاريخ' : 'Clear date'}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button onClick={loadData} variant="outline" size="icon">
            <RefreshCcw className="w-4 h-4" />
          </Button>
          <Link to="/admin/renewals/history">
            <Button variant="outline" size="sm" title={language === 'ar' ? 'سجل التذكيرات' : 'Reminders log'}>
              <History className="w-4 h-4 me-1" />
              {language === 'ar' ? 'سجل التذكيرات' : 'Reminders log'}
            </Button>
          </Link>
          {/* Bulk reminders are now driven by selecting cards — see the sticky bar below. */}
        </div>

        <div className="flex gap-2 border-b overflow-x-auto items-end justify-between">
          <div className="flex gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                title={tab.breakdown || ''}
              >
                {tab.label} ({tab.count})
                {tab.breakdown && activeTab === tab.key && (
                  <span className="block text-[10px] text-muted-foreground font-normal mt-0.5">{tab.breakdown}</span>
                )}
              </button>
            ))}
          </div>
          {currentList.length > 0 && (activeTab === 'expiring' || activeTab === 'expired') && (
            <div className="flex gap-2 pb-1.5">
              <button
                onClick={() => selectAllVisible(currentList)}
                className="text-xs text-primary hover:underline flex items-center gap-1"
                title={language === 'ar' ? 'تحديد كل المعروض' : 'Select all visible'}
              >
                <CheckSquare className="w-3.5 h-3.5" />
                {language === 'ar' ? 'تحديد الكل' : 'Select all'}
              </button>
              {selectedKeys.size > 0 && (
                <button
                  onClick={clearSelection}
                  className="text-xs text-muted-foreground hover:underline flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  {language === 'ar' ? `إلغاء (${selectedKeys.size})` : `Clear (${selectedKeys.size})`}
                </button>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : currentList.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>{language === 'ar' ? 'لا توجد اشتراكات' : 'No subscriptions found'}</p>
          </div>
        ) : (!selectedBranchId || selectedBranchId === 'all') && branches.length > 0 ? (
          <div className="space-y-8">
            {Object.entries(groupByBranch(currentList)).map(([branchId, items], groupIdx) => (
              <div key={branchId}>
                <div className={`flex items-center gap-3 mb-4 px-4 py-2.5 rounded-xl border ${getBranchColor(groupIdx)}`}>
                  <div className="w-2 h-2 rounded-full bg-current opacity-60" />
                  <h3 className="font-bold text-base">{getBranchName(branchId)}</h3>
                  <span className="text-sm opacity-70 font-medium">({items.length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {items.map((item, idx) => renderCard(item, idx))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {currentList.map((item, idx) => renderCard(item, idx))}
          </div>
        )}

        {/* Add bottom padding so sticky bar doesn't cover last row */}
        {selectedKeys.size > 0 && <div className="h-20" />}
      </div>

      {/* Sticky bulk-action bar */}
      {selectedKeys.size > 0 && (activeTab === 'expiring' || activeTab === 'expired') && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white dark:bg-gray-900 border-t shadow-lg p-3 flex items-center justify-between gap-3">
          <div className="text-sm font-medium">
            {language === 'ar'
              ? `تم تحديد ${selectedKeys.size} اشتراك`
              : `${selectedKeys.size} selected`}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={clearSelection}
              disabled={bulkActing}
              size="sm"
            >
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button
              onClick={handleBulkSendReminder}
              disabled={bulkActing}
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {bulkActing ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <MessageCircle className="w-4 h-4 me-1" />}
              {language === 'ar' ? `تذكير المحددين (${selectedKeys.size})` : `Remind selected (${selectedKeys.size})`}
            </Button>
            <Button
              onClick={handleBulkRenew}
              disabled={bulkActing}
              size="sm"
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {bulkActing ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <RefreshCcw className="w-4 h-4 me-1" />}
              {language === 'ar' ? `تجديد المحددين (${selectedKeys.size})` : `Renew selected (${selectedKeys.size})`}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={isRenewalDialogOpen} onOpenChange={setIsRenewalDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {language === 'ar' ? 'تجديد الاشتراك' : 'Renew Subscription'}
            </DialogTitle>
          </DialogHeader>

          {selectedItem && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
                <p><strong>{language === 'ar' ? 'العضو:' : 'Member:'}</strong> {selectedItem.member_name}</p>
                <p><strong>{language === 'ar' ? 'النشاط:' : 'Activity:'}</strong> {selectedItem.activity_name}</p>
                <p><strong>{language === 'ar' ? 'تاريخ الانتهاء:' : 'End Date:'}</strong> {selectedItem.end_date}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    {language === 'ar' ? 'تاريخ البداية' : 'Start Date'}
                  </label>
                  <Input
                    type="date"
                    value={renewalForm.start_date}
                    onChange={(e) => {
                      const start = e.target.value;
                      const end = start ? calcEndDate(start, renewalForm.weeks || 4, renewalForm.training_days) : renewalForm.end_date;
                      setRenewalForm({ ...renewalForm, start_date: start, end_date: end });
                    }}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 flex items-center gap-2">
                    {language === 'ar' ? 'تاريخ النهاية' : 'End Date'}
                    <span className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                      <input
                        type="number"
                        min="1"
                        max="52"
                        value={renewalForm.weeks || 4}
                        onChange={(e) => {
                          const weeks = parseInt(e.target.value, 10) || 4;
                          const end = renewalForm.start_date ? calcEndDate(renewalForm.start_date, weeks, renewalForm.training_days) : renewalForm.end_date;
                          setRenewalForm({ ...renewalForm, weeks, end_date: end });
                        }}
                        className="w-8 text-xs text-center bg-transparent outline-none font-semibold text-blue-700"
                        title={language === 'ar' ? 'عدد الأسابيع' : 'Weeks'}
                      />
                      <span className="text-xs text-blue-600">{language === 'ar' ? 'أسبوع' : 'wks'}</span>
                    </span>
                  </label>
                  <Input
                    type="date"
                    value={renewalForm.end_date}
                    onChange={(e) => setRenewalForm({ ...renewalForm, end_date: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">
                  {language === 'ar' ? 'الرسوم' : 'Fee'} ({language === 'ar' ? 'ر.س' : 'SAR'})
                </label>
                <Input
                  type="number"
                  value={renewalForm.fee}
                  onChange={(e) => {
                    setRenewalForm({ ...renewalForm, fee: e.target.value });
                    if (appliedCoupon) clearCoupon();
                  }}
                />
              </div>

              <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                <label className="text-sm font-medium mb-1 block text-purple-700">
                  {language === 'ar' ? 'كود الخصم (اختياري)' : 'Discount Coupon (optional)'}
                </label>
                {appliedCoupon ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-purple-800 font-semibold">
                      {appliedCoupon.code} — {couponDiscount.toFixed(2)} {language === 'ar' ? 'ر.س' : 'SAR'} {language === 'ar' ? 'خصم' : 'off'}
                    </span>
                    <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:text-red-700 h-7 px-2"
                      onClick={() => { clearCoupon(); setCouponCode(''); }}>
                      {language === 'ar' ? 'إزالة' : 'Remove'}
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                      placeholder={language === 'ar' ? 'أدخل كود الخصم...' : 'Enter coupon code...'}
                      className="flex-1"
                    />
                    <Button type="button" variant="outline" onClick={validateRenewalCoupon}
                      disabled={!couponCode.trim() || validatingCoupon}
                      className="border-purple-400 text-purple-700 hover:bg-purple-100">
                      {validatingCoupon ? <Loader2 className="w-4 h-4 animate-spin" /> : (language === 'ar' ? 'تطبيق' : 'Apply')}
                    </Button>
                  </div>
                )}
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">
                  {language === 'ar' ? 'طريقة الدفع' : 'Payment Method'}
                </label>
                <Select
                  value={renewalForm.payment_method}
                  onValueChange={(val) => setRenewalForm({ ...renewalForm, payment_method: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{language === 'ar' ? 'نقداً' : 'Cash'}</SelectItem>
                    <SelectItem value="card">{language === 'ar' ? 'بطاقة' : 'Card'}</SelectItem>
                    <SelectItem value="transfer">{language === 'ar' ? 'تحويل' : 'Transfer'}</SelectItem>
                    <SelectItem value="tabby">Tabby</SelectItem>
                    <SelectItem value="tamara">Tamara</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">
                  {language === 'ar' ? 'ملاحظات' : 'Notes'}
                </label>
                <Textarea
                  value={renewalForm.notes}
                  onChange={(e) => setRenewalForm({ ...renewalForm, notes: e.target.value })}
                  placeholder={language === 'ar' ? 'ملاحظات إضافية...' : 'Additional notes...'}
                  rows={2}
                />
              </div>

              {renewalForm.fee > 0 && (
                <div className="p-3 bg-green-50 rounded-lg text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>{language === 'ar' ? 'المبلغ:' : 'Subtotal:'}</span>
                    <span>{parseFloat(renewalForm.fee).toFixed(2)} {language === 'ar' ? 'ر.س' : 'SAR'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{language === 'ar' ? 'الضريبة (15%):' : 'VAT (15%):'}</span>
                    <span>{(parseFloat(renewalForm.fee) * 0.15).toFixed(2)} {language === 'ar' ? 'ر.س' : 'SAR'}</span>
                  </div>
                  {couponDiscount > 0 && (
                    <div className="flex justify-between text-purple-700">
                      <span>{language === 'ar' ? `خصم الكوبون (${appliedCoupon?.code}):` : `Coupon (${appliedCoupon?.code}):`}</span>
                      <span>- {couponDiscount.toFixed(2)} {language === 'ar' ? 'ر.س' : 'SAR'}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t pt-1">
                    <span>{language === 'ar' ? 'الإجمالي:' : 'Total:'}</span>
                    <span>{Math.max(parseFloat(renewalForm.fee) * 1.15 - (couponDiscount || 0), 0).toFixed(2)} {language === 'ar' ? 'ر.س' : 'SAR'}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsRenewalDialogOpen(false)}>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button
              onClick={handleRenewal}
              disabled={saving}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {language === 'ar' ? 'تأكيد التجديد' : 'Confirm Renewal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

export default RenewalsPage;
