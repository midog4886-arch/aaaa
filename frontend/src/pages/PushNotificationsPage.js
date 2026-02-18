import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { pushNotificationsAPI, membersAPI, branchesAPI } from '../services/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { toast } from 'sonner';
import {
  Bell,
  Send,
  Users,
  Loader2,
  CheckCircle,
  Phone,
  X
} from 'lucide-react';

const PushNotificationsPage = () => {
  const { language } = useLanguage();
  const { selectedBranchId } = useAuth();
  const isAr = language === 'ar';

  const [subscribersCount, setSubscribersCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [branches, setBranches] = useState([]);
  const [result, setResult] = useState(null);
  const [showSubscribers, setShowSubscribers] = useState(false);
  const [subscribers, setSubscribers] = useState([]);
  const [loadingSubscribers, setLoadingSubscribers] = useState(false);

  const [form, setForm] = useState({
    title: '',
    body: '',
    url: '/',
    branch_id: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [countRes, branchesRes] = await Promise.all([
        pushNotificationsAPI.getSubscribersCount(),
        branchesAPI.getAll()
      ]);
      setSubscribersCount(countRes.data.count);
      setBranches(branchesRes.data || []);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleShowSubscribers = async () => {
    setShowSubscribers(true);
    setLoadingSubscribers(true);
    try {
      const res = await pushNotificationsAPI.getSubscribersList();
      setSubscribers(res.data.subscribers || []);
    } catch (error) {
      console.error('Failed to load subscribers:', error);
      toast.error(isAr ? 'فشل في تحميل المشتركين' : 'Failed to load subscribers');
    } finally {
      setLoadingSubscribers(false);
    }
  };

  const getBranchName = (branchId) => {
    const branch = branches.find(b => b.id === branchId);
    return branch ? branch.name : '';
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) {
      toast.error(isAr ? 'يرجى تعبئة العنوان والمحتوى' : 'Please fill title and body');
      return;
    }

    setSending(true);
    setResult(null);
    try {
      const payload = {
        title: form.title,
        body: form.body,
        url: form.url || '/',
        branch_id: form.branch_id || null
      };
      const res = await pushNotificationsAPI.broadcast(payload);
      setResult(res.data);
      toast.success(
        isAr
          ? `تم الإرسال بنجاح! (${res.data.success} من ${res.data.total})`
          : `Sent successfully! (${res.data.success} of ${res.data.total})`
      );
      setForm({ title: '', body: '', url: '/', branch_id: '' });
    } catch (error) {
      console.error('Failed to send:', error);
      toast.error(isAr ? 'فشل في الإرسال' : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="w-6 h-6 text-blue-600" />
            {isAr ? 'إشعارات Push' : 'Push Notifications'}
          </h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card
            className="bg-blue-50 border-blue-200 cursor-pointer hover:bg-blue-100 hover:shadow-md transition-all"
            onClick={handleShowSubscribers}
          >
            <CardContent className="p-4 text-center">
              <Users className="w-8 h-8 text-blue-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-blue-700">{subscribersCount}</p>
              <p className="text-sm text-blue-600">{isAr ? 'مشترك في الإشعارات' : 'Active Subscribers'}</p>
              <p className="text-xs text-blue-400 mt-1">{isAr ? 'اضغط لعرض القائمة' : 'Click to view list'}</p>
            </CardContent>
          </Card>
        </div>

        <Dialog open={showSubscribers} onOpenChange={setShowSubscribers}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                {isAr ? `المشتركون في الإشعارات (${subscribers.length})` : `Notification Subscribers (${subscribers.length})`}
              </DialogTitle>
            </DialogHeader>
            <div className="overflow-y-auto flex-1 -mx-2 px-2">
              {loadingSubscribers ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                </div>
              ) : subscribers.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  {isAr ? 'لا يوجد مشتركين' : 'No subscribers'}
                </div>
              ) : (
                <div className="space-y-2">
                  {subscribers.map((sub, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <Users className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{sub.name}</p>
                          {sub.phone && (
                            <p className="text-xs text-gray-500 flex items-center gap-1" dir="ltr">
                              <Phone className="w-3 h-3" />
                              {sub.phone}
                            </p>
                          )}
                        </div>
                      </div>
                      {sub.branch_id && getBranchName(sub.branch_id) && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full flex-shrink-0 mr-2">
                          {getBranchName(sub.branch_id)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="w-5 h-5" />
              {isAr ? 'إرسال إشعار جماعي' : 'Send Broadcast Notification'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSend} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  {isAr ? 'العنوان' : 'Title'} *
                </label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder={isAr ? 'عنوان الإشعار...' : 'Notification title...'}
                  dir={isAr ? 'rtl' : 'ltr'}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  {isAr ? 'المحتوى' : 'Body'} *
                </label>
                <Textarea
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  placeholder={isAr ? 'محتوى الإشعار...' : 'Notification body...'}
                  rows={3}
                  dir={isAr ? 'rtl' : 'ltr'}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  {isAr ? 'رابط الفتح (اختياري)' : 'Open URL (optional)'}
                </label>
                <Input
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="/"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  {isAr ? 'الفرع (اختياري - اتركه فارغ للكل)' : 'Branch (optional - leave empty for all)'}
                </label>
                <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v === 'all' ? '' : v })}>
                  <SelectTrigger>
                    <SelectValue placeholder={isAr ? 'جميع الفروع' : 'All branches'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{isAr ? 'جميع الفروع' : 'All branches'}</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" disabled={sending} className="w-full">
                {sending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin ml-2" />
                    {isAr ? 'جاري الإرسال...' : 'Sending...'}
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 ml-2" />
                    {isAr ? 'إرسال الإشعار' : 'Send Notification'}
                  </>
                )}
              </Button>
            </form>

            {result && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 text-green-700 font-bold mb-2">
                  <CheckCircle className="w-5 h-5" />
                  {isAr ? 'تم الإرسال' : 'Sent Successfully'}
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm text-center">
                  <div>
                    <p className="font-bold text-gray-800">{result.total}</p>
                    <p className="text-gray-500">{isAr ? 'الإجمالي' : 'Total'}</p>
                  </div>
                  <div>
                    <p className="font-bold text-green-600">{result.success}</p>
                    <p className="text-gray-500">{isAr ? 'نجح' : 'Success'}</p>
                  </div>
                  <div>
                    <p className="font-bold text-red-600">{result.failed}</p>
                    <p className="text-gray-500">{isAr ? 'فشل' : 'Failed'}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default PushNotificationsPage;
