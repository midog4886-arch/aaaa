import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import html2canvas from 'html2canvas';
import MemberCertificates from './MemberCertificates';
import { memberAPI } from './MemberLayout';
import { Capacitor, registerPlugin } from '@capacitor/core';

jest.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: jest.fn(() => false), isPluginAvailable: jest.fn(() => false) },
  registerPlugin: jest.fn(() => ({ savePdf: jest.fn().mockResolvedValue({}) })),
}));

jest.mock('./MemberLayout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  memberAPI: { get: jest.fn() },
}));
jest.mock('../../components/levels/LevelCertificateSheet', () => ({
  __esModule: true,
  default: require('react').forwardRef(({ certificate }, ref) => <div ref={ref} className="level-certificate-sheet"><strong>{certificate.member_name}</strong><span>{certificate.member_name_en}</span></div>),
}));
jest.mock('html2canvas', () => jest.fn());
jest.mock('jspdf', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ addImage: jest.fn(), output: () => new Blob(['pdf'], { type: 'application/pdf' }) })),
}));

beforeEach(() => {
  Capacitor.isNativePlatform.mockReturnValue(false);
  Capacitor.isPluginAvailable.mockReturnValue(false);
});

test('member can download or open one PDF and distinguish certificates with the same name', async () => {
  URL.createObjectURL = jest.fn(() => 'blob:certificate-pdf');
  URL.revokeObjectURL = jest.fn();
  html2canvas.mockResolvedValue({ toDataURL: () => 'data:image/png;base64,AA==' });
  memberAPI.get.mockImplementation(path => Promise.resolve({ data: path.includes('level-certificates') ? [] : [
    { id: 'aaaa1111-0000', student_name_ar: 'محمد', student_name_en: 'Mohammed', issued_at: '2026-09-30T12:00:00Z' },
    { id: 'bbbb2222-0000', student_name_ar: 'محمد', student_name_en: 'Mohammed', issued_at: '2026-09-29T12:00:00Z' },
  ] }));

  render(<MemoryRouter><MemberCertificates /></MemoryRouter>);
  const downloadClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await waitFor(() => expect(screen.getByRole('button', { name: 'حفظ PDF' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'حفظ PDF' }));
  await waitFor(() => expect(downloadClick).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('link', { name: 'فتح PDF للطباعة' })).toHaveAttribute('target', '_blank');
  expect(screen.getByRole('button', { name: /#aaaa1111/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /#bbbb2222/ })).toBeInTheDocument();
  downloadClick.mockRestore();
});

test('installed Android app uses the system file picker instead of a blob download', async () => {
  Capacitor.isNativePlatform.mockReturnValue(true);
  Capacitor.isPluginAvailable.mockReturnValue(true);
  URL.createObjectURL = jest.fn(() => 'blob:certificate-pdf');
  URL.revokeObjectURL = jest.fn();
  html2canvas.mockResolvedValue({ toDataURL: () => 'data:image/png;base64,AA==' });
  memberAPI.get.mockImplementation(path => Promise.resolve({ data: path.includes('level-certificates') ? [] : [
    { id: 'aaaa1111-0000', student_name_ar: 'محمد', student_name_en: 'Mohammed', issued_at: '2026-09-30T12:00:00Z' },
  ] }));
  const originalFileReader = global.FileReader;
  global.FileReader = class {
    readAsDataURL() { this.result = 'data:application/pdf;base64,cGRm'; this.onload(); }
  };
  try {
    render(<MemoryRouter><MemberCertificates /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'حفظ PDF' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'حفظ PDF' }));
    await waitFor(() => expect(registerPlugin.mock.results[0].value.savePdf).toHaveBeenCalledWith({
      filename: 'certificate-aaaa1111-0000.pdf', data: 'cGRm',
    }));
  } finally {
    global.FileReader = originalFileReader;
  }
});

test('older app shares the PDF when its WebView supports file sharing', async () => {
  Capacitor.isNativePlatform.mockReturnValue(true);
  Capacitor.isPluginAvailable.mockReturnValue(false);
  URL.createObjectURL = jest.fn(() => 'blob:certificate-pdf');
  URL.revokeObjectURL = jest.fn();
  html2canvas.mockResolvedValue({ toDataURL: () => 'data:image/png;base64,AA==' });
  memberAPI.get.mockImplementation(path => Promise.resolve({ data: path.includes('level-certificates') ? [] : [
    { id: 'aaaa1111-0000', student_name_ar: 'محمد', student_name_en: 'Mohammed', issued_at: '2026-09-30T12:00:00Z' },
  ] }));
  const canShare = jest.fn(() => true);
  const share = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  try {
    render(<MemoryRouter><MemberCertificates /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'حفظ PDF' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'حفظ PDF' }));
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.any(File)] })));
  } finally {
    delete navigator.canShare;
    delete navigator.share;
  }
});
