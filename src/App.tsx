import { useState, type FormEvent } from 'react';
import { useBlockchain } from './hooks/useBlockchain';
import { truncateAddress, formatTokenAmount } from './utils/format';

/* =====================================================
   VibeVault — DeFi Signal Dashboard on Bitcoin (OP_NET)
   Everything displayed comes from real RPC calls.
   No fake data. No mock numbers.
   ===================================================== */

export default function App() {
  const bc = useBlockchain();

  return (
    <div className="app">
      <Header bc={bc} />
      <main className="main">
        {!bc.isConnected && <ConnectPrompt bc={bc} />}
        {bc.error && (
          <div className="msg error" onClick={bc.clearError} style={{ cursor: 'pointer' }}>
            {bc.error} <span style={{ float: 'right', opacity: 0.6 }}>✕</span>
          </div>
        )}
        <NetworkCard bc={bc} />
        <TokenExplorer bc={bc} />
        {bc.isConnected && bc.tokenInfo && <TransferCard bc={bc} />}
        <ActivityLog bc={bc} />
      </main>
      <footer className="footer">
        <span>VibeVault — Built on <a href="https://opnet.org" target="_blank" rel="noopener">OP_NET</a></span>
        <span>All data from live RPC</span>
      </footer>
    </div>
  );
}

/* ---- Type shorthand ---- */
type BC = ReturnType<typeof useBlockchain>;

/* ---- Header ---- */
function Header({ bc }: { bc: BC }) {
  return (
    <header className="header">
      <div className="logo">
        <span className="mark">◈</span> VibeVault
      </div>
      {bc.isConnected ? (
        <div className="wallet-connected">
          <span className="network-badge">
            <span className="dot green" /> {bc.networkName}
          </span>
          {bc.walletBalance !== null && (
            <span className="balance-pill">{formatSats(bc.walletBalance.total)} BTC</span>
          )}
          <button className="btn btn-outline btn-sm" title={bc.walletAddress ?? ''}>
            {truncateAddress(bc.walletAddress ?? '')}
          </button>
          <button className="btn btn-danger btn-sm" onClick={bc.disconnect}>
            Disconnect
          </button>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={bc.connect} disabled={bc.connecting}>
          {bc.connecting ? (
            <><span className="spinner" /> Connecting...</>
          ) : (
            'Connect Wallet'
          )}
        </button>
      )}
    </header>
  );
}

/* ---- Connect Prompt ---- */
function ConnectPrompt({ bc }: { bc: BC }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
      <h2 style={{ color: 'var(--text-0)', fontSize: 20, textTransform: 'none', letterSpacing: 'normal', marginBottom: 12 }}>
        DeFi Signal Dashboard
      </h2>
      <p style={{ color: 'var(--text-1)', fontSize: 14, maxWidth: 480, margin: '0 auto 24px' }}>
        Connect your OP_WALLET to explore tokens, check balances, and send transfers
        on Bitcoin L1 via OP_NET. All data is fetched live from the blockchain.
      </p>
      <button className="btn btn-primary" onClick={bc.connect} disabled={bc.connecting}>
        {bc.connecting ? <><span className="spinner" /> Connecting...</> : 'Connect OP_WALLET'}
      </button>
      <p style={{ color: 'var(--text-2)', fontSize: 12, marginTop: 16 }}>
        Don't have OP_WALLET?{' '}
        <a href="https://chromewebstore.google.com/detail/opwallet/pmbjpcmaaladnfpacpmhmnfmpklgbdjb" target="_blank" rel="noopener">
          Install from Chrome Web Store
        </a>
      </p>
    </div>
  );
}

/* ---- Network Info Card ---- */
function NetworkCard({ bc }: { bc: BC }) {
  return (
    <div className="card">
      <h2>Network</h2>
      <div className="data-row">
        <span className="data-label">Chain</span>
        <span className="data-value">{bc.networkName}</span>
      </div>
      <div className="data-row">
        <span className="data-label">Block Height</span>
        <span className="data-value orange">
          {bc.loadingBlock ? (
            <span className="spinner" />
          ) : bc.blockHeight !== null ? (
            bc.blockHeight.toLocaleString()
          ) : (
            '—'
          )}
        </span>
      </div>
      {bc.isConnected && (
        <>
          <div className="data-row">
            <span className="data-label">Your Address</span>
            <span className="data-value" style={{ fontSize: 12 }}>
              {bc.walletAddress}
            </span>
          </div>
          <div className="data-row">
            <span className="data-label">BTC Balance</span>
            <span className="data-value green">
              {bc.walletBalance !== null ? `${formatSats(bc.walletBalance.total)} BTC` : '—'}
            </span>
          </div>
        </>
      )}
      <div style={{ marginTop: 12, textAlign: 'right' }}>
        <button className="btn btn-secondary btn-sm" onClick={bc.fetchBlockHeight} disabled={bc.loadingBlock}>
          {bc.loadingBlock ? <span className="spinner" /> : 'Refresh'}
        </button>
      </div>
    </div>
  );
}

/* ---- Token Explorer ---- */
function TokenExplorer({ bc }: { bc: BC }) {
  const [contractAddr, setContractAddr] = useState('');

  const handleQuery = (e: FormEvent) => {
    e.preventDefault();
    const addr = contractAddr.trim();
    if (!addr) return;
    bc.queryToken(addr);
  };

  return (
    <div className="card">
      <h2>Token Explorer</h2>
      <p style={{ color: 'var(--text-1)', fontSize: 13, marginBottom: 16 }}>
        Enter any OP20 token contract address to read its on-chain data.
      </p>
      <form onSubmit={handleQuery} style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={contractAddr}
          onChange={(e) => setContractAddr(e.target.value)}
          placeholder="Contract address (e.g. bcrt1q...)"
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary" type="submit" disabled={bc.loadingToken || !contractAddr.trim()}>
          {bc.loadingToken ? <span className="spinner" /> : 'Query'}
        </button>
      </form>

      {bc.tokenInfo && (
        <div style={{ marginTop: 20 }}>
          <div className="token-grid">
            <div className="token-cell">
              <div className="label">Name</div>
              <div className="value">{bc.tokenInfo.name}</div>
            </div>
            <div className="token-cell">
              <div className="label">Symbol</div>
              <div className="value" style={{ color: 'var(--orange)' }}>{bc.tokenInfo.symbol}</div>
            </div>
            <div className="token-cell">
              <div className="label">Decimals</div>
              <div className="value">{bc.tokenInfo.decimals}</div>
            </div>
            <div className="token-cell">
              <div className="label">Total Supply</div>
              <div className="value">{formatTokenAmount(bc.tokenInfo.totalSupply, bc.tokenInfo.decimals)}</div>
            </div>
            {bc.isConnected && (
              <div className="token-cell" style={{ gridColumn: '1 / -1' }}>
                <div className="label">Your Balance</div>
                <div className="value" style={{ color: 'var(--green)' }}>
                  {formatTokenAmount(bc.tokenInfo.userBalance, bc.tokenInfo.decimals)} {bc.tokenInfo.symbol}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Transfer Card ---- */
function TransferCard({ bc }: { bc: BC }) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');

  const handleTransfer = (e: FormEvent) => {
    e.preventDefault();
    if (!bc.tokenInfo || !recipient.trim() || !amount.trim()) return;

    const decimals = bc.tokenInfo.decimals;
    const raw = BigInt(Math.floor(parseFloat(amount) * 10 ** decimals));
    bc.transferToken(bc.tokenInfo.address, recipient.trim(), raw);
  };

  if (!bc.tokenInfo) return null;

  return (
    <div className="card">
      <h2>Transfer {bc.tokenInfo.symbol}</h2>
      <form onSubmit={handleTransfer} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="form-group">
          <label>Recipient Address</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="bc1q... or bcrt1q..."
          />
        </div>
        <div className="form-group">
          <label>Amount ({bc.tokenInfo.symbol})</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min="0"
            step="any"
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={bc.transferring || !recipient.trim() || !amount.trim()}
          >
            {bc.transferring ? (
              <><span className="spinner" /> Sending...</>
            ) : (
              `Send ${bc.tokenInfo.symbol}`
            )}
          </button>
        </div>
      </form>
      <p style={{ color: 'var(--text-2)', fontSize: 11, marginTop: 12 }}>
        Transaction is simulated before broadcast. Your wallet extension will prompt you to sign.
      </p>
    </div>
  );
}

/* ---- Activity Log ---- */
function ActivityLog({ bc }: { bc: BC }) {
  if (bc.txLog.length === 0) return null;

  return (
    <div className="card">
      <h2>Activity Log</h2>
      {bc.txLog.map((tx) => (
        <div key={tx.id} className="tx-item">
          <div>
            <div className="tx-type">
              <span className={`dot ${tx.type === 'error' ? 'red' : tx.type === 'transfer' ? 'green' : 'orange'}`} />{' '}
              {tx.type.toUpperCase()}
            </div>
            <div className="tx-detail">{tx.description}</div>
          </div>
          <div className="tx-time">{timeAgo(tx.timestamp)}</div>
        </div>
      ))}
    </div>
  );
}

/* ---- Tiny helpers ---- */

function formatSats(sats: number | bigint): string {
  const n = typeof sats === 'bigint' ? Number(sats) : sats;
  return (n / 1e8).toFixed(8);
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
