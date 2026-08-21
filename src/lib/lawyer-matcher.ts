import { prisma } from '@/lib/prisma';

export type LegalArea =
  | 'family'
  | 'criminal'
  | 'immigration'
  | 'personal_injury'
  | 'corporate'
  | 'real_estate'
  | 'employment'
  | 'bankruptcy'
  | 'tax'
  | 'estate_planning'
  | 'intellectual_property'
  | 'civil_rights'
  | 'environmental'
  | 'other';

export interface LegalAreaMatch {
  area: LegalArea;
  score: number;
}

const LEGAL_AREA_KEYWORDS: Record<LegalArea, string[]> = {
  family: [
    'divorce', 'custody', 'child support', 'alimony', 'marriage',
    'separation', 'adoption', 'prenup', 'domestic', 'family',
    'visitation', 'spousal', 'guardian', 'paternity', 'juvenile',
    'acs', 'child welfare', 'order of protection', 'family offense',
    'parenting', 'foster', 'guardianship',
  ],
  criminal: [
    'criminal', 'dui', 'drunk driving', 'arrest', 'charge', 'felony',
    'misdemeanor', 'theft', 'assault', 'drug', 'bail', 'defense', 'plea',
    'probation', 'parole', 'warrant', 'accused', 'indicted', 'arraignment',
    'incarcerated', 'detained', 'police', 'prosecution', 'expungement',
    'robbery', 'murder', 'homicide', 'domestic violence charge', 'sex offense',
    'charges', 'pressing charges', 'pressed charges', 'bar fight',
    'got into a fight', 'hit someone', 'battery', 'court paperwork',
    'criminal complaint',
  ],
  immigration: [
    'immigration', 'visa', 'deportation', 'citizenship', 'asylum',
    'green card', 'work permit', 'refugee', 'naturalization',
    'uscis', 'ice', 'undocumented', 'sponsor', 'petition',
    'removal', 'daca', 'tps', 'ead', 'i-485', 'i-130', 'i-765',
    'border', 'migrate', 'immigrant', 'country of origin',
  ],
  personal_injury: [
    'injury', 'accident', 'slip and fall', 'medical malpractice',
    'workers comp', 'compensation', 'negligence', 'damages',
    'whiplash', 'pain and suffering', 'lawsuit', 'hurt', 'injured',
    'crash', 'collision', 'car accident', 'truck accident', 'defective product',
    'dog bite', 'wrongful death', 'hospital error', 'surgical error',
    'workplace injury', 'construction accident',
  ],
  corporate: [
    'business', 'corporate', 'corporation', 'startup', 'llc',
    'partnership', 'merger', 'acquisition', 'compliance',
    'shareholder', 'board of directors', 'commercial dispute',
    'business formation', 'articles of incorporation',
  ],
  real_estate: [
    'real estate', 'property', 'house', 'home', 'land', 'mortgage',
    'foreclosure', 'eviction', 'landlord', 'tenant', 'lease', 'rent',
    'title', 'deed', 'closing', 'escrow', 'zoning', 'easement',
    'boundary', 'construction defect', 'contractor', 'hoa',
    'homeowners association', 'buying a house', 'selling a house',
  ],
  employment: [
    'employment', 'fired', 'wrongful termination', 'laid off', 'employer',
    'employee', 'workplace', 'discrimination', 'harassment', 'hostile',
    'unpaid wages', 'overtime', 'wage theft', 'non-compete', 'severance',
    'retaliation', 'whistleblower', 'fmla', 'leave', 'hr', 'boss',
    'job', 'work', 'coworker', 'title vii', 'eeoc', 'ada',
  ],
  bankruptcy: [
    'bankruptcy', 'chapter 7', 'chapter 13', 'chapter 11', 'debt',
    'garnishment', 'creditor', 'collection', 'repossession', 'insolvent',
    'discharge', 'automatic stay', 'trustee', 'owe money', 'can\'t pay',
    'bills', 'overwhelmed by debt', 'credit card debt', 'medical debt',
  ],
  tax: [
    'tax', 'taxes', 'irs', 'audit', 'audited', 'being audited', 'back taxes', 'tax lien', 'tax levy',
    'tax debt', 'tax evasion', 'tax fraud', 'tax court', 'w-2',
    '1099', 'tax return', 'penalty', 'interest', 'tax notice',
    'tax attorney', 'offer in compromise', 'installment agreement',
    'tax planning', 'state tax', 'sales tax',
  ],
  estate_planning: [
    'will', 'trust', 'estate', 'probate', 'inheritance', 'heir',
    'beneficiary', 'executor', 'power of attorney', 'healthcare directive',
    'living will', 'guardianship of adult', 'conservatorship',
    'estate tax', 'gift tax', 'succession', 'last will',
    'passed away', 'deceased', 'death', 'elder law',
  ],
  intellectual_property: [
    'trademark', 'copyright', 'patent', 'intellectual property', 'ip',
    'trade secret', 'brand', 'logo', 'invention', 'infringement',
    'licensing', 'royalty', 'software', 'creative work', 'plagiarism',
    'counterfeiting', 'piracy', 'nda', 'confidentiality', 'trade dress',
  ],
  civil_rights: [
    'civil rights', 'constitutional', 'discrimination', 'police brutality',
    'excessive force', 'unlawful search', 'fourth amendment', 'first amendment',
    'free speech', 'religion', 'voting rights', 'section 1983', 'civil liberties',
    'prisoner rights', 'detained by police', 'false arrest', 'ada violation',
    'disability access', 'equal protection', 'due process',
  ],
  environmental: [
    'environmental', 'pollution', 'contamination', 'epa', 'superfund',
    'hazardous waste', 'toxic', 'pesticide', 'clean water', 'clean air',
    'brownfield', 'remediation', 'water rights', 'mineral rights',
    'natural resources', 'wetlands', 'permit', 'environmental impact',
    'fracking', 'oil spill', 'chemical exposure',
  ],
  other: [],
};

function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countKeywordMatch(text: string, keyword: string): number {
  const normalizedText = normalizeMatchText(text);
  const normalizedKeyword = normalizeMatchText(keyword);
  if (!normalizedText || !normalizedKeyword) return 0;

  if (normalizedKeyword.includes(' ')) {
    if (!normalizedText.includes(normalizedKeyword)) return 0;
    return normalizedKeyword.split(' ').length + 1;
  }

  const tokens = new Set(normalizedText.split(' ').filter(Boolean));
  return tokens.has(normalizedKeyword) ? 1 : 0;
}

export function identifyLegalAreaMatch(description: string): LegalAreaMatch {
  const normalized = normalizeMatchText(description);
  if (!normalized) {
    return { area: 'other', score: 0 };
  }

  let bestMatch: LegalArea = 'other';
  let bestScore = 0;

  for (const [area, keywords] of Object.entries(LEGAL_AREA_KEYWORDS) as [LegalArea, string[]][]) {
    if (area === 'other') continue;
    const score = keywords.reduce((total, kw) => total + countKeywordMatch(normalized, kw), 0);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = area;
    }
  }

  return {
    area: bestScore > 0 ? bestMatch : 'other',
    score: bestScore,
  };
}

export function identifyLegalArea(description: string): LegalArea {
  return identifyLegalAreaMatch(description).area;
}

export async function findBestLawyer(legalArea: LegalArea) {
  const currentHour = new Date().getHours(); // 0-23 server local time

  const lawyers = await prisma.lawyer.findMany({
    where: { available: true },
  });

  // Filter to attorneys whose call window covers the current hour
  const availableNow = lawyers.filter(
    (l) => currentHour >= l.availabilityStart && currentHour < l.availabilityEnd
  );

  const areaKeywords = LEGAL_AREA_KEYWORDS[legalArea] || [];

  // Score within the currently-available pool; fall back to all available if none are in-hours
  const pool = availableNow.length > 0 ? availableNow : lawyers;

  let bestLawyer = null;
  let bestScore = 0;

  for (const lawyer of pool) {
    const score = lawyer.specialties.filter((s) =>
      areaKeywords.some((kw) => s.toLowerCase().includes(kw) || kw.includes(s.toLowerCase()))
    ).length;

    if (score > bestScore) {
      bestScore = score;
      bestLawyer = lawyer;
    }
  }

  // Fallback: return any attorney from the pool
  if (!bestLawyer && pool.length > 0) {
    bestLawyer = pool[0];
  }

  return bestLawyer;
}
