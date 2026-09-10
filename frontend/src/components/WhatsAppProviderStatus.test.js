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
  [{ connected: false, status: 'unavailable' }, 'تعذّر التحقق من الاتصال'],
])('shows the actual connection state', (status, label) => {
  render(<WhatsAppProviderStatus language="ar" status={status} />);
  expect(screen.getByText(label)).toBeTruthy();
});