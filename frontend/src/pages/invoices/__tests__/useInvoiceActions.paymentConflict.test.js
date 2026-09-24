import { renderHook, act } from '@testing-library/react';
import { useInvoiceActions } from '../hooks/useInvoiceActions';
import { invoicesAPI } from '../../../services/api';
import { toast } from 'sonner';

jest.mock('../../../services/api', () => ({
  invoicesAPI: {
    pay: jest.fn(),
    getById: jest.fn(),
    getQR: jest.fn(),
  },
  creditNotesAPI: {},
  exportAPI: {},
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

beforeEach(() => jest.clearAllMocks());

test('already-recorded payment conflict displays no-repay message, refreshes, and blocks another payment', async () => {
  const detail = { code: 'payment_recorded_subscription_conflict', payment_recorded: true, invoice_id: 'invoice-5' };
  const message = 'تم تسجيل الدفع؛ لا تكرر الدفع وراجع الاشتراك.';
  invoicesAPI.pay.mockRejectedValue({
    paymentRecordedSubscriptionConflict: detail,
    response: { status: 409, data: { detail: message, structured_detail: detail } },
  });
  invoicesAPI.getById.mockResolvedValue({ data: { id: 'invoice-5', status: 'paid' } });
  const setInvoices = jest.fn();
  const loadData = jest.fn();
  const { result } = renderHook(() => useInvoiceActions({
    loadData, setInvoices, language: 'ar', t: key => key, isAdmin: true, getBranchName: () => '',
  }));
  await act(async () => { await result.current.handleMarkPaid('invoice-5'); });
  expect(toast.error).toHaveBeenCalledWith(message);
  expect(invoicesAPI.getById).toHaveBeenCalledWith('invoice-5');
  expect(loadData).toHaveBeenCalledTimes(1);
  expect(setInvoices).toHaveBeenCalledTimes(1);
  expect(setInvoices.mock.calls[0][0]([{ id: 'invoice-5', status: 'pending' }]))
    .toEqual([{ id: 'invoice-5', status: 'paid' }]);
  await act(async () => { await result.current.handleMarkPaid('invoice-5'); });
  expect(invoicesAPI.pay).toHaveBeenCalledTimes(1);
  expect(toast.success).not.toHaveBeenCalled();
});

test('unverified conflict remains blocked; ordinary errors do not mark an invoice paid', async () => {
  invoicesAPI.pay.mockRejectedValueOnce({
    paymentRecordedSubscriptionConflict: { payment_recorded: true },
    response: { data: { detail: 'تم الدفع؛ لا تكرر الدفع.' } },
  });
  invoicesAPI.getById.mockRejectedValueOnce(new Error('offline'));
  const loadData = jest.fn();
  const setInvoices = jest.fn();
  const { result } = renderHook(() => useInvoiceActions({
    loadData, setInvoices, language: 'ar', t: key => key, isAdmin: true, getBranchName: () => '',
  }));
  await act(async () => { await result.current.handleMarkPaid('invoice-5'); });
  expect(loadData).toHaveBeenCalledTimes(1);
  expect(setInvoices).not.toHaveBeenCalled();
  await act(async () => { await result.current.handleMarkPaid('invoice-5'); });
  expect(invoicesAPI.pay).toHaveBeenCalledTimes(1);
});