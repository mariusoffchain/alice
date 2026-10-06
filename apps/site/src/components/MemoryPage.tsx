import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { MemoryFlowDiagram, type MemoryFlowCopy } from '@/components/MemoryFlowDiagram';
import { SOURCE_URL } from '@/lib/site';
import { externalLinkProps } from '@/lib/links';

// One component, one copy table: the words sit apart from the structure so
// the page reads as prose in the source and stays easy to revise.

export const MEMORY_DOC_URL = `${SOURCE_URL}/blob/main/docs/ALICE_USER_MEMORY.md`;

type Pair = { title: string; body: string };

type MemoryCopy = {
  eyebrow: string;
  title: string;
  warningEyebrow: string;
  warningLead: string;
  warningBody: string;
  intro: string[];
  capture: { heading: string; lead: string; paths: Pair[]; caption: string };
  refused: { heading: string; lead: string; filters: Pair[]; limits: string; guards: string };
  stored: { heading: string; rows: Pair[]; after: string };
  used: { heading: string; p1: string; notLead: string; nots: string[]; local: string };
  control: { heading: string; lead: string; items: string[]; edit: string };
  coming: { heading: string; lead: string; items: string[]; outOfPlan: string };
  closing: { before: string; docLabel: string; between: string; privacyLabel: string; and: string; trustLabel: string; after: string };
  diagram: MemoryFlowCopy;
};

const copy: MemoryCopy = {
    eyebrow: 'Memory',
    title: 'What Alice remembers about you.',
    warningEyebrow: 'Read this first',
    warningLead: 'Alice can get this wrong.',
    warningBody:
      'She may misread a sentence and keep something she should not have kept, and the filters described here can miss a case they did not anticipate. They are a safeguard, not a guarantee. Do not fully trust what is shown as remembered or as forgotten. The real protection is to give Alice only the minimum your question needs, and never an address, a key, a recovery phrase, an amount or anything that identifies you. What you type in the conversation remains your responsibility.',
    intro: [
      'Alice keeps two small memories, both on your device. The personal memory holds short facts you said about yourself: a preference for short answers, a project you are building, a constraint to keep in mind. The learning profile holds how familiar you are with fourteen Bitcoin concepts, so she can pick the right vocabulary and depth. Neither leaves your device, and neither is a source of truth for Alice: they only change how she answers, never what she holds to be true.',
      'This page describes what the code does today. The parts that are decided and not yet in the app are listed at the end, under “Coming”, and nowhere else.',
    ],
    capture: {
      heading: 'What Alice remembers, and how',
      lead: 'A fact can reach the memory by two paths. Both go through the same filters before anything is written.',
      paths: [
        {
          title: 'Fixed patterns, in the code',
          body: 'A short list of sentence shapes is checked against your message, without any model: “I prefer concise answers” or “detailed answers”, “I am building…”, “I am working on…”, “my goal is…”, “I want to…”. At most two facts per message come out of this path.',
        },
        {
          title: 'A proposal from the model',
          body: 'When memory is on, the model is asked to append a hidden block after its visible answer, with zero to two facts, each in one of six categories: preference, goal, project, interest, background, constraint. It is told to keep only what you stated explicitly about yourself, and never to infer identity, personality, beliefs, expertise or circumstances. The app reads that block and removes it before the answer is shown.',
        },
        {
          title: 'The learning profile, separately',
          body: 'The concepts your questions touch count as signals, and a sentence like “I am comfortable with UTXOs” sets a declared level that the model must respect. The profile stores, per concept, one familiarity state (never seen, introduced, exploring, familiar), a count of signals and dates rounded to the day. Nothing else.',
        },
      ],
      caption:
        'From a message to the memory on your device. Both capture paths go through the same three filters; a refused fact is dropped silently. Our servers hold no copy at any point.',
    },
    refused: {
      heading: 'What the code refuses',
      lead: 'Every candidate, whichever path it came from, passes three filters written in the code. One refusal is enough: nothing is written, and no message is shown.',
      filters: [
        {
          title: '1. The secrets detector',
          body: 'Sequences of recovery-phrase words, private keys in WIF format, extended private keys, and a hexadecimal key preceded by the words “private key”.',
        },
        {
          title: '2. Forbidden subjects',
          body: 'Recovery phrase, private key, address, invoice, transaction id, transaction, balance, sats, email, phone, user id, username, password, first and last name, health, religion, politics, sexuality, home address, coordinates.',
        },
        {
          title: '3. Raw values',
          body: 'Bitcoin addresses, xpub and xprv keys of every family, Nostr keys, Lightning invoices, 64-character hexadecimal strings, email addresses, phone numbers, identifiers with a hash sign, UUIDs.',
        },
      ],
      limits:
        'A fact is also refused if it is longer than 160 characters or carries no category. Duplicates are ignored, and the memory holds 20 facts at most: the oldest leave first.',
      guards:
        'Two more rules sit upstream. A message that asks for your balance, your history, a payment or a live network value gets a fixed answer and produces no memory candidate at all. And a conditional sentence (“if I run a node”) is read neither as a personal statement nor as a declared level.',
    },
    stored: {
      heading: 'Where it is stored',
      rows: [
        { title: 'On the web, app.alicebtc.com', body: 'In your browser’s local storage, on this device only.' },
        { title: 'On desktop, Alice App for macOS, Windows and Linux', body: 'In the same local storage, encrypted by the application before it is written.' },
        { title: 'On the phone, Alice Wallet', body: 'In the phone’s secure store (iOS keychain, Android Keystore), tied to this device.' },
        { title: 'On our servers', body: 'Nothing. No copy, no sync between devices, no export to your account.' },
      ],
      after:
        'When you use Private Cloud, the few facts relevant to a message travel inside the same end-to-end encrypted envelope as the message itself, readable only by the attested enclave, never by the proxy and never by us. In Local mode nothing leaves the device at all, memory included.',
    },
    used: {
      heading: 'How Alice uses it, and how she does not',
      p1: 'At every turn, Alice receives a short block headed, in substance, “private device-local memory, use it only when relevant, it never overrides the current message”. Preferences and constraints always ride along. Goals, projects, interests and background come only if they share words with your message; when nothing matches, the most recent fill the remaining seats. Ten facts at most.',
      notLead: 'What she is told never to do:',
      nots: [
        'Treat the memory as a source of facts, or as a substitute for her documentation.',
        'Let it touch the payment rules: the wallet remains the only authority on amounts, addresses and outcomes.',
        'Let the learning profile change anything other than vocabulary, prerequisites, examples and depth.',
      ],
      local: 'These are instructions to the model, enforced by the prompt. The filters above are enforced by code. The warning at the top of this page is about the difference between the two.',
    },
    control: {
      heading: 'See, edit and erase everything',
      lead: 'The screen is called “What Alice remembers”. In Alice App it sits under Settings, then AI, then Alice memory. In Alice Wallet on the phone it sits under the AI settings. It shows:',
      items: [
        'A general switch for the personal memory. Off, Alice stops reading the facts and stops capturing new ones. Learning signals are not covered by the switch: they keep updating until you forget them.',
        'The list of facts, each with its category and a Forget button.',
        'The learning signals, concept by concept, each with a Forget button.',
        'Forget everything, which erases both memories on this device. Your conversations and your wallet are untouched.',
      ],
      edit: 'Today a fact cannot be edited in place: forget it, then say it again the way you want it kept. In-place editing is on the list below.',
    },
    coming: {
      heading: 'Coming, not shipped yet',
      lead: 'These decisions are taken and not yet in the app. Until they ship, nothing on this page should be read as if they were.',
      items: [
        'The warning at the top of this page, in one sentence, at the top of the “What Alice remembers” screen in the app.',
        'A notice under the answer, “Alice remembers: …”, with Keep and Forget, shown every time something is captured.',
        'Two new categories: Setup (a hardware wallet, a multisig layout, a node, never an identifier) and Experience (since when, past habits).',
        '“Remember that…” requests, kept as you wrote them in a Requested notes category. The same filters apply, and when a sentence contains an address, a key, a recovery phrase or an amount, Alice refuses and says so.',
        'Stronger filters: any amount with a currency or bitcoin unit, and any exchange name tied to an account.',
        'A field-by-field screen with Edit and Delete on each fact, Delete all here and Pause on each category, and no hard cap: older facts fold into their own section, still editable and deletable. In the conversation the selection stays bounded to ten.',
        'On the phone, a move from the secure store to an encrypted file of the app once the memory grows past what a secure store is meant to hold, migrated without loss.',
      ],
      outOfPlan: 'Out of scope, by decision: nothing leaves the device, no sync between devices, no export to your account.',
    },
    closing: {
      before: 'The source is public under the AGPL. The technical version of this page, with file names and the exact filter lists, lives in the repository: ',
      docLabel: 'read the memory documentation',
      between: '. See also ',
      privacyLabel: 'Privacy',
      and: ' and ',
      trustLabel: 'Trust',
      after: '.',
    },
    diagram: {
      title: 'From a message to the memory on your device',
      description:
        'Your message goes through two capture paths: fixed patterns in the code, which keep at most two facts, and the model, which proposes zero to two facts in a hidden block after its answer without inferring anything. Both feed three filters in the code: a secrets detector, forbidden subjects, and raw values. A refused fact is dropped silently and nothing is written. An accepted fact goes to the memory on your device: twenty facts of 160 characters at most, in the browser’s local storage on the web, encrypted by the app on desktop, in the phone’s secure store on mobile. That memory feeds the next conversation, where preferences and constraints always come along and the rest only if it touches the message, ten at most, and the “What Alice remembers” screen, with a switch, Forget per fact, Forget per concept and Forget everything.',
      message: 'Your message',
      patterns: { title: 'Patterns in the code', lines: ['“I prefer”, “I want to”,', '“I am working on”,', '“my goal is”', '2 facts at most'] },
      model: { title: 'The model proposes', lines: ['0 to 2 facts in a hidden', 'block after its answer,', 'never inferred'] },
      filters: { title: 'Three filters, in the code', lines: ['1. secrets detector (seed, keys)', '2. forbidden subjects', '3. raw values'] },
      refused: { title: 'Refused', lines: ['dropped silently,', 'nothing is written'] },
      stored: { title: 'Memory on your device', lines: ['20 facts of 160 characters', 'web: local storage', 'desktop: encrypted by the app', 'phone: secure store'] },
      next: { title: 'Next conversation', lines: ['preferences and', 'constraints always,', 'the rest if it touches', 'the message, 10 at most'] },
      screen: { title: '“What Alice remembers”', lines: ['switch, Forget per fact,', 'Forget per concept,', 'Forget everything'] },
    },
};

function H({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <h2 id={id} className="mt-12 scroll-mt-24 text-2xl font-semibold sm:text-3xl">
      {children}
    </h2>
  );
}

const link = 'text-[var(--alice-primary)] hover:underline';

export function MemoryPage() {
  return (
    <>
      <SiteNav />
      <main id="main" className="mx-auto max-w-3xl px-5 py-16">
        <p className="font-pixel text-[12px] uppercase tracking-widest text-[var(--alice-primary)]">
          {copy.eyebrow}
        </p>
        <h1 className="mt-5 text-4xl font-semibold leading-[1.12] sm:text-5xl">{copy.title}</h1>

        {/* The warning comes before everything else on purpose, and its text is
            the one agreed in the maintainer's note, not a softened version. */}
        <div
          role="note"
          aria-labelledby="memory-warning-label"
          className="mt-8 rounded-[4px] border border-[var(--alice-border)] border-l-4 border-l-[#d7bd8a] bg-[var(--alice-bg-soft)] p-5 sm:p-6"
        >
          <p id="memory-warning-label" className="font-pixel text-[11px] uppercase tracking-widest text-[#d7bd8a]">
            {copy.warningEyebrow}
          </p>
          <p className="mt-3 text-[17px] leading-relaxed text-[var(--alice-text)]">
            <strong className="text-[var(--alice-heading)]">{copy.warningLead}</strong> {copy.warningBody}
          </p>
        </div>

        {copy.intro.map((paragraph) => (
          <p key={paragraph} className="mt-5 text-lg leading-relaxed text-[var(--alice-text)]">
            {paragraph}
          </p>
        ))}

        <H id="capture">{copy.capture.heading}</H>
        <p className="mt-3 leading-relaxed text-[var(--alice-text)]">{copy.capture.lead}</p>
        <dl className="mt-4 divide-y divide-[var(--alice-border)]">
          {copy.capture.paths.map((path) => (
            <div key={path.title} className="py-5">
              <dt className="text-lg font-semibold text-[var(--alice-heading)]">{path.title}</dt>
              <dd className="mt-2 leading-relaxed text-[var(--alice-text)]">{path.body}</dd>
            </div>
          ))}
        </dl>
        <figure className="mt-8 rounded-[4px] border border-[var(--alice-border)] bg-[var(--alice-card-bg)] p-3 sm:p-6">
          <MemoryFlowDiagram copy={copy.diagram} id="memory-flow" />
          <figcaption className="mt-4 text-sm leading-relaxed text-[var(--alice-muted)]">{copy.capture.caption}</figcaption>
        </figure>

        <H id="refused">{copy.refused.heading}</H>
        <p className="mt-3 leading-relaxed text-[var(--alice-text)]">{copy.refused.lead}</p>
        <dl className="mt-4 divide-y divide-[var(--alice-border)]">
          {copy.refused.filters.map((filter) => (
            <div key={filter.title} className="py-5">
              <dt className="text-lg font-semibold text-[var(--alice-heading)]">{filter.title}</dt>
              <dd className="mt-2 leading-relaxed text-[var(--alice-text)]">{filter.body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 leading-relaxed text-[var(--alice-text)]">{copy.refused.limits}</p>
        <p className="mt-4 leading-relaxed text-[var(--alice-text)]">{copy.refused.guards}</p>

        <H id="stored">{copy.stored.heading}</H>
        <div className="mt-4 overflow-x-auto rounded-[4px] border border-[var(--alice-border)]">
          <table className="w-full text-left text-[15px]">
            <tbody>
              {copy.stored.rows.map((row) => (
                <tr key={row.title} className="border-b border-[var(--alice-border)] align-top last:border-0">
                  <th scope="row" className="w-2/5 p-4 font-semibold text-[var(--alice-heading)]">{row.title}</th>
                  <td className="p-4 text-[var(--alice-text)]">{row.body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 leading-relaxed text-[var(--alice-text)]">{copy.stored.after}</p>

        <H id="use">{copy.used.heading}</H>
        <p className="mt-3 leading-relaxed text-[var(--alice-text)]">{copy.used.p1}</p>
        <p className="mt-4 leading-relaxed text-[var(--alice-text)]">{copy.used.notLead}</p>
        <ul className="mt-2 flex flex-col gap-2 leading-relaxed text-[var(--alice-text)]">
          {copy.used.nots.map((item) => (
            <li key={item} className="flex gap-3">
              <span aria-hidden className="text-[var(--alice-primary)]">×</span>
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 leading-relaxed text-[var(--alice-muted)]">{copy.used.local}</p>

        <H id="control">{copy.control.heading}</H>
        <p className="mt-3 leading-relaxed text-[var(--alice-text)]">{copy.control.lead}</p>
        <ul className="mt-3 flex flex-col gap-2 leading-relaxed text-[var(--alice-text)]">
          {copy.control.items.map((item) => (
            <li key={item} className="flex gap-3">
              <span aria-hidden className="text-[var(--alice-primary)]">✓</span>
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 leading-relaxed text-[var(--alice-text)]">{copy.control.edit}</p>

        <H id="coming">{copy.coming.heading}</H>
        <p className="mt-3 leading-relaxed text-[var(--alice-text)]">{copy.coming.lead}</p>
        <ul className="mt-3 flex flex-col gap-3 leading-relaxed text-[var(--alice-text)]">
          {copy.coming.items.map((item) => (
            <li key={item} className="flex gap-3">
              <span aria-hidden className="shrink-0 font-pixel text-[9px] leading-[1.9] uppercase tracking-widest text-[var(--alice-muted)]">
                coming
              </span>
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 leading-relaxed text-[var(--alice-muted)]">{copy.coming.outOfPlan}</p>

        <p className="mt-12 text-sm text-[var(--alice-muted)]">
          {copy.closing.before}
          <a href={MEMORY_DOC_URL} {...externalLinkProps(MEMORY_DOC_URL)} className="underline underline-offset-4">
            {copy.closing.docLabel}
          </a>
          {copy.closing.between}
          <a href="/privacy/" className="underline underline-offset-4">{copy.closing.privacyLabel}</a>
          {copy.closing.and}
          <a href="/trust/" className="underline underline-offset-4">{copy.closing.trustLabel}</a>
          {copy.closing.after}
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
