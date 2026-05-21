import { describe, expect, it } from 'vitest';
import { getDefaultTransferCallbackMessage } from './transfer-handoff';

describe('transfer-handoff copy', () => {
  it('uses the new attorney callback outro', () => {
    expect(getDefaultTransferCallbackMessage('attorney')).toBe(
      'Thank you. I wrote down everything you shared with me today so I can pass this to the right lawyer for your case. They will review it and call you back at the best callback number I have for you.',
    );
  });

  it('uses the new paralegal callback outro', () => {
    expect(getDefaultTransferCallbackMessage('paralegal')).toBe(
      'Thank you. I wrote down everything you shared with me today so I can pass this to our team for your case. They will call you back at the best callback number I have for you.',
    );
  });
});
