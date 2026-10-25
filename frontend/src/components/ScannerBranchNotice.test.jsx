import React from 'react';
import { render, screen } from '@testing-library/react';
import ScannerBranchNotice from './ScannerBranchNotice';

const member = { branch_id: 'branch-b', branch_name: 'فرع السباحة', scanBranchId: 'branch-a' };

test('shows the member branch to an authorized multi-branch supervisor', () => {
  render(<ScannerBranchNotice member={member} user={{ branch_ids: ['branch-a', 'branch-b'] }} isAdmin={false} />);
  expect(screen.getByRole('alert')).toHaveTextContent('سيتم تسجيل حضوره في فرعه');
  expect(screen.getByRole('alert')).toHaveTextContent('فرع السباحة');
});

test('warns when the scanned member branch is not permitted', () => {
  render(<ScannerBranchNotice member={member} user={{ branch_ids: ['branch-a'] }} isAdmin={false} />);
  expect(screen.getByRole('alert')).toHaveTextContent('ليس لديك صلاحية');
});

test('does not warn for a member of the selected branch', () => {
  render(<ScannerBranchNotice member={{ ...member, branch_id: 'branch-a' }} user={{ branch_ids: ['branch-a'] }} isAdmin={false} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
