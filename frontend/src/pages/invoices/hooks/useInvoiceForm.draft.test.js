import React from 'react';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { useInvoiceForm } from './useInvoiceForm';

jest.mock('sonner', () => ({
  toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() },
}));

const TestHarness = () => {
  const form = useInvoiceForm({
    members: [],
    activities: [],
    products: [],
    levels: [],
    selectedBranchId: 'all',
    language: 'ar',
    t: value => value,
    loadData: jest.fn(),
    setIsViewDialogOpen: jest.fn(),
    setIsAddMemberDialogOpen: jest.fn(),
    setAddMemberSource: jest.fn(),
    setQrCardMember: jest.fn(),
    setQrCardSubscription: jest.fn(),
    setIsQRCardDialogOpen: jest.fn(),
  });
  return (
    <>
      <button onClick={form.openCreateDialog}>open</button>
      <button onClick={form.discardDraftAndReset}>discard</button>
      <span data-testid="registration-request-id">{form.registrationRequestId}</span>
    </>
  );
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

test('restores registration request id with an invoice draft and clears it on discard', async () => {
  localStorage.setItem('invoiceCreateDraft_v1', JSON.stringify({
    invoiceItems: [{ activity_name: 'Ball', fee: 100 }],
    customerNameAr: 'سارة',
    registrationRequestId: 'request-draft-1',
    savedAt: Date.now(),
  }));

  render(<TestHarness />);
  fireEvent.click(screen.getByText('open'));

  await waitFor(() => {
    expect(screen.getByTestId('registration-request-id').textContent).toBe('request-draft-1');
  });
  expect(localStorage.getItem('invoiceCreateDraft_v1')).toContain('request-draft-1');

  fireEvent.click(screen.getByText('discard'));
  await waitFor(() => {
    expect(localStorage.getItem('invoiceCreateDraft_v1')).toBeNull();
    expect(screen.getByTestId('registration-request-id').textContent).toBe('');
  });
});