import React, { useState } from 'react';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle, CreditCard, Download, Languages, Phone, Printer, User, XCircle } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { membersAPI } from '../services/api';
import { getPrimaryColor } from '../services/branding';
import { getMemberQRValue } from '../utils/memberQR';
import { dedupeCardActivities, getPrintLang, PRINT_LABELS, setPrintLang, translateSchedule } from '../utils/printLang';

const API_URL = '';

const MemberCardPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [member, setMember] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [printLang, setPrintLangState] = useState(getPrintLang);
  const qrValue = getMemberQRValue(member?.member_code);

  const changePrintLang = (value) => {
    setPrintLang(value);
    setPrintLangState(value);
  };

  const loadMember = async (lookup, message) => {
    setLoading(true);
    setError('');
    setMember(null);
    setMatches([]);
    try {
      const response = await axios.get(`${API_URL}/api/public/member-card/${encodeURIComponent(lookup)}`);
      if (response.data?.multiple) setMatches(response.data.matches || []);
      else setMember(response.data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : (err.response?.status === 404 ? 'لم يتم العثور على العضو' : message));
    } finally {
      setLoading(false);
    }
  };

  const searchMember = () => {
    if (searchQuery.trim()) loadMember(searchQuery.trim(), 'حدث خطأ في البحث');
  };

  const markCurrentPrinted = async () => {
    try {
      if (member?.id) await membersAPI.markPrinted([member.id]);
    } catch (_error) {
      // The physical print remains available if audit recording fails.
    }
  };

  const getPrintDetails = (lang) => {
    const activities = dedupeCardActivities(member?.activities);
    const today = new Date();
    const active = activities.filter((activity) => activity?.end_date && new Date(activity.end_date) >= today);
    const pool = active.length ? active : activities;
    const latest = [...pool].sort((a, b) =>
      new Date(b?.end_date || 0) - new Date(a?.end_date || 0))[0] || {};
    const activityHtml = activities.map((activity) => {
      const name = lang === 'en' && activity.activity_name_en
        ? activity.activity_name_en
        : activity.activity_name || '';
      return `<div class="activity ${activity.status === 'active' ? 'active' : 'expired'}"><b>${activity.status === 'active' ? '✓' : '✗'} ${name}</b></div>`;
    }).join('');
    return { activities, latest, activityHtml };
  };

  const buildCardMarkup = (lang, compact = false) => {
    const L = PRINT_LABELS[lang] || PRINT_LABELS.ar;
    const { activities, latest, activityHtml } = getPrintDetails(lang);
    const logo = `${window.location.origin}/images/academy-logo.png`;
    const accent = getPrimaryColor() || '#F97316';
    const name = (member?.name_ar || member?.name || '').split('+').map((part) => part.trim()).filter(Boolean).join(' - ');
    return {
      front: `<div class="${compact ? 'cd-page' : 'card'}"><div class="stripe"><span>${activities[0]?.activity_name || 'GLOBAL CHAMPIONS'}</span></div>
        <div class="card-body"><div class="info"><small>${L.name}</small><h2>${name}</h2><p>${L.member_id}: <strong>${member?.member_code || ''}</strong></p>
        ${!compact ? `<p>${L.phone}: ${member?.phone || '-'}</p>` : ''}${activityHtml ? `<div class="activities"><small>${L.activities}</small>${activityHtml}</div>` : ''}</div>
        <div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&ecc=H&margin=0&qzone=1&format=png&data=${encodeURIComponent(qrValue)}" />
        <b>${L.from} ${latest.start_date || '----'}<br/>${L.to} ${latest.end_date || '----'}</b>
        ${latest.schedule ? `<span>📅 ${translateSchedule(latest.schedule, lang)}</span>` : ''}${compact && member?.phone ? `<em>📱 ${member.phone}</em>` : ''}</div></div></div>`,
      back: `<div class="${compact ? 'cd-page back' : 'logo-card'}"><img src="${logo}" alt="شعار الأكاديمية" />${member?.branch_name ? `<b>${member.branch_name}</b>` : ''}${member?.branch_phone ? `<b dir="ltr">📞 ${member.branch_phone}</b>` : ''}</div>`,
      accent,
      L,
    };
  };

  const openPrint = async (mode, lang = printLang) => {
    const popup = window.open('', '_blank', 'width=800,height=600');
    if (!popup) {
      setError('تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');
      return;
    }
    const compact = mode !== 'stickers';
    const { front, back, accent, L } = buildCardMarkup(lang, compact);
    const pages = mode === 'single' ? front : front + back;
    popup.document.write(`<!doctype html><html><head><meta charset="UTF-8"><title>بطاقة العضوية - ${member?.member_code || ''}</title>
      <style>
        @page{size:${compact ? '54mm 85.6mm' : 'A4'};margin:0}*{box-sizing:border-box}body{margin:0;background:#e5e7eb;font-family:Tajawal,Arial,sans-serif;direction:${L.dir}}
        .toolbar{text-align:center;padding:14px;background:white}.toolbar button{padding:10px 24px;background:${accent};color:white;border:0;border-radius:8px;font-weight:bold;cursor:pointer}
        .print-area{display:${compact ? 'block' : 'flex'};gap:5mm;justify-content:center;padding:10mm}.card,.logo-card{width:60mm;height:95mm;background:white;border-radius:4mm;overflow:hidden;position:relative;box-shadow:0 3px 12px #0002}
        .cd-page{width:54mm;height:85.6mm;background:white;overflow:hidden;position:relative;page-break-after:always;padding:4mm 3mm 2.5mm}.cd-page:last-child{page-break-after:auto}
        .stripe{position:absolute;top:0;bottom:0;right:0;width:4mm;background:linear-gradient(#0b1f3a,#1e3a5f,#f5c842);display:flex;align-items:center;justify-content:center}
        .stripe span{writing-mode:vertical-rl;transform:rotate(180deg);color:white;font-size:6pt;font-weight:900;white-space:nowrap}.card-body{height:100%;padding:4mm 6mm 2mm 3mm;display:flex;flex-direction:column}
        .info{text-align:${L.align}}.info small,.activities small{font-size:7pt;color:#555}.info h2{font-size:${compact ? '12pt' : '11pt'};margin:1mm 0}.info p{font-size:8pt;margin:.7mm 0}.info strong{color:${accent};font-size:12pt}
        .activities{border-top:1px dashed #999;padding-top:1mm}.activity{font-size:${compact ? '9pt' : '7pt'};padding:.5mm 1mm;margin:.4mm 0;border-right:2px solid #111}.activity.active{background:${compact ? 'transparent' : '#d1fae5'}}.activity.expired{background:${compact ? 'transparent' : '#fee2e2'}}
        .qr{margin-top:auto;text-align:center;display:flex;flex-direction:column;align-items:center;font-size:7pt;font-style:normal}.qr img{width:${compact ? '18mm' : '26mm'};height:${compact ? '18mm' : '26mm'}}.qr span{color:${accent};font-weight:bold;font-size:6.5pt}.qr em{font-style:normal;font-weight:bold;font-size:7.5pt}
        .logo-card,.back{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3mm;gap:2mm}.logo-card img,.back img{width:100%;max-height:85%;object-fit:contain}.logo-card b,.back b{font-size:8pt}
        @media print{.toolbar{display:none}.print-area{padding:${compact ? '0' : '10mm'};box-shadow:none}.card,.logo-card,.cd-page{box-shadow:none}}
      </style></head><body><div class="toolbar"><button onclick="window.print()">🖨️ ${compact ? 'طباعة على Datacard CD820' : 'طباعة الملصقات'}</button></div><div class="print-area">${pages}</div></body></html>`);
    popup.document.close();
    setShowPrintDialog(false);
    await markCurrentPrinted();
  };

  const handleDownload = () => {
    const svg = document.getElementById('member-qr-code');
    if (!svg || !member) return;
    const img = new Image();
    const canvas = document.createElement('canvas');
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const context = canvas.getContext('2d');
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0);
      const link = document.createElement('a');
      link.download = `member-${member.member_code}-qr.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(svg))))}`;
  };

  const memberName = (member?.name_ar || member?.name || '')
    .split('+').map((name) => name.trim()).filter(Boolean).join(' - ');

  return (
    <Layout>
      <div className="bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8 min-h-[80vh]" dir="rtl">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">🏆 بطاقة العضوية</h1>
            <p className="text-gray-600">شركة اداء الابطال العالمية للرياضة العالمية</p>
          </div>

          <Card className="mb-6 shadow-lg">
            <CardContent className="p-6">
              <div className="flex gap-3">
                <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && searchMember()}
                  placeholder="رقم العضوية أو رقم الجوال أو الاسم" className="text-lg" dir="auto" />
                <Button onClick={searchMember} disabled={loading} className="bg-orange-500 hover:bg-orange-600 px-6">
                  {loading ? '...' : 'بحث'}
                </Button>
              </div>
              {error && <p className="text-red-500 mt-3 text-center">{error}</p>}
            </CardContent>
          </Card>

          {matches.length > 0 && (
            <Card className="mb-6 shadow-lg">
              <CardContent className="p-4">
                <p className="text-gray-700 font-bold mb-3 text-center">تم العثور على {matches.length} أعضاء — اختر العضو لعرض بطاقته</p>
                <div className="space-y-2">
                  {matches.map((match) => (
                    <button key={match.id} onClick={() => loadMember(match.member_code || match.id, 'حدث خطأ في عرض البطاقة')}
                      className="w-full flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 hover:bg-orange-50 text-right">
                      <span className="flex items-center gap-2 min-w-0"><User className="w-5 h-5 text-orange-500 shrink-0" /><span className="font-bold truncate">{match.name}</span></span>
                      <span className="text-sm text-gray-500 shrink-0">{match.member_code}{match.phone ? ` · ${match.phone}` : ''}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {member && (
            <div className="space-y-4">
              <Dialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
                <DialogContent className="max-w-lg" dir="rtl">
                  <DialogHeader><DialogTitle className="text-center text-xl">🖨️ طباعة بطاقة العضوية</DialogTitle></DialogHeader>
                  <div className="py-4">
                    <p className="text-center text-gray-600 mb-2 font-bold">{memberName}</p>
                    <p className="text-center text-sm text-orange-600 mb-4 font-bold">{member.member_code}</p>
                    <p className="text-center text-sm text-gray-500 mb-3">سيتم طباعة كرت العضوية + شعار الأكاديمية معاً</p>
                    <div className="flex justify-center mb-4">
                      <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-sm">
                        <button type="button" onClick={() => changePrintLang('ar')} className={`px-4 py-1.5 font-bold flex gap-1 ${printLang === 'ar' ? 'bg-orange-500 text-white' : 'bg-white text-gray-700'}`}><Languages className="w-3.5 h-3.5" />عربي</button>
                        <button type="button" onClick={() => changePrintLang('en')} className={`px-4 py-1.5 font-bold border-r border-gray-300 ${printLang === 'en' ? 'bg-orange-500 text-white' : 'bg-white text-gray-700'}`}>English</button>
                      </div>
                    </div>
                    <div className="bg-gray-100 p-4 rounded-lg">
                      <div className="flex gap-3 justify-center max-w-[360px] mx-auto">
                        <div className="aspect-[9/6] w-[140px] bg-white border-2 border-orange-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3">
                          <span className="text-3xl">📇</span><span className="text-sm font-bold text-gray-700">كرت العضوية</span><span className="text-xs text-orange-500">خانة 1</span>
                        </div>
                        <div className="aspect-[9/6] w-[140px] bg-white border-2 border-orange-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3">
                          <img src="/images/academy-logo.png" alt="شعار الأكاديمية" className="w-14 h-14 object-contain" />
                          <span className="text-sm font-bold text-gray-700">شعار الأكاديمية</span><span className="text-xs text-orange-500">خانة 2</span>
                        </div>
                      </div>
                      <p className="text-center text-xs text-gray-500 mt-3">📐 حجم كل كرت: 6سم × 9.5سم (عمودي)</p>
                    </div>
                    <div className="mt-4 flex flex-col gap-2 items-center">
                      <Button onClick={() => openPrint('stickers')} className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-3 text-lg w-full max-w-sm"><Printer className="w-5 h-5 ml-2" />طباعة على ورق A4 (ملصقات)</Button>
                      <div className="flex gap-2 w-full max-w-sm">
                        <Button onClick={() => openPrint('duplex')} className="bg-blue-600 hover:bg-blue-700 text-white flex-1">💳 CD820 وش وظهر</Button>
                        <Button onClick={() => openPrint('single')} variant="outline" className="border-blue-600 text-blue-700 hover:bg-blue-50 flex-1">💳 CD820 وش فقط</Button>
                      </div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              <Card className="shadow-2xl overflow-hidden" id="member-card">
                <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-4 text-white flex items-center justify-between">
                  <div><h2 className="text-xl font-bold">شركة اداء الابطال العالمية للرياضة</h2><p className="text-orange-100 text-sm">Global Champions Sports Performance</p></div>
                  <div className="text-4xl">🏆</div>
                </div>
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row gap-6 items-center">
                    <div className="flex flex-col items-center">
                      <div className="bg-white p-4 rounded-xl shadow-inner border-2 border-orange-100">
                        <QRCodeSVG id="member-qr-code" value={qrValue} size={180} level="H" includeMargin bgColor="#ffffff" fgColor="#000000" />
                      </div>
                      {member.activities?.length > 0 && (() => {
                        const active = member.activities.filter((activity) => activity?.end_date && new Date(activity.end_date) >= new Date());
                        const latest = [...(active.length ? active : member.activities)].sort((a, b) =>
                          new Date(b?.end_date || 0) - new Date(a?.end_date || 0))[0];
                        return <div className="mt-3 text-center">
                          <div className="text-lg font-bold text-gray-800"><span>من: {latest?.start_date || '----'}</span><span className="mx-2">|</span><span>إلى: {latest?.end_date || '----'}</span></div>
                          {latest?.schedule && <div className="mt-2 px-4 py-2 bg-orange-50 rounded-lg text-orange-600 font-semibold">📅 {latest.schedule}</div>}
                        </div>;
                      })()}
                    </div>
                    <div className="flex-1 space-y-4 text-right">
                       <div><p className="text-gray-500 text-sm">الاسم</p><p className="text-2xl font-bold text-gray-800">{memberName}</p></div>
                      <div className="flex items-center gap-3 justify-end"><div><p className="text-gray-500 text-sm">رقم العضوية</p><p className="text-xl font-bold text-orange-600">{member.member_code}</p></div><CreditCard className="w-8 h-8 text-orange-400" /></div>
                      <div className="flex items-center gap-3 justify-end"><div><p className="text-gray-500 text-sm">رقم الجوال</p><p className="text-lg font-medium text-gray-700" dir="ltr">{member.phone || '-'}</p></div><Phone className="w-6 h-6 text-gray-400" /></div>
                      {member.activities?.length > 0 && <div className="pt-3 border-t">
                        <p className="text-gray-500 text-sm mb-2">الأنشطة المسجلة</p>
                        <div className="flex flex-wrap gap-2 justify-end">{member.activities.map((activity, index) =>
                          <span key={index} className={`px-3 py-1 rounded-full text-sm ${activity.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {activity.status === 'active' ? <CheckCircle className="w-4 h-4 inline ml-1" /> : <XCircle className="w-4 h-4 inline ml-1" />}{activity.activity_name}
                          </span>)}
                        </div>
                      </div>}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="text-center p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600 font-semibold text-sm">⚠️ في حال فقدان كرت العضوية، يتم إصدار كرت جديد برسوم 10 ر.س</p>
              </div>

              <div className="flex gap-3 justify-center">
                <Button onClick={() => setShowPrintDialog(true)} variant="outline" className="gap-2"><Printer className="w-4 h-4" />طباعة البطاقة</Button>
                <Button onClick={handleDownload} variant="outline" className="gap-2"><Download className="w-4 h-4" />تحميل QR</Button>
              </div>
            </div>
          )}

          {!member && !error && <Card className="bg-white/50 border-dashed"><CardContent className="p-8 text-center text-gray-500"><User className="w-16 h-16 mx-auto mb-4 text-gray-300" /><p className="text-lg">ابحث عن العضو لعرض بطاقته</p></CardContent></Card>}
        </div>
      </div>
    </Layout>
  );
};

export default MemberCardPage;