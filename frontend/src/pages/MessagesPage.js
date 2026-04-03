import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
 
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { membersAPI, activitiesAPI, branchesAPI, messagesAPI } from '../services/api';
import { toast } from 'sonner';
import { 
  MessageSquare, 
  Send,
  Users,
  Filter,
  Phone,
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronUp,
  Bell,
  Trash2,
  Megaphone,
  Gift,
  Clock,
  Info,
  Mail,
  ArrowRight,
  ArrowLeft,
  RefreshCcw,
  User
} from 'lucide-react';

export const MessagesPage = () => {
  const { t, language } = useLanguage();
  const { user, selectedBranchId } = useAuth();
  const isAdmin = user?.is_admin === true;
  const [activeTab, setActiveTab] = useState('whatsapp');
  const [members, setMembers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('custom');
  const [filterActivity, setFilterActivity] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [selectAll, setSelectAll] = useState(false);
  const [expandedBranches, setExpandedBranches] = useState({});
  
  // Portal Notifications State
  const [portalNotifications, setPortalNotifications] = useState([]);
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifTarget, setNotifTarget] = useState('all_members');
  const [notifTargetMemberId, setNotifTargetMemberId] = useState('');
  const [notifPriority, setNotifPriority] = useState('info');
  const [notifType, setNotifType] = useState('announcement');
  const [sendingNotif, setSendingNotif] = useState(false);

  // Internal Messages State
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

  const messageTemplates = {
    payment_reminder: {
      ar: 'السلام عليكم، نود تذكيركم بموعد سداد رسوم الاشتراك في شركة اداء الابطال العالمية للرياضة. نرجو التواصل معنا لمزيد من التفاصيل.',
      en: 'Hello, this is a reminder about your subscription payment at Champions Performance Academy. Please contact us for more details.'
    },
    expiry_alert: {
      ar: 'السلام عليكم، نود إعلامكم بأن اشتراككم في شركة اداء الابطال العالمية للرياضة سينتهي قريباً. يرجى التواصل معنا لتجديد الاشتراك.',
      en: 'Hello, your subscription at Champions Performance Academy is expiring soon. Please contact us to renew.'
    },
    promotion: {
      ar: 'السلام عليكم، نقدم لكم عروضاً خاصة في شركة اداء الابطال العالمية للرياضة. تواصلوا معنا للاستفادة من هذه العروض!',
      en: 'Hello, we have special offers at Champions Performance Academy. Contact us to learn more!'
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedBranchId]);

  useEffect(() => {
    if (activeTab === 'portal') {
      loadPortalNotifications();
    }
    if (activeTab === 'internal') {
      loadConversations();
    }
  }, [activeTab]);

  const loadPortalNotifications = async () => {
    try {
      const token = localStorage.getItem('token');
      const API_URL = '';
      const res = await fetch(`${API_URL}/api/member-notifications`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPortalNotifications(data);
      }
    } catch (error) {
      console.error('Failed to load portal notifications:', error);
    }
  };

  const handleSendPortalNotification = async () => {
    if (!notifTitle.trim() || !notifMessage.trim()) {
      toast.error('يرجى إدخال العنوان والرسالة');
      return;
    }
    if (notifTarget === 'specific_member' && !notifTargetMemberId) {
      toast.error('يرجى اختيار العضو');
      return;
    }

    setSendingNotif(true);
    try {
      const token = localStorage.getItem('token');
      const API_URL = '';
      const res = await fetch(`${API_URL}/api/member-notifications`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({
          title: notifTitle,
          message: notifMessage,
          target: notifTarget,
          target_member_id: notifTargetMemberId || null,
          priority: notifPriority,
          notification_type: notifType
        })
      });
      
      if (res.ok) {
        toast.success('تم إرسال الإشعار بنجاح');
        setNotifTitle('');
        setNotifMessage('');
        setNotifTargetMemberId('');
        loadPortalNotifications();
      } else {
        toast.error('فشل إرسال الإشعار');
      }
    } catch (error) {
      toast.error('حدث خطأ');
    } finally {
      setSendingNotif(false);
    }
  };

  const handleDeletePortalNotification = async (notifId) => {
    try {
      const token = localStorage.getItem('token');
      const API_URL = '';
      const res = await fetch(`${API_URL}/api/member-notifications/${notifId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (res.ok) {
        toast.success('تم حذف الإشعار');
        loadPortalNotifications();
      }
    } catch (error) {
      toast.error('حدث خطأ');
    }
  };

  const loadData = async () => {
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const [membersRes, activitiesRes, branchesRes] = await Promise.all([
        membersAPI.getAll(branchParams),
        activitiesAPI.getAll(),
        isAdmin ? branchesAPI.getAll() : Promise.resolve({ data: [] })
      ]);
      setMembers(membersRes.data);
      setActivities(activitiesRes.data);
      setBranches(branchesRes.data || []);
      
      // Initialize all branches as expanded
      const expanded = {};
      (branchesRes.data || []).forEach(b => { expanded[b.id] = true; });
      expanded['no_branch'] = true;
      setExpandedBranches(expanded);
    } catch (error) {
      console.error('Failed to load data:', error);
      toast.error(t('error'));
    } finally {
      setLoading(false);
    }
  };

  const handleMessageTypeChange = (type) => {
    setMessageType(type);
    if (type !== 'custom' && messageTemplates[type]) {
      setMessage(messageTemplates[type][language]);
    } else {
      setMessage('');
    }
  };

  const toggleMember = (memberId) => {
    setSelectedMembers(prev => {
      if (prev.includes(memberId)) {
        return prev.filter(id => id !== memberId);
      }
      return [...prev, memberId];
    });
  };

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedMembers([]);
    } else {
      setSelectedMembers(filteredMembers.map(m => m.id));
    }
    setSelectAll(!selectAll);
  };

  const handleSendMessage = () => {
    if (selectedMembers.length === 0) {
      toast.error(language === 'ar' ? 'اختر المستلمين أولاً' : 'Select recipients first');
      return;
    }
    if (!message.trim()) {
      toast.error(language === 'ar' ? 'أدخل نص الرسالة' : 'Enter message text');
      return;
    }

    // Generate WhatsApp links for selected members
    const selectedMemberData = members.filter(m => selectedMembers.includes(m.id));
    const encodedMessage = encodeURIComponent(message);
    
    // Show confirmation with WhatsApp links
    const links = selectedMemberData.map(m => {
      const phone = m.phone.replace(/^0/, '966'); // Convert Saudi numbers
      return `https://wa.me/${phone}?text=${encodedMessage}`;
    });

    // Open first link and show success message
    if (links.length > 0) {
      window.open(links[0], '_blank');
      toast.success(
        language === 'ar' 
          ? `تم فتح واتساب لـ ${selectedMembers.length} مستلم. افتح الروابط الأخرى يدوياً.`
          : `Opened WhatsApp for ${selectedMembers.length} recipients. Open other links manually.`
      );
    }
  };

  // Internal Messaging Functions
  const loadConversations = async () => {
    setLoadingConversations(true);
    try {
      const [convRes, unreadRes] = await Promise.all([
        messagesAPI.getConversations(),
        messagesAPI.getUnreadCount()
      ]);
      setConversations(convRes.data || []);
      setMsgUnreadCount(unreadRes.data?.unread_count || 0);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setLoadingConversations(false);
    }
  };

  const openThread = async (memberId) => {
    try {
      const res = await messagesAPI.getThread(memberId);
      setThreadMessages(res.data.messages || []);
      setThreadMember(res.data.member);
      setSelectedThread(memberId);
      loadConversations();
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في تحميل المحادثة' : 'Failed to load thread');
    }
  };

  const handleSendInternalMessage = async () => {
    if (!newMsgSubject.trim() || !newMsgBody.trim()) {
      toast.error(language === 'ar' ? 'يرجى إدخال الموضوع والرسالة' : 'Enter subject and message');
      return;
    }
    if (!newMsgBroadcast && !newMsgRecipient) {
      toast.error(language === 'ar' ? 'يرجى اختيار العضو المستلم' : 'Select a recipient');
      return;
    }

    setSendingMsg(true);
    try {
      const res = await messagesAPI.send({
        subject: newMsgSubject,
        body: newMsgBody,
        recipient_member_id: newMsgBroadcast ? null : newMsgRecipient,
        broadcast: newMsgBroadcast
      });
      toast.success(res.data.message);
      setNewMsgSubject('');
      setNewMsgBody('');
      setNewMsgRecipient('');
      setNewMsgBroadcast(false);
      setShowCompose(false);
      loadConversations();
    } catch (error) {
      toast.error(language === 'ar' ? 'فشل إرسال الرسالة' : 'Failed to send message');
    } finally {
      setSendingMsg(false);
    }
  };

  const handleReplyInThread = async () => {
    if (!replyText.trim()) return;
    setSendingMsg(true);
    try {
      await messagesAPI.reply(selectedThread, { body: replyText });
      setReplyText('');
      openThread(selectedThread);
      toast.success(language === 'ar' ? 'تم إرسال الرد' : 'Reply sent');
    } catch (error) {
      toast.error(language === 'ar' ? 'فشل إرسال الرد' : 'Failed to send reply');
    } finally {
      setSendingMsg(false);
    }
  };

  const filteredMembers = members.filter(member => {
    // Filter only members with at least one active activity
    const hasActiveActivity = member.activities?.some(a => a.status === 'active');
    if (!hasActiveActivity) return false;
    
    if (filterActivity === 'all' && filterBranch === 'all') return true;
    const activityMatch = filterActivity === 'all' || member.activities?.some(a => a.activity_id === filterActivity);
    const branchMatch = filterBranch === 'all' || member.branch_id === filterBranch;
    return activityMatch && branchMatch;
  });
  
  // Group members by branch
  const membersByBranch = {};
  filteredMembers.forEach(member => {
    const branchId = member.branch_id || 'no_branch';
    if (!membersByBranch[branchId]) {
      membersByBranch[branchId] = [];
    }
    membersByBranch[branchId].push(member);
  });
  
  const getBranchName = (branchId) => {
    if (branchId === 'no_branch') return language === 'ar' ? 'بدون فرع' : 'No Branch';
    const branch = branches.find(b => b.id === branchId);
    return branch?.name_ar || branch?.name || branchId;
  };
  
  const toggleBranchExpanded = (branchId) => {
    setExpandedBranches(prev => ({ ...prev, [branchId]: !prev[branchId] }));
  };
  
  const toggleBranchMembers = (branchId, branchMembers) => {
    const branchMemberIds = branchMembers.map(m => m.id);
    const allSelected = branchMemberIds.every(id => selectedMembers.includes(id));
    
    if (allSelected) {
      setSelectedMembers(prev => prev.filter(id => !branchMemberIds.includes(id)));
    } else {
      setSelectedMembers(prev => [...new Set([...prev, ...branchMemberIds])]);
    }
  };

  if (loading) {
    return (
      <Layout title={t('messages')}>
        <div className="flex items-center justify-center h-64">
          <div className="spinner" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('messages')}>
      <div className="space-y-6" data-testid="messages-page">
        
        {/* Tabs */}
        <div className="flex gap-2 border-b pb-2">
          <Button
            variant={activeTab === 'whatsapp' ? 'default' : 'outline'}
            onClick={() => setActiveTab('whatsapp')}
            className="gap-2"
          >
            <Phone className="w-4 h-4" />
            {language === 'ar' ? 'رسائل واتساب' : 'WhatsApp Messages'}
          </Button>
          <Button
            variant={activeTab === 'portal' ? 'default' : 'outline'}
            onClick={() => setActiveTab('portal')}
            className="gap-2"
          >
            <Bell className="w-4 h-4" />
            {language === 'ar' ? 'إشعارات بوابة الأعضاء' : 'Portal Notifications'}
          </Button>
          <Button
            variant={activeTab === 'internal' ? 'default' : 'outline'}
            onClick={() => setActiveTab('internal')}
            className="gap-2"
          >
            <Mail className="w-4 h-4" />
            {language === 'ar' ? 'رسائل داخلية' : 'Internal Messages'}
            {msgUnreadCount > 0 && (
              <Badge variant="destructive" className="text-xs px-1.5 py-0.5">{msgUnreadCount}</Badge>
            )}
          </Button>
        </div>

        {/* Portal Notifications Tab */}
        {activeTab === 'portal' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Create Notification */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Megaphone className="w-5 h-5 text-primary" />
                  {language === 'ar' ? 'إرسال إشعار جديد' : 'Send New Notification'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">{language === 'ar' ? 'عنوان الإشعار' : 'Notification Title'}</label>
                  <Input
                    value={notifTitle}
                    onChange={(e) => setNotifTitle(e.target.value)}
                    placeholder={language === 'ar' ? 'مثال: عرض خاص!' : 'Example: Special Offer!'}
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium mb-1 block">{language === 'ar' ? 'نص الإشعار' : 'Notification Message'}</label>
                  <Textarea
                    value={notifMessage}
                    onChange={(e) => setNotifMessage(e.target.value)}
                    placeholder={language === 'ar' ? 'اكتب رسالة الإشعار هنا...' : 'Write notification message here...'}
                    rows={4}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">{language === 'ar' ? 'نوع الإشعار' : 'Type'}</label>
                    <Select value={notifType} onValueChange={setNotifType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="announcement">
                          <span className="flex items-center gap-2"><Megaphone className="w-4 h-4" /> {language === 'ar' ? 'إعلان' : 'Announcement'}</span>
                        </SelectItem>
                        <SelectItem value="offer">
                          <span className="flex items-center gap-2"><Gift className="w-4 h-4" /> {language === 'ar' ? 'عرض' : 'Offer'}</span>
                        </SelectItem>
                        <SelectItem value="reminder">
                          <span className="flex items-center gap-2"><Clock className="w-4 h-4" /> {language === 'ar' ? 'تذكير' : 'Reminder'}</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium mb-1 block">{language === 'ar' ? 'الأهمية' : 'Priority'}</label>
                    <Select value={notifPriority} onValueChange={setNotifPriority}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info">
                          <span className="flex items-center gap-2"><Info className="w-4 h-4 text-blue-500" /> {language === 'ar' ? 'عادي' : 'Normal'}</span>
                        </SelectItem>
                        <SelectItem value="warning">
                          <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-500" /> {language === 'ar' ? 'مهم' : 'Important'}</span>
                        </SelectItem>
                        <SelectItem value="danger">
                          <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" /> {language === 'ar' ? 'عاجل' : 'Urgent'}</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <div>
                  <label className="text-sm font-medium mb-1 block">{language === 'ar' ? 'المستلم' : 'Target'}</label>
                  <Select value={notifTarget} onValueChange={setNotifTarget}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all_members">
                        <span className="flex items-center gap-2"><Users className="w-4 h-4" /> {language === 'ar' ? 'جميع الأعضاء' : 'All Members'}</span>
                      </SelectItem>
                      <SelectItem value="specific_member">
                        <span className="flex items-center gap-2"><Users className="w-4 h-4" /> {language === 'ar' ? 'عضو محدد' : 'Specific Member'}</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {notifTarget === 'specific_member' && (
                  <div>
                    <label className="text-sm font-medium mb-1 block">{language === 'ar' ? 'اختر العضو' : 'Select Member'}</label>
                    <Select value={notifTargetMemberId} onValueChange={setNotifTargetMemberId}>
                      <SelectTrigger>
                        <SelectValue placeholder={language === 'ar' ? 'اختر عضو...' : 'Select member...'} />
                      </SelectTrigger>
                      <SelectContent>
                        {members.filter(m => m.id).map(m => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name_ar || m.name} - #{m.member_code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                
                <Button 
                  onClick={handleSendPortalNotification} 
                  className="w-full gap-2"
                  disabled={sendingNotif}
                >
                  <Send className="w-4 h-4" />
                  {sendingNotif ? (language === 'ar' ? 'جاري الإرسال...' : 'Sending...') : (language === 'ar' ? 'إرسال الإشعار' : 'Send Notification')}
                </Button>
              </CardContent>
            </Card>
            
            {/* Sent Notifications */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-primary" />
                  {language === 'ar' ? 'الإشعارات المرسلة' : 'Sent Notifications'}
                  <Badge variant="outline">{portalNotifications.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {portalNotifications.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <Bell className="w-12 h-12 mx-auto mb-2 opacity-30" />
                      <p>{language === 'ar' ? 'لا توجد إشعارات مرسلة' : 'No notifications sent'}</p>
                    </div>
                  ) : (
                    portalNotifications.map((notif) => (
                      <div 
                        key={notif.id}
                        className={`p-3 rounded-lg border ${
                          notif.priority === 'danger' ? 'bg-red-50 border-red-200' :
                          notif.priority === 'warning' ? 'bg-orange-50 border-orange-200' :
                          'bg-blue-50 border-blue-200'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-bold">{notif.title}</p>
                            <p className="text-sm text-gray-600 mt-1">{notif.message}</p>
                            <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                              <span>{notif.target === 'all_members' ? '👥 جميع الأعضاء' : '👤 عضو محدد'}</span>
                              <span>•</span>
                              <span>{new Date(notif.created_at).toLocaleDateString('ar-SA')}</span>
                            </div>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => handleDeletePortalNotification(notif.id)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* WhatsApp Tab */}
        {activeTab === 'whatsapp' && (
          <>
        {/* Info Alert */}
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-700">
                {language === 'ar' ? 'ملاحظة حول إرسال الرسائل' : 'Note about sending messages'}
              </p>
              <p className="text-sm text-amber-600">
                {language === 'ar' 
                  ? 'سيتم فتح واتساب لكل مستلم على حدة. للإرسال الجماعي التلقائي، يُرجى ربط WhatsApp Business API.'
                  : 'WhatsApp will open for each recipient separately. For automatic bulk sending, please integrate WhatsApp Business API.'}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recipients Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary" />
                  {t('select_recipients')}
                </div>
                <Badge variant="outline">
                  {selectedMembers.length} {language === 'ar' ? 'محدد' : 'selected'}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Filters */}
              <div className="flex gap-3 items-center flex-wrap">
                <Filter className="w-4 h-4 text-muted-foreground" />
                <Select value={filterActivity} onValueChange={setFilterActivity}>
                  <SelectTrigger className="flex-1 min-w-[150px]" data-testid="filter-activity">
                    <SelectValue placeholder={t('activities')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{language === 'ar' ? 'جميع الأنشطة' : 'All Activities'}</SelectItem>
                    {activities.filter(a => a.id).map(activity => (
                      <SelectItem key={activity.id} value={activity.id}>
                        {language === 'ar' ? activity.name_ar : activity.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {/* Branch Filter */}
                {isAdmin && branches.length > 0 && (
                  <Select value={filterBranch} onValueChange={setFilterBranch}>
                    <SelectTrigger className="flex-1 min-w-[150px]" data-testid="filter-branch">
                      <SelectValue placeholder={language === 'ar' ? 'الفروع' : 'Branches'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{language === 'ar' ? 'جميع الفروع' : 'All Branches'}</SelectItem>
                      {branches.filter(b => b.id).map(branch => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.name_ar || branch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Select All */}
              <div 
                className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg cursor-pointer"
                onClick={toggleSelectAll}
              >
                <Checkbox checked={selectAll} onClick={e => e.stopPropagation()} onCheckedChange={toggleSelectAll} />
                <span className="font-medium">
                  {language === 'ar' ? 'تحديد الكل' : 'Select All'}
                </span>
                <span className="text-sm text-muted-foreground">
                  ({filteredMembers.length})
                </span>
              </div>

              {/* Members List Grouped by Branch */}
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {isAdmin && branches.length > 0 ? (
                  // Grouped view for admin
                  Object.keys(membersByBranch).map(branchId => {
                    const branchMembers = membersByBranch[branchId];
                    const isExpanded = expandedBranches[branchId];
                    const allBranchSelected = branchMembers.every(m => selectedMembers.includes(m.id));
                    const someBranchSelected = branchMembers.some(m => selectedMembers.includes(m.id));
                    
                    return (
                      <div key={branchId} className="border rounded-lg overflow-hidden">
                        {/* Branch Header */}
                        <div 
                          className="flex items-center justify-between p-3 bg-muted/30 cursor-pointer hover:bg-muted/50"
                          onClick={() => toggleBranchExpanded(branchId)}
                        >
                          <div className="flex items-center gap-3">
                            <Checkbox 
                              checked={allBranchSelected}
                              className={someBranchSelected && !allBranchSelected ? 'opacity-50' : ''}
                              onCheckedChange={(e) => {
                                e.stopPropagation();
                                toggleBranchMembers(branchId, branchMembers);
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <Building2 className="w-4 h-4 text-primary" />
                            <span className="font-semibold">{getBranchName(branchId)}</span>
                            <Badge variant="secondary" className="text-xs">
                              {branchMembers.length} {language === 'ar' ? 'عضو' : 'members'}
                            </Badge>
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                        
                        {/* Branch Members */}
                        {isExpanded && (
                          <div className="divide-y">
                            {branchMembers.map(member => (
                              <div 
                                key={member.id}
                                className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${
                                  selectedMembers.includes(member.id)
                                    ? 'bg-primary/5'
                                    : 'hover:bg-muted/20'
                                }`}
                                onClick={() => toggleMember(member.id)}
                                data-testid={`member-select-${member.id}`}
                              >
                                <div className="flex items-center gap-3">
                                  <Checkbox 
                                    checked={selectedMembers.includes(member.id)}
                                    onClick={e => e.stopPropagation()}
                                    onCheckedChange={() => toggleMember(member.id)}
                                  />
                                  <div>
                                    <p className="font-medium">
                                      {language === 'ar' ? member.name_ar : member.name}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                      {language === 'ar' ? member.guardian_name_ar : member.guardian_name}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                  <Phone className="w-3 h-3" />
                                  <span dir="ltr">{member.phone}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  // Simple list for non-admin
                  filteredMembers.map(member => (
                    <div 
                      key={member.id}
                      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedMembers.includes(member.id)
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                      onClick={() => toggleMember(member.id)}
                      data-testid={`member-select-${member.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox 
                          checked={selectedMembers.includes(member.id)}
                          onClick={e => e.stopPropagation()}
                          onCheckedChange={() => toggleMember(member.id)}
                        />
                        <div>
                          <p className="font-medium">
                            {language === 'ar' ? member.name_ar : member.name}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {language === 'ar' ? member.guardian_name_ar : member.guardian_name}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Phone className="w-3 h-3" />
                        <span dir="ltr">{member.phone}</span>
                      </div>
                    </div>
                  ))
                )}
                
                {filteredMembers.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    {language === 'ar' ? 'لا يوجد أعضاء' : 'No members found'}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Message Composer */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                {t('send_message')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Message Type */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('message_type')}</label>
                <Select value={messageType} onValueChange={handleMessageTypeChange}>
                  <SelectTrigger data-testid="message-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">{t('custom')}</SelectItem>
                    <SelectItem value="payment_reminder">{t('payment_reminder')}</SelectItem>
                    <SelectItem value="expiry_alert">{t('expiry_alert')}</SelectItem>
                    <SelectItem value="promotion">{t('promotion')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Message Text */}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {language === 'ar' ? 'نص الرسالة' : 'Message Text'}
                </label>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={language === 'ar' ? 'أدخل نص الرسالة...' : 'Enter message text...'}
                  rows={6}
                  data-testid="message-text"
                />
                <p className="text-xs text-muted-foreground">
                  {message.length} {language === 'ar' ? 'حرف' : 'characters'}
                </p>
              </div>

              {/* Preview */}
              {message && (
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                  <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-2">
                    {language === 'ar' ? 'معاينة الرسالة' : 'Message Preview'}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{message}</p>
                </div>
              )}

              {/* Send Button */}
              <Button 
                className="w-full"
                onClick={handleSendMessage}
                disabled={selectedMembers.length === 0 || !message.trim()}
                data-testid="send-message-btn"
              >
                <Send className="w-4 h-4 me-2" />
                {t('send_message')} ({selectedMembers.length})
              </Button>
            </CardContent>
          </Card>
        </div>
          </>
        )}

        {/* Internal Messages Tab */}
        {activeTab === 'internal' && (
          <div className="space-y-4">
            {/* Actions Bar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {selectedThread && (
                  <Button variant="outline" size="sm" onClick={() => { setSelectedThread(null); setThreadMessages([]); setThreadMember(null); }}>
                    {language === 'ar' ? <ArrowRight className="w-4 h-4 ml-1" /> : <ArrowLeft className="w-4 h-4 mr-1" />}
                    {language === 'ar' ? 'رجوع للمحادثات' : 'Back to Conversations'}
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadConversations}>
                  <RefreshCcw className="w-4 h-4" />
                </Button>
                {!selectedThread && (
                  <Button size="sm" onClick={() => setShowCompose(!showCompose)} className="gap-2">
                    <Send className="w-4 h-4" />
                    {language === 'ar' ? 'رسالة جديدة' : 'New Message'}
                  </Button>
                )}
              </div>
            </div>

            {/* Compose New Message */}
            {showCompose && !selectedThread && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Send className="w-5 h-5 text-primary" />
                    {language === 'ar' ? 'إرسال رسالة جديدة' : 'Send New Message'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="broadcast-check"
                      checked={newMsgBroadcast}
                      onCheckedChange={(checked) => { setNewMsgBroadcast(checked); setNewMsgRecipient(''); }}
                    />
                    <label htmlFor="broadcast-check" className="text-sm font-medium cursor-pointer">
                      {language === 'ar' ? 'إرسال لجميع الأعضاء' : 'Broadcast to all members'}
                    </label>
                  </div>

                  {!newMsgBroadcast && (
                    <div>
                      <label className="text-sm font-medium mb-1 block">{language === 'ar' ? 'العضو المستلم' : 'Recipient Member'}</label>
                      <Select value={newMsgRecipient} onValueChange={setNewMsgRecipient}>
                        <SelectTrigger>
                          <SelectValue placeholder={language === 'ar' ? 'اختر عضو...' : 'Select member...'} />
                        </SelectTrigger>
                        <SelectContent>
                          {members.filter(m => m.id).map(m => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name_ar || m.name} - #{m.member_code}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div>
                    <label className="text-sm font-medium mb-1 block">{language === 'ar' ? 'الموضوع' : 'Subject'}</label>
                    <Input
                      value={newMsgSubject}
                      onChange={(e) => setNewMsgSubject(e.target.value)}
                      placeholder={language === 'ar' ? 'موضوع الرسالة' : 'Message subject'}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-1 block">{language === 'ar' ? 'نص الرسالة' : 'Message Body'}</label>
                    <Textarea
                      value={newMsgBody}
                      onChange={(e) => setNewMsgBody(e.target.value)}
                      placeholder={language === 'ar' ? 'اكتب رسالتك هنا...' : 'Write your message here...'}
                      rows={4}
                    />
                  </div>

                  <Button onClick={handleSendInternalMessage} disabled={sendingMsg} className="w-full gap-2">
                    <Send className="w-4 h-4" />
                    {sendingMsg ? (language === 'ar' ? 'جاري الإرسال...' : 'Sending...') : (language === 'ar' ? 'إرسال' : 'Send')}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Conversation List */}
            {!selectedThread && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="w-5 h-5 text-primary" />
                    {language === 'ar' ? 'المحادثات' : 'Conversations'}
                    {msgUnreadCount > 0 && (
                      <Badge variant="destructive">{msgUnreadCount} {language === 'ar' ? 'غير مقروءة' : 'unread'}</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingConversations ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="spinner" />
                    </div>
                  ) : conversations.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <Mail className="w-16 h-16 mx-auto mb-3 opacity-20" />
                      <p className="text-lg font-medium">{language === 'ar' ? 'لا توجد محادثات بعد' : 'No conversations yet'}</p>
                      <p className="text-sm mt-1">{language === 'ar' ? 'ابدأ بإرسال رسالة جديدة' : 'Start by sending a new message'}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {conversations.map((conv) => (
                        <div
                          key={conv.member_id}
                          onClick={() => openThread(conv.member_id)}
                          className={`p-4 rounded-lg border cursor-pointer transition-colors hover:bg-accent/50 ${
                            conv.unread_count > 0 ? 'border-primary/50 bg-primary/5' : 'border-border'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                <User className="w-5 h-5 text-primary" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold truncate">{conv.member_name || conv.recipient_name}</p>
                                  {conv.member_code && (
                                    <Badge variant="outline" className="text-xs">#{conv.member_code}</Badge>
                                  )}
                                </div>
                                <p className="text-sm text-muted-foreground truncate">
                                  {conv.last_sender_type === 'member' ? (language === 'ar' ? 'العضو: ' : 'Member: ') : (language === 'ar' ? 'أنت: ' : 'You: ')}
                                  {conv.last_message}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1 flex-shrink-0 mr-2">
                              <span className="text-xs text-muted-foreground">
                                {new Date(conv.last_date).toLocaleDateString('ar-SA')}
                              </span>
                              {conv.unread_count > 0 && (
                                <Badge variant="destructive" className="text-xs">{conv.unread_count}</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Thread View */}
            {selectedThread && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5 text-primary" />
                    {threadMember?.name || ''}
                    {threadMember?.member_code && (
                      <Badge variant="outline" className="text-xs">#{threadMember.member_code}</Badge>
                    )}
                    {threadMember?.phone && (
                      <span className="text-sm text-muted-foreground font-normal" dir="ltr">{threadMember.phone}</span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-[500px] overflow-y-auto mb-4 p-2">
                    {threadMessages.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <p>{language === 'ar' ? 'لا توجد رسائل' : 'No messages'}</p>
                      </div>
                    ) : (
                      threadMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`p-3 rounded-lg max-w-[80%] ${
                            msg.sender_type === 'admin'
                              ? 'bg-primary/10 border border-primary/20 mr-auto'
                              : 'bg-accent border border-border ml-auto'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-semibold">
                              {msg.sender_type === 'admin' ? (language === 'ar' ? 'الإدارة' : 'Admin') : msg.sender_name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(msg.created_at).toLocaleString('ar-SA')}
                            </span>
                          </div>
                          {msg.subject && (
                            <p className="text-sm font-medium mb-1">{msg.subject}</p>
                          )}
                          <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Reply Input */}
                  <div className="flex gap-2 border-t pt-3">
                    <Textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={language === 'ar' ? 'اكتب ردك هنا...' : 'Type your reply...'}
                      rows={2}
                      className="flex-1"
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReplyInThread(); } }}
                    />
                    <Button onClick={handleReplyInThread} disabled={!replyText.trim() || sendingMsg} size="icon" className="h-auto">
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default MessagesPage;
