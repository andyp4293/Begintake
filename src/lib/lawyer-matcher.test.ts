import { describe, it, expect, vi, beforeEach } from 'vitest';
import { identifyLegalArea, identifyLegalAreaMatch, findBestLawyer } from './lawyer-matcher';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    lawyer: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';

describe('identifyLegalArea', () => {
  it('identifies family law from divorce mention', () => {
    expect(identifyLegalArea('I need help with my divorce')).toBe('family');
  });

  it('identifies family law from custody mention', () => {
    expect(identifyLegalArea('I want to fight for custody of my children')).toBe('family');
  });

  it('identifies family law from child support', () => {
    expect(identifyLegalArea('My ex is not paying child support')).toBe('family');
  });

  it('identifies criminal law from DUI', () => {
    expect(identifyLegalArea('I was arrested for a DUI last night')).toBe('criminal');
  });

  it('identifies criminal law from arrest', () => {
    expect(identifyLegalArea('I was charged with assault and need a defense lawyer')).toBe('criminal');
  });

  it('identifies criminal law from felony', () => {
    expect(identifyLegalArea('I have a felony charge')).toBe('criminal');
  });

  it('identifies criminal law from natural phrases like pressing charges after a fight', () => {
    expect(identifyLegalArea('I got into a bar fight and now I think he is pressing charges')).toBe('criminal');
  });

  it('identifies immigration from visa', () => {
    expect(identifyLegalArea('I need help with my visa application')).toBe('immigration');
  });

  it('identifies immigration from deportation', () => {
    expect(identifyLegalArea('Someone I know is facing deportation')).toBe('immigration');
  });

  it('identifies immigration from citizenship', () => {
    expect(identifyLegalArea('I want to apply for citizenship')).toBe('immigration');
  });

  it('identifies immigration from asylum', () => {
    expect(identifyLegalArea('I need to file for asylum')).toBe('immigration');
  });

  it('identifies personal injury from accident', () => {
    expect(identifyLegalArea('I was in a car accident and got hurt')).toBe('personal_injury');
  });

  it('identifies personal injury from slip and fall', () => {
    expect(identifyLegalArea('I had a slip and fall at the grocery store')).toBe('personal_injury');
  });

  it('identifies personal injury from medical malpractice', () => {
    expect(identifyLegalArea('The doctor made a mistake, it was medical malpractice and I got hurt')).toBe('personal_injury');
  });

  it('identifies personal injury from workers comp', () => {
    expect(identifyLegalArea('I need workers comp for my injury at work')).toBe('personal_injury');
  });

  it('identifies tax law from audited phrasing', () => {
    expect(identifyLegalArea('I got audited by the IRS')).toBe('tax');
    expect(identifyLegalArea('My business is being audited')).toBe('tax');
  });

  it('identifies corporate from business dispute', () => {
    expect(identifyLegalArea('I have a business contract dispute')).toBe('corporate');
  });

  it('identifies real_estate from real estate transaction', () => {
    expect(identifyLegalArea('I need help with a real estate transaction')).toBe('real_estate');
  });

  it('identifies employment from wrongful termination', () => {
    expect(identifyLegalArea('I was wrongfully terminated from employment')).toBe('employment');
  });

  it('identifies corporate from LLC', () => {
    expect(identifyLegalArea('I want to form an llc for my startup')).toBe('corporate');
  });

  it('returns other for ambiguous input', () => {
    expect(identifyLegalArea('I need some help')).toBe('other');
  });

  it('returns other for empty string', () => {
    expect(identifyLegalArea('')).toBe('other');
  });

  it('does not false-match tax from the word first', () => {
    expect(identifyLegalArea('First time.')).toBe('other');
    expect(identifyLegalArea('This is my first time reaching out.')).toBe('other');
  });

  it('returns a non-zero score only for real keyword matches', () => {
    expect(identifyLegalAreaMatch('First time.')).toEqual({ area: 'other', score: 0 });
    expect(identifyLegalAreaMatch('I need help with my divorce').area).toBe('family');
    expect(identifyLegalAreaMatch('I need help with my divorce').score).toBeGreaterThan(0);
  });

  it('handles mixed signals by picking highest score', () => {
    // "divorce" and "custody" both match family, giving it a higher score
    expect(identifyLegalArea('divorce and custody issues')).toBe('family');
  });

  it('is case insensitive', () => {
    expect(identifyLegalArea('I was charged with a FELONY and need DEFENSE')).toBe('criminal');
  });
});

describe('findBestLawyer', () => {
  const mockLawyers = [
    { id: '1', name: 'Sarah Chen', specialties: ['family', 'divorce', 'custody'], available: true },
    { id: '2', name: 'Marcus Johnson', specialties: ['criminal', 'dui', 'defense'], available: true },
    { id: '3', name: 'Priya Patel', specialties: ['immigration', 'visa'], available: true },
  ];

  beforeEach(() => {
    vi.mocked(prisma.lawyer.findMany).mockResolvedValue(mockLawyers as any);
  });

  it('returns family lawyer for family area', async () => {
    const lawyer = await findBestLawyer('family');
    expect(lawyer?.name).toBe('Sarah Chen');
  });

  it('returns criminal lawyer for criminal area', async () => {
    const lawyer = await findBestLawyer('criminal');
    expect(lawyer?.name).toBe('Marcus Johnson');
  });

  it('returns immigration lawyer for immigration area', async () => {
    const lawyer = await findBestLawyer('immigration');
    expect(lawyer?.name).toBe('Priya Patel');
  });

  it('returns first available lawyer for other/unknown area', async () => {
    const lawyer = await findBestLawyer('other');
    expect(lawyer).not.toBeNull();
  });

  it('returns null when no lawyers available', async () => {
    vi.mocked(prisma.lawyer.findMany).mockResolvedValue([]);
    const lawyer = await findBestLawyer('family');
    expect(lawyer).toBeNull();
  });
});
