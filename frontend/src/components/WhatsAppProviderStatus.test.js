import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import WhatsAppProviderStatus from './WhatsAppProviderStatus';

afterEach(cleanup);
test('failed checks show an error rather than disconnected', () => {
  render(<WhatsAppProviderStatus language="ar" status={{ check_ok: false, connected: null, error: 'http_401' }} />);
  expect(screen.getByText('تعذّر التحقق من الاتصال')).toBeTruthy();
  expect(screen.queryByText('غير متصل')).toBeNull();
  expect(screen.getByText(/راجع مفتاح API/)).toBeTruthy();
});
test.each([
  [{ connected: true, status: 'open' }, 'متصل'],
  [{ connected: false, status: 'close' }, 'غير متصل'],
  [{ connected: false, status: 'connecting' }, 'جارٍ الاتصال'],
  [{ connected: false, status: 'STARTING' }, 'جارٍ الاتصال'],
  [{ connected: false, status: 'not_started', provider: 'waha' }, 'الجلسة لم تبدأ'],
  [{ connected: false, status: 'unavailable' }, 'تعذّر التحقق من الاتصال'],
])('shows the actual connection state', (status, label) => {
  render(<WhatsAppProviderStatus language="ar" status={status} />);
  expect(screen.getByText(label)).toBeTruthy();
});

test('missing WAHA session explains how to connect', () => {
  render(<WhatsAppProviderStatus language="ar" status={{ provider: 'waha', connected: false, status: 'not_started' }} />);
  expect(screen.getByText(/اضغط «بدء» لإنشاء الجلسة/)).toBeTruthy();
  expect(screen.queryByText(/INSTANCE/)).toBeNull();
});
