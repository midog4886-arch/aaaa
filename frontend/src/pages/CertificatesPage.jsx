import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Award, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '../components/Layout';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import LevelCertificateSheet from '../components/levels/LevelCertificateSheet';
import './CertificatesPage.css';

const asSheet = item => ({ member_name: item.student_name_ar, member_name_en: item.student_name_en });

export default function CertificatesPage() {
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [issued, setIssued] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios.get('/api/certificates').then(({ data }) => setIssued(data)).catch(() => toast.error('تعذر تحميل الشهادات')).finally(() => setLoading(false));
  }, []);

  const create = async (event) => {
    event.preventDefault();
    if (!/[\u0600-\u06ff]/.test(nameAr) || !/[A-Za-z]/.test(nameEn) || /[\u0600-\u06ff]/.test(nameEn)) {
      toast.error('أدخل الاسم بالعربية والإنجليزية');
      return;
    }
    setSaving(true);
    try {
      const { data } = await axios.post('/api/certificates', { student_name_ar: nameAr.trim(), student_name_en: nameEn.trim() });
      setIssued(current => [data, ...current]);
      setSelected(data);
      setNameAr('');
      setNameEn('');
      toast.success('صدرت الشهادة، ويمكنك طباعتها الآن');
    } catch (error) {
      toast.error(error.response?.data?.detail?.[0]?.msg || error.response?.data?.detail || 'تعذر إصدار الشهادة');
    } finally {
      setSaving(false);
    }
  };

  const preview = selected || { student_name_ar: nameAr, student_name_en: nameEn };

  return <Layout title="الشهادات">
    <div className="certificates-page" dir="rtl">
      <div className="certificates-heading">
        <div><h1><Award size={27} /> الشهادات</h1><p>أدخل الاسم بالعربية والإنجليزية، ثم أصدر الشهادة مباشرة. لا يلزم اختيار عضو أو مستوى.</p></div>
      </div>
      <div className="certificates-grid">
        <section className="certificates-panel">
          <h2>إصدار شهادة جديدة</h2>
          <form onSubmit={create}>
            <Label htmlFor="certificate-name-ar">اسم الطالب بالعربية</Label>
            <Input id="certificate-name-ar" value={nameAr} onChange={e => { setNameAr(e.target.value); setSelected(null); }} placeholder="اسم الطالب بالعربية" required minLength={2} maxLength={120} autoComplete="off" />
            <Label htmlFor="certificate-name-en">اسم الطالب بالإنجليزية</Label>
            <Input id="certificate-name-en" value={nameEn} onChange={e => { setNameEn(e.target.value); setSelected(null); }} placeholder="Student name in English" required minLength={2} maxLength={120} dir="ltr" autoComplete="off" />
            <Button type="submit" disabled={saving}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} إصدار الشهادة</Button>
          </form>
          {selected && <div className="certificates-issued"><span>الشهادة جاهزة: {selected.student_name_ar}</span><Button type="button" onClick={() => window.print()}><Printer size={16} /> طباعة الشهادة</Button></div>}
        </section>
        <section className="certificates-panel certificates-preview">
          <div className="certificates-preview-header"><h2>معاينة الشهادة</h2><span>التصميم الأصلي مع الاسم فقط</span></div>
          <LevelCertificateSheet certificate={asSheet(preview)} />
        </section>
      </div>
      <section className="certificates-panel certificates-history">
        <h2>الشهادات الصادرة</h2>
        {loading ? <p>جارٍ التحميل…</p> : issued.length === 0 ? <p>لا توجد شهادات صادرة بعد.</p> : <div className="certificates-list">{issued.map(item => <button key={item.id} type="button" onClick={() => setSelected(item)} className={selected?.id === item.id ? 'active' : ''}><strong>{item.student_name_ar}</strong><span dir="ltr">{item.student_name_en}</span><small>{new Date(item.issued_at).toLocaleDateString('ar-SA')}</small><Printer size={17} /></button>)}</div>}
      </section>
    </div>
  </Layout>;
}
