import { useState, useCallback, useRef, useEffect } from 'react';
import { JSONRpcProvider, getContract, OP_20_ABI } from 'opnet';
import type { IOP20Contract } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import { Address } from '@btc-vision/transaction';
import { useWalletConnect } from '@btc-vision/walletconnect';

const NETWORK = networks.opnetTestnet;
const RPC_URL = 'https://testnet.opnet.org';

// $PILL token contract on OP_NET testnet
export const PILL_CONTRACT = '0xb09fc29c112af8293539477e23d8df1d3126639642767d707277131352040cbb';

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

export interface DebugInfo {
    walletAddress: string | null;
    publicKey: string | null;
    mldsaPublicKey: string | null;
    hashedMLDSAKey: string | null;
    addressObj: string; // 'present' | 'null'
    addressP2OP: string | null; // wc.address?.p2op(NETWORK)
    addressHex: string | null; // wc.address?.toHex()
    metadataResult: string;
    balanceStrategy: string;
    balanceResult: string;
    errors: string[];
}

export function useBlockchain() {
    const wc = useWalletConnect();
    const providerRef = useRef<JSONRpcProvider | null>(null);

    const [blockData, setBlockData] = useState<BlockData | null>(null);
    const [pillInfo, setPillInfo] = useState<PillInfo | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>('');
    const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

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
        setDebugInfo(null);
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
        const dbg: DebugInfo = {
            walletAddress: wc.walletAddress,
            publicKey: wc.publicKey ? (wc.publicKey.slice(0, 16) + '...') : null,
            mldsaPublicKey: (wc as any).mldsaPublicKey ? ((wc as any).mldsaPublicKey.slice(0, 16) + '...') : null,
            hashedMLDSAKey: (wc as any).hashedMLDSAKey ? ((wc as any).hashedMLDSAKey.slice(0, 16) + '...') : null,
            addressObj: wc.address ? 'present (' + wc.address.length + ' bytes)' : 'null',
            addressP2OP: null,
            addressHex: null,
            metadataResult: 'pending',
            balanceStrategy: 'none',
            balanceResult: 'pending',
            errors: [],
        };

        // Try to get debug info from wc.address
        if (wc.address) {
            try { dbg.addressHex = wc.address.toHex().slice(0, 20) + '...'; } catch { /* skip */ }
            try { dbg.addressP2OP = wc.address.p2op(NETWORK); } catch { /* skip */ }
        }

        if (!wc.walletAddress) {
            dbg.errors.push('No wallet address');
            setDebugInfo(dbg);
            return null;
        }

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

            // --- Token metadata ---
            let name = 'PILL';
            let symbol = 'PILL';
            let decimals = 8;

            // Try metadata() first (single call)
            try {
                const meta = await contract.metadata();
                name = meta.properties.name || name;
                symbol = meta.properties.symbol || symbol;
                decimals = Number(meta.properties.decimals ?? 8);
                dbg.metadataResult = `OK: ${name} (${symbol}), ${decimals} dec`;
            } catch (e: any) {
                dbg.metadataResult = `FAIL: ${e?.message?.slice(0, 80) || e}`;
                // Fallback to individual calls
                try {
                    const nr = await contract.name();
                    name = nr.properties.name || name;
                    dbg.metadataResult += ` | name OK: ${name}`;
                } catch (e2: any) {
                    dbg.errors.push(`name(): ${e2?.message?.slice(0, 60) || e2}`);
                }
                try {
                    const sr = await contract.symbol();
                    symbol = sr.properties.symbol || symbol;
                } catch (e2: any) {
                    dbg.errors.push(`symbol(): ${e2?.message?.slice(0, 60) || e2}`);
                }
                try {
                    const dr = await contract.decimals();
                    decimals = Number(dr.properties.decimals ?? 8);
                } catch (e2: any) {
                    dbg.errors.push(`decimals(): ${e2?.message?.slice(0, 60) || e2}`);
                }
            }

            // --- Balance: try multiple strategies ---
            let balance = 0n;
            let balanceFound = false;

            // === STRATEGY A: Use wc.address directly ===
            if (wc.address && !balanceFound) {
                try {
                    const bal = await contract.balanceOf(wc.address);
                    if ('error' in bal) {
                        dbg.errors.push(`balanceOf(wc.address) returned error: ${(bal as any).error}`);
                    } else {
                        balance = bal.properties.balance ?? 0n;
                        dbg.balanceStrategy = 'A: wc.address';
                        dbg.balanceResult = balance.toString();
                        balanceFound = true;
                    }
                } catch (e: any) {
                    dbg.errors.push(`A wc.address: ${e?.message?.slice(0, 100) || e}`);
                }
            }

            // === STRATEGY B: getPublicKeyInfo → Address ===
            if (!balanceFound) {
                try {
                    const resolved = await provider.getPublicKeyInfo(wc.walletAddress, false);
                    if (resolved) {
                        dbg.errors.push(`B resolved addr: ${resolved.length} bytes`);
                        const bal = await contract.balanceOf(resolved);
                        if ('error' in bal) {
                            dbg.errors.push(`B balanceOf returned error: ${(bal as any).error}`);
                        } else {
                            balance = bal.properties.balance ?? 0n;
                            dbg.balanceStrategy = 'B: getPublicKeyInfo';
                            dbg.balanceResult = balance.toString();
                            balanceFound = true;
                        }
                    } else {
                        dbg.errors.push('B getPublicKeyInfo returned undefined');
                    }
                } catch (e: any) {
                    dbg.errors.push(`B getPublicKeyInfo: ${e?.message?.slice(0, 100) || e}`);
                }
            }

            // === STRATEGY C: Build Address from mldsaPublicKey ===
            if (!balanceFound && (wc as any).mldsaPublicKey) {
                try {
                    const mldsaKey = (wc as any).mldsaPublicKey as string;
                    const addr = Address.fromString(mldsaKey, wc.publicKey || undefined);
                    const bal = await contract.balanceOf(addr);
                    if ('error' in bal) {
                        dbg.errors.push(`C balanceOf returned error: ${(bal as any).error}`);
                    } else {
                        balance = bal.properties.balance ?? 0n;
                        dbg.balanceStrategy = 'C: mldsaPublicKey';
                        dbg.balanceResult = balance.toString();
                        balanceFound = true;
                    }
                } catch (e: any) {
                    dbg.errors.push(`C mldsaKey: ${e?.message?.slice(0, 100) || e}`);
                }
            }

            // === STRATEGY D: Build Address from hashedMLDSAKey (raw 32 bytes) ===
            if (!balanceFound && (wc as any).hashedMLDSAKey) {
                try {
                    const hashed = (wc as any).hashedMLDSAKey as string;
                    const hex = hashed.startsWith('0x') ? hashed.slice(2) : hashed;
                    const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
                    const addr = Address.wrap(bytes);
                    const bal = await contract.balanceOf(addr);
                    if ('error' in bal) {
                        dbg.errors.push(`D balanceOf returned error: ${(bal as any).error}`);
                    } else {
                        balance = bal.properties.balance ?? 0n;
                        dbg.balanceStrategy = 'D: hashedMLDSAKey';
                        dbg.balanceResult = balance.toString();
                        balanceFound = true;
                    }
                } catch (e: any) {
                    dbg.errors.push(`D hashedMLDSA: ${e?.message?.slice(0, 100) || e}`);
                }
            }

            // === STRATEGY E: Build Address from classical publicKey only ===
            if (!balanceFound && wc.publicKey) {
                try {
                    const hex = wc.publicKey.startsWith('0x') ? wc.publicKey.slice(2) : wc.publicKey;
                    const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
                    const addr = new Address(bytes);
                    const bal = await contract.balanceOf(addr);
                    if ('error' in bal) {
                        dbg.errors.push(`E balanceOf returned error: ${(bal as any).error}`);
                    } else {
                        balance = bal.properties.balance ?? 0n;
                        dbg.balanceStrategy = 'E: publicKey→Address';
                        dbg.balanceResult = balance.toString();
                        balanceFound = true;
                    }
                } catch (e: any) {
                    dbg.errors.push(`E publicKey: ${e?.message?.slice(0, 100) || e}`);
                }
            }

            if (!balanceFound) {
                dbg.balanceStrategy = 'ALL FAILED';
                dbg.balanceResult = '0 (no strategy worked)';
            }

            const info: PillInfo = { name, symbol, decimals, balance };
            setPillInfo(info);
            setDebugInfo(dbg);
            console.log('[PILL] Debug:', dbg);
            return info;
        } catch (err: any) {
            const msg = err?.message || 'Failed to load PILL balance';
            dbg.errors.push(`FATAL: ${msg.slice(0, 120)}`);
            setError(msg);
            setDebugInfo(dbg);
            return null;
        } finally {
            setLoading(false);
        }
    }, [wc.address, wc.walletAddress, wc.publicKey, (wc as any).mldsaPublicKey, (wc as any).hashedMLDSAKey]);

    // Fetch block on mount and periodically
    useEffect(() => {
        fetchBlockData();
        const interval = setInterval(fetchBlockData, 30000);
        return () => clearInterval(interval);
    }, [fetchBlockData]);

    // Auto-load PILL balance when wallet connects
    useEffect(() => {
        if (connected && wc.walletAddress) {
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
        debugInfo,
        connectWallet,
        disconnectWallet,
        fetchBlockData,
        loadPillBalance,
        setError,
    };
}
