import { useState, useCallback, useRef, useEffect } from 'react';
import { JSONRpcProvider, getContract, OP_20_ABI } from 'opnet';
import type { IOP20Contract } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
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
        if (!wc.address) return null;
        try {
            setLoading(true);
            setError('');
            const provider = getProvider();

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
                if (!('error' in nameResult)) {
                    name = (nameResult.properties as Record<string, unknown>)?.['name'] as string || name;
                }
            } catch { /* skip */ }

            try {
                const symResult = await contract.symbol();
                if (!('error' in symResult)) {
                    symbol = (symResult.properties as Record<string, unknown>)?.['symbol'] as string || symbol;
                }
            } catch { /* skip */ }

            try {
                const decResult = await contract.decimals();
                if (!('error' in decResult)) {
                    decimals = Number((decResult.properties as Record<string, unknown>)?.['decimals'] ?? 8);
                }
            } catch { /* skip */ }

            let balance = 0n;
            try {
                const bal = await contract.balanceOf(wc.address);
                if (!('error' in bal)) {
                    balance = BigInt(((bal.properties as Record<string, unknown>)?.['balance'] ?? 0n).toString());
                }
            } catch { /* skip */ }

            const info: PillInfo = { name, symbol, decimals, balance };
            setPillInfo(info);
            return info;
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load PILL balance';
            setError(msg);
            return null;
        } finally {
            setLoading(false);
        }
    }, [wc.address]);

    // Fetch block on mount and periodically
    useEffect(() => {
        fetchBlockData();
        const interval = setInterval(fetchBlockData, 30000);
        return () => clearInterval(interval);
    }, [fetchBlockData]);

    // Auto-load PILL balance when wallet connects
    useEffect(() => {
        if (connected && wc.address) {
            loadPillBalance();
        }
    }, [connected, wc.address, loadPillBalance]);

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
