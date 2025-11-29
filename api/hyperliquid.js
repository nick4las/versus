/**
 * Vercel Serverless Function using JSON-RPC Batching to fetch open positions 
 * for multiple Hyperliquid wallets simultaneously.
 * This is the most efficient method for tracking dozens of traders.
 */

const fetch = require('node-fetch');

// Define the Hyperliquid RPC URL
const HYPERLIQUID_RPC_URL = "https://api.hyperliquid.xyz/info";

// 🚨 IMPORTANT: Replace these mock addresses with the actual wallets you want to track!
const TRACKED_WALLET_ADDRESSES = [
    "0x7fdafde5cfb5465924316eced2d3715494c517d1", // Mock Wallet 1
    "0xd47587702a91731dc1089b5db0932cf820151a91", // Mock Wallet 2
    "0x880ac484a1743862989a441d6d867238c7aa311c", // Mock Wallet 3
    "0x000000000000000000000000000000000000d0c4", // Mock Wallet 4
    "0x000000000000000000000000000000000000d0c5", // Mock Wallet 5
    "0x000000000000000000000000000000000000d0c6", // Mock Wallet 6
    "0x000000000000000000000000000000000000d0c7", // Mock Wallet 7
    "0x000000000000000000000000000000000000d0c8", // Mock Wallet 8
    "0x000000000000000000000000000000000000d0c9", // Mock Wallet 9
    "0x000000000000000000000000000000000000d0c0"  // Mock Wallet 10
];

// Fallback market prices (used for PnL calculation)
const btcPrice = 60000;
const ethPrice = 3500;

// Function to safely extract position details from Hyperliquid's complex structure
function mapHyperliquidPosition(pos, currentBtcPrice, currentEthPrice, walletAddress) {
    const asset = pos.data.asset;
    const isLong = pos.data.s === 'long';
    const entryPrice = parseFloat(pos.data.entryPx);
    const liquidationPrice = parseFloat(pos.data.liquidationPx);
    const size = parseFloat(pos.data.szi);
    const currentPrice = (asset === 1) ? currentBtcPrice : currentEthPrice; // 1 is BTC, 2 is ETH

    // Skip if size is zero or near zero
    if (size < 0.001) return null; 

    // Calculate Unrealized PnL
    let unrealizedPnL = 0;
    if (isLong) {
        unrealizedPnL = (currentPrice - entryPrice) * size;
    } else {
        unrealizedPnL = (entryPrice - currentPrice) * size;
    }

    return {
        Wallet: walletAddress, // New field to identify the trader
        Asset: asset === 1 ? "BTC" : "ETH",
        Side: isLong ? "Long" : "Short",
        SizeUSD: size * entryPrice, // Approximated size in USD at entry
        EntryPrice: entryPrice,
        CurrentPrice: currentPrice,
        LiquidationPrice: liquidationPrice,
        UnrealizedPnL: parseFloat(unrealizedPnL.toFixed(2))
    };
}


// Function to handle the Vercel request
module.exports = async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // --- 1. Construct the JSON-RPC Batch Request ---
    const requestPayload = TRACKED_WALLET_ADDRESSES.map((wallet, index) => ({
        method: "clearinghouseState",
        params: [{ user: wallet }], 
        id: index + 1, // Unique ID for each request in the batch
        jsonrpc: "2.0"
    }));

    let openPositions = [];
    let fetchError = null;

    try {
        // --- 2. Send the Single Batch Fetch Request ---
        
        const apiResponse = await fetch(HYPERLIQUID_RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload)
        });

        const responseText = await apiResponse.text();
        let data = null;

        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            console.warn("Response was not valid JSON. Treating as raw text error.");
        }

        if (!apiResponse.ok) {
            // Handle non-200 status (e.g., 422 if payload rejected)
            let errorDetails = data || { raw_response: responseText, message: "Response was not JSON or failed parsing." };
            
            console.error(`CRITICAL ERROR: Hyperliquid API failed with status ${apiResponse.status}:`, errorDetails);
            
            fetchError = {
                error: "Failed to fetch positions from Hyperliquid API (Batch Failed)",
                status: apiResponse.status,
                details: errorDetails.raw_response || errorDetails.message || `Upstream API returned status ${apiResponse.status} with unparsable content.`
            };
        } else if (Array.isArray(data)) {
            // --- Success: Process Batch Response ---
            
            data.forEach((result, index) => {
                const walletAddress = TRACKED_WALLET_ADDRESSES[index];
                
                if (result.result && result.result.assetPositions) {
                    const walletPositions = result.result.assetPositions.filter(p => p.data.szi !== "0");
                    
                    walletPositions.forEach(pos => {
                        const mappedPos = mapHyperliquidPosition(pos, btcPrice, ethPrice, walletAddress);
                        if (mappedPos) {
                            openPositions.push(mappedPos);
                        }
                    });
                }
            });
        }
        
    } catch (error) {
        // Handle network errors (e.g., DNS failure, timeout)
        console.error("Network error fetching Hyperliquid data:", error.message);
        fetchError = { error: "Network or proxy connection failed.", details: error.message };
    }

    // --- 3. Construct Final Response ---
    
    const formattedBtcPrice = parseFloat(btcPrice.toFixed(2));
    
    // Prediction Market Data (uses simulated price)
    const markets = [
        {
            MarketID: "BTC-PERP-Q1",
            Title: "BTC Perpetual Futures (Simulated Price)",
            OddsYes: 0.55, 
            OddsNo: 0.45,
            CurrentPrice: formattedBtcPrice,
            Timestamp: Date.now()
        }
    ];

    if (fetchError) {
        // If an error occurred, return a 502 to the frontend, but include the fallback structure.
        return res.status(502).json({ 
            ...fetchError,
            markets: markets,
            openPositions: [{ Wallet: "API_ERROR", Asset: "FAIL", Side: fetchError.status.toString(), SizeUSD: 0, EntryPrice: 0, CurrentPrice: 0, LiquidationPrice: 0, UnrealizedPnL: 0 }] 
        });
    }
    
    // Return Success Response (200 OK)
    // The front-end will now receive a consolidated list of ALL open positions across all tracked wallets.
    res.status(200).json({
        markets: markets,
        openPositions: openPositions
    });
};
