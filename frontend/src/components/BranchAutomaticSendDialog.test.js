import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BranchAutomaticSendDialog from './BranchAutomaticSendDialog';
import { whatsappAPI, branchesAPI } from '../services/api';

jest.mock('../services/api', () => ({ whatsappAPI: { getBranchCloudAvailability: jest.fn(), sendBranchCloudBulk: jest.fn() }, branchesAPI: { getProviderStatus: jest.fn() } }));
const branches = [{ id: 'a', name: 'Branch A' }, { id: 'b', name: 'Branch B' }];
const members = [{ id: 'one', branch_id: 'a', phone: '0501234567', name: 'One' }, { id: 'family', branch_id: 'a', phone: '966501234567', name: 'Family' }, { id: 'two', branch_id: 'b', phone: '0507654321', name: 'Two' }];
const status = { provider: 'whatsflow', enabled: true, configured: true, connected: true };
beforeEach(() => {
  jest.clearAllMocks(); sessionStorage.clear();
  Object.defineProperty(window, 'crypto', { configurable: true, value: {} });
  let sequence = 0;
  Object.defineProperty(window.crypto, 'randomUUID', { configurable: true, value: jest.fn(() => `unique-request-id-${++sequence}`) });
  Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: { digest: jest.fn(async (_, data) => Uint8Array.from(require('crypto').createHash('sha256').update(data).digest()).buffer) } });
  global.TextEncoder = require('util').TextEncoder;
  whatsappAPI.getBranchCloudAvailability.mockResolvedValue({ data: status });
  branchesAPI.getProviderStatus.mockImplementation(async id => ({ data: { connected: id === 'a' } }));
  whatsappAPI.sendBranchCloudBulk.mockResolvedValue({ data: { id: 'job' } });
});
function open(recipients = members, keys = { current: new Map() }, onQueued = jest.fn()) {
  return render(<BranchAutomaticSendDialog recipients={recipients} branches={branches} message="Test message" language="ar" attemptKeys={keys} onClose={jest.fn()} onQueued={onQueued} />);
}
test('only connected branches queue; deduplicates family numbers and never opens WhatsApp', async () => {
  const windowOpen = jest.spyOn(window, 'open').mockImplementation(() => {});
  const queued = jest.fn(); open(members, { current: new Map() }, queued);
  const button = await screen.findByRole('button', { name: 'تأكيد الإرسال من الفروع المتصلة' });
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(whatsappAPI.sendBranchCloudBulk).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(queued).toHaveBeenCalledWith(['one', 'family']));
  expect(whatsappAPI.sendBranchCloudBulk).toHaveBeenCalledTimes(1);
  const [branch, payload] = whatsappAPI.sendBranchCloudBulk.mock.calls[0];
  expect(branch).toBe('a'); expect(payload).toHaveLength(1); expect(payload[0].phone).toBe('966501234567');
  expect(windowOpen).not.toHaveBeenCalled(); windowOpen.mockRestore();
});
test('connection lost after preview prevents enqueue', async () => {
  open([members[0]]);
  const button = await screen.findByRole('button', { name: 'تأكيد الإرسال من الفروع المتصلة' });
  await waitFor(() => expect(button.disabled).toBe(false));
  branchesAPI.getProviderStatus.mockResolvedValue({ data: { connected: false } });
  fireEvent.click(button);
  await screen.findByText('غير متصل أو غير مهيأ — لن يُرسل تلقائيًا');
  expect(whatsappAPI.sendBranchCloudBulk).not.toHaveBeenCalled();
});
test('ambiguous enqueue retry uses the same idempotency key', async () => {
  whatsappAPI.sendBranchCloudBulk.mockRejectedValueOnce(new Error('response lost'));
  const queued = jest.fn(); open([members[0]], { current: new Map() }, queued);
  const button = await screen.findByRole('button', { name: 'تأكيد الإرسال من الفروع المتصلة' });
  await waitFor(() => expect(button.disabled).toBe(false)); fireEvent.click(button);
  const retry = await screen.findByRole('button', { name: 'إعادة التحقق بنفس المحاولة' });
  fireEvent.click(retry);
  await waitFor(() => expect(queued).toHaveBeenCalled());
  expect(whatsappAPI.sendBranchCloudBulk.mock.calls[0][2]).toBe(whatsappAPI.sendBranchCloudBulk.mock.calls[1][2]);
});
test('large selections split at 200; queue state and keys survive closing and reopening', async () => {
  const large = Array.from({ length: 201 }, (_, i) => ({ id: `m${i}`, branch_id: 'a', phone: `9665${String(i).padStart(8, '0')}`, name: `Member ${i}` }));
  const first = open(large);
  let button = await screen.findByRole('button', { name: 'تأكيد الإرسال من الفروع المتصلة' });
  await waitFor(() => expect(button.disabled).toBe(false)); fireEvent.click(button);
  await waitFor(() => expect(whatsappAPI.sendBranchCloudBulk).toHaveBeenCalledTimes(2));
  expect(whatsappAPI.sendBranchCloudBulk.mock.calls[0][1]).toHaveLength(200);
  expect(whatsappAPI.sendBranchCloudBulk.mock.calls[1][1]).toHaveLength(1);
  const keys = whatsappAPI.sendBranchCloudBulk.mock.calls.map(call => call[2]);
  expect(keys[0]).not.toBe(keys[1]);
  await waitFor(() => expect(screen.getByText(/أضيف لقائمة الإرسال/).textContent).toContain('201'));
  first.unmount(); open(large);
  button = await screen.findByRole('button', { name: 'تأكيد الإرسال من الفروع المتصلة' });
  await waitFor(() => expect(button.disabled).toBe(false)); fireEvent.click(button);
  await waitFor(() => expect(whatsappAPI.sendBranchCloudBulk).toHaveBeenCalledTimes(4));
  expect(whatsappAPI.sendBranchCloudBulk.mock.calls.slice(2).map(call => call[2])).toEqual(keys);
});
