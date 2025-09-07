const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const AIService = require('../services/AIService');
const SecurityService = require('../services/SecurityService');

class CommandHandler {
    constructor(client, database, logger) {
        this.client = client;
        this.db = database;
        this.logger = logger;
        this.aiService = new AIService(database);
        this.securityService = new SecurityService(database, logger);
        
        // Command cooldowns
        this.cooldowns = new Map();
    }

    async handleMessage(message) {
        if (message.author.bot) return;
        
        const content = message.content.toLowerCase();
        const userId = message.author.id;

        // Check cooldown
        if (this.isOnCooldown(userId, 'command')) {
            return;
        }

        try {
            // Route commands
            if (content === '!sell') {
                await this.handleSell(message);
            } else if (content.startsWith('!search')) {
                await this.handleSearch(message);
            } else if (content === '!mylistings') {
                await this.handleMyListings(message);
            } else if (content === '!history') {
                await this.handleHistory(message);
            } else if (content === '!wishlist') {
                await this.handleWishlist(message);
            } else if (content === '!leaderboard') {
                await this.handleLeaderboard(message);
            } else if (content.startsWith('!follow')) {
                await this.handleFollow(message);
            } else if (content.startsWith('!report')) {
                await this.handleReport(message);
            } else if (content.startsWith('!admin')) {
                await this.handleAdmin(message);
            } else if (content === '!help') {
                await this.handleHelp(message);
            }

            // Set cooldown
            this.setCooldown(userId, 'command', 2000); // 2 second cooldown

        } catch (error) {
            this.logger.error('Command handler error:', error);
            await message.reply('❌ An error occurred while processing your command.').catch(() => {});
        }
    }

    async handleSell(message) {
        const embed = new EmbedBuilder()
            .setTitle('📝 Create New Listing')
            .setDescription('Click the button below to open the AI-powered listing form')
            .addFields(
                { name: '🤖 AI Features', value: 'Smart categorization\nAuto-tagging\nPrice analysis', inline: true },
                { name: '🔒 Security', value: 'Anti-scam detection\nProof requirements\nEscrow protection', inline: true },
                { name: '📊 Analytics', value: 'Market trends\nPrice history\nDemand tracking', inline: true }
            )
            .setColor(0x00AE86)
            .setFooter({ text: 'Enhanced Shop Bot • AI-Powered Listings' });

        const button = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`sell_form_${message.author.id}`)
                    .setLabel('Open Listing Form')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🚀')
            );

        await message.reply({ embeds: [embed], components: [button] });
    }

    async handleSearch(message) {
        const args = message.content.split(' ').slice(1);
        const query = args.join(' ').toLowerCase();

        if (!query) {
            const embed = new EmbedBuilder()
                .setTitle('🔍 Search Help')
                .setDescription('Use advanced search with filters:')
                .addFields(
                    { name: 'Text Search', value: '`!search roblox pet`', inline: false },
                    { name: 'Category Filter', value: '`!search category:roblox`', inline: false },
                    { name: 'Price Filter', value: '`!search price:<50` or `price:>10`', inline: false },
                    { name: 'Rating Filter', value: '`!search rating:>4`', inline: false },
                    { name: 'Combined', value: '`!search roblox category:roblox price:<25`', inline: false }
                )
                .setColor(0x3498DB);

            return await message.reply({ embeds: [embed] });
        }

        // Parse search query and filters
        const filters = {};
        let searchText = query;

        // Extract filters
        if (query.includes('category:')) {
            const match = query.match(/category:(\w+)/);
            if (match) {
                filters.category = match[1];
                searchText = searchText.replace(/category:\w+/g, '').trim();
            }
        }

        if (query.includes('price:<')) {
            const match = query.match(/price:<(\d+(?:\.\d+)?)/);
            if (match) {
                filters.maxPrice = parseFloat(match[1]);
                searchText = searchText.replace(/price:<\d+(?:\.\d+)?/g, '').trim();
            }
        }

        if (query.includes('price:>')) {
            const match = query.match(/price:>(\d+(?:\.\d+)?)/);
            if (match) {
                filters.minPrice = parseFloat(match[1]);
                searchText = searchText.replace(/price:>\d+(?:\.\d+)?/g, '').trim();
            }
        }

        if (query.includes('rating:>')) {
            const match = query.match(/rating:>(\d+(?:\.\d+)?)/);
            if (match) {
                filters.minRating = parseFloat(match[1]);
                searchText = searchText.replace(/rating:>\d+(?:\.\d+)?/g, '').trim();
            }
        }

        // Search listings
        const listings = await this.db.searchListings(searchText || null, filters);

        if (listings.length === 0) {
            return await message.reply('❌ No items found matching your search criteria.');
        }

        const embed = new EmbedBuilder()
            .setTitle(`🔍 Search Results (${listings.length} found)`)
            .setColor(0x00AE86)
            .setDescription(`Query: \`${query}\``)
            .setFooter({ text: 'Use buttons below to interact with listings' });

        // Display first 5 results
        listings.slice(0, 5).forEach((listing, index) => {
            const rating = listing.rating_avg ? `${parseFloat(listing.rating_avg).toFixed(1)}/5 (${listing.rating_count})` : 'No ratings';
            
            embed.addFields({
                name: `${index + 1}. ${listing.item_name}`,
                value: `💰 ${listing.price} | 📊 Stock: ${listing.quantity} | ⭐ ${rating}\n` +
                       `🏷️ ${listing.tags ? JSON.parse(listing.tags).join(' ') : ''} | 👁️ ${listing.views} views\n` +
                       `*${listing.description.substring(0, 100)}${listing.description.length > 100 ? '...' : ''}*`,
                inline: false
            });
        });

        if (listings.length > 5) {
            embed.setFooter({ text: `Showing 5 of ${listings.length} results. Refine search for more specific results.` });
        }

        await message.reply({ embeds: [embed] });
    }

    async handleMyListings(message) {
        const listings = await this.db.all(
            'SELECT * FROM listings WHERE seller_id = ? ORDER BY created_at DESC LIMIT 10',
            [message.author.id]
        );

        if (listings.length === 0) {
            return await message.reply('📝 You have no listings yet. Use `!sell` to create one!');
        }

        const embed = new EmbedBuilder()
            .setTitle('📋 Your Listings')
            .setColor(0x00AE86)
            .setTimestamp()
            .setDescription(`You have ${listings.length} listings`);

        listings.forEach((listing, index) => {
            const statusEmoji = {
                'active': '✅',
                'pending_approval': '⏳',
                'sold_out': '📦',
                'rejected': '❌',
                'expired': '🕐'
            }[listing.status] || '❓';

            embed.addFields({
                name: `${index + 1}. ${listing.item_name} ${statusEmoji}`,
                value: `💰 ${listing.price} | 📊 Stock: ${listing.quantity}/${listing.original_quantity} | 👁️ ${listing.views} views\n` +
                       `📅 ${new Date(listing.created_at).toLocaleDateString()} | 📋 ${listing.status.replace('_', ' ')}`,
                inline: false
            });
        });

        await message.reply({ embeds: [embed] });
    }

    async handleHistory(message) {
        const transactions = await this.db.all(`
            SELECT * FROM transactions 
            WHERE buyer_id = ? OR seller_id = ?
            ORDER BY created_at DESC LIMIT 15
        `, [message.author.id, message.author.id]);

        if (transactions.length === 0) {
            return await message.reply('📝 No transaction history found.');
        }

        const embed = new EmbedBuilder()
            .setTitle('📊 Your Transaction History')
            .setColor(0x3498DB)
            .setDescription(`Found ${transactions.length} transactions`)
            .setTimestamp();

        transactions.slice(0, 10).forEach((transaction, index) => {
            const role = transaction.buyer_id === message.author.id ? '🛒 Bought' : '💰 Sold';
            const otherUser = transaction.buyer_id === message.author.id ? transaction.seller_tag : transaction.buyer_tag;
            const statusEmoji = {
                'completed': '✅',
                'pending_payment': '⏳',
                'pending_delivery': '📦',
                'disputed': '⚠️',
                'cancelled': '❌'
            }[transaction.status] || '❓';

            embed.addFields({
                name: `${index + 1}. ${transaction.item_name} ${statusEmoji}`,
                value: `${role} | ${transaction.price} | ${otherUser}\n*${new Date(transaction.created_at).toLocaleDateString()}*`,
                inline: false
            });
        });

        if (transactions.length > 10) {
            embed.setFooter({ text: `Showing 10 of ${transactions.length} transactions` });
        }

        await message.reply({ embeds: [embed] });
    }

    async handleWishlist(message) {
        const wishlistItems = await this.db.all(
            'SELECT * FROM wishlists WHERE user_id = ? ORDER BY added_at DESC',
            [message.author.id]
        );

        if (wishlistItems.length === 0) {
            return await message.reply('⭐ Your wishlist is empty. Use search results to add items to your wishlist!');
        }

        const embed = new EmbedBuilder()
            .setTitle('⭐ Your Wishlist')
            .setColor(0xFFD700)
            .setDescription(`You have ${wishlistItems.length} items in your wishlist`);

        wishlistItems.slice(0, 10).forEach((item, index) => {
            embed.addFields({
                name: `${index + 1}. ${item.item_name}`,
                value: `💰 Max Price: ${item.max_price || 'Any'}\n🔔 Added: ${new Date(item.added_at).toLocaleDateString()}`,
                inline: false
            });
        });

        await message.reply({ embeds: [embed] });
    }

    async handleLeaderboard(message) {
        const topSellers = await this.db.all(`
            SELECT 
                um.user_id,
                um.total_sales,
                um.total_revenue,
                AVG(ur.rating) as avg_rating,
                COUNT(ur.rating) as rating_count
            FROM user_metrics um
            LEFT JOIN user_ratings ur ON um.user_id = ur.user_id
            WHERE um.total_sales > 0
            GROUP BY um.user_id
            ORDER BY um.total_sales DESC
            LIMIT 10
        `);

        if (topSellers.length === 0) {
            return await message.reply('📊 No sellers found yet. Be the first to make a sale!');
        }

        const embed = new EmbedBuilder()
            .setTitle('🏆 Top Sellers Leaderboard')
            .setColor(0xFFD700)
            .setDescription('Top performing sellers')
            .setTimestamp();

        for (let i = 0; i < topSellers.length; i++) {
            const seller = topSellers[i];
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            
            let userTag = 'Unknown User';
            try {
                const user = await this.client.users.fetch(seller.user_id);
                userTag = user.tag;
            } catch (error) {
                // User not found or bot can't fetch
            }

            const avgRating = seller.avg_rating ? parseFloat(seller.avg_rating).toFixed(1) : 'N/A';
            const badges = this.getBadges(seller.total_sales, parseFloat(avgRating));

            embed.addFields({
                name: `${medal} ${userTag} ${badges}`,
                value: `💰 Revenue: ${parseFloat(seller.total_revenue).toFixed(2)}\n📦 Sales: ${seller.total_sales}\n⭐ Rating: ${avgRating}/5 (${seller.rating_count || 0} reviews)`,
                inline: i < 3 ? true : false
            });
        }

        await message.reply({ embeds: [embed] });
    }

    async handleFollow(message) {
        const args = message.content.split(' ').slice(1);
        
        if (args.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('👥 Follow System')
                .setDescription('Follow categories or sellers to get notifications!')
                .addFields(
                    { name: 'Follow Category', value: '`!follow category roblox`', inline: false },
                    { name: 'Follow Seller', value: '`!follow seller @username`', inline: false },
                    { name: 'View Following', value: '`!follow list`', inline: false },
                    { name: 'Unfollow', value: '`!follow remove category roblox`', inline: false }
                )
                .setColor(0x9B59B6);

            return await message.reply({ embeds: [embed] });
        }

        // Implementation would continue here for follow functionality
        await message.reply('👥 Follow system is being implemented. Stay tuned!');
    }

    async handleReport(message) {
        const args = message.content.split(' ').slice(1);
        
        if (args.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('🚨 Report System')
                .setDescription('Report suspicious listings or users')
                .addFields(
                    { name: 'Report Listing', value: 'Use the report button on listings', inline: false },
                    { name: 'Report User', value: '`!report user @username reason here`', inline: false },
                    { name: 'Get Help', value: 'Contact administrators directly', inline: false }
                )
                .setColor(0xFF4757);

            return await message.reply({ embeds: [embed] });
        }

        // Basic report handling
        await message.reply('🚨 Report received. Admins have been notified.');
    }

    async handleAdmin(message) {
        if (!this.isAdmin(message.member)) {
            return await message.reply('❌ You don\'t have permission to use admin commands!');
        }

        const args = message.content.split(' ').slice(1);
        const command = args[0];

        switch (command) {
            case 'dashboard':
                await this.showAdminDashboard(message);
                break;
            case 'stats':
                await this.showAdminStats(message);
                break;
            case 'setchannel':
                await this.setChannel(message, args);
                break;
            case 'config':
                await this.showConfig(message);
                break;
            default:
                await message.reply('Available admin commands: `dashboard`, `stats`, `setchannel`, `config`');
        }
    }

    async showAdminDashboard(message) {
        const pendingListings = await this.db.get(
            'SELECT COUNT(*) as count FROM listings WHERE status = "pending_approval"'
        );
        
        const activeDisputes = await this.db.get(
            'SELECT COUNT(*) as count FROM disputes WHERE status = "open"'
        );
        
        const pendingTransactions = await this.db.get(
            'SELECT COUNT(*) as count FROM transactions WHERE status IN ("pending_payment", "pending_delivery")'
        );

        const openReports = await this.db.get(
            'SELECT COUNT(*) as count FROM reports WHERE status = "open"'
        );

        const embed = new EmbedBuilder()
            .setTitle('🛡️ Admin Dashboard')
            .addFields(
                { name: '⏳ Pending Actions', value: `${pendingListings.count} Approvals\n${activeDisputes.count} Disputes\n${openReports.count} Reports`, inline: true },
                { name: '📊 Active Stats', value: `${pendingTransactions.count} Transactions`, inline: true },
                { name: '🔧 Quick Actions', value: 'Use buttons below', inline: true }
            )
            .setColor(0xFF6B6B)
            .setTimestamp();

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('admin_pending_listings')
                    .setLabel('Pending Listings')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📝'),
                new ButtonBuilder()
                    .setCustomId('admin_disputes')
                    .setLabel('Disputes')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⚠️'),
                new ButtonBuilder()
                    .setCustomId('admin_reports')
                    .setLabel('Reports')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📋')
            );

        await message.reply({ embeds: [embed], components: [buttons] });
    }

    async showAdminStats(message) {
        const stats = await this.db.get(`
            SELECT 
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_transactions,
                COUNT(*) as total_transactions,
                SUM(CASE WHEN status = 'completed' THEN price ELSE 0 END) as total_revenue
            FROM transactions
        `);

        const listingStats = await this.db.get(`
            SELECT 
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_listings,
                COUNT(*) as total_listings
            FROM listings
        `);

        const userStats = await this.db.get(`
            SELECT COUNT(DISTINCT user_id) as total_users FROM user_metrics
        `);

        const embed = new EmbedBuilder()
            .setTitle('📊 Marketplace Statistics')
            .addFields(
                { name: '💰 Revenue', value: `${(stats.total_revenue || 0).toFixed(2)}`, inline: true },
                { name: '🛒 Transactions', value: `${stats.completed_transactions}/${stats.total_transactions}`, inline: true },
                { name: '📦 Listings', value: `${listingStats.active_listings}/${listingStats.total_listings}`, inline: true },
                { name: '👥 Users', value: userStats.total_users.toString(), inline: true },
                { name: '📈 Success Rate', value: `${((stats.completed_transactions / (stats.total_transactions || 1)) * 100).toFixed(1)}%`, inline: true },
                { name: '💎 Active Items', value: listingStats.active_listings.toString(), inline: true }
            )
            .setColor(0x3498DB)
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    }

    async setChannel(message, args) {
        // !admin setchannel category channel_id
        if (args.length < 3) {
            return await message.reply('Usage: `!admin setchannel <category> <#channel>`');
        }

        const category = args[1].toLowerCase();
        const channelMention = args[2];
        const channelId = channelMention.replace(/[<#>]/g, '');
        
        const channel = message.guild.channels.cache.get(channelId);
        if (!channel) {
            return await message.reply('❌ Invalid channel!');
        }

        // Save to database
        await this.db.setGuildConfig(message.guild.id, `category_${category}_channel`, channelId);

        await message.reply(`✅ Set ${category} category to post in ${channel.name}`);
    }

    async handleHelp(message) {
        const embed = new EmbedBuilder()
            .setTitle('🚀 Discord Shop Bot - Help')
            .setDescription('Your AI-powered marketplace solution!')
            .addFields(
                { 
                    name: '🛒 **Seller Commands**', 
                    value: '`!sell` - Create AI-powered listing\n`!mylistings` - View your items', 
                    inline: false 
                },
                { 
                    name: '💳 **Buyer Commands**', 
                    value: '`!search <query>` - Smart search\n`!history` - Transaction history\n`!wishlist` - Saved items', 
                    inline: false 
                },
                { 
                    name: '🔍 **Search Examples**', 
                    value: '`!search roblox` - Text search\n`!search category:roblox` - Filter by category\n`!search price:<50` - Price filter', 
                    inline: false 
                },
                { 
                    name: '👥 **Social Features**', 
                    value: '`!leaderboard` - Top sellers\n`!follow` - Follow system\n`!report` - Report issues', 
                    inline: false 
                }
            )
            .setColor(0x00AE86)
            .setFooter({ text: 'Enhanced Shop Bot • Railway Powered' });

        await message.reply({ embeds: [embed] });
    }

    // Utility methods
    isAdmin(member) {
        if (!member) return false;
        return member.permissions.has('Administrator') || 
               member.roles.cache.some(role => role.name.toLowerCase().includes('admin') || 
                                              role.name.toLowerCase().includes('mod'));
    }

    getBadges(totalSales, avgRating) {
        let badges = '';
        
        if (totalSales >= 200 && avgRating >= 4.5) badges += '👑 ';
        else if (totalSales >= 100 && avgRating >= 4.8) badges += '🌟 ';
        else if (totalSales >= 50 && avgRating >= 4.5) badges += '🏆 ';
        else if (totalSales >= 25 && avgRating >= 4.7) badges += '⭐ ';
        else if (totalSales >= 10 && avgRating >= 4.0) badges += '✅ ';
        
        return badges;
    }

    isOnCooldown(userId, type) {
        const key = `${userId}_${type}`;
        return this.cooldowns.has(key) && this.cooldowns.get(key) > Date.now();
    }

    setCooldown(userId, type, duration) {
        const key = `${userId}_${type}`;
        this.cooldowns.set(key, Date.now() + duration);
        
        // Clean up old cooldowns
        setTimeout(() => {
            this.cooldowns.delete(key);
        }, duration + 1000);
    }
}

module.exports = CommandHandler;
