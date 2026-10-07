import { displayPhone, extractPhoneNumbers, filterPhoneNumbers } from './phoneNumberFormatter';

test('extracts numbers from mixed text and removes duplicates across local and international forms', () => {
  const result = extractPhoneNumbers('محمد ٠٥٥ ١٢٣ ٤٥٦٧، +966 55 123 4567\nسارة +20 10 1234 5678');
  expect(result.numbers).toEqual(['966551234567', '201012345678']);
  expect(result.duplicates).toBe(1);
  expect(displayPhone(result.numbers[0])).toBe('+966 55 123 4567');
  expect(displayPhone(result.numbers[1])).toBe('+20 101 234 5678');
});

test('finds Saudi numbers by local, international, Arabic digit, and partial forms', () => {
  const numbers = ['966555467222', '966506231336', '966503114027'];
  expect(filterPhoneNumbers(numbers, '055 546 7222')).toEqual([numbers[0]]);
  expect(filterPhoneNumbers(numbers, '+966-55-546-7222')).toEqual([numbers[0]]);
  expect(filterPhoneNumbers(numbers, '٠٥٥٥٤٦٧٢٢٢')).toEqual([numbers[0]]);
  expect(filterPhoneNumbers(numbers, '7222')).toEqual([numbers[0]]);
  expect(filterPhoneNumbers(numbers, '0555467222، 0503114027')).toEqual([numbers[0], numbers[2]]);
  expect(filterPhoneNumbers(numbers, '00966 50 623 1336')).toEqual([numbers[1]]);
});

test('does not accept a number as a prefix of a longer malformed number', () => {
  const result = extractPhoneNumbers('05512345678');
  expect(result.numbers).toEqual([]);
  expect(result.invalid).toBeGreaterThan(0);
});
