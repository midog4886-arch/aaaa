import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MemberQRCard from '../MemberQRCard';

jest.mock('html2canvas', () => jest.fn());
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));
jest.mock('../../../services/branding', () => ({
  getAcademyLogoUrl: () => '/academy-logo.png',
  getAcademyName: () => 'Test Academy',
  useBrandColor: () => '',
}));
jest.mock('../../../utils/memberQR', () => ({ getMemberQRValue: (code) => `stable:${code}` }));
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
    Smartphone: Icon, Calendar: Icon, Clock: Icon, CheckCircle: Icon, ShieldCheck: Icon, Phone: Icon,
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

describe('MemberQRCard previous membership card design', () => {
  test('saveable card includes the member photo and active-status presentation', async () => {
    render(<MemberQRCard />);

    const digitalCard = await screen.findByTestId('digital-membership-card');
    await waitFor(() => expect(screen.getByText('Sunday 6pm')).toBeInTheDocument());

    expect(within(digitalCard).getByText('عضو الاختبار')).toBeInTheDocument();
    expect(within(digitalCard).getAllByText('#GC-100')).toHaveLength(2);
    expect(within(digitalCard).getByTestId('qr-code')).toHaveAttribute('data-value', 'stable:GC-100');
    expect(within(digitalCard).getByText('0501234567')).toBeInTheDocument();
    expect(within(digitalCard).getByText(/عضو ساري/)).toBeInTheDocument();
    expect(within(digitalCard).queryByText('Sunday 6pm')).not.toBeInTheDocument();
    expect(within(digitalCard).queryByText('2030-01-01')).not.toBeInTheDocument();
    expect(within(digitalCard).queryByText('2030-02-01')).not.toBeInTheDocument();
    expect(within(digitalCard).getByRole('img', { name: /عضو الاختبار/i })).toHaveAttribute('src', '/member-photo.jpg');
  });

  test('prints the previous landscape card with subscription dates and schedule', async () => {
    const write = jest.fn();
    const close = jest.fn();
    const open = jest.spyOn(window, 'open').mockReturnValue({ document: { write, close } });

    render(<MemberQRCard />);
    await screen.findByTestId('digital-membership-card');
    fireEvent.click(screen.getByRole('button', { name: /طباعة الملصقات/ }));

    expect(open).toHaveBeenCalled();
    const html = write.mock.calls[0][0];
    expect(html).toContain('width:90mm;height:60mm');
    expect(html).toContain('2030-01-01');
    expect(html).toContain('2030-02-01');
    expect(html).toContain('Sunday 6pm');
    expect(html).toContain('stable%3AGC-100');
    expect(close).toHaveBeenCalled();
    open.mockRestore();
  });
});