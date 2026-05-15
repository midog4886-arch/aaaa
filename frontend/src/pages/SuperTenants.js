import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const ALL_FEATURES = [
  { key: 'social_publisher', label: 'النشر الاجتماعي' },
  { key: 'mobile_app', label: 'تطبيق الجوال' },
  { key: 'whatsapp', label: 'واتساب' },
  { key: 'tournaments', label: 'البطولات' },
];

const PLANS = [
  { value: 'starter', label: 'Starter', max_branches: 1, max_members: 100 },
  { value: 'pro', label: 'Pro', max_branches: 3, max_members: 500 },
  { value: 'enterprise', label: 'Enterprise', max_branches: 0, max_members: 0 },
];

const CYCLES = [
  { value: 'monthly', label: 'شهري' },
  { value: 'quarterly', label: 'ربع سنوي' },
  { value: 'yearly', label: 'سنوي' },
];

const sx = {
  page: { minHeight: '100vh', background: '#f1f5f9', padding: 24, direction: 'rtl', fontFamily: 'system-ui, -apple-system, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 },
  btnPrimary: { padding: '10px 16px', background: '#0f172a', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnGhost: { padding: '8px 12px', background: 'transparent', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, cursor: 'pointer' },
  btnDanger: { padding: '6px 10px', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
  btnEdit: { padding: '6px 10px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
  btnRenew: { padding: '6px 10px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 },
  card: { background: 'white', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0' },
  badgeActive: { display: 'inline-block', padding: '2px 8px', background: '#dcfce7', color: '#15803d', borderRadius: 99, fontSize: 11, fontWeight: 600 },
  badgeSuspended: { display: 'inline-block', padding: '2px 8px', background: '#fef3c7', color: '#a16207', borderRadius: 99, fontSize: 11, fontWeight: 600 },
  badgeDeleted: { display: 'inline-block', padding: '2px 8px', background: '#fee2e2', color: '#b91c1c', borderRadius: 99, fontSize: 11, fontWeight: 600 },
  badgePending: { display: 'inline-block', padding: '2px 8px', background: '#fef3c7', color: '#92400e', borderRadius: 99, fontSize: 11, fontWeight: 600 },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 },
  modal: { background: 'white', borderRadius: 12, padding: 24, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' },
  field: { marginBottom: 14 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' },
  row: { display: 'flex', gap: 12 },
  meta: { fontSize: 12, color: '#64748b', marginTop: 4 },
};

function expiryBadgeStyle(state) {
  if (state === 'expired') return { background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca' };
  if (state === 'expiring_soon') return { background: '#fef3c7', color: '#a16207', border: '1px solid #fde68a' };
  if (state === 'expiring_month') return { background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' };
  if (state === 'active') return { background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' };
  return { background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0' };
}

function formatTimeRemaining(target) {
  if (!target) return '—';
  const t = new Date(target).getTime();
  if (isNaN(t)) return '—';
  const diff = t - Date.now();
  if (diff <= 0) return 'انتهت فترة السماح';
  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} يوم و ${hours} ساعة`;
  if (hours > 0) return `${hours} ساعة و ${mins} دقيقة`;
  return `${mins} دقيقة`;
}

function expiryText(billing) {
  if (!billing || billing.days_until_expiry == null) return 'بدون اشتراك';
  const d = billing.days_until_expiry;
  if (d < 0) return `منتهي منذ ${Math.abs(d)} يوم`;
  if (d === 0) return 'ينتهي اليوم';
  if (d === 1) return 'ينتهي غداً';
  return `${d} يوم متبقّي`;
}

function isoToDateInput(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch { return ''; }
}

function dateInputToIso(s) {
  if (!s) return '';
  try {
    const d = new Date(s + 'T23:59:59');
    return d.toISOString();
  } catch { return ''; }
}

function TenantForm({ initial, onSubmit, onCancel, isEdit }) {
  const [form, setForm] = useState({
    slug: initial?.slug || '',
    name: initial?.name || '',
    plan: initial?.plan || 'starter',
    max_branches: initial?.max_branches ?? 1,
    max_members: initial?.max_members ?? 100,
    features: initial?.features || [],
    owner_email: initial?.owner_email || '',
    status: initial?.status || 'active',
    admin_username: 'admin',
    admin_password: '',
    branch_name: 'الفرع الرئيسي',
    billing_cycle: initial?.billing_cycle || 'monthly',
    trial_days: 30,
    auto_suspend_on_expiry: initial?.auto_suspend_on_expiry !== false,
    subscription_end_at_date: isoToDateInput(initial?.subscription_end_at),
    logo_base64: initial?.logo_base64 || '',
    primary_color: initial?.primary_color || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const choosePlan = (p) => {
    const plan = PLANS.find((x) => x.value === p);
    setF('plan', p);
    if (plan) {
      setF('max_branches', plan.max_branches);
      setF('max_members', plan.max_members);
    }
  };

  const toggleFeat = (k) => {
    setF('features', form.features.includes(k) ? form.features.filter((x) => x !== k) : [...form.features, k]);
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const payload = {
        ...form,
        max_branches: Number(form.max_branches) || 0,
        max_members: Number(form.max_members) || 0,
      };
      if (isEdit) {
        delete payload.admin_username;
        delete payload.admin_password;
        delete payload.branch_name;
        delete payload.trial_days;
        if (form.subscription_end_at_date) {
          payload.subscription_end_at = dateInputToIso(form.subscription_end_at_date);
        }
        delete payload.subscription_end_at_date;
      } else {
        delete payload.subscription_end_at_date;
        payload.trial_days = Number(form.trial_days) || 30;
      }
      await onSubmit(payload);
    } catch (e2) {
      setErr(e2?.response?.data?.detail || 'فشل الحفظ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={sx.modalBg} onClick={onCancel}>
      <form style={sx.modal} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 style={{ margin: 0, marginBottom: 18, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
          {isEdit ? 'تعديل الأكاديمية' : 'أكاديمية جديدة'}
        </h2>
        {err && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{err}</div>}
        <div style={sx.field}>
          <label style={sx.label}>المعرّف (slug) — حروف صغيرة وأرقام و _ فقط</label>
          <input style={{ ...sx.input, opacity: isEdit ? 0.6 : 1 }} value={form.slug} onChange={(e) => setF('slug', e.target.value.toLowerCase())} required disabled={isEdit} pattern="[a-z0-9_]+" minLength={2} maxLength={40} />
        </div>
        <div style={sx.field}>
          <label style={sx.label}>اسم الأكاديمية</label>
          <input style={sx.input} value={form.name} onChange={(e) => setF('name', e.target.value)} required />
        </div>
        <div style={sx.field}>
          <label style={sx.label}>الخطة</label>
          <select style={sx.input} value={form.plan} onChange={(e) => choosePlan(e.target.value)}>
            {PLANS.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
          </select>
        </div>
        <div style={sx.row}>
          <div style={{ ...sx.field, flex: 1 }}>
            <label style={sx.label}>أقصى فروع (0 = غير محدود)</label>
            <input type="number" min="0" style={sx.input} value={form.max_branches} onChange={(e) => setF('max_branches', e.target.value)} />
          </div>
          <div style={{ ...sx.field, flex: 1 }}>
            <label style={sx.label}>أقصى أعضاء (0 = غير محدود)</label>
            <input type="number" min="0" style={sx.input} value={form.max_members} onChange={(e) => setF('max_members', e.target.value)} />
          </div>
        </div>
        <div style={sx.field}>
          <label style={sx.label}>المميزات المفعّلة</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ALL_FEATURES.map((f) => (
              <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 99, fontSize: 13, cursor: 'pointer', background: form.features.includes(f.key) ? '#dbeafe' : 'white' }}>
                <input type="checkbox" checked={form.features.includes(f.key)} onChange={() => toggleFeat(f.key)} style={{ margin: 0 }} />
                {f.label}
              </label>
            ))}
          </div>
        </div>
        <div style={sx.field}>
          <label style={sx.label}>شعار الأكاديمية (يظهر في القائمة الجانبية والفواتير)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {form.logo_base64 ? (
              <img src={form.logo_base64} alt="logo" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'contain', border: '1px solid #cbd5e1', background: '#f8fafc' }} />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: 8, border: '1px dashed #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 11 }}>لا يوجد</div>
            )}
            <div style={{ flex: 1 }}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(e) => {
                  const file = e.target.files && e.target.files[0];
                  if (!file) return;
                  if (file.size > 500 * 1024) {
                    setErr('حجم الشعار يتجاوز 500KB. يرجى ضغط الصورة قبل الرفع.');
                    e.target.value = '';
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => setF('logo_base64', reader.result);
                  reader.readAsDataURL(file);
                }}
                style={{ fontSize: 12 }}
              />
              {form.logo_base64 && (
                <button type="button" onClick={() => setF('logo_base64', '')} style={{ marginTop: 6, fontSize: 12, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>إزالة الشعار</button>
              )}
              <div style={{ marginTop: 4, fontSize: 11, color: '#64748b' }}>PNG/JPEG/WebP/SVG · أقصى 500KB · يفضّل صورة مربعة</div>
            </div>
          </div>
        </div>
        <div style={sx.field}>
          <label style={sx.label}>اللون الأساسي للأكاديمية (يظهر في الواجهة)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="color"
              value={form.primary_color || '#f97316'}
              onChange={(e) => setF('primary_color', e.target.value.toLowerCase())}
              style={{ width: 56, height: 40, border: '1px solid #cbd5e1', borderRadius: 8, padding: 2, cursor: 'pointer', background: 'white' }}
            />
            <input
              type="text"
              value={form.primary_color}
              onChange={(e) => setF('primary_color', e.target.value.toLowerCase())}
              placeholder="#f97316"
              style={{ ...sx.input, flex: 1, fontFamily: 'monospace' }}
              pattern="^#[0-9a-fA-F]{6}$"
            />
            {form.primary_color && (
              <button type="button" onClick={() => setF('primary_color', '')} style={{ fontSize: 12, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>إزالة</button>
            )}
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: '#64748b' }}>اتركه فارغاً لاستخدام اللون الافتراضي للنظام</div>
        </div>
        <div style={sx.field}>
          <label style={sx.label}>إيميل المالك (اختياري)</label>
          <input type="email" style={sx.input} value={form.owner_email} onChange={(e) => setF('owner_email', e.target.value)} />
        </div>

        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px dashed #cbd5e1' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>الاشتراك والفوترة</div>
          <div style={sx.row}>
            <div style={{ ...sx.field, flex: 1 }}>
              <label style={sx.label}>دورة الفوترة</label>
              <select style={sx.input} value={form.billing_cycle} onChange={(e) => setF('billing_cycle', e.target.value)}>
                {CYCLES.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
              </select>
            </div>
            {!isEdit ? (
              <div style={{ ...sx.field, flex: 1 }}>
                <label style={sx.label}>أيام الفترة الأولى</label>
                <input type="number" min="1" style={sx.input} value={form.trial_days} onChange={(e) => setF('trial_days', e.target.value)} />
              </div>
            ) : (
              <div style={{ ...sx.field, flex: 1 }}>
                <label style={sx.label}>تاريخ انتهاء الاشتراك</label>
                <input type="date" style={sx.input} value={form.subscription_end_at_date} onChange={(e) => setF('subscription_end_at_date', e.target.value)} />
              </div>
            )}
          </div>
          <div style={sx.field}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.auto_suspend_on_expiry} onChange={(e) => setF('auto_suspend_on_expiry', e.target.checked)} />
              إيقاف تلقائي عند انتهاء الاشتراك
            </label>
          </div>
        </div>

        {!isEdit && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px dashed #cbd5e1' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>الإعداد الافتتاحي</div>
            <div style={sx.field}>
              <label style={sx.label}>اسم الفرع الأول</label>
              <input style={sx.input} value={form.branch_name} onChange={(e) => setF('branch_name', e.target.value)} />
            </div>
            <div style={sx.row}>
              <div style={{ ...sx.field, flex: 1 }}>
                <label style={sx.label}>اسم مستخدم المدير</label>
                <input style={sx.input} value={form.admin_username} onChange={(e) => setF('admin_username', e.target.value)} />
              </div>
              <div style={{ ...sx.field, flex: 1 }}>
                <label style={sx.label}>كلمة المرور (اتركها فارغة لتوليد عشوائية)</label>
                <input style={sx.input} value={form.admin_password} onChange={(e) => setF('admin_password', e.target.value)} placeholder="تلقائية" />
              </div>
            </div>
          </div>
        )}
        {isEdit && (
          <div style={sx.field}>
            <label style={sx.label}>الحالة</label>
            <select style={sx.input} value={form.status} onChange={(e) => setF('status', e.target.value)}>
              <option value="active">نشطة</option>
              <option value="suspended">موقوفة</option>
            </select>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start', marginTop: 8 }}>
          <button type="submit" disabled={busy} style={{ ...sx.btnPrimary, opacity: busy ? 0.6 : 1 }}>{busy ? 'جارٍ الحفظ...' : 'حفظ'}</button>
          <button type="button" onClick={onCancel} style={sx.btnGhost}>إلغاء</button>
        </div>
      </form>
    </div>
  );
}

function DeleteTenantDialog({ tenant, onCancel, onSchedule, onFinalize }) {
  const [step, setStep] = useState(1);
  const [slug, setSlug] = useState('');
  const [reason, setReason] = useState('');
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isPending = tenant.status === 'pending_delete';
  const purgeAt = tenant.deletion_purge_at ? new Date(tenant.deletion_purge_at) : null;
  const canFinalizeNoForce = isPending && purgeAt && purgeAt.getTime() <= Date.now();
  const slugMatches = slug.trim() === tenant.slug;

  const submitSchedule = async () => {
    if (!slugMatches) return alert(`الرجاء كتابة معرّف الأكاديمية بالضبط: ${tenant.slug}`);
    if (reason.trim().length < 6) return alert('يرجى كتابة سبب الحذف (6 أحرف على الأقل).');
    setSubmitting(true);
    try { await onSchedule(slug.trim(), reason.trim()); } finally { setSubmitting(false); }
  };

  const submitFinalize = async () => {
    if (!slugMatches) return alert(`الرجاء كتابة معرّف الأكاديمية بالضبط: ${tenant.slug}`);
    if (!canFinalizeNoForce && !force) {
      return alert('فترة السماح لم تنتهِ بعد. فعّل خيار التجاوز فقط في حالات الطوارئ.');
    }
    const final = window.confirm(
      `سيتم حذف "${tenant.name}" وقاعدة بياناتها نهائياً ولا يمكن التراجع. متابعة؟`
    );
    if (!final) return;
    setSubmitting(true);
    try { await onFinalize(slug.trim(), force && !canFinalizeNoForce); } finally { setSubmitting(false); }
  };

  return (
    <div style={sx.modalBg} onClick={onCancel}>
      <div style={sx.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, marginBottom: 6, color: '#b91c1c' }}>
          {step === 1 ? '⚠ تأكيد حذف الأكاديمية' : '⚠ تأكيد نهائي قبل الحذف'}
        </h2>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
          الأكاديمية: <b style={{ color: '#0f172a' }}>{tenant.name}</b> (@{tenant.slug})
          {' · '}الحالة: <b>{tenant.status}</b>
          {tenant.db_name && <> · DB: <code>{tenant.db_name}</code></>}
        </div>

        {isPending && tenant.deletion_scheduled_at && (
          <div style={{ background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e', padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 12 }}>
            تم جدولة الحذف في {new Date(tenant.deletion_scheduled_at).toLocaleString('ar-EG')}.
            {purgeAt && <> سينتهي السماح في {purgeAt.toLocaleString('ar-EG')}.</>}
            {tenant.deletion_reason && <div style={{ marginTop: 4 }}>السبب: {tenant.deletion_reason}</div>}
          </div>
        )}

        {step === 1 && (
          <>
            <div style={{ background: '#fee2e2', border: '1px solid #fecaca', color: '#7f1d1d', padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 12 }}>
              الحذف عملية كبرى. سيتم إيقاف الأكاديمية فوراً، ثم بعد 7 أيام كاملة (فترة سماح) ستُحذف قاعدة بياناتها بشكل نهائي ولا يمكن استرجاعها.
              يمكنك إلغاء الجدولة في أي وقت خلال فترة السماح.
            </div>
            <div style={sx.field}>
              <label style={sx.label}>اكتب معرّف الأكاديمية للتأكيد ({tenant.slug})</label>
              <input style={sx.input} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={tenant.slug} />
            </div>
            <div style={sx.field}>
              <label style={sx.label}>سبب الحذف (يُسجّل في سجل التدقيق)</label>
              <textarea style={{ ...sx.input, minHeight: 70, fontFamily: 'inherit' }}
                value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: تم الاتفاق مع المالك على إنهاء الاشتراك بتاريخ ..." />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button style={sx.btnGhost} onClick={onCancel} disabled={submitting}>إلغاء</button>
              {!isPending && (
                <button
                  style={{ ...sx.btnDanger, padding: '10px 16px', fontSize: 13 }}
                  onClick={() => slugMatches && reason.trim().length >= 6 ? setStep(2) : submitSchedule()}
                  disabled={submitting}
                >المتابعة للتأكيد النهائي</button>
              )}
              {isPending && (
                <button
                  style={{ ...sx.btnDanger, padding: '10px 16px', fontSize: 13 }}
                  onClick={() => setStep(2)}
                  disabled={submitting}
                >المتابعة للحذف النهائي</button>
              )}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#7f1d1d', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 12, fontWeight: 600 }}>
              {isPending
                ? (canFinalizeNoForce
                    ? 'فترة السماح انتهت. يمكنك الآن حذف قاعدة البيانات نهائياً.'
                    : 'فترة السماح لم تنتهِ بعد. يلزم تفعيل التجاوز للحذف الفوري.')
                : 'سيتم جدولة الحذف. لن تُحذف البيانات فعلياً قبل 7 أيام.'}
            </div>
            {isPending && !canFinalizeNoForce && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#7f1d1d', marginBottom: 12 }}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                تجاوز فترة السماح (طوارئ فقط — يستلزم تأكيد المالك خارجياً)
              </label>
            )}
            <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
              لإلغاء العملية اضغط رجوع. للمتابعة اضغط زر التأكيد النهائي.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button style={sx.btnGhost} onClick={() => setStep(1)} disabled={submitting}>رجوع</button>
              <button style={sx.btnGhost} onClick={onCancel} disabled={submitting}>إلغاء</button>
              {!isPending && (
                <button style={{ ...sx.btnDanger, padding: '10px 16px', fontSize: 13, fontWeight: 700 }}
                  onClick={submitSchedule} disabled={submitting || !slugMatches}>
                  {submitting ? '...' : 'جدولة الحذف (7 أيام سماح)'}
                </button>
              )}
              {isPending && (
                <button style={{ ...sx.btnDanger, padding: '10px 16px', fontSize: 13, fontWeight: 700 }}
                  onClick={submitFinalize}
                  disabled={submitting || !slugMatches || (!canFinalizeNoForce && !force)}>
                  {submitting ? '...' : 'حذف قاعدة البيانات نهائياً'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RescheduleDeleteModal({ tenant, onSubmit, onCancel }) {
  const pad = (n) => String(n).padStart(2, '0');
  const toInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const initial = tenant.deletion_purge_at ? new Date(tenant.deletion_purge_at) : tomorrow;
  const [date, setDate] = useState(toInput(initial));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const minDate = toInput(tomorrow);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await onSubmit(date);
    } catch (e2) {
      setErr(e2?.response?.data?.detail || 'فشل تغيير الموعد');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={sx.modalBg} onClick={onCancel}>
      <form style={sx.modal} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 style={{ margin: 0, marginBottom: 14, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
          تغيير موعد الحذف النهائي لـ "{tenant.name}"
        </h2>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
          الموعد الحالي: {tenant.deletion_purge_at ? new Date(tenant.deletion_purge_at).toLocaleString('ar-EG') : '—'}
        </div>
        {err && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{err}</div>}
        <div style={sx.field}>
          <label style={sx.label}>التاريخ الجديد للحذف</label>
          <input
            type="date"
            style={sx.input}
            value={date}
            min={minDate}
            onChange={(e) => setDate(e.target.value)}
            required
          />
          <div style={sx.meta}>
            سيُجدوَل الحذف في نهاية اليوم المحدد. سيُعاد إرسال التنبيه النهائي قبل الموعد الجديد.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="submit" disabled={busy} style={{ ...sx.btnPrimary, opacity: busy ? 0.6 : 1 }}>{busy ? '...' : 'حفظ الموعد'}</button>
          <button type="button" onClick={onCancel} style={sx.btnGhost}>إلغاء</button>
        </div>
      </form>
    </div>
  );
}

function RenewModal({ tenant, onSubmit, onCancel }) {
  const [months, setMonths] = useState(1);
  const [days, setDays] = useState(0);
  const [extendFrom, setExtendFrom] = useState('current_end');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await onSubmit({
        months: Number(months) || 0,
        days: Number(days) || 0,
        extend_from: extendFrom,
        note,
      });
    } catch (e2) {
      setErr(e2?.response?.data?.detail || 'فشل التجديد');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={sx.modalBg} onClick={onCancel}>
      <form style={sx.modal} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 style={{ margin: 0, marginBottom: 14, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
          تجديد اشتراك "{tenant.name}"
        </h2>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
          الانتهاء الحالي: {tenant.subscription_end_at ? new Date(tenant.subscription_end_at).toLocaleDateString('ar-EG') : '—'}
        </div>
        {err && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{err}</div>}
        <div style={sx.row}>
          <div style={{ ...sx.field, flex: 1 }}>
            <label style={sx.label}>عدد الأشهر</label>
            <input type="number" min="0" style={sx.input} value={months} onChange={(e) => setMonths(e.target.value)} />
          </div>
          <div style={{ ...sx.field, flex: 1 }}>
            <label style={sx.label}>أيام إضافية</label>
            <input type="number" min="0" style={sx.input} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
        </div>
        <div style={sx.field}>
          <label style={sx.label}>التمديد من</label>
          <select style={sx.input} value={extendFrom} onChange={(e) => setExtendFrom(e.target.value)}>
            <option value="current_end">من تاريخ الانتهاء الحالي (إن لم يكن منتهي)</option>
            <option value="now">من اليوم</option>
          </select>
        </div>
        <div style={sx.field}>
          <label style={sx.label}>ملاحظة (اختياري)</label>
          <input style={sx.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="رقم إيصال، مرجع تحويل..." />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="submit" disabled={busy} style={{ ...sx.btnPrimary, opacity: busy ? 0.6 : 1 }}>{busy ? '...' : 'تجديد'}</button>
          <button type="button" onClick={onCancel} style={sx.btnGhost}>إلغاء</button>
        </div>
      </form>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const diffMs = now - d;
    const diffH = diffMs / 36e5;
    if (diffH < 1) return `منذ ${Math.max(1, Math.floor(diffMs / 60000))} د`;
    if (diffH < 24) return `منذ ${Math.floor(diffH)} س`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `منذ ${diffD} يوم`;
    return d.toLocaleDateString('ar-EG');
  } catch { return iso; }
}

function UsageBar({ label, pct }) {
  if (pct == null) {
    return <div style={{ fontSize: 11, color: '#64748b' }}>{label}: ∞</div>;
  }
  const clamped = Math.min(100, Math.max(0, pct));
  const color = clamped >= 90 ? '#dc2626' : clamped >= 75 ? '#d97706' : '#16a34a';
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 600 }}>{clamped}%</span>
      </div>
      <div style={{ height: 6, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${clamped}%`, height: '100%', background: color, transition: 'width .3s' }} />
      </div>
    </div>
  );
}

export default function SuperTenants() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [renewing, setRenewing] = useState(null);
  const [seedInfo, setSeedInfo] = useState(null);
  const [purgeDigests, setPurgeDigests] = useState([]);
  const [expandedDigest, setExpandedDigest] = useState(null);

  const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('super_token') || ''}` } });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/super/overview', auth());
      setRows(res.data?.tenants || []);
      setTotals(res.data?.totals || null);
      setAlerts(res.data?.alerts || null);
      setError('');
    } catch (err) {
      if (err?.response?.status === 401) {
        localStorage.removeItem('super_token');
        navigate('/super/login', { replace: true });
        return;
      }
      setError(err?.response?.data?.detail || 'فشل تحميل القائمة');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  const loadPurgeDigests = useCallback(async () => {
    try {
      const res = await axios.get('/super/tenant-purge-digest/history?limit=30', auth());
      setPurgeDigests(res.data?.items || []);
    } catch {
      setPurgeDigests([]);
    }
  }, []);

  useEffect(() => { loadPurgeDigests(); }, [loadPurgeDigests]);

  // Tick once a minute so the "time remaining" column on the
  // pending-auto-purge panel stays live without reloading the whole page.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const refreshOne = async (id) => {
    try {
      const res = await axios.get(`/super/tenants/${id}/stats`, auth());
      setRows((rs) => rs.map((r) => r.tenant.id === id ? { ...r, ...res.data, tenant: res.data.tenant } : r));
    } catch {}
  };

  const create = async (data) => {
    const res = await axios.post('/super/tenants', data, auth());
    setCreating(false);
    if (res?.data?.seed) {
      setSeedInfo({ tenant: res.data, seed: res.data.seed });
    }
    await load();
  };

  const update = async (id, data) => {
    await axios.patch(`/super/tenants/${id}`, data, auth());
    setEditing(null);
    await load();
  };

  const renew = async (id, payload) => {
    await axios.post(`/super/tenants/${id}/renew`, payload, auth());
    setRenewing(null);
    await load();
  };

  const toggleSuspend = async (t) => {
    const next = t.status === 'active' ? 'suspended' : 'active';
    if (!window.confirm(next === 'suspended' ? `إيقاف "${t.name}"؟ لن يستطيع المستخدمون الدخول.` : `إعادة تفعيل "${t.name}"؟`)) return;
    try {
      await axios.patch(`/super/tenants/${t.id}`, { status: next }, auth());
      await load();
    } catch (e) { alert(e?.response?.data?.detail || 'فشل'); }
  };

  const [deleting, setDeleting] = useState(null);
  const [rescheduling, setRescheduling] = useState(null);

  const scheduleDelete = async (t, slugConfirm, reason) => {
    try {
      await axios.post(`/super/tenants/${t.id}/schedule-delete`, {
        confirm_slug: slugConfirm,
        reason,
      }, auth());
      setDeleting(null);
      await load();
      alert('تم جدولة الحذف. ستُحذف نهائياً بعد 7 أيام ما لم يتم الإلغاء.');
    } catch (e) { alert(e?.response?.data?.detail || 'فشل جدولة الحذف'); }
  };

  const cancelDelete = async (t) => {
    if (!window.confirm(`إلغاء جدولة حذف "${t.name}"؟`)) return;
    try {
      await axios.post(`/super/tenants/${t.id}/cancel-delete`, {}, auth());
      await load();
    } catch (e) { alert(e?.response?.data?.detail || 'فشل'); }
  };

  const submitReschedule = async (t, dateStr) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateStr || '').trim());
    if (!m) { alert('صيغة التاريخ غير صحيحة'); return; }
    // Schedule the purge at end-of-day local time so the owner gets the
    // entire chosen day before deletion runs.
    const newDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 0, 0);
    if (newDate.getTime() <= Date.now()) { alert('يجب أن يكون التاريخ في المستقبل'); return; }
    try {
      await axios.post(
        `/super/tenants/${t.id}/reschedule-delete`,
        { purge_at: newDate.toISOString() },
        auth(),
      );
      setRescheduling(null);
      await load();
      alert('تم تغيير موعد الحذف بنجاح.');
    } catch (e) { alert(e?.response?.data?.detail || 'فشل تغيير الموعد'); }
  };

  const finalizeDelete = async (t, slugConfirm, force) => {
    try {
      const params = new URLSearchParams({ confirm_slug: slugConfirm });
      if (force) params.append('force', 'true');
      await axios.delete(`/super/tenants/${t.id}?${params.toString()}`, auth());
      setDeleting(null);
      await load();
      alert('تم حذف الأكاديمية وقاعدة بياناتها نهائياً.');
    } catch (e) { alert(e?.response?.data?.detail || 'فشل الحذف'); }
  };

  const remove = (t) => {
    if (t.slug === 'default') return alert('لا يمكن حذف الأكاديمية الافتراضية');
    setDeleting(t);
  };

  const logout = () => {
    localStorage.removeItem('super_token');
    localStorage.removeItem('super_user');
    navigate('/super/login', { replace: true });
  };

  const statusBadge = (s) => s === 'suspended' ? sx.badgeSuspended
    : s === 'deleted' ? sx.badgeDeleted
    : s === 'pending_delete' ? sx.badgePending
    : sx.badgeActive;
  const statusText = (s) => s === 'suspended' ? 'موقوفة'
    : s === 'deleted' ? 'محذوفة'
    : s === 'pending_delete' ? 'جدولة حذف'
    : 'نشطة';

  const totalCard = (label, val) => (
    <div style={{ flex: 1, minWidth: 110, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px' }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>{val ?? 0}</div>
    </div>
  );

  return (
    <div style={sx.page}>
      <div style={sx.header}>
        <div>
          <h1 style={sx.title}>الأكاديميات المشتركة</h1>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{rows.length} أكاديمية</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={sx.btnGhost} onClick={load} disabled={loading}>{loading ? '…' : '↻ تحديث'}</button>
          <button style={sx.btnGhost} onClick={() => navigate('/super/emails')}>📧 الإيميلات</button>
          <button style={sx.btnGhost} onClick={() => navigate('/super/payment')}>💳 مزود الدفع</button>
          <button style={sx.btnPrimary} onClick={() => setCreating(true)}>+ أكاديمية جديدة</button>
          <button style={sx.btnGhost} onClick={logout}>خروج</button>
        </div>
      </div>

      {alerts && (alerts.expired > 0 || alerts.expiring_soon > 0 || alerts.auto_suspended_now > 0) && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {alerts.expired > 0 && (
            <div style={{ padding: '8px 14px', background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
              ⚠ {alerts.expired} اشتراك منتهي
            </div>
          )}
          {alerts.expiring_soon > 0 && (
            <div style={{ padding: '8px 14px', background: '#fef3c7', color: '#a16207', border: '1px solid #fde68a', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
              ⏰ {alerts.expiring_soon} اشتراك يقارب الانتهاء (≤ 7 أيام)
            </div>
          )}
          {alerts.auto_suspended_now > 0 && (
            <div style={{ padding: '8px 14px', background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
              تم إيقاف {alerts.auto_suspended_now} أكاديمية تلقائياً الآن
            </div>
          )}
        </div>
      )}

      {totals && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          {totalCard('إجمالي الأعضاء', totals.members)}
          {totalCard('إجمالي الفواتير', totals.invoices)}
          {totalCard('إجمالي الفروع', totals.branches)}
          {totalCard('إجمالي المستخدمين', totals.users)}
          {totalCard('إجمالي الأنشطة', totals.activities)}
          {totalCard('إجمالي الحضور', totals.attendance)}
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>جارٍ التحميل...</div>}
      {error && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 12, borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      {!loading && (() => {
        const pending = rows
          .filter((r) => r.tenant?.status === 'pending_delete')
          .sort((a, b) => (a.tenant.deletion_purge_at || '').localeCompare(b.tenant.deletion_purge_at || ''));
        if (pending.length === 0) return null;
        return (
          <div style={{ background: 'white', border: '1px solid #fde68a', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#92400e' }}>
                ⏳ مجدولة للحذف التلقائي ({pending.length})
              </h2>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                تُحذف قواعد بياناتها نهائياً عند انتهاء فترة السماح. يمكنك إلغاء الجدولة قبل ذلك.
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fef3c7', color: '#78350f' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>المعرّف</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>الاسم</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>تاريخ الجدولة</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>تاريخ الحذف النهائي</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>الوقت المتبقي</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>تنبيه نهائي</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((r) => {
                    const t = r.tenant;
                    const alertSent = !!t.final_purge_alert_sent_at;
                    return (
                      <tr key={t.id} id={`pending-${t.slug}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#0f172a' }}>@{t.slug}</td>
                        <td style={{ padding: '8px 10px', color: '#0f172a' }}>{t.name}</td>
                        <td style={{ padding: '8px 10px', color: '#475569' }}>
                          {t.deletion_scheduled_at ? new Date(t.deletion_scheduled_at).toLocaleString('ar-EG') : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#475569' }}>
                          {t.deletion_purge_at ? new Date(t.deletion_purge_at).toLocaleString('ar-EG') : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 600, color: '#b91c1c' }}>
                          {formatTimeRemaining(t.deletion_purge_at)}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {alertSent ? (
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: '#fee2e2', color: '#b91c1c', fontWeight: 600 }}
                              title={new Date(t.final_purge_alert_sent_at).toLocaleString('ar-EG')}>
                              ✓ أُرسل
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: '#f1f5f9', color: '#64748b' }}>
                              لم يُرسل بعد
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button style={sx.btnEdit} onClick={() => setRescheduling(t)}>تغيير الموعد</button>
                            <button style={sx.btnEdit} onClick={() => cancelDelete(t)}>إلغاء الحذف</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {!loading && (() => {
        const pendingSlugs = new Set(
          rows
            .filter((r) => r.tenant?.status === 'pending_delete')
            .map((r) => r.tenant.slug)
            .filter(Boolean)
        );
        return (
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                ✉️ سجل تنبيهات الحذف التلقائي ({purgeDigests.length})
              </h2>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                آخر {purgeDigests.length || 30} ملخص يومي تم إرساله للمشرفين بشأن الأكاديميات المجدولة للحذف.
              </span>
            </div>
            {purgeDigests.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', padding: 24, fontSize: 13 }}>
                لم يُرسل أي ملخص بعد.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', color: '#475569' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>التاريخ</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>عدد الأكاديميات</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>الأكاديميات</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>مقتطف</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>التفاصيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purgeDigests.map((d, idx) => {
                      const rowKey = d.id || `${d.created_at || 'row'}-${idx}`;
                      const isOpen = expandedDigest === rowKey;
                      const bodyPreview = (d.body || '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 160);
                      return (
                        <React.Fragment key={rowKey}>
                          <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '8px 10px', color: '#475569', whiteSpace: 'nowrap' }}>
                              {d.created_at ? new Date(d.created_at).toLocaleString('ar-EG') : '—'}
                            </td>
                            <td style={{ padding: '8px 10px', color: '#0f172a', fontWeight: 600 }}>{d.tenant_count}</td>
                            <td style={{ padding: '8px 10px' }}>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {(d.tenants || []).slice(0, 6).map((tn) => {
                                  const stillPending = pendingSlugs.has(tn.slug);
                                  return stillPending ? (
                                    <a
                                      key={tn.slug + (tn.tenant_id || '')}
                                      href={`#pending-${tn.slug}`}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        const el = document.getElementById(`pending-${tn.slug}`);
                                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                      }}
                                      style={{ fontSize: 11, padding: '2px 8px', background: '#fef3c7', color: '#92400e', borderRadius: 99, fontWeight: 600, fontFamily: 'monospace', textDecoration: 'none' }}
                                      title="ما زالت مجدولة — اضغط للانتقال"
                                    >
                                      @{tn.slug}
                                    </a>
                                  ) : (
                                    <span
                                      key={tn.slug + (tn.tenant_id || '')}
                                      style={{ fontSize: 11, padding: '2px 8px', background: '#f1f5f9', color: '#64748b', borderRadius: 99, fontFamily: 'monospace' }}
                                      title="لم تعد في قائمة الانتظار"
                                    >
                                      @{tn.slug}
                                    </span>
                                  );
                                })}
                                {(d.tenants || []).length > 6 && (
                                  <span style={{ fontSize: 11, color: '#64748b' }}>+{d.tenants.length - 6}</span>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: '8px 10px', color: '#475569', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              title={bodyPreview}>
                              {bodyPreview || '—'}
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <button
                                style={sx.btnEdit}
                                onClick={() => setExpandedDigest(isOpen ? null : rowKey)}
                              >
                                {isOpen ? 'إخفاء' : 'عرض'}
                              </button>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={5} style={{ padding: '8px 10px', background: '#f8fafc' }}>
                                <div style={{ fontSize: 12, color: '#0f172a', fontWeight: 600, marginBottom: 4 }}>{d.title}</div>
                                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12, color: '#475569', background: 'white', padding: 10, borderRadius: 6, border: '1px solid #e2e8f0' }}>
                                  {d.body}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {!loading && (() => {
        const purged = rows
          .filter((r) => r.tenant?.status === 'deleted' && r.tenant?.deleted_by === 'auto_purge_scheduler')
          .sort((a, b) => (b.tenant.deleted_at || '').localeCompare(a.tenant.deleted_at || ''))
          .slice(0, 20);
        if (purged.length === 0) return null;
        return (
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#475569' }}>
                🗑 محذوفة تلقائياً مؤخراً ({purged.length})
              </h2>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                أكاديميات أزالها مُجدوِل الحذف التلقائي بعد انتهاء فترة السماح.
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', color: '#475569' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>المعرّف</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>الاسم</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>تاريخ الجدولة</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>تاريخ الحذف</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>السبب</th>
                  </tr>
                </thead>
                <tbody>
                  {purged.map((r) => {
                    const t = r.tenant;
                    return (
                      <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#0f172a' }}>@{t.slug}</td>
                        <td style={{ padding: '8px 10px', color: '#0f172a' }}>{t.name}</td>
                        <td style={{ padding: '8px 10px', color: '#64748b' }}>
                          {t.deletion_scheduled_at ? new Date(t.deletion_scheduled_at).toLocaleString('ar-EG') : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#64748b' }}>
                          {t.deleted_at ? new Date(t.deleted_at).toLocaleString('ar-EG') : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#64748b', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={t.deletion_reason || ''}>
                          {t.deletion_reason || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {!loading && rows.map((row) => {
        const t = row.tenant;
        const counts = row.counts || {};
        const recent = row.recent_30d || {};
        const usage = row.usage || {};
        const billing = row.billing || {};
        const expStyle = expiryBadgeStyle(billing.expiry_state);
        return (
          <div key={t.id} style={sx.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0f172a' }}>{t.name}</h3>
                  <span style={statusBadge(t.status)}>{statusText(t.status)}</span>
                  {t.status !== 'deleted' && (
                    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, ...expStyle }}>
                      {expiryText(billing)}
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>@{t.slug}</span>
                </div>
                <div style={sx.meta}>
                  الخطة: <b>{t.plan}</b> · فروع: {t.max_branches || '∞'} · أعضاء: {t.max_members || '∞'} · DB: <code>{t.db_name}</code>
                </div>
                {t.status !== 'deleted' && billing.subscription_end_at && (
                  <div style={sx.meta}>
                    الاشتراك: <b>{billing.billing_cycle === 'yearly' ? 'سنوي' : billing.billing_cycle === 'quarterly' ? 'ربع سنوي' : 'شهري'}</b>
                    {' · '}ينتهي: {new Date(billing.subscription_end_at).toLocaleDateString('ar-EG')}
                    {billing.auto_suspend_on_expiry ? ' · إيقاف تلقائي مفعّل' : ' · إيقاف تلقائي مُعطّل'}
                  </div>
                )}
                {t.owner_email && <div style={sx.meta}>المالك: {t.owner_email}</div>}
                {t.features?.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {t.features.map((f) => (
                      <span key={f} style={{ fontSize: 11, padding: '2px 8px', background: '#f1f5f9', borderRadius: 99, color: '#475569' }}>{f}</span>
                    ))}
                  </div>
                )}

                {t.status !== 'deleted' && (
                  <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>أعضاء</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{counts.members ?? 0}</div>
                      {recent.members > 0 && <div style={{ fontSize: 10, color: '#16a34a' }}>+{recent.members} (30 يوم)</div>}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>فواتير</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{counts.invoices ?? 0}</div>
                      {recent.invoices > 0 && <div style={{ fontSize: 10, color: '#16a34a' }}>+{recent.invoices} (30 يوم)</div>}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>فروع</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{counts.branches ?? 0}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>حضور</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{counts.attendance ?? 0}</div>
                      {recent.attendance > 0 && <div style={{ fontSize: 10, color: '#16a34a' }}>+{recent.attendance} (30 يوم)</div>}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>أنشطة</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{counts.activities ?? 0}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>آخر نشاط</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{formatDate(row.last_activity_at)}</div>
                    </div>
                  </div>
                )}

                {t.status !== 'deleted' && (usage.members_pct != null || usage.branches_pct != null) && (
                  <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxWidth: 480 }}>
                    <UsageBar label="استخدام الأعضاء" pct={usage.members_pct} />
                    <UsageBar label="استخدام الفروع" pct={usage.branches_pct} />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button style={sx.btnGhost} onClick={() => refreshOne(t.id)}>↻</button>
                {t.status !== 'deleted' && (
                  <button style={sx.btnRenew} onClick={() => setRenewing(t)}>تجديد</button>
                )}
                <button style={sx.btnEdit} onClick={() => setEditing(t)}>تعديل</button>
                {t.status !== 'deleted' && (
                  <button style={sx.btnGhost} onClick={() => toggleSuspend(t)}>{t.status === 'active' ? 'إيقاف' : 'تفعيل'}</button>
                )}
                {t.status === 'pending_delete' && (
                  <button style={sx.btnEdit} onClick={() => cancelDelete(t)}>إلغاء الجدولة</button>
                )}
                {t.slug !== 'default' && t.status !== 'deleted' && (
                  <button style={sx.btnDanger} onClick={() => remove(t)}>
                    {t.status === 'pending_delete' ? 'حذف نهائي' : 'حذف'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {creating && <TenantForm onSubmit={create} onCancel={() => setCreating(false)} />}
      {editing && <TenantForm initial={editing} onSubmit={(d) => update(editing.id, d)} onCancel={() => setEditing(null)} isEdit />}
      {deleting && (
        <DeleteTenantDialog
          tenant={deleting}
          onCancel={() => setDeleting(null)}
          onSchedule={(slug, reason) => scheduleDelete(deleting, slug, reason)}
          onFinalize={(slug, force) => finalizeDelete(deleting, slug, force)}
        />
      )}
      {renewing && <RenewModal tenant={renewing} onSubmit={(d) => renew(renewing.id, d)} onCancel={() => setRenewing(null)} />}
      {rescheduling && (
        <RescheduleDeleteModal
          tenant={rescheduling}
          onCancel={() => setRescheduling(null)}
          onSubmit={(dateStr) => submitReschedule(rescheduling, dateStr)}
        />
      )}

      {seedInfo && (
        <div style={sx.modalBg} onClick={() => setSeedInfo(null)}>
          <div style={sx.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: 0, marginBottom: 14, fontSize: 18, fontWeight: 700, color: '#15803d' }}>
              ✓ تم إنشاء الأكاديمية "{seedInfo.tenant.name}"
            </h2>
            {seedInfo.seed.ok ? (
              <>
                <div style={{ fontSize: 13, color: '#475569', marginBottom: 10 }}>
                  تم تجهيز قاعدة البيانات بفرع افتراضي ومستخدم مدير وإعدادات أساسية.
                </div>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13 }}>
                  <div style={{ marginBottom: 6 }}><b>اسم المستخدم:</b> <code>{seedInfo.seed.admin_username}</code></div>
                  {seedInfo.seed.admin_password ? (
                    <>
                      <div style={{ marginBottom: 6 }}>
                        <b>كلمة المرور المُولّدة:</b> <code style={{ background: '#fef3c7', padding: '2px 6px', borderRadius: 4 }}>{seedInfo.seed.admin_password}</code>
                      </div>
                      <div style={{ fontSize: 12, color: '#a16207' }}>
                        ⚠ احفظ كلمة المرور الآن — لن تظهر مرة أخرى. أرسلها للمالك بأمان.
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: '#64748b' }}>كلمة المرور التي أدخلتها مُحفوظة بأمان.</div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  للدخول: استخدم النطاق الفرعي للأكاديمية أو ضع <code>tenant_slug = {seedInfo.tenant.slug}</code> في إعدادات الجهاز.
                </div>
              </>
            ) : (
              <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 10, borderRadius: 6, fontSize: 13 }}>
                تم إنشاء الأكاديمية لكن فشل تجهيز البيانات الافتتاحية: {seedInfo.seed.error}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <button style={sx.btnPrimary} onClick={() => setSeedInfo(null)}>تم</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
