import { useState, useCallback, useRef, useEffect } from 'react';
import { JSONRpcProvider, getContract, OP_20_ABI } from 'opnet';
import type { IOP20Contract } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import { Address } from '@btc-vision/transaction';
import { useWalletConnect } from '@btc-vision/walletconnect';

const NETWORK = networks.opnetTestnet;
const RPC_URL = 'https://testnet.opnet.org';

// $PILL token contract on OP_NET testnet
export const PILL_CONTRACT = '0xfb7df2f08d8042d4df0506c0d4cee3cfa5f2d7b02ef01ec76dd699551393a438';

interface BlockData {
    height: number;
    hash: string;
}

export interface PillInfo {
    name: string;
    symbol: string;
    decimals: number;
    balance: bigint;
}

export function useBlockchain() {
    const wc = useWalletConnect();
    const providerRef = useRef<JSONRpcProvider | null>(null);

    const [blockData, setBlockData] = useState<BlockData | null>(null);
    const [pillInfo, setPillInfo] = useState<PillInfo | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>('');

    function getProvider(): JSONRpcProvider {
        if (!providerRef.current) {
            providerRef.current = new JSONRpcProvider({
                url: RPC_URL,
                network: NETWORK,
            });
        }
        return providerRef.current;
    }

    // Derived wallet state from WalletConnect context
    const connected = !!wc.walletAddress;
    const walletAddress = wc.walletAddress ?? '';
    const walletBalance = wc.walletBalance;
    const btcTotal = walletBalance?.total ?? 0;

    const connectWallet = useCallback(() => {
        wc.openConnectModal();
    }, [wc]);

    const disconnectWallet = useCallback(() => {
        wc.disconnect();
        setPillInfo(null);
    }, [wc]);

    const fetchBlockData = useCallback(async (): Promise<BlockData | null> => {
        try {
            const provider = getProvider();
            const height = await provider.getBlockNumber();
            const block = await provider.getBlock(height);
            const data: BlockData = {
                height: Number(height),
                hash: block?.hash ?? '',
            };
            setBlockData(data);
            return data;
        } catch (err) {
            console.warn('Block fetch error:', err);
            return null;
        }
    }, []);

    /**
     * Load PILL token info & balance.
     * BOB guidance:
     *   - Use contract.metadata() for token info (1 call, not 4)
     *   - For balanceOf(), MUST pass hex public key (0x...), NOT Bitcoin address
     *   - wc.publicKey from WalletConnect gives us the hex key directly
     *   - Fallback: provider.getPublicKeyInfo(walletAddress) to convert address → pubkey
     */
    const loadPillBalance = useCallback(async (): Promise<PillInfo | null> => {
        if (!wc.walletAddress) {
            console.warn('[PILL] No wallet address available');
            return null;
        }

        try {
            setLoading(true);
            setError('');
            const provider = getProvider();

            console.log('[PILL] Loading balance...');
            console.log('[PILL] walletAddress:', wc.walletAddress);
            console.log('[PILL] publicKey:', wc.publicKey ?? 'null');
            console.log('[PILL] address (Address obj):', wc.address ? 'present' : 'null');

            const contract = getContract<IOP20Contract>(
                PILL_CONTRACT,
                OP_20_ABI,
                provider,
                NETWORK,
                wc.address ?? undefined,
            );

            // --- Token metadata (single RPC call per BOB) ---
            let name = 'PILL';
            let symbol = 'PILL';
            let decimals = 8;

            try {
                const meta = await contract.metadata();
                name = meta.properties.name || name;
                symbol = meta.properties.symbol || symbol;
                decimals = Number(meta.properties.decimals ?? 8);
                console.log('[PILL] metadata:', { name, symbol, decimals });
            } catch (e) {
                console.warn('[PILL] metadata() failed, trying individual calls:', e);
                // Fallback to individual calls if metadata() is not available
                try {
                    const nr = await contract.name();
                    name = nr.properties.name || name;
                } catch (_) { /* use default */ }
                try {
                    const sr = await contract.symbol();
                    symbol = sr.properties.symbol || symbol;
                } catch (_) { /* use default */ }
                try {
                    const dr = await contract.decimals();
                    decimals = Number(dr.properties.decimals ?? 8);
                } catch (_) { /* use default */ }
            }

            // --- Balance: MUST use hex public key per BOB ---
            let balance = 0n;

            // Strategy 1: Resolve public key Address via provider.getPublicKeyInfo
            // This converts a wallet address string to the public key Address that balanceOf expects
            let pubKeyAddress: Address | undefined;
            try {
                console.log('[PILL] Resolving public key via getPublicKeyInfo...');
                pubKeyAddress = await provider.getPublicKeyInfo(wc.walletAddress, false);
                console.log('[PILL] Resolved pubKeyAddress:', pubKeyAddress ? 'present' : 'undefined');
            } catch (e) {
                console.warn('[PILL] getPublicKeyInfo failed:', e);
            }

            // Strategy 2: If WalletConnect gives us publicKey (hex string), convert to Address
            if (!pubKeyAddress && wc.publicKey) {
                try {
                    console.log('[PILL] Using wc.publicKey to build Address...');
                    const { Address: Addr } = await import('@btc-vision/transaction');
                    pubKeyAddress = new Addr(Buffer.from(wc.publicKey.replace(/^0x/, ''), 'hex'));
                    console.log('[PILL] Built Address from publicKey');
                } catch (e) {
                    console.warn('[PILL] Address from publicKey failed:', e);
                }
            }

            // Strategy 3: Fall back to wc.address (the wallet Address object)
            const balAddr = pubKeyAddress ?? wc.address ?? undefined;

            if (balAddr) {
                try {
                    console.log('[PILL] Calling balanceOf...');
                    const bal = await contract.balanceOf(balAddr);
                    balance = bal.properties.balance ?? 0n;
                    console.log('[PILL] balance:', balance.toString());
                } catch (e) {
                    console.warn('[PILL] balanceOf failed:', e);
                }
            } else {
                console.warn('[PILL] No usable address for balanceOf');
            }

            const info: PillInfo = { name, symbol, decimals, balance };
            setPillInfo(info);
            console.log('[PILL] Final result:', { name, symbol, decimals, balance: balance.toString() });
            return info;
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load PILL balance';
            console.error('[PILL] Fatal error:', err);
            setError(msg);
            return null;
        } finally {
            setLoading(false);
        }
    }, [wc.address, wc.walletAddress, wc.publicKey]);

    // Fetch block on mount and periodically
    useEffect(() => {
        fetchBlockData();
        const interval = setInterval(fetchBlockData, 30000);
        return () => clearInterval(interval);
    }, [fetchBlockData]);

    // Auto-load PILL balance when wallet connects
    useEffect(() => {
        if (connected && wc.walletAddress) {
            console.log('[PILL] Wallet connected, auto-loading PILL balance...');
            loadPillBalance();
        }
    }, [connected, wc.walletAddress, loadPillBalance]);

    return {
        connected,
        walletAddress,
        btcTotal,
        blockData,
        pillInfo,
        loading,
        error,
        connectWallet,
        disconnectWallet,
        fetchBlockData,
        loadPillBalance,
        setError,
    };
}
