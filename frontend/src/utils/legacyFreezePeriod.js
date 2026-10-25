// Older freeze records did not store the subscription period key. Their
// successive deadlines still identify the purchased period they extended.
export const matchesLegacyFreezePeriod = (record, freeze, period) => {
  const originalEnd = period?.original_end_date;
  return Boolean(originalEnd && period?.start_date && period?.end_date
    && record?.old_end_date && record?.new_end_date && freeze?.start_date
    && freeze.start_date >= period.start_date
    && freeze.start_date <= record.old_end_date
    && record.old_end_date >= originalEnd
    && record.new_end_date <= period.end_date);
};
