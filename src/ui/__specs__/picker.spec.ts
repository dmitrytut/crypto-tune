import { describe, expect, it } from 'vitest';
import { matchOptions } from '../picker';

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'ETHBTC', 'SOLUSDT', 'WBTCUSDT'];

describe('matchOptions', () => {
  it('keeps the whole list for an empty query', () => {
    expect(matchOptions(PAIRS, '  ')).toEqual(PAIRS);
  });

  it('puts prefix matches before options that only contain the query, case-insensitively', () => {
    expect(matchOptions(PAIRS, 'btc')).toEqual(['BTCUSDT', 'ETHBTC', 'WBTCUSDT']);
    expect(matchOptions(['C', 'C#', 'D#'], 'c#')).toEqual(['C#']);
  });

  it('ranks an exact match above longer names sharing its prefix', () => {
    expect(matchOptions(['ETHBTC', 'ETHFIUSDT', 'ETHUSDT'], 'ethusdt')).toEqual(['ETHUSDT']);
    expect(matchOptions(['ETHBTC', 'ETH', 'WETH'], 'eth')).toEqual(['ETH', 'ETHBTC', 'WETH']);
  });

  it('returns nothing when no option contains the query', () => {
    expect(matchOptions(PAIRS, 'xyz')).toEqual([]);
  });
});
