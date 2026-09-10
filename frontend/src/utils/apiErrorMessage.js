// FastAPI errors may contain validation arrays or structured detail objects.
// Never pass those objects directly to a React-rendered notification.
export function apiErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;
  const extract = (value) => {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.map(extract).filter(Boolean).join('؛ ');
    if (value && typeof value === 'object') {
      for (const key of ['msg', 'message', 'error', 'detail']) {
        const text = extract(value[key]);
        if (text) return text;
      }
    }
    return '';
  };
  return extract(detail) || fallback;
}