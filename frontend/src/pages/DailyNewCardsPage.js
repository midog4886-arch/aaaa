import React, { useEffect, useState, useCallback } from 'react';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Printer, CalendarDays, Users, Building2, RefreshCw, CreditCard, Filter } from 'lucide-react';
import { membersAPI } from '../services/api';
import { getMemberQRValue } from '../utils/memberQR';

const todayStr = () => new Date().toISOString().split('T')[0];

const DailyNewCardsPage = () => {
  const [date, setDate] = useState(todayStr());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [selectedBranchId, setSelectedBranchId] = useState('all');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const toggleMember = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleBranchAll = (branch, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      branch.members.forEach((m) => {
        if (checked) next.add(m.id);
        else next.delete(m.id);
      });
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectAllVisible = () => {
    setSelectedIds(() => {
      const next = new Set();
      (data?.branches || []).forEach((br) => {
        if (selectedBranchId !== 'all' && String(br.branch_id) !== String(selectedBranchId)) return;
        br.members.forEach((m) => next.add(m.id));
      });
      return next;
    });
  };

  const load = useCallback(async (d) => {
    setLoading(true);
    setError('');
    try {
      const res = await membersAPI.getDailyNewCards(d);
      setData(res.data);
    } catch (e) {
      setError(e?.response?.data?.detail || 'فشل تحميل بطاقات اليوم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  const renderCardHtml = (m) => {
    const qrData = encodeURIComponent(getMemberQRValue(m.member_code || ''));
    const allActs = m.activities || [];
    const today = new Date();
    const parseEnd = (a) => {
      if (!a?.end_date) return 0;
      const t = new Date(a.end_date).getTime();
      return isNaN(t) ? 0 : t;
    };
    const actives = allActs.filter((a) => a?.end_date && new Date(a.end_date) >= today);
    const pool = actives.length ? actives : allActs;
    const latest = [...pool].sort((a, b) => parseEnd(b) - parseEnd(a))[0] || allActs[0] || {};
    const startDate = latest.start_date || '';
    const endDate = latest.end_date || '';
    const schedule = latest.schedule || '';
    const activitiesHtml = allActs
      .map((act) => {
        const isActive = act?.end_date ? new Date(act.end_date) >= today : true;
        return `<div class="activity-item ${isActive ? 'active' : 'expired'}"><div class="activity-name">${isActive ? '✓' : '✗'} ${act.activity_name || ''}</div></div>`;
      })
      .join('');
    const name = (m.name_ar || m.name || '').split('+').map((n) => n.trim()).filter(Boolean).join(' - ');
    return `
      <div class="card">
        <div class="accent-stripe"><span>${(m.activities && m.activities[0] && m.activities[0].activity_name) || 'GLOBAL CHAMPIONS'}</span></div>
        <div class="card-header">
          <div class="header-logo"><img src="${window.location.origin}/images/academy-logo.png" alt="logo" /></div>
          <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
        </div>
        <div class="card-body">
          <div class="info-section">
            <div class="info-label">الاسم</div>
            <div class="member-name">${name}</div>
            <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${m.member_code || ''}</span></div>
            <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${m.phone || '-'}</span></div>
            ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
          </div>
          <div class="qr-container">
            <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${qrData}" /></div>
            <div class="qr-dates"><span>من: ${startDate || '----'}</span><span>إلى: ${endDate || '----'}</span></div>
            ${schedule ? `<div class="schedule-info">📅 ${schedule}</div>` : ''}
          </div>
        </div>
      </div>
    `;
  };

  const renderLogoCardHtml = () => `
    <div class="logo-card">
      <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
      <div class="contact-block">
        <div class="contact-row">📞 0566238384</div>
      </div>
    </div>
  `;

  const getFilteredBranches = () => {
    const list = data?.branches || [];
    let scoped = selectedBranchId === 'all'
      ? list
      : list.filter((b) => String(b.branch_id) === String(selectedBranchId));
    if (selectedIds.size > 0) {
      scoped = scoped
        .map((b) => ({ ...b, members: b.members.filter((m) => selectedIds.has(m.id)) }))
        .filter((b) => b.members.length > 0);
    }
    return scoped;
  };

  const printAllCards = () => {
    if (!data || !data.members || data.members.length === 0) return;
    const branchesList = getFilteredBranches();
    if (branchesList.length === 0) return;

    const pairs = [];
    branchesList.forEach((branch) => {
      branch.members.forEach((m) => {
        pairs.push({ branch, member: m });
      });
    });

    const pagesHtml = [];
    for (let i = 0; i < pairs.length; i += 4) {
      const slice = pairs.slice(i, i + 4);
      const rowsHtml = slice
        .map(
          ({ branch, member }) => `
            <div class="row">
              <div class="branch-tag">${branch.branch_name}</div>
              <div class="row-cards">
                ${renderCardHtml(member)}
                ${renderLogoCardHtml()}
              </div>
            </div>
          `,
        )
        .join('');
      pagesHtml.push(`<div class="page">${rowsHtml}</div>`);
    }

    const win = window.open('', '_blank', 'width=900,height=700');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>كروت ${data.date}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
        @page { size: A4; margin: 5mm; }
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'Tajawal',Arial,sans-serif; background:#f3f4f6; direction:rtl; }
        .toolbar { padding:14px; text-align:center; background:white; border-bottom:1px solid #e5e7eb; position:sticky; top:0; }
        .toolbar button { padding:10px 24px; background:linear-gradient(135deg,#F97316,#EA580C); color:white; border:none; border-radius:8px; cursor:pointer; font-family:inherit; font-weight:700; font-size:15px; }
        .toolbar .meta { margin-top:6px; color:#374151; font-size:13px; }
        .page { width:200mm; min-height:287mm; margin:6mm auto; background:white; padding:4mm; box-shadow:0 4px 16px rgba(0,0,0,0.08); display:flex; flex-direction:column; gap:4mm; page-break-after:always; }
        .page:last-child { page-break-after:auto; }
        .row { display:flex; flex-direction:column; gap:2mm; }
        .branch-tag { background:#FEF3C7; color:#92400E; font-weight:700; padding:1mm 3mm; border-radius:2mm; font-size:9pt; align-self:flex-start; }
        .row-cards { display:flex; gap:4mm; flex-wrap:wrap; }
        .card { width:60mm; height:95mm; background:white; border-radius:3mm; overflow:hidden; border:1px solid #e5e7eb; display:flex; flex-direction:column; position:relative; }
        .accent-stripe { position:absolute; top:0; bottom:0; right:0; width:4mm; background:linear-gradient(180deg,#0EA5E9,#0369A1,#075985); z-index:2; display:flex; align-items:center; justify-content:center; overflow:hidden; }
        .accent-stripe span { writing-mode:vertical-rl; transform:rotate(180deg); color:white; font-size:6.5pt; font-weight:900; letter-spacing:1.5pt; text-transform:uppercase; white-space:nowrap; }
        .card-header { background:linear-gradient(135deg,#1E3A5F 0%,#2C5282 45%,#C9A227 100%); padding:2mm 2mm 2.5mm; display:flex; flex-direction:column; align-items:center; gap:1mm; color:white; text-align:center; }
        .header-text h2 { font-size:7.5pt; font-weight:900; line-height:1.2; }
        .header-text p { font-size:5.5pt; font-weight:800; opacity:0.95; margin-top:0.3mm; }
        .header-logo { width:18mm; height:18mm; border-radius:50%; background:white; padding:0; display:flex; align-items:center; justify-content:center; overflow:hidden; border:1.5px solid white; box-shadow:0 1px 3px rgba(0,0,0,0.2); }
        .header-logo img { width:140%; height:140%; object-fit:cover; border-radius:50%; }
        .card-body { padding:2mm 5mm 1.5mm 2.5mm; display:flex; flex-direction:column; gap:1.5mm; flex:1; min-height:0; }
        .info-section { text-align:right; overflow:hidden; flex:1; min-height:0; display:flex; flex-direction:column; }
        .qr-container { display:flex; flex-direction:column; align-items:center; flex-shrink:0; padding-top:1mm; }
        .qr-section { width:26mm; height:26mm; background:white; border:1px solid #eee; border-radius:2mm; padding:0.5mm; }
        .qr-section img { width:100%; height:100%; }
        .qr-dates { text-align:center; font-size:6pt; color:#1f2937; margin-top:0.8mm; line-height:1.3; font-weight:700; }
        .qr-dates span { display:block; }
        .qr-label { text-align:center; font-size:6.5pt; color:#F97316; font-weight:900; margin-top:0.5mm; letter-spacing:0.3mm; }
        .schedule-info { text-align:center; font-size:5.5pt; color:#F97316; margin-top:0.5mm; font-weight:700; background:#FFF7ED; padding:0.4mm 1mm; border-radius:1.5mm; }
        .info-label { color:#6b7280; font-size:6pt; font-weight:600; }
        .member-name { font-size:10.5pt; font-weight:900; color:#111827; margin:0.3mm 0 1.2mm; line-height:1.15; letter-spacing:-0.1pt; }
        .info-row { display:flex; gap:1mm; font-size:7pt; align-items:center; margin-bottom:0.5mm; }
        .member-code { color:#EA580C; font-weight:900; font-size:9pt; }
        .activities { margin-top:1mm; padding-top:1mm; border-top:1px dashed #e5e7eb; overflow:hidden; min-height:0; flex-shrink:1; }
        .activities-label { font-size:6pt; color:#6b7280; font-weight:700; margin-bottom:0.5mm; }
        .activity-item { padding:0.4mm 1mm; margin-bottom:0.3mm; border-radius:1mm; font-size:6pt; }
        .activity-item.active { background:transparent; border-right:2px solid #10B981; }
        .activity-item.expired { background:transparent; border-right:2px solid #EF4444; }
        .activity-name { font-weight:700; color:#1f2937; font-size:6.5pt; }
        .logo-card { width:60mm; height:95mm; background:linear-gradient(180deg,#FFFFFF,#FFF7ED); border-radius:3mm; overflow:hidden; border:1px solid #e5e7eb; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:5mm 4mm; gap:3mm; }
        .logo-card img { width:95%; max-width:95%; max-height:78%; object-fit:contain; }
        .logo-card .contact-block { display:flex; flex-direction:column; gap:1.5mm; align-items:center; width:100%; }
        .logo-card .contact-row { font-size:9pt; color:#111827; text-align:center; font-weight:800; line-height:1.3; direction:ltr; }
        @media print { .toolbar { display:none; } .page { margin:0 auto; box-shadow:none; } body { background:white; } }
      </style></head><body>
      <div class="toolbar">
        <button onclick="window.print()">🖨️ طباعة (${pairs.length} كرت)</button>
        <div class="meta">تاريخ: ${data.date} — إجمالي: ${pairs.length} كرت موزع على ${data.total_branches} فرع</div>
      </div>
      ${pagesHtml.join('')}
      </body></html>`);
    win.document.close();
  };

  const printCD820 = (mode = 'duplex') => {
    if (!data || !data.members || data.members.length === 0) return;
    const branchesList = getFilteredBranches();
    if (branchesList.length === 0) return;

    const allMembers = [];
    branchesList.forEach((branch) => {
      branch.members.forEach((m) => allMembers.push({ branch, member: m }));
    });

    const pagesHtml = [];
    allMembers.forEach(({ member }) => {
      pagesHtml.push(`<div class="cd-page front">${renderCardHtml(member)}</div>`);
      if (mode === 'duplex') {
        pagesHtml.push(`<div class="cd-page back">${renderLogoCardHtml()}</div>`);
      }
    });

    const expectedPages = pagesHtml.length;
    const win = window.open('', '_blank', 'width=900,height=700');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>CD820 - ${data.date}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
        @page { size: 54mm 85.6mm; margin: 0; }
        * { margin:0; padding:0; box-sizing:border-box; }
        html, body { width:54mm; }
        body { font-family:'Tajawal',Arial,sans-serif; background:#e5e7eb; direction:rtl; }
        .toolbar { padding:14px; text-align:center; background:white; border-bottom:1px solid #e5e7eb; position:sticky; top:0; width:100%; max-width:none; }
        .toolbar button { padding:10px 24px; background:linear-gradient(135deg,#F97316,#EA580C); color:white; border:none; border-radius:8px; cursor:pointer; font-family:inherit; font-weight:700; font-size:15px; margin:0 4px; }
        .toolbar button.secondary { background:#374151; }
        .toolbar .meta { margin-top:6px; color:#374151; font-size:13px; }
        .toolbar .hint { margin-top:4px; color:#6b7280; font-size:11px; line-height:1.5; }
        .cd-page { width:54mm; height:85.6mm; background:white; margin:4mm auto; box-shadow:0 2px 8px rgba(0,0,0,0.15); overflow:hidden; page-break-after:always; position:relative; }
        .cd-page:last-child { page-break-after:auto; }
        .card { width:54mm; height:85.6mm; border-radius:0; border:none; display:flex; flex-direction:column; position:relative; }
        .accent-stripe { position:absolute; top:0; bottom:0; right:0; width:4mm; background:linear-gradient(180deg,#0EA5E9,#0369A1,#075985); z-index:2; display:flex; align-items:center; justify-content:center; overflow:hidden; }
        .accent-stripe span { writing-mode:vertical-rl; transform:rotate(180deg); color:white; font-size:6pt; font-weight:900; letter-spacing:1.2pt; text-transform:uppercase; white-space:nowrap; }
        .card-header { background:linear-gradient(135deg,#1E3A5F 0%,#2C5282 45%,#C9A227 100%); padding:2mm 2mm 2.2mm; display:flex; flex-direction:column; align-items:center; gap:1mm; color:white; text-align:center; }
        .header-text h2 { font-size:7pt; font-weight:900; line-height:1.2; }
        .header-text p { font-size:5pt; font-weight:800; opacity:0.95; margin-top:0.2mm; }
        .header-logo { width:16mm; height:16mm; border-radius:50%; background:white; padding:0; display:flex; align-items:center; justify-content:center; overflow:hidden; border:1.5px solid white; box-shadow:0 1px 3px rgba(0,0,0,0.2); }
        .header-logo img { width:140%; height:140%; object-fit:cover; border-radius:50%; }
        .card-body { padding:2mm 5mm 1.5mm 2mm; display:flex; flex-direction:column; gap:1mm; flex:1; min-height:0; }
        .info-section { text-align:right; overflow:hidden; flex:1; min-height:0; display:flex; flex-direction:column; }
        .qr-container { display:flex; flex-direction:column; align-items:center; flex-shrink:0; padding-top:1mm; }
        .qr-section { width:24mm; height:24mm; background:white; border:1px solid #eee; border-radius:1.5mm; padding:0.4mm; }
        .qr-section img { width:100%; height:100%; }
        .qr-dates { text-align:center; font-size:6pt; color:#1f2937; margin-top:0.6mm; line-height:1.2; font-weight:700; }
        .qr-dates span { display:block; }
        .qr-label { text-align:center; font-size:6.5pt; color:#EA580C; font-weight:900; margin-top:0.4mm; letter-spacing:0.2mm; }
        .schedule-info { text-align:center; font-size:5pt; color:#F97316; margin-top:0.4mm; font-weight:700; background:#FFF7ED; padding:0.3mm 0.8mm; border-radius:1.2mm; }
        .info-label { color:#6b7280; font-size:6.5pt; font-weight:600; }
        .member-name { font-size:10.5pt; font-weight:900; color:#111827; margin:0.3mm 0 1.2mm; line-height:1.1; letter-spacing:-0.1pt; }
        .info-row { display:flex; gap:1mm; font-size:7pt; font-weight:700; color:#111827; align-items:center; margin-bottom:0.4mm; }
        .member-code { color:#EA580C; font-weight:900; font-size:9pt; }
        .activities { margin-top:0.8mm; padding-top:0.8mm; border-top:1px dashed #e5e7eb; overflow:hidden; min-height:0; flex-shrink:1; }
        .activities-label { font-size:6.5pt; color:#6b7280; font-weight:700; margin-bottom:0.3mm; }
        .activity-item { padding:0.3mm 0.8mm; margin-bottom:0.2mm; border-radius:0.8mm; font-size:6.5pt; }
        .activity-item.active { background:transparent; border-right:2px solid #10B981; }
        .activity-item.expired { background:transparent; border-right:2px solid #EF4444; }
        .activity-name { font-weight:800; color:#111827; font-size:6.5pt; }
        .cd-page.back { }
        .logo-card { width:54mm; height:85.6mm; background:linear-gradient(180deg,#FFFFFF,#FFF7ED); display:flex; flex-direction:column; align-items:center; justify-content:center; padding:4mm 3mm; border:none; border-radius:0; gap:2.5mm; }
        .logo-card img { width:50mm; max-width:98%; max-height:75%; object-fit:contain; margin-bottom:0; }
        .logo-card .contact-block { display:flex; flex-direction:column; gap:1.3mm; align-items:center; width:100%; }
        .logo-card .contact-row { font-size:8pt; color:#111827; text-align:center; font-weight:800; line-height:1.3; direction:ltr; }
        @media print {
          .toolbar { display:none; }
          html, body { background:white; margin:0; padding:0; }
          .cd-page { margin:0; box-shadow:none; }
        }
      </style></head><body>
      <div class="toolbar">
        <button onclick="window.print()">🖨️ طباعة على Datacard CD820</button>
        <button class="secondary" onclick="window.close()">إغلاق</button>
        <div class="meta">${allMembers.length} عضو — ${expectedPages} صفحة (${mode === 'duplex' ? 'وش + ظهر' : 'وش فقط'})</div>
        <div class="hint">
          إعدادات الطابعة في حوار الطباعة:<br/>
          • Paper Size: CR-80 (54 × 85.6 mm)<br/>
          • Orientation: Portrait<br/>
          • Margins: None<br/>
          ${mode === 'duplex' ? '• Double-sided: ON (flip on long edge)<br/>' : ''}
          • Scale: 100% (لا تستخدم Fit to page)
        </div>
      </div>
      ${pagesHtml.join('')}
      </body></html>`);
    win.document.close();
  };

  const allBranches = data?.branches || [];
  const branches = selectedBranchId === 'all'
    ? allBranches
    : allBranches.filter((b) => String(b.branch_id) === String(selectedBranchId));
  const totalMembers = branches.reduce((sum, b) => sum + (b.members?.length || 0), 0);
  const totalBranchesShown = branches.length;

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-7xl mx-auto" dir="rtl">
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-1 flex items-center gap-2">
            <CalendarDays className="w-7 h-7 text-orange-500" />
            كروت العضوية اليومية
          </h1>
          <p className="text-gray-600 text-sm">تجميع يومي لكل كروت العضوية الجديدة من كل الفروع لطباعتها وتوزيعها.</p>
        </div>

        <Card className="mb-6 shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-3 md:items-end">
              <div className="flex-1">
                <label className="block text-sm font-semibold text-gray-700 mb-1">اختر اليوم</label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="text-lg"
                  dir="ltr"
                />
              </div>
              <div className="md:w-64">
                <label className="block text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5 text-orange-500" />
                  الفرع
                </label>
                <select
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  className="w-full h-10 border border-gray-300 rounded-md px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
                >
                  <option value="all">كل الفروع ({data?.total_branches || 0})</option>
                  {(data?.branches || []).map((b) => (
                    <option key={b.branch_id} value={b.branch_id}>
                      {b.branch_name} ({b.members.length})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  onClick={() => load(date)}
                  variant="outline"
                  disabled={loading}
                  className="gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  تحديث
                </Button>
                <Button
                  onClick={() => setDate(todayStr())}
                  variant="outline"
                >
                  اليوم
                </Button>
                <Button
                  onClick={printAllCards}
                  disabled={loading || totalMembers === 0}
                  className="bg-orange-500 hover:bg-orange-600 text-white gap-2"
                >
                  <Printer className="w-4 h-4" />
                  طباعة A4 ({totalMembers})
                </Button>
                <Button
                  onClick={() => printCD820('duplex')}
                  disabled={loading || totalMembers === 0}
                  className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
                  title="طباعة على بطاقات بلاستيك CR-80 (وش + ظهر)"
                >
                  <CreditCard className="w-4 h-4" />
                  CD820 وش وظهر
                </Button>
                <Button
                  onClick={() => printCD820('single')}
                  disabled={loading || totalMembers === 0}
                  variant="outline"
                  className="border-blue-600 text-blue-700 hover:bg-blue-50 gap-2"
                  title="طباعة وش فقط على CD820"
                >
                  <CreditCard className="w-4 h-4" />
                  CD820 وش فقط
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              <Badge variant="secondary" className="text-sm gap-1 px-3 py-1">
                <Users className="w-3.5 h-3.5" />
                {selectedBranchId === 'all' ? 'إجمالي الأعضاء الجدد' : 'أعضاء الفرع المختار'}: {totalMembers}
              </Badge>
              <Badge variant="secondary" className="text-sm gap-1 px-3 py-1">
                <Building2 className="w-3.5 h-3.5" />
                {selectedBranchId === 'all' ? `عدد الفروع: ${data?.total_branches || 0}` : `الفرع: ${totalBranchesShown}`}
              </Badge>
              {selectedBranchId !== 'all' && (
                <Badge
                  className="text-xs gap-1 px-3 py-1 bg-orange-100 text-orange-700 cursor-pointer hover:bg-orange-200"
                  onClick={() => setSelectedBranchId('all')}
                >
                  ✕ إزالة فلتر الفرع
                </Badge>
              )}
              {selectedIds.size > 0 && (
                <Badge className="text-sm gap-1 px-3 py-1 bg-blue-600 text-white">
                  محدد يدوياً: {selectedIds.size}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Button
                size="sm"
                variant="outline"
                onClick={selectAllVisible}
                disabled={loading || totalMembers === 0}
              >
                تحديد كل المعروض
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={clearSelection}
                disabled={selectedIds.size === 0}
              >
                إلغاء التحديد
              </Button>
              <span className="text-xs text-gray-500 self-center">
                {selectedIds.size > 0
                  ? `سيتم طباعة ${selectedIds.size} كرت محدد فقط`
                  : 'بدون تحديد: سيتم طباعة كل أعضاء الفرع المعروض'}
              </span>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">
            {error}
          </div>
        )}

        {loading && (
          <div className="text-center py-12 text-gray-500">جاري التحميل...</div>
        )}

        {!loading && totalMembers === 0 && !error && (
          <Card className="shadow-sm">
            <CardContent className="p-10 text-center text-gray-500">
              <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-lg">لا يوجد أعضاء جدد بهذا التاريخ</p>
              <p className="text-sm mt-1">جرّب تاريخاً آخر من الفلتر بالأعلى.</p>
            </CardContent>
          </Card>
        )}

        {!loading && branches.map((branch) => {
          const branchSelectedCount = branch.members.filter((m) => selectedIds.has(m.id)).length;
          const allSelected = branchSelectedCount === branch.members.length && branch.members.length > 0;
          return (
          <Card key={branch.branch_id} className="mb-4 shadow-sm">
            <CardHeader className="bg-gradient-to-l from-orange-50 to-amber-50 border-b py-3">
              <CardTitle className="text-lg flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-orange-500" />
                  {branch.branch_name}
                </span>
                <div className="flex items-center gap-2">
                  {branchSelectedCount > 0 && (
                    <Badge className="bg-blue-600 text-white text-xs">محدد: {branchSelectedCount}</Badge>
                  )}
                  <Badge className="bg-orange-500 text-white">{branch.members.length} عضو</Badge>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-center p-2 font-semibold w-10">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(e) => toggleBranchAll(branch, e.target.checked)}
                          className="w-4 h-4 cursor-pointer accent-orange-500"
                          title="تحديد كل الفرع"
                        />
                      </th>
                      <th className="text-right p-2 font-semibold">#</th>
                      <th className="text-right p-2 font-semibold">رقم العضوية</th>
                      <th className="text-right p-2 font-semibold">الاسم</th>
                      <th className="text-right p-2 font-semibold">الجوال</th>
                      <th className="text-right p-2 font-semibold">الأنشطة</th>
                      <th className="text-right p-2 font-semibold">وقت التسجيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branch.members.map((m, idx) => {
                      const acts = (m.activities || []).map((a) => a.activity_name).filter(Boolean).join('، ');
                      const time = (m.created_at || '').split('T')[1]?.split('.')[0]?.slice(0, 5) || '';
                      const isSelected = selectedIds.has(m.id);
                      return (
                        <tr
                          key={m.id}
                          className={`border-t hover:bg-orange-50/40 cursor-pointer ${isSelected ? 'bg-blue-50' : ''}`}
                          onClick={() => toggleMember(m.id)}
                        >
                          <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleMember(m.id)}
                              className="w-4 h-4 cursor-pointer accent-orange-500"
                            />
                          </td>
                          <td className="p-2 text-gray-500">{idx + 1}</td>
                          <td className="p-2 font-bold text-orange-600">#{m.member_code}</td>
                          <td className="p-2 font-medium">{m.name_ar || m.name}</td>
                          <td className="p-2" dir="ltr">{m.phone || '-'}</td>
                          <td className="p-2 text-gray-700">{acts || '-'}</td>
                          <td className="p-2 text-gray-500" dir="ltr">{time}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          );
        })}
      </div>
    </Layout>
  );
};

export default DailyNewCardsPage;
