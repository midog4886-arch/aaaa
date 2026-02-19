import React, { useState, useEffect } from 'react';
import MemberLayout, { memberAPI, getLanguage } from './MemberLayout';
import { Mail, Send, ArrowRight, ArrowLeft, RefreshCcw } from 'lucide-react';

const MemberMessages = () => {
  const language = getLanguage();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const t = (key) => {
    const translations = {
      title: { ar: 'الرسائل', en: 'Messages' },
      noMessages: { ar: 'لا توجد رسائل', en: 'No messages' },
      noMessagesDesc: { ar: 'ستظهر هنا الرسائل من الإدارة', en: 'Messages from admin will appear here' },
      replyPlaceholder: { ar: 'اكتب ردك هنا...', en: 'Type your reply...' },
      send: { ar: 'إرسال', en: 'Send' },
      sending: { ar: 'جاري الإرسال...', en: 'Sending...' },
      sent: { ar: 'تم الإرسال', en: 'Sent' },
      admin: { ar: 'الإدارة', en: 'Admin' },
      you: { ar: 'أنت', en: 'You' },
      refresh: { ar: 'تحديث', en: 'Refresh' },
      writeMessage: { ar: 'أرسل رسالة للإدارة', en: 'Send message to admin' },
    };
    return translations[key]?.[language] || key;
  };

  useEffect(() => {
    loadMessages();
  }, []);

  const loadMessages = async () => {
    try {
      const [msgRes, unreadRes] = await Promise.all([
        memberAPI.get('/api/member-portal/member/messages'),
        memberAPI.get('/api/member-portal/member/messages/unread-count')
      ]);
      setMessages(msgRes.data.messages || []);
      setUnreadCount(unreadRes.data.unread_count || 0);
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      await memberAPI.post('/api/member-portal/member/messages/reply', { body: replyText });
      setReplyText('');
      loadMessages();
    } catch (error) {
      console.error('Failed to send reply:', error);
    } finally {
      setSending(false);
    }
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return language === 'ar' ? 'الآن' : 'Just now';
    if (diffMins < 60) return language === 'ar' ? `منذ ${diffMins} دقيقة` : `${diffMins}m ago`;
    if (diffHours < 24) return language === 'ar' ? `منذ ${diffHours} ساعة` : `${diffHours}h ago`;
    if (diffDays < 7) return language === 'ar' ? `منذ ${diffDays} يوم` : `${diffDays}d ago`;
    return date.toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US');
  };

  return (
    <MemberLayout>
      <div className="p-4 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Mail className="w-6 h-6 text-blue-600" />
            {t('title')}
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{unreadCount}</span>
            )}
          </h1>
          <button
            onClick={loadMessages}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <RefreshCcw className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <>
            {/* Reply/Send Input */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-6">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">{t('writeMessage')}</p>
              <div className="flex gap-2">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={t('replyPlaceholder')}
                  rows={2}
                  className="flex-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
                />
                <button
                  onClick={handleReply}
                  disabled={!replyText.trim() || sending}
                  className="self-end px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors flex items-center gap-1"
                >
                  <Send className="w-4 h-4" />
                  {sending ? t('sending') : t('send')}
                </button>
              </div>
            </div>

            {/* Messages List */}
            {messages.length === 0 ? (
              <div className="text-center py-16">
                <Mail className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                <p className="text-lg font-medium text-gray-500 dark:text-gray-400">{t('noMessages')}</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">{t('noMessagesDesc')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded-xl p-4 shadow-sm border transition-colors ${
                      msg.sender_type === 'admin'
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                        : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 mr-0 ml-8'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        msg.sender_type === 'admin'
                          ? 'bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300'
                          : 'bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-300'
                      }`}>
                        {msg.sender_type === 'admin' ? t('admin') : t('you')}
                      </span>
                      <span className="text-xs text-gray-400">{formatDate(msg.created_at)}</span>
                    </div>
                    {msg.subject && (
                      <p className="font-semibold text-sm mb-1 text-gray-800 dark:text-gray-200">{msg.subject}</p>
                    )}
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                    {msg.is_broadcast && (
                      <span className="text-xs text-gray-400 mt-2 block">
                        {language === 'ar' ? '📢 رسالة عامة' : '📢 Broadcast'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </MemberLayout>
  );
};

export default MemberMessages;
