import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { activitiesAPI } from '../services/api';
import { toast } from 'sonner';
import { 
  Plus, 
  Edit, 
  Trash2,
  Loader2,
  Waves,
  Dumbbell
} from 'lucide-react';

export const ActivitiesPage = () => {
  const { t, language } = useLanguage();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    name_ar: '',
    description: '',
    description_ar: '',
    monthly_fee: '',
    color: '#F97316'
  });

  const colorOptions = [
    { value: '#0EA5E9', label: language === 'ar' ? 'أزرق' : 'Blue' },
    { value: '#22C55E', label: language === 'ar' ? 'أخضر' : 'Green' },
    { value: '#EF4444', label: language === 'ar' ? 'أحمر' : 'Red' },
    { value: '#8B5CF6', label: language === 'ar' ? 'بنفسجي' : 'Purple' },
    { value: '#F97316', label: language === 'ar' ? 'برتقالي' : 'Orange' },
    { value: '#EC4899', label: language === 'ar' ? 'وردي' : 'Pink' },
  ];

  useEffect(() => {
    loadActivities();
  }, []);

  const loadActivities = async () => {
    try {
      const response = await activitiesAPI.getAll();
      setActivities(response.data);
    } catch (error) {
      console.error('Failed to load activities:', error);
      toast.error(t('error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const data = {
        ...formData,
        monthly_fee: parseFloat(formData.monthly_fee) || 0
      };
      
      if (selectedActivity) {
        await activitiesAPI.update(selectedActivity.id, data);
      } else {
        await activitiesAPI.create(data);
      }
      
      toast.success(t('success'));
      loadActivities();
      closeDialog();
    } catch (error) {
      console.error('Failed to save activity:', error);
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من الحذف؟' : 'Are you sure you want to delete?')) {
      return;
    }
    
    try {
      await activitiesAPI.delete(id);
      toast.success(t('success'));
      loadActivities();
    } catch (error) {
      console.error('Failed to delete activity:', error);
      toast.error(t('error'));
    }
  };

  const openEditDialog = (activity) => {
    setSelectedActivity(activity);
    setFormData({
      name: activity.name || '',
      name_ar: activity.name_ar || '',
      description: activity.description || '',
      description_ar: activity.description_ar || '',
      monthly_fee: activity.monthly_fee?.toString() || '',
      color: activity.color || '#F97316'
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setSelectedActivity(null);
    setFormData({
      name: '',
      name_ar: '',
      description: '',
      description_ar: '',
      monthly_fee: '',
      color: '#F97316'
    });
  };

  const getActivityIcon = (name) => {
    const iconMap = {
      'السباحة': Waves,
      'Swimming': Waves,
    };
    return iconMap[name] || Dumbbell;
  };

  if (loading) {
    return (
      <Layout title={t('activities')}>
        <div className="flex items-center justify-center h-64">
          <div className="spinner" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('activities')}>
      <div className="space-y-6" data-testid="activities-page">
        {/* Header */}
        <div className="flex justify-between items-center">
          <p className="text-muted-foreground">
            {language === 'ar' 
              ? `${activities.length} نشاط مسجل` 
              : `${activities.length} activities registered`}
          </p>
          <Button onClick={() => setIsDialogOpen(true)} data-testid="add-activity-btn">
            <Plus className="w-4 h-4 me-2" />
            {t('add_activity')}
          </Button>
        </div>

        {/* Activities Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {activities.map(activity => {
            const Icon = getActivityIcon(activity.name);
            return (
              <Card 
                key={activity.id} 
                className="hover-scale overflow-hidden"
                data-testid={`activity-card-${activity.id}`}
              >
                <div 
                  className="h-2"
                  style={{ backgroundColor: activity.color }}
                />
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-4">
                    <div 
                      className="w-12 h-12 rounded-xl flex items-center justify-center"
                      style={{ backgroundColor: `${activity.color}20` }}
                    >
                      <Icon className="w-6 h-6" style={{ color: activity.color }} />
                    </div>
                    <div className="action-buttons">
                      <button 
                        className="action-button"
                        onClick={() => openEditDialog(activity)}
                        data-testid={`edit-activity-${activity.id}`}
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button 
                        className="action-button danger"
                        onClick={() => handleDelete(activity.id)}
                        data-testid={`delete-activity-${activity.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  <h3 className="font-bold text-lg mb-1">
                    {language === 'ar' ? activity.name_ar : activity.name}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {language === 'ar' ? activity.description_ar : activity.description}
                  </p>
                  
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold" style={{ color: activity.color }}>
                      {activity.monthly_fee}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t('sar')} / {t('monthly')}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {activities.length === 0 && (
          <div className="empty-state">
            <Dumbbell className="empty-state-icon" />
            <p>{t('no_data')}</p>
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {selectedActivity 
                  ? (language === 'ar' ? 'تعديل النشاط' : 'Edit Activity')
                  : t('add_activity')}
              </DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('activity_name')} (العربية)</Label>
                  <Input
                    value={formData.name_ar}
                    onChange={(e) => setFormData({...formData, name_ar: e.target.value})}
                    required
                    data-testid="activity-name-ar"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('activity_name')} (English)</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    data-testid="activity-name-en"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>{t('description')} (العربية)</Label>
                <Textarea
                  value={formData.description_ar}
                  onChange={(e) => setFormData({...formData, description_ar: e.target.value})}
                  data-testid="activity-desc-ar"
                />
              </div>
              
              <div className="space-y-2">
                <Label>{t('description')} (English)</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  data-testid="activity-desc-en"
                />
              </div>
              
              <div className="space-y-2">
                <Label>{t('monthly_fee')} ({t('sar')})</Label>
                <Input
                  type="number"
                  value={formData.monthly_fee}
                  onChange={(e) => setFormData({...formData, monthly_fee: e.target.value})}
                  required
                  data-testid="activity-fee"
                />
              </div>
              
              <div className="space-y-2">
                <Label>{t('color')}</Label>
                <div className="flex gap-2 flex-wrap">
                  {colorOptions.map(color => (
                    <button
                      key={color.value}
                      type="button"
                      className={`w-10 h-10 rounded-lg border-2 transition-transform ${
                        formData.color === color.value 
                          ? 'scale-110 border-foreground' 
                          : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: color.value }}
                      onClick={() => setFormData({...formData, color: color.value})}
                      data-testid={`color-${color.value}`}
                    />
                  ))}
                </div>
              </div>
              
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog}>
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={saving} data-testid="save-activity-btn">
                  {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {t('save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default ActivitiesPage;
