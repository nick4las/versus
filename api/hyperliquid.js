/**
 * Vercel Serverless Function to proxy real-time data.
 * This function uses ONLY simulated data.
 */

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
        
        // --- 1. Define Simulated Data ---
        
        // Use a simple, time-based simulation for BTC and ETH prices
        const btcPrice = (60000 + Math.sin(Date.now() / 10000000) * 1000);
        const ethPrice = (3500 + Math.cos(Date.now() / 10000000) * 100);

        const formattedBtcPrice = parseFloat(btcPrice.toFixed(2));
        const formattedEthPrice = parseFloat(ethPrice.toFixed(2));
        
        // Prediction Market Data (uses simulated BTC price)
        const markets = [
            {
                MarketID: "BTC-PRED-2025",
                Title: "BTC Perpetual Futures (Prediction Pool)",
                OddsYes: 0.55, 
                OddsNo: 0.45,
                CurrentPrice: formattedBtcPrice, // Simulated price
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
                // Calculate PnL based on the current simulated price
                UnrealizedPnL: (formattedBtcPrice - 58500.25) * (5000 / 58500.25)
            },
            {
                Asset: "ETH",
                Side: "Short",
                SizeUSD: 2500,
                EntryPrice: 3800.00,
                CurrentPrice: formattedEthPrice,
                LiquidationPrice: 4100.00,
                // Calculate PnL based on the current simulated price
                UnrealizedPnL: (3800.00 - formattedEthPrice) * (2500 / 3800.00)
            }
        ];

        // --- 2. Return Success Response ---
        // This response is now guaranteed to succeed.
        res.status(200).json({
            markets: markets,
            openPositions: openPositions
        });

    } catch (error) {
        console.error("Serverless Function Execution Error (Catch Block):", error.message);
        
        // --- 3. Return generic 500 Internal Server Error for unhandled exceptions ---
        res.status(500).json({
            error: "Internal Server Error during execution.",
            details: error.message
        });
    }
};
