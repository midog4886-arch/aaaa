import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { coachesAPI, activitiesAPI } from '../services/api';
import { toast } from 'sonner';
import { 
  Plus, 
  Edit, 
  Trash2,
  Loader2,
  UserCog,
  Phone,
  Mail
} from 'lucide-react';

export const CoachesPage = () => {
  const { t, language } = useLanguage();
  const [coaches, setCoaches] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedCoach, setSelectedCoach] = useState(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    name_ar: '',
    phone: '',
    email: '',
    activities: [],
    notes: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [coachesRes, activitiesRes] = await Promise.all([
        coachesAPI.getAll(),
        activitiesAPI.getAll()
      ]);
      setCoaches(coachesRes.data);
      setActivities(activitiesRes.data);
    } catch (error) {
      console.error('Failed to load data:', error);
      toast.error(t('error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      if (selectedCoach) {
        await coachesAPI.update(selectedCoach.id, formData);
      } else {
        await coachesAPI.create(formData);
      }
      
      toast.success(t('success'));
      loadData();
      closeDialog();
    } catch (error) {
      console.error('Failed to save coach:', error);
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
      await coachesAPI.delete(id);
      toast.success(t('success'));
      loadData();
    } catch (error) {
      console.error('Failed to delete coach:', error);
      toast.error(t('error'));
    }
  };

  const openEditDialog = (coach) => {
    setSelectedCoach(coach);
    setFormData({
      name: coach.name || '',
      name_ar: coach.name_ar || '',
      phone: coach.phone || '',
      email: coach.email || '',
      activities: coach.activities || [],
      notes: coach.notes || ''
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setSelectedCoach(null);
    setFormData({
      name: '',
      name_ar: '',
      phone: '',
      email: '',
      activities: [],
      notes: ''
    });
  };

  const toggleActivity = (activityId) => {
    setFormData(prev => ({
      ...prev,
      activities: prev.activities.includes(activityId)
        ? prev.activities.filter(id => id !== activityId)
        : [...prev.activities, activityId]
    }));
  };

  const getActivityName = (activityId) => {
    const activity = activities.find(a => a.id === activityId);
    return activity ? (language === 'ar' ? activity.name_ar : activity.name) : '';
  };

  const getActivityColor = (activityId) => {
    const activity = activities.find(a => a.id === activityId);
    return activity?.color || '#64748b';
  };

  if (loading) {
    return (
      <Layout title={t('coaches')}>
        <div className="flex items-center justify-center h-64">
          <div className="spinner" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('coaches')}>
      <div className="space-y-6" data-testid="coaches-page">
        {/* Header */}
        <div className="flex justify-between items-center">
          <p className="text-muted-foreground">
            {language === 'ar' 
              ? `${coaches.length} مدرب مسجل` 
              : `${coaches.length} coaches registered`}
          </p>
          <Button onClick={() => setIsDialogOpen(true)} data-testid="add-coach-btn">
            <Plus className="w-4 h-4 me-2" />
            {t('add_coach')}
          </Button>
        </div>

        {/* Coaches Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {coaches.map(coach => (
            <Card 
              key={coach.id} 
              className="hover-scale"
              data-testid={`coach-card-${coach.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <UserCog className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-bold">
                        {language === 'ar' ? coach.name_ar : coach.name}
                      </h3>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Phone className="w-3 h-3" />
                        <span dir="ltr">{coach.phone}</span>
                      </div>
                    </div>
                  </div>
                  <div className="action-buttons">
                    <button 
                      className="action-button"
                      onClick={() => openEditDialog(coach)}
                      data-testid={`edit-coach-${coach.id}`}
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button 
                      className="action-button danger"
                      onClick={() => handleDelete(coach.id)}
                      data-testid={`delete-coach-${coach.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                {coach.email && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground mb-3">
                    <Mail className="w-3 h-3" />
                    <span dir="ltr">{coach.email}</span>
                  </div>
                )}
                
                <div className="flex flex-wrap gap-1">
                  {coach.activities?.map(activityId => (
                    <Badge 
                      key={activityId}
                      variant="outline"
                      style={{ 
                        backgroundColor: `${getActivityColor(activityId)}15`,
                        color: getActivityColor(activityId),
                        borderColor: `${getActivityColor(activityId)}30`
                      }}
                    >
                      {getActivityName(activityId)}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {coaches.length === 0 && (
          <div className="empty-state">
            <UserCog className="empty-state-icon" />
            <p>{t('no_data')}</p>
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {selectedCoach 
                  ? (language === 'ar' ? 'تعديل المدرب' : 'Edit Coach')
                  : t('add_coach')}
              </DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('coach_name')} (العربية)</Label>
                  <Input
                    value={formData.name_ar}
                    onChange={(e) => setFormData({...formData, name_ar: e.target.value})}
                    required
                    data-testid="coach-name-ar"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('coach_name')} (English)</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    data-testid="coach-name-en"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('phone')}</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    type="tel"
                    dir="ltr"
                    required
                    data-testid="coach-phone"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('email')}</Label>
                  <Input
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    type="email"
                    dir="ltr"
                    data-testid="coach-email"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>{t('coach_activities')}</Label>
                <div className="grid grid-cols-2 gap-2">
                  {activities.map(activity => (
                    <div 
                      key={activity.id}
                      className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-accent"
                      onClick={() => toggleActivity(activity.id)}
                    >
                      <Checkbox 
                        checked={formData.activities.includes(activity.id)}
                        onCheckedChange={() => toggleActivity(activity.id)}
                        data-testid={`activity-checkbox-${activity.id}`}
                      />
                      <div 
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: activity.color }}
                      />
                      <span className="text-sm">
                        {language === 'ar' ? activity.name_ar : activity.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>{t('notes')}</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  data-testid="coach-notes"
                />
              </div>
              
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog}>
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={saving} data-testid="save-coach-btn">
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

export default CoachesPage;
