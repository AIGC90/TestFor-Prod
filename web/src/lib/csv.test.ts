import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv';

describe('csv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(toCsv([['a,b', 'say "hi"', 'x\ny', 5, null]])).toBe('"a,b","say ""hi""","x\ny",5,');
  });

  it('neutralises formula injection', () => {
    expect(toCsv([['=SUM(A1)', '+1', '-2', '@x']])).toBe("'=SUM(A1),'+1,'-2,'@x");
  });

  it('round-trips through the parser', () => {
    const rows = [['name', 'note'], ['MH-12, Pune', 'line1\nline2'], ['q', 'he said "go"']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('skips blank lines and handles CRLF', () => {
    expect(parseCsv('a,b\r\n\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});
