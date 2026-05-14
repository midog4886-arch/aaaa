import React, { useState, useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { MessageCircle, Trash2, Send, ClipboardPaste, X, Plus, FileDown, Eraser } from 'lucide-react';

const ARABIC_DIGITS = { '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9' };
const normalizeDigits = (s) => (s || '').replace(/[٠-٩]/g, d => ARABIC_DIGITS[d] || d);

const cleanPhone = (raw) => {
  let p = normalizeDigits(String(raw || '')).trim();
  p = p.replace(/[\s\-()._]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('05') && p.length === 10) p = '966' + p.slice(1);
  else if (p.startsWith('5') && p.length === 9) p = '966' + p;
  p = p.replace(/\D/g, '');
  return p;
};

const isValidPhone = (p) => p && p.length >= 9 && p.length <= 15;

const parsePastedNumbers = (text) => {
  if (!text) return [];
  const parts = String(text).split(/[\s,;|\t\r\n]+/).map(x => x.trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const cleaned = cleanPhone(part);
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, phone: cleaned, original: part, valid: isValidPhone(cleaned) });
  }
  return out;
};

export default function WhatsAppBulkPage() {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const t = (a, e) => ar ? a : e;

  const [pasteText, setPasteText] = useState('');
  const [items, setItems] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [message, setMessage] = useState('');
  const [waQueue, setWaQueue] = useState([]);
  const [waIdx, setWaIdx] = useState(0);

  const validItems = useMemo(() => items.filter(i => i.valid), [items]);
  const invalidCount = items.length - validItems.length;

  const addFromPaste = () => {
    const parsed = parsePastedNumbers(pasteText);
    if (!parsed.length) {
      toast.error(t('لا توجد أرقام صالحة في النص', 'No numbers found in pasted text'));
      return;
    }
    setItems(prev => {
      const existing = new Set(prev.map(p => p.phone));
      const fresh = parsed.filter(p => !existing.has(p.phone));
      const merged = [...prev, ...fresh];
      const dupCount = parsed.length - fresh.length;
      let msg = t(`تمت إضافة ${fresh.length} رقم`, `Added ${fresh.length} number(s)`);
      if (dupCount > 0) msg += t(` — تم تجاهل ${dupCount} مكرر`, ` — ${dupCount} duplicate(s) skipped`);
      toast.success(msg);
      return merged;
    });
    setPasteText('');
  };

  const removeOne = (id) => setItems(prev => prev.filter(i => i.id !== id));
  const removeInvalid = () => setItems(prev => prev.filter(i => i.valid));
  const clearAll = () => {
    if (!items.length) return;
    if (!window.confirm(t('مسح جميع الأرقام؟', 'Clear all numbers?'))) return;
    setItems([]);
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditingValue(item.phone);
  };
  const saveEdit = () => {
    const cleaned = cleanPhone(editingValue);
    if (!cleaned) {
      toast.error(t('رقم غير صالح', 'Invalid number'));
      return;
    }
    setItems(prev => prev.map(i => i.id === editingId
      ? { ...i, phone: cleaned, original: editingValue, valid: isValidPhone(cleaned) }
      : i));
    setEditingId(null);
    setEditingValue('');
  };

  const exportCSV = () => {
    if (!items.length) return;
    const rows = [['الرقم', 'صالح'], ...items.map(i => [i.phone, i.valid ? 'نعم' : 'لا'])];
    const csv = '\ufeff' + rows.map(r => r.map(c => `"${(c ?? '').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatsapp_bulk_numbers_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startSend = () => {
    if (!validItems.length) {
      toast.error(t('لا توجد أرقام صالحة للإرسال', 'No valid numbers to send'));
      return;
    }
    if (!message.trim()) {
      if (!window.confirm(t('الرسالة فارغة. المتابعة بدون رسالة؟', 'Message is empty. Continue anyway?'))) return;
    }
    const queue = validItems.map(i => ({
      phone: i.phone,
      link: `https://wa.me/${i.phone}${message.trim() ? `?text=${encodeURIComponent(message)}` : ''}`,
    }));
    window.open(queue[0].link, '_blank');
    if (queue.length === 1) {
      toast.success(t('تم فتح المحادثة', 'Chat opened'));
      return;
    }
    setWaQueue(queue);
    setWaIdx(1);
    toast.success(t(`تم فتح 1 من ${queue.length}. اضغط "فتح التالي" للمتابعة`, `Opened 1 of ${queue.length}. Click "Open Next" to continue`));
  };

  const sendNext = () => {
    const next = waQueue[waIdx];
    if (!next) { setWaQueue([]); setWaIdx(0); return; }
    window.open(next.link, '_blank');
    const ni = waIdx + 1;
    if (ni >= waQueue.length) {
      setWaQueue([]); setWaIdx(0);
      toast.success(t('تم إرسال جميع الرسائل', 'All messages sent'));
    } else {
      setWaIdx(ni);
    }
  };

  const skipNext = () => {
    const ni = waIdx + 1;
    if (ni >= waQueue.length) { setWaQueue([]); setWaIdx(0); }
    else setWaIdx(ni);
  };

  const cancelQueue = () => { setWaQueue([]); setWaIdx(0); };

  const handlePasteEvent = (e) => {
    const txt = e.clipboardData?.getData('text');
    if (!txt) return;
    if (/[\t\n]/.test(txt) || txt.split(/\s|,|;|\|/).filter(Boolean).length > 1) {
      e.preventDefault();
      const parsed = parsePastedNumbers(txt);
      if (parsed.length > 0) {
        setItems(prev => {
          const existing = new Set(prev.map(p => p.phone));
          const fresh = parsed.filter(p => !existing.has(p.phone));
          const dupCount = parsed.length - fresh.length;
          let msg = t(`تمت إضافة ${fresh.length} رقم`, `Added ${fresh.length} number(s)`);
          if (dupCount > 0) msg += t(` — تم تجاهل ${dupCount} مكرر`, ` — ${dupCount} duplicate(s) skipped`);
          toast.success(msg);
          return [...prev, ...fresh];
        });
        setPasteText('');
      }
    }
  };

  return (
    <Layout title={t('واتساب جماعي', 'Bulk WhatsApp')}>
      <div className="space-y-6 animate-fade-in">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardPaste className="w-5 h-5 text-green-600" />
              {t('لصق الأرقام', 'Paste Numbers')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('انسخ عمود الأرقام من إكسل والصقه هنا — يقبل أي فاصل (سطر، فاصلة، فاصلة منقوطة، مسافة، Tab). الأرقام السعودية بصيغة 05xxxxxxxx تُحوَّل تلقائيًا إلى 9665xxxxxxxx.',
                 'Paste a column of numbers from Excel — any separator works (newline, comma, semicolon, space, tab). Saudi 05xxxxxxxx numbers are auto-converted to 9665xxxxxxxx.')}
            </p>
            <Textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              onPaste={handlePasteEvent}
              placeholder={t('الصق هنا...\n0501234567\n0509876543\n...', 'Paste here...\n0501234567\n0509876543\n...')}
              rows={6}
              className="font-mono text-sm"
            />
            <div className="flex gap-2 flex-wrap">
              <Button onClick={addFromPaste} disabled={!pasteText.trim()}>
                <Plus className="w-4 h-4 ml-1" />{t('إضافة', 'Add')}
              </Button>
              <Button variant="outline" onClick={() => setPasteText('')} disabled={!pasteText}>
                {t('مسح المربع', 'Clear box')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-blue-600" />
                {t('قائمة الأرقام', 'Numbers List')}
              </span>
              <span className="flex items-center gap-2 text-xs">
                <Badge className="bg-green-100 text-green-800">{t(`صالح: ${validItems.length}`, `Valid: ${validItems.length}`)}</Badge>
                {invalidCount > 0 && <Badge className="bg-red-100 text-red-800">{t(`غير صالح: ${invalidCount}`, `Invalid: ${invalidCount}`)}</Badge>}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={exportCSV} disabled={!items.length}>
                <FileDown className="w-4 h-4 ml-1" />{t('تصدير CSV', 'Export CSV')}
              </Button>
              {invalidCount > 0 && (
                <Button size="sm" variant="outline" onClick={removeInvalid}>
                  <Eraser className="w-4 h-4 ml-1" />{t('حذف غير الصالح', 'Remove invalid')}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="text-red-600" onClick={clearAll} disabled={!items.length}>
                <Trash2 className="w-4 h-4 ml-1" />{t('مسح الكل', 'Clear all')}
              </Button>
            </div>

            {items.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                {t('لا توجد أرقام بعد. الصق أرقامًا في الأعلى ثم اضغط إضافة.', 'No numbers yet. Paste above and click Add.')}
              </div>
            ) : (
              <div className="border rounded-lg max-h-[400px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-right p-2 w-12">#</th>
                      <th className="text-right p-2">{t('الرقم', 'Number')}</th>
                      <th className="text-right p-2 w-24">{t('الحالة', 'Status')}</th>
                      <th className="text-right p-2 w-32">{t('إجراء', 'Action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={it.id} className="border-t hover:bg-muted/30">
                        <td className="p-2 text-xs text-muted-foreground">{i + 1}</td>
                        <td className="p-2 font-mono">
                          {editingId === it.id ? (
                            <Input
                              autoFocus
                              value={editingValue}
                              onChange={e => setEditingValue(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') { setEditingId(null); setEditingValue(''); } }}
                              className="h-8 font-mono text-sm"
                            />
                          ) : (
                            <span className={it.valid ? '' : 'text-red-600'}>{it.phone}</span>
                          )}
                        </td>
                        <td className="p-2">
                          {it.valid
                            ? <Badge className="bg-green-100 text-green-800 text-xs">{t('صالح', 'Valid')}</Badge>
                            : <Badge className="bg-red-100 text-red-800 text-xs">{t('غير صالح', 'Invalid')}</Badge>}
                        </td>
                        <td className="p-2">
                          <div className="flex gap-1">
                            {editingId === it.id ? (
                              <>
                                <Button size="sm" className="h-7 px-2" onClick={saveEdit}>{t('حفظ', 'Save')}</Button>
                                <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setEditingId(null); setEditingValue(''); }}>
                                  <X className="w-3 h-3" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => startEdit(it)}>{t('تعديل', 'Edit')}</Button>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-red-600" onClick={() => removeOne(it.id)}>
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="w-5 h-5 text-green-600" />
              {t('الرسالة', 'Message')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={t('اكتب رسالتك هنا...', 'Type your message here...')}
              rows={5}
            />
            <div className="text-xs text-muted-foreground">{t(`عدد الأحرف: ${message.length}`, `Characters: ${message.length}`)}</div>
            <Button onClick={startSend} disabled={!validItems.length || waQueue.length > 0} className="bg-green-600 hover:bg-green-700">
              <Send className="w-4 h-4 ml-1" />
              {t(`إرسال إلى ${validItems.length} رقم عبر واتساب`, `Send to ${validItems.length} number(s) via WhatsApp`)}
            </Button>
          </CardContent>
        </Card>

        {waQueue.length > 0 && (
          <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-white border-2 border-green-500 rounded-lg shadow-2xl p-4 z-[100]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold">{t('قائمة إرسال واتساب', 'WhatsApp send queue')}</span>
              <span className="text-xs text-muted-foreground">{waIdx} / {waQueue.length}</span>
            </div>
            <div className="text-xs text-muted-foreground mb-3">
              {t('التالي:', 'Next:')} <span className="font-mono text-foreground">{waQueue[waIdx]?.phone}</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={sendNext} className="flex-1 gap-1 bg-green-600 hover:bg-green-700">
                <Send className="w-3 h-3" />{t('فتح التالي', 'Open Next')}
              </Button>
              <Button size="sm" variant="outline" onClick={skipNext}>{t('تخطي', 'Skip')}</Button>
              <Button size="sm" variant="ghost" onClick={cancelQueue}>{t('إلغاء', 'Cancel')}</Button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
