import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';
import { MessageCircle, Trash2, Send, ClipboardPaste, X, Plus, FileDown, Eraser, User, Loader2, Building2, Cloud, Paperclip, Image as ImageIcon, FileText, Save, History, CalendarClock, RefreshCw } from 'lucide-react';
import { branchesAPI, whatsappAPI } from '../services/api';
import { apiErrorMessage } from '../utils/apiErrorMessage';
import WhatsAppCampaignReport from '../components/WhatsAppCampaignReport';
import WhatsAppCampaignWorkflow from '../components/WhatsAppCampaignWorkflow';

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
  p = p.replace(/\D/g, '');
  // Saudi: 05xxxxxxxx (10 digits) or bare 5xxxxxxxx (9) -> 9665xxxxxxxx
  if (p.startsWith('05') && p.length === 10) p = '966' + p.slice(1);
  else if (p.startsWith('5') && p.length === 9) p = '966' + p;
  // Egyptian: 01xxxxxxxxx (11 digits) or bare 1xxxxxxxxx (10) -> 201xxxxxxxxx
  else if (p.startsWith('01') && p.length === 11) p = '20' + p.slice(1);
  else if (p.startsWith('1') && p.length === 10) p = '20' + p;
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
    const recipientId = r.recipient_id || r.recipientId || r.id || '';
    const memberId = r.member_id || r.memberId || '';
    out.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: (r.name || '').trim(),
      phone: cleaned,
      original: r.phoneRaw,
      valid: isValidPhone(cleaned),
      recipientId: recipientId || null,
      member_id: memberId || null,
    });
  }
  return out;
};

const recipientIdentityPayload = (item) => {
  const payload = {};
  if (item.name) payload.name = item.name;
  if (item.recipientId) payload.id = item.recipientId;
  if (item.member_id) payload.member_id = item.member_id;
  return payload;
};

export default function WhatsAppBulkPage() {
  const { language } = useLanguage();
  const { selectedBranchId } = useAuth();
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
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState(selectedBranchId && selectedBranchId !== 'all' ? selectedBranchId : '');
  const [cloudStatus, setCloudStatus] = useState({ loading: false, enabled: false, provider: 'meta_cloud', configured: false, connected: false, template_configured: false, daily_limit: 0, daily_used: 0, daily_remaining: 0 });
  const [cloudSending, setCloudSending] = useState(false);
  const [cloudJobs, setCloudJobs] = useState([]);
  const [reportJob, setReportJob] = useState(null);
  const [cloudJobsPollVersion, setCloudJobsPollVersion] = useState(0);
  const enqueueKey = useRef(null);
  const [attachments, setAttachments] = useState([]);
  const [campaignName, setCampaignName] = useState('');
  const [campaignId, setCampaignId] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [audience, setAudience] = useState('pasted');
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [proposedSendAt, setProposedSendAt] = useState('');
  const [storedAttachment, setStoredAttachment] = useState(false);
  const [removeStoredAttachment, setRemoveStoredAttachment] = useState(false);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [dynamicAudienceBranch, setDynamicAudienceBranch] = useState('');
  const campaignListGeneration = useRef(0);
  const campaignLoadGeneration = useRef(0);
  const audienceGeneration = useRef(0);

  const validItems = useMemo(() => items.filter(i => i.valid), [items]);
  const invalidCount = items.length - validItems.length;
  const namedCount = useMemo(() => items.filter(i => i.name).length, [items]);
  const usesName = nameTokenRe().test(message);
  const isWaha = cloudStatus.provider === 'waha';
  const isSessionProvider = isWaha || cloudStatus.provider === 'whatsflow';
  const whatsflowQuotaExhausted = cloudStatus.provider === 'whatsflow'
    && Number(cloudStatus.daily_remaining) <= 0;
  const attachment = attachments[0] || null;
  const attachmentPreviews = useMemo(
    () => attachments.map(file => file.type === 'application/pdf' ? null : URL.createObjectURL(file)),
    [attachments]
  );
  useEffect(() => () => attachmentPreviews.forEach(url => url && URL.revokeObjectURL(url)), [attachmentPreviews]);
  const selectedTemplateReady = isSessionProvider || (attachment
    ? (
        attachment.type === 'application/pdf'
          ? cloudStatus.document_template_configured
          : cloudStatus.image_template_configured
      )
     : cloudStatus.template_configured);
  const messageTooLong = message.length > (attachment ? 1024 : 4096);

  useEffect(() => {
    let cancelled = false;
    branchesAPI.getAll()
      .then(response => {
        if (cancelled) return;
        const list = Array.isArray(response.data) ? response.data : [];
        setBranches(list);
        setBranchId(current => {
          if (current && list.some(branch => branch.id === current)) return current;
          const preferred = selectedBranchId && selectedBranchId !== 'all'
            ? list.find(branch => branch.id === selectedBranchId)?.id
            : '';
          return preferred || list[0]?.id || '';
        });
      })
      .catch(() => toast.error(t('تعذر تحميل الفروع', 'Could not load branches')));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId]);

  useEffect(() => {
    let cancelled = false;
    if (!branchId) {
      setCloudStatus({ loading: false, enabled: false, provider: 'meta_cloud', configured: false, connected: false, template_configured: false, image_template_configured: false, document_template_configured: false, daily_remaining: 0 });
      return undefined;
    }
    setCloudStatus(current => ({ ...current, loading: true }));
    whatsappAPI.getBranchCloudAvailability(branchId)
      .then(response => {
        if (!cancelled) setCloudStatus({ loading: false, ...response.data });
      })
      .catch(() => {
        if (!cancelled) setCloudStatus({ loading: false, enabled: false, provider: 'meta_cloud', configured: false, connected: false, template_configured: false, image_template_configured: false, document_template_configured: false, daily_remaining: 0 });
      });
    return () => { cancelled = true; };
  }, [branchId]);

  useEffect(() => {
    let cancelled = false;
    let timer;
    if (!branchId) {
      setCloudJobs([]);
      return undefined;
    }
    const poll = async () => {
      try {
        const response = await whatsappAPI.listBranchCloudJobs(branchId);
        if (cancelled) return;
        const jobs = Array.isArray(response.data) ? response.data : [];
        setCloudJobs(jobs);
        if (jobs.some(job => ['initializing', 'pending', 'processing', 'paused'].includes(job.status))) {
          timer = window.setTimeout(poll, 5000);
        }
      } catch (_) {
        if (!cancelled) timer = window.setTimeout(poll, 15000);
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [branchId, cloudJobsPollVersion]);

  const loadCampaigns = async () => {
    const generation = ++campaignListGeneration.current;
    const requestedBranch = branchId;
    if (!branchId) {
      setCampaigns([]);
      return;
    }
    setCampaignsLoading(true);
    try {
      const response = await whatsappAPI.listCampaigns(branchId);
      if (generation !== campaignListGeneration.current || requestedBranch !== branchId) return;
      setCampaigns(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      if (generation !== campaignListGeneration.current) return;
      toast.error(apiErrorMessage(error, t('تعذر تحميل الحملات', 'Could not load campaigns')));
    } finally {
      if (generation === campaignListGeneration.current) setCampaignsLoading(false);
    }
  };

  useEffect(() => {
    campaignListGeneration.current += 1;
    campaignLoadGeneration.current += 1;
    audienceGeneration.current += 1;
    setReportJob(null);
    setCampaignId(null);
    setCampaignName('');
    setMessage('');
    setDefaultName('');
    setProposedSendAt('');
    setAudience('pasted');
    setPasteText('');
    setItems([]);
    setAttachments([]);
    setStoredAttachment(false);
    setRemoveStoredAttachment(false);
    setCampaignLoading(false);
    setAudienceLoading(false);
    setDynamicAudienceBranch('');
    setWaQueue([]);
    setWaIdx(0);
    setCampaigns([]);
    loadCampaigns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const refreshAudience = async (nextAudience = audience) => {
    const generation = ++audienceGeneration.current;
    const requestedBranch = branchId;
    if (!branchId || nextAudience === 'pasted') return;
    setAudienceLoading(true);
    setDynamicAudienceBranch('');
    try {
      const response = await whatsappAPI.previewCampaignAudience(branchId, nextAudience);
      if (generation !== audienceGeneration.current || requestedBranch !== branchId) return;
      setItems(rowsToItems((response.data?.recipients || []).map(row => ({
        name: row.name || '',
        phoneRaw: row.phone,
        id: row.id,
        recipient_id: row.recipient_id,
        member_id: row.member_id || (
          ['active_members', 'all_members', 'expired_members'].includes(nextAudience) ? row.id : undefined
        ),
      }))));
      setDynamicAudienceBranch(requestedBranch);
    } catch (error) {
      if (generation !== audienceGeneration.current) return;
      toast.error(apiErrorMessage(error, t('تعذر تحديث الجمهور', 'Could not refresh audience')));
    } finally {
      if (generation === audienceGeneration.current) setAudienceLoading(false);
    }
  };

  const changeAudience = (value) => {
    audienceGeneration.current += 1;
    setAudience(value);
    if (value === 'pasted') {
      setDynamicAudienceBranch('');
    } else {
      setItems([]);
      refreshAudience(value);
    }
  };

  const newCampaign = () => {
    setCampaignId(null);
    setCampaignName('');
    setMessage('');
    setDefaultName('');
    setProposedSendAt('');
    setAudience('pasted');
    setItems([]);
    setAttachments([]);
    setStoredAttachment(false);
    setRemoveStoredAttachment(false);
  };

  const loadCampaign = async (id) => {
    const generation = ++campaignLoadGeneration.current;
    const requestedBranch = branchId;
    setCampaignLoading(true);
    try {
      const response = await whatsappAPI.getCampaign(id, branchId);
      if (generation !== campaignLoadGeneration.current || requestedBranch !== branchId) return;
      const draft = response.data || {};
      setCampaignId(draft.id);
      setCampaignName(draft.name || '');
      setMessage(draft.message || '');
      setDefaultName(draft.default_name || '');
      setProposedSendAt(draft.proposed_send_at || '');
      setAudience(draft.audience || 'pasted');
      if (draft.audience === 'pasted') {
        setDynamicAudienceBranch('');
        setItems(rowsToItems((draft.recipients || []).map(row => ({
          name: row.name,
          phoneRaw: row.phone,
          id: row.id,
          recipient_id: row.recipient_id,
          member_id: row.member_id,
        }))));
      } else {
        await refreshAudience(draft.audience);
        if (generation !== campaignLoadGeneration.current || requestedBranch !== branchId) return;
      }
      setAttachments([]);
      setStoredAttachment(Boolean(draft.has_attachment));
      setRemoveStoredAttachment(false);
      if (draft.has_attachment) {
        try {
          const metadata = draft.attachments?.length ? draft.attachments : [{
            attachment_name: draft.attachment_name,
            attachment_type: draft.attachment_type
          }];
          const mediaResponses = await Promise.all(
            metadata.map((_, index) => whatsappAPI.getCampaignAttachment(id, branchId, index))
          );
          if (generation !== campaignLoadGeneration.current || requestedBranch !== branchId) return;
          setAttachments(mediaResponses.map((media, index) => new File(
            [media.data],
            metadata[index].attachment_name || `attachment-${index + 1}`,
            { type: metadata[index].attachment_type || media.data.type }
          )));
        } catch (error) {
          toast.error(t('تعذر تحميل مرفق المسودة؛ لن يتم إسقاطه عند الحفظ', 'Could not load the draft attachment; it will not be dropped when saving'));
        }
      }
    } catch (error) {
      if (generation !== campaignLoadGeneration.current) return;
      toast.error(apiErrorMessage(error, t('تعذر تحميل الحملة', 'Could not load campaign')));
    } finally {
      if (generation === campaignLoadGeneration.current) setCampaignLoading(false);
    }
  };

  const saveCampaign = async () => {
    if (campaignLoading || audienceLoading || (audience !== 'pasted' && dynamicAudienceBranch !== branchId)) {
      toast.error(t('انتظر حتى يكتمل تحديث الحملة والجمهور', 'Wait for the campaign and audience refresh to finish'));
      return;
    }
    if (!branchId || !campaignName.trim()) {
      toast.error(t('اختر الفرع وأدخل اسم الحملة', 'Select a branch and enter a campaign name'));
      return;
    }
    const formData = new FormData();
    formData.append('branch_id', branchId);
    formData.append('name', campaignName.trim());
    formData.append('message', message);
    formData.append('audience', audience);
    formData.append('proposed_send_at', proposedSendAt);
    formData.append('default_name', defaultName);
    formData.append('recipients_json', JSON.stringify(
      audience === 'pasted'
        ? items.map(item => ({ phone: item.phone, ...recipientIdentityPayload(item) }))
        : []
    ));
    attachments.forEach(file => formData.append('attachments', file));
    if (removeStoredAttachment) formData.append('remove_attachment', 'true');
    setDraftSaving(true);
    try {
      const response = campaignId
        ? await whatsappAPI.updateCampaign(campaignId, formData)
        : await whatsappAPI.createCampaign(formData);
      setCampaignId(response.data.id);
      setStoredAttachment(Boolean(response.data.has_attachment));
      setRemoveStoredAttachment(false);
      toast.success(t('تم حفظ المسودة', 'Draft saved'));
      await loadCampaigns();
      return response.data.id;
    } catch (error) {
      toast.error(apiErrorMessage(error, t('تعذر حفظ المسودة', 'Could not save draft')));
    } finally {
      setDraftSaving(false);
    }
  };

  const deleteCampaign = async (draft) => {
    if (!window.confirm(t(`حذف الحملة «${draft.name}» نهائياً؟`, `Permanently delete “${draft.name}”?`))) return;
    try {
      await whatsappAPI.deleteCampaign(draft.id, branchId);
      if (campaignId === draft.id) newCampaign();
      await loadCampaigns();
      toast.success(t('تم حذف الحملة', 'Campaign deleted'));
    } catch (error) {
      toast.error(apiErrorMessage(error, t('تعذر حذف الحملة', 'Could not delete campaign')));
    }
  };

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
  const automaticMessageCount = validItems.length * Math.max(attachments.length, 1);

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
    setAudience('pasted');
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
    if (campaignLoading || audienceLoading || (audience !== 'pasted' && dynamicAudienceBranch !== branchId)) {
      toast.error(t('انتظر حتى يكتمل تحديث الجمهور', 'Wait for the audience refresh to finish'));
      return;
    }
    if (!validItems.length) {
      toast.error(t('لا توجد أرقام صالحة للإرسال', 'No valid numbers to send'));
      return;
    }
    if (attachments.length && !window.confirm(t(
      'فتح واتساب يدوياً لا يرفق الملفات تلقائياً. سيتم فتح النص فقط، وعليك إرفاق الصور أو PDF بنفسك. المتابعة؟',
      'Manual WhatsApp cannot attach these files automatically. Only the text will open; attach the images or PDF yourself. Continue?'
    ))) return;
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

  const sendViaCloudApi = async () => {
    if (!branchId) {
      toast.error(t('اختر الفرع الذي سيتم الإرسال من رقمه', 'Select the sending branch'));
      return;
    }
    if (campaignLoading || audienceLoading || (audience !== 'pasted' && dynamicAudienceBranch !== branchId)) {
      toast.error(t('انتظر حتى يكتمل تحديث الجمهور', 'Wait for the audience refresh to finish'));
      return;
    }
    if (storedAttachment && !removeStoredAttachment && !attachments.length) {
      toast.error(t('مرفق المسودة غير محمّل. أعد تحميل الحملة قبل الإرسال.', 'The draft attachment is not loaded. Reload the campaign before sending.'));
      return;
    }
    const isImage = attachment?.type === 'image/jpeg' || attachment?.type === 'image/png';
    const isPdf = attachment?.type === 'application/pdf';
    const templateReady = attachment
      ? (isImage ? cloudStatus.image_template_configured : isPdf && cloudStatus.document_template_configured)
       : cloudStatus.template_configured;
    if (!cloudStatus.enabled || (isSessionProvider ? (!cloudStatus.configured || !cloudStatus.connected) : !templateReady)) {
      toast.error(t(
        isSessionProvider ? 'جلسة مزود واتساب غير مهيأة أو غير متصلة' : (attachment ? 'قالب هذا النوع من المرفقات غير مهيأ للفرع' : 'API أو قالب Meta غير مهيأ لهذا الفرع'),
        isSessionProvider ? 'WhatsApp provider is not configured or connected' : (attachment ? 'The template for this attachment type is not configured' : 'Meta API or template is not configured for this branch')
      ));
      return;
    }
    if (whatsflowQuotaExhausted) {
      toast.error(t('تم استنفاد حد إرسال Whatsflow اليومي', 'The daily Whatsflow sending quota is exhausted'));
      return;
    }
    if (!validItems.length || !message.trim()) {
      toast.error(t('أضف أرقاماً واكتب الرسالة أولاً', 'Add recipients and enter a message first'));
      return;
    }
    if (validItems.length > 200) {
      toast.error(t('الحد الأقصى للإرسال التلقائي هو 200 رقم في الدفعة', 'Automatic sending is limited to 200 recipients per batch'));
      return;
    }
    const branchName = branches.find(branch => branch.id === branchId)?.name || '';
    const campaignMetadata = {
      campaign_id: campaignId || null,
      campaign_title: campaignName.trim(),
      branch_name: branchName,
    };
    if (!window.confirm(t(
       `ستتم إضافة ${automaticMessageCount} رسالة إلى قائمة الانتظار (لم تُرسل بعد). الفاصل 3 دقائق على الأقل بين الرسائل داخل الفرع والمدة التقديرية الدنيا ${Math.max(0, automaticMessageCount - 1) * 3} دقيقة. قد تزيد المدة بسبب الحملات الأخرى قيد الانتظار. لا يشمل هذا الحد إشعارات المعاملات. هل تريد المتابعة؟`,
       `Queue ${automaticMessageCount} message(s) (queued is not sent). At least 3 minutes apart within the branch; estimated minimum ${Math.max(0, automaticMessageCount - 1) * 3} minute(s). Other queued campaigns may increase this duration. Transactional notices are not affected. Continue?`
    ))) return;

    setCloudSending(true);
    try {
      const recipients = validItems.map(item => ({
        phone: item.phone,
        message: personalize(message.trim(), item.name),
        ...recipientIdentityPayload(item),
      }));
      let response;
      const idempotencyKey = enqueueKey.current || crypto.randomUUID();
      enqueueKey.current = idempotencyKey;
      if (attachments.length) {
        const formData = new FormData();
        formData.append('branch_id', branchId);
        formData.append('recipients_json', JSON.stringify(recipients));
        formData.append('idempotency_key', idempotencyKey);
        formData.append('campaign_id', campaignMetadata.campaign_id || '');
        formData.append('campaign_title', campaignMetadata.campaign_title);
        formData.append('branch_name', campaignMetadata.branch_name);
        attachments.forEach(file => formData.append('attachments', file));
        response = await whatsappAPI.sendBranchCloudBulkMedia(formData, campaignMetadata);
      } else {
        response = await whatsappAPI.sendBranchCloudBulk(branchId, recipients, idempotencyKey, campaignMetadata);
      }
      const job = response.data || {};
      setCloudJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
      setCloudJobsPollVersion(value => value + 1);
      enqueueKey.current = null;
      toast.success(t('تمت الإضافة إلى قائمة الانتظار؛ لم يتم الإرسال بعد', 'Queued successfully; no message has been sent yet'));
    } catch (error) {
      toast.error(apiErrorMessage(error, t('تعذّر تأكيد إضافة الحملة. تحقّق من قائمة الإرسال قبل المحاولة مجدداً.', 'Could not confirm campaign enqueue. Check the queue before trying again.')));
    } finally {
      setCloudSending(false);
    }
  };

  const sendNext = () => {
    const next = waQueue[waIdx];
    if (!next) { setWaQueue([]); setWaIdx(0); return; }
    window.open(next.link, '_blank');
    const ni = waIdx + 1;
    if (ni >= waQueue.length) {
      setWaQueue([]); setWaIdx(0);
      toast.success(t('تم فتح جميع المحادثات؛ تحقق من الإرسال والمرفقات يدوياً', 'All chats were opened; verify sending and attachments manually'));
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
        setAudience('pasted');
        mergeNewItems(parsed);
        setPasteText('');
      }
    }
  };

  return (
    <Layout title={t('واتساب جماعي', 'Bulk WhatsApp')}>
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageCircle className="w-5 h-5 text-emerald-600" />
                {campaignId ? t('تعديل الحملة', 'Edit campaign') : t('إنشاء حملة', 'Create campaign')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('اسم الحملة', 'Campaign name')}</label>
                <Input
                  value={campaignName}
                  onChange={event => setCampaignName(event.target.value)}
                  maxLength={160}
                  placeholder={t('مثال: عرض العودة للتمارين', 'e.g. Back-to-training offer')}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('الجمهور المستهدف', 'Audience')}</label>
                  <Select value={audience} onValueChange={changeAudience}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pasted">{t('الأرقام الملصقة', 'Pasted numbers')}</SelectItem>
                      <SelectItem value="registration_requests">{t('طلبات التسجيل المعلقة', 'Pending registration requests')}</SelectItem>
                      <SelectItem value="active_members">{t('أعضاء الفرع النشطون', 'Active branch members')}</SelectItem>
                      <SelectItem value="expired_members">{t('أعضاء الفرع المنتهية جميع اشتراكاتهم', 'Expired branch members')}</SelectItem>
                      <SelectItem value="all_members">{t('كل أعضاء الفرع', 'All branch members')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <CalendarClock className="w-4 h-4" />
                    {t('موعد إرسال الحملة', 'Campaign send time')}
                  </label>
                  <p className="text-sm text-muted-foreground">{proposedSendAt || t('حدّد الموعد في قسم معاينة الحملة واعتماد الإرسال أدناه.', 'Set the time in campaign preview and approval below.')}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-emerald-50/60 p-3">
                <div>
                  <p className="font-semibold text-emerald-900">
                    {audienceLoading
                      ? t('جاري تحديث الجمهور…', 'Refreshing audience…')
                      : t(`المعاينة: ${validItems.length} جهة اتصال`, `Preview: ${validItems.length} recipient(s)`)}
                  </p>
                  <p className="text-xs text-amber-800">
                    {t('لن تُرسل المسودة تلقائياً. استخدم المعاينة ثم أرسلها لاعتماد المدير لتفعيل الجدولة.', 'Drafts never send automatically. Preview and submit for manager approval to activate scheduling.')}
                  </p>
                </div>
                {audience !== 'pasted' && (
                  <Button type="button" size="sm" variant="outline" onClick={() => refreshAudience()} disabled={audienceLoading || !branchId}>
                    <RefreshCw className={`w-4 h-4 ${audienceLoading ? 'animate-spin' : ''}`} />
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={saveCampaign} disabled={draftSaving || campaignLoading || audienceLoading || !branchId || (audience !== 'pasted' && dynamicAudienceBranch !== branchId)}>
                  {draftSaving ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <Save className="w-4 h-4 me-1" />}
                  {t('حفظ كمسودة', 'Save draft')}
                </Button>
                <Button variant="outline" onClick={newCampaign}>
                  <Plus className="w-4 h-4 me-1" />{t('حملة جديدة', 'New campaign')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2"><History className="w-5 h-5" />{t('الحملات المحفوظة', 'Saved campaigns')}</span>
                <Badge variant="outline">{campaigns.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {campaignsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : campaigns.length === 0 ? (
                <p className="text-sm text-center text-muted-foreground py-8">{t('لا توجد حملات محفوظة', 'No saved campaigns')}</p>
              ) : (
                <div className="space-y-2 max-h-[420px] overflow-y-auto">
                  {campaigns.map(draft => (
                    <div key={draft.id} className={`rounded-lg border p-3 ${campaignId === draft.id ? 'border-emerald-500 bg-emerald-50/40' : ''}`}>
                      <button type="button" className="w-full text-start" onClick={() => loadCampaign(draft.id)}>
                        <p className="font-medium truncate">{draft.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {draft.audience === 'pasted'
                            ? t(`${draft.recipient_count || 0} رقم`, `${draft.recipient_count || 0} numbers`)
                            : draft.audience === 'expired_members'
                              ? t('أعضاء الفرع المنتهية جميع اشتراكاتهم', 'Expired branch members')
                              : t('جمهور ديناميكي', 'Dynamic audience')}
                          {draft.has_attachment ? ` · ${t('مرفق', 'attachment')}` : ''}
                        </p>
                      </button>
                      <div className="flex justify-end mt-2">
                        <Button type="button" variant="ghost" size="sm" className="text-red-600 h-7" onClick={() => deleteCampaign(draft)}>
                          <Trash2 className="w-3 h-3 me-1" />{t('حذف', 'Delete')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardPaste className="w-5 h-5 text-green-600" />
              {t('لصق الأرقام', 'Paste Numbers')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('انسخ عمود الأرقام (أو عمودي الاسم والرقم معًا) من إكسل والصقه هنا — يقبل الفاصل بين الأعمدة (Tab، فاصلة، فاصلة منقوطة). كل سطر = مستلم. الأرقام السعودية بصيغة 05xxxxxxxx تُحوَّل تلقائيًا إلى 9665xxxxxxxx، والأرقام المصرية بصيغة 01xxxxxxxxx تُحوَّل إلى 201xxxxxxxxx.',
                 'Paste a numbers column — or the name and number columns together — from Excel. Columns may be separated by Tab, comma or semicolon. Each line = one recipient. Saudi 05xxxxxxxx numbers are auto-converted to 9665xxxxxxxx, and Egyptian 01xxxxxxxxx numbers to 201xxxxxxxxx.')}
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

        <Card className="border-emerald-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cloud className="w-5 h-5 text-emerald-600" />
              {t('الإرسال من API الفرع', 'Send using branch API')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  {t('الفرع المرسل', 'Sending branch')}
                </label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('اختر الفرع', 'Select branch')} />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map(branch => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="pb-1">
                {cloudStatus.loading ? (
                  <Badge variant="outline"><Loader2 className="w-3 h-3 me-1 animate-spin" />{t('جاري التحقق', 'Checking')}</Badge>
                ) : cloudStatus.enabled && selectedTemplateReady && (!isSessionProvider || cloudStatus.connected) && !whatsflowQuotaExhausted ? (
                  <Badge className="bg-emerald-100 text-emerald-800">{t('API والقالب جاهزان', 'API and template ready')}</Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-800">{t('API أو القالب غير مهيأ', 'API or template not configured')}</Badge>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                'الأرقام الملصقة غير مرتبطة بأعضاء، لذلك يجب تحديد الفرع. ستُرسل الرسائل تلقائياً من مزود واتساب الخاص بالفرع المحدد.',
                'Pasted numbers are not linked to members, so select a branch. Messages will be sent automatically using that branch’s WhatsApp provider.'
              )}
            </p>
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
            {branchId && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{isWaha ? 'WAHA' : cloudStatus.provider === 'whatsflow' ? 'Whatsflow' : 'Meta Cloud'}</Badge>
                {isSessionProvider && <span>{cloudStatus.connected ? t('متصل', 'Connected') : t('غير متصل', 'Not connected')} · {cloudStatus.daily_used || 0}/{cloudStatus.daily_limit || 0} {t('اليوم', 'today')} · {cloudStatus.daily_remaining || 0} {t('متبقي', 'remaining')}</span>}
              </div>
            )}
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
              maxLength={4096}
              placeholder={t(`مثال: أهلاً ${NAME_TOKEN}، يسعدنا انضمامك لأكاديمية أداء الأبطال 🎉`, `e.g. Hi ${NAME_TOKEN}, welcome to Champions Academy 🎉`)}
              rows={5}
            />
            <div className="text-xs text-muted-foreground">{t(`عدد الأحرف: ${message.length}`, `Characters: ${message.length}`)}</div>

            <div className="rounded-lg border border-dashed p-3 space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Paperclip className="w-4 h-4" />
                {t('إرفاق حتى 10 صور أو ملف PDF واحد (اختياري)', 'Attach up to 10 images or one PDF (optional)')}
              </label>
              {(!attachment || attachment.type !== 'application/pdf') && attachments.length < 10 && (
                <Input
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                  onChange={event => {
                    const files = Array.from(event.target.files || []);
                    event.target.value = '';
                    if (!files.length) return;
                    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
                    if (files.some(file => !allowed.includes(file.type)
                      || file.size > (file.type === 'application/pdf' ? 20 * 1024 * 1024 : 5 * 1024 * 1024))) {
                      toast.error(t('يسمح بصور JPG/PNG حتى 5MB أو PDF حتى 20MB', 'Use JPG/PNG up to 5MB or PDF up to 20MB'));
                      return;
                    }
                    const hasPdf = files.some(file => file.type === 'application/pdf');
                    if ((hasPdf && (files.length > 1 || attachments.length))
                      || (attachment?.type === 'application/pdf' && files.length)) {
                      toast.error(t('لا يمكن خلط PDF مع الصور؛ اختر PDF واحداً فقط', 'PDF cannot be mixed with images; select one PDF only'));
                      return;
                    }
                    if (attachments.length + files.length > 10) {
                      toast.error(t('الحد الأقصى 10 صور', 'Maximum 10 images'));
                      return;
                    }
                    setAttachments(current => [...current, ...files]);
                    setRemoveStoredAttachment(false);
                  }}
                />
              )}
              {attachments.length > 0 && (
                <>
                  <p className="text-xs font-medium">
                    {t(`${attachments.length} مرفق — ترسل الصور بالترتيب كرسائل منفصلة`, `${attachments.length} attachment(s) — images send in order as separate messages`)}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                    {attachments.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${index}`} className="relative rounded-md border bg-muted/40 p-2 min-w-0">
                        {file.type === 'application/pdf'
                          ? <FileText className="w-10 h-10 mx-auto text-red-600" />
                          : <img src={attachmentPreviews[index]} alt="" className="w-full h-20 object-cover rounded" />}
                        <p className="text-xs font-medium truncate mt-1">{file.name}</p>
                        <p className="text-[10px] text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                        <Button type="button" variant="secondary" size="sm" className="absolute top-1 end-1 h-6 w-6 p-0" onClick={() => {
                          setAttachments(current => {
                            const next = current.filter((_, itemIndex) => itemIndex !== index);
                            if (storedAttachment && !next.length) setRemoveStoredAttachment(true);
                            return next;
                          });
                        }}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </>
              )}
             {isSessionProvider && <p className="text-xs text-amber-700">{t(`حد الإرسال اليومي مؤشر تشغيلي داخلي. يجب أن يكون اتصال ${isWaha ? 'WAHA' : 'Whatsflow'} جاهزاً قبل الإرسال.`, `The daily limit is an internal operating guard. ${isWaha ? 'WAHA' : 'Whatsflow'} must be connected before sending.`)}</p>}
             {whatsflowQuotaExhausted && <p className="text-xs text-red-700">{t('تم استنفاد حد إرسال Whatsflow اليومي؛ لا يمكن إضافة حملة جديدة حالياً.', 'The daily Whatsflow quota is exhausted; a new campaign cannot be queued right now.')}</p>}
             {!isSessionProvider && <p className="text-xs text-muted-foreground">
                {t(
                  'الصورة تحتاج قالب IMAGE معتمد، وPDF يحتاج قالب DOCUMENT معتمد في إعدادات الفرع.',
                  'Images require an approved IMAGE template; PDFs require an approved DOCUMENT template in branch settings.'
                )}
               </p>}
              {attachments.length > 1 && <p className="text-xs text-amber-700">
                {isSessionProvider
                  ? t('يضاف نص الرسالة إلى الصورة الأولى فقط؛ بقية الصور ترسل بلا تعليق.', 'The message captions only the first image; later images have no caption.')
                  : t('يتطلب قالب Meta متغير النص، لذلك يتكرر نص القالب مع كل صورة.', 'Meta’s approved template requires its body variable, so the template text repeats with every image.')}
              </p>}
            </div>

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

            <div className="flex flex-wrap gap-2">
            <Button
              onClick={sendViaCloudApi}
                disabled={!validItems.length || !message.trim() || messageTooLong || cloudSending || campaignLoading || audienceLoading || (audience !== 'pasted' && dynamicAudienceBranch !== branchId) || cloudStatus.loading || !cloudStatus.enabled || whatsflowQuotaExhausted || (isSessionProvider ? (!cloudStatus.configured || !cloudStatus.connected) : !selectedTemplateReady)}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Send className="w-4 h-4 ml-1" />
              {cloudSending && <Loader2 className="w-4 h-4 me-1 animate-spin" />}
              {t(`إرسال ${automaticMessageCount} رسالة إلى ${validItems.length} رقم`, `Send ${automaticMessageCount} message(s) to ${validItems.length}`)}
            </Button>
            <Button onClick={startSend} variant="outline" disabled={!validItems.length || waQueue.length > 0 || cloudSending || campaignLoading || audienceLoading || (audience !== 'pasted' && dynamicAudienceBranch !== branchId)}>
              <MessageCircle className="w-4 h-4 ml-1" />
              {t('فتح واتساب يدوياً', 'Open WhatsApp manually')}
            </Button>
            </div>
            {cloudJobs.length > 0 && (
              <div className="mt-4 space-y-2 max-h-[560px] overflow-y-auto" data-testid="cloud-job-progress">
                {cloudJobs.map(job => (
                  <div key={job.id || job.job_id} className="rounded-md border p-3 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium">
                        {job.campaign_name || job.campaign_title || job.name || t('حملة تلقائية', 'Automatic campaign')} · {
                          ['initializing', 'processing'].includes(String(job.status || '').toLowerCase())
                            ? t('معلّق', 'Pending')
                            : String(job.status || '').toLowerCase() === 'partial'
                              ? t('جزئي', 'Partial')
                              : job.status
                        }
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0"
                        onClick={() => setReportJob(job)}
                        disabled={!job.id && !job.job_id}
                        aria-label={t('عرض تقرير الحملة', 'View campaign report')}
                      >
                        <FileText className="w-3 h-3 me-1" />
                        {t('التقرير', 'Report')}
                      </Button>
                     </div>
                    <div className="mt-1 text-muted-foreground">
                      {t('معلّق', 'Pending')}: {job.pending || 0} · {t('تم', 'Sent')}: {job.sent || 0} · {t('فشل', 'Failed')}: {job.failed || 0} · {t('غير معروف', 'Unknown')}: {job.unknown || 0}
                    </div>
                    {job.lane_frozen && (
                      <div className="mt-2 rounded bg-amber-50 p-2 text-amber-900">
                        {t(
                          'تم تجميد الإرسال لأن نتيجة عملية سابقة غير مؤكدة. تحقق لدى المزود أولاً؛ قد تكون الرسالة وصلت.',
                          'Sending is frozen because an earlier outcome is uncertain. Check the provider first; the message may have been delivered.'
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 block"
                          onClick={async () => {
                            if (!window.confirm(t(
                              'أكد فقط بعد التحقق من عدم وجود إرسال جارٍ. إعادة التفعيل لا تعيد الرسالة غير المعروفة.',
                              'Confirm only after verifying no send is still in flight. Recovery will not retry unknown messages.'
                            ))) return;
                            try {
                              await whatsappAPI.reconcileBranchCloudLane(branchId);
                              setCloudJobsPollVersion(value => value + 1);
                            } catch (error) {
                              toast.error(apiErrorMessage(error, t('تعذرت إعادة التفعيل', 'Could not recover the lane')));
                            }
                          }}
                        >{t('تحققت — إعادة تفعيل قائمة الفرع', 'Verified — recover branch queue')}</Button>
                      </div>
                    )}
                    {(job.pending > 0) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={async () => {
                          try {
                            const response = await whatsappAPI.cancelBranchCloudJob(branchId, job.id);
                            setCloudJobs(current => current.map(value => value.id === job.id ? response.data : value));
                            toast.success(t('أُلغي المتبقي المعلّق فقط؛ لا يمكن سحب الرسالة قيد الإرسال', 'Only remaining pending messages were cancelled; an in-flight send cannot be undone'));
                          } catch (error) {
                            toast.error(apiErrorMessage(error, t('تعذر الإلغاء', 'Could not cancel')));
                          }
                        }}
                      >{t('إلغاء المتبقي', 'Cancel remaining')}</Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <WhatsAppCampaignWorkflow branchId={branchId} items={items} message={message} defaultName={defaultName}
          audience={audience} onSave={saveCampaign} onMessage={setMessage} scheduleAt={proposedSendAt} onSchedule={setProposedSendAt} />
        <WhatsAppCampaignReport
          branchId={branchId}
          job={reportJob}
          open={Boolean(reportJob)}
          onOpenChange={open => { if (!open) setReportJob(null); }}
          language={language}
          branchName={branches.find(branch => branch.id === branchId)?.name}
          campaignName={campaignName}
        />

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
