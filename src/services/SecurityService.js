class SecurityService {
    constructor(database, logger) {
        this.db = database;
        this.logger = logger;
        
        // Security configuration
        this.config = {
            maxListingsPerUser: parseInt(process.env.MAX_LISTINGS_PER_USER) || 50,
            maxPrice: parseFloat(process.env.MAX_PRICE) || 10000,
            minPrice: parseFloat(process.env.MIN_PRICE) || 0.01,
            newUserRestriction: {
                maxPrice: 100,
                requiresApproval: true,
                salesThreshold: 3
            },
            rapidListingThreshold: 5, // Max listings per hour
            suspiciousPriceMultiplier: 0.3, // Flag if price is 30% below average
            blacklistedWords: [
                'scam', 'free money', 'guaranteed profit', 'get rich quick',
                'no questions asked', 'instant cash', 'limited time only',
                'act now', 'exclusive deal', 'too good to be true'
            ]
        };

        // Rate limiting storage
        this.rateLimits = new Map();
        
        // Suspicious activity tracking
        this.suspiciousActivity = new Map();
    }

    async validateListing(userId, itemName, price, description) {
        try {
            const validationResult = {
                passed: true,
                flags: [],
                reason: ''
            };

            // Basic price validation
            if (price < this.config.minPrice || price > this.config.maxPrice) {
                validationResult.passed = false;
                validationResult.reason = `Price must be between $${this.config.minPrice} and $${this.config.maxPrice}`;
                return validationResult;
            }

            // Check user metrics for restrictions
            const userMetrics = await this.db.getUserMetrics(userId);
            const isNewUser = (userMetrics.total_sales || 0) < this.config.newUserRestriction.salesThreshold;

            // New user restrictions
            if (isNewUser && price > this.config.newUserRestriction.maxPrice) {
                validationResult.passed = false;
                validationResult.reason = `New sellers are limited to $${this.config.newUserRestriction.maxPrice}. Build reputation first!`;
                return validationResult;
            }

            // Check for rapid listing creation
            const rapidListingCheck = this.checkRapidListing(userId);
            if (!rapidListingCheck.passed) {
                validationResult.passed = false;
                validationResult.reason = rapidListingCheck.reason;
                return validationResult;
            }

            // Check for blacklisted words
            const blacklistCheck = this.checkBlacklistedWords(itemName, description);
            if (!blacklistCheck.passed) {
                validationResult.flags.push('BLACKLISTED_WORDS');
                // Don't block, but flag for manual review
            }

            // Check for suspicious pricing
            const priceCheck = await this.checkSuspiciousPricing(itemName, price);
            if (!priceCheck.passed) {
                validationResult.flags.push('SUSPICIOUS_PRICING');
                // Flag but don't block automatically
            }

            // Check for duplicate listings
            const duplicateCheck = await this.checkDuplicateListings(userId, itemName);
            if (!duplicateCheck.passed) {
                validationResult.flags.push('POTENTIAL_DUPLICATE');
            }

            // Log security check
            this.logger.security(`Security validation for user ${userId}: ${validationResult.passed ? 'PASSED' : 'FAILED'}`, {
                flags: validationResult.flags,
                price,
                itemName: itemName.substring(0, 50)
            });

            // Update user activity tracking
            this.trackUserActivity(userId, 'listing_created', { price, flags: validationResult.flags });

            return validationResult;

        } catch (error) {
            this.logger.error('Security validation error:', error);
            // Fail closed - require manual approval on errors
            return {
                passed: false,
                reason: 'Security validation failed. Please contact an admin.',
                flags: ['VALIDATION_ERROR']
            };
        }
    }

    checkRapidListing(userId) {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);

        if (!this.rateLimits.has(userId)) {
            this.rateLimits.set(userId, []);
        }

        const userActivity = this.rateLimits.get(userId);
        
        // Remove old entries
        const recentActivity = userActivity.filter(timestamp => timestamp > oneHourAgo);
        this.rateLimits.set(userId, recentActivity);

        // Check if user exceeds threshold
        if (recentActivity.length >= this.config.rapidListingThreshold) {
            return {
                passed: false,
                reason: `Too many listings created recently. Please wait before creating more.`
            };
        }

        // Add current timestamp
        recentActivity.push(now);
        this.rateLimits.set(userId, recentActivity);

        return { passed: true };
    }

    checkBlacklistedWords(itemName, description) {
        const text = `${itemName} ${description}`.toLowerCase();
        
        for (const word of this.config.blacklistedWords) {
            if (text.includes(word.toLowerCase())) {
                return {
                    passed: false,
                    flaggedWord: word
                };
            }
        }

        return { passed: true };
    }

    async checkSuspiciousPricing(itemName, price) {
        try {
            // Get average price for similar items
            const priceHistory = await this.db.getPriceHistory(itemName, null, 20);
            
            if (priceHistory.length === 0) {
                return { passed: true }; // No price history to compare
            }

            const prices = priceHistory.map(item => item.price);
            const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

            // Flag if price is significantly below average
            if (price < avgPrice * this.config.suspiciousPriceMultiplier) {
                return {
                    passed: false,
                    suspiciousReason: 'PRICE_TOO_LOW',
                    avgPrice,
                    userPrice: price,
                    percentBelow: Math.round((1 - price / avgPrice) * 100)
                };
            }

            return { passed: true };

        } catch (error) {
            this.logger.error('Error checking suspicious pricing:', error);
            return { passed: true }; // Don't block on errors
        }
    }

    async checkDuplicateListings(userId, itemName) {
        try {
            const existingListings = await this.db.all(`
                SELECT id, item_name FROM listings 
                WHERE seller_id = ? AND status IN ('active', 'pending_approval')
                AND LOWER(item_name) = LOWER(?)
            `, [userId, itemName]);

            return {
                passed: existingListings.length === 0,
                duplicateCount: existingListings.length
            };

        } catch (error) {
            this.logger.error('Error checking duplicates:', error);
            return { passed: true };
        }
    }

    trackUserActivity(userId, action, metadata = {}) {
        const now = Date.now();
        
        if (!this.suspiciousActivity.has(userId)) {
            this.suspiciousActivity.set(userId, []);
        }

        const userActivity = this.suspiciousActivity.get(userId);
        userActivity.push({
            timestamp: now,
            action,
            metadata
        });

        // Keep only last 24 hours of activity
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        const recentActivity = userActivity.filter(activity => activity.timestamp > oneDayAgo);
        this.suspiciousActivity.set(userId, recentActivity);

        // Check for suspicious patterns
        this.analyzeSuspiciousPatterns(userId, recentActivity);
    }

    analyzeSuspiciousPatterns(userId, activities) {
        if (activities.length < 3) return; // Need some data to analyze

        const patterns = {
            rapidActivity: 0,
            priceManipulation: 0,
            flaggedContent: 0
        };

        // Analyze patterns
        activities.forEach(activity => {
            if (activity.metadata.flags) {
                patterns.flaggedContent += activity.metadata.flags.length;
            }

            if (activity.metadata.price) {
                // Check for price manipulation patterns
                const prices = activities
                    .filter(a => a.metadata.price)
                    .map(a => a.metadata.price);
                
                if (prices.length > 1) {
                    const priceVariance = this.calculateVariance(prices);
                    if (priceVariance > 1000) { // High price variance
                        patterns.priceManipulation++;
                    }
                }
            }
        });

        // Calculate risk score
        const riskScore = (patterns.rapidActivity * 2) + 
                         (patterns.priceManipulation * 3) + 
                         (patterns.flaggedContent * 1);

        if (riskScore > 10) {
            this.logger.security(`High risk user detected: ${userId}`, {
                riskScore,
                patterns,
                recentActivities: activities.length
            });

            // Flag for admin review
            this.flagUserForReview(userId, riskScore, patterns);
        }
    }

    calculateVariance(numbers) {
        const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
        const squaredDiffs = numbers.map(num => Math.pow(num - mean, 2));
        return squaredDiffs.reduce((a, b) => a + b, 0) / numbers.length;
    }

    async flagUserForReview(userId, riskScore, patterns) {
        try {
            // Store flag in database
            await this.db.run(`
                INSERT OR REPLACE INTO user_flags (user_id, risk_score, patterns, flagged_at, status)
                VALUES (?, ?, ?, ?, ?)
            `, [userId, riskScore, JSON.stringify(patterns), new Date().toISOString(), 'flagged']);

            this.logger.security(`User ${userId} flagged for admin review`, {
                riskScore,
                patterns
            });

        } catch (error) {
            // Create the table if it doesn't exist
            await this.createUserFlagsTable();
            // Try again
            await this.flagUserForReview(userId, riskScore, patterns);
        }
    }

    async createUserFlagsTable() {
        try {
            await this.db.run(`
                CREATE TABLE IF NOT EXISTS user_flags (
                    user_id TEXT PRIMARY KEY,
                    risk_score INTEGER NOT NULL,
                    patterns TEXT,
                    flagged_at TEXT NOT NULL,
                    status TEXT DEFAULT 'flagged',
                    reviewed_by TEXT,
                    reviewed_at TEXT
                )
            `);
        } catch (error) {
            this.logger.error('Error creating user_flags table:', error);
        }
    }

    async validateTransaction(transactionId, buyerId, sellerId) {
        try {
            const validation = {
                passed: true,
                flags: [],
                reason: ''
            };

            // Check if users are valid
            if (buyerId === sellerId) {
                validation.passed = false;
                validation.reason = 'Buyer and seller cannot be the same user';
                return validation;
            }

            // Check for flagged users
            const buyerFlags = await this.getUserFlags(buyerId);
            const sellerFlags = await this.getUserFlags(sellerId);

            if (buyerFlags.status === 'banned') {
                validation.passed = false;
                validation.reason = 'Buyer account is banned';
                return validation;
            }

            if (sellerFlags.status === 'banned') {
                validation.passed = false;
                validation.reason = 'Seller account is banned';
                return validation;
            }

            if (buyerFlags.status === 'flagged') {
                validation.flags.push('BUYER_FLAGGED');
            }

            if (sellerFlags.status === 'flagged') {
                validation.flags.push('SELLER_FLAGGED');
            }

            // Log transaction security check
            this.logger.security(`Transaction security check ${transactionId}`, {
                buyerId,
                sellerId,
                flags: validation.flags,
                passed: validation.passed
            });

            return validation;

        } catch (error) {
            this.logger.error('Transaction validation error:', error);
            return {
                passed: true, // Don't block legitimate transactions on errors
                flags: ['VALIDATION_ERROR']
            };
        }
    }

    async getUserFlags(userId) {
        try {
            const flags = await this.db.get(`
                SELECT * FROM user_flags WHERE user_id = ?
            `, [userId]);

            return flags || { status: 'clean' };

        } catch (error) {
            return { status: 'clean' };
        }
    }

    async banUser(userId, reason, adminId) {
        try {
            await this.db.run(`
                INSERT OR REPLACE INTO user_flags (user_id, risk_score, patterns, flagged_at, status, reviewed_by, reviewed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [userId, 999, JSON.stringify({ banned: true, reason }), new Date().toISOString(), 'banned', adminId, new Date().toISOString()]);

            this.logger.security(`User ${userId} banned by ${adminId}`, { reason });

            return { success: true };

        } catch (error) {
            this.logger.error('Error banning user:', error);
            return { success: false, error: error.message };
        }
    }

    async unbanUser(userId, adminId) {
        try {
            await this.db.run(`
                UPDATE user_flags SET status = 'clean', reviewed_by = ?, reviewed_at = ?
                WHERE user_id = ?
            `, [adminId, new Date().toISOString(), userId]);

            this.logger.security(`User ${userId} unbanned by ${adminId}`);

            return { success: true };

        } catch (error) {
            this.logger.error('Error unbanning user:', error);
            return { success: false, error: error.message };
        }
    }

    async getSecurityReport(days = 7) {
        try {
            const dateLimit = new Date();
            dateLimit.setDate(dateLimit.getDate() - days);

            const flaggedUsers = await this.db.all(`
                SELECT * FROM user_flags 
                WHERE flagged_at >= ?
                ORDER BY risk_score DESC
            `, [dateLimit.toISOString()]);

            const totalUsers = await this.db.get(`
                SELECT COUNT(DISTINCT user_id) as count FROM user_metrics
            `);

            return {
                period: `${days} days`,
                flaggedUsers: flaggedUsers.length,
                totalUsers: totalUsers.count,
                flaggedPercentage: ((flaggedUsers.length / totalUsers.count) * 100).toFixed(2),
                highRiskUsers: flaggedUsers.filter(u => u.risk_score >= 15).length,
                bannedUsers: flaggedUsers.filter(u => u.status === 'banned').length,
                generatedAt: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('Error generating security report:', error);
            return null;
        }
    }

    // Cleanup old rate limit data
    cleanup() {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);

        // Clean rate limits
        for (const [userId, activities] of this.rateLimits.entries()) {
            const recentActivities = activities.filter(timestamp => timestamp > oneHourAgo);
            if (recentActivities.length === 0) {
                this.rateLimits.delete(userId);
            } else {
                this.rateLimits.set(userId, recentActivities);
            }
        }

        // Clean suspicious activity tracking
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        for (const [userId, activities] of this.suspiciousActivity.entries()) {
            const recentActivities = activities.filter(activity => activity.timestamp > oneDayAgo);
            if (recentActivities.length === 0) {
                this.suspiciousActivity.delete(userId);
            } else {
                this.suspiciousActivity.set(userId, recentActivities);
            }
        }
    }
}

module.exports = SecurityService;
