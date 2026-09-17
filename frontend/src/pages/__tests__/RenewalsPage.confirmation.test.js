import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  RenewalSuccessDialog,
  buildRenewalConfirmationText,
  canOfferRenewalWhatsAppConfirmation,
} from '../RenewalsPage';

jest.mock('../../components/ui/dialog', () => {
  const React = require('react');
  const Dialog = ({ open, children }) => open ? <div role="dialog">{children}</div> : null;
  const Part = ({ children, ...props }) => <div {...props}>{children}</div>;
  return {
    Dialog,
    DialogContent: Part,
    DialogHeader: Part,
    DialogTitle: Part,
    DialogFooter: Part,
  };
});

jest.mock('../../components/ui/button', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

jest.mock('lucide-react', () => {
  const React = require('react');
  const Icon = (props) => <span {...props} />;
  return {
    RefreshCcw: Icon, Search: Icon, Bell: Icon, AlertTriangle: Icon,
    Clock: Icon, Calendar: Icon, Phone: Icon, Loader2: Icon,
    MessageCircle: Icon, Filter: Icon, X: Icon, CheckSquare: Icon,
    Square: Icon, Activity: Icon, History: Icon, CheckCircle2: Icon,
    XCircle: Icon,
  };
});

const RENEWAL = {
  member_name: 'سارة',
  phone: '0501234567',
  branch_id: 'branch-a',
  tenant_id: 'tenant-a',
  activity_name: 'السباحة',
  start_date: '2026-03-01',
  end_date: '2026-03-28',
  schedule: 'الأحد والثلاثاء 5:00 م',
};

const PHONE_AUTHORIZED_USER = {
  is_admin: false,
  tenant_id: 'tenant-a',
  branch_ids: ['branch-a'],
  permissions: ['member-phones'],
};

describe('renewal success confirmation safeguards', () => {
  test('builds an Arabic draft from the successful renewal dates and schedule', () => {
    const draft = buildRenewalConfirmationText(RENEWAL, 'ar');

    expect(draft).toContain('تم تجديد اشتراك السباحة بنجاح');
    expect(draft).toContain('من 2026/03/01 إلى 2026/03/28');
    expect(draft).toContain('مواعيد التدريب: الأحد والثلاثاء 5:00 م');
    expect(draft).toContain('بطاقة العضوية الحالية ما زالت سارية ولا تحتاج إلى إعادة طباعة');
  });

  test('permits the optional draft only for phone-authorized staff in the same tenant and branch', () => {
    expect(canOfferRenewalWhatsAppConfirmation(RENEWAL, PHONE_AUTHORIZED_USER, 'branch-a')).toBe(true);
    expect(canOfferRenewalWhatsAppConfirmation(
      RENEWAL,
      { ...PHONE_AUTHORIZED_USER, permissions: [] },
      'branch-a'
    )).toBe(false);
    expect(canOfferRenewalWhatsAppConfirmation(RENEWAL, PHONE_AUTHORIZED_USER, 'branch-b')).toBe(false);
    expect(canOfferRenewalWhatsAppConfirmation(
      RENEWAL,
      { ...PHONE_AUTHORIZED_USER, tenant_id: 'tenant-b' },
      'branch-a'
    )).toBe(false);
  });

  test('does not show a completion notice or optional draft for a failed renewal', () => {
    const openWhatsApp = jest.fn();
    render(
      <RenewalSuccessDialog
        renewal={null}
        language="ar"
        canOpenWhatsApp={false}
        onOpenWhatsApp={openWhatsApp}
        onClose={jest.fn()}
      />
    );

    expect(screen.queryByTestId('renewal-card-reuse-notice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('single-renewal-whatsapp-confirmation')).not.toBeInTheDocument();
    expect(openWhatsApp).not.toHaveBeenCalled();
  });

  test('shows the reusable-card notice after success but hides the draft for a forbidden phone', () => {
    const openWhatsApp = jest.fn();
    render(
      <RenewalSuccessDialog
        renewal={RENEWAL}
        language="ar"
        canOpenWhatsApp={false}
        onOpenWhatsApp={openWhatsApp}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByTestId('renewal-card-reuse-notice')).toHaveTextContent('لا تحتاج إلى إعادة طباعة');
    expect(screen.queryByTestId('single-renewal-whatsapp-confirmation')).not.toBeInTheDocument();
    expect(openWhatsApp).not.toHaveBeenCalled();
  });

  test('never opens a draft automatically; staff must explicitly click the optional action', () => {
    const openWhatsApp = jest.fn();
    render(
      <RenewalSuccessDialog
        renewal={RENEWAL}
        language="ar"
        canOpenWhatsApp
        onOpenWhatsApp={openWhatsApp}
        onClose={jest.fn()}
      />
    );

    expect(openWhatsApp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('single-renewal-whatsapp-confirmation'));
    expect(openWhatsApp).toHaveBeenCalledTimes(1);
  });
});