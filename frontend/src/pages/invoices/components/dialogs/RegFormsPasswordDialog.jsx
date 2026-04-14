import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../../components/ui/dialog';

export const RegFormsPasswordDialog = ({
  isOpen, onOpenChange, passwordInput, setPasswordInput,
  onConfirm, language
}) => {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) { onOpenChange(false); setPasswordInput(''); } }}
    >
      <DialogContent className="max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle>{language === 'ar' ? 'أدخل كلمة المرور' : 'Enter Password'}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <p className="text-sm text-gray-600 mb-3">
            {language === 'ar' ? 'أدخل كلمة المرور للوصول إلى استمارات التسجيل:' : 'Enter password to access registration forms:'}
          </p>
          <input
            type="password"
            value={passwordInput}
            onChange={e => setPasswordInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onConfirm(); }}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            autoFocus
            placeholder="••••••"
          />
        </div>
        <DialogFooter className="gap-2">
          <button
            onClick={() => { onOpenChange(false); setPasswordInput(''); }}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            {language === 'ar' ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
          >
            {language === 'ar' ? 'تأكيد' : 'Confirm'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
