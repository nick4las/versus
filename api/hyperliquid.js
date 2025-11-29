/**
 * Vercel Serverless Function using JSON-RPC Batching to fetch open positions 
 * for multiple Hyperliquid wallets and a reliable REST API (Coinbase) for live prices.
 * This hybrid approach ensures the function remains stable and functional.
 */

const fetch = require('node-fetch');

// Define the Hyperliquid RPC URL for positions
const HYPERLIQUID_RPC_URL = "https://api.hyperliquid.xyz/info";
// Define a reliable REST API for current market prices
const COINBASE_API_URL = "https://api.coinbase.com/v2/exchange-rates?currency=USD";


// Fallback list of mock addresses (used if leaderboard fetch fails)
let TRACKED_WALLET_ADDRESSES = [
    "0x000000000000000000000000000000000000d0c1", // Mock Wallet 1
    "0x000000000000000000000000000000000000d0c2", // Mock Wallet 2
    "0x000000000000000000000000000000000000d0c3", // Mock Wallet 3
    "0x000000000000000000000000000000000000d0c4", // Mock Wallet 4
    "0x000000000000000000000000000000000000d0c5", // Mock Wallet 5
    "0x000000000000000000000000000000000000d0c6", // Mock Wallet 6
    "0x000000000000000000000000000000000000d0c7", // Mock Wallet 7
    "0x000000000000000000000000000000000000d0c8", // Mock Wallet 8
    "0x000000000000000000000000000000000000d0c9", // Mock Wallet 9
    "0x000000000000000000000000000000000000d0c0"  // Mock Wallet 10
];

// Fallback market prices (used if Coinbase API fails)
let btcPrice = 60000;
let ethPrice = 3500;

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

    // --- 1. Fetch Live Market Prices (via Coinbase REST API) ---
    try {
        const coinbaseResponse = await fetch(COINBASE_API_URL, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        const coinbaseData = await coinbaseResponse.json();

        if (coinbaseResponse.ok && coinbaseData.data && coinbaseData.data.rates) {
            const rates = coinbaseData.data.rates;
            // The rate is 1 USD / X BTC/ETH. Price is 1 / Rate.
            if (rates.BTC) { btcPrice = 1 / parseFloat(rates.BTC); }
            if (rates.ETH) { ethPrice = 1 / parseFloat(rates.ETH); }
        }
    } catch (error) {
        console.warn("Could not fetch live market prices from Coinbase. Using fallback prices.");
        // Continue with default prices
    }

    // --- 1.5. Fetch Top 50 Wallet Addresses (via Hyperliquid webData API) ---
    try {
        const leaderboardPayload = {
            method: "webData",
            params: {
                type: "global",
                subType: "all",
                start: 1,
                end: 50 // Fetch top 50 wallets
            },
            id: 2, // Use a different ID than the position batch
            jsonrpc: "2.0"
        };
        
        const lbResponse = await fetch(HYPERLIQUID_RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(leaderboardPayload)
        });

        const lbText = await lbResponse.text();
        let lbData = null;
        try { lbData = JSON.parse(lbText); } catch (e) { 
            console.warn("Hyperliquid leaderboard response was not valid JSON.");
        }

        if (lbResponse.ok && lbData && lbData.result && Array.isArray(lbData.result.leaderboard)) {
            // Extract the wallet addresses
            const fetchedWallets = lbData.result.leaderboard
                .map(entry => entry.user)
                .slice(0, 50); // Ensure max 50 addresses

            if (fetchedWallets.length > 0) {
                TRACKED_WALLET_ADDRESSES = fetchedWallets;
                console.log(`Successfully fetched ${TRACKED_WALLET_ADDRESSES.length} wallets from the leaderboard.`);
            } else {
                 console.warn("Leaderboard fetch succeeded but returned no wallets. Using fallback wallets.");
            }
        } else {
            console.warn("Could not fetch valid leaderboard data from Hyperliquid. Using fallback wallets.");
        }

    } catch (error) {
        console.error("Error fetching Hyperliquid Leaderboard:", error.message);
        console.warn("Using fallback wallets for position tracking.");
    }


    // --- 2. Construct the Hyperliquid Position Batch Request ---
    // Now uses the dynamically updated TRACKED_WALLET_ADDRESSES
    const requestPayload = TRACKED_WALLET_ADDRESSES.map((wallet, index) => ({
        method: "clearinghouseState",
        params: [{ user: wallet }], 
        id: index + 1, // Unique ID for each request in the batch
        jsonrpc: "2.0"
    }));

    let openPositions = [];
    let hyperliquidFetchFailed = false;

    try {
        // --- 3. Send the Hyperliquid Batch Fetch Request ---
        
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
            console.warn("Hyperliquid response was not valid JSON. Treating as raw text error.");
        }

        if (!apiResponse.ok || !Array.isArray(data)) {
            // Handle any failure (non-200 status, or non-array response)
            console.error(`Hyperliquid API Batch Failed. Status: ${apiResponse.status || 'N/A'}.`);
            hyperliquidFetchFailed = true;
        } else {
            // --- Success: Process Batch Response ---
            
            data.forEach((result, index) => {
                const walletAddress = TRACKED_WALLET_ADDRESSES[index];
                
                if (result.result && result.result.assetPositions) {
                    const walletPositions = result.result.assetPositions.filter(p => p.data.szi !== "0");
                    
                    walletPositions.forEach(pos => {
                        // Use the newly fetched live prices for accurate PnL calculation
                        const mappedPos = mapHyperliquidPosition(pos, btcPrice, ethPrice, walletAddress);
                        if (mappedPos) {
                            openPositions.push(mappedPos);
                        }
                    });
                }
            });
        }
        
    } catch (error) {
        console.error("Network error fetching Hyperliquid data:", error.message);
        hyperliquidFetchFailed = true;
    }

    // --- 4. Construct Final Response ---
    
    const formattedBtcPrice = parseFloat(btcPrice.toFixed(2));
    
    // Prediction Market Data (uses live/fallback price)
    const markets = [
        {
            MarketID: "BTC-PERP-Q1",
            Title: `BTC Perpetual Futures (Live Price: $${formattedBtcPrice.toLocaleString()})`,
            OddsYes: 0.55, 
            OddsNo: 0.45,
            CurrentPrice: formattedBtcPrice,
            Timestamp: Date.now()
        }
    ];

    if (hyperliquidFetchFailed) {
        // If Hyperliquid fails, return 200 OK with a warning, but successfully pass the market data.
        return res.status(200).json({ 
            markets: markets,
            openPositions: [], // Empty array for positions if fetch failed
            warning: "Hyperliquid position data fetch failed. Displaying live prices only."
        });
    }
    
    // Return Success Response (200 OK)
    res.status(200).json({
        markets: markets,
        openPositions: openPositions
    });
};
