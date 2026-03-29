import { describe, expect, it } from 'vitest';
import { createDefaultIntakeTemplate } from './default-intake';
import { extractToolsFromFlow } from '@/lib/flow-compiler';

describe('default intake template', () => {
  it('creates a valid visual template with one start node and all 13 practice areas', () => {
    const template = createDefaultIntakeTemplate();

    expect(template.name).toBeTruthy();
    expect(template.isTemplate).toBe(true);
    expect(template.nodes.length).toBeGreaterThan(40);
    expect(template.edges.length).toBeGreaterThan(40);

    const startNodes = template.nodes.filter((node: any) => node.type === 'start');
    expect(startNodes).toHaveLength(1);

    const practiceAreaFlags = template.nodes.filter(
      (node: any) => node.type === 'action' && node.config?.flagName === 'practice_area',
    );
    const practiceAreas = new Set(practiceAreaFlags.map((node: any) => node.config.flagValue));

    expect(practiceAreas).toEqual(new Set([
      'Family Law',
      'Immigration',
      'Criminal Defense',
      'Personal Injury',
      'Employment',
      'Civil Rights',
      'Corporate',
      'Real Estate',
      'Tax',
      'Intellectual Property',
      'Bankruptcy',
      'Estate Planning',
      'Environmental',
      'General Legal Inquiry',
    ]));
  });

  it('includes the tools needed for the default receptionist flow', () => {
    const template = createDefaultIntakeTemplate();
    const tools = new Set(extractToolsFromFlow({ id: 'default-intake', ...template }));

    expect(tools.has('checkClient')).toBe(true);
    expect(tools.has('identifyLawyer')).toBe(true);
    expect(tools.has('scheduleConsultation')).toBe(true);
    expect(tools.has('generateTransferSummary')).toBe(true);
    expect(tools.has('endCall')).toBe(true);
  });
});
