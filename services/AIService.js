class AIService {
    constructor(database) {
        this.db = database;
        
        // Category keywords for AI detection
        this.categoryKeywords = {
            'roblox': {
                keywords: ['robux', 'gamepass', 'limited', 'pet', 'adopt me', 'bloxburg', 'roblox', 'mm2', 'murder mystery', 'jailbreak', 'arsenal', 'royale high'],
                weight: 1.0
            },
            'skins': {
                keywords: ['skin', 'cosmetic', 'outfit', 'fortnite', 'cs', 'valorant', 'apex', 'overwatch', 'warzone', 'character'],
                weight: 1.0
            },
            'currency': {
                keywords: ['coins', 'currency', 'gold', 'credits', 'money', 'gems', 'tokens', 'points', 'cash'],
                weight: 1.0
            },
            'rare': {
                keywords: ['rare', 'legendary', 'epic', 'special', 'exclusive', 'limited edition', 'collector', 'vintage'],
                weight: 1.2
            },
            'other': {
                keywords: [],
                weight: 0.1
            }
        };

        // Tag patterns
        this.tagPatterns = [
            { pattern: /(rare|legendary|epic)/i, tag: '#Rare' },
            { pattern: /(limited|exclusive)/i, tag: '#Limited' },
            { pattern: /(gamepass|game pass)/i, tag: '#Gamepass' },
            { pattern: /(shiny|golden|diamond)/i, tag: '#Special' },
            { pattern: /(pet|animal)/i, tag: '#Pet' },
            { pattern: /(weapon|gun|knife)/i, tag: '#Weapon' },
            { pattern: /(adopt me)/i, tag: '#AdoptMe' },
            { pattern: /(bloxburg)/i, tag: '#Bloxburg' },
            { pattern: /(mm2|murder mystery)/i, tag: '#MM2' },
            { pattern: /(jailbreak)/i, tag: '#Jailbreak' },
            { pattern: /(arsenal)/i, tag: '#Arsenal' },
            { pattern: /(royale high|rh)/i, tag: '#RoyaleHigh' },
            { pattern: /(fortnite)/i, tag: '#Fortnite' },
            { pattern: /(valorant)/i, tag: '#Valorant' },
            { pattern: /(cs:go|csgo|counter strike)/i, tag: '#CSGO' }
        ];
    }

    async analyzeListing(itemName, description, price) {
        const text = `${itemName} ${description}`.toLowerCase();
        
        // AI Category Detection
        const category = this.detectCategory(text);
        
        // AI Tag Generation
        const tags = this.generateTags(text);
        
        // Price Analysis
        const priceAnalysis = await this.analyzePricing(itemName, category, price);
        
        // Confidence Score
        const confidence = this.calculateConfidence(text, category);
        
        return {
            category,
            tags,
            priceAnalysis,
            confidence,
            aiProcessed: true,
            processedAt: new Date().toISOString()
        };
    }

    detectCategory(text) {
        const scores = {};
        
        // Initialize scores
        Object.keys(this.categoryKeywords).forEach(category => {
            scores[category] = 0;
        });

        // Calculate scores based on keyword matches
        Object.entries(this.categoryKeywords).forEach(([category, config]) => {
            config.keywords.forEach(keyword => {
                if (text.includes(keyword)) {
                    // Give higher score for exact matches
                    const exactMatch = text.includes(keyword);
                    const score = exactMatch ? 2 : 1;
                    scores[category] += score * config.weight;
                }
            });
        });

        // Find highest scoring category
        let bestCategory = 'other';
        let highestScore = 0;

        Object.entries(scores).forEach(([category, score]) => {
            if (score > highestScore) {
                highestScore = score;
                bestCategory = category;
            }
        });

        // If no clear category found, use 'other'
        return highestScore > 0 ? bestCategory : 'other';
    }

    generateTags(text) {
        const tags = [];
        
        // Apply tag patterns
        this.tagPatterns.forEach(({ pattern, tag }) => {
            if (pattern.test(text)) {
                tags.push(tag);
            }
        });

        // Add default tag if none found
        if (tags.length === 0) {
            tags.push('#General');
        }

        // Remove duplicates and limit to 5 tags
        return [...new Set(tags)].slice(0, 5);
    }

    async analyzePricing(itemName, category, price) {
        try {
            // Get historical price data
            const priceHistory = await this.db.getPriceHistory(itemName, category, 20);
            
            if (priceHistory.length === 0) {
                return '📊 No price history available - New item to market!';
            }

            // Calculate statistics
            const prices = priceHistory.map(item => item.price);
            const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            
            // Calculate price percentile
            const sortedPrices = prices.sort((a, b) => a - b);
            const medianPrice = sortedPrices[Math.floor(sortedPrices.length / 2)];
            
            let analysis = `📊 **Market Analysis** (${priceHistory.length} data points):\n`;
            analysis += `• **Average:** ${avgPrice.toFixed(2)}\n`;
            analysis += `• **Median:** ${medianPrice.toFixed(2)}\n`;
            analysis += `• **Range:** ${minPrice.toFixed(2)} - ${maxPrice.toFixed(2)}\n`;
            
            // Price recommendation
            if (price < avgPrice * 0.7) {
                analysis += `• 🔥 **Excellent Deal** - 30%+ below average`;
            } else if (price < avgPrice * 0.9) {
                analysis += `• ✅ **Good Price** - Below market average`;
            } else if (price > avgPrice * 1.3) {
                analysis += `• ⚠️ **Premium Pricing** - 30%+ above average`;
            } else if (price > avgPrice * 1.1) {
                analysis += `• 📈 **Above Average** - Higher than typical`;
            } else {
                analysis += `• 💰 **Fair Market Price** - Within normal range`;
            }
            
            return analysis;
            
        } catch (error) {
            return '📊 Price analysis unavailable';
        }
    }

    calculateConfidence(text, category) {
        if (category === 'other') return 0.3;
        
        const categoryConfig = this.categoryKeywords[category];
        let matches = 0;
        
        categoryConfig.keywords.forEach(keyword => {
            if (text.includes(keyword)) matches++;
        });
        
        // Confidence based on keyword matches
        const confidence = Math.min(0.9, 0.4 + (matches * 0.1));
        return parseFloat(confidence.toFixed(2));
    }

    async getMarketTrends(category = null, days = 7) {
        try {
            const dateLimit = new Date();
            dateLimit.setDate(dateLimit.getDate() - days);
            
            let sql = `
                SELECT 
                    DATE(created_at) as date,
                    category,
                    COUNT(*) as sales,
                    AVG(price) as avg_price,
                    SUM(price) as total_revenue
                FROM price_history 
                WHERE created_at >= ?
            `;
            
            let params = [dateLimit.toISOString()];
            
            if (category) {
                sql += ` AND category = ?`;
                params.push(category);
            }
            
            sql += ` GROUP BY DATE(created_at), category ORDER BY date DESC`;
            
            const trends = await this.db.all(sql, params);
            
            return this.formatTrends(trends);
            
        } catch (error) {
            console.error('Error getting market trends:', error);
            return null;
        }
    }

    formatTrends(trends) {
        if (!trends || trends.length === 0) {
            return '📈 No recent market activity';
        }

        const totalSales = trends.reduce((sum, day) => sum + day.sales, 0);
        const avgDailyRevenue = trends.reduce((sum, day) => sum + day.total_revenue, 0) / trends.length;
        
        let analysis = `📈 **Market Trends** (Last ${trends.length} days):\n`;
        analysis += `• **Total Sales:** ${totalSales}\n`;
        analysis += `• **Daily Revenue:** ${avgDailyRevenue.toFixed(2)} avg\n`;
        
        // Find trending categories
        const categoryStats = {};
        trends.forEach(trend => {
            if (!categoryStats[trend.category]) {
                categoryStats[trend.category] = { sales: 0, revenue: 0 };
            }
            categoryStats[trend.category].sales += trend.sales;
            categoryStats[trend.category].revenue += trend.total_revenue;
        });
        
        const topCategory = Object.entries(categoryStats)
            .sort(([,a], [,b]) => b.sales - a.sales)[0];
        
        if (topCategory) {
            analysis += `• **Trending:** ${topCategory[0]} (${topCategory[1].sales} sales)`;
        }
        
        return analysis;
    }

    async generatePriceSuggestion(itemName, category, description) {
        try {
            // Get similar items
            const similarItems = await this.db.getPriceHistory(itemName, category, 50);
            
            if (similarItems.length === 0) {
                // No price history, suggest based on category averages
                return await this.suggestCategoryBasedPrice(category);
            }
            
            // Calculate suggested price range
            const prices = similarItems.map(item => item.price);
            const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
            const stdDev = this.calculateStandardDeviation(prices, avgPrice);
            
            const minSuggested = Math.max(0.01, avgPrice - stdDev);
            const maxSuggested = avgPrice + stdDev;
            
            return {
                suggested: parseFloat(avgPrice.toFixed(2)),
                min: parseFloat(minSuggested.toFixed(2)),
                max: parseFloat(maxSuggested.toFixed(2)),
                confidence: this.calculatePriceConfidence(similarItems.length)
            };
            
        } catch (error) {
            return null;
        }
    }

    async suggestCategoryBasedPrice(category) {
        // Default price ranges by category
        const categoryPrices = {
            'roblox': { min: 1, max: 50, avg: 15 },
            'skins': { min: 5, max: 100, avg: 25 },
            'currency': { min: 0.50, max: 200, avg: 20 },
            'rare': { min: 10, max: 500, avg: 75 },
            'other': { min: 1, max: 50, avg: 10 }
        };
        
        const range = categoryPrices[category] || categoryPrices['other'];
        
        return {
            suggested: range.avg,
            min: range.min,
            max: range.max,
            confidence: 0.3
        };
    }

    calculateStandardDeviation(values, mean) {
        const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
        const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
        return Math.sqrt(avgSquaredDiff);
    }

    calculatePriceConfidence(sampleSize) {
        if (sampleSize >= 20) return 0.9;
        if (sampleSize >= 10) return 0.7;
        if (sampleSize >= 5) return 0.5;
        return 0.3;
    }

    async detectAnomalies(itemName, price, category) {
        const anomalies = [];
        
        try {
            // Get price history for comparison
            const history = await this.db.getPriceHistory(itemName, category, 30);
            
            if (history.length > 0) {
                const prices = history.map(h => h.price);
                const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
                
                // Check for price anomalies
                if (price < avgPrice * 0.3) {
                    anomalies.push({
                        type: 'SUSPICIOUSLY_LOW_PRICE',
                        message: `Price is ${((1 - price/avgPrice) * 100).toFixed(0)}% below average`,
                        severity: 'HIGH'
                    });
                }
                
                if (price > avgPrice * 3) {
                    anomalies.push({
                        type: 'UNUSUALLY_HIGH_PRICE',
                        message: `Price is ${((price/avgPrice - 1) * 100).toFixed(0)}% above average`,
                        severity: 'MEDIUM'
                    });
                }
            }
            
            // Check for common scam keywords
            const scamKeywords = [
                'guaranteed', 'instant money', 'get rich quick', 'free money',
                'no questions asked', 'limited time only', 'act now'
            ];
            
            const text = `${itemName}`.toLowerCase();
            scamKeywords.forEach(keyword => {
                if (text.includes(keyword)) {
                    anomalies.push({
                        type: 'SCAM_KEYWORDS',
                        message: `Contains potential scam keyword: "${keyword}"`,
                        severity: 'HIGH'
                    });
                }
            });
            
        } catch (error) {
            console.error('Error detecting anomalies:', error);
        }
        
        return anomalies;
    }

    async generateMarketInsights(guildId) {
        try {
            const insights = {};
            
            // Get recent activity (last 7 days)
            const recentActivity = await this.getMarketTrends(null, 7);
            insights.trends = recentActivity;
            
            // Get top categories
            const topCategories = await this.db.all(`
                SELECT 
                    category,
                    COUNT(*) as listings,
                    AVG(price) as avg_price,
                    SUM(views) as total_views
                FROM listings 
                WHERE status = 'active'
                GROUP BY category 
                ORDER BY listings DESC 
                LIMIT 5
            `);
            
            insights.topCategories = topCategories.map(cat => ({
                category: cat.category,
                listings: cat.listings,
                avgPrice: parseFloat(cat.avg_price).toFixed(2),
                popularity: cat.total_views
            }));
            
            // Get price alerts
            const priceAlerts = await this.generatePriceAlerts();
            insights.alerts = priceAlerts;
            
            return insights;
            
        } catch (error) {
            console.error('Error generating market insights:', error);
            return null;
        }
    }

    async generatePriceAlerts() {
        const alerts = [];
        
        try {
            // Find items with significant price drops
            const priceDrops = await this.db.all(`
                WITH recent_prices AS (
                    SELECT 
                        item_name,
                        category,
                        price,
                        created_at,
                        ROW_NUMBER() OVER (PARTITION BY item_name ORDER BY created_at DESC) as rn
                    FROM price_history
                    WHERE created_at >= datetime('now', '-7 days')
                ),
                price_comparison AS (
                    SELECT 
                        item_name,
                        category,
                        MAX(CASE WHEN rn = 1 THEN price END) as current_price,
                        AVG(CASE WHEN rn > 1 THEN price END) as avg_old_price
                    FROM recent_prices
                    GROUP BY item_name, category
                    HAVING COUNT(*) > 3
                )
                SELECT *,
                    ((avg_old_price - current_price) / avg_old_price * 100) as drop_percentage
                FROM price_comparison
                WHERE current_price < avg_old_price * 0.8
                ORDER BY drop_percentage DESC
                LIMIT 5
            `);
            
            priceDrops.forEach(drop => {
                alerts.push({
                    type: 'PRICE_DROP',
                    item: drop.item_name,
                    category: drop.category,
                    message: `${drop.item_name} dropped ${drop.drop_percentage.toFixed(1)}% in price`,
                    currentPrice: drop.current_price,
                    oldPrice: drop.avg_old_price
                });
            });
            
        } catch (error) {
            console.error('Error generating price alerts:', error);
        }
        
        return alerts;
    }

    // Machine Learning helpers (simplified)
    async trainCategoryClassifier() {
        // This would implement a simple ML model for category classification
        // For now, we use rule-based classification
        console.log('📚 Training category classifier with rule-based approach');
        return true;
    }

    async improveRecommendations(feedback) {
        // This would use user feedback to improve AI recommendations
        console.log('🎯 Processing user feedback for AI improvement');
        return true;
    }
}

module.exports = AIService;
