import axios from 'axios';
import '../api';

const rejectedRequest = detail =>
  axios.get('/api/invoices/payment-conflict-interceptor-test', {
    adapter: () => Promise.reject({ response: { status: 409, data: { detail } } }),
  }).catch(error => error);

test('only recorded-payment sync conflict becomes a displayable message; structured evidence survives', async () => {
  const detail = {
    code: 'payment_recorded_subscription_conflict', payment_recorded: true,
    invoice_id: 'invoice-5', member_id: 'member-8',
    message: 'تم تسجيل الدفع، لكن الاشتراك تغير. لا تكرر الدفع.',
  };
  const error = await rejectedRequest(detail);
  expect(error.response.data.detail).toBe(detail.message);
  expect(error.paymentRecordedSubscriptionConflict).toBe(detail);
  expect(error.response.data.structured_detail).toBe(detail);
});

test('other structured errors and non-recorded conflicts remain untouched', async () => {
  const other = { code: 'subscription_conflict', message: 'some conflict' };
  const notRecorded = { code: 'payment_recorded_subscription_conflict', payment_recorded: false, message: 'unpaid' };
  for (const detail of [other, notRecorded]) {
    const error = await rejectedRequest(detail);
    expect(error.response.data.detail).toBe(detail);
    expect(error.paymentRecordedSubscriptionConflict).toBeUndefined();
  }
});