/**
 * Add Member Dialog Component
 * نافذة إضافة عضو جديد
 */
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Loader2, UserPlus } from 'lucide-react';

const AddMemberDialog = ({
  isOpen,
  onClose,
  memberData,
  onMemberDataChange,
  onSave,
  saving = false,
  language = 'ar',
  t
}) => {
  const handleChange = (field, value) => {
    onMemberDataChange({ ...memberData, [field]: value });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            {language === 'ar' ? 'إضافة عضو جديد' : 'Add New Member'}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'الاسم بالعربي *' : 'Arabic Name *'}</Label>
              <Input
                value={memberData.name_ar || ''}
                onChange={(e) => handleChange('name_ar', e.target.value)}
                placeholder={language === 'ar' ? 'الاسم بالعربي' : 'Arabic name'}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'الاسم بالإنجليزي' : 'English Name'}</Label>
              <Input
                value={memberData.name || ''}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder={language === 'ar' ? 'الاسم بالإنجليزي' : 'English name'}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'العمر' : 'Age'}</Label>
              <Input
                type="number"
                value={memberData.age || ''}
                onChange={(e) => handleChange('age', e.target.value)}
                placeholder={language === 'ar' ? 'العمر' : 'Age'}
              />
            </div>
            <div className="space-y-2">
              <Label>{t?.('phone') || 'Phone'} *</Label>
              <Input
                type="tel"
                value={memberData.phone || ''}
                onChange={(e) => handleChange('phone', e.target.value)}
                placeholder="05xxxxxxxx"
                dir="ltr"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'اسم ولي الأمر (عربي)' : 'Guardian Name (Arabic)'}</Label>
              <Input
                value={memberData.guardian_name_ar || ''}
                onChange={(e) => handleChange('guardian_name_ar', e.target.value)}
                placeholder={language === 'ar' ? 'اسم ولي الأمر' : 'Guardian name'}
              />
            </div>
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'اسم ولي الأمر (إنجليزي)' : 'Guardian Name (English)'}</Label>
              <Input
                value={memberData.guardian_name || ''}
                onChange={(e) => handleChange('guardian_name', e.target.value)}
                placeholder={language === 'ar' ? 'اسم ولي الأمر' : 'Guardian name'}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onClose(false)}
            disabled={saving}
          >
            {language === 'ar' ? 'إلغاء' : 'Cancel'}
          </Button>
          <Button
            onClick={onSave}
            disabled={saving || !memberData.name_ar || !memberData.phone}
          >
            {saving ? (
              <><Loader2 className="w-4 h-4 me-2 animate-spin" />{language === 'ar' ? 'جاري الحفظ...' : 'Saving...'}</>
            ) : (
              <><UserPlus className="w-4 h-4 me-2" />{language === 'ar' ? 'حفظ وإضافة' : 'Save & Add'}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddMemberDialog;
