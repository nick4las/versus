// The serverless function endpoint for fetching Hyperliquid data
// Path: /api/hyperliquid

import fetch from 'node-fetch';

// Define the Hyperliquid RPC URL
const HYPERLIQUID_RPC_URL = "https://api.hyperliquid.xyz/info";

/**
 * Helper function to simulate a mock position data.
 * In a real app, this would be fetched from a Hyperliquid user endpoint.
 */
function getMockOpenPositions() {
    return [
        {
            Asset: "ETH",
            Side: "Long",
            SizeUSD: 1250.00,
            EntryPrice: 3850.50,
            CurrentPrice: 3950.00, // Will be updated by live price if available
            LiquidationPrice: 3600.00,
            UnrealizedPnL: (3950.00 - 3850.50) * 0.32 // Mock calculation
        },
        {
            Asset: "SOL",
            Side: "Short",
            SizeUSD: 500.00,
            EntryPrice: 155.00,
            CurrentPrice: 160.00,
            LiquidationPrice: 170.00,
            UnrealizedPnL: (155.00 - 160.00) * 3.12 // Mock calculation
        }
    ];
}

/**
 * Primary handler for the Vercel Serverless Function.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 */
module.exports = async (req, res) => {
    // Set CORS headers for security and browser compatibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle pre-flight (OPTIONS) request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Define the request body for Hyperliquid's exchange info (getting price)
    const requestBody = {
        method: "exchangeSnapshot",
        params: [{ type: "spot" }, ["USDC", "ETH", "SOL"]], // Requesting spot data for relevant markets
        id: 1,
        jsonrpc: "2.0"
    };

    try {
        const response = await fetch(HYPERLIQUID_RPC_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`CRITICAL ERROR: Hyperliquid API returned status ${response.status}. Body: ${errorBody}`);
            // Return a 502 Bad Gateway if the upstream API fails
            return res.status(502).json({ 
                error: "Failed to fetch data from Hyperliquid API", 
                status: response.status,
                details: errorBody.substring(0, 100)
            });
        }

        const data = await response.json();
        const assetPrices = {};

        // Process the result to extract current prices
        if (data && data.result) {
            data.result.forEach(item => {
                assetPrices[item.coin] = parseFloat(item.price);
            });
        }

        // --- Mock Market Data ---
        // Simulate a prediction market based on ETH price
        const ethPrice = assetPrices['ETH'] || 4000.00; // Fallback price
        
        const mainMarket = {
            MarketID: "ETH-PREDICT-24Q4",
            Title: "ETH Price > $4500 by Dec 31st",
            CurrentPrice: ethPrice,
            OddsYes: 0.65, // 65% chance (simulated)
            OddsNo: 0.35
        };

        // --- Mock Positions Data ---
        let openPositions = getMockOpenPositions();
        
        // Update mock positions with live prices if available
        openPositions = openPositions.map(pos => {
            const livePrice = assetPrices[pos.Asset];
            if (livePrice) {
                const pnlFactor = pos.Side === 'Long' ? (livePrice - pos.EntryPrice) : (pos.EntryPrice - livePrice);
                // Calculate PnL based on size and price movement, using a fixed size for simplicity
                const calculatedPnL = pnlFactor * (pos.SizeUSD / pos.EntryPrice);
                return {
                    ...pos,
                    CurrentPrice: livePrice,
                    UnrealizedPnL: calculatedPnL
                };
            }
            return pos;
        });

        // Respond with the combined data
        res.status(200).json({
            markets: [mainMarket],
            openPositions: openPositions
        });

    } catch (error) {
        console.error("CRITICAL ERROR: Serverless Function Execution Failed:", error);
        // Return a 500 Internal Server Error
        res.status(500).json({ 
            error: "Internal Server Error during execution", 
            details: error.message 
        });
    }
};
