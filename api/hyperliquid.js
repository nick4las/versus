/**
 * Vercel Serverless Function to proxy real-time data from the Hyperliquid API.
 * This function attempts to fetch live prices and uses them to calculate 
 * PnL for simulated open positions.
 */

const fetch = require('node-fetch');

// Define the Hyperliquid RPC URL
const HYPERLIQUID_RPC_URL = "https://api.hyperliquid.xyz/info";

// Function to handle the Vercel request
module.exports = async (req, res) => {
    // Set CORS headers for security
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle pre-flight (OPTIONS) request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // --- 1. Define the external API endpoint and Request Payload (JSON-RPC) ---
        
        // SWITCHED to allMids endpoint which is simpler and should be less prone to 422 errors.
        const exchangeRequestPayload = {
            method: "allMids",
            params: [], // allMids takes no parameters
            id: 1,
            jsonrpc: "2.0"
        };

        // --- 2. Fetch the live prices from Hyperliquid ---
        
        const apiResponse = await fetch(HYPERLIQUID_RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exchangeRequestPayload)
        });

        // CRITICAL FIX: Consume the stream ONCE as text, then handle status and parsing.
        const responseText = await apiResponse.text();
        let data = null;

        try {
            // Attempt to parse the text as JSON
            data = JSON.parse(responseText);
        } catch (parseError) {
            // If JSON parsing fails, the body is likely a non-JSON error string.
            console.warn("Could not parse response as JSON. Treating as raw text error.");
        }

        if (!apiResponse.ok) {
            let errorDetails = data || { raw_response: responseText, message: "Response was not JSON or failed parsing." };
            
            console.error(`CRITICAL ERROR: Hyperliquid API failed with status ${apiResponse.status}:`, errorDetails);
            
            // Return a 502 Bad Gateway if the upstream API fails
            res.status(502).json({
                error: "Failed to fetch data from Hyperliquid API",
                status: apiResponse.status,
                details: errorDetails.raw_response || errorDetails.message || `Upstream API returned status ${apiResponse.status} with unparsable content.`
            });
            return;
        }

        // --- 3. Success Path (apiResponse.ok is true) ---
        
        const assetPrices = {};

        // Process the result: data.result is an array of strings [symbol, mid_price]
        if (data && data.result) {
            // The result format is likely: { "ETH": "3500.5", "BTC": "60000.1" }
            for (const [key, value] of Object.entries(data.result)) {
                // The keys in allMids result are usually the currency symbols (e.g., "ETH")
                assetPrices[key] = parseFloat(value);
            }
        }
        
        // --- 4. Construct Data with Live Price Injection ---
        
        // Use live price if available, otherwise fallback to a large number
        const btcPrice = assetPrices['BTC'] || 60000; 
        const ethPrice = assetPrices['ETH'] || 3500;
        
        const formattedBtcPrice = parseFloat(btcPrice.toFixed(2));
        const formattedEthPrice = parseFloat(ethPrice.toFixed(2));
        
        // Prediction Market Data (uses live BTC price)
        const markets = [
            {
                MarketID: "BTC-PERP-Q1",
                Title: "BTC Perpetual Futures (Live Price)",
                OddsYes: 0.55, 
                OddsNo: 0.45,
                CurrentPrice: formattedBtcPrice, // LIVE price
                Timestamp: Date.now()
            }
        ];
        
        // Simulated Open Positions
        const openPositions = [
            {
                Asset: "BTC",
                Side: "Long",
                SizeUSD: 5000,
                EntryPrice: 58500.25,
                CurrentPrice: formattedBtcPrice,
                LiquidationPrice: 55000.00,
                // Calculate PnL based on the current LIVE price
                UnrealizedPnL: (formattedBtcPrice - 58500.25) * (5000 / 58500.25)
            },
            {
                Asset: "ETH",
                Side: "Short",
                SizeUSD: 2500,
                EntryPrice: 3800.00,
                CurrentPrice: formattedEthPrice,
                LiquidationPrice: 4100.00,
                // Calculate PnL based on the current LIVE price
                UnrealizedPnL: (3800.00 - formattedEthPrice) * (2500 / 3800.00)
            }
        ];

        // --- 5. Return Success Response ---
        
        res.status(200).json({
            markets: markets,
            openPositions: openPositions
        });

    } catch (error) {
        console.error("Serverless Function Execution Error (Catch Block):", error.message);
        
        // --- 6. Return generic 500 Internal Server Error for unhandled exceptions ---
        res.status(500).json({
            error: "Internal Server Error during execution.",
            details: error.message
        });
    }
};
