import { buildMemberSchedule } from '../../components/ScheduleDaysTimeEditor';

export const renewalTotals = (primary, extras, discount = 0) => {
  const subtotal = [primary, ...(extras || [])].reduce((sum, row) => sum + (Number(row.fee) || 0), 0);
  const vat = Math.round(subtotal * 15) / 100;
  const appliedDiscount = Math.round((Number(discount) || 0) * 100) / 100;
  return {
    subtotal,
    vat,
    discount: appliedDiscount,
    total: Math.max(Math.round((subtotal + vat - appliedDiscount) * 100) / 100, 0),
  };
};

export const renewalCouponInput = (primary, extras, fallbackActivityId = '') => ({
  amount: renewalTotals(primary, extras).subtotal,
  activityIds: [
    primary.activity_id || fallbackActivityId,
    ...(extras || []).map((row) => row.activity_id),
  ].filter(Boolean),
});

export const shouldDeferPrimaryRenewal = (primaryActivityId, originalActivityId, startDate, today) =>
  primaryActivityId === originalActivityId && Boolean(startDate) && startDate > today;

export const activitySchedule = (row) =>
  buildMemberSchedule(row.training_days || [], row.training_time || '', row.day_times || {});

export const scheduleTimeFromText = (schedule) => {
  const match = `${schedule || ''}`.match(/(\d{1,2})(?::(\d{2}))?\s*(ص|م|am|pm)?/i);
  if (!match) return '';
  let hour = Number(match[1]);
  const minute = match[2] || '00';
  const marker = (match[3] || '').toLowerCase();
  if ((marker === 'م' || marker === 'pm') && hour < 12) hour += 12;
  if ((marker === 'ص' || marker === 'am') && hour === 12) hour = 0;
  if (hour > 23) return '';
  return `${String(hour).padStart(2, '0')}:${minute}`;
};

export const validateRenewalRows = (rows, existingActivities, originalActivityId) => {
  const seen = new Set();
  const existing = new Set((existingActivities || []).map((a) => a.activity_id).filter(Boolean));
  for (const [index, row] of rows.entries()) {
    if (!row.activity_id) return `Activity is required for row ${index + 1}`;
    if (seen.has(row.activity_id)) return 'Each activity may only be selected once';
    seen.add(row.activity_id);
    if (existing.has(row.activity_id) && !(index === 0 && row.activity_id === originalActivityId)) {
      return 'The member is already subscribed to one of the selected activities';
    }
    if (!row.start_date || !row.end_date || row.end_date < row.start_date) {
      return `Valid start and end dates are required for row ${index + 1}`;
    }
    if (!Number.isFinite(Number(row.weeks)) || Number(row.weeks) < 1) return `Valid weeks are required for row ${index + 1}`;
    if (row.fee === '' || row.fee === null || row.fee === undefined || !Number.isFinite(Number(row.fee)) || Number(row.fee) < 0) {
      return `Valid fee is required for row ${index + 1}`;
    }
    if (!row.training_days?.length) return `Training days are required for row ${index + 1}`;
    const missingTime = row.training_days.some((day) => !(row.day_times?.[day] || row.training_time || '').trim());
    if (missingTime) return `A training time is required for every selected day in row ${index + 1}`;
  }
  return '';
};

export const localizedRenewalValidation = (error, language) => {
  if (!error || language !== 'ar') return error;
  const row = error.match(/row (\d+)/)?.[1] || '';
  const suffix = row ? ` في الصف ${row}` : '';
  if (error.includes('Activity is required')) return `النشاط مطلوب${suffix}`;
  if (error.includes('only be selected once')) return 'يجب اختيار كل نشاط مرة واحدة فقط';
  if (error.includes('already subscribed')) return 'العضو مشترك بالفعل في أحد الأنشطة المحددة';
  if (error.includes('start and end dates')) return `يجب إدخال تاريخ بداية ونهاية صحيحين${suffix}`;
  if (error.includes('weeks')) return `يجب إدخال عدد أسابيع صحيح${suffix}`;
  if (error.includes('fee')) return `يجب إدخال رسوم صحيحة ولا يمكن تركها فارغة${suffix}`;
  if (error.includes('Training days')) return `يجب اختيار أيام التدريب${suffix}`;
  if (error.includes('training time')) return `يجب إدخال موعد لكل يوم تدريب محدد${suffix}`;
  return 'بيانات التجديد غير مكتملة';
};

// Shared by the real submit handler and its flow regression tests. The mutable
// progress object deliberately survives a rejected request.
export const persistRenewalActivities = async ({
  progress,
  invoiceData,
  rows,
  createInvoice,
  savePrimary,
  addExtra,
}) => {
  if (!progress.invoiceId) {
    const response = await createInvoice(invoiceData);
    progress.invoiceId = response.data?.id;
    if (!progress.invoiceId) throw new Error('Invoice was created without an ID');
    progress.rows = JSON.parse(JSON.stringify(rows));
  }
  const lockedRows = progress.rows || rows;
  if (!progress.completed.has('primary')) {
    await savePrimary(progress.invoiceId, lockedRows[0]);
    progress.completed.add('primary');
  }
  for (const extra of lockedRows.slice(1)) {
    const key = `extra:${extra.activity_id}`;
    if (progress.completed.has(key)) continue;
    await addExtra(progress.invoiceId, extra);
    progress.completed.add(key);
  }
  return { invoiceId: progress.invoiceId, rows: lockedRows };
};

export const toInvoiceItem = (row) => ({
  activity_id: row.activity_id,
  activity_name: row.activity_name,
  fee: Number(row.fee),
  period: `${row.start_date} - ${row.end_date}`,
  start_date: row.start_date,
  end_date: row.end_date,
  schedule: activitySchedule(row),
  training_days: row.training_days || [],
  training_time: row.training_time || '',
  day_times: row.day_times || {},
  level_id: row.level_id || '',
  is_product: false,
});

export const newAdditionalActivity = (startDate = '') => ({
  activity_id: '',
  activity_name: '',
  start_date: startDate,
  end_date: '',
  weeks: 4,
  training_days: [],
  training_time: '',
  day_times: {},
  level_id: '',
  fee: '',
});