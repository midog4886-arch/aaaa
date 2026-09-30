import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { Award, Download, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import LevelCertificateSheet from '../components/levels/LevelCertificateSheet';
import './CertificatesPage.css';

const asSheet = item => ({ member_name: item.student_name_ar, member_name_en: item.student_name_en, issued_at: item.issued_at });

export default function CertificatesPage() {
  const { selectedBranchId, user } = useAuth();
  const branchFilter = selectedBranchId && selectedBranchId !== 'all' ? selectedBranchId : null;
  const needsBranch = Boolean(user?.is_admin && !branchFilter);
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState([]);
  const [linkedMember, setLinkedMember] = useState(null);
  const [issued, setIssued] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [linking, setLinking] = useState(false);
  const sheetRef = useRef(null);

  useEffect(() => {
    axios.get('/api/certificates').then(({ data }) => setIssued(data)).catch(() => toast.error('تعذر تحميل الشهادات')).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (linkedMember || needsBranch || memberSearch.trim().length < 2) { setMemberResults([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      axios.get('/api/certificates/member-search', { params: { search: memberSearch.trim(), ...(branchFilter ? { branch_filter: branchFilter } : {}) }, signal: controller.signal })
        .then(({ data }) => setMemberResults(data))
        .catch(error => { if (error.code !== 'ERR_CANCELED') toast.error('تعذر البحث عن الأعضاء'); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [memberSearch, linkedMember, branchFilter, needsBranch]);

  useEffect(() => {
    setLinkedMember(null);
    setMemberSearch('');
    setMemberResults([]);
  }, [selectedBranchId]);

  const create = async (event) => {
    event.preventDefault();
    if (!/[\u0600-\u06ff]/.test(nameAr) || !/[A-Za-z]/.test(nameEn) || /[\u0600-\u06ff]/.test(nameEn)) {
      toast.error('أدخل الاسم بالعربية والإنجليزية');
      return;
    }
    setSaving(true);
    try {
      const { data } = await axios.post('/api/certificates', { student_name_ar: nameAr.trim(), student_name_en: nameEn.trim(), member_id: linkedMember?.id || null, branch_filter: branchFilter });
      setIssued(current => [data, ...current]);
      setSelected(data);
      setNameAr('');
      setNameEn('');
      setLinkedMember(null);
      setMemberSearch('');
      toast.success('صدرت الشهادة، ويمكنك حفظها PDF أو طباعتها الآن');
    } catch (error) {
      toast.error(error.response?.data?.detail?.[0]?.msg || error.response?.data?.detail || 'تعذر إصدار الشهادة');
    } finally {
      setSaving(false);
    }
  };

  const preview = selected || { student_name_ar: nameAr, student_name_en: nameEn };

  const linkSelected = async () => {
    if (!selected || !linkedMember || linking) return;
    setLinking(true);
    try {
      const { data } = await axios.patch(`/api/certificates/${encodeURIComponent(selected.id)}/member`, {
        member_id: linkedMember.id, branch_filter: branchFilter,
      });
      setIssued(current => current.map(item => item.id === data.id ? data : item));
      setSelected(data);
      setLinkedMember(null);
      toast.success('تم ربط الشهادة بالعضو وستظهر في تطبيقه');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'تعذر ربط الشهادة بالعضو');
    } finally {
      setLinking(false);
    }
  };

  const savePdf = async () => {
    if (!selected || !sheetRef.current || downloading) return;
    setDownloading(true);
    try {
      const image = sheetRef.current.querySelector('img');
      if (image && !image.complete) await new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', reject, { once: true });
      });
      if (!image?.naturalWidth) throw new Error('Certificate artwork did not load');
      const canvas = await html2canvas(sheetRef.current, {
        backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false,
        windowWidth: 1600,
        onclone: clonedDocument => {
          const sheet = clonedDocument.querySelector('[data-certificate-export] .level-certificate-sheet');
          sheet.style.width = '1402px';
          sheet.style.height = '1122px';
          sheet.querySelector('strong').style.fontSize = '29px';
          sheet.querySelector('span').style.fontSize = '17px';
        },
      });
      const pageWidth = 297;
      const pageHeight = pageWidth * 1122 / 1402;
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [pageWidth, pageHeight] });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidth, pageHeight);
      pdf.save(`certificate-${selected.id}.pdf`);
    } catch (error) {
      toast.error('تعذر حفظ ملف PDF. حاول مجددًا.');
    } finally {
      setDownloading(false);
    }
  };

  return <Layout title="الشهادات">
    <div className="certificates-page" dir="rtl">
      <div className="certificates-heading">
        <div><h1><Award size={27} /> الشهادات</h1><p>أدخل الاسم بالعربية والإنجليزية، ويمكنك ربط الشهادة بعضو اختياريًا. لا يلزم اختيار مستوى.</p></div>
      </div>
      <div className="certificates-grid">
        <section className="certificates-panel">
          <h2>إصدار شهادة جديدة</h2>
          <form onSubmit={create}>
            <Label htmlFor="certificate-member-search">ربط بعضو (اختياري)</Label>
            {linkedMember ? <div className="certificates-linked-member"><span>{linkedMember.name_ar || linkedMember.name} {linkedMember.member_code ? `— ${linkedMember.member_code}` : ''}</span><Button type="button" variant="outline" onClick={() => { setLinkedMember(null); setMemberSearch(''); setSelected(null); }}>إلغاء الربط</Button></div> : <>
              <Input id="certificate-member-search" value={memberSearch} onChange={e => setMemberSearch(e.target.value)} placeholder={needsBranch ? 'اختر الفرع أولاً' : 'ابحث بالاسم أو رقم العضوية'} disabled={needsBranch} autoComplete="off" />
              {memberResults.length > 0 && <div className="certificates-member-results">{memberResults.map(member => <button type="button" key={member.id} onClick={() => { setLinkedMember(member); setMemberSearch(''); setMemberResults([]); setNameAr(member.name_ar || ''); setNameEn(/^[\x00-\x7F]+$/.test(member.name || '') ? member.name : ''); }}>{member.name_ar || member.name} {member.member_code ? <small>{member.member_code}</small> : null}</button>)}</div>}
            </>}
            <Label htmlFor="certificate-name-ar">اسم الطالب بالعربية</Label>
            <Input id="certificate-name-ar" value={nameAr} onChange={e => { setNameAr(e.target.value); setSelected(null); }} placeholder="اسم الطالب بالعربية" required minLength={2} maxLength={120} autoComplete="off" />
            <Label htmlFor="certificate-name-en">اسم الطالب بالإنجليزية</Label>
            <Input id="certificate-name-en" value={nameEn} onChange={e => { setNameEn(e.target.value); setSelected(null); }} placeholder="Student name in English" required minLength={2} maxLength={120} dir="ltr" autoComplete="off" />
            <Button type="submit" disabled={saving}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} إصدار الشهادة</Button>
          </form>
          {selected && <div className="certificates-issued"><span>الشهادة جاهزة: {selected.student_name_ar}</span>{selected.member_id ? <span>مرتبطة بعضو {selected.member_code || ''} وتظهر في تطبيقه</span> : <span>غير مرتبطة بعضو، ولن تظهر في تطبيق العضو</span>}{linkedMember && linkedMember.id !== selected.member_id && <Button type="button" variant="outline" onClick={linkSelected} disabled={linking}>{linking && <Loader2 size={16} className="animate-spin" />} {selected.member_id ? 'نقل ربط الشهادة إلى العضو المحدد' : 'ربط الشهادة الحالية بالعضو المحدد'}</Button>}<Button type="button" onClick={savePdf} disabled={downloading}>{downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} حفظ PDF</Button><Button type="button" variant="outline" onClick={() => window.print()}><Printer size={16} /> طباعة الشهادة</Button></div>}
        </section>
        <section className="certificates-panel certificates-preview">
          <div className="certificates-preview-header"><h2>معاينة الشهادة</h2><span>الاسم وتاريخ الإصدار</span></div>
          <div data-certificate-export><LevelCertificateSheet ref={sheetRef} certificate={asSheet(preview)} /></div>
        </section>
      </div>
      <section className="certificates-panel certificates-history">
        <h2>الشهادات الصادرة</h2>
        {loading ? <p>جارٍ التحميل…</p> : issued.length === 0 ? <p>لا توجد شهادات صادرة بعد.</p> : <div className="certificates-list">{issued.map(item => <button key={item.id} type="button" onClick={() => setSelected(item)} className={selected?.id === item.id ? 'active' : ''}><strong>{item.student_name_ar}</strong><span dir="ltr">{item.student_name_en}</span>{item.member_id && <span className="certificates-member-badge">عضو {item.member_code || 'مرتبط'}</span>}<small>{new Date(item.issued_at).toLocaleDateString('ar-SA')}</small><Printer size={17} /></button>)}</div>}
      </section>
    </div>
  </Layout>;
}
