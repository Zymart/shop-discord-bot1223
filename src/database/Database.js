const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor() {
        this.dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/shopbot.db');
        this.db = null;
        
        // Ensure data directory exists
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    async initialize() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log('📊 Connected to SQLite database');
                    this.createTables().then(resolve).catch(reject);
                }
            });
        });
    }

    async createTables() {
        const tables = [
            // Listings table
            `CREATE TABLE IF NOT EXISTS listings (
                id TEXT PRIMARY KEY,
                seller_id TEXT NOT NULL,
                seller_tag TEXT NOT NULL,
                item_name TEXT NOT NULL,
                category TEXT NOT NULL,
                tags TEXT,
                price REAL NOT NULL,
                quantity INTEGER NOT NULL,
                original_quantity INTEGER NOT NULL,
                description TEXT,
                delivery_time TEXT,
                status TEXT DEFAULT 'pending_approval',
                created_at TEXT NOT NULL,
                updated_at TEXT,
                views INTEGER DEFAULT 0,
                channel_id TEXT,
                message_id TEXT,
                price_analysis TEXT,
                auto_detected TEXT
            )`,

            // Transactions table
            `CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                listing_id TEXT NOT NULL,
                buyer_id TEXT NOT NULL,
                buyer_tag TEXT NOT NULL,
                seller_id TEXT NOT NULL,
                seller_tag TEXT NOT NULL,
                item_name TEXT NOT NULL,
                price REAL NOT NULL,
                status TEXT DEFAULT 'pending_payment',
                escrow_stage TEXT DEFAULT 'awaiting_payment',
                created_at TEXT NOT NULL,
                completed_at TEXT,
                thread_id TEXT,
                reminders_sent INTEGER DEFAULT 0,
                proof_submitted BOOLEAN DEFAULT FALSE,
                requires_proof BOOLEAN DEFAULT FALSE,
                proof_data TEXT,
                disputed_at TEXT,
                disputed_by TEXT,
                FOREIGN KEY (listing_id) REFERENCES listings (id)
            )`,

            // User ratings table
            `CREATE TABLE IF NOT EXISTS user_ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                rating INTEGER NOT NULL,
                transaction_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (transaction_id) REFERENCES transactions (id)
            )`,

            // User metrics table
            `CREATE TABLE IF NOT EXISTS user_metrics (
                user_id TEXT PRIMARY KEY,
                total_sales INTEGER DEFAULT 0,
                total_revenue REAL DEFAULT 0,
                total_purchases INTEGER DEFAULT 0,
                total_spent REAL DEFAULT 0,
                first_sale TEXT,
                last_activity TEXT,
                flags TEXT,
                badges TEXT
            )`,

            // Wishlists table
            `CREATE TABLE IF NOT EXISTS wishlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                item_name TEXT NOT NULL,
                max_price REAL,
                keywords TEXT,
                added_at TEXT NOT NULL
            )`,

            // Followers table
            `CREATE TABLE IF NOT EXISTS followers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                target_type TEXT NOT NULL, -- 'listing', 'category', 'seller'
                target_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            )`,

            // Reports table
            `CREATE TABLE IF NOT EXISTS reports (
                id TEXT PRIMARY KEY,
                listing_id TEXT,
                reporter_id TEXT NOT NULL,
                reporter_tag TEXT NOT NULL,
                reason TEXT NOT NULL,
                details TEXT,
                status TEXT DEFAULT 'open',
                created_at TEXT NOT NULL,
                resolved_at TEXT,
                resolved_by TEXT
            )`,

            // Disputes table
            `CREATE TABLE IF NOT EXISTS disputes (
                id TEXT PRIMARY KEY,
                transaction_id TEXT NOT NULL,
                item_name TEXT NOT NULL,
                buyer_id TEXT NOT NULL,
                seller_id TEXT NOT NULL,
                disputed_by TEXT NOT NULL,
                reason TEXT,
                priority TEXT DEFAULT 'normal',
                status TEXT DEFAULT 'open',
                created_at TEXT NOT NULL,
                resolved_at TEXT,
                resolved_by TEXT,
                resolution TEXT,
                FOREIGN KEY (transaction_id) REFERENCES transactions (id)
            )`,

            // Analytics tables
            `CREATE TABLE IF NOT EXISTS daily_stats (
                date TEXT PRIMARY KEY,
                sales INTEGER DEFAULT 0,
                revenue REAL DEFAULT 0,
                unique_buyers INTEGER DEFAULT 0,
                unique_sellers INTEGER DEFAULT 0,
                new_listings INTEGER DEFAULT 0
            )`,

            `CREATE TABLE IF NOT EXISTS price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_name TEXT NOT NULL,
                category TEXT NOT NULL,
                price REAL NOT NULL,
                created_at TEXT NOT NULL
            )`,

            // Bot configuration table
            `CREATE TABLE IF NOT EXISTS bot_config (
                guild_id TEXT NOT NULL,
                config_key TEXT NOT NULL,
                config_value TEXT,
                PRIMARY KEY (guild_id, config_key)
            )`
        ];

        for (const table of tables) {
            await this.run(table);
        }

        console.log('✅ Database tables created/verified');
    }

    // Helper methods for database operations
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // Listing operations
    async createListing(listing) {
        const sql = `INSERT INTO listings (
            id, seller_id, seller_tag, item_name, category, tags, price, 
            quantity, original_quantity, description, delivery_time, 
            status, created_at, price_analysis, auto_detected
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        
        return await this.run(sql, [
            listing.id, listing.sellerId, listing.sellerTag, listing.itemName,
            listing.category, JSON.stringify(listing.tags), listing.price,
            listing.quantity, listing.originalQuantity, listing.description,
            listing.deliveryTime, listing.status, listing.createdAt,
            listing.priceAnalysis, JSON.stringify(listing.autoDetected)
        ]);
    }

    async getListing(id) {
        const listing = await this.get('SELECT * FROM listings WHERE id = ?', [id]);
        if (listing) {
            listing.tags = JSON.parse(listing.tags || '[]');
            listing.autoDetected = JSON.parse(listing.auto_detected || '{}');
        }
        return listing;
    }

    async getActiveListings(category = null) {
        let sql = 'SELECT * FROM listings WHERE status = "active"';
        let params = [];
        
        if (category) {
            sql += ' AND category = ?';
            params.push(category);
        }
        
        sql += ' ORDER BY created_at DESC';
        
        const listings = await this.all(sql, params);
        return listings.map(listing => {
            listing.tags = JSON.parse(listing.tags || '[]');
            listing.autoDetected = JSON.parse(listing.auto_detected || '{}');
            return listing;
        });
    }

    async updateListing(id, updates) {
        const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const values = Object.values(updates);
        values.push(id);
        
        const sql = `UPDATE listings SET ${fields}, updated_at = ? WHERE id = ?`;
        values.splice(-1, 0, new Date().toISOString());
        
        return await this.run(sql, values);
    }

    async deleteListing(id) {
        return await this.run('DELETE FROM listings WHERE id = ?', [id]);
    }

    // Transaction operations
    async createTransaction(transaction) {
        const sql = `INSERT INTO transactions (
            id, listing_id, buyer_id, buyer_tag, seller_id, seller_tag,
            item_name, price, status, escrow_stage, created_at, thread_id,
            requires_proof
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        
        return await this.run(sql, [
            transaction.id, transaction.listingId, transaction.buyerId,
            transaction.buyerTag, transaction.sellerId, transaction.sellerTag,
            transaction.itemName, transaction.price, transaction.status,
            transaction.escrowStage, transaction.createdAt, transaction.threadId,
            transaction.requiresProof
        ]);
    }

    async getTransaction(id) {
        const transaction = await this.get('SELECT * FROM transactions WHERE id = ?', [id]);
        if (transaction && transaction.proof_data) {
            transaction.proof = JSON.parse(transaction.proof_data);
        }
        return transaction;
    }

    async updateTransaction(id, updates) {
        if (updates.proof) {
            updates.proof_data = JSON.stringify(updates.proof);
            delete updates.proof;
        }
        
        const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const values = Object.values(updates);
        values.push(id);
        
        const sql = `UPDATE transactions SET ${fields} WHERE id = ?`;
        return await this.run(sql, values);
    }

    async getPendingTransactions() {
        return await this.all(`
            SELECT * FROM transactions 
            WHERE status IN ('pending_payment', 'pending_delivery')
            ORDER BY created_at ASC
        `);
    }

    // User operations
    async getUserRating(userId) {
        const result = await this.get(`
            SELECT AVG(rating) as average, COUNT(*) as total 
            FROM user_ratings 
            WHERE user_id = ?
        `, [userId]);
        
        return {
            average: result?.average ? parseFloat(result.average).toFixed(1) : 0,
            total: result?.total || 0
        };
    }

    async addUserRating(userId, rating, transactionId) {
        return await this.run(`
            INSERT INTO user_ratings (user_id, rating, transaction_id, created_at)
            VALUES (?, ?, ?, ?)
        `, [userId, rating, transactionId, new Date().toISOString()]);
    }

    async getUserMetrics(userId) {
        let metrics = await this.get('SELECT * FROM user_metrics WHERE user_id = ?', [userId]);
        
        if (!metrics) {
            // Create new metrics record
            await this.run(`
                INSERT INTO user_metrics (user_id, last_activity)
                VALUES (?, ?)
            `, [userId, new Date().toISOString()]);
            
            metrics = await this.get('SELECT * FROM user_metrics WHERE user_id = ?', [userId]);
        }
        
        return metrics;
    }

    async updateUserMetrics(userId, updates) {
        const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const values = Object.values(updates);
        values.push(userId);
        
        const sql = `UPDATE user_metrics SET ${fields} WHERE user_id = ?`;
        return await this.run(sql, values);
    }

    // Analytics operations
    async updateDailyStats(date = null) {
        date = date || new Date().toISOString().split('T')[0];
        
        // Get today's stats
        const stats = await this.get(`
            SELECT 
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as sales,
                SUM(CASE WHEN status = 'completed' THEN price ELSE 0 END) as revenue,
                COUNT(DISTINCT buyer_id) as unique_buyers,
                COUNT(DISTINCT seller_id) as unique_sellers
            FROM transactions 
            WHERE DATE(created_at) = ?
        `, [date]);

        const newListings = await this.get(`
            SELECT COUNT(*) as count 
            FROM listings 
            WHERE DATE(created_at) = ?
        `, [date]);

        // Upsert daily stats
        await this.run(`
            INSERT OR REPLACE INTO daily_stats (
                date, sales, revenue, unique_buyers, unique_sellers, new_listings
            ) VALUES (?, ?, ?, ?, ?, ?)
        `, [
            date, 
            stats.sales || 0, 
            stats.revenue || 0, 
            stats.unique_buyers || 0,
            stats.unique_sellers || 0,
            newListings.count || 0
        ]);
    }

    async addPriceHistory(itemName, category, price) {
        return await this.run(`
            INSERT INTO price_history (item_name, category, price, created_at)
            VALUES (?, ?, ?, ?)
        `, [itemName, category, price, new Date().toISOString()]);
    }

    async getPriceHistory(itemName, category = null, limit = 50) {
        let sql = 'SELECT * FROM price_history WHERE LOWER(item_name) LIKE ?';
        let params = [`%${itemName.toLowerCase()}%`];
        
        if (category) {
            sql += ' AND category = ?';
            params.push(category);
        }
        
        sql += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);
        
        return await this.all(sql, params);
    }

    // Configuration operations
    async setGuildConfig(guildId, key, value) {
        return await this.run(`
            INSERT OR REPLACE INTO bot_config (guild_id, config_key, config_value)
            VALUES (?, ?, ?)
        `, [guildId, key, JSON.stringify(value)]);
    }

    async getGuildConfig(guildId, key) {
        const result = await this.get(`
            SELECT config_value FROM bot_config 
            WHERE guild_id = ? AND config_key = ?
        `, [guildId, key]);
        
        return result ? JSON.parse(result.config_value) : null;
    }

    async getAllGuildConfig(guildId) {
        const results = await this.all(`
            SELECT config_key, config_value FROM bot_config 
            WHERE guild_id = ?
        `, [guildId]);
        
        const config = {};
        results.forEach(row => {
            config[row.config_key] = JSON.parse(row.config_value);
        });
        
        return config;
    }

    // Search operations
    async searchListings(query, filters = {}) {
        let sql = `
            SELECT l.*, ur.rating_avg, ur.rating_count 
            FROM listings l
            LEFT JOIN (
                SELECT user_id, AVG(rating) as rating_avg, COUNT(*) as rating_count
                FROM user_ratings GROUP BY user_id
            ) ur ON l.seller_id = ur.user_id
            WHERE l.status = 'active'
        `;
        let params = [];

        // Text search
        if (query) {
            sql += ` AND (LOWER(l.item_name) LIKE ? OR LOWER(l.description) LIKE ? OR l.tags LIKE ?)`;
            const searchTerm = `%${query.toLowerCase()}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }

        // Filters
        if (filters.category) {
            sql += ` AND l.category = ?`;
            params.push(filters.category);
        }

        if (filters.minPrice) {
            sql += ` AND l.price >= ?`;
            params.push(filters.minPrice);
        }

        if (filters.maxPrice) {
            sql += ` AND l.price <= ?`;
            params.push(filters.maxPrice);
        }

        if (filters.minRating) {
            sql += ` AND ur.rating_avg >= ?`;
            params.push(filters.minRating);
        }

        sql += ` ORDER BY l.views DESC, l.created_at DESC LIMIT 50`;

        const results = await this.all(sql, params);
        return results.map(listing => {
            listing.tags = JSON.parse(listing.tags || '[]');
            return listing;
        });
    }

    async close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) console.error('Error closing database:', err);
                    else console.log('📊 Database connection closed');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = Database;
