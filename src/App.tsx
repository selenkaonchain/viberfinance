import { useState, useCallback, useEffect, useRef } from 'react';
import { useBlockchain, PILL_CONTRACT } from './hooks/useBlockchain';

type GameResult = 'pill' | 'skull' | null;
type BetChoice = 'pill' | 'skull';

interface GameRound {
    id: number;
    bet: BetChoice;
    result: GameResult;
    won: boolean;
    betAmount: number;
    payout: number; // +amount if won, -amount if lost
    blockHash: string;
    blockHeight: number;
    timestamp: number;
}

const BET_PRESETS = [100, 500, 1000, 5000, 10000, 50000];

function truncAddr(a: string): string {
    if (!a) return '';
    if (a.length <= 16) return a;
    return a.slice(0, 8) + '...' + a.slice(-6);
}

function formatSats(sats: number): string {
    const btc = sats / 1e8;
    return btc.toFixed(btc < 0.001 ? 8 : 4) + ' BTC';
}

function formatPill(amount: number): string {
    if (amount >= 1_000_000) return (amount / 1_000_000).toFixed(2) + 'M';
    if (amount >= 1_000) return (amount / 1_000).toFixed(1) + 'K';
    return amount.toLocaleString();
}

function formatPillBal(bal: bigint, dec: number): string {
    if (bal === 0n) return '0';
    const divisor = 10n ** BigInt(dec);
    const whole = bal / divisor;
    const frac = bal % divisor;
    const fracStr = frac.toString().padStart(dec, '0').slice(0, 2).replace(/0+$/, '');
    return Number(whole).toLocaleString() + (fracStr ? '.' + fracStr : '');
}

// Derive result from block hash
function hashToResult(hash: string): GameResult {
    if (!hash) return null;
    const lastChar = hash.slice(-1).toLowerCase();
    const val = parseInt(lastChar, 16);
    return val < 8 ? 'pill' : 'skull';
}

export function App() {
    const bc = useBlockchain();
    const [bet, setBet] = useState<BetChoice | null>(null);
    const [betAmount, setBetAmount] = useState<number>(1000);
    const [customBet, setCustomBet] = useState<string>('');
    const [isFlipping, setIsFlipping] = useState(false);
    const [lastResult, setLastResult] = useState<GameResult>(null);
    const [lastWon, setLastWon] = useState<boolean | null>(null);
    const [lastPayout, setLastPayout] = useState<number>(0);
    const [history, setHistory] = useState<GameRound[]>([]);
    const [streak, setStreak] = useState(0);
    const [bestStreak, setBestStreak] = useState(0);
    const [wins, setWins] = useState(0);
    const [losses, setLosses] = useState(0);
    const [virtualBalance, setVirtualBalance] = useState<number | null>(null);
    const [totalWagered, setTotalWagered] = useState(0);
    const [totalProfit, setTotalProfit] = useState(0);
    const roundIdRef = useRef(0);

    // Sync virtual balance with real PILL balance on first load
    useEffect(() => {
        if (bc.pillInfo && virtualBalance === null) {
            const decimals = bc.pillInfo.decimals;
            const realBal = Number(bc.pillInfo.balance / (10n ** BigInt(decimals)));
            setVirtualBalance(realBal);
        }
    }, [bc.pillInfo, virtualBalance]);

    // Reset virtual balance when wallet disconnects
    useEffect(() => {
        if (!bc.connected) {
            setVirtualBalance(null);
        }
    }, [bc.connected]);

    // Load saved stats
    useEffect(() => {
        try {
            const saved = localStorage.getItem('pill-casino-stats');
            if (saved) {
                const s = JSON.parse(saved);
                setWins(s.wins || 0);
                setLosses(s.losses || 0);
                setBestStreak(s.bestStreak || 0);
                setTotalWagered(s.totalWagered || 0);
                setTotalProfit(s.totalProfit || 0);
            }
        } catch { /* skip */ }
    }, []);

    // Save stats
    useEffect(() => {
        localStorage.setItem('pill-casino-stats', JSON.stringify({
            wins, losses, bestStreak, totalWagered, totalProfit
        }));
    }, [wins, losses, bestStreak, totalWagered, totalProfit]);

    const flip = useCallback(async (choice: BetChoice) => {
        if (isFlipping) return;

        // Check balance
        if (virtualBalance !== null && betAmount > virtualBalance) {
            bc.setError(`Insufficient $PILL! You have ${formatPill(virtualBalance)} but tried to bet ${formatPill(betAmount)}`);
            return;
        }

        setBet(choice);
        setIsFlipping(true);
        setLastResult(null);
        setLastWon(null);
        setLastPayout(0);

        // Deduct bet immediately (virtual)
        if (virtualBalance !== null) {
            setVirtualBalance(v => (v ?? 0) - betAmount);
        }

        // Fetch fresh block
        const block = await bc.fetchBlockData();

        // Animate for 2 seconds
        await new Promise(r => setTimeout(r, 2000));

        const hash = block?.hash || '0x' + Date.now().toString(16);
        const result = hashToResult(hash);
        const won = result === choice;
        const payout = won ? betAmount * 2 : 0;

        setLastResult(result);
        setLastWon(won);
        setLastPayout(won ? betAmount : -betAmount);
        setIsFlipping(false);

        // Update virtual balance
        if (virtualBalance !== null) {
            if (won) {
                // Already deducted bet, add back 2x
                setVirtualBalance(v => (v ?? 0) + payout);
            }
            // If lost, bet was already deducted
        }

        setTotalWagered(tw => tw + betAmount);
        setTotalProfit(tp => tp + (won ? betAmount : -betAmount));

        if (won) {
            setWins(w => w + 1);
            setStreak(s => {
                const newS = s + 1;
                setBestStreak(b => Math.max(b, newS));
                return newS;
            });
        } else {
            setLosses(l => l + 1);
            setStreak(0);
        }

        roundIdRef.current++;
        const round: GameRound = {
            id: roundIdRef.current,
            bet: choice,
            result,
            won,
            betAmount,
            payout: won ? betAmount : -betAmount,
            blockHash: hash,
            blockHeight: block?.height || 0,
            timestamp: Date.now(),
        };
        setHistory(h => [round, ...h].slice(0, 50));
    }, [isFlipping, bc, betAmount, virtualBalance]);

    const handleCustomBet = useCallback(() => {
        const val = parseInt(customBet.replace(/,/g, ''), 10);
        if (val > 0) {
            setBetAmount(val);
            setCustomBet('');
        }
    }, [customBet]);

    const totalGames = wins + losses;
    const winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(1) : '0.0';

    return (
        <div className="app">
            {/* Header */}
            <header className="header">
                <div className="logo">
                    <span className="logo-pill">💊</span>
                    <span className="logo-text">PILL FLIP</span>
                    <span className="logo-sub">Casino</span>
                </div>
                <div className="header-right">
                    {bc.blockData && (
                        <div className="block-info">
                            <span className="block-dot" />
                            Block #{bc.blockData.height.toLocaleString()}
                        </div>
                    )}
                    {bc.connected ? (
                        <div className="wallet-info">
                            <span className="wallet-bal">{formatSats(bc.btcTotal)}</span>
                            <button className="btn-wallet connected" onClick={bc.disconnectWallet}>
                                {truncAddr(bc.walletAddress)}
                            </button>
                        </div>
                    ) : (
                        <button
                            className="btn-wallet"
                            onClick={bc.connectWallet}
                            disabled={bc.loading}
                        >
                            {bc.loading ? 'Connecting...' : 'Connect OP_WALLET'}
                        </button>
                    )}
                </div>
            </header>

            {/* PILL Balance Bar */}
            {bc.connected && (
                <div className="pill-balance-bar">
                    <div className="pbb-left">
                        <span className="pbb-icon">💊</span>
                        <span className="pbb-label">$PILL Balance</span>
                        {bc.pillInfo ? (
                            <span className="pbb-real">
                                On-chain: {formatPillBal(bc.pillInfo.balance, bc.pillInfo.decimals)}
                            </span>
                        ) : bc.loading ? (
                            <span className="pbb-loading">Loading...</span>
                        ) : null}
                    </div>
                    <div className="pbb-right">
                        <span className="pbb-virtual">
                            {virtualBalance !== null ? formatPill(virtualBalance) : '—'}
                        </span>
                        <span className="pbb-unit">$PILL</span>
                        {totalProfit !== 0 && (
                            <span className={`pbb-profit ${totalProfit >= 0 ? 'positive' : 'negative'}`}>
                                {totalProfit >= 0 ? '+' : ''}{formatPill(totalProfit)}
                            </span>
                        )}
                        <button
                            className="btn-refresh-pill"
                            onClick={bc.loadPillBalance}
                            disabled={bc.loading}
                            title="Refresh PILL balance"
                        >
                            🔄
                        </button>
                    </div>
                </div>
            )}

            {/* Hero / Game Area */}
            <main className="game-area">
                <div className="game-container">
                    {/* Pill Animation */}
                    <div className={`pill-flipper ${isFlipping ? 'flipping' : ''} ${lastResult || ''}`}>
                        <div className="pill-inner">
                            <div className="pill-front">
                                <span className="pill-emoji">💊</span>
                                <span className="pill-label">FLIP ME</span>
                            </div>
                            <div className="pill-back-pill">
                                <span className="pill-emoji">💊</span>
                                <span className="pill-label">PILL!</span>
                            </div>
                            <div className="pill-back-skull">
                                <span className="pill-emoji">💀</span>
                                <span className="pill-label">SKULL!</span>
                            </div>
                        </div>
                    </div>

                    {/* Result Banner */}
                    {lastWon !== null && !isFlipping && (
                        <div className={`result-banner ${lastWon ? 'win' : 'lose'}`}>
                            <span className="rb-text">
                                {lastWon ? '🎉 YOU WIN!' : '💀 YOU LOSE!'}
                            </span>
                            <span className="rb-amount">
                                {lastPayout >= 0 ? '+' : ''}{formatPill(lastPayout)} $PILL
                            </span>
                        </div>
                    )}

                    {/* Bet Amount Selector */}
                    <div className="bet-amount-section">
                        <div className="bas-header">
                            <span className="bas-label">Bet Amount</span>
                            <span className="bas-current">{formatPill(betAmount)} $PILL</span>
                        </div>
                        <div className="bet-presets">
                            {BET_PRESETS.map(amt => (
                                <button
                                    key={amt}
                                    className={`btn-preset ${betAmount === amt ? 'active' : ''}`}
                                    onClick={() => setBetAmount(amt)}
                                    disabled={isFlipping}
                                >
                                    {formatPill(amt)}
                                </button>
                            ))}
                        </div>
                        <div className="bet-custom">
                            <input
                                className="custom-bet-input"
                                placeholder="Custom amount..."
                                value={customBet}
                                onChange={e => setCustomBet(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleCustomBet()}
                                disabled={isFlipping}
                            />
                            <button
                                className="btn-custom-set"
                                onClick={handleCustomBet}
                                disabled={isFlipping || !customBet.trim()}
                            >
                                Set
                            </button>
                            {virtualBalance !== null && (
                                <button
                                    className="btn-max"
                                    onClick={() => setBetAmount(virtualBalance)}
                                    disabled={isFlipping || virtualBalance <= 0}
                                >
                                    MAX
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Bet Buttons */}
                    <div className="bet-section">
                        <p className="bet-prompt">
                            {!bc.connected
                                ? 'Connect wallet to play!'
                                : isFlipping
                                    ? `Flipping ${formatPill(betAmount)} $PILL...`
                                    : `Bet ${formatPill(betAmount)} $PILL — Pick your side!`}
                        </p>
                        <div className="bet-buttons">
                            <button
                                className={`btn-bet pill ${bet === 'pill' && isFlipping ? 'active' : ''}`}
                                onClick={() => flip('pill')}
                                disabled={isFlipping || !bc.connected || (virtualBalance !== null && virtualBalance < betAmount)}
                            >
                                <span className="bet-icon">💊</span>
                                <span className="bet-name">PILL</span>
                                <span className="bet-odds">Block hash 0-7</span>
                            </button>
                            <span className="bet-vs">VS</span>
                            <button
                                className={`btn-bet skull ${bet === 'skull' && isFlipping ? 'active' : ''}`}
                                onClick={() => flip('skull')}
                                disabled={isFlipping || !bc.connected || (virtualBalance !== null && virtualBalance < betAmount)}
                            >
                                <span className="bet-icon">💀</span>
                                <span className="bet-name">SKULL</span>
                                <span className="bet-odds">Block hash 8-F</span>
                            </button>
                        </div>
                        {virtualBalance !== null && virtualBalance < betAmount && !isFlipping && bc.connected && (
                            <p className="bet-warning">⚠️ Insufficient $PILL balance</p>
                        )}
                    </div>

                    {/* Provably Fair Info */}
                    {bc.blockData && (
                        <div className="provably-fair">
                            <span className="pf-label">🔗 Provably Fair</span>
                            <span className="pf-detail">
                                Result from block hash last hex digit • 50/50 odds
                            </span>
                            <code className="pf-hash">
                                {bc.blockData.hash.slice(0, 10)}...
                                <span className="pf-last">{bc.blockData.hash.slice(-1)}</span>
                            </code>
                            <a
                                className="pf-link"
                                href={`https://testnet.opscan.org/block/${bc.blockData.height}`}
                                target="_blank"
                                rel="noreferrer"
                            >
                                Verify on OPScan ↗
                            </a>
                        </div>
                    )}

                    {/* Contract Info */}
                    <div className="contract-info">
                        <span className="ci-label">$PILL Contract</span>
                        <code className="ci-addr">{PILL_CONTRACT.slice(0, 10)}...{PILL_CONTRACT.slice(-8)}</code>
                    </div>
                </div>

                {/* Stats Sidebar */}
                <div className="stats-panel">
                    <h3 className="panel-title">📊 Your Stats</h3>
                    <div className="stats-grid">
                        <div className="stat-card">
                            <span className="stat-val">{totalGames}</span>
                            <span className="stat-label">Total Flips</span>
                        </div>
                        <div className="stat-card win">
                            <span className="stat-val">{wins}</span>
                            <span className="stat-label">Wins</span>
                        </div>
                        <div className="stat-card lose">
                            <span className="stat-val">{losses}</span>
                            <span className="stat-label">Losses</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-val">{winRate}%</span>
                            <span className="stat-label">Win Rate</span>
                        </div>
                        <div className="stat-card streak">
                            <span className="stat-val">🔥 {streak}</span>
                            <span className="stat-label">Streak</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-val">⭐ {bestStreak}</span>
                            <span className="stat-label">Best Streak</span>
                        </div>
                    </div>

                    {/* Wagering Stats */}
                    <h3 className="panel-title">💰 Wagering</h3>
                    <div className="wager-stats">
                        <div className="ws-row">
                            <span className="ws-label">Total Wagered</span>
                            <span className="ws-val">{formatPill(totalWagered)} $PILL</span>
                        </div>
                        <div className="ws-row">
                            <span className="ws-label">Net Profit/Loss</span>
                            <span className={`ws-val ${totalProfit >= 0 ? 'profit' : 'loss'}`}>
                                {totalProfit >= 0 ? '+' : ''}{formatPill(totalProfit)} $PILL
                            </span>
                        </div>
                    </div>

                    {/* History */}
                    <h3 className="panel-title">📜 Recent Flips</h3>
                    <div className="history-list">
                        {history.length === 0 && (
                            <p className="history-empty">No flips yet. Pick a side!</p>
                        )}
                        {history.map(r => (
                            <div key={r.id} className={`history-item ${r.won ? 'win' : 'lose'}`}>
                                <span className="hi-icon">{r.result === 'pill' ? '💊' : '💀'}</span>
                                <span className="hi-result">{r.won ? 'WIN' : 'LOSS'}</span>
                                <span className={`hi-payout ${r.won ? 'win' : 'lose'}`}>
                                    {r.payout >= 0 ? '+' : ''}{formatPill(r.payout)}
                                </span>
                                <span className="hi-block">#{r.blockHeight}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="footer">
                <div className="footer-left">
                    Built on <a href="https://opnet.org" target="_blank" rel="noreferrer">OP_NET</a> • Bitcoin L1
                    {' • '}
                    <a
                        href="https://chromewebstore.google.com/detail/opwallet/pmbjpcmaaladnfpacpmhmnfmpklgbdjb"
                        target="_blank"
                        rel="noreferrer"
                    >
                        Get OP_WALLET
                    </a>
                </div>
                <div className="footer-right">
                    Powered by BOB 🤖 • #opnetvibecode
                </div>
            </footer>

            {/* Error Toast */}
            {bc.error && (
                <div className="error-toast" onClick={() => bc.setError('')}>
                    ⚠️ {bc.error}
                </div>
            )}
        </div>
    );
}
