import { displayPhone } from './phoneNumberFormatter';

export const createCampaignPhoneWorkbook = async (numbers, header) => {
  const ExcelJS = (await import('exceljs/dist/exceljs.min.js')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Numbers');
  sheet.columns = [{ header, key: 'phone', width: 22, style: { numFmt: '@' } }];
  sheet.getRow(1).font = { bold: true };
  numbers.forEach(phone => sheet.addRow({ phone: displayPhone(phone) }));
  return workbook.xlsx.writeBuffer();
};
