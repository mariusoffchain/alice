import type { AliceWalletActionReason } from './turn-planner.ts';

// Narrow command routing, not authorization and not a natural-language
// security boundary. No wallet-action tool is exposed to chat in any case.
// Composite verbs ("make a payment", "fais un virement", "règle cette
// facture") carry their object; they come first so the plain verbs never
// consume only their first word.
const VERB = /^(?:make (?:a |the |this |another |my )?(?:payment|transfer)|fais (?:un |le |ce |mon |ton |la |cette )?(?:paiement|virement|transfert)|effectue[sz]? (?:un |le |ce |mon |la |cette )?(?:paiement|virement|transfert)|regle[sz]? (?:cette |la |une |ma |sa )?facture|send|pay|transfer|move|sign|broadcast|envoies?|envoyez|envoyer|payes?|payez|payer|paies?|signes?|signez|signer|diffuses?|diffusez|diffuser|transferes?|transferez|transferer|vires?|virez|virer)\b/;
const COMPOSITE_VERB = /\b(?:payment|transfer|paiement|virement|transfert|facture)\b/;
// Verbs that only ever act on money here, so a pronoun is enough of an object
// ("pay it", "broadcast it", "signe-la"); "send it" stays ambiguous.
const MONEY_ONLY_VERB = /^(?:pay|sign|broadcast|payes?|paies?|signes?|diffuses?)$/;
const PRONOUN_OBJECT = /^(?:it|them|that one|this one|la|le|les|ca|cela|celle-ci|celui-ci)\b/;
// "Pay attention", "pay tribute": idioms, never a transfer.
const PAY_IDIOM = /^(?:(?:close |no )?attention|tribute|homage|heed|respect|a visit)\b/;
// A question about whether something is possible asks for an explanation.
const POSSIBILITY = /\b(?:is (?:that|this|it) (?:even )?possible|possible\s*\?|peut[- ]on|est[- ]ce (?:que c'est )?possible|c'est possible)/;
const FRENCH_INFINITIVE = /^(?:envoyer|payer|signer|diffuser|transferer|virer)$/;
const FRENCH_ACTOR = /^(?:(?:s'il te plait)[, ]+)?(?:(?:peux|pourrais)[- ]tu|tu peux|j'ai besoin que tu)\b/;
const OBJECT = /\b(?:bitcoins?|btc|sats?|satoshis?|funds?|payments?|invoices?|transactions?|psbts?|lnbc\w*|ln(?:url|invoice)\w*|bolt ?11|fonds|paiements?|factures?)\b/;
const NON_PAYMENT_OBJECT = /\b(?:messages?|emails?|images?|pictures?|diagrams?|summar(?:y|ies)|explanations?|whitepapers?|articles?|guides?|descriptions?|links?|documents?|details?|formats?|lists?|history|hash(?:es)?|ids?|examples?|tutorials?|textes?|resumes?|explications?|liens?|schemas?|listes?|historique|identifiants?|exemples?|tutoriels?)\b/;
const EDUCATIONAL = /^(?:(?:can|could|would|will) you |(?:peux|pourrais)[- ]tu |tu peux )?(?:explain|define|teach|show me how|tell me|check (?:if|whether)|what|why|how|when|where|which|who|suppose|imagine|if|when|explique\w*|definis|montre[- ]moi comment|me montrer comment|me dire comment|expliquer|m'expliquer|me dire|verifier si|comment|pourquoi|si|lorsque|suppose|quand|qu'est[- ]ce|c'est quoi|quel\w*)\b/;
const BYPASS = /\b(?:without (?:confirming|checking|reviewing|verifying)|skip(?:ping)? (?:the )?(?:confirmation|review|fee check)|bypass(?:ing)? (?:the )?(?:review|confirmation|fees?)|don't (?:bother )?(?:check(?:ing)?|review(?:ing)?|confirm(?:ing)?)|sans (?:confirmer|verifier|verification)|ignore (?:la )?(?:verification|confirmation)|passe (?:la )?confirmation)\b/;

function unquote(value: string): string {
  // Apostrophes within don't / l'adresse / m'a are not quotation delimiters.
  return value.replace(/"[^"\n]*"|«[^»\n]*»|“[^”\n]*”/g, ' ')
    .replace(/(^|\s)['‘][^'’\n]*['’](?=\s|[.!?;,]|$)/g, '$1 ');
}

function commandText(value: string): string {
  return value.trim().replace(/^[,\s]+/, '')
    .replace(/^(?:please|just|s'il te plait)[, ]+/, '')
    .replace(/^(?:(?:hey |ok |okay |salut )?alice)[, ]+/, '')
    .replace(/^(?:(?:can|could|would|will) you|i(?:'d| would)? (?:want|need|like|would like) you to|(?:peux|pourrais)[- ]tu|tu peux|j'ai besoin que tu|j'aimerais que tu|je voudrais que tu)\s+/, '')
    .replace(/^(?:please|just|go ahead and|go ahead|vas[- ]y et|vas[- ]y)[, ]+/, '')
    .replace(/^(?:me|nous|lui|leur|le|la|les)\s+|^m'/, '');
}

export function walletActionGuardReason(message: string): AliceWalletActionReason | null {
  const text = unquote(message).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'").toLowerCase();
  for (const sentence of text.split(/(?<=[.!?;])\s+/)) {
    const clause = sentence.trim().replace(/^(?:hi|hello|hey|bonjour|salut|merci|thanks)[,! ]+/, '').replace(/^(?:(?:hey |ok |okay )?alice)[,! ]+/, '');
    // Educational/hypothetical framing applies to coordinated verbs too.
    // A separate following sentence can still contain an explicit request.
    if (EDUCATIONAL.test(clause) || POSSIBILITY.test(clause)) continue;
    for (const part of clause.split(/,\s+(?=(?:just|please)\b)|(?:,\s*)?\b(?:and(?: then)?|then|et|puis|ensuite|but|mais)\s+/)) {
      const command = commandText(part);
      const verb = VERB.exec(command);
      if (!verb) continue; // Also excludes negated commands and quoted reports.
      // A bare infinitive also starts subject-first questions such as
      // whether sending more BTC costs more; require an explicit actor.
      if (FRENCH_INFINITIVE.test(verb[0]) && !FRENCH_ACTOR.test(clause)) continue;
      const remainder = command.slice(verb[0].length).slice(0, 180);
      const trimmedRemainder = remainder.trim();
      if (COMPOSITE_VERB.test(verb[0]) || (MONEY_ONLY_VERB.test(verb[0]) && PRONOUN_OBJECT.test(trimmedRemainder))) {
        if (/^(?:pas|jamais)\b/.test(trimmedRemainder)) continue;
        return BYPASS.test(clause) ? 'review-bypass' : 'send-payment';
      }
      if (/^pay/.test(verb[0]) && PAY_IDIOM.test(trimmedRemainder)) continue;
      const object = OBJECT.exec(remainder);
      if (!object) continue;
      // Inspect the actual requested object, not an unrelated Bitcoin mention
      // later in "send me a message about Bitcoin" or "Bitcoin whitepaper".
      const target = remainder.slice(0, object.index + object[0].length);
      const nextWord = remainder.slice(object.index + object[0].length).match(/^\s+(\w+)/)?.[1] ?? '';
      if (NON_PAYMENT_OBJECT.test(target) || NON_PAYMENT_OBJECT.test(nextWord)) continue;
      if (/^(?:pas|jamais)\b/.test(remainder.trim())) continue;
      return BYPASS.test(clause) ? 'review-bypass' : 'send-payment';
    }
  }
  return null;
}
