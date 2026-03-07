/**
 * Test Suite: validateReply — Post-Generation Validation
 * Phase 13: Post-Generation Validation
 * Requirements: VALIDATE-01, VALIDATE-02, VALIDATE-04, QUALITY-03, QUALITY-04
 */

'use strict';

const {
  proposalGate,
  bannedPhraseScanner,
  nextStepScanner,
  metricsScanner,
  CALL_REDIRECT,
} = require('../utils/validateReply');

// ============================================================
// VALIDATE-01 / QUALITY-03: proposalGate()
// ============================================================
describe('proposalGate', () => {
  describe('non-proposal replies', () => {
    test('strips dollar amount from EMAIL_REPLY_V2', () => {
      const { text, stripped } = proposalGate('Our price is $500 for this.', 'EMAIL_REPLY_V2');
      expect(stripped).toBe(true);
      expect(text).not.toContain('$500');
      expect(text).toContain(CALL_REDIRECT);
    });

    test('strips USD from THREAD_CONTINUATION_V1', () => {
      const { text, stripped } = proposalGate('Budget is $2,000 USD total.', 'THREAD_CONTINUATION_V1');
      expect(stripped).toBe(true);
      expect(text).not.toContain('USD');
    });

    test('strips phase references from non-proposal', () => {
      const { stripped } = proposalGate('We will handle phase 1 for $800.', 'EMAIL_REPLY_V2');
      expect(stripped).toBe(true);
    });

    test('does NOT strip generic weeks reference without pricing', () => {
      const { stripped } = proposalGate('I can start within a few weeks of your confirmation.', 'EMAIL_REPLY_V2');
      expect(stripped).toBe(false);
    });

    test('returns stripped=false when no pricing patterns present', () => {
      const { text, stripped } = proposalGate('Looking forward to working with you.', 'EMAIL_REPLY_V2');
      expect(stripped).toBe(false);
      expect(text).toBe('Looking forward to working with you.');
    });
  });

  describe('PROPOSAL_V4 with client request', () => {
    test('allows pricing when clientRequestedPricing=true', () => {
      const { text, stripped } = proposalGate('Our price is $500.', 'PROPOSAL_V4', true);
      expect(stripped).toBe(false);
      expect(text).toContain('$500');
    });
  });

  describe('PROPOSAL_V4 without client request', () => {
    test('strips pricing from PROPOSAL_V4 when client did not request it', () => {
      const { stripped } = proposalGate('Total cost is $1,500 USD.', 'PROPOSAL_V4', false);
      expect(stripped).toBe(true);
    });
  });
});

// ============================================================
// VALIDATE-02: bannedPhraseScanner()
// ============================================================
describe('bannedPhraseScanner', () => {
  const activePhraseWithReplacement = {
    phrase: 'I hope this finds you well',
    category: 'FILLER',
    replacement_suggestion: 'Following up on our conversation',
    active: true,
  };

  const activePhraseNoReplacement = {
    phrase: 'as per my last email',
    category: 'PASSIVE',
    replacement_suggestion: null,
    active: true,
  };

  const inactivePhrase = {
    phrase: 'synergy',
    category: 'CORPORATE',
    replacement_suggestion: 'collaboration',
    active: false,
  };

  test('catches active banned phrase and returns violation', () => {
    const text = 'I hope this finds you well, and I wanted to follow up.';
    const { violations } = bannedPhraseScanner(text, [activePhraseWithReplacement]);
    expect(violations).toHaveLength(1);
    expect(violations[0].phrase).toBe('I hope this finds you well');
    expect(violations[0].index).toBeGreaterThanOrEqual(0);
    expect(violations[0].replacement).toBe('Following up on our conversation');
    expect(violations[0].category).toBe('FILLER');
  });

  test('skips inactive phrases', () => {
    const text = 'We need synergy between teams.';
    const { violations } = bannedPhraseScanner(text, [inactivePhrase]);
    expect(violations).toHaveLength(0);
  });

  test('auto-rewrites text when replacement_suggestion exists', () => {
    const text = 'I hope this finds you well. Here is my reply.';
    const { rewrittenText } = bannedPhraseScanner(text, [activePhraseWithReplacement]);
    expect(rewrittenText).not.toContain('I hope this finds you well');
    expect(rewrittenText).toContain('Following up on our conversation');
  });

  test('returns null replacement when no replacement_suggestion', () => {
    const text = 'As per my last email, I wanted to follow up.';
    const { violations } = bannedPhraseScanner(text, [activePhraseNoReplacement]);
    expect(violations[0].replacement).toBeNull();
  });

  test('returns empty violations for clean text', () => {
    const text = 'Thank you for reaching out. I would love to help.';
    const { violations, rewrittenText } = bannedPhraseScanner(text, [activePhraseWithReplacement]);
    expect(violations).toHaveLength(0);
    expect(rewrittenText).toBe(text);
  });

  test('catches multiple violations in same text', () => {
    const text = 'I hope this finds you well. As per my last email, let us sync.';
    const { violations } = bannedPhraseScanner(text, [activePhraseWithReplacement, activePhraseNoReplacement]);
    expect(violations).toHaveLength(2);
  });

  test('does NOT auto-replace when replacement_suggestion has [placeholder] brackets', () => {
    const phraseWithPlaceholder = {
      phrase: 'Let me know what you think',
      category: 'PASSIVE',
      replacement_suggestion: 'Would [specific question] work?',
      active: true,
    };
    const text = 'Here is my proposal. Let me know what you think.';
    const { violations, rewrittenText } = bannedPhraseScanner(text, [phraseWithPlaceholder]);
    // Violation is still flagged
    expect(violations).toHaveLength(1);
    expect(violations[0].replacement).toBe('Would [specific question] work?');
    // But text is NOT rewritten — placeholder would appear literally
    expect(rewrittenText).toBe(text);
    expect(rewrittenText).not.toContain('[specific question]');
  });

  test('does NOT auto-replace "Would [time] work for you?" placeholder', () => {
    const phraseWithTimePlaceholder = {
      phrase: 'I am available',
      category: 'SELF_FOCUSED',
      replacement_suggestion: 'Would [time] work for you?',
      active: true,
    };
    const text = 'I am available for a quick call.';
    const { violations, rewrittenText } = bannedPhraseScanner(text, [phraseWithTimePlaceholder]);
    expect(violations).toHaveLength(1);
    // Text should keep original — don't inject "[time]" literally
    expect(rewrittenText).toContain('I am available');
    expect(rewrittenText).not.toContain('[time]');
  });

  test('DOES auto-replace when replacement has no brackets', () => {
    const phraseWithCleanReplacement = {
      phrase: 'At your earliest convenience',
      category: 'PASSIVE',
      replacement_suggestion: 'when you get a chance',
      active: true,
    };
    const text = 'Please reply at your earliest convenience.';
    const { violations, rewrittenText } = bannedPhraseScanner(text, [phraseWithCleanReplacement]);
    expect(violations).toHaveLength(1);
    // Clean replacement IS applied
    expect(rewrittenText).toContain('when you get a chance');
    expect(rewrittenText).not.toContain('at your earliest convenience');
  });
});

// ============================================================
// VALIDATE-04: nextStepScanner()
// ============================================================
describe('nextStepScanner', () => {
  test('detects direct question as next step', () => {
    const { hasNextStep } = nextStepScanner('Here is my proposal. Can we schedule a call this week?');
    expect(hasNextStep).toBe(true);
  });

  test('detects action verb + timeframe as next step', () => {
    const { hasNextStep } = nextStepScanner('I would love to discuss. Let me know if you are available tomorrow.');
    expect(hasNextStep).toBe(true);
  });

  test('returns false when no next step present', () => {
    const { hasNextStep } = nextStepScanner('Thank you for your message. I look forward to your response.');
    expect(hasNextStep).toBe(false);
  });

  test('returns false for vague closing without timeframe', () => {
    const { hasNextStep } = nextStepScanner('I appreciate your patience. Happy to help.');
    expect(hasNextStep).toBe(false);
  });

  test('detects question in single-sentence text', () => {
    const { hasNextStep } = nextStepScanner('Does this approach work for you?');
    expect(hasNextStep).toBe(true);
  });

  test('handles empty string gracefully', () => {
    const { hasNextStep } = nextStepScanner('');
    expect(hasNextStep).toBe(false);
  });
});

// ============================================================
// QUALITY-04: metricsScanner()
// ============================================================
describe('metricsScanner', () => {
  test('detects percentage metric', () => {
    const { hasMetrics } = metricsScanner('We improved load time by 40% for our clients.');
    expect(hasMetrics).toBe(true);
  });

  test('detects number + timeframe metric', () => {
    const { hasMetrics } = metricsScanner('Delivered in 3 weeks, 2 days ahead of schedule.');
    expect(hasMetrics).toBe(true);
  });

  test('detects multiplier metric', () => {
    const { hasMetrics } = metricsScanner('We achieved 3x revenue growth for a SaaS client.');
    expect(hasMetrics).toBe(true);
  });

  test('returns false for vague claims without numbers', () => {
    const { hasMetrics } = metricsScanner('We have worked with many satisfied clients and delivered great results.');
    expect(hasMetrics).toBe(false);
  });

  test('returns false for empty string', () => {
    const { hasMetrics } = metricsScanner('');
    expect(hasMetrics).toBe(false);
  });
});
