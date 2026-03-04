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
            console.log('[PILL] walletAddress (string):', wc.walletAddress);
            console.log('[PILL] address (Address obj):', wc.address ? 'present' : 'null');
            console.log('[PILL] Contract:', PILL_CONTRACT);

            // Create contract — try with sender if available, otherwise without
            const contract = getContract<IOP20Contract>(
                PILL_CONTRACT,
                OP_20_ABI,
                provider,
                NETWORK,
                wc.address ?? undefined,
            );

            let name = 'PILL';
            let symbol = 'PILL';
            let decimals = 8;

            try {
                const nameResult = await contract.name();
                name = nameResult.properties.name || name;
                console.log('[PILL] name:', name);
            } catch (e) {
                console.warn('[PILL] name() failed:', e);
            }

            try {
                const symResult = await contract.symbol();
                symbol = symResult.properties.symbol || symbol;
                console.log('[PILL] symbol:', symbol);
            } catch (e) {
                console.warn('[PILL] symbol() failed:', e);
            }

            try {
                const decResult = await contract.decimals();
                decimals = Number(decResult.properties.decimals ?? 8);
                console.log('[PILL] decimals:', decimals);
            } catch (e) {
                console.warn('[PILL] decimals() failed:', e);
            }

            let balance = 0n;
            if (wc.address) {
                // Primary: use Address object
                try {
                    const bal = await contract.balanceOf(wc.address);
                    balance = bal.properties.balance ?? 0n;
                    console.log('[PILL] balance (Address obj):', balance.toString());
                } catch (e) {
                    console.warn('[PILL] balanceOf(Address) failed:', e);
                }
            }

            // Fallback: if Address object is null or balance is still 0,
            // try using the string wallet address
            if (balance === 0n && wc.walletAddress) {
                try {
                    const contract2 = getContract<IOP20Contract>(
                        PILL_CONTRACT,
                        OP_20_ABI,
                        provider,
                        NETWORK,
                    );
                    // The SDK accepts string | Address for balanceOf
                    const bal2 = await contract2.balanceOf(wc.walletAddress as unknown as Address);
                    balance = bal2.properties.balance ?? 0n;
                    console.log('[PILL] balance (string fallback):', balance.toString());
                } catch (e2) {
                    console.warn('[PILL] balanceOf(string) fallback also failed:', e2);
                }
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
    }, [wc.address, wc.walletAddress]);

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
