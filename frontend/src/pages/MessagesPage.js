import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
// eslint-disable-next-line react-hooks/exhaustive-deps
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { membersAPI, activitiesAPI } from '../services/api';
import { toast } from 'sonner';
import { 
  MessageSquare, 
  Send,
  Users,
  Filter,
  Phone,
  AlertTriangle
} from 'lucide-react';

export const MessagesPage = () => {
  const { t, language } = useLanguage();
  const [members, setMembers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('custom');
  const [filterActivity, setFilterActivity] = useState('all');
  const [selectAll, setSelectAll] = useState(false);

  const messageTemplates = {
    payment_reminder: {
      ar: 'السلام عليكم، نود تذكيركم بموعد سداد رسوم الاشتراك في أكاديمية أداء الأبطال العالمية. نرجو التواصل معنا لمزيد من التفاصيل.',
      en: 'Hello, this is a reminder about your subscription payment at Champions Performance Academy. Please contact us for more details.'
    },
    expiry_alert: {
      ar: 'السلام عليكم، نود إعلامكم بأن اشتراككم في أكاديمية أداء الأبطال العالمية سينتهي قريباً. يرجى التواصل معنا لتجديد الاشتراك.',
      en: 'Hello, your subscription at Champions Performance Academy is expiring soon. Please contact us to renew.'
    },
    promotion: {
      ar: 'السلام عليكم، نقدم لكم عروضاً خاصة في أكاديمية أداء الأبطال العالمية. تواصلوا معنا للاستفادة من هذه العروض!',
      en: 'Hello, we have special offers at Champions Performance Academy. Contact us to learn more!'
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [membersRes, activitiesRes] = await Promise.all([
        membersAPI.getAll(),
        activitiesAPI.getAll()
      ]);
      setMembers(membersRes.data);
      setActivities(activitiesRes.data);
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

  const filteredMembers = members.filter(member => {
    if (filterActivity === 'all') return true;
    return member.activities?.some(a => a.activity_id === filterActivity);
  });

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
              {/* Filter */}
              <div className="flex gap-3 items-center">
                <Filter className="w-4 h-4 text-muted-foreground" />
                <Select value={filterActivity} onValueChange={setFilterActivity}>
                  <SelectTrigger className="flex-1" data-testid="filter-activity">
                    <SelectValue placeholder={t('activities')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{language === 'ar' ? 'جميع الأنشطة' : 'All Activities'}</SelectItem>
                    {activities.map(activity => (
                      <SelectItem key={activity.id} value={activity.id}>
                        {language === 'ar' ? activity.name_ar : activity.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Select All */}
              <div 
                className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg cursor-pointer"
                onClick={toggleSelectAll}
              >
                <Checkbox checked={selectAll} onCheckedChange={toggleSelectAll} />
                <span className="font-medium">
                  {language === 'ar' ? 'تحديد الكل' : 'Select All'}
                </span>
                <span className="text-sm text-muted-foreground">
                  ({filteredMembers.length})
                </span>
              </div>

              {/* Members List */}
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {filteredMembers.map(member => (
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
      </div>
    </Layout>
  );
};

export default MessagesPage;
