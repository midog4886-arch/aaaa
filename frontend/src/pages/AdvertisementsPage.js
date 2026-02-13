import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { useToast } from '../hooks/use-toast';
import { advertisementsAPI, branchesAPI, notificationsAPI } from '../services/api';
import { 
  Plus, Pencil, Trash2, Eye, MousePointerClick, Image, Video, 
  Link2, Calendar, BarChart3, Upload, ExternalLink, Play,
  ToggleLeft, ToggleRight, Search, Filter, Megaphone, TrendingUp,
  Bell, AlertTriangle, Clock, RefreshCw, CheckCircle
} from 'lucide-react';

const AdvertisementsPage = () => {
  const { toast } = useToast();
  const [ads, setAds] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAd, setEditingAd] = useState(null);
  const [stats, setStats] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterPosition, setFilterPosition] = useState('all');
  const [uploading, setUploading] = useState(false);
  const [adsStatus, setAdsStatus] = useState(null);
  const [checkingExpiry, setCheckingExpiry] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    title_ar: '',
    ad_type: 'banner',
    position: 'hero',
    link_url: '',
    youtube_video_id: '',
    banner_image_url: '',
    description: '',
    description_ar: '',
    start_date: '',
    end_date: '',
    priority: 0,
    is_active: true,
    branch_id: '',
    target_audience: 'all'
  });

  const fetchData = useCallback(async () => {
    try {
      const [adsRes, branchesRes, statsRes, adsStatusRes] = await Promise.all([
        advertisementsAPI.getAll(),
        branchesAPI.getAll(),
        advertisementsAPI.getStats(),
        notificationsAPI.getAdsStatus()
      ]);
      setAds(adsRes.data);
      setBranches(branchesRes.data);
      setStats(statsRes.data);
      setAdsStatus(adsStatusRes.data);
    } catch (error) {
      toast({ title: 'خطأ', description: 'فشل في تحميل البيانات', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCheckExpiry = async () => {
    setCheckingExpiry(true);
    try {
      const res = await notificationsAPI.checkAdsExpiry();
      toast({ 
        title: 'تم التحقق', 
        description: res.data.message 
      });
      fetchData();
    } catch (error) {
      toast({ title: 'خطأ', description: 'فشل في التحقق', variant: 'destructive' });
    } finally {
      setCheckingExpiry(false);
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      title_ar: '',
      ad_type: 'banner',
      position: 'hero',
      link_url: '',
      youtube_video_id: '',
      banner_image_url: '',
      description: '',
      description_ar: '',
      start_date: '',
      end_date: '',
      priority: 0,
      is_active: true,
      branch_id: '',
      target_audience: 'all'
    });
    setEditingAd(null);
  };

  const handleOpenDialog = (ad = null) => {
    if (ad) {
      setEditingAd(ad);
      setFormData({
        title: ad.title || '',
        title_ar: ad.title_ar || '',
        ad_type: ad.ad_type || 'banner',
        position: ad.position || 'hero',
        link_url: ad.link_url || '',
        youtube_video_id: ad.youtube_video_id || '',
        banner_image_url: ad.banner_image_url || '',
        description: ad.description || '',
        description_ar: ad.description_ar || '',
        start_date: ad.start_date || '',
        end_date: ad.end_date || '',
        priority: ad.priority || 0,
        is_active: ad.is_active !== false,
        branch_id: ad.branch_id || '',
        target_audience: ad.target_audience || 'all'
      });
    } else {
      resetForm();
    }
    setDialogOpen(true);
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const formDataUpload = new FormData();
      formDataUpload.append('file', file);
      const res = await advertisementsAPI.uploadBanner(formDataUpload);
      setFormData(prev => ({ ...prev, banner_image_url: res.data.url }));
      toast({ title: 'تم رفع الصورة بنجاح' });
    } catch (error) {
      toast({ title: 'خطأ', description: 'فشل في رفع الصورة', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.title_ar) {
      toast({ title: 'خطأ', description: 'يرجى إدخال عنوان الإعلان', variant: 'destructive' });
      return;
    }

    try {
      if (editingAd) {
        await advertisementsAPI.update(editingAd.id, formData);
        toast({ title: 'تم تحديث الإعلان بنجاح' });
      } else {
        await advertisementsAPI.create(formData);
        toast({ title: 'تم إنشاء الإعلان بنجاح' });
      }
      setDialogOpen(false);
      fetchData();
    } catch (error) {
      toast({ 
        title: 'خطأ', 
        description: error.response?.data?.detail || 'فشل في حفظ الإعلان', 
        variant: 'destructive' 
      });
    }
  };

  const handleDelete = async (ad) => {
    if (!window.confirm(`هل أنت متأكد من حذف الإعلان "${ad.title_ar}"؟`)) return;
    
    try {
      await advertisementsAPI.delete(ad.id);
      toast({ title: 'تم حذف الإعلان بنجاح' });
      fetchData();
    } catch (error) {
      toast({ title: 'خطأ', description: 'فشل في حذف الإعلان', variant: 'destructive' });
    }
  };

  const handleToggle = async (ad) => {
    try {
      await advertisementsAPI.toggle(ad.id);
      toast({ title: ad.is_active ? 'تم إيقاف الإعلان' : 'تم تفعيل الإعلان' });
      fetchData();
    } catch (error) {
      toast({ title: 'خطأ', description: 'فشل في تغيير حالة الإعلان', variant: 'destructive' });
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'banner': return <Image className="w-4 h-4" />;
      case 'video': return <Video className="w-4 h-4" />;
      case 'link': return <Link2 className="w-4 h-4" />;
      default: return <Megaphone className="w-4 h-4" />;
    }
  };

  const getTypeLabel = (type) => {
    switch (type) {
      case 'banner': return 'بنر';
      case 'video': return 'فيديو';
      case 'link': return 'رابط';
      default: return type;
    }
  };

  const getPositionLabel = (position) => {
    switch (position) {
      case 'hero': return 'البانر الرئيسي';
      case 'sidebar': return 'الشريط الجانبي';
      case 'inline': return 'بين المحتوى';
      case 'popup': return 'نافذة منبثقة';
      default: return position;
    }
  };

  const filteredAds = ads.filter(ad => {
    const matchesSearch = ad.title_ar?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         ad.title?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'all' || ad.ad_type === filterType;
    const matchesPosition = filterPosition === 'all' || ad.position === filterPosition;
    return matchesSearch && matchesType && matchesPosition;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Megaphone className="w-7 h-7 text-blue-600" />
            إدارة الإعلانات
          </h1>
          <p className="text-gray-600 mt-1">إدارة إعلانات بوابة الأعضاء (بنرات، فيديوهات، روابط)</p>
        </div>
        <Button onClick={() => handleOpenDialog()} className="gap-2">
          <Plus className="w-4 h-4" />
          إضافة إعلان
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardContent className="p-4 text-center">
              <Megaphone className="w-8 h-8 text-blue-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-blue-700">{stats.total_ads}</p>
              <p className="text-sm text-blue-600">إجمالي الإعلانات</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <CardContent className="p-4 text-center">
              <ToggleRight className="w-8 h-8 text-green-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-green-700">{stats.active_ads}</p>
              <p className="text-sm text-green-600">إعلانات نشطة</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
            <CardContent className="p-4 text-center">
              <Eye className="w-8 h-8 text-purple-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-purple-700">{stats.total_views?.toLocaleString()}</p>
              <p className="text-sm text-purple-600">المشاهدات</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
            <CardContent className="p-4 text-center">
              <MousePointerClick className="w-8 h-8 text-orange-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-orange-700">{stats.total_clicks?.toLocaleString()}</p>
              <p className="text-sm text-orange-600">النقرات</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-cyan-50 to-cyan-100 border-cyan-200">
            <CardContent className="p-4 text-center">
              <TrendingUp className="w-8 h-8 text-cyan-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-cyan-700">{stats.ctr}%</p>
              <p className="text-sm text-cyan-600">معدل النقر</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-pink-50 to-pink-100 border-pink-200">
            <CardContent className="p-4 text-center">
              <Image className="w-8 h-8 text-pink-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-pink-700">{stats.banners_count}</p>
              <p className="text-sm text-pink-600">بنرات</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-red-50 to-red-100 border-red-200">
            <CardContent className="p-4 text-center">
              <Video className="w-8 h-8 text-red-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-red-700">{stats.videos_count}</p>
              <p className="text-sm text-red-600">فيديوهات</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Ads Expiry Alerts */}
      {adsStatus && (adsStatus.expired?.length > 0 || adsStatus.expiring_soon?.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Expired Ads Alert */}
          {adsStatus.expired?.length > 0 && (
            <Card className="border-red-300 bg-red-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-red-700 flex items-center gap-2 text-lg">
                  <AlertTriangle className="w-5 h-5" />
                  إعلانات منتهية ({adsStatus.expired.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {adsStatus.expired.map((ad) => (
                    <div key={ad.id} className="flex items-center justify-between p-2 bg-white rounded border border-red-200">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{ad.title_ar}</p>
                        <p className="text-xs text-red-600">انتهى منذ {ad.days_expired} أيام</p>
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleOpenDialog(ads.find(a => a.id === ad.id))}
                        className="text-xs"
                      >
                        تعديل
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Expiring Soon Ads Alert */}
          {adsStatus.expiring_soon?.length > 0 && (
            <Card className="border-orange-300 bg-orange-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-orange-700 flex items-center gap-2 text-lg">
                  <Clock className="w-5 h-5" />
                  تنتهي قريباً ({adsStatus.expiring_soon.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {adsStatus.expiring_soon.map((ad) => (
                    <div key={ad.id} className="flex items-center justify-between p-2 bg-white rounded border border-orange-200">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{ad.title_ar}</p>
                        <p className="text-xs text-orange-600">
                          {ad.days_remaining === 0 ? 'ينتهي اليوم!' : `ينتهي خلال ${ad.days_remaining} أيام`}
                        </p>
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleOpenDialog(ads.find(a => a.id === ad.id))}
                        className="text-xs"
                      >
                        تمديد
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Check Expiry Button */}
      <div className="flex justify-end">
        <Button 
          variant="outline" 
          onClick={handleCheckExpiry}
          disabled={checkingExpiry}
          className="gap-2"
        >
          {checkingExpiry ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Bell className="w-4 h-4" />
          )}
          فحص الإعلانات المنتهية وإرسال إشعارات
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="بحث في الإعلانات..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pr-10"
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="نوع الإعلان" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع الأنواع</SelectItem>
                <SelectItem value="banner">بنرات</SelectItem>
                <SelectItem value="video">فيديوهات</SelectItem>
                <SelectItem value="link">روابط</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterPosition} onValueChange={setFilterPosition}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="موقع العرض" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع المواقع</SelectItem>
                <SelectItem value="hero">البانر الرئيسي</SelectItem>
                <SelectItem value="sidebar">الشريط الجانبي</SelectItem>
                <SelectItem value="inline">بين المحتوى</SelectItem>
                <SelectItem value="popup">نافذة منبثقة</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Ads List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            قائمة الإعلانات ({filteredAds.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredAds.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Megaphone className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>لا توجد إعلانات</p>
              <Button onClick={() => handleOpenDialog()} variant="outline" className="mt-4">
                إضافة إعلان جديد
              </Button>
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredAds.map((ad) => (
                <div 
                  key={ad.id} 
                  className={`border rounded-lg p-4 transition-all ${
                    ad.is_active ? 'bg-white hover:shadow-md' : 'bg-gray-50 opacity-75'
                  }`}
                >
                  <div className="flex flex-col md:flex-row gap-4">
                    {/* Preview */}
                    <div className="w-full md:w-48 h-32 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                      {ad.ad_type === 'banner' && ad.banner_image_url ? (
                        <img 
                          src={`${process.env.REACT_APP_BACKEND_URL}${ad.banner_image_url}`} 
                          alt={ad.title_ar}
                          className="w-full h-full object-cover"
                        />
                      ) : ad.ad_type === 'video' && ad.youtube_video_id ? (
                        <div className="w-full h-full relative">
                          <img 
                            src={`https://img.youtube.com/vi/${ad.youtube_video_id}/mqdefault.jpg`}
                            alt={ad.title_ar}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <Play className="w-10 h-10 text-white" />
                          </div>
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          {getTypeIcon(ad.ad_type)}
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-gray-900 flex items-center gap-2">
                            {ad.title_ar}
                            {!ad.is_active && (
                              <Badge variant="secondary">متوقف</Badge>
                            )}
                          </h3>
                          {ad.description_ar && (
                            <p className="text-sm text-gray-600 mt-1 line-clamp-2">{ad.description_ar}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => handleToggle(ad)}
                            title={ad.is_active ? 'إيقاف' : 'تفعيل'}
                          >
                            {ad.is_active ? (
                              <ToggleRight className="w-5 h-5 text-green-600" />
                            ) : (
                              <ToggleLeft className="w-5 h-5 text-gray-400" />
                            )}
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => handleOpenDialog(ad)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => handleDelete(ad)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 mt-3">
                        <Badge variant="outline" className="gap-1">
                          {getTypeIcon(ad.ad_type)}
                          {getTypeLabel(ad.ad_type)}
                        </Badge>
                        <Badge variant="outline">{getPositionLabel(ad.position)}</Badge>
                        <Badge variant="outline" className="gap-1">
                          <Eye className="w-3 h-3" />
                          {ad.views_count?.toLocaleString() || 0}
                        </Badge>
                        <Badge variant="outline" className="gap-1">
                          <MousePointerClick className="w-3 h-3" />
                          {ad.clicks_count?.toLocaleString() || 0}
                        </Badge>
                        {ad.start_date && (
                          <Badge variant="outline" className="gap-1">
                            <Calendar className="w-3 h-3" />
                            {ad.start_date} - {ad.end_date || '∞'}
                          </Badge>
                        )}
                      </div>

                      {ad.link_url && (
                        <a 
                          href={ad.link_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline mt-2 flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {ad.link_url}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {editingAd ? 'تعديل الإعلان' : 'إضافة إعلان جديد'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>العنوان (عربي) *</Label>
                <Input
                  value={formData.title_ar}
                  onChange={(e) => setFormData(prev => ({ ...prev, title_ar: e.target.value }))}
                  placeholder="عنوان الإعلان بالعربية"
                />
              </div>
              <div>
                <Label>العنوان (إنجليزي)</Label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Ad Title in English"
                  dir="ltr"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>الوصف (عربي)</Label>
                <Textarea
                  value={formData.description_ar}
                  onChange={(e) => setFormData(prev => ({ ...prev, description_ar: e.target.value }))}
                  placeholder="وصف الإعلان..."
                  rows={2}
                />
              </div>
              <div>
                <Label>الوصف (إنجليزي)</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Ad description..."
                  rows={2}
                  dir="ltr"
                />
              </div>
            </div>

            {/* Type & Position */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>نوع الإعلان *</Label>
                <Select 
                  value={formData.ad_type} 
                  onValueChange={(v) => setFormData(prev => ({ ...prev, ad_type: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="banner">
                      <div className="flex items-center gap-2">
                        <Image className="w-4 h-4" /> بنر (صورة)
                      </div>
                    </SelectItem>
                    <SelectItem value="video">
                      <div className="flex items-center gap-2">
                        <Video className="w-4 h-4" /> فيديو (YouTube)
                      </div>
                    </SelectItem>
                    <SelectItem value="link">
                      <div className="flex items-center gap-2">
                        <Link2 className="w-4 h-4" /> رابط
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>موقع العرض *</Label>
                <Select 
                  value={formData.position} 
                  onValueChange={(v) => setFormData(prev => ({ ...prev, position: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hero">البانر الرئيسي (أعلى الصفحة)</SelectItem>
                    <SelectItem value="sidebar">الشريط الجانبي</SelectItem>
                    <SelectItem value="inline">بين المحتوى</SelectItem>
                    <SelectItem value="popup">نافذة منبثقة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Content based on type */}
            {formData.ad_type === 'banner' && (
              <div>
                <Label>صورة البنر</Label>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      disabled={uploading}
                      className="flex-1"
                    />
                    {uploading && (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                    )}
                  </div>
                  {formData.banner_image_url && (
                    <div className="relative w-full h-40 rounded-lg overflow-hidden bg-gray-100">
                      <img 
                        src={`${process.env.REACT_APP_BACKEND_URL}${formData.banner_image_url}`}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                      <Button
                        variant="destructive"
                        size="sm"
                        className="absolute top-2 left-2"
                        onClick={() => setFormData(prev => ({ ...prev, banner_image_url: '' }))}
                      >
                        حذف
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {formData.ad_type === 'video' && (
              <div>
                <Label>رابط فيديو YouTube</Label>
                <Input
                  value={formData.youtube_video_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, youtube_video_id: e.target.value }))}
                  placeholder="https://www.youtube.com/watch?v=VIDEO_ID أو VIDEO_ID فقط"
                  dir="ltr"
                />
                <p className="text-xs text-gray-500 mt-1">
                  يمكنك لصق رابط YouTube الكامل أو معرف الفيديو فقط
                </p>
                {formData.youtube_video_id && (
                  <div className="mt-2 relative w-full h-40 rounded-lg overflow-hidden bg-gray-100">
                    <img 
                      src={`https://img.youtube.com/vi/${formData.youtube_video_id}/mqdefault.jpg`}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <Play className="w-12 h-12 text-white" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Link URL */}
            <div>
              <Label>الرابط الخارجي (عند النقر)</Label>
              <Input
                value={formData.link_url}
                onChange={(e) => setFormData(prev => ({ ...prev, link_url: e.target.value }))}
                placeholder="https://example.com"
                dir="ltr"
              />
            </div>

            {/* Dates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>تاريخ البداية</Label>
                <Input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, start_date: e.target.value }))}
                />
              </div>
              <div>
                <Label>تاريخ النهاية</Label>
                <Input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, end_date: e.target.value }))}
                />
              </div>
            </div>

            {/* Priority & Branch */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>الأولوية</Label>
                <Input
                  type="number"
                  value={formData.priority}
                  onChange={(e) => setFormData(prev => ({ ...prev, priority: parseInt(e.target.value) || 0 }))}
                  min={0}
                  max={100}
                />
                <p className="text-xs text-gray-500 mt-1">كلما زاد الرقم، ظهر أولاً</p>
              </div>
              <div>
                <Label>الفرع</Label>
                <Select 
                  value={formData.branch_id || 'all'} 
                  onValueChange={(v) => setFormData(prev => ({ ...prev, branch_id: v === 'all' ? '' : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="جميع الفروع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">جميع الفروع</SelectItem>
                    {branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name_ar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>الجمهور المستهدف</Label>
                <Select 
                  value={formData.target_audience} 
                  onValueChange={(v) => setFormData(prev => ({ ...prev, target_audience: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الجميع</SelectItem>
                    <SelectItem value="members">الأعضاء فقط</SelectItem>
                    <SelectItem value="guests">الزوار فقط</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Active Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <Label className="text-base">تفعيل الإعلان</Label>
                <p className="text-sm text-gray-500">عند التفعيل سيظهر الإعلان في بوابة الأعضاء</p>
              </div>
              <Switch
                checked={formData.is_active}
                onCheckedChange={(v) => setFormData(prev => ({ ...prev, is_active: v }))}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleSubmit}>
              {editingAd ? 'حفظ التغييرات' : 'إضافة الإعلان'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdvertisementsPage;
