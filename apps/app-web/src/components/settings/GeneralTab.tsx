'use client';

import { useEffect, useState } from 'react';
import type { BalanceFormat } from '@alice-wallet/alice-ui/balance-format';
import {
  getResponseLanguagePreference,
  setResponseLanguagePreference,
  type ResponseLanguagePreference,
  useChat,
} from '@alice-wallet/alice-ai';
import { setAmountFormat, useAmountState } from '@/components/AmountDisplay';
import { ChoiceButton, SectionHint, SectionLabel, sectionStyle } from './ui';

// The same unit preference as the wallet's balance (alice_balance_format):
// changing it here changes every amount in Explorer and the wallet alike.
const UNIT_OPTIONS: { value: BalanceFormat; label: string }[] = [
  { value: 'symbol', label: '₿' },
  { value: 'sats', label: 'sats' },
  { value: 'btc', label: 'BTC' },
  { value: 'usd', label: '$' },
];

const LANGUAGE_OPTIONS: [ResponseLanguagePreference, string][] = [
  ['auto', 'AUTO'],
  ['fr', 'FRANCAIS'],
  ['en', 'ENGLISH'],
];

export function GeneralTab() {
  const chat = useChat();
  const amount = useAmountState();
  const [responseLanguage, setResponseLanguageState] = useState<ResponseLanguagePreference>('auto');

  useEffect(() => {
    getResponseLanguagePreference()
      .then(setResponseLanguageState)
      .catch(() => { /* keep the default */ });
  }, []);

  return (
    <>
      <div style={sectionStyle}>
        <SectionLabel>RESPONSE LANGUAGE</SectionLabel>
        <SectionHint>
          Auto follows your latest message. A fixed choice overrides automatic detection.
        </SectionHint>
        <div className="flex gap-2 flex-wrap" role="group" aria-label="Alice response language">
          {LANGUAGE_OPTIONS.map(([value, label]) => (
            <ChoiceButton
              key={value}
              active={responseLanguage === value}
              label={label}
              onClick={async () => {
                setResponseLanguageState(value);
                await setResponseLanguagePreference(value);
                chat.clearMessages();
              }}
            />
          ))}
        </div>
      </div>

      <div style={sectionStyle}>
        <SectionLabel>BALANCE UNIT</SectionLabel>
        <SectionHint>
          How amounts are shown across Explorer, shared with the wallet. Clicking any amount in the app cycles it too.
        </SectionHint>
        <div className="flex gap-2">
          {UNIT_OPTIONS.map((opt) => (
            <ChoiceButton
              key={opt.value}
              active={amount.format === opt.value}
              label={opt.label}
              pixel={false}
              onClick={() => setAmountFormat(opt.value)}
            />
          ))}
        </div>
      </div>
    </>
  );
}
