export type TransferTarget = 'attorney' | 'paralegal';
export type TransferHandoffMode = 'summary_only' | 'live_transfer';

const LIVE_TRANSFER_MESSAGE_RE = /\b(?:please hold|connect(?:ing)? you|connecting|transfer(?:ring)?|forward(?:ing)? the call|call will be forwarded)\b/i;
const URGENT_REVIEW_RE = /\b(?:urgent|immediate|right away|priority|safety|emergency)\b/i;
const LEGACY_TRANSFER_REPLACEMENTS: Array<[RegExp, string]> = [
  [/when I connect you with one of our attorneys, they'll already have everything they need to help you right away/gi, 'so the right lawyer has everything they need to follow up with you'],
  [/then connect you with one of our attorneys who can help/gi, 'then send it to the right lawyer who can help'],
  [/let me get you connected with our team right away/gi, "I'll send this to our team right away so the right lawyer can follow up with you"],
  [/please hold while I connect you with our team/gi, "I've sent this to our team, and the right lawyer will reach out to you shortly"],
  [/please hold one moment while I connect you with our team/gi, "I've sent this to our team, and the right lawyer will reach out to you shortly"],
  [/let me connect you with an attorney right away/gi, 'I am sending this to the right lawyer for immediate review now'],
  [/offer immediate attorney transfer/gi, 'let them know you are flagging this for immediate lawyer review'],
  [/proceed immediately to transfer/gi, 'proceed immediately to the follow-up step'],
  [/connect you with someone who can assess exactly what type of help you need/gi, 'make sure this gets to the right lawyer so they can assess exactly what type of help you need'],
  [/get you to the right person right away/gi, 'send this to the right lawyer or team member for follow-up'],
  [/talk to someone on our team now/gi, 'have our team follow up with you'],
  [/talk to someone now/gi, 'have our team follow up with you'],
  [/please hold - I'm connecting you now/gi, "I've sent everything to the right lawyer, and they will reach out to you directly about next steps"],
];

const ATTORNEY_CALLBACK_BASE_MESSAGE = 'Thank you. I wrote down everything you shared with me today so I can pass this to the right lawyer for your case. They will review it and call you back at the best callback number I have for you.';
const ATTORNEY_URGENT_CALLBACK_BASE_MESSAGE = 'Thank you. I wrote down everything you shared with me today so I can pass this to the right lawyer for your case, and I am marking it as urgent. They will review it and call you back at the best callback number I have for you.';
const PARALEGAL_CALLBACK_BASE_MESSAGE = 'Thank you. I wrote down everything you shared with me today so I can pass this to our team for your case. They will call you back at the best callback number I have for you.';
const PARALEGAL_URGENT_CALLBACK_BASE_MESSAGE = 'Thank you. I wrote down everything you shared with me today so I can pass this to our team for your case, and I flagged it for urgent review. They will call you back at the best callback number I have for you.';

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function getUrgentParalegalFollowUpSentence(offerImmediateTransfer = true): string {
  if (offerImmediateTransfer) {
    return 'If you think this is urgent, I can transfer this call to our paralegal team now.';
  }

  return 'If this feels urgent, I will flag it for immediate review so our team can call you back as quickly as possible.';
}

export function getTransferTarget(value: unknown): TransferTarget {
  return value === 'paralegal' ? 'paralegal' : 'attorney';
}

export function getRequestedTransferHandoffMode(value: unknown): TransferHandoffMode {
  return value === 'live_transfer' ? 'live_transfer' : 'summary_only';
}

export function isLiveTransferEnabled(requestedMode: unknown, transferTarget?: unknown): boolean {
  if (getRequestedTransferHandoffMode(requestedMode) !== 'live_transfer') {
    return false;
  }

  if (getTransferTarget(transferTarget) === 'paralegal') {
    return true;
  }

  return process.env.ENABLE_LIVE_CALL_TRANSFERS === 'true';
}

function buildAttorneyCallbackMessage(urgent = false, offerImmediateParalegalTransfer = true): string {
  if (urgent) {
    return ATTORNEY_URGENT_CALLBACK_BASE_MESSAGE;
  }

  void offerImmediateParalegalTransfer;
  return ATTORNEY_CALLBACK_BASE_MESSAGE;
}

function buildParalegalCallbackMessage(urgent = false): string {
  if (urgent) {
    return PARALEGAL_URGENT_CALLBACK_BASE_MESSAGE;
  }

  return PARALEGAL_CALLBACK_BASE_MESSAGE;
}

export function getDefaultTransferCallbackMessage(
  target: TransferTarget,
  options?: { urgent?: boolean; offerImmediateParalegalTransfer?: boolean },
): string {
  const urgent = options?.urgent === true;
  if (target === 'paralegal') {
    return buildParalegalCallbackMessage(urgent);
  }

  return buildAttorneyCallbackMessage(urgent, options?.offerImmediateParalegalTransfer !== false);
}

export function getLiveTransferAnnouncement(
  target: TransferTarget,
  options?: { correctionContext?: string | null },
): string {
  if (target === 'paralegal') {
    if (options?.correctionContext === 'existing_client') {
      return "Of course. Since you've worked with us before, we'll transfer you to our team right away.";
    }
    return "Of course. I'll transfer you to our team right away.";
  }

  return "I'm connecting you to the right lawyer now.";
}

export function sanitizeLegacyTransferCopy(text: string): string {
  let next = text;

  for (const [pattern, replacement] of LEGACY_TRANSFER_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }

  return next;
}

export function resolveTransferCallbackMessage(config: {
  transferTarget?: unknown;
  callbackMessage?: unknown;
  message?: unknown;
  urgencyFlag?: unknown;
  offerImmediateParalegalTransfer?: unknown;
}): string {
  const explicitCallbackMessage = asNonEmptyString(config.callbackMessage);
  const message = asNonEmptyString(config.message);
  const urgencyFlag = asNonEmptyString(config.urgencyFlag);
  const offerImmediateParalegalTransfer = config.offerImmediateParalegalTransfer !== false;
  const inferredUrgent = Boolean(
    urgencyFlag
    || (explicitCallbackMessage && URGENT_REVIEW_RE.test(explicitCallbackMessage))
    || (message && !LIVE_TRANSFER_MESSAGE_RE.test(message) && URGENT_REVIEW_RE.test(message)),
  );

  return getDefaultTransferCallbackMessage(getTransferTarget(config.transferTarget), {
    urgent: inferredUrgent,
    offerImmediateParalegalTransfer,
  });
}
