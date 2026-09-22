import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.join(__dirname, '..', 'DayExtensionsPage.js'),
  'utf8'
);

test('closure preview queues through backend and never opens browser WhatsApp', () => {
  expect(source).toContain('whatsappAPI.enqueueClosureNotices');
  expect(source).not.toContain('window.open(');
  expect(source).not.toContain('https://wa.me/');
});

test('closure queue exposes durable progress and cancellation', () => {
  expect(source).toContain('data-testid="closure-whatsapp-job-progress"');
  expect(source).toContain('api.dayExtensions.getClosures');
  expect(source).toContain('whatsappAPI.cancelBranchCloudJob');
  expect(source).toContain('c.notice_summary?.jobs');
});

test('double clicks are guarded synchronously and reopen uses durable branch identities', () => {
  expect(source).toContain('if (sendInFlight.current || automaticLocked) return;');
  expect(source.indexOf('sendInFlight.current = true')).toBeLessThan(source.indexOf('await whatsappAPI.enqueueClosureNotices'));
  expect(source).toContain('selectedNoticeBranches.every(id => previewJobs.some(job => job.branch_id === id))');
  expect(source).toContain('Existing queue; no new messages queued');
  expect(source).toContain('closure.notice_summary.sent');
  expect(source).toContain('All Branches');
});

test('manual opening is not sending and persists by tenant, closure and recipient', () => {
  expect(source).toContain("localStorage.getItem('tenant_slug')");
  expect(source).toContain('${previewClosure?.id}:${member.member_id}');
  expect(source).toContain("localStorage.setItem(key, 'opened')");
  expect(source).toContain('Previously opened only; sending is unverified. Reopen chat?');
  expect(source).toContain('Object.prototype.hasOwnProperty.call(job.recipient_states, member.member_id)');
  expect(source).not.toContain('{closure.notice_summary.state}');
  expect(source).not.toContain('value.id === job.id ? response.data : value');
});

test('applied closures retain preview sending and page-level progress', () => {
  expect(source).toMatch(/<Button onClick=\{\(\) => handlePreviewExtension\(closure\)\}/);
  const progressAt = source.indexOf('data-testid="closure-whatsapp-job-progress"');
  const dialogAt = source.indexOf('{showPreviewDialog && (');
  expect(progressAt).toBeGreaterThan(-1);
  expect(dialogAt).toBeGreaterThan(progressAt);
  expect(source).toContain('{!previewClosure?.applied && (');
  expect(source).toContain("replace(/^closure_notice_/, '')");
});