import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import html2canvas from 'html2canvas';
import MemberCertificates from './MemberCertificates';
import { memberAPI } from './MemberLayout';

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

test('member can save or open a real PDF and distinguish certificates with the same name', async () => {
  URL.createObjectURL = jest.fn(() => 'blob:certificate-pdf');
  URL.revokeObjectURL = jest.fn();
  html2canvas.mockResolvedValue({ toDataURL: () => 'data:image/png;base64,AA==' });
  memberAPI.get.mockImplementation(path => Promise.resolve({ data: path.includes('level-certificates') ? [] : [
    { id: 'aaaa1111-0000', student_name_ar: 'محمد', student_name_en: 'Mohammed', issued_at: '2026-09-30T12:00:00Z' },
    { id: 'bbbb2222-0000', student_name_ar: 'محمد', student_name_en: 'Mohammed', issued_at: '2026-09-29T12:00:00Z' },
  ] }));

  render(<MemoryRouter><MemberCertificates /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole('link', { name: 'حفظ PDF' })).toHaveAttribute('href', 'blob:certificate-pdf'));
  expect(screen.getByRole('link', { name: 'فتح PDF للطباعة' })).toHaveAttribute('target', '_blank');
  expect(screen.getByRole('button', { name: /#aaaa1111/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /#bbbb2222/ })).toBeInTheDocument();
});
