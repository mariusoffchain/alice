import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isPartsContent,
  messagePrivacy,
  normalizeMessages,
  partsToText,
  textPart,
  type MessagePart,
  type PartMessage,
} from './message-parts.ts';

const meta = (privacy: MessagePart extends { privacy: infer P } ? P : never, label = 'x') => ({
  id: 'p1',
  privacy,
  label,
});

describe('isPartsContent', () => {
  it('treats a bare string as legacy string content', () => {
    assert.equal(isPartsContent('hello'), false);
  });
  it('treats an array as parts content', () => {
    assert.equal(isPartsContent([textPart('hi')]), true);
  });
});

describe('messagePrivacy', () => {
  it('reports a bare string as public', () => {
    assert.equal(messagePrivacy('just a question'), 'public');
  });

  it('returns the strongest level across parts', () => {
    const parts: MessagePart[] = [
      { kind: 'text', text: 'q', ...meta('public') },
      { kind: 'signal', signal: {}, ...meta('abstracted') },
      { kind: 'image', mime: 'image/png', data: 'x', ...meta('identifying') },
    ];
    assert.equal(messagePrivacy(parts), 'identifying');
  });

  it('lets a single forbidden part pin the whole message', () => {
    const parts: MessagePart[] = [
      { kind: 'text', text: 'harmless', ...meta('public') },
      { kind: 'file', mime: 'text/plain', data: 'seed', ...meta('forbidden') },
    ];
    assert.equal(messagePrivacy(parts), 'forbidden');
  });

  it('is public when every part is public', () => {
    const parts: MessagePart[] = [textPart('a'), textPart('b')];
    assert.equal(messagePrivacy(parts), 'public');
  });
});

describe('partsToText', () => {
  it('returns a bare string unchanged (backward compatibility)', () => {
    assert.equal(partsToText('unchanged'), 'unchanged');
  });

  it('joins text parts with blank lines', () => {
    const parts: MessagePart[] = [textPart('first'), textPart('second')];
    assert.equal(partsToText(parts), 'first\n\nsecond');
  });

  it('renders a signal via the injected renderer, never [object Object]', () => {
    const parts: MessagePart[] = [{ kind: 'signal', signal: { ruleId: 'ADDRESS_REUSE' }, ...meta('abstracted') }];
    const text = partsToText(parts, {
      renderSignal: s => `SIGNAL:${(s as { ruleId: string }).ruleId}`,
    });
    assert.equal(text, 'SIGNAL:ADDRESS_REUSE');
  });

  it('falls back to a labelled placeholder for a signal with no renderer', () => {
    const parts: MessagePart[] = [{ kind: 'signal', signal: {}, ...meta('abstracted', 'address reuse') }];
    assert.equal(partsToText(parts), '[signal: address reuse]');
    assert.doesNotMatch(partsToText(parts), /\[object Object\]/);
  });

  it('announces an unsupported binary part instead of dropping it silently', () => {
    const parts: MessagePart[] = [
      textPart('look at this'),
      { kind: 'image', mime: 'image/png', data: 'x', ...meta('identifying', 'screenshot') },
    ];
    assert.equal(partsToText(parts), 'look at this\n\n[image attachment: screenshot]');
  });
});

describe('normalizeMessages', () => {
  it('passes string-content messages through unchanged (identity)', () => {
    const messages: PartMessage[] = [
      { role: 'system', content: 'you are Alice' },
      { role: 'user', content: 'hello' },
    ];
    assert.deepEqual(normalizeMessages(messages), [
      { role: 'system', content: 'you are Alice' },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('flattens parts content to wire text while preserving roles', () => {
    const messages: PartMessage[] = [
      { role: 'user', content: [textPart('question'), { kind: 'signal', signal: {}, ...meta('abstracted', 'reuse') }] },
    ];
    assert.deepEqual(normalizeMessages(messages), [
      { role: 'user', content: 'question\n\n[signal: reuse]' },
    ]);
  });
});
