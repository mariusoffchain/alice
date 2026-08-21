import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyVeniceError,
  parseVeniceErrorText,
  quotaBlockOf,
  VeniceAPIError,
} from './venice-errors.ts';

describe('quotaBlockOf', () => {
  it('tells the free allowance apart from a paid one', () => {
    // They lead to different offers: the free one ends unless you buy, the
    // paid one repairs itself at the next reset.
    assert.equal(
      quotaBlockOf(new VeniceAPIError('free_quota_exhausted', 'used up', 402)),
      'free',
    );
    assert.equal(
      quotaBlockOf(new VeniceAPIError('plan_quota_exhausted', 'used up', 402)),
      'plan',
    );
  });

  it('does not treat other failures as an offer to sell something', () => {
    // Showing a plan pitch after a network blip or a rejected key would be
    // both wrong and insulting.
    assert.equal(quotaBlockOf(new VeniceAPIError('network', 'offline')), null);
    assert.equal(quotaBlockOf(new VeniceAPIError('auth', 'bad key', 401)), null);
    assert.equal(
      quotaBlockOf(new VeniceAPIError('insufficient_credits', 'venice is out', 402)),
      null,
    );
    assert.equal(quotaBlockOf(new Error('something else')), null);
    assert.equal(quotaBlockOf(null), null);
  });
});

describe('classifyVeniceError', () => {
  it('maps 401 and 403 to auth', () => {
    assert.equal(classifyVeniceError(401, 'Unauthorized'), 'auth');
    assert.equal(classifyVeniceError(403, 'Forbidden'), 'auth');
  });

  it('maps 402 to insufficient_credits', () => {
    assert.equal(classifyVeniceError(402, 'Payment required'), 'insufficient_credits');
  });

  it('maps 404 to model_unavailable', () => {
    assert.equal(classifyVeniceError(404, 'Not found'), 'model_unavailable');
  });

  it('maps 429 to rate_limit', () => {
    assert.equal(classifyVeniceError(429, 'Too many requests'), 'rate_limit');
  });

  it('maps every 5xx to provider_unavailable', () => {
    for (const status of [500, 502, 503, 504, 599]) {
      assert.equal(classifyVeniceError(status, 'Server error'), 'provider_unavailable');
    }
  });

  it('falls back to api_error when neither status nor text says anything', () => {
    assert.equal(classifyVeniceError(400, 'Bad request'), 'api_error');
    assert.equal(classifyVeniceError(418, ''), 'api_error');
  });

  // The regression this whole function was rewritten for: provider prose used to
  // win over the status code, so a quota message naming the model was reported
  // as "model unavailable" and a rejected key fell through to a generic error.
  describe('status code beats message text', () => {
    it('keeps 401 as auth even when the body talks about credits', () => {
      assert.equal(
        classifyVeniceError(401, 'Insufficient credit balance for this model'),
        'auth',
      );
    });

    it('keeps 429 as rate_limit even when the body names a missing model', () => {
      assert.equal(
        classifyVeniceError(429, 'model e2ee-glm-5-2-p not found'),
        'rate_limit',
      );
    });

    it('keeps 503 as provider_unavailable even when the body mentions payment', () => {
      assert.equal(
        classifyVeniceError(503, 'payment required'),
        'provider_unavailable',
      );
    });

    it('keeps 402 as insufficient_credits even when the body names the model', () => {
      assert.equal(
        classifyVeniceError(402, 'model unavailable on your plan'),
        'insufficient_credits',
      );
    });
  });

  describe('text fallback, only for statuses that carry no meaning', () => {
    it('reads credit wording on a 400', () => {
      for (const message of [
        'Insufficient funds',
        'Not enough credit',
        'Your balance is empty',
        'Payment required',
      ]) {
        assert.equal(classifyVeniceError(400, message), 'insufficient_credits');
      }
    });

    it('reads model wording on a 400', () => {
      assert.equal(classifyVeniceError(400, 'The model was not found'), 'model_unavailable');
      assert.equal(classifyVeniceError(400, 'Model temporarily unavailable'), 'model_unavailable');
    });

    it('is case insensitive', () => {
      assert.equal(classifyVeniceError(400, 'INSUFFICIENT CREDIT'), 'insufficient_credits');
      assert.equal(classifyVeniceError(400, 'MODEL NOT FOUND'), 'model_unavailable');
    });

    it('does not call it a model problem when only the word model appears', () => {
      assert.equal(classifyVeniceError(400, 'Unsupported model parameter'), 'api_error');
    });
  });
});

// `missing_api_key` and `network` never come from a response, so they are raised
// directly by sendMessage rather than classified. Asserting that keeps the two
// paths from quietly drifting into this function.
describe('codes that classification must not produce', () => {
  it('never returns missing_api_key or network', () => {
    const statuses = [0, 200, 400, 401, 402, 403, 404, 418, 429, 500, 503];
    const messages = ['', 'network request failed', 'missing api key', 'insufficient credit'];
    for (const status of statuses) {
      for (const message of messages) {
        const code = classifyVeniceError(status, message);
        assert.notEqual(code, 'missing_api_key');
        assert.notEqual(code, 'network');
      }
    }
  });
});

describe('parseVeniceErrorText', () => {
  it('pulls the message out of the usual JSON shapes', () => {
    assert.equal(parseVeniceErrorText('{"error":{"message":"Rate limited"}}'), 'Rate limited');
    assert.equal(parseVeniceErrorText('{"message":"Bad key"}'), 'Bad key');
    assert.equal(parseVeniceErrorText('{"detail":"Nope"}'), 'Nope');
  });

  it('returns the raw text when the body is not JSON', () => {
    assert.equal(parseVeniceErrorText('  Gateway timeout  '), 'Gateway timeout');
  });

  it('returns the raw text when the JSON carries no usable message', () => {
    assert.equal(parseVeniceErrorText('{"error":{"code":42}}'), '{"error":{"code":42}}');
    assert.equal(parseVeniceErrorText('{"message":"   "}'), '{"message":"   "}');
  });
});
