export interface TranscriptEntry {
  label: string;
  content: string;
  isAi: boolean;
}

const CALLER_ROLE_NAMES = new Set([
  'user',
  'caller',
  'customer',
  'client',
  'human',
  'person',
]);

const GENERIC_ASSISTANT_ROLE_NAMES = new Set([
  'assistant',
  'ai',
  'bot',
  'agent',
  'receptionist',
  'intakeassistant',
]);

function normalizeRoleKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, '');
}

function titleCaseLabel(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'ai') return 'AI';
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

export function resolveTranscriptSpeakerLabel(rawSpeaker: string, assistantName?: string): {
  label: string;
  isAi: boolean;
} {
  const normalizedRole = normalizeRoleKey(rawSpeaker);

  if (CALLER_ROLE_NAMES.has(normalizedRole)) {
    return {
      label: 'Caller',
      isAi: false,
    };
  }

  if (GENERIC_ASSISTANT_ROLE_NAMES.has(normalizedRole)) {
    return {
      label: assistantName?.trim() || 'Assistant',
      isAi: true,
    };
  }

  return {
    label: titleCaseLabel(rawSpeaker),
    isAi: true,
  };
}

export function parseTranscriptLine(line: string, assistantName?: string): TranscriptEntry {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) {
    return { label: 'Note', content: line, isAi: false };
  }

  const rawSpeaker = line.slice(0, colonIdx).trim();
  const content = line.slice(colonIdx + 1).trim();
  const speaker = resolveTranscriptSpeakerLabel(rawSpeaker, assistantName);

  return {
    label: speaker.label,
    content,
    isAi: speaker.isAi,
  };
}

export function normalizeTranscriptTextWithSpeakerLabels(
  transcript: unknown,
  assistantName?: string
): string {
  if (Array.isArray(transcript)) {
    return transcript
      .map((entry: any) => {
        const content = typeof entry?.content === 'string'
          ? entry.content
          : typeof entry?.message === 'string'
          ? entry.message
          : '';
        if (!content) return '';

        const rawSpeaker = typeof entry?.name === 'string' && entry.name.trim().length > 0
          ? entry.name
          : typeof entry?.role === 'string'
          ? entry.role
          : 'assistant';

        const speaker = resolveTranscriptSpeakerLabel(rawSpeaker, assistantName);
        return `${speaker.label}: ${content.trim()}`;
      })
      .filter(Boolean)
      .join('\n');
  }

  if (typeof transcript !== 'string') {
    return '';
  }

  return transcript
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const entry = parseTranscriptLine(line, assistantName);
      return entry.label === 'Note'
        ? entry.content
        : `${entry.label}: ${entry.content}`;
    })
    .join('\n');
}
