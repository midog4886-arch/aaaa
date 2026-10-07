import React, { useMemo, useState } from 'react';
import { Copy, Download, Search, Trash2, WandSparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { displayPhone, extractPhoneNumbers, filterPhoneNumbers } from '../utils/phoneNumberFormatter';
import { createCampaignPhoneWorkbook } from '../utils/campaignPhoneWorkbook';

export default function CampaignPhoneFormatter({ t, onUse }) {
  const [source, setSource] = useState('');
  const [numbers, setNumbers] = useState([]);
  const [duplicates, setDuplicates] = useState(0);
  const [invalid, setInvalid] = useState(0);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [separator, setSeparator] = useState('comma');
  const filtered = useMemo(() => filterPhoneNumbers(numbers, search), [numbers, search]);
  const output = numbers.map(displayPhone).join(separator === 'line' ? '\n' : ', ');

  const convert = () => {
    const result = extractPhoneNumbers(source);
    setNumbers(result.numbers);
    setDuplicates(result.duplicates);
    setInvalid(result.invalid);
    setSelected(new Set());
    setSearch('');
    if (!result.numbers.length) toast.error(t('لم أجد أرقام جوال صالحة في النص', 'No valid mobile numbers found'));
  };
  const remove = phone => {
    setNumbers(old => old.filter(value => value !== phone));
    setSelected(old => { const next = new Set(old); next.delete(phone); return next; });
  };
  const copy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      toast.success(t('تم نسخ الأرقام', 'Numbers copied'));
    } catch (_) {
      toast.error(t('تعذر النسخ التلقائي؛ حدّد النص من المربع وانسخه يدويًا', 'Automatic copy failed; select and copy the output manually'));
    }
  };
  const download = async () => {
    if (!numbers.length) return;
    try {
      const data = await createCampaignPhoneWorkbook(numbers, t('رقم الجوال', 'Phone number'));
      const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `campaign-numbers-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(t('تم تجهيز ملف Excel للتنزيل', 'Excel file is ready to download'));
    } catch (_) {
      toast.error(t('تعذر إنشاء ملف Excel', 'Could not create the Excel file'));
    }
  };

  return <div className="space-y-4">
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><WandSparkles className="w-5 h-5 text-orange-500" />{t('تحويل أرقام الحملات', 'Campaign number formatter')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('الصق الأرقام كما هي، حتى لو اختلطت بأسماء أو كانت في سطر واحد. تدعم الأداة الصيغ السعودية والمصرية، وتحذف التكرار دون إرسال أي رسالة.', 'Paste numbers even when mixed with names or on one line. Saudi and Egyptian formats are supported; duplicates are removed without sending messages.')}</p>
        <Textarea dir="auto" value={source} onChange={event => setSource(event.target.value)} rows={6} placeholder={t('الصق الأرقام هنا…', 'Paste numbers here…')} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={convert} disabled={!source.trim()}><WandSparkles className="w-4 h-4 me-1" />{t('تحويل الأرقام', 'Format numbers')}</Button>
          <Button variant="outline" onClick={() => { setSource(''); setNumbers([]); setDuplicates(0); setInvalid(0); setSelected(new Set()); setSearch(''); }} disabled={!source && !numbers.length}>{t('مسح الكل', 'Clear all')}</Button>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle className="text-base">{t('الأرقام الناتجة', 'Formatted numbers')} · {numbers.length}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t(`تم حذف ${duplicates} مكرر · مقاطع غير صالحة: ${invalid}`, `${duplicates} duplicate(s) removed · invalid fragments: ${invalid}`)}</p>
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-sm font-medium" htmlFor="phone-format-separator">{t('شكل النسخ', 'Copy format')}</label>
          <select id="phone-format-separator" className="rounded border bg-white px-3 py-2 text-sm" value={separator} onChange={event => setSeparator(event.target.value)}>
            <option value="comma">{t('مفصولة بفواصل مثل الصورة', 'Comma-separated like the image')}</option>
            <option value="line">{t('رقم في كل سطر', 'One per line')}</option>
          </select>
          <Button variant="outline" onClick={copy} disabled={!numbers.length}><Copy className="w-4 h-4 me-1" />{t('نسخ الأرقام', 'Copy numbers')}</Button>
          <Button variant="outline" onClick={download} disabled={!numbers.length}><Download className="w-4 h-4 me-1" />{t('تنزيل ملف Excel', 'Download Excel file')}</Button>
          <Button variant="outline" onClick={() => onUse(numbers)} disabled={!numbers.length}>{t('إضافتها للحملة', 'Add to campaign')}</Button>
        </div>
        <Textarea dir="ltr" readOnly value={output} rows={4} aria-label={t('النص الجاهز للنسخ', 'Copy-ready text')} />
        {!!numbers.length && <>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-48"><Search className="absolute start-2 top-2.5 w-4 h-4 text-muted-foreground" /><Input className="ps-8" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('ابحث بـ 05 أو +966 أو آخر الرقم، أو الصق عدة أرقام', 'Search by 05, +966, ending digits, or paste several numbers')} /></div>
            <Button variant="outline" onClick={() => setSelected(old => new Set([...old, ...filtered]))} disabled={!filtered.length}>{t('تحديد الظاهر', 'Select visible')}</Button>
            <Button variant="outline" onClick={() => setSelected(new Set())} disabled={!selected.size}>{t('إلغاء التحديد', 'Clear selection')}</Button>
            <Button variant="destructive" onClick={() => { setNumbers(old => old.filter(phone => !selected.has(phone))); setSelected(new Set()); }} disabled={!selected.size}><Trash2 className="w-4 h-4 me-1" />{t(`حذف المحدد (${selected.size})`, `Delete selected (${selected.size})`)}</Button>
          </div>
          {search && <p className="text-sm text-muted-foreground">{t(`${filtered.length} نتيجة من ${numbers.length} رقم`, `${filtered.length} of ${numbers.length} numbers found`)}</p>}
          <div className="max-h-72 overflow-auto rounded border divide-y">
            {filtered.length ? filtered.map(phone => <div key={phone} className="flex items-center gap-3 px-3 py-2">
              <input type="checkbox" aria-label={t(`تحديد ${displayPhone(phone)}`, `Select ${displayPhone(phone)}`)} checked={selected.has(phone)} onChange={event => setSelected(old => { const next = new Set(old); if (event.target.checked) next.add(phone); else next.delete(phone); return next; })} />
              <span dir="ltr" className="font-mono flex-1 text-sm">{displayPhone(phone)}</span>
              <Button variant="ghost" size="sm" className="text-red-600" onClick={() => remove(phone)} aria-label={t(`حذف ${displayPhone(phone)}`, `Delete ${displayPhone(phone)}`)}><Trash2 className="w-4 h-4" /></Button>
            </div>) : <p className="p-4 text-sm text-center text-muted-foreground">{t('لا توجد نتائج للبحث', 'No matching numbers')}</p>}
          </div>
        </>}
      </CardContent>
    </Card>
  </div>;
}
