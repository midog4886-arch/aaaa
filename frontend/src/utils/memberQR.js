export const getMemberQRValue = (code) => {
  if (code === null || code === undefined) return '';
  return String(code).trim();
};
