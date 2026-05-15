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

const sx = {
  page: { minHeight: '100vh', background: '#f1f5f9', padding: 24, direction: 'rtl', fontFamily: 'system-ui, -apple-system, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 },
  btnPrimary: { padding: '10px 16px', background: '#0f172a', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnGhost: { padding: '8px 12px', background: 'transparent', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, cursor: 'pointer' },
  btnDanger: { padding: '6px 10px', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
  btnEdit: { padding: '6px 10px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
  card: { background: 'white', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0' },
  badgeActive: { display: 'inline-block', padding: '2px 8px', background: '#dcfce7', color: '#15803d', borderRadius: 99, fontSize: 11, fontWeight: 600 },
  badgeSuspended: { display: 'inline-block', padding: '2px 8px', background: '#fef3c7', color: '#a16207', borderRadius: 99, fontSize: 11, fontWeight: 600 },
  badgeDeleted: { display: 'inline-block', padding: '2px 8px', background: '#fee2e2', color: '#b91c1c', borderRadius: 99, fontSize: 11, fontWeight: 600 },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 },
  modal: { background: 'white', borderRadius: 12, padding: 24, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' },
  field: { marginBottom: 14 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' },
  row: { display: 'flex', gap: 12 },
  meta: { fontSize: 12, color: '#64748b', marginTop: 4 },
};

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
      await onSubmit({
        ...form,
        max_branches: Number(form.max_branches) || 0,
        max_members: Number(form.max_members) || 0,
      });
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
          <label style={sx.label}>إيميل المالك (اختياري)</label>
          <input type="email" style={sx.input} value={form.owner_email} onChange={(e) => setF('owner_email', e.target.value)} />
        </div>
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

export default function SuperTenants() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [stats, setStats] = useState({});

  const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('super_token') || ''}` } });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/super/tenants', auth());
      setTenants(res.data || []);
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

  const loadStats = async (id) => {
    try {
      const res = await axios.get(`/super/tenants/${id}/stats`, auth());
      setStats((s) => ({ ...s, [id]: res.data.counts }));
    } catch {
      setStats((s) => ({ ...s, [id]: null }));
    }
  };

  const create = async (data) => {
    await axios.post('/super/tenants', data, auth());
    setCreating(false);
    await load();
  };

  const update = async (id, data) => {
    await axios.patch(`/super/tenants/${id}`, data, auth());
    setEditing(null);
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

  const remove = async (t) => {
    if (t.slug === 'default') return alert('لا يمكن حذف الأكاديمية الافتراضية');
    if (!window.confirm(`حذف "${t.name}" نهائياً؟ (سيتم تعليمه فقط، البيانات تبقى في قاعدة البيانات)`)) return;
    try {
      await axios.delete(`/super/tenants/${t.id}`, auth());
      await load();
    } catch (e) { alert(e?.response?.data?.detail || 'فشل'); }
  };

  const logout = () => {
    localStorage.removeItem('super_token');
    localStorage.removeItem('super_user');
    navigate('/super/login', { replace: true });
  };

  const statusBadge = (s) => s === 'suspended' ? sx.badgeSuspended : (s === 'deleted' ? sx.badgeDeleted : sx.badgeActive);
  const statusText = (s) => s === 'suspended' ? 'موقوفة' : (s === 'deleted' ? 'محذوفة' : 'نشطة');

  return (
    <div style={sx.page}>
      <div style={sx.header}>
        <div>
          <h1 style={sx.title}>الأكاديميات المشتركة</h1>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{tenants.length} أكاديمية</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={sx.btnPrimary} onClick={() => setCreating(true)}>+ أكاديمية جديدة</button>
          <button style={sx.btnGhost} onClick={logout}>خروج</button>
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>جارٍ التحميل...</div>}
      {error && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 12, borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      {!loading && tenants.map((t) => (
        <div key={t.id} style={sx.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0f172a' }}>{t.name}</h3>
                <span style={statusBadge(t.status)}>{statusText(t.status)}</span>
                <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>@{t.slug}</span>
              </div>
              <div style={sx.meta}>
                الخطة: <b>{t.plan}</b> · فروع: {t.max_branches || '∞'} · أعضاء: {t.max_members || '∞'} · DB: <code>{t.db_name}</code>
              </div>
              {t.owner_email && <div style={sx.meta}>المالك: {t.owner_email}</div>}
              {t.features?.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {t.features.map((f) => (
                    <span key={f} style={{ fontSize: 11, padding: '2px 8px', background: '#f1f5f9', borderRadius: 99, color: '#475569' }}>{f}</span>
                  ))}
                </div>
              )}
              {stats[t.id] && (
                <div style={{ ...sx.meta, marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {Object.entries(stats[t.id]).map(([k, v]) => (
                    <span key={k}>{k}: <b>{v}</b></span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button style={sx.btnGhost} onClick={() => loadStats(t.id)}>إحصائيات</button>
              <button style={sx.btnEdit} onClick={() => setEditing(t)}>تعديل</button>
              {t.status !== 'deleted' && (
                <button style={sx.btnGhost} onClick={() => toggleSuspend(t)}>{t.status === 'active' ? 'إيقاف' : 'تفعيل'}</button>
              )}
              {t.slug !== 'default' && t.status !== 'deleted' && (
                <button style={sx.btnDanger} onClick={() => remove(t)}>حذف</button>
              )}
            </div>
          </div>
        </div>
      ))}

      {creating && <TenantForm onSubmit={create} onCancel={() => setCreating(false)} />}
      {editing && <TenantForm initial={editing} onSubmit={(d) => update(editing.id, d)} onCancel={() => setEditing(null)} isEdit />}
    </div>
  );
}
