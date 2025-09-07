const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');

class ScheduledTasks {
    constructor(client, database, logger) {
        this.client = client;
        this.db = database;
        this.logger = logger;
        this.tasks = [];
    }

    start() {
        this.logger.info('🔄 Starting scheduled tasks...');

        // Transaction reminders - every 2 hours
        const reminderTask = cron.schedule('0 */2 * * *', () => {
            this.sendTransactionReminders();
        }, { scheduled: false });

        // Low stock alerts - every 6 hours
        const lowStockTask = cron.schedule('0 */6 * * *', () => {
            this.sendLowStockAlerts();
        }, { scheduled: false });

        // Daily analytics update - every day at midnight
        const analyticsTask = cron.schedule('0 0 * * *', () => {
            this.updateDailyAnalytics();
        }, { scheduled: false });

        // Weekly cleanup - every Sunday at 2 AM
        const cleanupTask = cron.schedule('0 2 * * 0', () => {
            this.performWeeklyCleanup();
        }, { scheduled: false });

        // Price trend analysis - every day at 6 AM
        const trendTask = cron.schedule('0 6 * * *', () => {
            this.analyzePriceTrends();
        }, { scheduled: false });

        // Expired listing cleanup - every 4 hours
        const expiredTask = cron.schedule('0 */4 * * *', () => {
            this.cleanupExpiredListings();
        }, { scheduled: false });

        // Start all tasks
        reminderTask.start();
        lowStockTask.start();
        analyticsTask.start();
        cleanupTask.start();
        trendTask.start();
        expiredTask.start();

        this.tasks = [reminderTask, lowStockTask, analyticsTask, cleanupTask, trendTask, expiredTask];
        this.logger.info('✅ All scheduled tasks started');
    }

    stop() {
        this.logger.info('🛑 Stopping scheduled tasks...');
        this.tasks.forEach(task => {
            if (task) {
                task.stop();
            }
        });
        this.tasks = [];
        this.logger.info('✅ All scheduled tasks stopped');
    }

    async sendTransactionReminders() {
        try {
            this.logger.info('📧 Sending transaction reminders...');

            const pendingTransactions = await this.db.getPendingTransactions();
            let remindersSent = 0;

            for (const transaction of pendingTransactions) {
                const hoursSinceCreated = (Date.now() - new Date(transaction.created_at).getTime()) / (1000 * 60 * 60);
                
                // Send reminder if transaction is older than 24 hours and hasn't had too many reminders
                if (hoursSinceCreated >= 24 && (transaction.reminders_sent || 0) < 3) {
                    await this.sendTransactionReminder(transaction);
                    
                    // Update reminder count
                    await this.db.updateTransaction(transaction.id, {
                        reminders_sent: (transaction.reminders_sent || 0) + 1
                    });

                    remindersSent++;

                    // Add delay between reminders to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (remindersSent > 0) {
                this.logger.info(`📧 Sent ${remindersSent} transaction reminders`);
            }

        } catch (error) {
            this.logger.error('Error sending transaction reminders:', error);
        }
    }

    async sendTransactionReminder(transaction) {
        try {
            const thread = this.client.channels.cache.get(transaction.thread_id);
            if (!thread) return;

            const hoursPending = Math.floor((Date.now() - new Date(transaction.created_at).getTime()) / (1000 * 60 * 60));

            const embed = new EmbedBuilder()
                .setTitle('⏰ Transaction Reminder')
                .setDescription(`This transaction has been pending for ${hoursPending} hours.`)
                .addFields(
                    { name: '📦 Item', value: transaction.item_name, inline: true },
                    { name: '💰 Amount', value: `$${transaction.price}`, inline: true },
                    { name: '📋 Status', value: transaction.status.replace('_', ' '), inline: true }
                )
                .setColor(0xFFA500)
                .setTimestamp()
                .setFooter({ text: 'Please complete this transaction or open a dispute if needed' });

            let reminderMessage = '';
            if (transaction.status === 'pending_payment') {
                reminderMessage = `<@${transaction.buyer_id}> Please confirm your payment to proceed with the transaction.`;
            } else if (transaction.status === 'pending_delivery') {
                reminderMessage = `<@${transaction.seller_id}> Please deliver the item to complete this transaction.`;
            } else {
                reminderMessage = `<@${transaction.buyer_id}> <@${transaction.seller_id}> This transaction needs attention.`;
            }

            await thread.send({ content: reminderMessage, embeds: [embed] });

        } catch (error) {
            this.logger.warn(`Could not send reminder for transaction ${transaction.id}:`, error);
        }
    }

    async sendLowStockAlerts() {
        try {
            this.logger.info('📉 Checking for low stock items...');

            const lowStockListings = await this.db.all(`
                SELECT * FROM listings 
                WHERE status = 'active' AND quantity <= 3 AND quantity > 0
                ORDER BY quantity ASC
            `);

            let alertsSent = 0;

            for (const listing of lowStockListings) {
                // Alert seller
                await this.sendLowStockAlertToSeller(listing);
                
                // Alert category followers
                await this.alertCategoryFollowers(listing);

                alertsSent++;

                // Rate limit prevention
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            if (alertsSent > 0) {
                this.logger.info(`📉 Sent ${alertsSent} low stock alerts`);
            }

        } catch (error) {
            this.logger.error('Error sending low stock alerts:', error);
        }
    }

    async sendLowStockAlertToSeller(listing) {
        try {
            const seller = await this.client.users.fetch(listing.seller_id);

            const embed = new EmbedBuilder()
                .setTitle('📉 Low Stock Alert')
                .setDescription(`Your listing **${listing.item_name}** is running low on stock!`)
                .addFields(
                    { name: '📊 Current Stock', value: listing.quantity.toString(), inline: true },
                    { name: '💰 Price', value: `$${listing.price}`, inline: true },
                    { name: '👁️ Views', value: listing.views.toString(), inline: true },
                    { name: '💡 Suggestion', value: 'Consider restocking or adjusting your price if demand is high', inline: false }
                )
                .setColor(0xFF6B6B)
                .setTimestamp();

            await seller.send({ embeds: [embed] });

        } catch (error) {
            this.logger.warn(`Could not send low stock alert to seller ${listing.seller_id}`);
        }
    }

    async alertCategoryFollowers(listing) {
        try {
            // Get followers of this category
            const followers = await this.db.all(`
                SELECT DISTINCT user_id FROM followers 
                WHERE target_type = 'category' AND target_id = ?
            `, [listing.category]);

            if (followers.length === 0) return;

            const embed = new EmbedBuilder()
                .setTitle('🔥 Low Stock Alert!')
                .setDescription(`**${listing.item_name}** is running low on stock!`)
                .addFields(
                    { name: '📊 Stock Left', value: `Only ${listing.quantity} remaining`, inline: true },
                    { name: '💰 Price', value: `$${listing.price}`, inline: true },
                    { name: '🛒 Action', value: 'Buy now before it sells out!', inline: false }
                )
                .setColor(0xFF4757)
                .setTimestamp();

            // Notify followers (max 10 to avoid spam)
            const followersToNotify = followers.slice(0, 10);
            
            for (const follower of followersToNotify) {
                try {
                    const user = await this.client.users.fetch(follower.user_id);
                    await user.send({ embeds: [embed] });
                    await new Promise(resolve => setTimeout(resolve, 200));
                } catch (error) {
                    // User might have DMs disabled or left the server
                    continue;
                }
            }

        } catch (error) {
            this.logger.warn('Error alerting category followers:', error);
        }
    }

    async updateDailyAnalytics() {
        try {
            this.logger.info('📊 Updating daily analytics...');

            await this.db.updateDailyStats();

            // Generate daily insights for admins
            await this.generateDailyInsights();

            this.logger.info('✅ Daily analytics updated');

        } catch (error) {
            this.logger.error('Error updating daily analytics:', error);
        }
    }

    async generateDailyInsights() {
        try {
            const today = new Date().toISOString().split('T')[0];
            const stats = await this.db.get(`
                SELECT * FROM daily_stats WHERE date = ?
            `, [today]);

            if (!stats) return;

            // Get top categories for today
            const topCategories = await this.db.all(`
                SELECT 
                    l.category,
                    COUNT(t.id) as sales,
                    SUM(t.price) as revenue
                FROM transactions t
                JOIN listings l ON t.listing_id = l.id
                WHERE DATE(t.created_at) = ? AND t.status = 'completed'
                GROUP BY l.category
                ORDER BY sales DESC
                LIMIT 3
            `, [today]);

            const insights = {
                date: today,
                stats: stats,
                topCategories: topCategories,
                generatedAt: new Date().toISOString()
            };

            // Store insights for later use
            await this.db.setGuildConfig('global', `daily_insights_${today}`, insights);

        } catch (error) {
            this.logger.error('Error generating daily insights:', error);
        }
    }

    async performWeeklyCleanup() {
        try {
            this.logger.info('🧹 Performing weekly cleanup...');

            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            // Cleanup old sold listings
            const deletedListings = await this.db.run(`
                DELETE FROM listings 
                WHERE status IN ('sold_out', 'expired', 'rejected') 
                AND created_at < ?
            `, [oneWeekAgo.toISOString()]);

            // Cleanup old completed transactions (keep for 30 days)
            const deletedTransactions = await this.db.run(`
                DELETE FROM transactions 
                WHERE status = 'completed' 
                AND completed_at < ?
            `, [thirtyDaysAgo.toISOString()]);

            // Cleanup old price history (keep last 1000 entries per item)
            await this.db.run(`
                DELETE FROM price_history 
                WHERE id NOT IN (
                    SELECT id FROM (
                        SELECT id, ROW_NUMBER() OVER (
                            PARTITION BY item_name, category 
                            ORDER BY created_at DESC
                        ) as rn
                        FROM price_history
                    ) t WHERE t.rn <= 1000
                )
            `);

            // Cleanup old daily stats (keep last 90 days)
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            
            await this.db.run(`
                DELETE FROM daily_stats 
                WHERE date < ?
            `, [ninetyDaysAgo.toISOString().split('T')[0]]);

            this.logger.info(`🧹 Weekly cleanup completed - Deleted ${deletedListings.changes || 0} listings, ${deletedTransactions.changes || 0} transactions`);

        } catch (error) {
            this.logger.error('Error performing weekly cleanup:', error);
        }
    }

    async analyzePriceTrends() {
        try {
            this.logger.info('📈 Analyzing price trends...');

            const categories = ['roblox', 'skins', 'currency', 'rare', 'other'];
            
            for (const category of categories) {
                await this.analyzeCategoryTrends(category);
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            this.logger.info('✅ Price trend analysis completed');

        } catch (error) {
            this.logger.error('Error analyzing price trends:', error);
        }
    }

    async analyzeCategoryTrends(category) {
        try {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const trends = await this.db.all(`
                SELECT 
                    item_name,
                    AVG(price) as avg_price,
                    COUNT(*) as price_points,
                    MIN(created_at) as first_seen,
                    MAX(created_at) as last_seen
                FROM price_history 
                WHERE category = ? AND created_at >= ?
                GROUP BY item_name
                HAVING COUNT(*) >= 3
                ORDER BY price_points DESC
                LIMIT 10
            `, [category, sevenDaysAgo.toISOString()]);

            if (trends.length > 0) {
                const trendData = {
                    category: category,
                    trends: trends,
                    analyzedAt: new Date().toISOString()
                };

                await this.db.setGuildConfig('global', `price_trends_${category}`, trendData);
            }

        } catch (error) {
            this.logger.error(`Error analyzing trends for category ${category}:`, error);
        }
    }

    async cleanupExpiredListings() {
        try {
            this.logger.info('🕐 Cleaning up expired listings...');

            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            // Mark very old pending listings as expired
            const expiredListings = await this.db.run(`
                UPDATE listings 
                SET status = 'expired' 
                WHERE status = 'pending_approval' 
                AND created_at < ?
            `, [thirtyDaysAgo.toISOString()]);

            // Mark old sold out listings for cleanup
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const soldOutListings = await this.db.run(`
                UPDATE listings 
                SET status = 'archived' 
                WHERE status = 'sold_out' 
                AND updated_at < ?
            `, [sevenDaysAgo.toISOString()]);

            if (expiredListings.changes > 0 || soldOutListings.changes > 0) {
                this.logger.info(`🕐 Expired ${expiredListings.changes || 0} old listings, archived ${soldOutListings.changes || 0} sold items`);
            }

        } catch (error) {
            this.logger.error('Error cleaning up expired listings:', error);
        }
    }

    async getTaskStatus() {
        return {
            totalTasks: this.tasks.length,
            activeTasks: this.tasks.filter(task => task && !task.destroyed).length,
            status: this.tasks.length > 0 ? 'running' : 'stopped',
            lastUpdate: new Date().toISOString()
        };
    }

    // Manual task triggers for testing/admin use
    async triggerTransactionReminders() {
        this.logger.info('🔧 Manually triggering transaction reminders...');
        await this.sendTransactionReminders();
    }

    async triggerLowStockAlerts() {
        this.logger.info('🔧 Manually triggering low stock alerts...');
        await this.sendLowStockAlerts();
    }

    async triggerAnalyticsUpdate() {
        this.logger.info('🔧 Manually triggering analytics update...');
        await this.updateDailyAnalytics();
    }

    async triggerCleanup() {
        this.logger.info('🔧 Manually triggering cleanup...');
        await this.performWeeklyCleanup();
    }
}

module.exports = ScheduledTasks;
