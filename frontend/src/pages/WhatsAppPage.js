import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { toast } from 'sonner';
import { whatsappAPI, membersAPI, activitiesAPI, branchesAPI, messagesAPI, pushNotificationsAPI, levelsAPI } from '../services/api';
import {
  MessageSquare, CheckCircle2, XCircle, RefreshCw, Send, Settings, Loader2,
  Wifi, WifiOff, PhoneCall, Bell, Eye, Users, History, Clock, Phone,
  AlertTriangle, Building2, ChevronDown, ChevronUp, Megaphone, Gift,
  Info, Mail, ArrowRight, ArrowLeft, RefreshCcw, User, Filter, Trash2,
  MessageCircle, CheckCircle,
} from 'lucide-react';

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const ampm = i < 12 ? 'ص' : 'م';
  const h = i === 0 ? 12 : i > 12 ? i - 12 : i;
  return { value: i, label: `${h}:00 ${ampm}` };
});

export default function WhatsAppPage() {
  const { language } = useLanguage();
  const { user, selectedBranchId } = useAuth();
  const t = (ar, en) => language === 'ar' ? ar : en;
  const navigate = useNavigate();
  const isRTL = language === 'ar';
  const isAdmin = user?.is_admin === true;

  const [activeTab, setActiveTab] = useState('connection');

  // ── WhatsApp Connection State ──
  const [status, setStatus] = useState({ connected: false, qr: null, connecting: false });
  const [waSettings, setWaSettings] = useState({
    enabled: false, days_before: 3, days_before_2: 1, reminder_2_enabled: true,
    offsets: [
      { days: 7, enabled: true },
      { days: 3, enabled: true },
      { days: 1, enabled: true },
      { days: 0, enabled: true },
    ],
    message_template: 'مرحباً {name}،\nنذكركم بأن اشتراككم في نشاط {activity} سينتهي بعد {days} يوم/أيام.\nيرجى التواصل معنا للتجديد. 🏆',
    templates: {},
    manual_reminder_template: 'السلام عليكم {name}،\nنود تذكيركم بأن اشتراك ({activity}) في شركة اداء الابطال العالمية للرياضة قارب على الانتهاء بتاريخ {end_date}.\nنرجو التواصل معنا للتجديد.\nشكراً لكم 🏆',
    manual_reminder_expired_template: 'السلام عليكم {name}،\nنود إعلامكم بأن اشتراك ({activity}) في شركة اداء الابطال العالمية للرياضة قد انتهى بتاريخ {end_date}.\nنرجو التواصل معنا للتجديد.\nشكراً لكم 🏆',
    welcome_template: 'أهلاً وسهلاً {name} 🎉\nيسعدنا انضمامك إلى شركة اداء الابطال العالمية للرياضة في نشاط ({activity}).\nنتمنى لك تجربة رياضية ممتعة ومفيدة. 🏆',
    send_hour: 9,
    push_enabled: true,
    portal_enabled: true,
    push_title_template: 'تنبيه: اشتراكك ينتهي قريباً 🔔',
    push_body_template: 'اشتراكك في {activity} ينتهي خلال {days} أيام ({end_date})',
  });
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [targetInfo, setTargetInfo] = useState({ count: 0, count_today: 0, target_date: '', count_2: 0, count_today_2: 0, target_date_2: '', reminder_2_enabled: true, loading: false });
  const [sendLogs, setSendLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const intervalRef = useRef(null);

  // ── Manual WhatsApp Messages State ──
  const [members, setMembers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [waMessage, setWaMessage] = useState('');
  const [messageType, setMessageType] = useState('custom');
  const [filterActivities, setFilterActivities] = useState([]);
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterDays, setFilterDays] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [expandedBranches, setExpandedBranches] = useState({});
  const [waQueue, setWaQueue] = useState([]);
  const [waQueueIdx, setWaQueueIdx] = useState(0);

  // ── Portal Notifications State ──
  const [portalNotifications, setPortalNotifications] = useState([]);
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifTarget, setNotifTarget] = useState('all_members');
  const [notifTargetMemberId, setNotifTargetMemberId] = useState('');
  const [notifPriority, setNotifPriority] = useState('info');
  const [notifType, setNotifType] = useState('announcement');
  const [sendingNotif, setSendingNotif] = useState(false);

  // ── Internal Messages State ──
  const [conversations, setConversations] = useState([]);
  const [selectedThread, setSelectedThread] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [threadMember, setThreadMember] = useState(null);
  const [newMsgSubject, setNewMsgSubject] = useState('');
  const [newMsgBody, setNewMsgBody] = useState('');
  const [newMsgRecipient, setNewMsgRecipient] = useState('');
  const [newMsgBroadcast, setNewMsgBroadcast] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [msgUnreadCount, setMsgUnreadCount] = useState(0);
  const [loadingConversations, setLoadingConversations] = useState(false);

  // ── Push Notifications State ──
  const [pushSubscribersCount, setPushSubscribersCount] = useState(0);
  const [pushSending, setPushSending] = useState(false);
  const [pushResult, setPushResult] = useState(null);
  const [pushForm, setPushForm] = useState({ title: '', body: '', url: '/', branch_id: '' });
  const [showPushSubscribers, setShowPushSubscribers] = useState(false);
  const [pushSubscribers, setPushSubscribers] = useState([]);
  const [loadingPushSubscribers, setLoadingPushSubscribers] = useState(false);

  // ── Activity Notification State ──
  const [actNotifActivity, setActNotifActivity] = useState('');
  const [actNotifLevel, setActNotifLevel] = useState('all');
  const [actNotifLevels, setActNotifLevels] = useState([]);
  const [actNotifAllActivities, setActNotifAllActivities] = useState([]);
  const [actNotifLoadingActivities, setActNotifLoadingActivities] = useState(false);
  const [actNotifChannel, setActNotifChannel] = useState('push');
  const [actNotifTitle, setActNotifTitle] = useState('');
  const [actNotifBody, setActNotifBody] = useState('');
  const [actNotifSending, setActNotifSending] = useState(false);
  const [actNotifMemberCount, setActNotifMemberCount] = useState(null);
  const [actNotifPriority, setActNotifPriority] = useState('info');
  const [actNotifMembers, setActNotifMembers] = useState([]);       // full member list with active status
  const [actNotifLoadingMembers, setActNotifLoadingMembers] = useState(false);
  const [actNotifActiveOnly, setActNotifActiveOnly] = useState(true); // filter to active subscribers
  const [actNotifShowList, setActNotifShowList] = useState(false);   // toggle member list visibility
  const [actNotifBranch, setActNotifBranch] = useState('');         // branch filter for activity notif
  const [actNotifWaProgress, setActNotifWaProgress] = useState({ done: 0, total: 0 }); // WhatsApp send progress

  const messageTemplates = {
    payment_reminder: {
      ar: 'السلام عليكم، نود تذكيركم بموعد سداد رسوم الاشتراك في شركة اداء الابطال العالمية للرياضة. نرجو التواصل معنا لمزيد من التفاصيل.',
      en: 'Hello, this is a reminder about your subscription payment at Champions Performance Academy. Please contact us for more details.'
    },
    expiry_alert: {
      ar: 'السلام عليكم، نود إعلامكم بأن اشتراككم سينتهي قريباً. يرجى التواصل معنا لتجديد الاشتراك.',
      en: 'Hello, your subscription is expiring soon. Please contact us to renew.'
    },
    promotion: {
      ar: 'السلام عليكم، نقدم لكم عروضاً خاصة في شركة اداء الابطال العالمية للرياضة. تواصلوا معنا للاستفادة!',
      en: 'Hello, we have special offers at Champions Performance Academy. Contact us to learn more!'
    }
  };

  // ── Load functions ──
  const loadStatus = async () => {
    try {
      const res = await whatsappAPI.getStatus();
      setStatus(res.data);
    } catch {
      setStatus({ connected: false, qr: null, connecting: false });
    } finally {
      setLoadingStatus(false);
    }
  };

  const loadWaSettings = async () => {
    try { const res = await whatsappAPI.getSettings(); setWaSettings(res.data); } catch { }
  };

  const loadSendLogs = async () => {
    setLoadingLogs(true);
    try { const res = await whatsappAPI.getLogs(30); setSendLogs(res.data || []); } catch { }
    finally { setLoadingLogs(false); }
  };

  const loadTargetCount = async () => {
    setTargetInfo(p => ({ ...p, loading: true }));
    try { const res = await whatsappAPI.getTargetCount(); setTargetInfo({ ...res.data, loading: false }); }
    catch { setTargetInfo(p => ({ ...p, loading: false })); }
  };

  const loadMembers = async () => {
    setLoadingMembers(true);
    try {
      const params = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const [mRes, aRes, bRes] = await Promise.all([
        membersAPI.getAll({ ...params, exclude_photo: true }),
        activitiesAPI.getAll({ branch_filter: 'all' }),
        isAdmin ? branchesAPI.getAll() : Promise.resolve({ data: [] })
      ]);
      setMembers(mRes.data);
      setActivities(aRes.data);
      setBranches(bRes.data || []);
      const exp = {};
      (bRes.data || []).forEach(b => { exp[b.id] = true; });
      exp['no_branch'] = true;
      setExpandedBranches(exp);
    } catch { }
    finally { setLoadingMembers(false); }
  };

  const loadPortalNotifications = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/member-notifications', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setPortalNotifications(await res.json());
    } catch { }
  };

  const loadConversations = async () => {
    setLoadingConversations(true);
    try {
      const [cRes, uRes] = await Promise.all([messagesAPI.getConversations(), messagesAPI.getUnreadCount()]);
      setConversations(cRes.data || []);
      setMsgUnreadCount(uRes.data?.unread_count || 0);
    } catch { }
    finally { setLoadingConversations(false); }
  };

  const loadPushData = async () => {
    try {
      const [cRes, bRes] = await Promise.all([pushNotificationsAPI.getSubscribersCount(), branchesAPI.getAll()]);
      setPushSubscribersCount(cRes.data.count);
      if (!branches.length) setBranches(bRes.data || []);
    } catch { }
  };

  // Initial loads
  useEffect(() => {
    loadStatus();
    loadWaSettings();
    loadSendLogs();
    loadTargetCount();
    // Poll every 5s when not connected (waiting for QR or waiting for scan)
    intervalRef.current = setInterval(() => { if (!status.connected) loadStatus(); }, 5000);
    return () => clearInterval(intervalRef.current);
  }, []);

  useEffect(() => {
    clearInterval(intervalRef.current);
    intervalRef.current = null;
    if (!status.connected) {
      // 5s when waiting for QR or scan; slow down to 15s once connected
      intervalRef.current = setInterval(loadStatus, 5000);
    }
  }, [status.connected]);

  const loadActivityNotifActivities = async (branchFilter) => {
    setActNotifLoadingActivities(true);
    // reset activity/levels when branch changes
    setActNotifActivity(''); setActNotifLevels([]); setActNotifMembers([]);
    setActNotifMemberCount(null); setActNotifShowList(false);
    try {
      // Same source as SchedulePage: activitiesAPI.getAll — shows all registered activities
      const params = branchFilter ? { branch_filter: branchFilter } : { branch_filter: 'all' };
      const res = await activitiesAPI.getAll(params);
      const list = (res.data || []).map(a => ({
        id: a.name_ar || a.name || a.id,
        name: a.name_ar || a.name || a.id,
      }));
      setActNotifAllActivities(list);
    } catch { }
    finally { setActNotifLoadingActivities(false); }
  };

  useEffect(() => {
    if (activeTab === 'manual' && !members.length) loadMembers();
    if (activeTab === 'portal') loadPortalNotifications();
    if (activeTab === 'internal') loadConversations();
    if (activeTab === 'push') loadPushData();
    if (activeTab === 'activity_notif') loadActivityNotifActivities(actNotifBranch);
  }, [activeTab]);

  // Reload activities when branch changes (in activity_notif tab)
  useEffect(() => {
    if (activeTab === 'activity_notif') loadActivityNotifActivities(actNotifBranch);
  }, [actNotifBranch]);

  // Helper: collect all member_ids from the currently filtered levels
  const getTargetMemberIds = (levels, levelId) => {
    const targetLvls = levelId && levelId !== 'all'
      ? levels.filter(l => l.id === levelId)
      : levels;
    const seen = new Set();
    targetLvls.forEach(l => (l.members || []).forEach(mid => seen.add(mid)));
    return [...seen];
  };

  // Fetch member details + active status for a list of ids
  const fetchMemberDetails = async (memberIds) => {
    if (!memberIds.length) { setActNotifMembers([]); setActNotifMemberCount(0); return; }
    setActNotifLoadingMembers(true);
    try {
      const res = await pushNotificationsAPI.getMembersActiveStatus(memberIds);
      setActNotifMembers(res.data || []);
    } catch { setActNotifMembers([]); }
    finally { setActNotifLoadingMembers(false); }
  };

  // Load levels when actNotifActivity (or branch) changes
  // activity_name in db.levels is compound e.g. "السباحة - 8:00-9:00"
  // so we fetch ALL levels and filter client-side by includes() — same logic as LevelsPage
  useEffect(() => {
    if (!actNotifActivity) {
      setActNotifLevels([]); setActNotifLevel('all');
      setActNotifMemberCount(null); setActNotifMembers([]); setActNotifShowList(false);
      return;
    }
    const params = actNotifBranch ? { branch_filter: actNotifBranch } : {};
    levelsAPI.getAll(params).then(async res => {
      const allLvls = res.data || [];
      const filtered = allLvls.filter(l => (l.activity_name || '').includes(actNotifActivity));
      setActNotifLevels(filtered);
      setActNotifLevel('all');
      const ids = getTargetMemberIds(filtered, 'all');
      await fetchMemberDetails(ids);
    }).catch(() => { setActNotifLevels([]); setActNotifMembers([]); });
  }, [actNotifActivity, actNotifBranch]);

  // Update member list when level or members change
  useEffect(() => {
    if (!actNotifActivity || !actNotifLevels.length) return;
    const ids = getTargetMemberIds(actNotifLevels, actNotifLevel);
    fetchMemberDetails(ids);
  }, [actNotifLevel, actNotifLevels]);

  // Derived: filtered member list based on active-only toggle
  const actNotifFilteredMembers = actNotifActiveOnly
    ? actNotifMembers.filter(m => m.is_active)
    : actNotifMembers;

  // Sync member count with filtered list
  useEffect(() => {
    if (!actNotifLoadingMembers) {
      setActNotifMemberCount(actNotifFilteredMembers.length);
    }
  }, [actNotifFilteredMembers, actNotifLoadingMembers]);

  const handleSendActivityNotif = async () => {
    if (!actNotifActivity) { toast.error(t('اختر النشاط أولاً', 'Select an activity first')); return; }
    if (!actNotifBody.trim()) { toast.error(t('أدخل نص الإشعار', 'Enter notification body')); return; }
    if (actNotifChannel !== 'whatsapp' && !actNotifTitle.trim()) { toast.error(t('أدخل عنوان الإشعار', 'Enter notification title')); return; }
    // Use the filtered member list (active-only or all) — computed from actNotifMembers
    const resolvedMemberIds = actNotifFilteredMembers.map(m => m.member_id);
    if (!resolvedMemberIds.length) { toast.error(t('لا يوجد أعضاء مستهدفون', 'No target members')); return; }

    if (actNotifChannel === 'whatsapp') {
      if (!status.connected) { toast.error(t('واتساب غير متصل', 'WhatsApp not connected')); return; }
      const membersWithPhone = actNotifFilteredMembers.filter(m => m.phone);
      if (!membersWithPhone.length) { toast.error(t('لا يوجد أعضاء لديهم رقم هاتف', 'No members have phone numbers')); return; }
      if (!window.confirm(t(`سيتم إرسال رسالة واتساب لـ ${membersWithPhone.length} عضو. متابعة؟`, `Send WhatsApp to ${membersWithPhone.length} members. Continue?`))) return;
      setActNotifSending(true);
      setActNotifWaProgress({ done: 0, total: membersWithPhone.length });
      let success = 0;
      for (let i = 0; i < membersWithPhone.length; i++) {
        const m = membersWithPhone[i];
        try {
          await whatsappAPI.sendTest(m.phone, actNotifBody);
          success++;
        } catch { }
        setActNotifWaProgress({ done: i + 1, total: membersWithPhone.length });
        if (i < membersWithPhone.length - 1) await new Promise(r => setTimeout(r, 2000));
      }
      setActNotifSending(false);
      setActNotifWaProgress({ done: 0, total: 0 });
      toast.success(t(`تم الإرسال عبر واتساب: ${success} من ${membersWithPhone.length}`, `WhatsApp sent: ${success} of ${membersWithPhone.length}`));
      setActNotifBody('');
      return;
    }

    if (!window.confirm(t(`سيتم إرسال الإشعار لـ ${resolvedMemberIds.length} عضو. متابعة؟`, `Send notification to ${resolvedMemberIds.length} members. Continue?`))) return;
    setActNotifSending(true);
    try {
      if (actNotifChannel === 'push') {
        const res = await pushNotificationsAPI.broadcast({
          title: actNotifTitle,
          body: actNotifBody,
          url: '/portal/notifications',
          member_ids: resolvedMemberIds,
        });
        const d = res.data;
        toast.success(t(`تم الإرسال ✓ (${d.success ?? 0} ناجح، ${d.failed ?? 0} فشل)`, `Sent ✓ (${d.success ?? 0} ok, ${d.failed ?? 0} failed)`));
      } else {
        const res = await pushNotificationsAPI.createMemberNotification({
          title: actNotifTitle,
          message: actNotifBody,
          target: 'activity_members',
          target_member_ids: resolvedMemberIds,
          priority: actNotifPriority,
          notification_type: 'announcement',
        });
        const d = res.data;
        toast.success(t(`تم الإرسال ✓ (${d.target_count ?? 0} عضو)`, `Sent ✓ (${d.target_count ?? 0} members)`));
      }
      setActNotifTitle('');
      setActNotifBody('');
    } catch (err) {
      toast.error(err.response?.data?.detail || t('فشل الإرسال', 'Send failed'));
    } finally {
      setActNotifSending(false);
    }
  };

  // ── WhatsApp handlers ──
  const handleToggleEnabled = () => {
    if (waSettings.enabled && !window.confirm(t('هل تريد إيقاف التذكيرات التلقائية؟', 'Disable automatic reminders?'))) return;
    setWaSettings(s => ({ ...s, enabled: !s.enabled }));
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await whatsappAPI.updateSettings(waSettings);
      toast.success(t('تم حفظ الإعدادات', 'Settings saved'));
      loadTargetCount();
    } catch { toast.error(t('فشل حفظ الإعدادات', 'Failed to save settings')); }
    finally { setSavingSettings(false); }
  };

  const handleSendTest = async () => {
    if (!testPhone.trim()) { toast.error(t('أدخل رقم الهاتف', 'Enter phone number')); return; }
    setSendingTest(true);
    try {
      await whatsappAPI.sendTest(testPhone.trim());
      toast.success(t('تم إرسال الرسالة التجريبية ✓', 'Test message sent ✓'));
    } catch (err) { toast.error(err.response?.data?.detail || t('فشل الإرسال', 'Send failed')); }
    finally { setSendingTest(false); }
  };

  const handleSendNow = async () => {
    if (!window.confirm(t(`سيتم إرسال تذكير لـ ${targetInfo.count} عضو. هل تريد المتابعة؟`, `Will send to ${targetInfo.count} members. Continue?`))) return;
    setSendingNow(true);
    try {
      await whatsappAPI.sendNow();
      toast.success(t('جاري إرسال التذكيرات...', 'Sending reminders...'));
      setTimeout(loadSendLogs, 5000);
    } catch (err) { toast.error(err.response?.data?.detail || t('فشل الإرسال', 'Send failed')); }
    finally { setSendingNow(false); }
  };

  const handleDisconnect = async () => {
    if (!window.confirm(t('هل تريد فصل الحساب وحذف الجلسة؟', 'Disconnect and clear session?'))) return;
    setDisconnecting(true);
    try {
      await whatsappAPI.disconnect();
      toast.success(t('تم الفصل. سيتم توليد QR جديد...', 'Disconnected. New QR will appear...'));
      setTimeout(() => {
        clearInterval(intervalRef.current); intervalRef.current = null;
        loadStatus(); intervalRef.current = setInterval(loadStatus, 30000);
      }, 3000);
    } catch { toast.error(t('فشل الفصل', 'Disconnect failed')); }
    finally { setDisconnecting(false); }
  };

  // ── Manual WhatsApp handlers ──
  const handleMessageTypeChange = (type) => {
    setMessageType(type);
    if (type !== 'custom' && messageTemplates[type]) setWaMessage(messageTemplates[type][language]);
    else setWaMessage('');
  };

  const toggleMember = (id) => setSelectedMembers(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleSelectAll = () => {
    if (selectAll) setSelectedMembers([]);
    else setSelectedMembers(filteredMembers.map(m => m.id));
    setSelectAll(!selectAll);
  };

  const handleSendWaMessage = () => {
    if (!selectedMembers.length) { toast.error(t('اختر المستلمين أولاً', 'Select recipients first')); return; }
    if (!waMessage.trim()) { toast.error(t('أدخل نص الرسالة', 'Enter message text')); return; }
    const encoded = encodeURIComponent(waMessage);
    const selected = members.filter(m => selectedMembers.includes(m.id));
    if (selected.length === 0) return;
    const queue = selected
      .filter(m => m.phone)
      .map(m => {
        let phone = (m.phone || '').replace(/\D/g, '');
        if (phone.startsWith('00')) phone = phone.slice(2);
        if (phone.startsWith('0')) phone = '966' + phone.slice(1);
        return {
          name: (isRTL ? (m.name_ar || m.name) : (m.name || m.name_ar)) || m.phone,
          phone,
          link: `https://wa.me/${phone}?text=${encoded}`
        };
      });
    if (queue.length === 0) { toast.error(t('لا توجد أرقام جوال', 'No phone numbers')); return; }
    window.open(queue[0].link, '_blank');
    if (queue.length === 1) {
      toast.success(t('تم فتح واتساب', 'WhatsApp opened'));
      return;
    }
    setWaQueue(queue);
    setWaQueueIdx(1);
    toast.success(t(`تم فتح 1 من ${queue.length}. اضغط "التالي" للمتابعة`, `Opened 1 of ${queue.length}. Click "Next" to continue`));
  };

  const sendNextInQueue = () => {
    const next = waQueue[waQueueIdx];
    if (!next) { setWaQueue([]); setWaQueueIdx(0); return; }
    window.open(next.link, '_blank');
    const newIdx = waQueueIdx + 1;
    if (newIdx >= waQueue.length) {
      setWaQueue([]); setWaQueueIdx(0);
      toast.success(t('اكتمل الإرسال', 'Sending completed'));
    } else {
      setWaQueueIdx(newIdx);
    }
  };

  const skipNextInQueue = () => {
    const newIdx = waQueueIdx + 1;
    if (newIdx >= waQueue.length) { setWaQueue([]); setWaQueueIdx(0); }
    else setWaQueueIdx(newIdx);
  };

  const cancelQueue = () => { setWaQueue([]); setWaQueueIdx(0); };

  const [sendingToSelected, setSendingToSelected] = useState(false);
  const [sendToSelectedProgress, setSendToSelectedProgress] = useState({ done: 0, total: 0 });
  const [connTabMsgType, setConnTabMsgType] = useState('template');
  const [connTabCustomMsg, setConnTabCustomMsg] = useState('');

  const connTabTemplates = {
    payment_reminder: {
      ar: 'السلام عليكم، نود تذكيركم بموعد سداد رسوم الاشتراك في شركة اداء الابطال العالمية للرياضة. نرجو التواصل معنا لمزيد من التفاصيل.',
      en: 'Hello, this is a reminder about your subscription payment. Please contact us.'
    },
    expiry_alert: {
      ar: 'السلام عليكم، نود إعلامكم بأن اشتراككم سينتهي قريباً. يرجى التواصل معنا لتجديد الاشتراك.',
      en: 'Hello, your subscription is expiring soon. Please contact us to renew.'
    },
    promotion: {
      ar: 'السلام عليكم، نقدم لكم عروضاً خاصة في شركة اداء الابطال العالمية للرياضة. تواصلوا معنا!',
      en: 'Hello, we have special offers. Contact us to learn more!'
    }
  };

  const handleConnTabMsgTypeChange = (type) => {
    setConnTabMsgType(type);
    if (type === 'template') setConnTabCustomMsg('');
    else if (type === 'custom') setConnTabCustomMsg('');
    else if (connTabTemplates[type]) setConnTabCustomMsg(connTabTemplates[type][language]);
  };

  const handleSendToSelectedViaSession = async () => {
    if (!selectedMembers.length) { toast.error(t('اختر الأعضاء أولاً', 'Select members first')); return; }
    if (!status.connected) { toast.error(t('يجب الاتصال بواتساب أولاً', 'Connect first')); return; }
    if (connTabMsgType === 'custom' && !connTabCustomMsg.trim()) { toast.error(t('أدخل نص الرسالة', 'Enter message')); return; }
    if (!window.confirm(t(`سيتم إرسال الرسالة لـ ${selectedMembers.length} عضو. هل تريد المتابعة؟`, `Send to ${selectedMembers.length} members. Continue?`))) return;

    const selected = members.filter(m => selectedMembers.includes(m.id));
    setSendingToSelected(true);
    setSendToSelectedProgress({ done: 0, total: selected.length });
    let success = 0;

    for (let i = 0; i < selected.length; i++) {
      const m = selected[i];
      let msg;
      if (connTabMsgType === 'template') {
        const name = m.name_ar || m.name || '';
        const activeActs = m.activities?.filter(a => a.status === 'active').map(a => a.activity_name || a.name || '').filter(Boolean);
        const activity = activeActs?.join('، ') || '';
        const endDateRaw = getMemberEndDate(m);
        const endDateFmt = endDateRaw
          ? new Date(endDateRaw).toLocaleDateString('ar-SA', { day: '2-digit', month: '2-digit', year: 'numeric' })
          : '';
        msg = waSettings.message_template
          .replace('{name}', name)
          .replace('{activity}', activity)
          .replace('{days}', waSettings.days_before)
          .replace('{end_date}', endDateFmt);
      } else {
        msg = connTabCustomMsg;
      }
      try {
        await whatsappAPI.sendTest(m.phone, msg);
        success++;
      } catch { }
      setSendToSelectedProgress({ done: i + 1, total: selected.length });
      if (i < selected.length - 1) await new Promise(r => setTimeout(r, 2000));
    }

    setSendingToSelected(false);
    setSendToSelectedProgress({ done: 0, total: 0 });
    setSelectedMembers([]);
    setSelectAll(false);
    toast.success(t(`تم الإرسال: ${success} من ${selected.length}`, `Sent: ${success} of ${selected.length}`));
    loadSendLogs();
  };

  const toggleBranchExpanded = (id) => setExpandedBranches(p => ({ ...p, [id]: !p[id] }));
  const toggleBranchMembers = (branchId, bMembers) => {
    const ids = bMembers.map(m => m.id);
    const all = ids.every(id => selectedMembers.includes(id));
    if (all) setSelectedMembers(p => p.filter(id => !ids.includes(id)));
    else setSelectedMembers(p => [...new Set([...p, ...ids])]);
  };

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isSubscriptionActive = (a) => {
    if (a.status !== 'active') return false;
    if (!a.end_date) return true;
    return new Date(a.end_date) >= today;
  };

  const getMemberEndDate = (m) => {
    const active = m.activities?.filter(a => isSubscriptionActive(a));
    if (!active || active.length === 0) return null;
    const sorted = active.filter(a => a.end_date).sort((a, b) => new Date(a.end_date) - new Date(b.end_date));
    return sorted.length > 0 ? sorted[0].end_date : null;
  };

  const formatEndDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const diff = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
    const label = d.toLocaleDateString('ar-SA', { day: '2-digit', month: '2-digit', year: '2-digit' });
    if (diff <= 7) return { label, color: 'text-red-500' };
    if (diff <= 14) return { label, color: 'text-orange-500' };
    return { label, color: 'text-muted-foreground' };
  };

  const DAY_OPTIONS = [
    { id: 'saturday', ar: 'السبت', en: 'Saturday', kw: ['السبت'] },
    { id: 'sunday', ar: 'الأحد', en: 'Sunday', kw: ['الأحد', 'الاحد'] },
    { id: 'monday', ar: 'الإثنين', en: 'Monday', kw: ['الإثنين', 'الاثنين', 'الأثنين'] },
    { id: 'tuesday', ar: 'الثلاثاء', en: 'Tuesday', kw: ['الثلاثاء'] },
    { id: 'wednesday', ar: 'الأربعاء', en: 'Wednesday', kw: ['الأربعاء', 'الاربعاء'] },
    { id: 'thursday', ar: 'الخميس', en: 'Thursday', kw: ['الخميس'] },
    { id: 'friday', ar: 'الجمعة', en: 'Friday', kw: ['الجمعة'] },
  ];

  const activityHasDay = (a, dayId) => {
    if (!dayId || dayId === 'all') return true;
    const opt = DAY_OPTIONS.find(d => d.id === dayId);
    if (!opt) return true;
    if (Array.isArray(a.days) && a.days.length > 0) return a.days.includes(dayId);
    const text = `${a.schedule || ''} ${a.time_slot || ''} ${a.activity_name || ''}`;
    return opt.kw.some(k => text.includes(k));
  };

  const MultiSelectPopover = ({ values, options, onChange, allLabel, placeholder, minWidth = 140 }) => {
    const toggle = (id) => {
      if (values.includes(id)) onChange(values.filter(v => v !== id));
      else onChange([...values, id]);
    };
    const label = values.length === 0
      ? allLabel
      : values.length === 1
        ? (options.find(o => o.id === values[0])?.label || values[0])
        : `${values.length} ${t('محدد', 'selected')}`;
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className={`flex-1 justify-between font-normal h-9 text-sm`} style={{ minWidth }}>
            <span className="truncate">{label}</span>
            <ChevronDown className="w-4 h-4 opacity-50 ms-2 flex-shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2 max-h-[300px] overflow-y-auto" align="start">
          <div className="flex items-center justify-between px-2 py-1 border-b mb-1">
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => onChange([])}>
              {t('الكل', 'All')}
            </button>
            {values.length > 0 && (
              <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => onChange([])}>
                {t('مسح', 'Clear')}
              </button>
            )}
          </div>
          {options.length === 0 ? (
            <p className="text-xs text-muted-foreground p-2">{placeholder || t('لا توجد خيارات', 'No options')}</p>
          ) : options.map(o => (
            <div key={o.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/40 rounded cursor-pointer" onClick={() => toggle(o.id)}>
              <Checkbox checked={values.includes(o.id)} onCheckedChange={() => toggle(o.id)} onClick={e => e.stopPropagation()} />
              <span className="text-sm">{o.label}</span>
            </div>
          ))}
        </PopoverContent>
      </Popover>
    );
  };

  const activityHasAnyDay = (a, dayIds) => {
    if (!dayIds || dayIds.length === 0) return true;
    return dayIds.some(d => activityHasDay(a, d));
  };

  const filteredMembers = members.filter(m => {
    const hasActive = m.activities?.some(a => isSubscriptionActive(a));
    if (!hasActive) return false;
    const matchActDay = m.activities?.some(a => {
      if (!isSubscriptionActive(a)) return false;
      if (filterActivities.length > 0 && !filterActivities.includes(a.activity_id)) return false;
      if (!activityHasAnyDay(a, filterDays)) return false;
      return true;
    });
    if (!matchActDay) return false;
    const brMatch = filterBranch === 'all' || m.branch_id === filterBranch;
    return brMatch;
  });

  const membersByBranch = {};
  filteredMembers.forEach(m => {
    const bid = m.branch_id || 'no_branch';
    if (!membersByBranch[bid]) membersByBranch[bid] = [];
    membersByBranch[bid].push(m);
  });

  const getBranchName = (id) => {
    if (id === 'no_branch') return t('بدون فرع', 'No Branch');
    return branches.find(b => b.id === id)?.name_ar || branches.find(b => b.id === id)?.name || id;
  };

  // ── Portal Notification handlers ──
  const handleSendPortalNotification = async () => {
    if (!notifTitle.trim() || !notifMessage.trim()) { toast.error(t('أدخل العنوان والرسالة', 'Enter title and message')); return; }
    if (notifTarget === 'specific_member' && !notifTargetMemberId) { toast.error(t('اختر العضو', 'Select member')); return; }
    setSendingNotif(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/member-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: notifTitle, message: notifMessage, target: notifTarget, target_member_id: notifTargetMemberId || null, priority: notifPriority, notification_type: notifType })
      });
      if (res.ok) {
        toast.success(t('تم إرسال الإشعار ✓', 'Notification sent ✓'));
        setNotifTitle(''); setNotifMessage(''); setNotifTargetMemberId('');
        loadPortalNotifications();
      } else toast.error(t('فشل إرسال الإشعار', 'Failed to send'));
    } catch { toast.error(t('حدث خطأ', 'Error occurred')); }
    finally { setSendingNotif(false); }
  };

  const handleDeletePortalNotification = async (id) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/member-notifications/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { toast.success(t('تم الحذف', 'Deleted')); loadPortalNotifications(); }
    } catch { }
  };

  // ── Internal Message handlers ──
  const openThread = async (memberId) => {
    try {
      const res = await messagesAPI.getThread(memberId);
      setThreadMessages(res.data.messages || []);
      setThreadMember(res.data.member);
      setSelectedThread(memberId);
      loadConversations();
    } catch { toast.error(t('خطأ في تحميل المحادثة', 'Failed to load thread')); }
  };

  const handleSendInternalMessage = async () => {
    if (!newMsgSubject.trim() || !newMsgBody.trim()) { toast.error(t('أدخل الموضوع والرسالة', 'Enter subject and message')); return; }
    if (!newMsgBroadcast && !newMsgRecipient) { toast.error(t('اختر العضو المستلم', 'Select a recipient')); return; }
    setSendingMsg(true);
    try {
      const res = await messagesAPI.send({ subject: newMsgSubject, body: newMsgBody, recipient_member_id: newMsgBroadcast ? null : newMsgRecipient, broadcast: newMsgBroadcast });
      toast.success(res.data.message || t('تم الإرسال', 'Sent'));
      setNewMsgSubject(''); setNewMsgBody(''); setNewMsgRecipient(''); setNewMsgBroadcast(false); setShowCompose(false);
      loadConversations();
    } catch { toast.error(t('فشل إرسال الرسالة', 'Failed to send')); }
    finally { setSendingMsg(false); }
  };

  const handleReplyInThread = async () => {
    if (!replyText.trim()) return;
    setSendingMsg(true);
    try {
      await messagesAPI.reply(selectedThread, { body: replyText });
      setReplyText(''); openThread(selectedThread);
      toast.success(t('تم إرسال الرد', 'Reply sent'));
    } catch { toast.error(t('فشل إرسال الرد', 'Failed to send reply')); }
    finally { setSendingMsg(false); }
  };

  // ── Push Notification handlers ──
  const handleShowPushSubscribers = async () => {
    setShowPushSubscribers(true); setLoadingPushSubscribers(true);
    try {
      const res = await pushNotificationsAPI.getSubscribersList();
      setPushSubscribers(res.data.subscribers || []);
    } catch { toast.error(t('فشل تحميل المشتركين', 'Failed to load subscribers')); }
    finally { setLoadingPushSubscribers(false); }
  };

  const handleSendPush = async (e) => {
    e.preventDefault();
    if (!pushForm.title.trim() || !pushForm.body.trim()) { toast.error(t('أدخل العنوان والمحتوى', 'Fill title and body')); return; }
    setPushSending(true); setPushResult(null);
    try {
      const res = await pushNotificationsAPI.broadcast({ title: pushForm.title, body: pushForm.body, url: pushForm.url || '/', branch_id: pushForm.branch_id || null });
      setPushResult(res.data);
      toast.success(t(`تم الإرسال! (${res.data.success} من ${res.data.total})`, `Sent! (${res.data.success} of ${res.data.total})`));
      setPushForm({ title: '', body: '', url: '/', branch_id: '' });
    } catch { toast.error(t('فشل الإرسال', 'Failed to send')); }
    finally { setPushSending(false); }
  };

  const messagePreview = waSettings.message_template
    .replace('{name}', t('أحمد محمد', 'Ahmed Mohammed'))
    .replace('{activity}', t('كرة القدم', 'Football'))
    .replace('{days}', waSettings.days_before);

  const lastLog = sendLogs[0];

  // ── Tabs definition ──
  const tabs = [
    { id: 'connection', label: t('واتساب', 'WhatsApp'), icon: <Wifi className="w-4 h-4" /> },
    { id: 'manual', label: t('إرسال يدوي', 'Manual Send'), icon: <Phone className="w-4 h-4" /> },
    { id: 'activity_notif', label: t('إشعار النشاط', 'Activity Alert'), icon: <Megaphone className="w-4 h-4" /> },
    { id: 'portal', label: t('إشعارات الأعضاء', 'Member Notifications'), icon: <Bell className="w-4 h-4" /> },
    { id: 'internal', label: t('رسائل داخلية', 'Internal Messages'), icon: <Mail className="w-4 h-4" />, badge: msgUnreadCount },
    { id: 'push', label: t('إشعارات Push', 'Push Notifications'), icon: <Megaphone className="w-4 h-4" /> },
  ];

  return (
    <Layout title={t('التواصل', 'Communications')}>
      {waQueue.length > 0 && (
        <div className="fixed bottom-4 inset-x-4 z-50 mx-auto max-w-md bg-card border-2 border-primary shadow-2xl rounded-xl p-3" dir={isRTL ? 'rtl' : 'ltr'}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold">{t('قائمة إرسال واتساب', 'WhatsApp send queue')}</span>
            <span className="text-xs text-muted-foreground">{waQueueIdx} / {waQueue.length}</span>
          </div>
          <div className="text-xs text-muted-foreground mb-2 truncate">
            {t('التالي:', 'Next:')} <span className="font-medium text-foreground">{waQueue[waQueueIdx]?.name}</span> — {waQueue[waQueueIdx]?.phone}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={sendNextInQueue} className="flex-1 gap-1">
              <Send className="w-3.5 h-3.5" />
              {t('فتح التالي', 'Open Next')}
            </Button>
            <Button size="sm" variant="outline" onClick={skipNextInQueue}>{t('تخطي', 'Skip')}</Button>
            <Button size="sm" variant="ghost" onClick={cancelQueue}>{t('إلغاء', 'Cancel')}</Button>
          </div>
        </div>
      )}
      <div className="p-4 space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>

        {/* ── Tabs ── */}
        <div className="flex flex-wrap gap-2 border-b pb-3">
          {tabs.map(tab => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveTab(tab.id)}
              className="gap-1.5"
            >
              {tab.icon}
              {tab.label}
              {tab.badge > 0 && <Badge variant="destructive" className="text-xs px-1.5 py-0.5 ms-1">{tab.badge}</Badge>}
            </Button>
          ))}
        </div>

        {/* ══════════════════════════════════════════
            TAB 1: CONNECTION & AUTO REMINDERS
        ══════════════════════════════════════════ */}
        {activeTab === 'connection' && (
          <div className="space-y-5 max-w-3xl">

            {/* Connection Status */}
            <div className={`rounded-2xl border-2 p-6 ${status.connected ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  {status.connected ? <Wifi className="w-6 h-6 text-green-600" /> : <WifiOff className="w-6 h-6 text-orange-500" />}
                  <div>
                    <h2 className="text-lg font-bold">{status.connected ? t('متصل بواتساب ✓', 'Connected ✓') : t('غير متصل', 'Not Connected')}</h2>
                    <p className="text-sm text-muted-foreground">
                      {status.connected ? t('الخدمة جاهزة للإرسال', 'Service ready') : status.connecting ? t('جارٍ الاتصال...', 'Connecting...') : t('امسح QR بهاتفك', 'Scan QR with your phone')}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={loadStatus} disabled={loadingStatus}>
                    <RefreshCw className={`w-4 h-4 ${loadingStatus ? 'animate-spin' : ''}`} />
                  </Button>
                  {status.connected && (
                    <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={disconnecting} className="text-red-600 border-red-200 hover:bg-red-50">
                      {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                      <span className="ms-1">{t('فصل', 'Disconnect')}</span>
                    </Button>
                  )}
                </div>
              </div>

              {lastLog && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-3">
                  <Clock className="w-3 h-3 shrink-0" />
                  <span>{t('آخر إرسال:', 'Last send:')} {lastLog.member_name} — {new Date(lastLog.timestamp).toLocaleString(isRTL ? 'ar-SA' : 'en-US')} {lastLog.success ? '✓' : '✗'}</span>
                </div>
              )}

              {!status.connected && status.qr && (
                <div className="text-center py-4">
                  <p className="text-sm font-medium mb-3 text-orange-700">{t('افتح واتساب ← الأجهزة المرتبطة ← ربط جهاز ← امسح الكود', 'Open WhatsApp → Linked Devices → Link a Device → Scan')}</p>
                  <img src={status.qr} alt="WhatsApp QR" className="mx-auto w-56 h-56 rounded-xl border-4 border-white shadow-lg" />
                  <p className="text-xs text-muted-foreground mt-2">{t('يتجدد كل 30 ثانية', 'Refreshes every 30 seconds')}</p>
                </div>
              )}
              {!status.connected && !status.qr && !loadingStatus && (
                <div className="text-center py-4">
                  <Loader2 className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{t('جارٍ تشغيل خدمة واتساب...', 'Starting WhatsApp service...')}</p>
                </div>
              )}
            </div>

            {/* Auto Reminders Settings */}
            <div className="rounded-2xl border p-6 bg-card space-y-5">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-bold">{t('إعدادات التذكيرات التلقائية', 'Auto Reminder Settings')}</h2>
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl bg-muted">
                <div>
                  <p className="font-medium">{t('تفعيل التذكيرات التلقائية', 'Enable Auto Reminders')}</p>
                  <p className="text-sm text-muted-foreground">{t(`يُرسل يومياً الساعة ${HOURS[waSettings.send_hour]?.label}`, `Sent daily at ${HOURS[waSettings.send_hour]?.label}`)}</p>
                </div>
                <button onClick={handleToggleEnabled} className={`relative w-12 h-6 rounded-full transition-colors ${waSettings.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${waSettings.enabled ? (isRTL ? 'right-1' : 'translate-x-6') : (isRTL ? 'right-7' : 'translate-x-1')}`} />
                </button>
              </div>

              {/* Legacy reminder fields — collapsed; offsets below are primary */}
              <details className="border rounded-xl p-3 bg-muted/30">
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground select-none">
                  {t('الإعدادات القديمة (تذكير أول/ثاني) — للتوافق فقط', 'Legacy reminder fields (1st / 2nd) — backward compatibility only')}
                </summary>
                <div className="mt-3 space-y-3">
              {/* Reminder 1 */}
              <div className="border rounded-xl p-4 space-y-2">
                <p className="text-sm font-semibold text-primary">{t('التذكير الأول', 'First Reminder')}</p>
                <label className="block text-sm font-medium">{t('إرسال قبل الانتهاء بـ (أيام)', 'Days before expiry')}</label>
                <div className="flex items-center gap-3">
                  <input type="number" min={1} max={30} value={waSettings.days_before}
                    onChange={e => setWaSettings(s => ({ ...s, days_before: parseInt(e.target.value) || 3 }))}
                    className="border rounded-lg px-3 py-2 w-24 text-center focus:outline-none focus:ring-2 focus:ring-primary" />
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                    <Users className="w-4 h-4 text-blue-600" />
                    {targetInfo.loading ? <Loader2 className="w-4 h-4 animate-spin text-blue-500" /> :
                      <span className="text-sm font-semibold text-blue-700">{targetInfo.count} {t('عضو', 'members')}</span>}
                    <Button variant="ghost" size="sm" className="h-6 px-1" onClick={loadTargetCount}><RefreshCw className="w-3 h-3" /></Button>
                  </div>
                </div>
                {targetInfo.target_date && (
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">
                      {t(`ينتهي خلال ${waSettings.days_before} أيام (حتى ${targetInfo.target_date})`, `Expiring within ${waSettings.days_before} days (until ${targetInfo.target_date})`)}
                    </p>
                    {targetInfo.count_today > 0 && (
                      <p className="text-xs text-orange-600 font-medium">
                        {t(`سيُرسل اليوم لـ ${targetInfo.count_today} عضو`, `Today's send: ${targetInfo.count_today} members`)}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Reminder 2 */}
              <div className="border rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-primary">{t('التذكير الثاني', 'Second Reminder')}</p>
                  <button onClick={() => setWaSettings(s => ({ ...s, reminder_2_enabled: !s.reminder_2_enabled }))}
                    className={`relative w-10 h-5 rounded-full transition-colors ${waSettings.reminder_2_enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${waSettings.reminder_2_enabled ? (isRTL ? 'right-0.5' : 'translate-x-5') : (isRTL ? 'right-5' : 'translate-x-0.5')}`} />
                  </button>
                </div>
                {waSettings.reminder_2_enabled && (
                  <>
                    <label className="block text-sm font-medium">{t('إرسال قبل الانتهاء بـ (أيام)', 'Days before expiry')}</label>
                    <div className="flex items-center gap-3">
                      <input type="number" min={1} max={30} value={waSettings.days_before_2}
                        onChange={e => setWaSettings(s => ({ ...s, days_before_2: parseInt(e.target.value) || 1 }))}
                        className="border rounded-lg px-3 py-2 w-24 text-center focus:outline-none focus:ring-2 focus:ring-primary" />
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-50 border border-purple-200">
                        <Users className="w-4 h-4 text-purple-600" />
                        {targetInfo.loading ? <Loader2 className="w-4 h-4 animate-spin text-purple-500" /> :
                          <span className="text-sm font-semibold text-purple-700">{targetInfo.count_2} {t('عضو', 'members')}</span>}
                      </div>
                    </div>
                    {targetInfo.target_date_2 && (
                      <div className="space-y-0.5">
                        <p className="text-xs text-muted-foreground">
                          {t(`سيُرسل لمن ينتهي اشتراكهم بتاريخ ${targetInfo.target_date_2}`, `Sends to members expiring ${targetInfo.target_date_2}`)}
                        </p>
                        {targetInfo.count_today_2 > 0 && (
                          <p className="text-xs text-purple-600 font-medium">
                            {t(`سيُرسل اليوم لـ ${targetInfo.count_today_2} عضو`, `Today's send: ${targetInfo.count_today_2} members`)}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
                {!waSettings.reminder_2_enabled && (
                  <p className="text-xs text-muted-foreground">{t('التذكير الثاني معطّل', 'Second reminder disabled')}</p>
                )}
              </div>
                </div>
              </details>

              {/* Multi-offset reminders (T-7 / T-3 / T-1 / T-0 ...) */}
              <div className="border rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-primary">{t('مواعيد التذكيرات (قبل الانتهاء)', 'Reminder Offsets (days before expiry)')}</p>
                  <button
                    type="button"
                    onClick={() => {
                      const cur = Array.isArray(waSettings.offsets) ? waSettings.offsets : [];
                      const used = new Set(cur.map(o => Number(o.days)));
                      let candidate = 0;
                      while (used.has(candidate) && candidate <= 60) candidate += 1;
                      if (candidate > 60) return;
                      const next = [...cur, { days: candidate, enabled: true }].sort((a, b) => Number(b.days) - Number(a.days));
                      setWaSettings(s => ({ ...s, offsets: next }));
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    + {t('إضافة', 'Add offset')}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{t('0 = يوم الانتهاء (T-0). كل صف يمكن تفعيله أو إيقافه دون حذفه.', '0 = day of expiry (T-0). Each row can be toggled on/off without deleting it.')}</p>
                <div className="space-y-2">
                  {(waSettings.offsets || []).map((o, i) => {
                    const dayKey = String(Number(o.days));
                    const tplMap = waSettings.templates || {};
                    const overrideValue = tplMap[dayKey] || '';
                    const hasOverride = overrideValue.length > 0;
                    return (
                      <div key={i} className="bg-background border rounded-lg px-2 py-1.5 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={60}
                            value={o.days}
                            onChange={e => {
                              const v = Math.max(0, Math.min(60, parseInt(e.target.value, 10) || 0));
                              setWaSettings(s => {
                                const next = [...(s.offsets || [])];
                                next[i] = { ...next[i], days: v };
                                return { ...s, offsets: next };
                              });
                            }}
                            className="w-20 border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                            dir="ltr"
                          />
                          <span className="text-xs text-muted-foreground flex-1">
                            {Number(o.days) === 0
                              ? t('يوم الانتهاء (T-0)', 'Day of expiry (T-0)')
                              : t(`قبل ${o.days} يوم`, `${o.days} days before`)}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setWaSettings(s => {
                                const next = [...(s.offsets || [])];
                                next[i] = { ...next[i], enabled: !next[i].enabled };
                                return { ...s, offsets: next };
                              });
                            }}
                            className={`relative w-9 h-5 rounded-full transition-colors ${o.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                            title={o.enabled ? t('مفعّل', 'Enabled') : t('متوقف', 'Disabled')}
                          >
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${o.enabled ? (isRTL ? 'right-0.5' : 'translate-x-[18px]') : (isRTL ? 'right-[18px]' : 'translate-x-0.5')}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setWaSettings(s => {
                                const next = (s.offsets || []).filter((_, j) => j !== i);
                                // Also drop the matching override entry, if any.
                                const nextTpl = { ...(s.templates || {}) };
                                delete nextTpl[String(Number(o.days))];
                                return { ...s, offsets: next, templates: nextTpl };
                              });
                            }}
                            className="text-xs text-red-600 hover:bg-red-50 rounded px-2 py-1"
                            title={t('حذف', 'Remove')}
                          >
                            ×
                          </button>
                        </div>
                        <details className="text-xs" open={hasOverride}>
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                            {hasOverride
                              ? t('قالب مخصص لهذا الموعد ✓', 'Custom template for this offset ✓')
                              : t('استخدام قالب مخصص لهذا الموعد', 'Use a custom template for this offset')}
                          </summary>
                          <div className="mt-1.5 space-y-1">
                            <textarea
                              value={overrideValue}
                              onChange={e => {
                                const v = e.target.value;
                                setWaSettings(s => {
                                  const nextTpl = { ...(s.templates || {}) };
                                  if (v === '') delete nextTpl[dayKey];
                                  else nextTpl[dayKey] = v;
                                  return { ...s, templates: nextTpl };
                                });
                              }}
                              rows={3}
                              maxLength={1000}
                              placeholder={t('فارغ = استخدام القالب المشترك أدناه', 'Empty = falls back to the shared template below')}
                              className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary bg-background"
                              dir="auto"
                            />
                            <p className="text-[10px] text-muted-foreground">
                              {t('المتغيرات المتاحة: {name} {activity} {days} {end_date} {fee}', 'Available variables: {name} {activity} {days} {end_date} {fee}')}
                            </p>
                          </div>
                        </details>
                      </div>
                    );
                  })}
                  {(!waSettings.offsets || waSettings.offsets.length === 0) && (
                    <p className="text-xs text-muted-foreground italic">{t('لا توجد مواعيد. أضف عرضاً واحداً على الأقل.', 'No offsets configured. Add at least one.')}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">{t('ساعة الإرسال اليومي', 'Daily Send Time')}</label>
                <select value={waSettings.send_hour} onChange={e => setWaSettings(s => ({ ...s, send_hour: parseInt(e.target.value) }))}
                  className="border rounded-lg px-3 py-2 w-40 focus:outline-none focus:ring-2 focus:ring-primary bg-background">
                  {HOURS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t('نص الرسالة (التذكير التلقائي)', 'Message Template (auto reminders)')}</label>
                <p className="text-xs text-muted-foreground mb-2">{t('المتغيرات: {name} الاسم، {activity} النشاط، {days} الأيام، {end_date} تاريخ الانتهاء، {fee} المبلغ', 'Variables: {name}, {activity}, {days}, {end_date}, {fee}')}</p>
                <textarea value={waSettings.message_template}
                  onChange={e => setWaSettings(s => ({ ...s, message_template: e.target.value }))}
                  rows={5} dir="auto"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
                <button onClick={() => setShowPreview(p => !p)} className="flex items-center gap-1 text-xs text-primary mt-2 hover:underline">
                  <Eye className="w-3 h-3" />
                  {showPreview ? t('إخفاء المعاينة', 'Hide preview') : t('معاينة الرسالة', 'Preview message')}
                </button>
                {showPreview && (
                  <div className="mt-2 p-4 rounded-xl bg-green-50 border border-green-200 text-sm whitespace-pre-wrap" dir="auto">
                    <p className="text-xs font-semibold text-green-700 mb-2">{t('معاينة:', 'Preview:')}</p>
                    {messagePreview}
                  </div>
                )}
              </div>

              {/* Manual reminder template (used by Renewals page WA buttons) */}
              <div>
                <label className="block text-sm font-medium mb-1">{t('نص الرسالة اليدوية (صفحة التجديدات)', 'Manual Reminder Template (Renewals page)')}</label>
                <p className="text-xs text-muted-foreground mb-2">{t('يُستخدم عند الضغط على زر التذكير في صفحة التجديدات. المتغيرات: {name}، {activity}، {days}، {end_date}، {fee}', 'Used when sending reminders from the Renewals page. Variables: {name}, {activity}, {days}, {end_date}, {fee}')}</p>
                <textarea value={waSettings.manual_reminder_template}
                  onChange={e => setWaSettings(s => ({ ...s, manual_reminder_template: e.target.value }))}
                  rows={5} dir="auto"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>

              {/* Expired-subscription reminder template (past-tense wording) */}
              <div>
                <label className="block text-sm font-medium mb-1">{t('نص التذكير بعد انتهاء الاشتراك', 'Expired Subscription Reminder Template')}</label>
                <p className="text-xs text-muted-foreground mb-2">{t('يُستخدم تلقائياً بدل النص اليدوي عندما يكون تاريخ انتهاء الاشتراك قد مضى (الاشتراك انتهى بتاريخ...). المتغيرات: {name}، {activity}، {days}، {end_date}، {fee}', 'Automatically used instead of the manual template when the subscription end date has already passed. Variables: {name}, {activity}, {days}, {end_date}, {fee}')}</p>
                <textarea value={waSettings.manual_reminder_expired_template}
                  onChange={e => setWaSettings(s => ({ ...s, manual_reminder_expired_template: e.target.value }))}
                  rows={5} dir="auto"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>

              {/* Welcome template for new members (used by Members page WA button) */}
              <div>
                <label className="block text-sm font-medium mb-1">{t('نص رسالة الترحيب بالعضو الجديد (صفحة الأعضاء)', 'New Member Welcome Template (Members page)')}</label>
                <p className="text-xs text-muted-foreground mb-2">{t('يُستخدم عند الضغط على زر الترحيب بجانب رقم العضو في صفحة الأعضاء. المتغيرات: {name}، {activity}، {end_date}، {fee}', 'Used when sending a welcome from the Members page WhatsApp button. Variables: {name}, {activity}, {end_date}, {fee}')}</p>
                <textarea value={waSettings.welcome_template}
                  onChange={e => setWaSettings(s => ({ ...s, welcome_template: e.target.value }))}
                  rows={5} dir="auto"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>

              {/* Push & Portal notification channels */}
              <div className="border rounded-xl p-4 space-y-4 bg-muted/30">
                <p className="text-sm font-semibold">{t('قنوات الإشعار الإضافية (تعمل دون اتصال واتساب)', 'Extra notification channels (work without WhatsApp)')}</p>

                {/* Push toggle */}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{t('إشعار Push للجوال/المتصفح', 'Mobile / Browser Push')}</p>
                    <p className="text-xs text-muted-foreground">{t('يصل للأعضاء المشتركين في الإشعارات', 'Reaches members subscribed to notifications')}</p>
                  </div>
                  <button onClick={() => setWaSettings(s => ({ ...s, push_enabled: !s.push_enabled }))}
                    className={`relative w-10 h-5 rounded-full transition-colors ${waSettings.push_enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${waSettings.push_enabled ? (isRTL ? 'right-0.5' : 'translate-x-5') : (isRTL ? 'right-5' : 'translate-x-0.5')}`} />
                  </button>
                </div>

                {waSettings.push_enabled && (
                  <div className="space-y-2 ps-2 border-s-2 border-green-400">
                    <div>
                      <label className="block text-xs font-medium mb-1">{t('عنوان الإشعار', 'Push title')}</label>
                      <input type="text" value={waSettings.push_title_template}
                        onChange={e => setWaSettings(s => ({ ...s, push_title_template: e.target.value }))}
                        className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" dir="auto" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">{t('نص الإشعار', 'Push body')}</label>
                      <p className="text-xs text-muted-foreground mb-1">{t('المتغيرات: {name}، {activity}، {days}، {end_date}', 'Variables: {name}, {activity}, {days}, {end_date}')}</p>
                      <input type="text" value={waSettings.push_body_template}
                        onChange={e => setWaSettings(s => ({ ...s, push_body_template: e.target.value }))}
                        className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" dir="auto" />
                    </div>
                  </div>
                )}

                {/* Portal toggle */}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{t('إشعار بوابة العضو', 'Member portal notification')}</p>
                    <p className="text-xs text-muted-foreground">{t('يظهر داخل تطبيق العضو في قسم الإشعارات', 'Appears inside the member app under notifications')}</p>
                  </div>
                  <button onClick={() => setWaSettings(s => ({ ...s, portal_enabled: !s.portal_enabled }))}
                    className={`relative w-10 h-5 rounded-full transition-colors ${waSettings.portal_enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${waSettings.portal_enabled ? (isRTL ? 'right-0.5' : 'translate-x-5') : (isRTL ? 'right-5' : 'translate-x-0.5')}`} />
                  </button>
                </div>
              </div>

              <Button onClick={handleSaveSettings} disabled={savingSettings} className="w-full">
                {savingSettings ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : <Settings className="w-4 h-4 me-2" />}
                {t('حفظ الإعدادات', 'Save Settings')}
              </Button>
            </div>

            {/* Test & Manual Send */}
            <div className="rounded-2xl border p-6 bg-card space-y-5">
              <div className="flex items-center gap-2">
                <PhoneCall className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-bold">{t('إرسال يدوي', 'Manual Send')}</h2>
              </div>

              {/* Test to single phone */}
              <div>
                <label className="block text-sm font-medium mb-2">{t('إرسال تجريبي لرقم محدد', 'Test send to number')}</label>
                <div className="flex gap-2">
                  <input type="text" placeholder={t('رقم الهاتف (0501234567)', 'Phone (0501234567)')}
                    value={testPhone} onChange={e => setTestPhone(e.target.value)} dir="ltr"
                    className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                  <Button onClick={handleSendTest} disabled={sendingTest || !status.connected} variant="outline">
                    {sendingTest ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    <span className="ms-1">{t('إرسال', 'Send')}</span>
                  </Button>
                </div>
                {!status.connected && <p className="text-xs text-orange-600 mt-1">{t('يجب الاتصال بواتساب أولاً', 'Connect first')}</p>}
              </div>

              {/* Send to selected members */}
              <div className="border-t pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{t('إرسال لأعضاء محددين', 'Send to Selected Members')}</p>
                  <div className="flex items-center gap-2">
                    {selectedMembers.length > 0 && (
                      <Badge variant="secondary">{selectedMembers.length} {t('محدد', 'selected')}</Badge>
                    )}
                    {!members.length && (
                      <Button variant="ghost" size="sm" onClick={loadMembers} disabled={loadingMembers}>
                        <RefreshCw className={`w-3.5 h-3.5 ${loadingMembers ? 'animate-spin' : ''}`} />
                        <span className="ms-1 text-xs">{t('تحميل', 'Load')}</span>
                      </Button>
                    )}
                  </div>
                </div>

                {/* Filters */}
                <div className="flex gap-2 flex-wrap">
                  <Filter className="w-4 h-4 text-muted-foreground self-center" />
                  <MultiSelectPopover
                    values={filterActivities}
                    onChange={setFilterActivities}
                    options={activities.filter(a => a.id).map(a => ({ id: a.id, label: isRTL ? a.name_ar : a.name }))}
                    allLabel={t('جميع الأنشطة', 'All Activities')}
                    minWidth={140}
                  />
                  <MultiSelectPopover
                    values={filterDays}
                    onChange={setFilterDays}
                    options={DAY_OPTIONS.map(d => ({ id: d.id, label: isRTL ? d.ar : d.en }))}
                    allLabel={t('جميع الأيام', 'All Days')}
                    minWidth={120}
                  />
                  {isAdmin && branches.length > 0 && (
                    <Select value={filterBranch} onValueChange={setFilterBranch}>
                      <SelectTrigger className="flex-1 min-w-[140px] h-9 text-sm"><SelectValue placeholder={t('جميع الفروع', 'All Branches')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('جميع الفروع', 'All Branches')}</SelectItem>
                        {branches.filter(b => b.id).map(b => <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Select All */}
                {filteredMembers.length > 0 && (
                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg cursor-pointer" onClick={toggleSelectAll}>
                    <Checkbox checked={selectAll} onCheckedChange={toggleSelectAll} />
                    <span className="text-sm font-medium">{t('تحديد الكل', 'Select All')}</span>
                    <span className="text-xs text-muted-foreground">({filteredMembers.length})</span>
                  </div>
                )}

                {/* Members List */}
                {loadingMembers ? (
                  <div className="py-6 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
                ) : members.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm border-2 border-dashed rounded-xl">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p>{t('اضغط "تحميل" لعرض الأعضاء', 'Press "Load" to show members')}</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[350px] overflow-y-auto">
                    {isAdmin && branches.length > 0 ? Object.keys(membersByBranch).map(bid => {
                      const bm = membersByBranch[bid];
                      const exp = expandedBranches[bid];
                      const allSel = bm.every(m => selectedMembers.includes(m.id));
                      const someSel = bm.some(m => selectedMembers.includes(m.id));
                      return (
                        <div key={bid} className="border rounded-xl overflow-hidden">
                          <div className="flex items-center justify-between p-3 bg-muted/40 cursor-pointer hover:bg-muted/60" onClick={() => toggleBranchExpanded(bid)}>
                            <div className="flex items-center gap-2">
                              <Checkbox checked={allSel} className={someSel && !allSel ? 'opacity-50' : ''}
                                onCheckedChange={e => { e.stopPropagation(); toggleBranchMembers(bid, bm); }}
                                onClick={e => e.stopPropagation()} />
                              <Building2 className="w-4 h-4 text-primary" />
                              <span className="font-semibold text-sm">{getBranchName(bid)}</span>
                              <Badge variant="secondary" className="text-xs">{bm.length}</Badge>
                            </div>
                            {exp ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </div>
                          {exp && (
                            <div className="divide-y">
                              {bm.map(m => {
                                const endDate = getMemberEndDate(m);
                                const fmt = endDate ? formatEndDate(endDate) : null;
                                return (
                                <div key={m.id}
                                  className={`flex items-center justify-between px-4 py-2.5 cursor-pointer transition-colors ${selectedMembers.includes(m.id) ? 'bg-primary/8' : 'hover:bg-muted/20'}`}
                                  onClick={() => toggleMember(m.id)}>
                                  <div className="flex items-center gap-3">
                                    <Checkbox checked={selectedMembers.includes(m.id)} onClick={e => e.stopPropagation()} onCheckedChange={() => toggleMember(m.id)} />
                                    <span className="text-sm font-medium">{isRTL ? m.name_ar : m.name}</span>
                                  </div>
                                  <div className="flex flex-col items-end gap-0.5">
                                    <span className="text-xs text-muted-foreground" dir="ltr">{m.phone}</span>
                                    {fmt && <span className={`text-xs font-medium ${fmt.color}`}>{t('ينتهي', 'ends')} {fmt.label}</span>}
                                  </div>
                                </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    }) : filteredMembers.map(m => {
                      const endDate = getMemberEndDate(m);
                      const fmt = endDate ? formatEndDate(endDate) : null;
                      return (
                      <div key={m.id}
                        className={`flex items-center justify-between px-4 py-2.5 rounded-xl border cursor-pointer transition-colors ${selectedMembers.includes(m.id) ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
                        onClick={() => toggleMember(m.id)}>
                        <div className="flex items-center gap-3">
                          <Checkbox checked={selectedMembers.includes(m.id)} onClick={e => e.stopPropagation()} onCheckedChange={() => toggleMember(m.id)} />
                          <span className="text-sm font-medium">{isRTL ? m.name_ar : m.name}</span>
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-xs text-muted-foreground" dir="ltr">{m.phone}</span>
                          {fmt && <span className={`text-xs font-medium ${fmt.color}`}>{t('ينتهي', 'ends')} {fmt.label}</span>}
                        </div>
                      </div>
                      );
                    })}
                    {filteredMembers.length === 0 && members.length > 0 && (
                      <div className="text-center py-6 text-muted-foreground text-sm">{t('لا يوجد أعضاء بهذا الفلتر', 'No members match filter')}</div>
                    )}
                  </div>
                )}

                {/* Message Composer */}
                <div className="border rounded-xl p-4 bg-muted/20 space-y-3">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-primary" />
                    <p className="text-sm font-semibold">{t('نص الرسالة', 'Message')}</p>
                  </div>

                  {/* Type selector */}
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">{t('نوع الرسالة', 'Message Type')}</label>
                    <Select value={connTabMsgType} onValueChange={handleConnTabMsgTypeChange}>
                      <SelectTrigger className="h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="template">{t('رسالة التذكير (من الإعدادات)', 'Reminder Template (from settings)')}</SelectItem>
                        <SelectItem value="custom">{t('مخصص', 'Custom')}</SelectItem>
                        <SelectItem value="payment_reminder">{t('تذكير دفع', 'Payment Reminder')}</SelectItem>
                        <SelectItem value="expiry_alert">{t('تنبيه انتهاء', 'Expiry Alert')}</SelectItem>
                        <SelectItem value="promotion">{t('عرض خاص', 'Promotion')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Template preview */}
                  {connTabMsgType === 'template' && (
                    <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm whitespace-pre-wrap text-muted-foreground" dir="auto">
                      <p className="text-xs font-semibold text-green-700 mb-1">{t('الرسالة المحفوظة:', 'Saved template:')}</p>
                      {waSettings.message_template}
                    </div>
                  )}

                  {/* Custom / preset textarea */}
                  {connTabMsgType !== 'template' && (
                    <div>
                      <Textarea
                        value={connTabCustomMsg}
                        onChange={e => setConnTabCustomMsg(e.target.value)}
                        placeholder={t('أدخل نص الرسالة...', 'Enter message text...')}
                        rows={5}
                        dir="auto"
                        className="text-sm resize-none bg-background"
                      />
                      <p className="text-xs text-muted-foreground mt-1">{connTabCustomMsg.length} {t('حرف', 'chars')}</p>
                    </div>
                  )}
                </div>

                {/* Send to selected */}
                {sendingToSelected && sendToSelectedProgress.total > 0 && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{t('جاري الإرسال...', 'Sending...')}</span>
                      <span>{sendToSelectedProgress.done} / {sendToSelectedProgress.total}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 transition-all duration-300 rounded-full"
                        style={{ width: `${(sendToSelectedProgress.done / sendToSelectedProgress.total) * 100}%` }} />
                    </div>
                  </div>
                )}
                <Button
                  onClick={handleSendToSelectedViaSession}
                  disabled={!selectedMembers.length || !status.connected || sendingToSelected}
                  className="w-full gap-2"
                >
                  {sendingToSelected ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {sendingToSelected
                    ? t(`إرسال ${sendToSelectedProgress.done}/${sendToSelectedProgress.total}...`, `Sending ${sendToSelectedProgress.done}/${sendToSelectedProgress.total}...`)
                    : t(`إرسال الرسالة لـ ${selectedMembers.length} عضو`, `Send to ${selectedMembers.length} members`)}
                </Button>
                {!status.connected && <p className="text-xs text-orange-600 -mt-1">{t('يجب الاتصال بواتساب أولاً', 'Connect first')}</p>}
              </div>

              {/* Send all reminders now */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium">{t('إرسال التذكيرات التلقائية الآن', 'Send Auto Reminders Now')}</p>
                  {targetInfo.count > 0 && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">{targetInfo.count} {t('عضو', 'members')}</span>}
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  {t(`يُرسل لأعضاء ينتهي اشتراكهم بعد ${waSettings.days_before} يوم عبر: WhatsApp (إذا متصل) + Push + بوابة العضو`,
                     `Members expiring in ${waSettings.days_before} days via: WhatsApp (if connected) + Push + Portal`)}
                </p>
                <Button onClick={handleSendNow} disabled={sendingNow} className="w-full" variant="outline">
                  {sendingNow ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : <MessageSquare className="w-4 h-4 me-2" />}
                  {t('إرسال التذكيرات الآن', 'Send Reminders Now')}
                </Button>
              </div>
            </div>

            {/* Send Log */}
            <div className="rounded-2xl border p-6 bg-card">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-primary" />
                  <h2 className="text-lg font-bold">{t('سجل الإرسال', 'Send History')}</h2>
                  {sendLogs.length > 0 && <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{sendLogs.length}</span>}
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { loadSendLogs(); setShowLogs(true); }} disabled={loadingLogs}>
                    <RefreshCw className={`w-4 h-4 ${loadingLogs ? 'animate-spin' : ''}`} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowLogs(p => !p)}>{showLogs ? t('إخفاء', 'Hide') : t('عرض', 'Show')}</Button>
                </div>
              </div>
              {showLogs && (
                loadingLogs ? <div className="text-center py-6"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div> :
                sendLogs.length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">{t('لا توجد رسائل بعد', 'No messages yet')}</div> :
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b">
                      <th className="text-start py-2 pe-4 font-medium text-muted-foreground">{t('الوقت', 'Time')}</th>
                      <th className="text-start py-2 pe-4 font-medium text-muted-foreground">{t('العضو', 'Member')}</th>
                      <th className="text-start py-2 pe-4 font-medium text-muted-foreground">{t('النشاط', 'Activity')}</th>
                      <th className="text-center py-2 font-medium text-muted-foreground">{t('الحالة', 'Status')}</th>
                    </tr></thead>
                    <tbody>{sendLogs.map((log, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="py-2 pe-4 text-xs text-muted-foreground whitespace-nowrap">{new Date(log.timestamp).toLocaleString(isRTL ? 'ar-SA' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td className="py-2 pe-4 font-medium">{log.member_name}</td>
                        <td className="py-2 pe-4 text-muted-foreground">{log.activities}</td>
                        <td className="py-2 text-center">
                          {log.success ? <span className="inline-flex items-center gap-1 text-green-600 text-xs"><CheckCircle2 className="w-3.5 h-3.5" />{t('نجح', 'Sent')}</span>
                            : <span className="inline-flex items-center gap-1 text-red-500 text-xs"><XCircle className="w-3.5 h-3.5" />{t('فشل', 'Failed')}</span>}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {!showLogs && sendLogs.length > 0 && (
                <p className="text-xs text-muted-foreground">{t(`${sendLogs.length} رسالة — آخرها: ${new Date(sendLogs[0].timestamp).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' })}`, `${sendLogs.length} entries — latest: ${new Date(sendLogs[0].timestamp).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}`)}</p>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════
            TAB 2: MANUAL WHATSAPP MESSAGES
        ══════════════════════════════════════════ */}
        {activeTab === 'manual' && (
          <div className="space-y-4">
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-700">{t('سيتم فتح واتساب لكل مستلم على حدة. للإرسال الجماعي التلقائي استخدم تبويب "واتساب" مع الربط بالجلسة.', 'WhatsApp will open for each recipient separately. For automated bulk sending, use the WhatsApp tab.')}</p>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recipients */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><Users className="w-5 h-5 text-primary" />{t('اختر المستلمين', 'Select Recipients')}</div>
                    <Badge variant="outline">{selectedMembers.length} {t('محدد', 'selected')}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    <Filter className="w-4 h-4 text-muted-foreground self-center" />
                    <MultiSelectPopover
                      values={filterActivities}
                      onChange={setFilterActivities}
                      options={activities.filter(a => a.id).map(a => ({ id: a.id, label: isRTL ? a.name_ar : a.name }))}
                      allLabel={t('جميع الأنشطة', 'All Activities')}
                      minWidth={140}
                    />
                    <MultiSelectPopover
                      values={filterDays}
                      onChange={setFilterDays}
                      options={DAY_OPTIONS.map(d => ({ id: d.id, label: isRTL ? d.ar : d.en }))}
                      allLabel={t('جميع الأيام', 'All Days')}
                      minWidth={120}
                    />
                    {isAdmin && branches.length > 0 && (
                      <Select value={filterBranch} onValueChange={setFilterBranch}>
                        <SelectTrigger className="flex-1 min-w-[140px]"><SelectValue placeholder={t('الفروع', 'Branches')} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t('جميع الفروع', 'All Branches')}</SelectItem>
                          {branches.filter(b => b.id).map(b => <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg cursor-pointer" onClick={toggleSelectAll}>
                    <Checkbox checked={selectAll} onClick={e => e.stopPropagation()} onCheckedChange={toggleSelectAll} />
                    <span className="font-medium text-sm">{t('تحديد الكل', 'Select All')}</span>
                    <span className="text-xs text-muted-foreground">({filteredMembers.length})</span>
                  </div>

                  {loadingMembers ? <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div> : (
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {isAdmin && branches.length > 0 ? Object.keys(membersByBranch).map(bid => {
                        const bm = membersByBranch[bid];
                        const exp = expandedBranches[bid];
                        const allSel = bm.every(m => selectedMembers.includes(m.id));
                        const someSel = bm.some(m => selectedMembers.includes(m.id));
                        return (
                          <div key={bid} className="border rounded-lg overflow-hidden">
                            <div className="flex items-center justify-between p-3 bg-muted/30 cursor-pointer hover:bg-muted/50" onClick={() => toggleBranchExpanded(bid)}>
                              <div className="flex items-center gap-2">
                                <Checkbox checked={allSel} className={someSel && !allSel ? 'opacity-50' : ''} onCheckedChange={e => { e.stopPropagation(); toggleBranchMembers(bid, bm); }} onClick={e => e.stopPropagation()} />
                                <Building2 className="w-4 h-4 text-primary" />
                                <span className="font-semibold text-sm">{getBranchName(bid)}</span>
                                <Badge variant="secondary" className="text-xs">{bm.length}</Badge>
                              </div>
                              {exp ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </div>
                            {exp && <div className="divide-y">{bm.map(m => (
                              <div key={m.id} className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${selectedMembers.includes(m.id) ? 'bg-primary/5' : 'hover:bg-muted/20'}`} onClick={() => toggleMember(m.id)}>
                                <div className="flex items-center gap-2">
                                  <Checkbox checked={selectedMembers.includes(m.id)} onClick={e => e.stopPropagation()} onCheckedChange={() => toggleMember(m.id)} />
                                  <span className="text-sm font-medium">{isRTL ? m.name_ar : m.name}</span>
                                </div>
                                <span className="text-xs text-muted-foreground" dir="ltr">{m.phone}</span>
                              </div>
                            ))}</div>}
                          </div>
                        );
                      }) : filteredMembers.map(m => (
                        <div key={m.id} className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer ${selectedMembers.includes(m.id) ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`} onClick={() => toggleMember(m.id)}>
                          <div className="flex items-center gap-2">
                            <Checkbox checked={selectedMembers.includes(m.id)} onClick={e => e.stopPropagation()} onCheckedChange={() => toggleMember(m.id)} />
                            <span className="text-sm font-medium">{isRTL ? m.name_ar : m.name}</span>
                          </div>
                          <span className="text-xs text-muted-foreground" dir="ltr">{m.phone}</span>
                        </div>
                      ))}
                      {filteredMembers.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">{t('لا يوجد أعضاء', 'No members')}</div>}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Compose */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-primary" />{t('نص الرسالة', 'Message')}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t('نوع الرسالة', 'Message Type')}</label>
                    <Select value={messageType} onValueChange={handleMessageTypeChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="custom">{t('مخصص', 'Custom')}</SelectItem>
                        <SelectItem value="payment_reminder">{t('تذكير دفع', 'Payment Reminder')}</SelectItem>
                        <SelectItem value="expiry_alert">{t('تنبيه انتهاء', 'Expiry Alert')}</SelectItem>
                        <SelectItem value="promotion">{t('عرض خاص', 'Promotion')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Textarea value={waMessage} onChange={e => setWaMessage(e.target.value)} placeholder={t('أدخل نص الرسالة...', 'Enter message...')} rows={7} dir="auto" />
                    <p className="text-xs text-muted-foreground mt-1">{waMessage.length} {t('حرف', 'chars')}</p>
                  </div>
                  {waMessage && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm whitespace-pre-wrap" dir="auto">
                      <p className="text-xs font-medium text-green-700 mb-1">{t('معاينة:', 'Preview:')}</p>
                      {waMessage}
                    </div>
                  )}
                  <Button className="w-full gap-2" onClick={handleSendWaMessage} disabled={!selectedMembers.length || !waMessage.trim()}>
                    <Send className="w-4 h-4" />
                    {t('إرسال', 'Send')} ({selectedMembers.length})
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════
            TAB: ACTIVITY / LEVEL NOTIFICATION
        ══════════════════════════════════════════ */}
        {activeTab === 'activity_notif' && (
          <div className="max-w-xl space-y-6">
            <div className="rounded-2xl border p-6 bg-card space-y-5">
              <div className="flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-bold">{t('إشعار جماعي لأعضاء نشاط / مستوى', 'Bulk Notification for Activity / Level')}</h2>
              </div>

              {/* Branch selector — admin only */}
              {isAdmin && branches.length > 0 && (
                <div>
                  <label className="block text-sm font-medium mb-1">🏢 {t('الفرع', 'Branch')}</label>
                  <select
                    value={actNotifBranch}
                    onChange={e => setActNotifBranch(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background"
                  >
                    <option value="">{t('جميع الفروع', 'All Branches')}</option>
                    {branches.filter(b => b.id).map(b => (
                      <option key={b.id} value={b.id}>{b.name_ar || b.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Activity selector — same optgroup structure as SchedulePage */}
              <div>
                <label className="block text-sm font-medium mb-1">🏃 {t('النشاط', 'Activity')}</label>
                <select value={actNotifActivity} onChange={e => setActNotifActivity(e.target.value)}
                  disabled={actNotifLoadingActivities}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background disabled:opacity-60">
                  <option value="">{actNotifLoadingActivities ? t('جاري التحميل...', 'Loading...') : t('— اختر النشاط —', '— Select Activity —')}</option>

                  {/* Swimming group */}
                  {actNotifAllActivities.some(a => (a.name||'').includes('سباح') || (a.name||'').toLowerCase().includes('swim')) && (
                    <optgroup label={t('🏊 السباحة', '🏊 Swimming')}>
                      <option value="سباح">{t('🏊 كل السباحة', '🏊 All Swimming')}</option>
                      {actNotifAllActivities
                        .filter(a => (a.name||'').includes('سباح') || (a.name||'').toLowerCase().includes('swim'))
                        .map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                    </optgroup>
                  )}

                  {/* Football group */}
                  {actNotifAllActivities.some(a => (a.name||'').includes('قدم') || (a.name||'').toLowerCase().includes('football')) && (
                    <optgroup label={t('⚽ كرة القدم', '⚽ Football')}>
                      <option value="قدم">{t('⚽ كل كرة القدم', '⚽ All Football')}</option>
                      {actNotifAllActivities
                        .filter(a => (a.name||'').includes('قدم') || (a.name||'').toLowerCase().includes('football'))
                        .map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                    </optgroup>
                  )}

                  {/* Karate group */}
                  {actNotifAllActivities.some(a => (a.name||'').includes('كارات') || (a.name||'').toLowerCase().includes('karate')) && (
                    <optgroup label={t('🥋 الكاراتيه', '🥋 Karate')}>
                      <option value="كارات">{t('🥋 كل الكاراتيه', '🥋 All Karate')}</option>
                      {actNotifAllActivities
                        .filter(a => (a.name||'').includes('كارات') || (a.name||'').toLowerCase().includes('karate'))
                        .map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                    </optgroup>
                  )}

                  {/* Other activities */}
                  {actNotifAllActivities.filter(a => {
                    const n = (a.name||'').toLowerCase();
                    return !n.includes('سباح') && !n.includes('swim') &&
                           !n.includes('قدم') && !n.includes('football') &&
                           !n.includes('كارات') && !n.includes('karate');
                  }).length > 0 && (
                    <optgroup label={t('📋 أنشطة أخرى', '📋 Other')}>
                      {actNotifAllActivities
                        .filter(a => {
                          const n = (a.name||'').toLowerCase();
                          return !n.includes('سباح') && !n.includes('swim') &&
                                 !n.includes('قدم') && !n.includes('football') &&
                                 !n.includes('كارات') && !n.includes('karate');
                        })
                        .map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Level selector */}
              {actNotifActivity && (
                <div>
                  <label className="block text-sm font-medium mb-1">{t('المستوى', 'Level')}</label>
                  <select value={actNotifLevel} onChange={e => setActNotifLevel(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background">
                    <option value="all">{t('جميع المستويات', 'All Levels')}</option>
                    {actNotifLevels.map(l => {
                      // Extract time slot from compound activity_name e.g. "السباحة - 8:00-9:00"
                      const parts = (l.activity_name || '').split(' - ');
                      const timeSlot = parts.length > 1 ? parts.slice(1).join(' - ') : '';
                      const label = [
                        timeSlot || l.activity_name,
                        l.custom_name ? `(${l.custom_name})` : `${t('مستوى', 'Level')} ${l.level_number}`,
                        `— ${(l.members || []).length} ${t('عضو', 'members')}`,
                      ].filter(Boolean).join(' ');
                      return (
                        <option key={l.id} value={l.id}>{label}</option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Member count + active filter + list */}
              {actNotifActivity && (
                <div className="space-y-2">
                  {/* Active-only toggle + count */}
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
                      <input
                        type="checkbox"
                        checked={actNotifActiveOnly}
                        onChange={e => setActNotifActiveOnly(e.target.checked)}
                        className="accent-primary w-4 h-4"
                      />
                      {t('نشطين فقط (اشتراك سارٍ)', 'Active subscribers only')}
                    </label>
                    {actNotifLoadingMembers
                      ? <span className="text-xs text-muted-foreground">{t('جاري التحقق...', 'Checking...')}</span>
                      : actNotifMembers.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {actNotifActiveOnly
                            ? t(`${actNotifFilteredMembers.length} نشط من ${actNotifMembers.length}`, `${actNotifFilteredMembers.length} active of ${actNotifMembers.length}`)
                            : t(`${actNotifMembers.length} عضو`, `${actNotifMembers.length} members`)}
                        </span>
                      )}
                  </div>

                  {/* Count badge */}
                  {!actNotifLoadingMembers && (
                    <div
                      className={`flex items-center justify-between gap-2 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer ${actNotifFilteredMembers.length > 0 ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-gray-50 text-gray-500 border'}`}
                      onClick={() => setActNotifShowList(v => !v)}
                    >
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        {t(`عدد الأعضاء المستهدفين: ${actNotifFilteredMembers.length}`, `Target members: ${actNotifFilteredMembers.length}`)}
                      </div>
                      <span className="text-xs opacity-60">{actNotifShowList ? '▲' : '▼'} {t('عرض', 'Show')}</span>
                    </div>
                  )}

                  {/* Member list */}
                  {actNotifShowList && actNotifFilteredMembers.length > 0 && (
                    <div className="border rounded-xl overflow-hidden">
                      <div className="max-h-48 overflow-y-auto divide-y text-sm">
                        {actNotifFilteredMembers.map((m, i) => (
                          <div key={m.member_id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40">
                            <span className="text-xs text-muted-foreground w-6 text-center">{i + 1}</span>
                            <div className="flex-1">
                              <p className="font-medium leading-none">{m.name || m.member_id}</p>
                              {m.phone && <p className="text-xs text-muted-foreground mt-0.5">{m.phone}</p>}
                            </div>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${m.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                              {m.is_active ? t('نشط', 'Active') : t('منتهي', 'Expired')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Channel toggle */}
              <div>
                <label className="block text-sm font-medium mb-2">{t('قناة الإرسال', 'Channel')}</label>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setActNotifChannel('push')}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${actNotifChannel === 'push' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'}`}>
                    <Megaphone className="w-4 h-4 inline me-1" />
                    {t('Push (جوال/متصفح)', 'Push')}
                  </button>
                  <button onClick={() => setActNotifChannel('portal')}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${actNotifChannel === 'portal' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'}`}>
                    <Bell className="w-4 h-4 inline me-1" />
                    {t('بوابة العضو', 'Portal')}
                  </button>
                  <button onClick={() => setActNotifChannel('whatsapp')}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${actNotifChannel === 'whatsapp' ? 'bg-green-600 text-white border-green-600' : 'bg-background hover:bg-muted'}`}>
                    <span className="inline me-1">📱</span>
                    {t('واتساب', 'WhatsApp')}
                    {!status.connected && actNotifChannel === 'whatsapp' && (
                      <span className="ms-1 text-xs opacity-80">{t('(غير متصل)', '(offline)')}</span>
                    )}
                  </button>
                </div>
              </div>

              {/* WhatsApp progress */}
              {actNotifChannel === 'whatsapp' && actNotifWaProgress.total > 0 && (
                <div className="space-y-1">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${(actNotifWaProgress.done / actNotifWaProgress.total) * 100}%` }} />
                  </div>
                  <p className="text-xs text-center text-muted-foreground">
                    {t(`جاري الإرسال... ${actNotifWaProgress.done} / ${actNotifWaProgress.total}`, `Sending... ${actNotifWaProgress.done} / ${actNotifWaProgress.total}`)}
                  </p>
                </div>
              )}

              {/* Priority (portal only) */}
              {actNotifChannel === 'portal' && (
                <div>
                  <label className="block text-sm font-medium mb-1">{t('الأولوية', 'Priority')}</label>
                  <select value={actNotifPriority} onChange={e => setActNotifPriority(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background">
                    <option value="info">{t('عادي', 'Info')}</option>
                    <option value="warning">{t('تحذير', 'Warning')}</option>
                    <option value="danger">{t('عاجل', 'Urgent')}</option>
                  </select>
                </div>
              )}

              {/* Title — hidden for WhatsApp */}
              {actNotifChannel !== 'whatsapp' && (
                <div>
                  <label className="block text-sm font-medium mb-1">{t('عنوان الإشعار', 'Notification Title')}</label>
                  <input type="text" value={actNotifTitle} onChange={e => setActNotifTitle(e.target.value)}
                    placeholder={t('مثال: موعد التدريب القادم', 'e.g. Upcoming training session')}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" dir="auto" />
                </div>
              )}

              {/* Body */}
              <div>
                <label className="block text-sm font-medium mb-1">{t('نص الإشعار', 'Notification Body')}</label>
                <textarea value={actNotifBody} onChange={e => setActNotifBody(e.target.value)}
                  placeholder={t('اكتب نص الرسالة هنا...', 'Write message here...')}
                  rows={4} dir="auto"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>

              {/* Send button */}
              <Button onClick={handleSendActivityNotif}
                disabled={actNotifSending || !actNotifActivity || !actNotifTitle.trim() || !actNotifBody.trim() || actNotifMemberCount === 0}
                className="w-full">
                {actNotifSending ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : <Send className="w-4 h-4 me-2" />}
                {actNotifMemberCount === 0
                  ? t('لا يوجد أعضاء في هذا المستوى', 'No members in this level')
                  : t(`إرسال${actNotifMemberCount !== null ? ` لـ ${actNotifMemberCount} عضو` : ''}`, `Send${actNotifMemberCount !== null ? ` to ${actNotifMemberCount} members` : ''}`)}
              </Button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════
            TAB 3: PORTAL NOTIFICATIONS
        ══════════════════════════════════════════ */}
        {activeTab === 'portal' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Megaphone className="w-5 h-5 text-primary" />{t('إرسال إشعار جديد', 'Send New Notification')}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">{t('عنوان الإشعار', 'Title')}</label>
                  <Input value={notifTitle} onChange={e => setNotifTitle(e.target.value)} placeholder={t('مثال: عرض خاص!', 'e.g. Special Offer!')} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">{t('نص الإشعار', 'Message')}</label>
                  <Textarea value={notifMessage} onChange={e => setNotifMessage(e.target.value)} placeholder={t('اكتب رسالة الإشعار هنا...', 'Write message...')} rows={4} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t('نوع الإشعار', 'Type')}</label>
                    <Select value={notifType} onValueChange={setNotifType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="announcement"><span className="flex items-center gap-2"><Megaphone className="w-4 h-4" />{t('إعلان', 'Announcement')}</span></SelectItem>
                        <SelectItem value="offer"><span className="flex items-center gap-2"><Gift className="w-4 h-4" />{t('عرض', 'Offer')}</span></SelectItem>
                        <SelectItem value="reminder"><span className="flex items-center gap-2"><Clock className="w-4 h-4" />{t('تذكير', 'Reminder')}</span></SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t('الأهمية', 'Priority')}</label>
                    <Select value={notifPriority} onValueChange={setNotifPriority}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info"><span className="flex items-center gap-2"><Info className="w-4 h-4 text-blue-500" />{t('عادي', 'Normal')}</span></SelectItem>
                        <SelectItem value="warning"><span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-500" />{t('مهم', 'Important')}</span></SelectItem>
                        <SelectItem value="danger"><span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" />{t('عاجل', 'Urgent')}</span></SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">{t('المستلم', 'Target')}</label>
                  <Select value={notifTarget} onValueChange={setNotifTarget}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all_members"><span className="flex items-center gap-2"><Users className="w-4 h-4" />{t('جميع الأعضاء', 'All Members')}</span></SelectItem>
                      <SelectItem value="specific_member"><span className="flex items-center gap-2"><User className="w-4 h-4" />{t('عضو محدد', 'Specific Member')}</span></SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {notifTarget === 'specific_member' && (
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t('اختر العضو', 'Select Member')}</label>
                    <Select value={notifTargetMemberId} onValueChange={setNotifTargetMemberId}>
                      <SelectTrigger><SelectValue placeholder={t('اختر عضو...', 'Select member...')} /></SelectTrigger>
                      <SelectContent>{members.filter(m => m.id).map(m => <SelectItem key={m.id} value={m.id}>{m.name_ar || m.name} - #{m.member_code}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <Button onClick={handleSendPortalNotification} className="w-full gap-2" disabled={sendingNotif}>
                  <Send className="w-4 h-4" />
                  {sendingNotif ? t('جاري الإرسال...', 'Sending...') : t('إرسال الإشعار', 'Send Notification')}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-primary" />
                  {t('الإشعارات المرسلة', 'Sent Notifications')}
                  <Badge variant="outline">{portalNotifications.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {portalNotifications.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground"><Bell className="w-12 h-12 mx-auto mb-2 opacity-30" /><p className="text-sm">{t('لا توجد إشعارات', 'No notifications')}</p></div>
                  ) : portalNotifications.map(n => (
                    <div key={n.id} className={`p-3 rounded-lg border ${n.priority === 'danger' ? 'bg-red-50 border-red-200' : n.priority === 'warning' ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm">{n.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="secondary" className="text-xs">{n.notification_type}</Badge>
                            <span className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleDateString(isRTL ? 'ar-SA' : 'en-US')}</span>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 shrink-0" onClick={() => handleDeletePortalNotification(n.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════════
            TAB 4: INTERNAL MESSAGES
        ══════════════════════════════════════════ */}
        {activeTab === 'internal' && (
          <div className="space-y-4 max-w-4xl">
            <div className="flex items-center justify-between">
              <div>
                {selectedThread && (
                  <Button variant="outline" size="sm" onClick={() => { setSelectedThread(null); setThreadMessages([]); setThreadMember(null); }}>
                    {isRTL ? <ArrowRight className="w-4 h-4 me-1" /> : <ArrowLeft className="w-4 h-4 me-1" />}
                    {t('رجوع', 'Back')}
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadConversations}><RefreshCcw className="w-4 h-4" /></Button>
                {!selectedThread && (
                  <Button size="sm" onClick={() => setShowCompose(p => !p)} className="gap-2">
                    <Send className="w-4 h-4" />{t('رسالة جديدة', 'New Message')}
                  </Button>
                )}
              </div>
            </div>

            {showCompose && !selectedThread && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Send className="w-5 h-5 text-primary" />{t('إرسال رسالة جديدة', 'New Message')}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Checkbox id="bc" checked={newMsgBroadcast} onCheckedChange={c => { setNewMsgBroadcast(c); setNewMsgRecipient(''); }} />
                    <label htmlFor="bc" className="text-sm font-medium cursor-pointer">{t('إرسال لجميع الأعضاء', 'Broadcast to all')}</label>
                  </div>
                  {!newMsgBroadcast && (
                    <div>
                      <label className="text-sm font-medium mb-1 block">{t('العضو المستلم', 'Recipient')}</label>
                      <Select value={newMsgRecipient} onValueChange={setNewMsgRecipient}>
                        <SelectTrigger><SelectValue placeholder={t('اختر عضو...', 'Select member...')} /></SelectTrigger>
                        <SelectContent>{members.filter(m => m.id).map(m => <SelectItem key={m.id} value={m.id}>{m.name_ar || m.name} - #{m.member_code}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t('الموضوع', 'Subject')}</label>
                    <Input value={newMsgSubject} onChange={e => setNewMsgSubject(e.target.value)} placeholder={t('موضوع الرسالة', 'Subject')} />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t('نص الرسالة', 'Message')}</label>
                    <Textarea value={newMsgBody} onChange={e => setNewMsgBody(e.target.value)} rows={4} placeholder={t('اكتب رسالتك...', 'Write message...')} />
                  </div>
                  <Button onClick={handleSendInternalMessage} disabled={sendingMsg} className="w-full gap-2">
                    <Send className="w-4 h-4" />
                    {sendingMsg ? t('جاري الإرسال...', 'Sending...') : t('إرسال', 'Send')}
                  </Button>
                </CardContent>
              </Card>
            )}

            {!selectedThread && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="w-5 h-5 text-primary" />{t('المحادثات', 'Conversations')}
                    {msgUnreadCount > 0 && <Badge variant="destructive">{msgUnreadCount} {t('غير مقروءة', 'unread')}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingConversations ? <div className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div> :
                   conversations.length === 0 ? <div className="text-center py-12 text-muted-foreground"><Mail className="w-16 h-16 mx-auto mb-3 opacity-20" /><p>{t('لا توجد محادثات', 'No conversations')}</p></div> :
                   <div className="space-y-2">{conversations.map(conv => (
                    <div key={conv.member_id} onClick={() => openThread(conv.member_id)}
                      className={`p-4 rounded-lg border cursor-pointer transition-colors hover:bg-accent/50 ${conv.unread_count > 0 ? 'border-primary/50 bg-primary/5' : 'border-border'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User className="w-5 h-5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold truncate">{conv.member_name || conv.recipient_name}</p>
                              {conv.member_code && <Badge variant="outline" className="text-xs">#{conv.member_code}</Badge>}
                            </div>
                            <p className="text-sm text-muted-foreground truncate">
                              {conv.last_sender_type === 'member' ? t('العضو: ', 'Member: ') : t('أنت: ', 'You: ')}{conv.last_message}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0 ms-2">
                          <span className="text-xs text-muted-foreground">{new Date(conv.last_date).toLocaleDateString('ar-SA')}</span>
                          {conv.unread_count > 0 && <Badge variant="destructive" className="text-xs">{conv.unread_count}</Badge>}
                        </div>
                      </div>
                    </div>
                  ))}</div>}
                </CardContent>
              </Card>
            )}

            {selectedThread && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5 text-primary" />
                    <button
                      type="button"
                      onClick={() => selectedThread && navigate(`/admin/members?focus=${selectedThread}`)}
                      className="hover:underline hover:text-primary transition-colors"
                      title={t('فتح ملف العضو', 'Open member profile')}
                    >
                      {threadMember?.name}
                    </button>
                    {threadMember?.member_code && <Badge variant="outline" className="text-xs">#{threadMember.member_code}</Badge>}
                    {threadMember?.phone && <span className="text-sm text-muted-foreground font-normal" dir="ltr">{threadMember.phone}</span>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-[400px] overflow-y-auto mb-4 p-2">
                    {threadMessages.length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">{t('لا توجد رسائل', 'No messages')}</div> :
                     threadMessages.map(msg => (
                      <div key={msg.id} className={`p-3 rounded-lg max-w-[80%] ${msg.sender_type === 'admin' ? 'bg-primary/10 border border-primary/20 me-auto' : 'bg-accent border border-border ms-auto'}`}>
                        <p className="text-xs font-medium mb-1 text-muted-foreground">{msg.sender_type === 'admin' ? t('أنت', 'You') : threadMember?.name}</p>
                        {msg.subject && <p className="text-xs font-bold mb-1">{msg.subject}</p>}
                        <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                        <p className="text-xs text-muted-foreground mt-1">{new Date(msg.created_at).toLocaleString(isRTL ? 'ar-SA' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 border-t pt-3">
                    <Textarea value={replyText} onChange={e => setReplyText(e.target.value)} rows={2} placeholder={t('اكتب ردك...', 'Write reply...')} className="resize-none flex-1" />
                    <Button onClick={handleReplyInThread} disabled={sendingMsg || !replyText.trim()} className="self-end">
                      {sendingMsg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════
            TAB 5: PUSH NOTIFICATIONS
        ══════════════════════════════════════════ */}
        {activeTab === 'push' && (
          <div className="space-y-6 max-w-2xl">
            <Card className="bg-blue-50 border-blue-200 cursor-pointer hover:bg-blue-100 hover:shadow-md transition-all" onClick={handleShowPushSubscribers}>
              <CardContent className="p-4 text-center">
                <Users className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                <p className="text-2xl font-bold text-blue-700">{pushSubscribersCount}</p>
                <p className="text-sm text-blue-600">{t('مشترك في الإشعارات', 'Active Subscribers')}</p>
                <p className="text-xs text-blue-400 mt-1">{t('اضغط لعرض القائمة', 'Click to view list')}</p>
              </CardContent>
            </Card>

            <Dialog open={showPushSubscribers} onOpenChange={setShowPushSubscribers}>
              <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-600" />
                    {t(`المشتركون (${pushSubscribers.length})`, `Subscribers (${pushSubscribers.length})`)}
                  </DialogTitle>
                </DialogHeader>
                <div className="overflow-y-auto flex-1">
                  {loadingPushSubscribers ? <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div> :
                   pushSubscribers.length === 0 ? <div className="text-center py-12 text-muted-foreground">{t('لا يوجد مشتركين', 'No subscribers')}</div> :
                   <div className="space-y-2 p-1">{pushSubscribers.map((sub, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border hover:bg-blue-50">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center"><Users className="w-4 h-4 text-blue-600" /></div>
                        <div>
                          <p className="font-medium text-sm text-blue-700">{sub.name}</p>
                          {sub.phone && <p className="text-xs text-muted-foreground" dir="ltr"><Phone className="w-3 h-3 inline me-1" />{sub.phone}</p>}
                        </div>
                      </div>
                      {sub.branch_id && getBranchName(sub.branch_id) && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">{getBranchName(sub.branch_id)}</span>
                      )}
                    </div>
                  ))}</div>}
                </div>
              </DialogContent>
            </Dialog>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Send className="w-5 h-5" />{t('إرسال إشعار جماعي', 'Broadcast Notification')}</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={handleSendPush} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">{t('العنوان', 'Title')} *</label>
                    <Input value={pushForm.title} onChange={e => setPushForm({ ...pushForm, title: e.target.value })} placeholder={t('عنوان الإشعار...', 'Notification title...')} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">{t('المحتوى', 'Body')} *</label>
                    <Textarea value={pushForm.body} onChange={e => setPushForm({ ...pushForm, body: e.target.value })} rows={3} placeholder={t('محتوى الإشعار...', 'Notification body...')} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">{t('رابط الفتح (اختياري)', 'Open URL (optional)')}</label>
                    <Input value={pushForm.url} onChange={e => setPushForm({ ...pushForm, url: e.target.value })} placeholder="/" dir="ltr" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">{t('الفرع (اتركه فارغاً للكل)', 'Branch (empty = all)')}</label>
                    <Select value={pushForm.branch_id} onValueChange={v => setPushForm({ ...pushForm, branch_id: v === 'all' ? '' : v })}>
                      <SelectTrigger><SelectValue placeholder={t('جميع الفروع', 'All branches')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('جميع الفروع', 'All branches')}</SelectItem>
                        {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" disabled={pushSending} className="w-full gap-2">
                    {pushSending ? <><Loader2 className="w-4 h-4 animate-spin" />{t('جاري الإرسال...', 'Sending...')}</> : <><Send className="w-4 h-4" />{t('إرسال الإشعار', 'Send Notification')}</>}
                  </Button>
                </form>
                {pushResult && (
                  <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2 text-green-700 font-bold mb-2">
                      <CheckCircle className="w-5 h-5" />{t('تم الإرسال', 'Sent Successfully')}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-sm text-center">
                      <div><p className="font-bold">{pushResult.total}</p><p className="text-muted-foreground">{t('الإجمالي', 'Total')}</p></div>
                      <div><p className="font-bold text-green-600">{pushResult.success}</p><p className="text-muted-foreground">{t('نجح', 'Success')}</p></div>
                      <div><p className="font-bold text-red-600">{pushResult.failed}</p><p className="text-muted-foreground">{t('فشل', 'Failed')}</p></div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

      </div>
    </Layout>
  );
}
