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
  expect(source).toContain('whatsappAPI.getBranchCloudJob');
  expect(source).toContain('whatsappAPI.cancelBranchCloudJob');
  expect(source).toContain('whatsappAPI.listBranchCloudJobs');
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