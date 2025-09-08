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
        
        // Load saved admins after a short delay to ensure database is ready
        setTimeout(() => {
            this.loadAdmins();
        }, 1000);
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
            await message.reply('An error occurred while processing your command. Please try again.').catch(() => {});
        }
    }

    async handleSell(message) {
        try {
            const embed = new EmbedBuilder()
                .setTitle('Create New Listing')
                .setDescription('Click the button below to open the AI-powered listing form with image support!')
                .addFields(
                    { name: 'AI Features', value: 'Smart categorization\nAuto-tagging\nPrice analysis', inline: true },
                    { name: 'Security', value: 'Anti-scam detection\nProof requirements\nEscrow protection', inline: true },
                    { name: 'New: Images', value: 'Add up to 5 images\nSupport for Imgur, Discord\nThumbnail preview', inline: true }
                )
                .setColor(0x00AE86)
                .setFooter({ text: 'Enhanced Shop Bot • AI-Powered Listings with Image Support' });

            const button = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`sell_form_${message.author.id}`)
                        .setLabel('Open Listing Form')
                        .setStyle(ButtonStyle.Primary)
                );

            await message.reply({ embeds: [embed], components: [button] });
        } catch (error) {
            this.logger.error('Sell command error:', error);
            await message.reply('Error creating sell form. Please try again.').catch(() => {});
        }
    }

    async handleAdmin(message) {
        // Check if user is owner or admin
        if (!this.isOwnerOrAdmin(message.author.id)) {
            return await message.reply('You don\'t have permission to use admin commands!');
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
            await message.reply('Error executing admin command. Please try again.').catch(() => {});
        }
    }

    async handleSetAdmin(message, args) {
        // Only owner can set admins
        if (message.author.id !== this.ownerId) {
            return await message.reply('Only the bot owner can set admins!');
        }

        if (args.length < 2) {
            return await message.reply('Usage: `!admin setadmin @user`');
        }

        const userMention = args[1];
        const userId = userMention.replace(/[<@!>]/g, '');
        
        try {
            const user = await this.client.users.fetch(userId);
            await this.addAdmin(userId);
            
            await message.reply(`${user.tag} has been added as an admin!`);
            
            // Notify the new admin
            try {
                await user.send(`You have been granted admin privileges for the Discord Shop Bot by ${message.author.tag}!`);
            } catch (error) {
                // User has DMs disabled
            }
            
        } catch (error) {
            await message.reply('Invalid user or user not found!');
        }
    }

    async handleRemoveAdmin(message, args) {
        // Only owner can remove admins
        if (message.author.id !== this.ownerId) {
            return await message.reply('Only the bot owner can remove admins!');
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
                await message.reply(`${user.tag} has been removed as an admin!`);
            } else {
                await message.reply('Cannot remove the bot owner!');
            }
            
        } catch (error) {
            await message.reply('Invalid user or user not found!');
        }
    }

    async handleListAdmins(message) {
        const adminList = Array.from(this.adminIds);
        
        if (adminList.length === 1) { // Only owner
            return await message.reply('No additional admins set (only bot owner has access).');
        }

        const embed = new EmbedBuilder()
            .setTitle('Bot Admins')
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
                name: `${i + 1}. ${adminTag} ${isOwner ? '(Owner)' : ''}`,
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
                return await message.reply(`Channel not found! Make sure the channel exists and try:\n` +
                    `• \`!admin setchannel ${category} #channel-name\`\n` +
                    `• \`!admin setchannel ${category} "channel name with spaces"\``);
            }

            // Validate category
            const validCategories = ['roblox', 'skins', 'currency', 'rare', 'other', 'anime', 'vanguard'];
            if (!validCategories.includes(category)) {
                return await message.reply(`Invalid category! Valid categories: ${validCategories.join(', ')}`);
            }

            await this.db.setGuildConfig(message.guild.id, `category_${category}_channel`, channelId);
            await message.reply(`Set **${category}** category to post in ${channel.name} (${channel})`);

        } catch (error) {
            this.logger.error('Set channel error:', error);
            await message.reply('Error setting channel configuration.').catch(() => {});
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
            this.logger.info(`Added admin: ${userId}`);
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
            this.logger.info(`Removed admin: ${userId}`);
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
                this.logger.info(`Loaded ${savedAdmins.length} admins from database`);
            } else {
                this.logger.info('No saved admins found, using owner only');
            }
        } catch (error) {
            this.logger.warn('Error loading admin list (database may not be ready):', error.message);
            // Don't throw error, just use owner only
        }
    }

    // Rest of the methods from the previous file remain the same...
    async showAdminDashboard(message) {
        try {
            const pendingListings = await this.db.get('SELECT COUNT(*) as count FROM listings WHERE status = "pending_approval"');
            const activeDisputes = await this.db.get('SELECT COUNT(*) as count FROM disputes WHERE status = "open"');
            const pendingTransactions = await this.db.get('SELECT COUNT(*) as count FROM transactions WHERE status IN ("pending_payment", "pending_delivery")');
            const openReports = await this.db.get('SELECT COUNT(*) as count FROM reports WHERE status = "open"');

            const embed = new EmbedBuilder()
                .setTitle('Admin Dashboard')
                .addFields(
                    { name: 'Pending Actions', value: `${pendingListings.count || 0} Approvals\n${activeDisputes.count || 0} Disputes\n${openReports.count || 0} Reports`, inline: true },
                    { name: 'Active Stats', value: `${pendingTransactions.count || 0} Transactions`, inline: true },
                    { name: 'Admin Level', value: message.author.id === this.ownerId ? 'Owner' : 'Admin', inline: true }
                )
                .setColor(0xFF6B6B)
                .setTimestamp()
                .setFooter({ text: 'Use !admin approve to review pending listings' });

            await message.reply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Admin dashboard error:', error);
            await message.reply('Error loading dashboard.').catch(() => {});
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
                .setTitle('Marketplace Statistics')
                .addFields(
                    { name: 'Revenue', value: `${(stats.total_revenue || 0).toFixed(2)}`, inline: true },
                    { name: 'Transactions', value: `${stats.completed_transactions || 0}/${stats.total_transactions || 0}`, inline: true },
                    { name: 'Listings', value: `${listingStats.active_listings || 0}/${listingStats.total_listings || 0}`, inline: true },
                    { name: 'Users', value: (userStats.total_users || 0).toString(), inline: true },
                    { name: 'Success Rate', value: `${stats.total_transactions ? ((stats.completed_transactions / stats.total_transactions) * 100).toFixed(1) : 0}%`, inline: true },
                    { name: 'Active Items', value: (listingStats.active_listings || 0).toString(), inline: true }
                )
                .setColor(0x3498DB)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Admin stats error:', error);
            await message.reply('Error loading statistics.').catch(() => {});
        }
    }

    async showConfig(message) {
        try {
            const config = await this.db.getAllGuildConfig(message.guild.id);
            
            const embed = new EmbedBuilder()
                .setTitle('Bot Configuration')
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
            await message.reply('Error loading configuration.').catch(() => {});
        }
    }

    async handleManualApproval(message, args) {
        try {
            const pendingListings = await this.db.all('SELECT * FROM listings WHERE status = "pending_approval" ORDER BY created_at ASC LIMIT 5');

            if (pendingListings.length === 0) {
                return await message.reply('No pending listings to approve!');
            }

            const embed = new EmbedBuilder()
                .setTitle('Pending Approvals')
                .setColor(0xFFA500)
                .setDescription(`${pendingListings.length} listings awaiting approval`);

            pendingListings.forEach((listing, index) => {
                embed.addFields({
                    name: `${index + 1}. ${listing.item_name}`,
                    value: `**Seller:** <@${listing.seller_id}>\n**Price:** ${listing.price}\n**Category:** ${listing.category}\n**Created:** ${new Date(listing.created_at).toLocaleDateString()}\n**ID:** \`${listing.id}\``,
                    inline: false
                });
            });

            embed.setFooter({ text: 'Use the approval buttons in the admin channel to approve/reject listings' });

            await message.reply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Manual approval error:', error);
            await message.reply('Error fetching pending listings.').catch(() => {});
        }
    }

    // Keep all other existing methods unchanged...
    async handleSearch(message) {
        const args = message.content.split(' ').slice(1);
        const query = args.join(' ').toLowerCase();

        if (!query) {
            const embed = new EmbedBuilder()
                .setTitle('Search Help')
                .setDescription('Use advanced search with filters:')
                .addFields(
                    { name: 'Text Search', value: '`!search roblox pet`', inline: false },
                    { name: 'Category Filter', value: '`!search category:roblox`', inline: false },
                    { name: 'Price Filter', value: '`!search price:<50` or `price:>10`', inline: false }
                )
                .setColor(0x3498DB);

            return await message.reply({ embeds: [embed] });
        }

        // Basic search implementation for now
        await message.reply(`Searching for: ${query} (advanced search coming soon!)`);
    }

    async handleMyListings(message) {
        await message.reply('My listings feature coming soon! Use the dashboard to manage your items.');
    }

    async handleHistory(message) {
        await message.reply('Transaction history coming soon!');
    }

    async handleWishlist(message) {
        await message.reply('Wishlist feature coming soon!');
    }

    async handleLeaderboard(message) {
        await message.reply('Leaderboard coming soon!');
    }

    async handleProfile(message) {
        await message.reply('Profile feature coming soon!');
    }

    async handleMarketplace(message) {
        await message.reply('Marketplace overview coming soon!');
    }

    async handleTrending(message) {
        await message.reply('Trending items coming soon!');
    }

    async handleFollow(message) {
        await message.reply('Follow system coming soon!');
    }

    async handleReport(message) {
        await message.reply('Report system coming soon! Contact admins directly for now.');
    }

    async handleHelp(message) {
        const isAdmin = this.isOwnerOrAdmin(message.author.id);
        
        const embed = new EmbedBuilder()
            .setTitle('Discord Shop Bot - Help')
            .setDescription('Your AI-powered marketplace solution!')
            .addFields(
                { 
                    name: '**Selling**', 
                    value: '`!sell` - Create listing with image support\n`!mylistings` - View your items', 
                    inline: false 
                },
                { 
                    name: '**Buying**', 
                    value: '`!search <query>` - Search items\n`!marketplace` - Market overview', 
                    inline: false 
                }
            )
            .setColor(0x00AE86)
            .setFooter({ text: 'Enhanced Shop Bot • Railway Powered' });

        if (isAdmin) {
            embed.addFields({
                name: '**Admin Commands**',
                value: '`!admin dashboard` - Admin panel\n`!admin setchannel <category> <#channel>`\n`!admin setadmin @user` - Add admin\n`!admin listadmins` - View admins',
                inline: false
            });
        }

        await message.reply({ embeds: [embed] });
    }

    // Utility methods
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
