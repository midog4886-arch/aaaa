import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import MemberLayout, { memberAPI } from './MemberLayout';
import LevelCertificateSheet from '../../components/levels/LevelCertificateSheet';
import { QRCodeSVG } from 'qrcode.react';

export default function MemberCertificates({ verification = false }) {
  const { certificateId } = useParams();
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pdf, setPdf] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const sheetRef = useRef(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const call = verification
      ? axios.get(`/api/level-certificates/verify/${encodeURIComponent(certificateId)}`)
      : Promise.all([
          memberAPI.get('/api/level-certificates/member/mine'),
          memberAPI.get('/api/certificates/member/mine'),
        ]);
    call.then(result => {
      if (!active) return;
      const certificates = verification
        ? [{ ...result.data, kind: 'level' }]
        : [
            ...result[0].data.map(item => ({ ...item, kind: 'level' })),
            ...result[1].data.map(item => ({ ...item, kind: 'manual' })),
          ].sort((a, b) => (b.issued_at || '').localeCompare(a.issued_at || ''));
      setRows(certificates);
      setSelected(certificates[0] || null);
    })
      .catch(() => { if (active) setError(verification ? 'الشهادة غير موجودة أو غير صادرة' : 'تعذّر تحميل الشهادات'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [certificateId, verification]);

  useEffect(() => {
    if (!selected || !sheetRef.current) return;
    let cancelled = false;
    let url = null;
    setPdf(null);
    setPdfError('');
    setPdfLoading(true);
    const buildPdf = async () => {
      try {
        const images = [...sheetRef.current.querySelectorAll('img')];
        await Promise.all(images.map(image => image.decode()));
        if (images.some(image => !image.naturalWidth)) throw new Error('Artwork failed to load');
        if (document.fonts?.ready) await document.fonts.ready;
        if (cancelled) return;
        const canvas = await html2canvas(sheetRef.current, {
          backgroundColor: '#ffffff', scale: 1.5, useCORS: true, logging: false,
          windowWidth: 1600,
          onclone: doc => {
            const sheet = doc.querySelector('.level-certificate-sheet');
            sheet.style.width = '1402px';
            sheet.style.height = '1122px';
            sheet.querySelector('strong').style.fontSize = '29px';
            sheet.querySelector('span').style.fontSize = '17px';
          },
        });
        const output = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [297, 237.7] });
        output.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 237.7);
        url = URL.createObjectURL(output.output('blob'));
        if (!cancelled) setPdf({ id: selected.id, url });
        else URL.revokeObjectURL(url);
      } catch (err) {
        if (!cancelled) setPdfError('تعذر تجهيز PDF للشهادة. حدّث الصفحة وحاول مجددًا.');
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    };
    buildPdf();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [selected]);

  const pdfUrl = pdf && selected && pdf.id === selected.id ? pdf.url : null;

  const content = <div className="max-w-5xl mx-auto p-4" dir="rtl">
    <h1 className="text-2xl font-bold mb-2">{verification ? 'التحقق من شهادة اجتياز المستوى' : 'شهاداتي'}</h1>
    <p className="text-gray-500 mb-5">{verification ? 'بيانات الشهادة الصادرة من أكاديمية أداء الأبطال' : 'الشهادات المعتمدة متاحة للعرض والطباعة في أي وقت.'}</p>
    {loading && <p>جارٍ التحميل...</p>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {!loading && !error && !rows.length && <p>لا توجد شهادات صادرة حتى الآن.</p>}
    {rows.length > 1 && <div className="flex flex-wrap gap-2 mb-5">{rows.map(row => <button key={`${row.kind}-${row.id}`} onClick={() => setSelected(row)}
      className={`border rounded-lg px-3 py-2 text-sm ${selected?.id === row.id ? 'bg-purple-700 text-white' : 'bg-white text-purple-700'}`}>
      {row.kind === 'manual' ? `شهادة ${row.student_name_ar}` : `${row.activity_name} · مستوى ${row.to_level_number}`}
      <small className="block text-xs opacity-75" dir="ltr">{row.issued_at ? new Date(row.issued_at).toLocaleDateString('en-GB') : ''} · #{row.id.slice(0, 8)}</small></button>)}</div>}
    {selected && <><LevelCertificateSheet ref={sheetRef} certificate={selected.kind === 'manual' ? { member_name: selected.student_name_ar, member_name_en: selected.student_name_en, issued_at: selected.issued_at, artwork: selected.artwork } : selected} />
      <div className="mt-4 p-4 rounded-xl border bg-white text-sm flex flex-wrap items-center gap-5">
        <div><strong>بيانات الشهادة</strong><p>{selected.kind === 'manual' ? 'شهادة صادرة من أكاديمية أداء الأبطال' : `${selected.activity_name} · اجتياز المستوى ${selected.from_level_number} والانتقال إلى ${selected.to_level_number}`}</p><p>رقم الشهادة: <span dir="ltr">{selected.id}</span></p></div>
        {selected.kind === 'level' && <div className="ms-auto"><QRCodeSVG value={`${window.location.origin}/certificate/verify/${encodeURIComponent(selected.id)}`} size={78} /><small className="block text-center">التحقق</small></div>}
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
      {pdfLoading && <span role="status" className="text-sm text-gray-500">جارٍ تجهيز PDF…</span>}
      {pdfError && <span role="alert" className="text-sm text-red-600">{pdfError}</span>}
      {pdfUrl && <><a className="bg-purple-700 text-white px-5 py-3 rounded-xl" href={pdfUrl} download={`certificate-${selected.id}.pdf`}>حفظ PDF</a>
        <a className="border border-purple-700 text-purple-700 px-5 py-3 rounded-xl" href={pdfUrl} target="_blank" rel="noopener noreferrer">فتح PDF للطباعة</a></>}
      {!verification && selected.kind === 'level' && <a className="border px-5 py-3 rounded-xl" href={`/certificate/verify/${encodeURIComponent(selected.id)}`} target="_blank" rel="noopener noreferrer">رابط التحقق</a>}
    </div>{pdfUrl && <p className="mt-2 text-xs text-gray-500">على iPhone: افتح PDF ثم اختر مشاركة لحفظه في الملفات أو طباعته.</p>}</>}
  </div>;
  return verification ? <main className="min-h-screen bg-gray-50">{content}</main> : <MemberLayout>{content}</MemberLayout>;
}
