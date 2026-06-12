import React, { useState, useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { MessageCircle, Trash2, Send, ClipboardPaste, X, Plus, FileDown, Eraser, User } from 'lucide-react';

const ARABIC_DIGITS = { '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9' };
const normalizeDigits = (s) => (s || '').replace(/[٠-٩]/g, d => ARABIC_DIGITS[d] || d);

// Placeholder that gets replaced by each recipient's name. Accepts the Arabic
// {الاسم} and the English {name} (case-insensitive, optional inner spaces).
const NAME_TOKEN = '{الاسم}';
// Built fresh on each use — a shared /g/ regex is stateful across .test()/.replace().
const nameTokenRe = () => /\{\s*(?:الاسم|name)\s*\}/gi;
const hasLetters = (s) => /[A-Za-z\u0600-\u06FF]/.test(s || '');

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

// Parse pasted text into { name, phoneRaw } rows. Handles three shapes:
//  1) Excel columns: "name<TAB>phone" or "index<TAB>name<TAB>phone" (also , ; |)
//  2) Single space-separated cell: "الاسم 0501234567"
//  3) Legacy: a bare list of numbers (one per line / space separated) -> no name
const parsePastedRows = (text) => {
  if (!text) return [];
  const lines = String(text).split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    // Split into columns by explicit delimiters only (NOT space — names contain spaces).
    const cols = line.split(/[\t,;|]+/).map(c => c.trim()).filter(Boolean);

    if (cols.length > 1) {
      // Pick the phone column (prefer the last valid one), name = the longest
      // remaining column that contains letters (skips numeric index columns).
      let phoneCol = null;
      for (let k = cols.length - 1; k >= 0; k--) {
        if (isValidPhone(cleanPhone(cols[k]))) { phoneCol = cols[k]; break; }
      }
      if (!phoneCol) phoneCol = cols[cols.length - 1];
      const name = cols
        .filter(c => c !== phoneCol && hasLetters(c))
        .sort((a, b) => b.length - a.length)[0] || '';
      out.push({ name: name.trim(), phoneRaw: phoneCol });
      continue;
    }

    // Single column (no explicit delimiter): tokenise on whitespace.
    const tokens = line.split(/\s+/).filter(Boolean);
    const phoneToks = tokens.filter(tok => isValidPhone(cleanPhone(tok)));

    // A pure list of numbers on one line -> each becomes its own entry (legacy).
    if (phoneToks.length >= 2 && phoneToks.length === tokens.length) {
      for (const tok of phoneToks) out.push({ name: '', phoneRaw: tok });
      continue;
    }

    // Otherwise treat the last valid-phone token as the number, the rest as name.
    let phoneTok = null;
    for (let k = tokens.length - 1; k >= 0; k--) {
      if (isValidPhone(cleanPhone(tokens[k]))) { phoneTok = tokens[k]; break; }
    }
    if (phoneTok) {
      const name = tokens.filter(x => x !== phoneTok).join(' ').trim();
      out.push({ name, phoneRaw: phoneTok });
    } else {
      out.push({ name: '', phoneRaw: line });
    }
  }
  return out;
};

const rowsToItems = (rows) => {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const cleaned = cleanPhone(r.phoneRaw);
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: (r.name || '').trim(),
      phone: cleaned,
      original: r.phoneRaw,
      valid: isValidPhone(cleaned),
    });
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
  const [editingName, setEditingName] = useState('');
  const [message, setMessage] = useState('');
  const [defaultName, setDefaultName] = useState('');
  const [waQueue, setWaQueue] = useState([]);
  const [waIdx, setWaIdx] = useState(0);

  const validItems = useMemo(() => items.filter(i => i.valid), [items]);
  const invalidCount = items.length - validItems.length;
  const namedCount = useMemo(() => items.filter(i => i.name).length, [items]);
  const usesName = nameTokenRe().test(message);

  // Replace the {الاسم} token with this recipient's name (or the default name).
  // When no name is available, drop the token and tidy up stray spaces/commas.
  const personalize = (msg, name) => {
    const finalName = (name && name.trim()) || defaultName.trim() || '';
    let out = (msg || '').replace(nameTokenRe(), finalName);
    if (!finalName) {
      out = out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([،,.!؟?])/g, '$1');
    }
    return out;
  };

  const previewItem = validItems[0];
  const previewText = message.trim() ? personalize(message, previewItem?.name) : '';

  const mergeNewItems = (parsedRows) => {
    const fresh = rowsToItems(parsedRows);
    if (!fresh.length) {
      toast.error(t('لا توجد أرقام صالحة في النص', 'No numbers found in pasted text'));
      return;
    }
    setItems(prev => {
      const existing = new Set(prev.map(p => p.phone));
      const toAdd = fresh.filter(p => !existing.has(p.phone));
      const dupCount = fresh.length - toAdd.length;
      let msg = t(`تمت إضافة ${toAdd.length} رقم`, `Added ${toAdd.length} number(s)`);
      if (dupCount > 0) msg += t(` — تم تجاهل ${dupCount} مكرر`, ` — ${dupCount} duplicate(s) skipped`);
      toast.success(msg);
      return [...prev, ...toAdd];
    });
  };

  const addFromPaste = () => {
    mergeNewItems(parsePastedRows(pasteText));
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
    setEditingName(item.name || '');
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditingValue('');
    setEditingName('');
  };
  const saveEdit = () => {
    const cleaned = cleanPhone(editingValue);
    if (!cleaned) {
      toast.error(t('رقم غير صالح', 'Invalid number'));
      return;
    }
    if (items.some(i => i.id !== editingId && i.phone === cleaned)) {
      toast.error(t('هذا الرقم موجود بالفعل في القائمة', 'This number is already in the list'));
      return;
    }
    setItems(prev => prev.map(i => i.id === editingId
      ? { ...i, name: editingName.trim(), phone: cleaned, original: editingValue, valid: isValidPhone(cleaned) }
      : i));
    cancelEdit();
  };

  const exportCSV = () => {
    if (!items.length) return;
    const rows = [
      [t('الاسم', 'Name'), t('الرقم', 'Number'), t('صالح', 'Valid')],
      ...items.map(i => [i.name || '', i.phone, i.valid ? t('نعم', 'Yes') : t('لا', 'No')]),
    ];
    const csv = '\ufeff' + rows.map(r => r.map(c => `"${(c ?? '').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatsapp_bulk_numbers_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const insertNameToken = () => {
    setMessage(prev => {
      const sep = prev && !/\s$/.test(prev) ? ' ' : '';
      return `${prev}${sep}${NAME_TOKEN} `;
    });
  };

  const buildLink = (item) => {
    const text = message.trim() ? personalize(message, item.name) : '';
    return `https://wa.me/${item.phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  };

  const startSend = () => {
    if (!validItems.length) {
      toast.error(t('لا توجد أرقام صالحة للإرسال', 'No valid numbers to send'));
      return;
    }
    if (!message.trim()) {
      if (!window.confirm(t('الرسالة فارغة. المتابعة بدون رسالة؟', 'Message is empty. Continue anyway?'))) return;
    }
    const queue = validItems.map(i => ({ phone: i.phone, name: i.name, link: buildLink(i) }));
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
    // Multi-row / multi-column clipboard content -> parse straight into the list.
    if (/[\t\n]/.test(txt) || txt.split(/\s|,|;|\|/).filter(Boolean).length > 1) {
      e.preventDefault();
      const parsed = parsePastedRows(txt);
      if (parsed.length > 0) {
        mergeNewItems(parsed);
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
              {t('انسخ عمود الأرقام (أو عمودي الاسم والرقم معًا) من إكسل والصقه هنا — يقبل الفاصل بين الأعمدة (Tab، فاصلة، فاصلة منقوطة). كل سطر = مستلم. الأرقام السعودية بصيغة 05xxxxxxxx تُحوَّل تلقائيًا إلى 9665xxxxxxxx.',
                 'Paste a numbers column — or the name and number columns together — from Excel. Columns may be separated by Tab, comma or semicolon. Each line = one recipient. Saudi 05xxxxxxxx numbers are auto-converted to 9665xxxxxxxx.')}
            </p>
            <Textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              onPaste={handlePasteEvent}
              placeholder={t('الصق هنا...\nمحمد علي\t0501234567\nسارة أحمد\t0509876543', 'Paste here...\nMohammed Ali\t0501234567\nSara Ahmed\t0509876543')}
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
                {namedCount > 0 && <Badge className="bg-blue-100 text-blue-800">{t(`بأسماء: ${namedCount}`, `Named: ${namedCount}`)}</Badge>}
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
                      <th className="text-right p-2">{t('الاسم', 'Name')}</th>
                      <th className="text-right p-2">{t('الرقم', 'Number')}</th>
                      <th className="text-right p-2 w-24">{t('الحالة', 'Status')}</th>
                      <th className="text-right p-2 w-32">{t('إجراء', 'Action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={it.id} className="border-t hover:bg-muted/30">
                        <td className="p-2 text-xs text-muted-foreground">{i + 1}</td>
                        <td className="p-2">
                          {editingId === it.id ? (
                            <Input
                              value={editingName}
                              onChange={e => setEditingName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                              placeholder={t('الاسم', 'Name')}
                              className="h-8 text-sm"
                            />
                          ) : (
                            <span className={it.name ? '' : 'text-muted-foreground'}>
                              {it.name || t('— بدون اسم', '— No name')}
                            </span>
                          )}
                        </td>
                        <td className="p-2 font-mono">
                          {editingId === it.id ? (
                            <Input
                              autoFocus
                              value={editingValue}
                              onChange={e => setEditingValue(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
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
                                <Button size="sm" variant="outline" className="h-7 px-2" onClick={cancelEdit}>
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
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={insertNameToken}>
                <User className="w-4 h-4 ml-1" />{t('إدراج اسم المستلم', 'Insert recipient name')}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t(`سيتم استبدال ${NAME_TOKEN} باسم كل مستلم تلقائيًا.`, `${NAME_TOKEN} will be replaced with each recipient's name.`)}
              </span>
            </div>
            <Textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={t(`مثال: أهلاً ${NAME_TOKEN}، يسعدنا انضمامك لأكاديمية أداء الأبطال 🎉`, `e.g. Hi ${NAME_TOKEN}, welcome to Champions Academy 🎉`)}
              rows={5}
            />
            <div className="text-xs text-muted-foreground">{t(`عدد الأحرف: ${message.length}`, `Characters: ${message.length}`)}</div>

            {usesName && (
              <div className="space-y-2">
                <label className="text-xs font-medium">{t('الاسم الافتراضي (لمن ليس له اسم)', 'Default name (for recipients without a name)')}</label>
                <Input
                  value={defaultName}
                  onChange={e => setDefaultName(e.target.value)}
                  placeholder={t('مثال: عميلنا العزيز (اتركه فارغًا لحذف الكلمة)', 'e.g. Dear customer (leave empty to drop it)')}
                />
              </div>
            )}

            {previewText && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground mb-1">
                  {t('معاينة (أول مستلم', 'Preview (first recipient')}
                  {previewItem?.name ? `: ${previewItem.name}` : ''}
                  {t(')', ')')}
                </div>
                <div className="text-sm whitespace-pre-wrap">{previewText}</div>
              </div>
            )}

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
              {t('التالي:', 'Next:')}{' '}
              {waQueue[waIdx]?.name ? <span className="text-foreground font-medium">{waQueue[waIdx].name} — </span> : null}
              <span className="font-mono text-foreground">{waQueue[waIdx]?.phone}</span>
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
