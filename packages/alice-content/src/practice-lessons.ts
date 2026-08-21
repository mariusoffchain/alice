/**
 * Alice's teaching copy for the Mutinynet practice wallet.
 *
 * These texts are deterministic content rendered by the wallet UI in Alice's
 * voice. They are not AI output: the practice flow must teach the same thing
 * to everyone, offline, at zero inference cost. Keep them short, concrete,
 * and free of jargon that is not explained in place.
 */

export type PracticeLesson = {
  title: string;
  body: string;
};

export const PRACTICE_LESSONS = {
  intro: {
    title: 'A SANDBOX WITH REAL RULES',
    body:
      'This wallet runs on Mutinynet, a Bitcoin test network where coins are free and '
      + 'blocks arrive every 30 seconds. Everything works exactly like real Bitcoin, '
      + 'except nothing here has value. Perfect place to make mistakes.',
  },
  receive: {
    title: 'ADDRESSES',
    body:
      'An address is where coins land. It is derived from your wallet keys, so only '
      + 'you can spend what it receives. Using a fresh address for every payment keeps '
      + 'your history harder to trace: a good habit from day one.',
  },
  backup: {
    title: 'TWELVE WORDS ARE THE WALLET',
    body:
      'Your recovery phrase IS your wallet: anyone who knows the words controls the '
      + 'coins, and losing them means losing access forever. Real wallets get written '
      + 'on paper and stored offline, never in screenshots or chats. Practice the '
      + 'ritual here, where a mistake costs nothing.',
  },
  coins: {
    title: 'YOUR COINS, PIECE BY PIECE',
    body:
      'A Bitcoin balance is not one number in an account. It is a collection of coins '
      + 'of different sizes, called UTXOs. To pay, your wallet picks coins that add up '
      + 'to at least the amount, exactly like paying cash with bills.',
  },
  outputs: {
    title: 'OUTPUTS, CHANGE AND FEES',
    body:
      'A transaction melts your selected coins and mints new ones: one for the '
      + 'recipient, and usually one back to you as change, like the coins a cashier '
      + 'hands back. The difference goes to miners as the fee. Bigger transactions '
      + 'pay more, not bigger amounts: fees buy bytes, not value.',
  },
  signature: {
    title: 'PROVE IT IS YOURS',
    body:
      'Your private key signs the transaction. The signature proves you own the coins '
      + 'without ever revealing the key itself. Anyone can check the proof, nobody can '
      + 'forge it. Alice then re-reads the signed bytes and checks them against the '
      + 'plan: verify, do not trust.',
  },
  broadcast: {
    title: 'TELL THE NETWORK',
    body:
      'Broadcasting hands your signed transaction to the network. Nodes check the '
      + 'signature, miners include it in a block, and each block after that buries it '
      + 'deeper. On Mutinynet the next block is at most 30 seconds away.',
  },
} as const satisfies Record<string, PracticeLesson>;

export type PracticeLessonId = keyof typeof PRACTICE_LESSONS;
