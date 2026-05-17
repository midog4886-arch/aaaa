export const getMemberQRValue = (code) => {
  if (code === null || code === undefined) return '';
  const str = String(code).trim();
  if (!str) return '';
  const m = str.match(/(\d+)$/);
  return m ? m[1] : str;
};
