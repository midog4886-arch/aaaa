import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import MemberQRCard from '../MemberQRCard';

jest.mock('html2canvas', () => jest.fn());
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));
jest.mock('../../../services/branding', () => ({
  getAcademyLogoUrl: () => '/academy-logo.png',
  getAcademyName: () => 'Test Academy',
  useBrandColor: () => '',
}));
jest.mock('../../../utils/memberQR', () => ({ getMemberQRValue: (code) => `stable:${code}` }));
jest.mock('../../../utils/permanentMemberCard', () => ({
  openPermanentMemberCardPrint: jest.fn(),
  getPermanentMemberCardDetails: (member = {}) => ({
    activityNames: [...new Set((member.activities || member.active_activities || [])
      .map((activity) => typeof activity === 'string'
        ? activity
        : activity.activity_name || activity.name_ar || activity.name || '')
      .map((name) => name.trim())
      .filter(Boolean))],
    guardianPhone: member.guardian_phone || member.parent_phone || member.phone || '',
  }),
}));

jest.mock('../../../components/ui/card', () => {
  const React = require('react');
  return {
    Card: React.forwardRef(({ children, ...props }, ref) => <section ref={ref} {...props}>{children}</section>),
    CardContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  };
});
jest.mock('../../../components/ui/button', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../../components/ui/dialog', () => ({
  Dialog: ({ children }) => <div>{children}</div>,
  DialogContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
}));
jest.mock('qrcode.react', () => ({ QRCodeSVG: ({ value }) => <div data-testid="qr-code" data-value={value} /> }));
jest.mock('lucide-react', () => {
  const Icon = () => <span />;
  return {
    Download: Icon, Printer: Icon, Loader2: Icon, QrCode: Icon, Share2: Icon,
    Smartphone: Icon, Calendar: Icon, Clock: Icon, CheckCircle: Icon, Phone: Icon,
  };
});
jest.mock('../MemberLayout', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children }) => <main>{children}</main>,
    getMemberData: () => ({ name_ar: 'عضو الاختبار' }),
    getDarkMode: () => false,
    getLanguage: () => 'ar',
    memberAPI: {
      get: jest.fn(() => Promise.resolve({
        data: {
          member_code: 'GC-100',
          name_ar: 'عضو الاختبار',
          photo: '/member-photo.jpg',
          phone: '0501234567',
          active_activities: [{
            activity_name: 'السباحة',
            start_date: '2030-01-01',
            end_date: '2030-02-01',
            schedule: 'Sunday 6pm',
          }],
        },
      })),
    },
  };
});

describe('MemberQRCard digital permanent card', () => {
  test('captures only permanent identity data; photo and subscriptions remain outside cardRef', async () => {
    render(<MemberQRCard />);

    const digitalCard = await screen.findByTestId('digital-membership-card');
    await waitFor(() => expect(screen.getByText('Sunday 6pm')).toBeInTheDocument());

    expect(within(digitalCard).getByText('عضو الاختبار')).toBeInTheDocument();
    expect(within(digitalCard).getByText('#GC-100')).toBeInTheDocument();
    expect(within(digitalCard).getByTestId('qr-code')).toHaveAttribute('data-value', 'stable:GC-100');
    expect(within(digitalCard).getByText('السباحة')).toBeInTheDocument();
    expect(within(digitalCard).getByText('0501234567')).toBeInTheDocument();
    expect(within(digitalCard).queryByText('Sunday 6pm')).not.toBeInTheDocument();
    expect(within(digitalCard).queryByText('2030-01-01')).not.toBeInTheDocument();
    expect(within(digitalCard).queryByText('2030-02-01')).not.toBeInTheDocument();
    expect(within(digitalCard).queryByRole('img', { name: /عضو الاختبار/i })).not.toBeInTheDocument();
    expect(digitalCard.querySelector('img[src="/member-photo.jpg"]')).toBeNull();
  });
});