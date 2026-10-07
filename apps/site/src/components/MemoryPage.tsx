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
  stored: { heading: string; rows: Pair[]; after: string; trustLabel: string; afterTrust: string };
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
      'Alice keeps two memories, both on your device. The personal memory holds short facts you said about yourself: a preference for short answers, the hardware you use, a project you are building, a constraint to keep in mind, or a sentence you asked her to keep. The learning profile holds how familiar you are with fourteen Bitcoin concepts, so she can pick the right vocabulary and depth. Neither is stored on our servers, and neither is a source of truth for Alice: they only change how she answers, never what she holds to be true.',
      'This page describes what the code does today, in Alice App 0.2.2 on the web and on desktop. The Android app, Alice Wallet, is still version 0.2.0 and keeps the previous memory until its next build: how it differs is said under “Where it is stored” and “See, edit and erase everything”. The parts that are decided and not yet in the app are listed at the end, under “Coming”, and nowhere else.',
    ],
    capture: {
      heading: 'What Alice remembers, and how',
      lead: 'A fact can reach the memory by three paths. All of them go through the same filters before anything is written.',
      paths: [
        {
          title: 'Fixed patterns, in the code',
          body: 'A short list of sentence shapes is checked against your message, without any model: “I prefer concise answers” or “detailed answers”, “I am building…”, “I am working on…”, “my goal is…”, “I want to…”, and their French forms. At most two facts per message come out of this path.',
        },
        {
          title: '“Remember that…”, when you ask',
          body: 'When you ask in so many words (“remember that…”, “please remember…”, “retiens que…”), Alice keeps your sentence as you wrote it, in a Requested notes category. The sentence must be about you and must not contain a question; otherwise it is an ordinary message. When the request is your whole message, Alice answers “Noted: …” only once the note is actually saved, and if a filter refuses it, she says so and names what it caught.',
        },
        {
          title: 'A proposal from the model',
          body: 'When memory is on, the model is asked to append a hidden block after its visible answer, with zero to three facts, each in one of eight categories: preference, setup, experience, goal, project, interest, background, constraint. It is told to keep only what you stated explicitly about yourself, never to infer identity, personality, beliefs, expertise or circumstances, and never to save an amount or an exchange account. It cannot file anything as a requested note. The app reads that block and removes it before the answer is shown.',
        },
        {
          title: 'The learning profile, separately',
          body: 'The concepts your questions touch count as signals, and a sentence like “I am comfortable with UTXOs” sets a declared level that the model must respect. In Learn, reading a chapter counts as a signal and finishing a course sets a level. The profile stores, per concept, one familiarity state (never seen, introduced, exploring, familiar), a count of signals and dates rounded to the day. Nothing else.',
        },
      ],
      caption:
        'From a message to the memory on your device. Whatever the path, the same five filters run first. A refused fact is not written, and only a “remember that” request gets an answer saying why. Our servers hold no copy at any point.',
    },
    refused: {
      heading: 'What the code refuses',
      lead: 'Every candidate, whichever path it came from, passes five filters written in the code. One refusal is enough: nothing is written. Most refusals are silent. When your message is only a “remember that” request, or when you edit a fact on the memory screen, the reason is shown instead.',
      filters: [
        {
          title: '1. The secrets detector',
          body: 'Twelve or more words in a row from the recovery-phrase word list, private keys in WIF format, extended private keys, and a hexadecimal key preceded by the words “private key” or “secret key”.',
        },
        {
          title: '2. Raw values',
          body: 'Bitcoin addresses, xpub and xprv keys of every family, Nostr keys, Lightning invoices, 64-character hexadecimal strings, email addresses, phone numbers, identifiers with a hash sign, UUIDs.',
        },
        {
          title: '3. Amounts',
          body: 'A number followed by a bitcoin or currency unit (“0.5 BTC”, “20k sats”, “150 €”, “two bitcoins”), or a currency sign or code followed by a number (“$300”). A bare number stays allowed, so “since 2021” or “a 2-of-3 multisig” can be kept.',
        },
        {
          title: '4. Exchange accounts',
          body: 'The name of an exchange such as Binance, Kraken or Coinbase, refused on sight. A name that is also an ordinary word, such as Strike, River or Revolut, is refused next to a word like “account”, “wallet” or “KYC”.',
        },
        {
          title: '5. Forbidden subjects',
          body: 'Recovery phrase, private key, address, invoice, transaction id, transaction, balance, sats, email, phone number, user id, username, password, first and last name, health, medical, disease, religion, sexual, home address, coordinates, in English and French. Each word is matched whole, so a variant can slip past: “politics”, “sexuality” or “diagnosis” are not on the list.',
        },
      ],
      limits:
        'A fact is also refused if it is shorter than 3 or longer than 160 characters, or carries no known category. Duplicates are ignored, and nothing new enters a paused category. There is no cap on the number of facts: none is dropped to make room.',
      guards:
        'Two more rules sit upstream. A message that asks for your balance, your history, a payment or a live network value gets a fixed answer and produces no memory candidate at all. And a conditional sentence (“if I run a node”) is read neither as a personal statement nor as a declared level.',
    },
    stored: {
      heading: 'Where it is stored',
      rows: [
        { title: 'On the web, app.alicebtc.com', body: 'In your browser’s local storage, on this device only.' },
        { title: 'On desktop, Alice App for macOS, Windows and Linux', body: 'In the same local storage, encrypted by the application before it is written, with a key kept in the system keychain.' },
        { title: 'On the phone, Alice Wallet', body: 'In the phone’s secure store (Android Keystore), tied to this device. The app you can install today is 0.2.0, with the previous memory: six categories, twenty facts at most (the oldest leave first), the earlier filters without the amount and exchange rules, Forget but no edit. Its next build brings what this page describes, and moves a memory that outgrows the secure store to a file the app encrypts.' },
        { title: 'On our servers', body: 'Nothing. No copy, no sync between devices, no export to your account.' },
      ],
      after:
        'When you use Private Cloud, the facts selected for a message, ten at most, and the learning hints for its concepts travel inside the same encrypted envelope as the message itself, meant to be opened only inside the enclave, never by the proxy and never by us. Alice checks the enclave hardware before every message, but cannot yet verify which software runs inside it: ',
      trustLabel: 'see Trust',
      afterTrust:
        '. In Local mode nothing leaves the device at all, memory included. With a custom server you connect yourself, they go to that server with your message.',
    },
    used: {
      heading: 'How Alice uses it, and how she does not',
      p1: 'At every turn, Alice receives a short block headed, in substance, “private device-local memory, use it only when relevant, it never overrides the current message”. Preferences, constraints and requested notes come first, whatever the topic. Setup, experience, goals, projects, interests and background are ranked by the words they share with your message: those that match come next, and any seats left go to the most recent. Ten facts at most, however many are stored.',
      notLead: 'What she is told never to do:',
      nots: [
        'Let the memory override what you are asking now.',
        'Treat the learning profile as a source of facts, or let it change anything other than vocabulary, prerequisites, examples and depth.',
        'Take anything but the wallet as the authority on payments: amounts, destinations and outcomes come from the wallet code alone.',
      ],
      local: 'These are instructions to the model, enforced by the prompt. The filters above are enforced by code. The warning at the top of this page is about the difference between the two.',
    },
    control: {
      heading: 'See, edit and erase everything',
      lead: 'The screen is called “What Alice remembers”. In Alice App it sits under Settings, then AI, then Alice memory. From top to bottom, it shows:',
      items: [
        'The warning, in one sentence: Alice can get this wrong, so give her the minimum.',
        'A general switch for the personal memory. Off, Alice stops reading the facts, stops capturing new ones and keeps no “remember that” note. Learning signals are not covered by the switch: they keep updating until you forget them.',
        'One field per category, shown even when empty, with Pause (nothing new is added there, what is kept stays) and Delete all here.',
        'Each fact with Edit and Delete. An edit goes through the same filters as a capture, and a refusal says why.',
        'Past the fifty most recent facts, a folded “older facts” section, with the same Edit and Delete.',
        'The learning signals, concept by concept, each with a Forget button.',
        'Forget everything, which erases both memories on this device. Your conversations and your wallet are untouched.',
      ],
      edit: 'On the phone, Alice Wallet 0.2.0 still shows the previous screen, under the AI settings: the switch, the list of facts with Forget on each, the learning signals and Forget everything. A fact cannot be edited there: forget it, then say it again the way you want it kept. The new screen reaches the phone with the next Android build.',
    },
    coming: {
      heading: 'Coming, not shipped yet',
      lead: 'These decisions are taken and not yet in the app. Until they ship, nothing on this page should be read as if they were.',
      items: [
        'A notice under the answer, “Alice remembers: …”, with Keep and Forget, shown every time something is captured. Until then, a capture shows only on the “What Alice remembers” screen, or in the reply to a “remember that” request.',
        'Fixed patterns for Setup and Experience (“I have a multisig”, “I use a hardware wallet”, “I run a node”). Until then, these facts come only from the model’s proposal or from a “remember that” request.',
        'On the phone, with the next build of Alice Wallet: the new categories and “remember that” notes, the stronger filters, the screen with fields, Edit and Pause, no cap, and the move to an encrypted file once the memory outgrows the secure store.',
      ],
      outOfPlan: 'Out of scope, by decision: no copy off the device, no sync between devices, no export to your account.',
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
        'Your message can reach the memory by two kinds of path. In the code: fixed patterns, which keep at most two facts, and an explicit “remember that” request, kept word for word. From the model: zero to three facts in a hidden block after its answer, never inferred. Everything goes through five filters in the code: a secrets detector, raw values, amounts, exchange accounts and forbidden subjects. A refused fact is not written, and only a “remember that” request gets an answer saying why. An accepted fact goes to the memory on your device, 160 characters a fact and no cap on their number: in the browser’s local storage on the web, encrypted by the app on desktop, in the phone’s secure store on mobile. That memory feeds the next conversation, where preferences, constraints and requested notes come first and the rest is ranked by the message, ten at most, and the “What Alice remembers” screen, with Edit and Delete per fact, Pause and Delete all per category, Forget per concept and Forget everything.',
      message: 'Your message',
      patterns: { title: 'In the code', lines: ['“I prefer”, “my goal is”,', '“I am working on”:', '2 facts at most;', '“remember that…”:', 'kept word for word'] },
      model: { title: 'The model proposes', lines: ['0 to 3 facts in a hidden', 'block after its answer,', 'never inferred'] },
      filters: { title: 'Five filters, in the code', lines: ['1. secrets detector (seed, keys)', '2. raw values (addresses, ids)', '3. amounts in any unit', '4. exchange accounts', '5. forbidden subjects'] },
      refused: { title: 'Refused', lines: ['nothing is written;', 'on “remember that”,', 'Alice says why'] },
      stored: { title: 'Memory on your device', lines: ['160 characters a fact, no cap', 'web: local storage', 'desktop: encrypted by the app', 'phone: secure store'] },
      next: { title: 'Next conversation', lines: ['preferences, constraints,', 'requested notes first,', 'the rest ranked by', 'the message, 10 at most'] },
      screen: { title: '“What Alice remembers”', lines: ['Edit, Delete per fact,', 'Pause, Delete all here,', 'Forget per concept,', 'Forget everything'] },
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
        <p className="mt-4 leading-relaxed text-[var(--alice-text)]">
          {copy.stored.after}
          <a href="/trust/#status" className={link}>{copy.stored.trustLabel}</a>
          {copy.stored.afterTrust}
        </p>

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
