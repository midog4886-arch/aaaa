import ExcelJS from 'exceljs/dist/exceljs.min.js';
import { createCampaignPhoneWorkbook } from './campaignPhoneWorkbook';

test('exports each phone as a separate text cell preserving the plus sign', async () => {
  const data = await createCampaignPhoneWorkbook(['966555467222', '966506231336'], 'رقم الجوال');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const sheet = workbook.getWorksheet('Numbers');
  expect(sheet.getCell('A1').value).toBe('رقم الجوال');
  expect(sheet.getCell('A2').value).toBe('+966 55 546 7222');
  expect(sheet.getCell('A3').value).toBe('+966 50 623 1336');
  expect(sheet.getCell('A2').numFmt).toBe('@');
});
