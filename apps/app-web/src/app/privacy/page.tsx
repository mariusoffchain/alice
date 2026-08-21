export const metadata = {
  title: 'Alice Account Privacy Notice',
  description: 'What the optional Alice account stores and what stays outside it.',
};

const sectionStyle: React.CSSProperties = {
  borderTop: '1px solid var(--alice-border)',
  paddingTop: 24,
  marginTop: 32,
};

export default function PrivacyPage() {
  return (
    <main
      className="font-numbers"
      style={{
        width: 'min(100% - 32px, 760px)',
        margin: '0 auto',
        padding: '48px 0 72px',
        color: 'var(--alice-text)',
      }}
    >
      <a
        href="/"
        className="font-pixel"
        style={{ color: 'var(--alice-muted)', fontSize: 10, textDecoration: 'none' }}
      >
        BACK TO ALICE
      </a>

      <h1
        className="font-pixel"
        style={{
          margin: '40px 0 16px',
          color: 'var(--alice-primary)',
          fontSize: 18,
          lineHeight: '30px',
          letterSpacing: 0,
        }}
      >
        ALICE ACCOUNT PRIVACY
      </h1>
      <p style={{ color: 'var(--alice-muted)', fontSize: 16, lineHeight: '24px' }}>
        Effective 30 July 2026. This notice covers the optional Alice account,
        free Private Cloud quota and login flow. Alice Local does not require an
        account.
      </p>

      <section style={sectionStyle}>
        <h2 className="font-pixel" style={{ fontSize: 10, lineHeight: '20px' }}>
          DATA ALICE USES
        </h2>
        <ul style={{ paddingLeft: 22, fontSize: 17, lineHeight: '26px' }}>
          <li>Your email address is processed to deliver a one-time login code.</li>
          <li>
            A masked email label and an opaque HMAC lookup are stored with your
            account. The lookup is what signs you in, and it cannot be reversed
            into an address.
          </li>
          <li>
            Your email address is also stored, encrypted, so that Alice can warn
            you before a paid plan runs out. Bitcoin payments cannot renew a
            plan on their own, so without a way to reach you a plan would simply
            lapse in silence. The encryption protects the address if the
            database or a backup leaks. It does not hide it from Alice, whose
            server decrypts it to send. An alias is a perfectly good address to
            use.
          </li>
          <li>
            Alice writes to you unasked only about a plan that is about to end,
            three days before and on the day. Anything else is off unless you
            turn it on in your account.
          </li>
          <li>
            Alice stores your chosen display name, unique username and a salted,
            one-way password hash when you enable password login. Alice never stores
            the password itself.
          </li>
          <li>
            A random installation ID is stored as an HMAC, never as a hardware
            fingerprint.
          </li>
          <li>
            Your IP address is converted in memory into a short-lived HMAC bucket.
            The raw IP is not stored in the Alice account database.
          </li>
          <li>
            Session token hashes, quota counters and a request ledger prevent replay
            and double spending of free requests.
          </li>
          <li>
            A random internal user ID links the login methods you explicitly add to
            the same Alice account.
          </li>
        </ul>
      </section>

      <section style={sectionStyle}>
        <h2 className="font-pixel" style={{ fontSize: 10, lineHeight: '20px' }}>
          DATA OUTSIDE THE ACCOUNT
        </h2>
        <p style={{ fontSize: 17, lineHeight: '26px' }}>
          The account service does not receive or store your wallet seed, wallet
          private keys, addresses, balances, wallet history, prompts, responses or
          local conversation history. The wallet and Alice account are separate
          systems.
        </p>
        <p style={{ fontSize: 17, lineHeight: '26px' }}>
          The Alice password is never used to derive, encrypt, decrypt, restore or
          export a wallet seed or wallet private key. Recovering an Alice account
          cannot recover the wallet.
        </p>
        <p style={{ fontSize: 17, lineHeight: '26px' }}>
          Private Cloud messages pass through the Alice proxy as end-to-end encrypted
          payloads. The account ledger records only technical request state, never
          conversation content.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 className="font-pixel" style={{ fontSize: 10, lineHeight: '20px' }}>
          RETENTION
        </h2>
        <ul style={{ paddingLeft: 22, fontSize: 17, lineHeight: '26px' }}>
          <li>
            Login codes expire after 10 minutes and expired challenges are purged
            hourly.
          </li>
          <li>
            Email verification codes expire after 10 minutes, cannot be reused, and
            are limited to five attempts.
          </li>
          <li>
            Anti-abuse buckets expire after their 1-hour or 24-hour window and are
            purged hourly.
          </li>
          <li>
            Refresh sessions expire after 30 days. Expired and revoked sessions are
            removed after a short security retention period.
          </li>
          <li>
            Quota counters and the request ledger remain while needed to protect
            account integrity and resolve quota disputes.
          </li>
          <li>
            The stable email lookup, the masked label and the encrypted address
            remain until the account is deleted, and are removed with it.
          </li>
          <li>
            The hashed installation grant may be retained after account deletion
            solely to prevent the same installation from repeatedly claiming the
            lifetime free allowance.
          </li>
        </ul>
      </section>

      <section style={sectionStyle}>
        <h2 className="font-pixel" style={{ fontSize: 10, lineHeight: '20px' }}>
          PROCESSORS
        </h2>
        <p style={{ fontSize: 17, lineHeight: '26px' }}>
          Cloudflare runs the Alice Worker at its network edge and the European D1
          account database. As the network processor, Cloudflare receives request
          metadata such as IP address and headers in transit. Alice disables
          Cloudflare&apos;s automatic invocation logs and emits only body-free technical
          events without IP addresses, tokens or login credentials.
        </p>
        <p style={{ fontSize: 17, lineHeight: '26px' }}>
          Resend receives your email address and one-time-code message to deliver
          login email from its European sending region. Resend states that account,
          API and log metadata are stored in the United States and that standard
          email data retention is 30 days.
        </p>
        <p style={{ fontSize: 17, lineHeight: '26px' }}>
          Venice provides Private Cloud inference through Alice&apos;s end-to-end
          encrypted transport.
        </p>
        <p style={{ fontSize: 17, lineHeight: '26px' }}>
          Alice does not use advertising identifiers, canvas fingerprints or wallet
          data to enforce the free quota.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 className="font-pixel" style={{ fontSize: 10, lineHeight: '20px' }}>
          CONTROL AND DELETION
        </h2>
        <p style={{ fontSize: 17, lineHeight: '26px' }}>
          You can sign out or request account deletion from the Alice account panel.
          A deletion request revokes active sessions immediately. During the beta,
          final deletion may be completed manually.
        </p>
        <p style={{ fontSize: 17, lineHeight: '26px' }}>
          Privacy questions and deletion follow-up can be sent to{' '}
          <a href="mailto:contact@alicebtc.com" style={{ color: 'var(--alice-primary)' }}>
            contact@alicebtc.com
          </a>.
        </p>
      </section>
    </main>
  );
}
