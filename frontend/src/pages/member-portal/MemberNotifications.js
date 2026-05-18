import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Bell, AlertTriangle, Clock, Megaphone, Loader2, CheckCircle, Play,
  Mail, Send, CheckCheck
} from 'lucide-react';
import MemberLayout, { memberAPI, getLanguage } from './MemberLayout';
import { useBrandColor } from '../../services/branding';

const getInitials = (name) => {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';
  return (
    trimmed
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('') || ''
  );
};

const ChatAvatar = ({ photo, name, tone = 'member' }) => {
  const [imgFailed, setImgFailed] = React.useState(false);
  React.useEffect(() => { setImgFailed(false); }, [photo]);
  const initials = getInitials(name);
  const showPhoto = !!photo && !imgFailed;
  const baseFallback =
    tone === 'admin'
      ? 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-100'
      : 'bg-blue-500 text-white';
  const ringClass =
    tone === 'admin'
      ? 'border border-gray-300 dark:border-gray-600'
      : 'border border-blue-300 dark:border-blue-700';
  return (
    <div className="relative w-8 h-8 flex-shrink-0">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold ${baseFallback}`}>
        {initials || (tone === 'admin' ? <Mail className="w-4 h-4" /> : '?')}
      </div>
      {showPhoto && (
        <img
          src={photo}
          alt={name || ''}
          onError={() => setImgFailed(true)}
          className={`absolute inset-0 w-8 h-8 rounded-full object-cover ${ringClass}`}
        />
      )}
    </div>
  );
};

const MemberNotifications = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const language = getLanguage();
  const t = (ar, en) => (language === 'ar' ? ar : en);
  const primary = useBrandColor();

  const params = new URLSearchParams(location.search);
  const tabFromQuery = params.get('tab');
  const initialTab = tabFromQuery === 'messages' || location.pathname.includes('member-messages')
    ? 'messages'
    : 'notifications';
  const [activeTab, setActiveTab] = useState(initialTab);

  const switchTab = (tab) => {
    setActiveTab(tab);
    const newUrl = `${location.pathname}${tab === 'messages' ? '?tab=messages' : ''}`;
    window.history.replaceState(null, '', newUrl);
  };

  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState({ notifications: [], unread_count: 0 });
  const [markingAll, setMarkingAll] = useState(false);

  const [messages, setMessages] = useState([]);
  const [memberPhoto, setMemberPhoto] = useState('');
  const [memberName, setMemberName] = useState('');
  const [msgLoading, setMsgLoading] = useState(true);
  const [msgUnreadCount, setMsgUnreadCount] = useState(0);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchNotifications();
    loadMessages();
  }, []);

  useEffect(() => {
    if (activeTab === 'messages') {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [activeTab, messages.length]);

  const fetchNotifications = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/notifications');
      setNotifications(res.data);
    } catch (error) {
      console.error('Failed to fetch notifications');
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async () => {
    try {
      const [msgRes, unreadRes, profileRes] = await Promise.all([
        memberAPI.get('/api/member-portal/member/messages'),
        memberAPI.get('/api/member-portal/member/messages/unread-count'),
        memberAPI.get('/api/member-portal/profile').catch(() => null),
      ]);
      setMessages(msgRes.data.messages || []);
      setMsgUnreadCount(unreadRes.data.unread_count || 0);
      const photoFromMessages = msgRes.data.member_photo || '';
      const profile = profileRes?.data || {};
      setMemberPhoto(photoFromMessages || profile.photo || '');
      setMemberName(profile.name_ar || profile.name || '');
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      setMsgLoading(false);
    }
  };

  const handleMarkAllRead = async () => {
    if (notifications.unread_count === 0) return;
    setMarkingAll(true);
    try {
      await memberAPI.put('/api/member-portal/notifications/mark-all-read');
      await fetchNotifications();
    } catch (error) {
      console.error('Failed to mark all as read');
    } finally {
      setMarkingAll(false);
    }
  };

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      await memberAPI.post('/api/member-portal/member/messages/reply', { body: replyText });
      setReplyText('');
      await loadMessages();
    } catch (error) {
      console.error('Failed to send reply:', error);
    } finally {
      setSending(false);
    }
  };

  const handleNotificationClick = (notif) => {
    if (notif.type === 'new_video') {
      const videoId = notif.video_id;
      navigate(videoId ? `/videos?videoId=${videoId}` : '/videos');
      return;
    }
    if (notif.link) navigate(notif.link);
  };

  // Classify notification by type -> color/icon
  const classifyNotification = (notif) => {
    const type = notif.type;
    if (type === 'expired') {
      return {
        category: 'alert',
        Icon: AlertTriangle,
        bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
        iconBg: 'bg-red-500',
        title: 'text-red-800 dark:text-red-300',
        label: t('تنبيه', 'Alert'),
      };
    }
    if (type === 'expiring_soon') {
      return {
        category: 'reminder',
        Icon: Clock,
        bg: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
        iconBg: 'bg-orange-500',
        title: 'text-orange-800 dark:text-orange-300',
        label: t('تذكير', 'Reminder'),
      };
    }
    if (type === 'attendance_recorded') {
      return {
        category: 'confirm',
        Icon: CheckCircle,
        bg: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
        iconBg: 'bg-green-500',
        title: 'text-green-800 dark:text-green-300',
        label: t('تأكيد', 'Confirmation'),
      };
    }
    if (type === 'new_video') {
      return {
        category: 'announcement',
        Icon: Play,
        bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
        iconBg: 'bg-blue-500',
        title: 'text-blue-800 dark:text-blue-300',
        label: t('إعلان', 'Announcement'),
      };
    }
    return {
      category: 'announcement',
      Icon: Megaphone,
      bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
      iconBg: 'bg-blue-500',
      title: 'text-blue-800 dark:text-blue-300',
      label: t('إعلان', 'Announcement'),
    };
  };

  const formatRelative = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return t('الآن', 'Just now');
    if (diffMins < 60) return t(`منذ ${diffMins} دقيقة`, `${diffMins}m ago`);
    if (diffHours < 24) return t(`منذ ${diffHours} ساعة`, `${diffHours}h ago`);
    if (diffDays < 7) return t(`منذ ${diffDays} يوم`, `${diffDays}d ago`);
    return date.toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US');
  };

  const sortedNotifications = [...(notifications.notifications || [])].sort((a, b) => {
    const da = new Date(a.created_at || 0).getTime();
    const dbb = new Date(b.created_at || 0).getTime();
    return dbb - da;
  });

  const renderNotification = (notif, idx) => {
    const meta = classifyNotification(notif);
    const isClickable = notif.type === 'new_video' || !!notif.link;
    const Icon = meta.Icon;
    const titleText = language === 'ar'
      ? (notif.title_ar || notif.title)
      : (notif.title_en || notif.title);
    const messageText = language === 'ar'
      ? (notif.message_ar || notif.message)
      : (notif.message_en || notif.message);
    return (
      <div
        key={notif.id || idx}
        onClick={isClickable ? () => handleNotificationClick(notif) : undefined}
        role={isClickable ? 'button' : undefined}
        tabIndex={isClickable ? 0 : undefined}
        onKeyDown={isClickable ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleNotificationClick(notif);
          }
        } : undefined}
        className={`flex items-start gap-3 p-4 rounded-xl border tap-highlight ${meta.bg} ${
          isClickable ? 'cursor-pointer hover:shadow-md transition-shadow' : ''
        }`}
      >
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${meta.iconBg}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className={`font-bold ${meta.title}`}>{titleText}</p>
            <span className="text-xs text-gray-500 dark:text-gray-400">{formatRelative(notif.created_at)}</span>
          </div>
          <p className="text-gray-700 dark:text-gray-300 mt-1 text-sm">{messageText}</p>
          {notif.end_date && notif.type === 'expiring_soon' && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              📅 {t('تاريخ الانتهاء', 'End date')}: {notif.end_date}
            </p>
          )}
          {notif.type === 'expired' && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-2 font-medium">
              ⚠️ {t('يرجى التواصل مع الأكاديمية للتجديد', 'Please contact the academy to renew')}
            </p>
          )}
          {notif.type === 'new_video' && (
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 font-medium">
              {t('▶️ اضغط لمشاهدة الفيديو', '▶️ Tap to watch the video')}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <MemberLayout>
      <div className="space-y-4 page-enter max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">
            {t('الإشعارات والرسائل', 'Notifications & Messages')}
          </h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => switchTab('notifications')}
            className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors -mb-px border-b-2 ${
              activeTab === 'notifications'
                ? (primary ? '' : 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400')
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
            style={activeTab === 'notifications' && primary ? { borderColor: primary, color: primary } : undefined}
          >
            <Bell className="w-4 h-4" />
            {t('الإشعارات', 'Notifications')}
            {notifications.unread_count > 0 && (
              <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full min-w-[20px] text-center">
                {notifications.unread_count}
              </span>
            )}
          </button>
          <button
            onClick={() => switchTab('messages')}
            className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors -mb-px border-b-2 ${
              activeTab === 'messages'
                ? (primary ? '' : 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400')
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
            style={activeTab === 'messages' && primary ? { borderColor: primary, color: primary } : undefined}
          >
            <Mail className="w-4 h-4" />
            {t('الرسائل', 'Messages')}
            {msgUnreadCount > 0 && (
              <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full min-w-[20px] text-center">
                {msgUnreadCount}
              </span>
            )}
          </button>
        </div>

        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <div className="space-y-3">
            {notifications.unread_count > 0 && (
              <div className="flex justify-end">
                <button
                  onClick={handleMarkAllRead}
                  disabled={markingAll}
                  className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${primary ? 'hover:bg-gray-100 dark:hover:bg-gray-800' : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30'}`}
                  style={primary ? { color: primary } : undefined}
                >
                  <CheckCheck className="w-4 h-4" />
                  {markingAll ? t('جاري التحديث...', 'Updating...') : t('تحديد الكل كمقروء', 'Mark all as read')}
                </button>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center min-h-[300px]">
                <Loader2 className={`w-8 h-8 animate-spin ${primary ? '' : 'text-blue-600'}`} style={primary ? { color: primary } : undefined} />
              </div>
            ) : sortedNotifications.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 py-12 text-center">
                <CheckCircle className="w-16 h-16 text-green-300 dark:text-green-700 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-600 dark:text-gray-300">
                  {t('لا توجد إشعارات جديدة', 'No new notifications')}
                </p>
                <p className="text-gray-400 dark:text-gray-500 mt-2 text-sm">
                  {t('جميع اشتراكاتك سارية ولا توجد تنبيهات', 'All your subscriptions are active')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {sortedNotifications.map((n, i) => renderNotification(n, i))}
              </div>
            )}
          </div>
        )}

        {/* Messages Tab */}
        {activeTab === 'messages' && (
          <div className="flex flex-col" style={{ minHeight: '60vh' }}>
            {msgLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className={`w-8 h-8 animate-spin ${primary ? '' : 'text-blue-600'}`} style={primary ? { color: primary } : undefined} />
              </div>
            ) : (
              <>
                {/* Conversation */}
                <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-3 overflow-y-auto" style={{ maxHeight: '60vh' }}>
                  {messages.length === 0 ? (
                    <div className="text-center py-12">
                      <Mail className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                      <p className="text-lg font-medium text-gray-500 dark:text-gray-400">
                        {t('لا توجد رسائل', 'No messages')}
                      </p>
                      <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                        {t('ابدأ محادثة مع الإدارة', 'Start a conversation with admin')}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {[...messages].reverse().map((msg) => {
                        const isAdmin = msg.sender_type === 'admin';
                        const adminPhoto = msg.sender_photo || '';
                        const adminName = msg.sender_name || '';
                        const memberAvatar = (
                          <ChatAvatar
                            photo={memberPhoto}
                            name={memberName || msg.sender_name}
                            tone="member"
                          />
                        );
                        const adminAvatar = (
                          <ChatAvatar
                            photo={adminPhoto}
                            name={adminName}
                            tone="admin"
                          />
                        );
                        return (
                          <div
                            key={msg.id}
                            className={`flex items-end gap-2 ${isAdmin ? 'justify-start' : 'justify-end flex-row-reverse'}`}
                          >
                            {isAdmin ? adminAvatar : memberAvatar}
                            <div
                              className={`max-w-[75%] rounded-2xl px-4 py-2 shadow-sm ${
                                isAdmin
                                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-bl-sm'
                                  : 'bg-blue-600 text-white rounded-br-sm'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3 mb-1">
                                <span className={`text-xs font-semibold ${isAdmin ? 'text-gray-500 dark:text-gray-400' : 'text-blue-100'}`}>
                                  {isAdmin ? t('الإدارة', 'Admin') : t('أنت', 'You')}
                                </span>
                                <span className={`text-[10px] ${isAdmin ? 'text-gray-400 dark:text-gray-500' : 'text-blue-100'}`}>
                                  {formatRelative(msg.created_at)}
                                </span>
                              </div>
                              {(() => {
                                const showEn = isAdmin && language === 'en';
                                const displaySubject = showEn && msg.subject_en ? msg.subject_en : msg.subject;
                                const displayBody = showEn && msg.body_en ? msg.body_en : msg.body;
                                return (
                                  <>
                                    {displaySubject && (
                                      <p className={`font-semibold text-sm mb-1 ${isAdmin ? 'text-gray-700 dark:text-gray-200' : 'text-white'}`}>
                                        {displaySubject}
                                      </p>
                                    )}
                                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{displayBody}</p>
                                  </>
                                );
                              })()}
                              {msg.is_broadcast && (
                                <span className={`text-[10px] mt-1 block ${isAdmin ? 'text-gray-400' : 'text-blue-100'}`}>
                                  {t('📢 رسالة عامة', '📢 Broadcast')}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>

                {/* Reply Input - sticky on mobile */}
                <div className="sticky bottom-16 lg:bottom-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-md">
                  <div className="flex gap-2 items-end">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={t('اكتب ردك هنا...', 'Type your reply...')}
                      rows={1}
                      className="flex-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleReply();
                        }
                      }}
                    />
                    <button
                      onClick={handleReply}
                      disabled={!replyText.trim() || sending}
                      className={`px-4 py-2 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors flex items-center gap-1 ${primary ? 'hover:opacity-90' : 'bg-blue-600 hover:bg-blue-700'}`}
                      style={primary ? { backgroundColor: primary } : undefined}
                    >
                      <Send className="w-4 h-4" />
                      <span className="hidden sm:inline">
                        {sending ? t('جاري الإرسال...', 'Sending...') : t('إرسال', 'Send')}
                      </span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </MemberLayout>
  );
};

export default MemberNotifications;
