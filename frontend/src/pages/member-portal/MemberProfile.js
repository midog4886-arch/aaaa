import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  User, Mail, MapPin, Phone, Calendar, Hash, ImagePlus,
  X, Save, Loader2, AlertTriangle, ShieldCheck, Pencil, Send, Clock
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/textarea';
import MemberLayout, { memberAPI, getDarkMode, getLanguage, getMemberData } from './MemberLayout';
import { useBrandColor } from '../../services/branding';
import {
  compressImageFile,
  estimateDataUrlBytes,
  PROFILE_PHOTO_HARD_CAP_BYTES,
} from '../../utils/imageCompression';

const formatDate = (dateStr, language) => {
  if (!dateStr) return '\u2014';
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
};

const initialsFor = (name) => {
  if (!name) return '\u061F';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] || '') + (parts[1][0] || '');
};

const MemberProfile = () => {
  const language = getLanguage();
  const darkMode = getDarkMode();
  const t = (ar, en) => (language === 'ar' ? ar : en);
  const primary = useBrandColor();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState(null);
  const [photo, setPhoto] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [imgError, setImgError] = useState(false);
  const fileInputRef = useRef(null);

  // "Request a change" flow for the read-only fields. Members can't directly
  // edit name/phone/date_of_birth (billing & identity implications); instead
  // they file a request that lands in the admin messages inbox so the academy
  // can verify and apply it.
  const [requestField, setRequestField] = useState(null);
  const [requestValue, setRequestValue] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  // Pending change requests keyed by field (name / phone / date_of_birth) so
  // the locked-fields card can show a "request pending" badge with the value
  // the member already asked for.
  const [pendingByField, setPendingByField] = useState({});

  const fetchProfile = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/profile');
      const data = res.data || {};
      setProfile(data);
      setPhoto(data.photo || '');
      setEmail(data.email || '');
      setAddress(data.address || '');
      setEmergencyContact(data.emergency_contact || '');
      setImgError(false);
    } catch (err) {
      console.error('Failed to load profile', err);
      toast.error(t('\u0641\u0634\u0644 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062E\u0635\u064A', 'Failed to load profile'));
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingRequests = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/profile/change-requests');
      const list = Array.isArray(res.data?.pending) ? res.data.pending : [];
      const byField = {};
      list.forEach((item) => {
        if (item && item.field && !byField[item.field]) {
          byField[item.field] = item;
        }
      });
      setPendingByField(byField);
    } catch (err) {
      // Non-fatal: the badge just won't show. Don't toast — the page is
      // still usable without it and the request itself succeeded earlier.
      console.error('Failed to load pending change requests', err);
    }
  };

  useEffect(() => {
    fetchProfile();
    fetchPendingRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('يرجى اختيار صورة', 'Please choose an image'));
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    try {
      const base64 = await compressImageFile(file);
      if (estimateDataUrlBytes(base64) > PROFILE_PHOTO_HARD_CAP_BYTES) {
        toast.error(t(
          'تعذّر تصغير الصورة بما يكفي، يرجى اختيار صورة أصغر',
          'Could not shrink the image enough, please choose a smaller photo'
        ));
        return;
      }
      setPhoto(base64);
      setImgError(false);
    } catch (err) {
      toast.error(t('فشل قراءة الصورة', 'Failed to read image'));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemovePhoto = () => {
    setPhoto('');
    setImgError(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        email,
        address,
        emergency_contact: emergencyContact,
        photo: photo || '',
      };
      const res = await memberAPI.put('/api/member-portal/profile', payload);
      const updated = res.data?.profile;
      if (updated) {
        setProfile(updated);
        setPhoto(updated.photo || '');
        // Sync the cached member_data so the header avatar/name stay fresh
        try {
          const cached = getMemberData() || {};
          const merged = {
            ...cached,
            email: updated.email,
            photo: updated.photo,
          };
          localStorage.setItem('member_data', JSON.stringify(merged));
          // Notify other mounted portal screens (e.g. MemberLayout header)
          // so the avatar updates immediately without requiring navigation.
          window.dispatchEvent(new Event('member-data-updated'));
        } catch (_) {}
      }
      toast.success(t('تم حفظ التغييرات', 'Changes saved'));
    } catch (err) {
      console.error('Failed to save profile', err);
      const detail = err.response?.data?.detail;
      toast.error(detail || t('فشل حفظ التغييرات', 'Failed to save changes'));
    } finally {
      setSaving(false);
    }
  };

  const fieldMeta = {
    name: {
      label: t('الاسم', 'Name'),
      placeholder: t('الاسم الكامل الصحيح', 'Correct full name'),
      type: 'text',
      dir: language === 'ar' ? 'rtl' : 'ltr',
    },
    phone: {
      label: t('رقم الجوال', 'Phone'),
      placeholder: '05xxxxxxxx',
      type: 'tel',
      dir: 'ltr',
    },
    date_of_birth: {
      label: t('تاريخ الميلاد', 'Date of birth'),
      placeholder: 'YYYY-MM-DD',
      type: 'date',
      dir: 'ltr',
    },
  };

  const currentValueFor = (field) => {
    if (!profile) return '';
    if (field === 'name') return profile.name_ar || profile.name || '';
    if (field === 'phone') return profile.phone || '';
    if (field === 'date_of_birth') return profile.date_of_birth || '';
    return '';
  };

  const openChangeRequest = (field) => {
    setRequestField(field);
    // If a request is already pending for this field, prefill the dialog with
    // it so the member can tweak/resubmit without retyping from scratch.
    const pending = pendingByField[field];
    setRequestValue(pending?.new_value || '');
    setRequestReason(pending?.reason || '');
  };

  const closeChangeRequest = (open) => {
    if (open) return;
    if (submittingRequest) return;
    setRequestField(null);
    setRequestValue('');
    setRequestReason('');
  };

  const submitChangeRequest = async () => {
    if (!requestField) return;
    const newValue = requestValue.trim();
    if (!newValue) {
      toast.error(t('الرجاء إدخال القيمة الجديدة', 'Please enter the new value'));
      return;
    }
    setSubmittingRequest(true);
    try {
      await memberAPI.post('/api/member-portal/profile/change-request', {
        field: requestField,
        new_value: newValue,
        reason: requestReason.trim(),
      });
      toast.success(
        t('تم إرسال طلب التعديل إلى الإدارة', 'Your change request was sent to the academy')
      );
      setRequestField(null);
      setRequestValue('');
      setRequestReason('');
      // Refresh badges so the new pending request shows up immediately.
      fetchPendingRequests();
    } catch (err) {
      console.error('Failed to submit change request', err);
      const detail = err.response?.data?.detail;
      toast.error(detail || t('فشل إرسال الطلب', 'Failed to send request'));
    } finally {
      setSubmittingRequest(false);
    }
  };

  const cardClass = `border-2 shadow-lg overflow-hidden ${
    darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
  }`;
  const labelClass = `text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`;
  const readonlyValueClass = `mt-1 text-base font-semibold ${
    darkMode ? 'text-white' : 'text-gray-900'
  }`;
  const subtleClass = darkMode ? 'text-gray-400' : 'text-gray-500';
  const inputClass = `mt-1 ${
    darkMode ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500' : ''
  }`;
  const requestBtnClass = `inline-flex items-center gap-1 text-xs font-medium rounded px-1.5 py-0.5 transition-colors ${
    darkMode
      ? 'text-amber-300 hover:text-amber-200 hover:bg-amber-900/30'
      : 'text-amber-600 hover:text-amber-700 hover:bg-amber-50'
  }`;
  const pendingBadgeClass = `inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 border ${
    darkMode
      ? 'bg-amber-900/40 text-amber-200 border-amber-700/60'
      : 'bg-amber-100 text-amber-800 border-amber-300'
  }`;

  const displayName = profile?.name_ar || profile?.name || '';

  const formatPendingValue = (field, value) => {
    if (!value) return '\u2014';
    if (field === 'date_of_birth') return formatDate(value, language);
    return value;
  };

  const renderRequestButton = (field) => {
    const isPending = !!pendingByField[field];
    return (
      <button
        type="button"
        onClick={() => openChangeRequest(field)}
        className={requestBtnClass}
        data-testid={`request-change-${field}-btn`}
        title={isPending
          ? t('تعديل الطلب المعلّق', 'Update pending request')
          : t('طلب تعديل', 'Request change')}
      >
        <Pencil className="w-3 h-3" />
        <span>
          {isPending
            ? t('تعديل الطلب', 'Update request')
            : t('طلب تعديل', 'Request change')}
        </span>
      </button>
    );
  };

  const renderPendingBadge = (field) => {
    const pending = pendingByField[field];
    if (!pending) return null;
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid={`pending-badge-${field}`}>
        <span className={pendingBadgeClass}>
          <Clock className="w-3 h-3" />
          {t('بانتظار الموافقة', 'Pending review')}
        </span>
        <span
          className={`text-xs ${subtleClass}`}
          dir={fieldMeta[field]?.dir || (language === 'ar' ? 'rtl' : 'ltr')}
        >
          {t('طلبت:', 'You requested:')}{' '}
          <span className={`font-semibold ${darkMode ? 'text-amber-200' : 'text-amber-700'}`}>
            {formatPendingValue(field, pending.new_value)}
          </span>
        </span>
      </div>
    );
  };

  return (
    <MemberLayout>
      <div className="space-y-6 max-w-2xl mx-auto pb-6">
        {/* Header */}
        <div className="text-center pt-2">
          <h1 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>
            {t('الملف الشخصي', 'My Profile')}
          </h1>
          <p className={`mt-1 text-sm ${subtleClass}`}>
            {t('عرض وتعديل معلوماتك الشخصية', 'View and update your personal information')}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2
              className={`w-8 h-8 animate-spin ${primary ? '' : (darkMode ? 'text-amber-400' : 'text-amber-500')}`}
              style={primary ? { color: primary } : undefined}
            />
          </div>
        ) : (
          <>
            {/* Avatar Card */}
            <Card className={cardClass}>
              <div
                className={`px-4 py-3 ${primary ? '' : 'bg-gradient-to-r from-amber-500 to-yellow-600'}`}
                style={primary ? { backgroundColor: primary } : undefined}
              >
                <h2 className="text-white font-bold flex items-center gap-2">
                  <User className="w-5 h-5" />
                  {t('الصورة الشخصية', 'Profile Picture')}
                </h2>
              </div>
              <CardContent className="p-6">
                <div className="flex flex-col items-center gap-4">
                  {photo && !imgError ? (
                    <img
                      src={photo}
                      alt={displayName}
                      onError={() => setImgError(true)}
                      className={`w-32 h-32 rounded-full object-cover border-4 shadow-lg ${primary ? '' : 'border-amber-400'}`}
                      style={primary ? { borderColor: primary } : undefined}
                    />
                  ) : (
                    <div
                      className={`w-32 h-32 rounded-full flex items-center justify-center shadow-lg border-4 ${primary ? '' : 'bg-gradient-to-br from-amber-500 to-yellow-600 border-amber-300'}`}
                      style={primary ? { backgroundColor: primary, borderColor: primary } : undefined}
                    >
                      <span className="text-3xl font-bold text-white">
                        {initialsFor(displayName)}
                      </span>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 justify-center">
                    <label className="cursor-pointer">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handlePhotoChange}
                      />
                      <span
                        className={`inline-flex items-center gap-1 px-4 py-2 text-sm rounded-md border ${
                          darkMode
                            ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-600'
                            : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-300'
                        }`}
                      >
                        <ImagePlus className="w-4 h-4" />
                        {photo ? t('تغيير الصورة', 'Change photo') : t('رفع صورة', 'Upload photo')}
                      </span>
                    </label>
                    {photo && (
                      <button
                        type="button"
                        onClick={handleRemovePhoto}
                        className={`inline-flex items-center gap-1 px-4 py-2 text-sm rounded-md border ${
                          darkMode
                            ? 'border-red-700 text-red-300 hover:bg-red-900/30'
                            : 'border-red-200 text-red-600 hover:bg-red-50'
                        }`}
                      >
                        <X className="w-4 h-4" />
                        {t('إزالة', 'Remove')}
                      </button>
                    )}
                  </div>
                  <p className={`text-xs ${subtleClass}`}>
                    {t('الحد الأقصى 2 ميجابايت', 'Max 2 MB')}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Read-only personal info */}
            <Card className={cardClass}>
              <div className="bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-3">
                <h2 className="text-white font-bold flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5" />
                  {t('المعلومات الأساسية', 'Account Information')}
                </h2>
              </div>
              <CardContent className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p className={labelClass}>{t('الاسم', 'Name')}</p>
                      {renderRequestButton('name')}
                    </div>
                    <p className={readonlyValueClass}>{displayName || '\u2014'}</p>
                    {renderPendingBadge('name')}
                  </div>
                  <div>
                    <p className={labelClass}>{t('رقم العضوية', 'Member Code')}</p>
                    <p className={readonlyValueClass} dir="ltr">
                      <span className="inline-flex items-center gap-1">
                        <Hash className="w-4 h-4 opacity-60" />
                        {profile?.member_code || '\u2014'}
                      </span>
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p className={labelClass}>{t('رقم الجوال', 'Phone')}</p>
                      {renderRequestButton('phone')}
                    </div>
                    <p className={readonlyValueClass} dir="ltr">
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-4 h-4 opacity-60" />
                        {profile?.phone || '\u2014'}
                      </span>
                    </p>
                    {renderPendingBadge('phone')}
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p className={labelClass}>{t('تاريخ الميلاد', 'Date of Birth')}</p>
                      {renderRequestButton('date_of_birth')}
                    </div>
                    <p className={readonlyValueClass}>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-4 h-4 opacity-60" />
                        {formatDate(profile?.date_of_birth, language)}
                      </span>
                    </p>
                    {renderPendingBadge('date_of_birth')}
                  </div>
                </div>
                <div
                  className={`flex items-start gap-2 text-xs rounded-md p-3 ${
                    darkMode
                      ? 'bg-amber-900/30 text-amber-200 border border-amber-800/40'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}
                >
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>
                    {t(
                      'لتعديل الاسم أو رقم الجوال أو تاريخ الميلاد، اضغط "طلب تعديل" بجانب الحقل وسيتم إرسال طلبك إلى الإدارة.',
                      'To change your name, phone or date of birth, tap "Request change" next to the field and your request will be sent to the academy.'
                    )}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Editable details */}
            <Card className={cardClass}>
              <div className="bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-3">
                <h2 className="text-white font-bold flex items-center gap-2">
                  <Mail className="w-5 h-5" />
                  {t('معلومات التواصل', 'Contact Details')}
                </h2>
              </div>
              <CardContent className="p-6 space-y-4">
                <div>
                  <Label htmlFor="member-email" className={labelClass}>
                    <span className="inline-flex items-center gap-1">
                      <Mail className="w-4 h-4" />
                      {t('البريد الإلكتروني', 'Email')}
                    </span>
                  </Label>
                  <Input
                    id="member-email"
                    type="email"
                    inputMode="email"
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('example@email.com', 'example@email.com')}
                    className={inputClass}
                  />
                </div>

                <div>
                  <Label htmlFor="member-address" className={labelClass}>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      {t('العنوان', 'Address')}
                    </span>
                  </Label>
                  <Input
                    id="member-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={t('المدينة، الحي، الشارع', 'City, district, street')}
                    className={inputClass}
                  />
                </div>

                <div>
                  <Label htmlFor="member-emergency" className={labelClass}>
                    <span className="inline-flex items-center gap-1">
                      <Phone className="w-4 h-4" />
                      {t('جهة الاتصال للطوارئ', 'Emergency Contact')}
                    </span>
                  </Label>
                  <Input
                    id="member-emergency"
                    dir="ltr"
                    value={emergencyContact}
                    onChange={(e) => setEmergencyContact(e.target.value)}
                    placeholder={t('الاسم ورقم الجوال', 'Name and phone number')}
                    className={inputClass}
                  />
                  <p className={`mt-1 text-xs ${subtleClass}`}>
                    {t(
                      'سيتم استخدامه فقط في حالات الطوارئ.',
                      'Used only in case of emergencies.'
                    )}
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button
                onClick={handleSave}
                disabled={saving}
                className={`gap-2 text-gray-900 font-bold px-6 ${primary ? 'hover:opacity-90' : 'bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-700'}`}
                style={primary ? { backgroundColor: primary } : undefined}
                data-testid="save-profile-btn"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {t('حفظ التغييرات', 'Save changes')}
              </Button>
            </div>
          </>
        )}

        {/* Change-request dialog */}
        <Dialog open={!!requestField} onOpenChange={closeChangeRequest}>
          <DialogContent
            className={`max-w-md ${darkMode ? 'bg-gray-800 text-white border-gray-700' : ''}`}
            dir={language === 'ar' ? 'rtl' : 'ltr'}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-amber-500" />
                {requestField
                  ? t(
                      `طلب تعديل ${fieldMeta[requestField].label}`,
                      `Request change: ${fieldMeta[requestField].label}`
                    )
                  : ''}
              </DialogTitle>
              <DialogDescription className={darkMode ? 'text-gray-400' : 'text-gray-500'}>
                {t(
                  'سيتم إرسال هذا الطلب إلى إدارة الأكاديمية لمراجعته وتطبيق التعديل.',
                  'This request will be sent to the academy for review and approval.'
                )}
              </DialogDescription>
            </DialogHeader>

            {requestField && (
              <div className="space-y-4">
                <div>
                  <p className={`text-xs ${subtleClass}`}>
                    {t('القيمة الحالية', 'Current value')}
                  </p>
                  <p
                    className={`mt-1 text-sm font-semibold break-all ${
                      darkMode ? 'text-gray-200' : 'text-gray-800'
                    }`}
                    dir={fieldMeta[requestField].dir}
                  >
                    {requestField === 'date_of_birth'
                      ? formatDate(currentValueFor('date_of_birth'), language) || '\u2014'
                      : currentValueFor(requestField) || '\u2014'}
                  </p>
                </div>

                <div>
                  <Label htmlFor="request-new-value" className={labelClass}>
                    {t('القيمة الجديدة', 'New value')}
                  </Label>
                  <Input
                    id="request-new-value"
                    type={fieldMeta[requestField].type}
                    dir={fieldMeta[requestField].dir}
                    value={requestValue}
                    onChange={(e) => setRequestValue(e.target.value)}
                    placeholder={fieldMeta[requestField].placeholder}
                    className={inputClass}
                    maxLength={200}
                    data-testid="request-new-value-input"
                  />
                </div>

                <div>
                  <Label htmlFor="request-reason" className={labelClass}>
                    {t('السبب (اختياري)', 'Reason (optional)')}
                  </Label>
                  <Textarea
                    id="request-reason"
                    value={requestReason}
                    onChange={(e) => setRequestReason(e.target.value)}
                    placeholder={t(
                      'مثلاً: تصحيح خطأ إملائي، تغيير رقم الجوال، إلخ',
                      'e.g. typo correction, phone number changed, etc.'
                    )}
                    className={`mt-1 ${
                      darkMode ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500' : ''
                    }`}
                    rows={3}
                    maxLength={500}
                    data-testid="request-reason-input"
                  />
                </div>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => closeChangeRequest(false)}
                disabled={submittingRequest}
              >
                {t('إلغاء', 'Cancel')}
              </Button>
              <Button
                type="button"
                onClick={submitChangeRequest}
                disabled={submittingRequest || !requestValue.trim()}
                className={`gap-2 text-gray-900 font-bold ${primary ? 'hover:opacity-90' : 'bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-700'}`}
                style={primary ? { backgroundColor: primary } : undefined}
                data-testid="submit-change-request-btn"
              >
                {submittingRequest ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {t('إرسال الطلب', 'Send request')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MemberLayout>
  );
};

export default MemberProfile;
