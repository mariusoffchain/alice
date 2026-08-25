// Curated, well-known mainnet items for the Home page's explore section, so a
// first dive needs zero knowledge and always lands somewhere with a story.
// Every identifier here was checked against a live Esplora endpoint before
// shipping; labels stick to widely documented facts (heights, protocol events,
// public seizures), not speculation.

export type ExploreKind = 'tx' | 'block' | 'address';

export type ExploreExample = {
  kind: ExploreKind;
  /** Short chip label. */
  label: string;
  /** One-line story, shown as the tooltip. */
  note: string;
  /** What gets opened: txid, height, or address. */
  value: string;
};

export const EXPLORE_TXS: ExploreExample[] = [
  {
    kind: 'tx', label: 'First BTC payment',
    note: 'Satoshi sends 10 BTC to Hal Finney, block 170 (January 2009): the first peer-to-peer bitcoin payment.',
    value: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
  },
  {
    kind: 'tx', label: 'Genesis coinbase',
    note: 'The 50 BTC reward of block 0. A quirk makes it unspendable forever.',
    value: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
  },
  {
    kind: 'tx', label: 'Bitcoin Pizza',
    note: '10,000 BTC for two pizzas (May 2010), the first documented real-world purchase.',
    value: 'a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d',
  },
  {
    kind: 'tx', label: 'Whitepaper on-chain',
    note: 'The Bitcoin whitepaper PDF, encoded into transaction outputs in 2013. It lives on the chain itself.',
    value: '54e48e5f5c656b26c3bca14a8c95aa583d07ebe84dde3b7dd4a78f4e4186e713',
  },
  {
    kind: 'tx', label: 'Duplicated coinbase',
    note: 'This coinbase exists in TWO blocks (91,812 and 91,842), the oddity that led to BIP30.',
    value: 'd5d27987d2a3dfc724e359870c6644b40e497bdc0589a033220fe15429d88599',
  },
];

export const EXPLORE_BLOCKS: ExploreExample[] = [
  { kind: 'block', label: 'Genesis block', note: 'Block 0, mined by Satoshi on January 3, 2009, with the Times headline in its coinbase.', value: '0' },
  { kind: 'block', label: 'First payment block', note: 'Block 170 holds the first peer-to-peer payment, Satoshi to Hal Finney.', value: '170' },
  { kind: 'block', label: 'Pizza block', note: 'Block 57,043 confirmed the 10,000 BTC pizza purchase in May 2010.', value: '57043' },
  { kind: 'block', label: 'Overflow incident', note: 'Height 74,638: the 184 billion BTC overflow bug landed here in 2010; the fix reorganised the chain and this is the replacement block.', value: '74638' },
  { kind: 'block', label: 'Halving 1', note: 'Block 210,000 (November 2012): the reward drops from 50 to 25 BTC.', value: '210000' },
  { kind: 'block', label: 'Halving 2', note: 'Block 420,000 (July 2016): the reward drops from 25 to 12.5 BTC.', value: '420000' },
  { kind: 'block', label: 'SegWit activates', note: 'Block 481,824 (August 2017): Segregated Witness goes live after a two-year debate.', value: '481824' },
  { kind: 'block', label: 'Halving 3', note: 'Block 630,000 (May 2020): the reward drops from 12.5 to 6.25 BTC.', value: '630000' },
  { kind: 'block', label: 'Taproot activates', note: 'Block 709,632 (November 2021): Taproot brings Schnorr signatures and better multisig privacy.', value: '709632' },
  { kind: 'block', label: 'Halving 4', note: 'Block 840,000 (April 2024): the reward drops from 6.25 to 3.125 BTC.', value: '840000' },
];

export const EXPLORE_ADDRESSES: ExploreExample[] = [
  {
    kind: 'address', label: 'Genesis address',
    note: "Satoshi's block-0 reward address. People still send tributes to it; nothing has ever left.",
    value: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  },
  {
    kind: 'address', label: 'Silk Road seizure',
    note: 'Where the FBI gathered nearly 30,000 BTC seized from Silk Road in 2013.',
    value: '1F1tAaz5x1HUXrCNLbtMDqcw6o5GNn4xqX',
  },
  {
    kind: 'address', label: 'Exchange cold wallet',
    note: 'One of the largest balances on the chain, widely attributed to Binance cold storage. Over a million BTC has passed through it.',
    value: '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo',
  },
  {
    kind: 'address', label: 'Dormant 80K BTC',
    note: 'Nearly 80,000 BTC untouched since 2011, widely linked to the Mt. Gox hack. A whale that never moves.',
    value: '1FeexV6bAHb8ybZjqQMjJrcCrHGW9sb6uF',
  },
  {
    kind: 'address', label: 'Proof-of-burn',
    note: 'Counterparty asked users to provably destroy bitcoin by sending it to this unspendable address (2014).',
    value: '1CounterpartyXXXXXXXXXXXXXXXUWLpVr',
  },
  {
    kind: 'address', label: 'Bitcoin Eater',
    note: 'A famous burn address: coins sent here can never be spent. It still receives them.',
    value: '1BitcoinEaterAddressDontSendf59kuE',
  },
];
