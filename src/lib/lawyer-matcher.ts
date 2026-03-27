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
    'tax', 'irs', 'audit', 'back taxes', 'tax lien', 'tax levy',
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

export function identifyLegalArea(description: string): LegalArea {
  const lower = description.toLowerCase();

  let bestMatch: LegalArea = 'other';
  let bestScore = 0;

  for (const [area, keywords] of Object.entries(LEGAL_AREA_KEYWORDS) as [LegalArea, string[]][]) {
    if (area === 'other') continue;
    const score = keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = area;
    }
  }

  return bestMatch;
}

export async function findBestLawyer(legalArea: LegalArea) {
  const lawyers = await prisma.lawyer.findMany({
    where: { available: true },
  });

  const areaKeywords = LEGAL_AREA_KEYWORDS[legalArea] || [];

  let bestLawyer = null;
  let bestScore = 0;

  for (const lawyer of lawyers) {
    const score = lawyer.specialties.filter((s) =>
      areaKeywords.some((kw) => s.toLowerCase().includes(kw) || kw.includes(s.toLowerCase()))
    ).length;

    if (score > bestScore) {
      bestScore = score;
      bestLawyer = lawyer;
    }
  }

  // Fallback: return any available lawyer
  if (!bestLawyer && lawyers.length > 0) {
    bestLawyer = lawyers[0];
  }

  return bestLawyer;
}
