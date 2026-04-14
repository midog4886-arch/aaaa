import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Loader2 } from 'lucide-react';

export const AddMemberDialog = ({
  isOpen, onOpenChange, newMemberData, setNewMemberData,
  saving, onSubmit, language, t
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('add_member')}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'اسم العضو *' : 'Name *'}</Label>
              <Input value={newMemberData.name_ar} onChange={(e) => setNewMemberData({ ...newMemberData, name_ar: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>{t('phone')} *</Label>
              <Input value={newMemberData.phone} onChange={(e) => setNewMemberData({ ...newMemberData, phone: e.target.value })} type="tel" dir="ltr" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'ولي الأمر' : 'Guardian'}</Label>
              <Input value={newMemberData.guardian_name_ar} onChange={(e) => setNewMemberData({ ...newMemberData, guardian_name_ar: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t('age')}</Label>
              <Input value={newMemberData.age} onChange={(e) => setNewMemberData({ ...newMemberData, age: e.target.value })} type="number" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
