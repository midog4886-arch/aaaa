import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import GlobalSearch from '../GlobalSearch';
import { globalSearchAPI } from '../../services/api';

jest.mock('../../services/api', () => ({ globalSearchAPI: { search: jest.fn() } }));
jest.mock('../../contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }));
let mockBranch = 'north';
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ selectedBranchId: mockBranch, user: { id: 'staff', permissions: ['members'] }, isAdmin: false }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockBranch = 'north'; });
afterEach(() => jest.useRealTimers());
const results = name => ({ data: { members: [{ id: name, name }], invoices: [{ id: 'private', invoice_number: 'PRIVATE' }], activities: [] } });
const type = async value => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value } });
  await act(async () => { jest.advanceTimersByTime(300); });
};

test('ignores older searches and hides results outside permissions', async () => {
  let resolveOld;
  globalSearchAPI.search.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(results('Newest'));
  render(<GlobalSearch />);
  await type('old');
  await type('new');
  expect(screen.getByText('Newest')).toBeInTheDocument();
  expect(screen.queryByText(/PRIVATE/)).not.toBeInTheDocument();
  await act(async () => { resolveOld(results('Older')); });
  expect(screen.queryByText('Older')).not.toBeInTheDocument();
});

test('clears results when changing branches and ignores the pending response', async () => {
  let resolve;
  globalSearchAPI.search.mockImplementation(() => new Promise(next => { resolve = next; }));
  const view = render(<GlobalSearch />);
  await type('Lina');
  mockBranch = 'south'; view.rerender(<GlobalSearch />);
  await act(async () => { resolve(results('North member')); });
  expect(screen.queryByText('North member')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('');
});

test('shows a retry action on request failure', async () => {
  globalSearchAPI.search.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(results('Recovered'));
  render(<GlobalSearch />);
  await type('member');
  expect(screen.getByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Retry'));
  await act(async () => { jest.advanceTimersByTime(300); });
  expect(screen.getByText('Recovered')).toBeInTheDocument();
});
