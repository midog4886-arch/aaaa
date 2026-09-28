import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import MemberLayout, { memberAPI } from './MemberLayout';
import LevelCertificateSheet from '../../components/levels/LevelCertificateSheet';
import LevelCertificateSeal from '../../components/levels/LevelCertificateSeal';

export default function MemberCertificates({ verification = false }) {
  const { certificateId } = useParams();
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const call = verification
      ? axios.get(`/api/level-certificates/verify/${encodeURIComponent(certificateId)}`)
      : memberAPI.get('/api/level-certificates/member/mine');
    call.then(({ data }) => { if (active) { setRows(verification ? [data] : data); setSelected(verification ? data : data[0] || null); } })
      .catch(() => { if (active) setError(verification ? 'الشهادة غير موجودة أو غير صادرة' : 'تعذّر تحميل الشهادات'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [certificateId, verification]);

  const content = <div className="max-w-5xl mx-auto p-4" dir="rtl">
    <h1 className="text-2xl font-bold mb-2">{verification ? 'التحقق من شهادة اجتياز المستوى' : 'شهاداتي'}</h1>
    <p className="text-gray-500 mb-5">{verification ? 'بيانات الشهادة الصادرة من أكاديمية أداء الأبطال' : 'الشهادات المعتمدة متاحة للعرض والطباعة في أي وقت.'}</p>
    {loading && <p>جارٍ التحميل...</p>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {!loading && !error && !rows.length && <p>لا توجد شهادات صادرة حتى الآن.</p>}
    {rows.length > 1 && <div className="flex flex-wrap gap-2 mb-5">{rows.map(row => <button key={row.id} onClick={() => setSelected(row)}
      className={`border rounded-lg px-3 py-2 text-sm ${selected?.id === row.id ? 'bg-purple-700 text-white' : 'bg-white text-purple-700'}`}>
      {row.activity_name} · مستوى {row.to_level_number}</button>)}</div>}
    {selected && <><LevelCertificateSheet certificate={selected} />
      <div className="mt-4 p-4 rounded-xl border bg-white text-sm flex flex-wrap items-center gap-5">
        <div><strong>بيانات الشهادة</strong><p>{selected.activity_name} · اجتياز المستوى {selected.from_level_number} والانتقال إلى {selected.to_level_number}</p><p>رقم الشهادة: <span dir="ltr">{selected.id}</span></p></div>
        <div className="ms-auto"><QRCodeSVG value={`${window.location.origin}/certificate/verify/${encodeURIComponent(selected.id)}`} size={78} /><small className="block text-center">التحقق</small></div>
      </div>
      <LevelCertificateSeal certificate={selected} />
      <div className="mt-4 flex gap-3">
      <button className="bg-purple-700 text-white px-5 py-3 rounded-xl" onClick={() => window.print()}>طباعة / حفظ PDF</button>
      {!verification && <a className="border px-5 py-3 rounded-xl" href={`/certificate/verify/${encodeURIComponent(selected.id)}`} target="_blank" rel="noopener noreferrer">رابط التحقق</a>}
    </div></>}
  </div>;
  return verification ? <main className="min-h-screen bg-gray-50">{content}</main> : <MemberLayout>{content}</MemberLayout>;
}
