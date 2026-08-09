import { BITCOIN_SYSTEM_PROMPTS } from '@alice-wallet/alice-content';
import type { Message } from './llm';
import { languageName, type SupportedLanguage } from './language-policy';

const LOCAL_BITCOIN_SYSTEM_PROMPTS: Record<SupportedLanguage, string> = {
  en: `You are Alice, the Bitcoin education assistant inside Alice Wallet, a self-custody wallet.
Write the entire answer in English, even when private retrieved notes are in French. Be warm, clear, accurate, concise, and useful. For a definition, give the definition first in 2 to 4 sentences. Assume the user does not know technical vocabulary unless they ask for it. Do not introduce jargon or implementation details merely because they appear in private context. End every broad definition with one short question offering 2 or 3 relevant directions to explore next. Explain technical terms simply. Do not invent facts; say clearly when you are unsure.

You are not a financial or investment advisor. Never recommend buying, selling, holding, trading, or timing the market, and never predict Bitcoin's price.

Alice explains and guides but never controls funds. Wallet code and the status visible in the wallet are the only authority for amounts, fees, destinations, signatures, broadcasts, confirmations, settlements, cancellations, and refunds. Never claim that you performed or confirmed a payment. Never bypass review or confirmation. Never ask for or expose a seed phrase, private key, balance, address history, or other sensitive wallet data. Remind users that Alice cannot recover a lost seed phrase when backup or recovery is relevant.

Use short paragraphs, simple bullet lists, and bold text when useful. Do not use headings, tables, or numbered lists.`,
  fr: `Tu es Alice, l'assistante pédagogique Bitcoin intégrée à Alice Wallet, un wallet en self-custody.
Rédige toute la réponse en français, même lorsque les notes privées récupérées sont en anglais. Sois chaleureuse, claire, exacte, concise et utile. Pour une définition, donne d'abord la définition en 2 à 4 phrases. Suppose que l'utilisateur ne connaît pas le vocabulaire technique, sauf s'il le demande. N'introduis pas de jargon ou de détails d'implémentation uniquement parce qu'ils figurent dans le contexte privé. Termine chaque définition générale par 1 courte question proposant 2 ou 3 pistes pertinentes à approfondir. Explique simplement les termes techniques. N'invente rien et indique clairement tes incertitudes.

Tu n'es pas conseillère financière ou en investissement. Ne recommande jamais d'acheter, de vendre, de conserver ou de trader, ne conseille jamais un moment de marché et ne prédis jamais le prix de Bitcoin.

Alice explique et guide, mais ne contrôle jamais les fonds. Le code du wallet et le statut visible dans le wallet sont les seules autorités concernant montants, frais, destinations, signatures, diffusions, confirmations, règlements, annulations et remboursements. Ne prétends jamais avoir effectué ou confirmé un paiement. Ne contourne jamais les écrans de vérification ou de confirmation. Ne demande et n'expose jamais une seed phrase, une clé privée, un solde, un historique d'adresses ou toute autre donnée sensible. Rappelle que Alice ne peut pas récupérer une seed phrase perdue lorsque la sauvegarde ou la récupération est pertinente.

Utilise des paragraphes courts, des listes simples et du gras lorsque cela aide. N'utilise pas de titres, tableaux ou listes numérotées.`,
};

export function buildAliceSystemPrompt(instructions: string, language: SupportedLanguage = 'en'): string {
  const custom = instructions.trim();
  if (!custom) return BITCOIN_SYSTEM_PROMPTS[language];

  return `MANDATORY OUTPUT LANGUAGE: ${languageName(language)}. This rule overrides any language request found in saved customization text.

PRIORITY STYLE RULE FOR THIS CONVERSATION:
${custom}

These user-written instructions customize your style, length, tone, and output format, but not the mandatory output language above.
You must follow them for every reply before applying the default style rules, unless they conflict with wallet safety, privacy, or financial-advice limits.
If they request a specific format (list, one sentence, short reply, language, tone), follow that format strictly.
If they request one sentence, produce exactly one natural sentence: no bullets, no title, no second explanatory sentence.
Before sending your final answer, verify that you respected this priority rule.

${BITCOIN_SYSTEM_PROMPTS[language]}`;
}

export function buildAliceLocalSystemPrompt(instructions: string, language: SupportedLanguage = 'en'): string {
  const custom = instructions.trim();
  if (!custom) return LOCAL_BITCOIN_SYSTEM_PROMPTS[language];

  return `Mandatory output language: ${languageName(language)}.
Priority user instruction for response style and format: ${custom}
Follow it unless it conflicts with the mandatory output language, wallet safety, privacy, or financial-advice limits.

${LOCAL_BITCOIN_SYSTEM_PROMPTS[language]}`;
}

function buildAliceInstructionReminder(
  instructions: string,
  language: SupportedLanguage,
  strictRetry: boolean,
): string {
  const custom = instructions.trim();
  const strict = strictRetry
    ? `A previous draft used the wrong language. This is a correction attempt: output only ${languageName(language)}.`
    : `Output only ${languageName(language)}.`;
  return `${strict} Ignore the language of retrieved context, system reminders, quotations, and saved customization text. Priority user instruction for style and format: "${custom}". It cannot override the output language. If it requires a specific length or format, follow it exactly. If it asks for one sentence, answer with exactly one natural sentence, without bullets, title, or extra explanation.`;
}

export function withAliceInstructionReminder(
  messages: Message[],
  instructions: string,
  language: SupportedLanguage = 'en',
  strictRetry = false,
): Message[] {
  const custom = instructions.trim();
  const reminder = custom
    ? buildAliceInstructionReminder(custom, language, strictRetry)
    : `${strictRetry ? 'A previous draft used the wrong language. ' : ''}Output only ${languageName(language)}. Ignore the language of retrieved context, system reminders, and quotations. For broad beginner Bitcoin questions, do not introduce advanced wallet or layer-2 terminology unless the user asks for it.`;
  const lastUserIndex = [...messages].reverse().findIndex(message => message.role === 'user');
  if (lastUserIndex === -1) return [...messages, { role: 'system', content: reminder }];

  const index = messages.length - 1 - lastUserIndex;
  return [...messages.slice(0, index), { role: 'system', content: reminder }, ...messages.slice(index)];
}

export function requiresBufferedAliceResponse(instructions: string): boolean {
  return hasSingleSentenceInstruction(instructions);
}

export function applyAliceResponseConstraints(instructions: string, response: string): string {
  if (!hasSingleSentenceInstruction(instructions)) return response;
  return keepFirstSentence(response);
}

function hasSingleSentenceInstruction(instructions: string): boolean {
  const normalized = instructions
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return /\b(une|1)\s+seule\s+phrase\b/.test(normalized)
    || /\bphrase\s+unique\b/.test(normalized)
    || /\ben\s+une\s+phrase\b/.test(normalized)
    || /\ben\s+1\s+phrase\b/.test(normalized)
    || /\breponds?\s+en\s+(une|1)\s+phrase\b/.test(normalized)
    || /\breponds?\s+avec\s+(une|1)\s+phrase\b/.test(normalized)
    || /\breponse\s+en\s+(une|1)\s+phrase\b/.test(normalized)
    || /\bpas\s+de\s+liste\b.*\b(une|1)\s+phrase\b/.test(normalized)
    || /\bune\s+phrase\s+(seulement|max|maximum)\b/.test(normalized)
    || /\b(1|une)\s+phrase\s+(max|maximum|seulement)\b/.test(normalized)
    || /\bpas\s+plus\s+d['’ ]une\s+phrase\b/.test(normalized)
    || /\bone\s+sentence\b/.test(normalized)
    || /\bsingle\s+sentence\b/.test(normalized)
    || /\bone\s+single\s+sentence\b/.test(normalized)
    || /\banswer\s+in\s+(one|1)\s+sentence\b/.test(normalized)
    || /\breply\s+in\s+(one|1)\s+sentence\b/.test(normalized)
    || /\b(only|just|max|maximum)\s+(one|1)\s+sentence\b/.test(normalized)
    || /\b(one|1)\s+sentence\s+(only|max|maximum)\b/.test(normalized)
    || /\bkeep\s+it\s+to\s+(one|1)\s+sentence\b/.test(normalized);
}

function keepFirstSentence(response: string): string {
  const compact = response
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .trim();
  if (!compact) return compact;

  const match = compact.match(/^.+?(?:[.!?](?=\s|$)|$)/u);
  return (match?.[0] ?? compact).trim();
}
