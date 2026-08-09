function describeLogArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name} ${arg.message}`;
  if (typeof arg === 'string') return arg;
  if (!arg || typeof arg !== 'object') return String(arg ?? '');

  const record = arg as Record<string, unknown>;
  return [
    record.name,
    record.message,
    record.code,
  ].filter(Boolean).join(' ');
}

export function isRecoverableArkadeSettlementLog(args: unknown[]): boolean {
  const message = args
    .map(describeLogArg)
    .join(' ')
    .toLowerCase();

  const incompleteRound = message.includes('error during periodic settle')
    && message.includes('not enough intent confirmations received');
  const missingIntent = (
    message.includes('no matching intents found for intent proof')
    || (
      message.includes('invalid_intent_proof')
      && message.includes('no matching intents')
    )
  );
  const alreadyRemovedIntent = missingIntent && (
    message.includes('failed to delete intent after settle failure')
    || message.includes('error during periodic settle')
  );

  return incompleteRound || alreadyRemovedIntent;
}
