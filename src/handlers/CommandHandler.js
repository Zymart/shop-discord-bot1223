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
        
        // Owner ID - only this user has full admin access
        this.ownerId = '730629579533844512';
        this.adminIds = new Set([this.ownerId]); // Start with owner as admin
        
        // Load saved admins
        this.loadAdmins();
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
            } else if (content === '!profile') {
                await this.handleProfile(message);
            } else if (content === '!marketplace') {
                await this.handleMarketplace(message);
            } else if (content === '!trending') {
                await this.handleTrending(message);
            }

            // Set cooldown
            this.setCooldown(userId, 'command', 2000);

        } catch (error) {
            this.logger.error('Command handler error:', error);
            await message.reply('❌ An error occurred while processing your command. Please try again.').catch(() => {});
        }
    }

    async handleSell(message) {
        try {
            const embed = new EmbedBuilder()
                .setTitle('📝 Create New Listing')
                .setDescription('Click the button below to open the AI-powered listing form with image support!')
                .addFields(
                    { name: '🤖 AI Features', value: 'Smart categorization\nAuto-tagging\nPrice analysis', inline: true },
                    { name: '🔒 Security', value: 'Anti-scam detection\nProof requirements\nEscrow protection', inline: true },
                    { name: '📸 New: Images', value: 'Add up to 5 images\nSupport for Imgur, Discord\nThumbnail preview', inline: true }
                )
                .setColor(0x00AE86)
                .setFooter({ text: 'Enhanced Shop Bot • AI-Powered Listings with Image Support' });

            const button = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`sell_form_${message.author.id}`)
                        .setLabel('Open Listing Form')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🚀')
                );

            await message.reply({ embeds: [embed], components: [button] });
        } catch (error) {
            this.logger.error('Sell command error:', error);
            await message.reply('❌ Error creating sell form. Please try again.').catch(() => {});
        }
    }

    async handleSearch(message) {
        try {
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
                .setFooter({ text: 'Use buttons on listings to interact' });

            // Display first 5 results
            listings.slice(0, 5).forEach((listing, index) => {
                const rating = listing.rating_avg ? `${parseFloat(listing.rating_avg).toFixed(1)}/5 (${listing.rating_count})` : 'No ratings';
                
                embed.addFields({
                    name: `${index + 1}. ${listing.item_name}`,
                    value: `💰 $${listing.price} | 📊 Stock: ${listing.quantity} | ⭐ ${rating}\n` +
                           `🏷️ ${listing.tags ? JSON.parse(listing.tags).join(' ') : ''} | 👁️ ${listing.views || 0} views\n` +
                           `*${listing.description.substring(0, 100)}${listing.description.length > 100 ? '...' : ''}*`,
                    inline: false
                });
            });

            if (listings.length > 5) {
                embed.setFooter({ text: `Showing 5 of ${listings.length} results. Refine search for more specific results.` });
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Search command error:', error);
            await message.reply('❌ Error searching listings. Please try again.').catch(() => {});
        }
    }

    async handleMyListings(message) {
        try {
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
                .setDescription(`You have ${listings.length} active listings`);

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
                    value: `💰 $${listing.price} | 📊 Stock: ${listing.quantity}/${listing.original_quantity} | 👁️ ${listing.views || 0} views\n` +
                           `📅 ${new Date(listing.created_at).toLocaleDateString()} | 📋 ${listing.status.replace('_', ' ')}`,
                    inline: false
                });
            });

            await message.reply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('My listings command error:', error);
            await message.reply('❌ Error fetching your listings. Please try again.').catch(() => {});
        }
    }

    async handleAdmin(message) {
        // Check if user is owner or admin
        if (!this.isOwnerOrAdmin(message.author.id)) {
            return await message.reply('❌ You don\'t have permission to use admin commands!');
        }

        const args = message.content.split(' ').slice(1);
        const command = args[0];

        try {
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
                case 'setadmin':
                    await this.handleSetAdmin(message, args);
                    break;
                case 'removeadmin':
                    await this.handleRemoveAdmin(message, args);
                    break;
                case 'listadmins':
                    await this.handleListAdmins(message);
                    break;
                case 'config':
                    await this.showConfig(message);
                    break;
                case 'approve':
                    await this.handleManualApproval(message, args);
                    break;
                default:
                    await message.reply('Available admin commands: `dashboard`, `stats`, `setchannel`, `setadmin`, `removeadmin`, `listadmins`, `config`, `approve`');
            }
        } catch (error) {
            this.logger.error('Admin command error:', error);
            await message.reply('❌ Error executing admin command. Please try again.').catch(() => {});
        }
    }

    async handleSetAdmin(message, args) {
        // Only owner can set admins
        if (message.author.id !== this.ownerId) {
            return await message.reply('❌ Only the bot owner can set admins!');
        }

        if (args.length < 2) {
            return await message.reply('Usage: `!admin setadmin @user`');
        }

        const userMention = args[1];
        const userId = userMention.replace(/[<@!>]/g, '');
        
        try {
            const user = await this.client.users.fetch(userId);
            await this.addAdmin(userId);
            
            await message.reply(`✅ ${user.tag} has been added as an admin!`);
            
            // Notify the new admin
            try {
                await user.send(`🎉 You have been granted admin privileges for the Discord Shop Bot by ${message.author.tag}!`);
            } catch (error) {
                // User has DMs disabled
            }
            
        } catch (error) {
            await message.reply('❌ Invalid user or user not found!');
        }
    }

    async handleRemoveAdmin(message, args) {
        // Only owner can remove admins
        if (message.author.id !== this.ownerId) {
            return await message.reply('❌ Only the bot owner can remove admins!');
        }

        if (args.length < 2) {
            return await message.reply('Usage: `!admin removeadmin @user`');
        }

        const userMention = args[1];
        const userId = userMention.replace(/[<@!>]/g, '');
        
        try {
            const user = await this.client.users.fetch(userId);
            const removed = await this.removeAdmin(userId);
            
            if (removed) {
                await message.reply(`✅ ${user.tag} has been removed as an admin!`);
            } else {
                await message.reply('❌ Cannot remove the bot owner!');
            }
            
        } catch (error) {
            await message.reply('❌ Invalid user or user not found!');
        }
    }

    async handleListAdmins(message) {
        const adminList = Array.from(this.adminIds);
        
        if (adminList.length === 0) {
            return await message.reply('📋 No admins set (only bot owner has access).');
        }

        const embed = new EmbedBuilder()
            .setTitle('👑 Bot Admins')
            .setColor(0x9B59B6)
            .setDescription('Users with admin privileges:');

        for (let i = 0; i < adminList.length; i++) {
            const adminId = adminList[i];
            let adminTag = 'Unknown User';
            let isOwner = adminId === this.ownerId;
            
            try {
                const user = await this.client.users.fetch(adminId);
                adminTag = user.tag;
            } catch (error) {
                adminTag = `User ID: ${adminId}`;
            }

            embed.addFields({
                name: `${i + 1}. ${adminTag} ${isOwner ? '👑 (Owner)' : ''}`,
                value: `ID: ${adminId}`,
                inline: false
            });
        }

        await message.reply({ embeds: [embed] });
    }

    async setChannel(message, args) {
        if (args.length < 3) {
            return await message.reply('Usage: `!admin setchannel <category> <#channel>` or `!admin setchannel <category> "channel name"`');
        }

        try {
            const category = args[1].toLowerCase();
            let channelId = null;
            let channel = null;

            // Check if it's a mention
            if (args[2].startsWith('<#')) {
                channelId = args[2].replace(/[<#>]/g, '');
                channel = message.guild.channels.cache.get(channelId);
            } else {
                // It's a channel name - join all remaining args for channel name with spaces
                const channelName = args.slice(2).join(' ').toLowerCase();
                
                // Remove quotes if present
                const cleanChannelName = channelName.replace(/"/g, '');
                
                // Find channel by name (exact match or contains)
                channel = message.guild.channels.cache.find(ch => 
                    ch.name.toLowerCase() === cleanChannelName ||
                    ch.name.toLowerCase().replace(/[-\s]/g, '') === cleanChannelName.replace(/[-\s]/g, '') ||
                    ch.name.toLowerCase().includes(cleanChannelName)
                );

                if (channel) {
                    channelId = channel.id;
                }
            }
            
            if (!channel) {
                return await message.reply(`❌ Channel not found! Make sure the channel exists and try:\n` +
                    `• \`!admin setchannel ${category} #channel-name\`\n` +
                    `• \`!admin setchannel ${category} "channel name with spaces"\``);
            }

            // Validate category
            const validCategories = ['roblox', 'skins', 'currency', 'rare', 'other', 'anime', 'vanguard'];
            if (!validCategories.includes(category)) {
                return await message.reply(`❌ Invalid category! Valid categories: ${validCategories.join(', ')}`);
            }

            await this.db.setGuildConfig(message.guild.id, `category_${category}_channel`, channelId);
            await message.reply(`✅ Set **${category}** category to post in ${channel.name} (${channel})`);

        } catch (error) {
            this.logger.error('Set channel error:', error);
            await message.reply('❌ Error setting channel configuration.').catch(() => {});
        }
    }

    // Owner/Admin management methods
    isOwnerOrAdmin(userId) {
        return userId === this.ownerId || this.adminIds.has(userId);
    }

    async addAdmin(userId) {
        this.adminIds.add(userId);
        // Save to database
        try {
            const currentAdmins = Array.from(this.adminIds);
            await this.db.setGuildConfig('global', 'bot_admins', currentAdmins);
        } catch (error) {
            this.logger.error('Error saving admin list:', error);
        }
    }

    async removeAdmin(userId) {
        if (userId === this.ownerId) return false; // Can't remove owner
        this.adminIds.delete(userId);
        // Save to database
        try {
            const currentAdmins = Array.from(this.adminIds);
            await this.db.setGuildConfig('global', 'bot_admins', currentAdmins);
        } catch (error) {
            this.logger.error('Error saving admin list:', error);
        }
        return true;
    }

    async loadAdmins() {
        try {
            const savedAdmins = await this.db.getGuildConfig('global', 'bot_admins');
            if (savedAdmins && Array.isArray(savedAdmins)) {
                savedAdmins.forEach(adminId => this.adminIds.add(adminId));
            }
        } catch (error) {
            this.logger.error('Error loading admin list:', error);
        }
    }

    // Rest of the methods remain the same but with updated admin checks...
    async showAdminDashboard(message) {
        try {
            const pendingListings = await this.db.get('SELECT COUNT(*) as count FROM listings WHERE status = "pending_approval"');
            const activeDisputes = await this.db.get('SELECT COUNT(*) as count FROM disputes WHERE status = "open"');
            const pendingTransactions = await this.db.get('SELECT COUNT(*) as count FROM transactions WHERE status IN ("pending_payment", "pending_delivery")');
            const openReports = await this.db.get('SELECT COUNT(*) as count FROM reports WHERE status = "open"');

            const embed = new EmbedBuilder()
                .setTitle('🛡️ Admin Dashboard')
                .addFields(
                    { name: '⏳ Pending Actions', value: `${pendingListings.count || 0} Approvals\n${activeDisputes.count || 0} Disputes\n${openReports.count || 0} Reports`, inline: true },
                    { name: '📊 Active Stats', value: `${pendingTransactions.count || 0} Transactions`, inline: true },
                    { name: '🔧 Admin Level', value: message.author.id === this.ownerId ? '👑 Owner' : '🛡️ Admin', inline: true }
                )
                .setColor(0xFF6B6B)
                .setTimestamp()
                .setFooter({ text: 'Use !admin approve to review pending listings' });

            await message.reply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Admin dashboard error:', error);
            await message.reply('❌ Error loading dashboard.').catch(() => {});
        }
    }

    async showAdminStats(message) {
        try {
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

            const userStats = await this.db.get('SELECT COUNT(DISTINCT user_id) as total_users FROM user_metrics');

            const embed = new EmbedBuilder()
                .setTitle('📊 Marketplace Statistics')
                .addFields(
                    { name: '💰 Revenue', value: `$${(stats.total_revenue || 0).toFixed(2)}`, inline: true },
                    { name: '🛒 Transactions', value: `${stats.completed_transactions || 0}/${stats.total_transactions || 0}`, inline: true },
                    { name: '📦 Listings', value: `${listingStats.active_listings || 0}/${listingStats.total_listings || 0}`, inline: true },
                    { name: '👥 Users', value: (userStats.total_users || 0).toString(), inline: true },
                    { name: '📈 Success Rate', value: `${stats.total_transactions ? ((stats.completed_transactions / stats.total_transactions) * 100).toFixed(1) : 0}%`, inline: true },
                    { name: '💎 Active Items', value: (listingStats.active_listings || 0).toString(), inline: true }
                )
                .setColor(0x3498DB)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Admin stats error:', error);
            await message.reply('❌ Error loading statistics.').catch(() => {});
        }
    }

    async showConfig(message) {
        try {
            const config = await this.db.getAllGuildConfig(message.guild.id);
            
            const embed = new EmbedBuilder()
                .setTitle('⚙️ Bot Configuration')
                .setDescription('Current server settings')
                .setColor(0x9B59B6)
                .setTimestamp();

            if (Object.keys(config).length === 0) {
                embed.addFields({ name: 'Configuration', value: 'No settings configured yet', inline: false });
            } else {
                for (const [key, value] of Object.entries(config)) {
                    const displayKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                    const displayValue = value ? (key.includes('channel') ? `<#${value}>` : value.toString()) : 'Not set';
                    embed.addFields({ name: displayKey, value: displayValue, inline: true });
                }
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Show config error:', error);
            await message.reply('❌ Error loading configuration.').catch(() => {});
        }
    }

    async handleManualApproval(message, args) {
        try {
            const pendingListings = await this.db.all('SELECT * FROM listings WHERE status = "pending_approval" ORDER BY created_at ASC LIMIT 5');

            if (pendingListings.length === 0) {
                return await message.reply('✅ No pending listings to approve!');
            }

            const embed = new EmbedBuilder()
                .setTitle('⏳ Pending Approvals')
                .setColor(0xFFA500)
                .setDescription(`${pendingListings.length} listings awaiting approval`);

            pendingListings.forEach((listing, index) => {
                embed.addFields({
                    name: `${index + 1}. ${listing.item_name}`,
                    value: `**Seller:** <@${listing.seller_id}>\n**Price:** $${listing.price}\n**Category:** ${listing.category}\n**Created:** ${new Date(listing.created_at).toLocaleDateString()}\n**ID:** \`${listing.id}\``,
                    inline: false
                });
            });

            embed.setFooter({ text: 'Use the approval buttons in the admin channel to approve/reject listings' });

            await message.reply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Manual approval error:', error);
            await message.reply('❌ Error fetching pending listings.').catch(() => {});
        }
    }

    // Keep all other existing methods unchanged...
    async handleHistory(message) {
        try {
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
                    value: `${role} | $${transaction.price} | ${otherUser}\n*${new Date(transaction.created_at).toLocaleDateString()}*`,
                    inline: false
                });
            });

            if (transactions.length > 10) {
                embed.setFooter({ text: `Showing 10 of ${transactions.length} transactions` });
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('History command error:', error);
            await message.reply('❌ Error fetching transaction history. Please try again.').catch(() => {});
        }
    }

    async handleWishlist(message) {
        try {
            const wishlistItems = await this.db.all(
                'SELECT * FROM wishlists WHERE user_id = ? ORDER BY added_at DESC',
                [message.author.id]
            );

            if (wishlistItems.length === 0) {
                return await message.reply('⭐ Your wishlist is empty. React with ⭐ on listings to add them!');
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

        } catch (error) {
            this.logger.error('Wishlist command error:', error);
            await message.reply('❌ Error fetching wishlist. Please try again.').catch(() => {});
        }
    }

    async handleLeaderboard(message) {
        try {
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
                    userTag = `User ${seller.user_id}`;
                }

                const avgRating = seller.avg_rating ? parseFloat(seller.avg_rating).toFixed(1) : 'N/A';
                const badges = this.getBadges(seller.total_sales, parseFloat(avgRating));

                embed.addFields({
                    name: `${medal} ${userTag} ${badges}`,
                    value: `💰 Revenue: ${parseFloat(seller.total_revenue || 0).toFixed(2)}\n📦 Sales: ${seller.total_sales}\n⭐ Rating: ${avgRating}/5 (${seller.rating_count || 0} reviews)`,
                    inline: i < 3 ? true : false
                });
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Leaderboard command error:', error);
            await message.reply('❌ Error fetching leaderboard. Please try again.').catch(() => {});
        }
    }

    async handleProfile(message) {
        try {
            const userId = message.author.id;
            const userMetrics = await this.db.getUserMetrics(userId);
            const userRating = await this.getUserRating(userId);

            const embed = new EmbedBuilder()
                .setTitle(`📊 Profile: ${message.author.tag}`)
                .setThumbnail(message.author.displayAvatarURL())
                .addFields(
                    { name: '💰 Total Sales', value: (userMetrics.total_sales || 0).toString(), inline: true },
                    { name: '🛒 Total Purchases', value: (userMetrics.total_purchases || 0).toString(), inline: true },
                    { name: '⭐ Rating', value: `${userRating.average}/5 (${userRating.total} reviews)`, inline: true },
                    { name: '💵 Revenue', value: `${parseFloat(userMetrics.total_revenue || 0).toFixed(2)}`, inline: true },
                    { name: '💸 Spent', value: `${parseFloat(userMetrics.total_spent || 0).toFixed(2)}`, inline: true },
                    { name: '📅 Member Since', value: new Date(userMetrics.first_sale || message.author.createdAt).toLocaleDateString(), inline: true }
                )
                .setColor(0x9B59B6)
                .setTimestamp();

            const badges = this.getBadges(userMetrics.total_sales || 0, parseFloat(userRating.average));
            if (badges) {
                embed.addFields({ name: '🏆 Badges', value: badges, inline: false });
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Profile command error:', error);
            await message.reply('❌ Error fetching profile. Please try again.').catch(() => {});
        }
    }

    async handleMarketplace(message) {
        try {
            const activeListings = await this.db.get('SELECT COUNT(*) as count FROM listings WHERE status = "active"');
            const totalTransactions = await this.db.get('SELECT COUNT(*) as count FROM transactions WHERE status = "completed"');
            const totalRevenue = await this.db.get('SELECT SUM(price) as total FROM transactions WHERE status = "completed"');

            const embed = new EmbedBuilder()
                .setTitle('🏪 Marketplace Overview')
                .addFields(
                    { name: '📦 Active Listings', value: (activeListings.count || 0).toString(), inline: true },
                    { name: '✅ Completed Sales', value: (totalTransactions.count || 0).toString(), inline: true },
                    { name: '💰 Total Volume', value: `${parseFloat(totalRevenue.total || 0).toFixed(2)}`, inline: true }
                )
                .setColor(0x00AE86)
                .setTimestamp()
                .setFooter({ text: 'Use !search to find items or !sell to list items' });

            await message.reply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Marketplace command error:', error);
            await message.reply('❌ Error fetching marketplace data. Please try again.').catch(() => {});
        }
    }

    async handleTrending(message) {
        try {
            const trendingItems = await this.db.all(`
                SELECT item_name, category, COUNT(*) as views
                FROM listings 
                WHERE status = 'active' AND created_at > datetime('now', '-7 days')
                GROUP BY item_name
                ORDER BY views DESC
                LIMIT 10
            `);

            if (trendingItems.length === 0) {
                return await message.reply('📈 No trending items found this week.');
            }

            const embed = new EmbedBuilder()
                .setTitle('📈 Trending This Week')
                .setColor(0xFF6B6B)
                .setDescription('Most viewed items in the last 7 days');

            trendingItems.forEach((item, index) => {
                embed.addFields({
                    name: `${index + 1}. ${item.item_name}`,
                    value: `🏷️ ${item.category} | 👁️ ${item.views} views`,
                    inline: false
                });
            });

            await message.reply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Trending command error:', error);
            await message.reply('❌ Error fetching trending data. Please try again.').catch(() => {});
        }
    }

    async handleFollow(message) {
        const embed = new EmbedBuilder()
            .setTitle('👥 Follow System')
            .setDescription('Follow categories or sellers to get notifications!')
            .addFields(
                { name: 'Coming Soon', value: 'The follow system is under development', inline: false },
                { name: 'Current Features', value: 'Use ⭐ reactions to add items to wishlist', inline: false }
            )
            .setColor(0x9B59B6);

        await message.reply({ embeds: [embed] });
    }

    async handleReport(message) {
        const embed = new EmbedBuilder()
            .setTitle('🚨 Report System')
            .setDescription('Report suspicious listings or users')
            .addFields(
                { name: 'Report Listing', value: 'Use the report button on listings', inline: false },
                { name: 'Report User', value: 'Contact administrators directly', inline: false },
                { name: 'Emergency', value: 'Contact server moderators immediately', inline: false }
            )
            .setColor(0xFF4757);

        await message.reply({ embeds: [embed] });
    }

    async handleHelp(message) {
        const isAdmin = this.isOwnerOrAdmin(message.author.id);
        
        const embed = new EmbedBuilder()
            .setTitle('🚀 Discord Shop Bot - Help')
            .setDescription('Your AI-powered marketplace solution!')
            .addFields(
                { 
                    name: '🛒 **Selling**', 
                    value: '`!sell` - Create listing (AI + Image support)\n`!mylistings` - View your items', 
                    inline: false 
                },
                { 
                    name: '💳 **Buying**', 
                    value: '`!search <query>` - Smart search with filters\n`!history` - Transaction history\n`!wishlist` - Saved items\n`!marketplace` - Market overview', 
                    inline: false 
                },
                { 
                    name: '🔍 **Search Examples**', 
                    value: '`!search roblox` - Text search\n`!search category:roblox` - Filter by category\n`!search price:<50` - Price under $50', 
                    inline: false 
                },
                { 
                    name: '👥 **Community**', 
                    value: '`!leaderboard` - Top sellers\n`!trending` - Popular items\n`!profile` - Your profile stats', 
                    inline: false 
                }
            )
            .setColor(0x00AE86)
            .setFooter({ text: 'Enhanced Shop Bot • Railway Powered' });

        if (isAdmin) {
            embed.addFields({
                name: '🛡️ **Admin Commands**',
                value: '`!admin dashboard` - Admin panel\n`!admin stats` - Statistics\n`!admin setchannel <category> <#channel>`\n`!admin setadmin @user` - Add admin\n`!admin listadmins` - View admins',
                inline: false
            });
        }

        await message.reply({ embeds: [embed] });
    }

    async getUserRating(userId) {
        try {
            const result = await this.db.get(`
                SELECT AVG(rating) as average, COUNT(*) as total 
                FROM user_ratings 
                WHERE user_id = ?
            `, [userId]);
            
            return {
                average: result?.average ? parseFloat(result.average).toFixed(1) : '0',
                total: result?.total || 0
            };
        } catch (error) {
            this.logger.error('Error getting user rating:', error);
            return { average: '0', total: 0 };
        }
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
        
        setTimeout(() => {
            this.cooldowns.delete(key);
        }, duration + 1000);
    }
}

module.exports = CommandHandler;
