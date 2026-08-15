/**
 * Regression tests for the member-view-dialog race guards in MembersPage:
 * opening member (A) then quickly member (B) must never let A's late API
 * responses overwrite B's displayed data (viewReqGenRef +
 * activeViewMemberIdRef guards).
 *
 * The whole services/api module is mocked with controllable (deferrable)
 * promises so each test decides exactly when every member's data resolves.
 */
import React from 'react';
import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

jest.setTimeout(60000);

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Every named export (membersAPI, invoicesAPI, ...) is a Proxy that lazily
// creates jest.fn() endpoints resolving to { data: [] } by default. Tests
// override the endpoints they care about.
jest.mock('../../services/api', () => {
  const makeApiObject = () =>
    new Proxy(
      {},
      {
        get(target, prop) {
          if (!(prop in target)) {
            target[prop] = jest.fn(() => Promise.resolve({ data: [] }));
          }
          return target[prop];
        },
      }
    );
  const apis = {};
  return new Proxy(
    { __esModule: true },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (!(prop in apis)) apis[prop] = makeApiObject();
        return apis[prop];
      },
    }
  );
});

jest.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, language: 'en' }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    selectedBranchId: 'all',
    isAdmin: true,
    user: { id: 'admin-1', permissions: [] },
  }),
}));

jest.mock('../../components/Layout', () => ({
  Layout: ({ children }) => <div>{children}</div>,
}));

// Radix's portal-based Dialog does not mount reliably under jsdom; replace it
// with a minimal stand-in that honors `open`/`onOpenChange`. The race guards
// under test live in MembersPage itself, not in the dialog implementation.
jest.mock('../../components/ui/dialog', () => {
  const React = require('react');
  const Dialog = ({ open, onOpenChange, children }) =>
    open ? (
      <div role="dialog">
        <button
          type="button"
          data-testid="dialog-close-btn"
          onClick={() => onOpenChange && onOpenChange(false)}
        >
          close
        </button>
        {children}
      </div>
    ) : null;
  const passthrough = (tag) => ({ children }) => <div data-dialog-part={tag}>{children}</div>;
  return {
    Dialog,
    DialogContent: passthrough('content'),
    DialogHeader: passthrough('header'),
    DialogTitle: passthrough('title'),
    DialogFooter: passthrough('footer'),
  };
});

const api = require('../../services/api');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const MEMBER_A = {
  id: 'member-a',
  name: 'Alpha Member',
  name_ar: 'العضو ألف',
  member_code: 'A100',
  phone: '0500000001',
  activities: [],
};
const MEMBER_B = {
  id: 'member-b',
  name: 'Beta Member',
  name_ar: 'العضو باء',
  member_code: 'B200',
  phone: '0500000002',
  activities: [],
};

const INVOICE_A = {
  id: 'aaaa1111-racetest',
  total: 111,
  status: 'paid',
  created_at: '2026-01-05T10:00:00Z',
};
const INVOICE_B = {
  id: 'bbbb2222-racetest',
  total: 222,
  status: 'paid',
  created_at: '2026-02-06T10:00:00Z',
};

const ATTENDANCE_A = { summary: { absent_count: 7 }, records: [] };
const ATTENDANCE_B = { summary: { absent_count: 3 }, records: [] };

function setupListEndpoints() {
  api.membersAPI.getAll.mockImplementation(() =>
    Promise.resolve({ data: [MEMBER_A, MEMBER_B] })
  );
  api.membersAPI.getById.mockImplementation((id) =>
    Promise.resolve({ data: id === MEMBER_A.id ? MEMBER_A : MEMBER_B })
  );
}

async function renderMembersPage() {
  const MembersPage = require('../MembersPage').default;
  render(
    <MemoryRouter>
      <MembersPage />
    </MemoryRouter>
  );
  // Both rows visible once loadData resolves (generous timeout — the page
  // is huge and the first render in jsdom is slow).
  await screen.findByTestId(`view-member-${MEMBER_A.id}`, {}, { timeout: 10000 });
  await screen.findByTestId(`view-member-${MEMBER_B.id}`, {}, { timeout: 10000 });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupListEndpoints();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("rapidly opening member A then B never shows A's late data", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });

  // Member A's detail responses hang until we release them; B's are instant.
  const aInvoices = deferred();
  const aAttendance = deferred();
  api.invoicesAPI.getAll.mockImplementation(({ member_id }) =>
    member_id === MEMBER_A.id
      ? aInvoices.promise
      : Promise.resolve({ data: [INVOICE_B] })
  );
  api.attendanceAPI.getMemberReport.mockImplementation((memberId) =>
    memberId === MEMBER_A.id
      ? aAttendance.promise
      : Promise.resolve({ data: ATTENDANCE_B })
  );

  await renderMembersPage();

  // Open A, then immediately open B while A's requests are still in flight.
  await user.click(screen.getByTestId(`view-member-${MEMBER_A.id}`));
  await user.click(screen.getByTestId(`view-member-${MEMBER_B.id}`));

  // B's data lands: invoices tab counts B's single invoice.
  const invoicesTab = await screen.findByRole(
    'button', { name: /invoices \(1\)/ }, { timeout: 10000 }
  );
  expect(screen.getByRole('dialog')).toHaveTextContent('Beta Member');

  // NOW resolve A's stale responses — the generation guard must drop them.
  await act(async () => {
    aInvoices.resolve({ data: [INVOICE_A, INVOICE_A, INVOICE_A] });
    aAttendance.resolve({ data: ATTENDANCE_A });
  });

  // Still exactly B's invoice count — A's 3 invoices were NOT written.
  expect(screen.getByRole('button', { name: /invoices \(1\)/ })).toBeInTheDocument();

  // The invoices tab shows B's invoice, never A's.
  await user.click(invoicesTab);
  expect(screen.getByText(`#${INVOICE_B.id.slice(0, 8)}`)).toBeInTheDocument();
  expect(screen.queryByText(`#${INVOICE_A.id.slice(0, 8)}`)).not.toBeInTheDocument();
  expect(screen.queryByText(/111\s*sar/)).not.toBeInTheDocument();

  // Attendance badge shows B's absent count (3), not A's (7).
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(screen.queryByText('7')).not.toBeInTheDocument();
});

test("closing A's dialog then opening B drops A's in-flight responses", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });

  const aInvoices = deferred();
  api.invoicesAPI.getAll.mockImplementation(({ member_id }) =>
    member_id === MEMBER_A.id
      ? aInvoices.promise
      : Promise.resolve({ data: [INVOICE_B] })
  );
  api.attendanceAPI.getMemberReport.mockImplementation((memberId) =>
    Promise.resolve({ data: memberId === MEMBER_A.id ? ATTENDANCE_A : ATTENDANCE_B })
  );

  await renderMembersPage();

  await user.click(screen.getByTestId(`view-member-${MEMBER_A.id}`));
  await screen.findByRole('dialog');
  // Close the dialog — this bumps the generation.
  await user.click(screen.getByTestId('dialog-close-btn'));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  );

  await user.click(screen.getByTestId(`view-member-${MEMBER_B.id}`));
  await screen.findByRole('button', { name: /invoices \(1\)/ }, { timeout: 10000 });

  await act(async () => {
    aInvoices.resolve({ data: [INVOICE_A, INVOICE_A] });
  });

  expect(screen.getByRole('button', { name: /invoices \(1\)/ })).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toHaveTextContent('Beta Member');
});

test("A's slow freeze data never lands in B's freshly opened view", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });

  const FREEZE_A = {
    id: 'freeze-a-1',
    start_date: '2026-01-01',
    end_date: '2026-01-15',
    reason: 'travel',
    status: 'active',
  };
  const aFreezes = deferred();
  api.freezesAPI.getMemberFreezes.mockImplementation((memberId) =>
    memberId === MEMBER_A.id ? aFreezes.promise : Promise.resolve({ data: [] })
  );
  api.freezesAPI.getMemberStats.mockImplementation(() =>
    Promise.resolve({ data: null })
  );
  api.invoicesAPI.getAll.mockImplementation(() =>
    Promise.resolve({ data: [INVOICE_B] })
  );

  await renderMembersPage();

  // Trigger A's freeze load (openFreezeDialog opens the view dialog on the
  // freeze tab) — its list request hangs; it must be generation-guarded.
  await user.click(
    screen.getAllByTitle('Freeze')[0] // row order: A first
  );
  await waitFor(() =>
    expect(api.freezesAPI.getMemberFreezes).toHaveBeenCalledWith(MEMBER_A.id)
  );

  // Immediately open B's view dialog instead (bumps the generation).
  await user.click(screen.getByTestId(`view-member-${MEMBER_B.id}`));
  await screen.findByRole('button', { name: /invoices \(1\)/ }, { timeout: 10000 });

  // Switch to B's Freeze tab — B's freeze list resolves empty right away.
  // (scope to the dialog: row action buttons are also titled "Freeze")
  const dlg = within(screen.getByRole('dialog'));
  await user.click(dlg.getByRole('button', { name: /Freeze/ }));
  await screen.findByText('No freeze history');

  // A's stale freeze response arrives late — must be dropped, so B's
  // freeze history stays empty and A's dates never render.
  await act(async () => {
    aFreezes.resolve({ data: [FREEZE_A] });
  });

  expect(screen.getByRole('dialog')).toHaveTextContent('Beta Member');
  expect(screen.getByText('No freeze history')).toBeInTheDocument();
  expect(screen.queryByText(/2026-01-01/)).not.toBeInTheDocument();
});

test("A's slow reminder history never lands in B's view (active-member guard)", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });

  const aReminders = deferred();
  api.whatsappAPI.getReminderHistory.mockImplementation(({ member_id }) =>
    member_id === MEMBER_A.id
      ? aReminders.promise
      : Promise.resolve({ data: { rows: [] } })
  );
  api.invoicesAPI.getAll.mockImplementation(() =>
    Promise.resolve({ data: [INVOICE_B] })
  );

  await renderMembersPage();

  // Open A's dialog and its Reminders tab — A's history request hangs.
  await user.click(screen.getByTestId(`view-member-${MEMBER_A.id}`));
  await screen.findByRole('dialog');
  await user.click(screen.getByRole('button', { name: /Reminders/ }));

  // Close A, open B, and open B's Reminders tab (resolves empty at once).
  await user.click(screen.getByTestId('dialog-close-btn'));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  );
  await user.click(screen.getByTestId(`view-member-${MEMBER_B.id}`));
  await screen.findByRole('dialog');
  await user.click(screen.getByRole('button', { name: /Reminders/ }));
  await screen.findByText(/0 record\(s\)/);

  // A's stale reminder rows arrive late — activeViewMemberIdRef guard must
  // drop them, so B still shows zero reminder records.
  await act(async () => {
    aReminders.resolve({
      data: { rows: [{ id: 'rem-a-1', sent_at: '2026-02-01T10:00:00Z', kind: 'renewal' }] },
    });
  });

  expect(screen.getByRole('dialog')).toHaveTextContent('Beta Member');
  expect(screen.getByText(/0 record\(s\)/)).toBeInTheDocument();
});
