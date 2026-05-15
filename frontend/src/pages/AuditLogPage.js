import React, { useEffect, useState, useCallback } from 'react';
import { auditAPI, tenantDataAPI } from '../services/api';
import { Layout } from '../components/Layout';

const PAGE_SIZE = 50;

const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ar-SA', { hour12: false });
  } catch {
    return iso;
  }
};

const ActionBadge = ({ action }) => {
  const tone = action?.startsWith('auth.login.failure')
    ? 'bg-red-100 text-red-700'
    : action?.includes('.delete')
      ? 'bg-red-50 text-red-700'
      : action?.includes('permissions')
        ? 'bg-amber-100 text-amber-800'
        : action?.includes('.update')
          ? 'bg-blue-50 text-blue-700'
          : 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono ${tone}`}>
      {action || '—'}
    </span>
  );
};

const DiffCell = ({ diff }) => {
  if (!diff || typeof diff !== 'object' || Object.keys(diff).length === 0) {
    return <span className="text-slate-400">—</span>;
  }
  const keys = Object.keys(diff).slice(0, 4);
  return (
    <div className="space-y-0.5 text-xs">
      {keys.map((k) => (
        <div key={k} className="truncate">
          <span className="font-semibold">{k}:</span>{' '}
          <span className="text-red-600 line-through">{JSON.stringify(diff[k]?.before)}</span>{' '}
          → <span className="text-green-700">{JSON.stringify(diff[k]?.after)}</span>
        </div>
      ))}
      {Object.keys(diff).length > 4 && (
        <div className="text-slate-500">+{Object.keys(diff).length - 4} more</div>
      )}
    </div>
  );
};

const DetailsModal = ({ row, onClose }) => {
  if (!row) return null;
  const diff = row.diff || {};
  const entries = Object.entries(diff);
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b px-5 py-3 sticky top-0 bg-white">
          <div>
            <div className="text-xs text-slate-500">{fmtDate(row.created_at)}</div>
            <div className="font-bold text-lg">
              <ActionBadge action={row.action} />
              <span className="mx-2">{row.entity_name || row.entity_id || ''}</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              المستخدم: <b>{row.actor_username || '—'}</b>
              {row.actor_is_admin && <span className="ms-2 text-amber-700">(admin)</span>}
              {row.entity_type && <> · النوع: <b>{row.entity_type}</b></>}
              {row.entity_id && <> · المعرف: <code className="text-[11px]">{row.entity_id}</code></>}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <h4 className="font-semibold mb-2">التغييرات (قبل / بعد)</h4>
            {entries.length === 0 ? (
              <div className="text-sm text-slate-400">لا توجد تغييرات مفصّلة لهذه العملية.</div>
            ) : (
              <table className="w-full text-xs border">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-right px-2 py-1 border-b">الحقل</th>
                    <th className="text-right px-2 py-1 border-b">قبل</th>
                    <th className="text-right px-2 py-1 border-b">بعد</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([k, v]) => (
                    <tr key={k} className="border-t">
                      <td className="px-2 py-1 font-semibold align-top whitespace-nowrap">{k}</td>
                      <td className="px-2 py-1 align-top text-red-700 font-mono break-all">
                        {v && v.before !== undefined ? JSON.stringify(v.before, null, 2) : '—'}
                      </td>
                      <td className="px-2 py-1 align-top text-green-700 font-mono break-all">
                        {v && v.after !== undefined ? JSON.stringify(v.after, null, 2) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {row.extra && Object.keys(row.extra).length > 0 && (
            <div>
              <h4 className="font-semibold mb-2">معلومات إضافية</h4>
              <pre className="bg-slate-50 border rounded p-2 text-[11px] overflow-x-auto">
{JSON.stringify(row.extra, null, 2)}
              </pre>
            </div>
          )}
          <div>
            <h4 className="font-semibold mb-2">السجل الكامل</h4>
            <pre className="bg-slate-50 border rounded p-2 text-[11px] overflow-x-auto">
{JSON.stringify(row, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function AuditLogPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actions, setActions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({
    action: '',
    actor: '',
    entity_type: '',
    date_from: '',
    date_to: '',
    search: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filters, limit: PAGE_SIZE, offset };
      Object.keys(params).forEach((k) => params[k] === '' && delete params[k]);
      const res = await auditAPI.list(params);
      setItems(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (e) {
      console.error('audit load failed', e);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filters, offset]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    auditAPI.listActions()
      .then((r) => setActions(r.data.actions || []))
      .catch(() => setActions([]));
  }, []);

  const updateFilter = (k, v) => {
    setOffset(0);
    setFilters((f) => ({ ...f, [k]: v }));
  };

  const onExportCsv = () => {
    const params = { ...filters };
    Object.keys(params).forEach((k) => params[k] === '' && delete params[k]);
    window.open(auditAPI.exportUrl(params), '_blank');
  };

  const onExportTenantData = () => {
    if (!window.confirm('سيتم تنزيل نسخة كاملة من بيانات الأكاديمية بصيغة ZIP. هل تريد المتابعة؟')) return;
    window.open(tenantDataAPI.exportUrl(), '_blank');
  };

  return (
    <Layout title="سجل التدقيق">
      <div className="p-4 space-y-4" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">سجل التدقيق</h1>
            <p className="text-sm text-slate-500">العمليات الحساسة في الأكاديمية</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onExportCsv}
              className="px-3 py-2 rounded bg-orange-600 text-white text-sm hover:bg-orange-700"
            >
              تصدير CSV
            </button>
            <button
              onClick={onExportTenantData}
              className="px-3 py-2 rounded border border-slate-300 text-sm hover:bg-slate-50"
              title="نسخة كاملة من بيانات الأكاديمية"
            >
              تنزيل بيانات الأكاديمية (ZIP)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-2 bg-white p-3 rounded shadow-sm border">
          <select
            value={filters.action}
            onChange={(e) => updateFilter('action', e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">كل العمليات</option>
            {actions.map((a) => (<option key={a} value={a}>{a}</option>))}
          </select>
          <input
            placeholder="المستخدم"
            value={filters.actor}
            onChange={(e) => updateFilter('actor', e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
          <input
            placeholder="نوع الكيان (member, invoice...)"
            value={filters.entity_type}
            onChange={(e) => updateFilter('entity_type', e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
          <input
            type="date"
            value={filters.date_from}
            onChange={(e) => updateFilter('date_from', e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
          <input
            type="date"
            value={filters.date_to}
            onChange={(e) => updateFilter('date_to', e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
          <input
            placeholder="بحث (اسم/معرف)"
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>

        <div className="bg-white rounded shadow-sm border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-right">الوقت</th>
                <th className="px-3 py-2 text-right">العملية</th>
                <th className="px-3 py-2 text-right">المستخدم</th>
                <th className="px-3 py-2 text-right">الكيان</th>
                <th className="px-3 py-2 text-right">التغييرات</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="text-center py-6 text-slate-400">جارٍ التحميل…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={5} className="text-center py-6 text-slate-400">لا توجد سجلات</td></tr>
              )}
              {!loading && items.map((row) => (
                <tr
                  key={row.id}
                  className="border-t hover:bg-slate-50 cursor-pointer"
                  onClick={() => setSelected(row)}
                  title="اضغط لعرض التفاصيل الكاملة"
                >
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-600">{fmtDate(row.created_at)}</td>
                  <td className="px-3 py-2"><ActionBadge action={row.action} /></td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.actor_username || '—'}</div>
                    {row.actor_is_admin && <div className="text-xs text-amber-700">admin</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-xs text-slate-500">{row.entity_type}</div>
                    <div className="font-medium truncate max-w-[220px]">{row.entity_name || row.entity_id}</div>
                  </td>
                  <td className="px-3 py-2 max-w-md">
                    <DiffCell diff={row.diff} />
                    <div className="text-[11px] text-blue-600 mt-1">عرض التفاصيل ←</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">
            {items.length ? `${offset + 1}–${offset + items.length}` : 0} من {total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="px-3 py-1 border rounded disabled:opacity-50"
            >السابق</button>
            <button
              disabled={offset + items.length >= total || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="px-3 py-1 border rounded disabled:opacity-50"
            >التالي</button>
          </div>
        </div>
        <DetailsModal row={selected} onClose={() => setSelected(null)} />
      </div>
    </Layout>
  );
}
