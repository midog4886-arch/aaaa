import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  User, Mail, MapPin, Phone, Calendar, Hash, ImagePlus,
  X, Save, Loader2, AlertTriangle, ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';
import MemberLayout, { memberAPI, getDarkMode, getLanguage, getMemberData } from './MemberLayout';

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const formatDate = (dateStr, language) => {
  if (!dateStr) return '—';
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
  if (!name) return '؟';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] || '') + (parts[1][0] || '');
};

const MemberProfile = () => {
  const language = getLanguage();
  const darkMode = getDarkMode();
  const t = (ar, en) => (language === 'ar' ? ar : en);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState(null);
  const [photo, setPhoto] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [imgError, setImgError] = useState(false);
  const fileInputRef = useRef(null);

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
      toast.error(t('فشل تحميل الملف الشخصي', 'Failed to load profile'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('يرجى اختيار صورة', 'Please choose an image'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t('حجم الصورة كبير جداً (الحد الأقصى 2 ميجا)', 'Image too large (2MB max)'));
      return;
    }
    try {
      const base64 = await fileToBase64(file);
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

  const displayName = profile?.name_ar || profile?.name || '';

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
            <Loader2 className={`w-8 h-8 animate-spin ${darkMode ? 'text-amber-400' : 'text-amber-500'}`} />
          </div>
        ) : (
          <>
            {/* Avatar Card */}
            <Card className={cardClass}>
              <div className="bg-gradient-to-r from-amber-500 to-yellow-600 px-4 py-3">
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
                      className="w-32 h-32 rounded-full object-cover border-4 border-amber-400 shadow-lg"
                    />
                  ) : (
                    <div className="w-32 h-32 rounded-full bg-gradient-to-br from-amber-500 to-yellow-600 flex items-center justify-center shadow-lg border-4 border-amber-300">
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
                    <p className={labelClass}>{t('الاسم', 'Name')}</p>
                    <p className={readonlyValueClass}>{displayName || '—'}</p>
                  </div>
                  <div>
                    <p className={labelClass}>{t('رقم العضوية', 'Member Code')}</p>
                    <p className={readonlyValueClass} dir="ltr">
                      <span className="inline-flex items-center gap-1">
                        <Hash className="w-4 h-4 opacity-60" />
                        {profile?.member_code || '—'}
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className={labelClass}>{t('رقم الجوال', 'Phone')}</p>
                    <p className={readonlyValueClass} dir="ltr">
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-4 h-4 opacity-60" />
                        {profile?.phone || '—'}
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className={labelClass}>{t('تاريخ الميلاد', 'Date of Birth')}</p>
                    <p className={readonlyValueClass}>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-4 h-4 opacity-60" />
                        {formatDate(profile?.date_of_birth, language)}
                      </span>
                    </p>
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
                      'لتعديل الاسم أو رقم الجوال أو تاريخ الميلاد، يرجى التواصل مع إدارة الأكاديمية.',
                      'To change your name, phone or date of birth, please contact the academy administration.'
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
                className="gap-2 bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-700 text-gray-900 font-bold px-6"
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
      </div>
    </MemberLayout>
  );
};

export default MemberProfile;
