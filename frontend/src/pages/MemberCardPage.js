import React, { useState } from 'react';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';
import { CreditCard, Download, Languages, Printer, User } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { membersAPI } from '../services/api';
import { getAcademyLogoUrl, getAcademyName } from '../services/branding';
import { getMemberQRValue } from '../utils/memberQR';
import { getPrintLang, setPrintLang } from '../utils/printLang';
import { getPermanentMemberCardDetails, openPermanentMemberCardPrint } from '../utils/permanentMemberCard';

const API_URL = '';
const FALLBACK_ACADEMY_NAME = 'شركة اداء الابطال العالمية للرياضة';

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

  const printCard = async () => {
    const popup = openPermanentMemberCardPrint({
      member,
      qrValue,
      logoUrl: getAcademyLogoUrl(),
      academyName: getAcademyName() || FALLBACK_ACADEMY_NAME,
      branchName: member?.branch_name || '',
      branchPhone: member?.branch_phone || '',
      language: printLang === 'en' ? 'en' : 'ar',
    });
    if (!popup) {
      setError('تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');
      return;
    }
    setShowPrintDialog(false);
    // Recording is only attempted after a physical-card print window opens.
    try {
      if (member?.id) await membersAPI.markPrinted([member.id]);
    } catch (_error) {
      // Printing itself remains available if the audit update is unavailable.
    }
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
  const { activityNames, guardianPhone } = getPermanentMemberCardDetails(member || {});

  return (
    <Layout>
      <div className="bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8 min-h-[80vh]" dir="rtl">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">🏆 بطاقة العضوية</h1>
            <p className="text-gray-600">بطاقة دائمة للتعريف بالعضو وتسجيل الحضور</p>
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
                    <p className="text-center text-sm text-gray-500 mb-3">ستتم طباعة وجهي بطاقة عضوية دائمة (وجه وظهر)</p>
                    <div className="flex justify-center mb-4">
                      <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-sm">
                        <button type="button" onClick={() => changePrintLang('ar')} className={`px-4 py-1.5 font-bold flex gap-1 ${printLang === 'ar' ? 'bg-orange-500 text-white' : 'bg-white text-gray-700'}`}><Languages className="w-3.5 h-3.5" />عربي</button>
                        <button type="button" onClick={() => changePrintLang('en')} className={`px-4 py-1.5 font-bold border-r border-gray-300 ${printLang === 'en' ? 'bg-orange-500 text-white' : 'bg-white text-gray-700'}`}>English</button>
                      </div>
                    </div>
                    <div className="bg-gray-100 p-4 rounded-lg">
                      <div className="flex justify-center gap-3">
                        <div className="aspect-[54/85.6] w-[115px] bg-white border-2 border-orange-400 rounded-lg flex flex-col items-center justify-center gap-3 p-3 text-center">
                          <p className="text-sm font-bold text-gray-700">الوجه</p><p className="text-xs text-gray-500">الاسم · رقم العضوية · النشاط · جوال ولي الأمر · QR</p>
                        </div>
                        <div className="aspect-[54/85.6] w-[115px] bg-white border-2 border-orange-400 rounded-lg flex flex-col items-center justify-center gap-3 p-3 text-center">
                          <img src={getAcademyLogoUrl()} alt="شعار الأكاديمية" className="w-12 h-12 object-contain" />
                          <p className="text-xs text-gray-500">الظهر · الشعار ورقم التواصل</p>
                        </div>
                      </div>
                      <p className="text-center text-xs text-gray-500 mt-3">بطاقة طولية CR-80 بوجه وظهر، بلا تواريخ اشتراك أو حصص</p>
                    </div>
                    <div className="mt-4 flex justify-center">
                      <Button onClick={printCard} className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-3 text-lg"><Printer className="w-5 h-5 ml-2" />طباعة البطاقة</Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              <Card className="shadow-2xl overflow-hidden" id="member-card">
                <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-4 text-white flex items-center justify-between">
                  <div><h2 className="text-xl font-bold">{getAcademyName() || FALLBACK_ACADEMY_NAME}</h2><p className="text-orange-100 text-sm">Membership Card</p></div>
                  <img src={getAcademyLogoUrl()} alt="" className="w-12 h-12 object-contain bg-white rounded-full p-1" />
                </div>
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row gap-6 items-center">
                    <div className="bg-white p-4 rounded-xl shadow-inner border-2 border-orange-100">
                      <QRCodeSVG id="member-qr-code" value={qrValue} size={180} level="H" includeMargin bgColor="#ffffff" fgColor="#000000" />
                    </div>
                    <div className="flex-1 space-y-4 text-right">
                       <div><p className="text-gray-500 text-sm">الاسم</p><p className="text-2xl font-bold text-gray-800">{memberName}</p></div>
                      <div className="flex items-center gap-3 justify-end"><div><p className="text-gray-500 text-sm">رقم العضوية</p><p className="text-xl font-bold text-orange-600">{member.member_code}</p></div><CreditCard className="w-8 h-8 text-orange-400" /></div>
                       <div>
                         <p className="text-gray-500 text-sm">النشاط</p>
                         <p className="font-bold text-gray-800">{activityNames.join(' · ') || 'لا يوجد نشاط مسجل'}</p>
                       </div>
                       <div>
                         <p className="text-gray-500 text-sm">جوال ولي الأمر</p>
                         <p className="font-bold text-gray-800" dir="ltr">{guardianPhone || '—'}</p>
                       </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

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