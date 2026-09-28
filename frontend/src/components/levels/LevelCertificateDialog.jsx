import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import LevelCertificateSheet from './LevelCertificateSheet';
import LevelCertificateSeal from './LevelCertificateSeal';

export default function LevelCertificateDialog({ open, onOpenChange, member }) {
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [nameEn, setNameEn] = useState('');
  const [issued, setIssued] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !member?.id) return;
    let active = true;
    setCandidates([]); setSelected(null); setIssued(null); setError(''); setNameEn(''); setLoading(true);
    axios.get(`/api/level-certificates/candidates/${encodeURIComponent(member.id)}`)
      .then(({ data }) => { if (active) { setCandidates(data); setSelected(data[0] || null); setNameEn(data[0]?.member_name_en || ''); } })
      .catch(e => { if (active) setError(e.response?.data?.detail || 'تعذّر تحميل الترقيات'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, member?.id]);

  useEffect(() => {
    if (!selected?.certificate_id) return;
    let active = true;
    axios.get(`/api/level-certificates/verify/${encodeURIComponent(selected.certificate_id)}`)
      .then(({ data }) => { if (active) setIssued(data); })
      .catch(() => { if (active) setError('تعذّر تحميل الشهادة الصادرة'); });
    return () => { active = false; };
  }, [selected?.certificate_id]);

  const issue = async () => {
    if (!selected || loading) return;
    if (!nameEn.trim()) { setError('أدخل اسم اللاعب بالإنجليزية قبل الإصدار'); return; }
    setLoading(true); setError('');
    try {
      const { data } = await axios.post('/api/level-certificates', {
        transfer_audit_id: selected.transfer_audit_id, member_name_en: nameEn.trim(),
      });
      setIssued(data);
      setCandidates(prev => prev.map(item => item.transfer_audit_id === selected.transfer_audit_id
        ? { ...item, certificate_id: data.id } : item));
    } catch (e) { setError(e.response?.data?.detail || 'تعذّر إصدار الشهادة'); }
    finally { setLoading(false); }
  };

  const certificate = issued || (selected ? { ...selected, member_name_en: nameEn } : null);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl">
      <DialogHeader><DialogTitle>شهادة اجتياز المستوى</DialogTitle></DialogHeader>
      <p className="text-sm text-gray-600">الصورة الأصلية للشهادة محفوظة كما هي. يُضاف اسم اللاعب بالعربية والإنجليزية فقط، ثم تصدر الشهادة بعد مراجعة الترقية.</p>
      {loading && !selected && <p>جارٍ تحميل الترقيات...</p>}
      {!loading && !error && candidates.length === 0 && <p className="text-amber-700">لا توجد ترقية موثقة إلى مستوى أعلى لهذا اللاعب.</p>}
      {candidates.length > 0 && <label className="block text-sm">الترقية
        <select className="block w-full border rounded-lg p-2 mt-1" value={selected?.transfer_audit_id || ''}
          onChange={e => { const next = candidates.find(x => x.transfer_audit_id === e.target.value); setSelected(next); setNameEn(next?.member_name_en || ''); setIssued(null); }}>
          {candidates.map(row => <option key={row.transfer_audit_id} value={row.transfer_audit_id}>
            {row.activity_name}: المستوى {row.from_level_number} ← المستوى {row.to_level_number}{row.certificate_id ? ' · صادرة' : ''}
          </option>)}
        </select>
      </label>}
      {selected && <>
        <div className="rounded-lg bg-gray-50 p-3 text-sm">{selected.activity_name} · المستوى {selected.from_level_number} ← المستوى {selected.to_level_number}<br />اسم اللاعب بالعربية: {selected.member_name}</div>
        {!selected.certificate_id && <label className="block text-sm">اسم اللاعب بالإنجليزية *
          <input className="block w-full border rounded-lg p-2 mt-1" maxLength={120} value={nameEn} onChange={e => setNameEn(e.target.value)} placeholder="Player name in English" />
        </label>}
        <LevelCertificateSheet certificate={certificate} />
        <LevelCertificateSeal certificate={issued} />
        {selected.certificate_id && !issued && <p className="text-green-700 text-sm">هذه الترقية لها شهادة صادرة بالفعل. يمكن فتحها من بوابة العضو.</p>}
        <div className="flex gap-2">
          {!selected.certificate_id && <Button onClick={issue} disabled={loading}>{loading ? 'جارٍ الإصدار...' : 'اعتماد وإصدار الشهادة'}</Button>}
          {issued && <Button variant="outline" onClick={() => window.print()}>طباعة / حفظ PDF</Button>}
        </div>
      </>}
      {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
    </DialogContent>
  </Dialog>;
}
