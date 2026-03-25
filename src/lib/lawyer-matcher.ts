import { prisma } from '@/lib/prisma';

export type LegalArea =
  | 'family'
  | 'criminal'
  | 'immigration'
  | 'personal_injury'
  | 'corporate'
  | 'other';

const LEGAL_AREA_KEYWORDS: Record<LegalArea, string[]> = {
  family: [
    'divorce', 'custody', 'child support', 'alimony', 'marriage',
    'separation', 'adoption', 'prenup', 'domestic', 'family',
    'visitation', 'spousal', 'guardian', 'paternity',
  ],
  criminal: [
    'criminal', 'dui', 'arrest', 'charge', 'felony', 'misdemeanor',
    'theft', 'assault', 'drug', 'bail', 'defense', 'plea',
    'probation', 'parole', 'warrant', 'accused',
  ],
  immigration: [
    'immigration', 'visa', 'deportation', 'citizenship', 'asylum',
    'green card', 'work permit', 'refugee', 'naturalization',
    'uscis', 'ice', 'undocumented', 'sponsor', 'petition',
  ],
  personal_injury: [
    'injury', 'accident', 'slip and fall', 'medical malpractice',
    'workers comp', 'compensation', 'negligence', 'damages',
    'whiplash', 'disability', 'pain and suffering', 'lawsuit',
    'hurt', 'injured', 'crash', 'collision',
  ],
  corporate: [
    'business', 'corporate', 'contract', 'real estate', 'employment',
    'startup', 'llc', 'partnership', 'trademark', 'intellectual property',
    'merger', 'acquisition', 'compliance', 'lease', 'tenant', 'landlord',
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

  // Find lawyer whose specialties best match the legal area
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

  // If no specialty match, return any available lawyer
  if (!bestLawyer && lawyers.length > 0) {
    bestLawyer = lawyers[0];
  }

  return bestLawyer;
}
