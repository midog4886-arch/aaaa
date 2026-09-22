import {
  newAdditionalActivity,
  localizedRenewalValidation,
  persistRenewalActivities,
  renewalCouponInput,
  renewalTotals,
  shouldDeferPrimaryRenewal,
  scheduleTimeFromText,
  toInvoiceItem,
  validateRenewalRows,
} from '../renewalActivities';

const row = (id, fee = 100) => ({
  ...newAdditionalActivity('2026-05-01'),
  activity_id: id,
  activity_name: id,
  fee,
  weeks: 4,
  end_date: '2026-05-29',
  training_days: ['الأحد', 'الثلاثاء'],
  training_time: '17:00',
  day_times: { الأحد: '17:00', الثلاثاء: '18:00' },
});

describe('renewal additional activity helpers', () => {
  test('aggregates primary and two extras, VAT, then discount', () => {
    expect(renewalTotals(row('a', 100), [row('b', 50), row('c', 25)], 10)).toEqual({
      subtotal: 175,
      vat: 26.25,
      discount: 10,
      total: 191.25,
    });
  });

  test('removing an extra immediately changes totals', () => {
    const extras = [row('b', 50), row('c', 25)];
    expect(renewalTotals(row('a'), extras).subtotal).toBe(175);
    expect(renewalTotals(row('a'), extras.filter((x) => x.activity_id !== 'b')).subtotal).toBe(125);
  });

  test('rejects duplicate selections and existing member activities', () => {
    expect(validateRenewalRows([row('a'), row('a')], [], 'a')).toMatch(/only be selected once/);
    expect(validateRenewalRows([row('a'), row('b')], [{ activity_id: 'b' }], 'a')).toMatch(/already subscribed/);
  });

  test('requires dates, fee and a time for every selected schedule day', () => {
    expect(validateRenewalRows([{ ...row('a'), day_times: {}, training_time: '' }], [], 'a')).toMatch(/training time/);
    expect(validateRenewalRows([{ ...row('a'), end_date: '' }], [], 'a')).toMatch(/start and end/);
    expect(validateRenewalRows([{ ...row('a'), fee: -1 }], [], 'a')).toMatch(/fee/);
    expect(validateRenewalRows([{ ...row('a'), fee: '' }], [], 'a')).toMatch(/fee/);
    expect(localizedRenewalValidation('Valid fee is required for row 2', 'ar')).toBe('يجب إدخال رسوم صحيحة ولا يمكن تركها فارغة في الصف 2');
  });

  test('builds structured invoice schedule payload for extras', () => {
    expect(toInvoiceItem(row('b'))).toMatchObject({
      activity_id: 'b',
      start_date: '2026-05-01',
      end_date: '2026-05-29',
      training_days: ['الأحد', 'الثلاثاء'],
      training_time: '17:00',
      day_times: { الأحد: '17:00', الثلاثاء: '18:00' },
      is_product: false,
    });
  });

  test('coupon validation receives combined fee and every activity ID', () => {
    expect(renewalCouponInput(row('a', 100), [row('b', 50), row('c', 25)])).toEqual({
      amount: 175,
      activityIds: ['a', 'b', 'c'],
    });
  });

  test('preserves the current same-activity subscription for a future period', () => {
    expect(shouldDeferPrimaryRenewal('a', 'a', '2026-06-01', '2026-05-01')).toBe(true);
    expect(shouldDeferPrimaryRenewal('b', 'a', '2026-06-01', '2026-05-01')).toBe(false);
    expect(shouldDeferPrimaryRenewal('a', 'a', '2026-04-01', '2026-05-01')).toBe(false);
  });

  test('parses a legacy human-readable time for the primary renewal editor', () => {
    expect(scheduleTimeFromText('الأحد والثلاثاء 5:30 م')).toBe('17:30');
    expect(scheduleTimeFromText('Monday 9 AM')).toBe('09:00');
  });

  test('real save flow creates one invoice and persists two extras', async () => {
    const progress = { invoiceId: '', completed: new Set(), rows: null };
    const createInvoice = jest.fn().mockResolvedValue({ data: { id: 'invoice-1' } });
    const savePrimary = jest.fn().mockResolvedValue({});
    const addExtra = jest.fn().mockResolvedValue({});
    const rows = [row('a'), row('b'), row('c')];

    await persistRenewalActivities({ progress, invoiceData: { items: rows }, rows, createInvoice, savePrimary, addExtra });

    expect(createInvoice).toHaveBeenCalledTimes(1);
    expect(savePrimary).toHaveBeenCalledTimes(1);
    expect(addExtra.mock.calls.map((call) => call[1].activity_id)).toEqual(['b', 'c']);
  });

  test('retry after the second extra rejects reuses invoice and completed progress', async () => {
    const progress = { invoiceId: '', completed: new Set(), rows: null };
    const createInvoice = jest.fn().mockResolvedValue({ data: { id: 'invoice-1' } });
    const savePrimary = jest.fn().mockResolvedValue({});
    const addExtra = jest.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({});
    const rows = [row('a'), row('b'), row('c')];

    await expect(persistRenewalActivities({
      progress, invoiceData: { items: rows }, rows, createInvoice, savePrimary, addExtra,
    })).rejects.toThrow('network');
    // Simulate attempted edits: the locked invoice snapshot remains authoritative.
    const editedRows = [row('changed'), row('different')];
    const result = await persistRenewalActivities({
      progress, invoiceData: { items: editedRows }, rows: editedRows, createInvoice, savePrimary, addExtra,
    });

    expect(result.rows.map((item) => item.activity_id)).toEqual(['a', 'b', 'c']);
    expect(createInvoice).toHaveBeenCalledTimes(1);
    expect(savePrimary).toHaveBeenCalledTimes(1);
    expect(addExtra.mock.calls.map((call) => call[1].activity_id)).toEqual(['b', 'c', 'c']);
  });
});