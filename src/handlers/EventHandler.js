const { EmbedBuilder } = require('discord.js');

class EventHandler {
    constructor(client, database, logger) {
        this.client = client;
        this.db = database;
        this.logger = logger;
    }

    async handleMemberJoin(member) {
        try {
            this.logger.info(`New member joined: ${member.user.tag} (${member.user.id})`);
            
            // Initialize user metrics
            await this.db.getUserMetrics(member.user.id);
            
            // Send welcome message if enabled
            await this.sendWelcomeMessage(member);
            
            // Log join for analytics
            await this.logUserEvent(member.user.id, 'member_join');

        } catch (error) {
            this.logger.error('Error handling member join:', error);
        }
    }

    async handleGuildJoin(guild) {
        try {
            this.logger.info(`Bot joined new guild: ${guild.name} (${guild.id})`);
            
            // Initialize guild configuration
            await this.initializeGuildConfig(guild);
            
            // Send setup message to guild owner
            await this.sendSetupMessage(guild);

            // Log guild join for analytics
            await this.logGuildEvent(guild.id, 'guild_join');

        } catch (error) {
            this.logger.error('Error handling guild join:', error);
        }
    }

    async handleGuildLeave(guild) {
        try {
            this.logger.info(`Bot left guild: ${guild.name} (${guild.id})`);
            
            // Optionally clean up guild data (commented out to preserve data)
            // await this.cleanupGuildData(guild.id);

            // Log guild leave for analytics
            await this.logGuildEvent(guild.id, 'guild_leave');

        } catch (error) {
            this.logger.error('Error handling guild leave:', error);
        }
    }

    async sendWelcomeMessage(member) {
        try {
            // Check if welcome messages are enabled for this guild
            const welcomeConfig = await this.db.getGuildConfig(member.guild.id, 'welcome_enabled');
            if (!welcomeConfig) return;

            const embed = new EmbedBuilder()
                .setTitle('🎉 Welcome to the Marketplace!')
                .setDescription(`Welcome to **${member.guild.name}**, ${member.user.username}!`)
                .addFields(
                    { 
                        name: '🛒 Getting Started', 
                        value: 'Use `!help` to see all available commands', 
                        inline: false 
                    },
                    { 
                        name: '💰 Selling Items', 
                        value: 'Use `!sell` to create your first listing', 
                        inline: true 
                    },
                    { 
                        name: '🔍 Finding Items', 
                        value: 'Use `!search <item>` to find items', 
                        inline: true 
                    },
                    { 
                        name: '🛡️ Safety First', 
                        value: 'All transactions are protected by our escrow system', 
                        inline: false 
                    }
                )
                .setColor(0x00AE86)
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp()
                .setFooter({ text: 'Enhanced Shop Bot • Secure Trading' });

            // Try to send DM first, fallback to welcome channel
            try {
                await member.send({ embeds: [embed] });
            } catch (error) {
                // DM failed, try to find welcome channel
                const welcomeChannel = member.guild.channels.cache.find(
                    channel => channel.name.includes('welcome') || 
                              channel.name.includes('general')
                );

                if (welcomeChannel) {
                    await welcomeChannel.send({ 
                        content: `Welcome ${member}!`, 
                        embeds: [embed] 
                    });
                }
            }

        } catch (error) {
            this.logger.error('Error sending welcome message:', error);
        }
    }

    async sendSetupMessage(guild) {
        try {
            const owner = await guild.fetchOwner();
            
            const embed = new EmbedBuilder()
                .setTitle('🚀 Thanks for adding Enhanced Shop Bot!')
                .setDescription(`Welcome to **${guild.name}**! Let's get your marketplace set up.`)
                .addFields(
                    {
                        name: '⚙️ Essential Setup',
                        value: `\`!admin setchannel roblox #roblox-shop\`
\`!admin setchannel skins #skins-marketplace\`
\`!admin setchannel currency #currency-exchange\`
\`!admin setchannel other #general-shop\``,
                        inline: false
                    },
                    {
                        name: '🔧 Configuration Commands',
                        value: `\`!admin config\` - View settings
\`!admin stats\` - View statistics
\`!dashboard\` - Admin dashboard`,
                        inline: false
                    },
                    {
                        name: '🎯 Key Features',
                        value: `• AI-powered categorization
• Secure escrow transactions
• Anti-fraud protection
• Automated backups
• Real-time analytics`,
                        inline: false
                    },
                    {
                        name: '📚 Getting Started',
                        value: `1. Set up category channels above
2. Users can start selling with \`!sell\`
3. Monitor with \`!dashboard\`
4. Get help with \`!help\``,
                        inline: false
                    }
                )
                .setColor(0x00AE86)
                .setThumbnail(this.client.user.displayAvatarURL())
                .setTimestamp()
                .setFooter({ text: 'Enhanced Shop Bot • Railway Powered' });

            await owner.send({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Error sending setup message:', error);
        }
    }

    async initializeGuildConfig(guild) {
        try {
            // Set default configuration
            const defaultConfig = {
                welcome_enabled: false,
                auto_approve: false,
                max_listings_per_user: 50,
                require_proof_threshold: 50,
                categories: {
                    roblox: null,
                    skins: null,
                    currency: null,
                    rare: null,
                    other: null
                }
            };

            for (const [key, value] of Object.entries(defaultConfig)) {
                await this.db.setGuildConfig(guild.id, key, value);
            }

            this.logger.info(`Initialized configuration for guild: ${guild.name}`);

        } catch (error) {
            this.logger.error('Error initializing guild config:', error);
        }
    }

    async handleMemberLeave(member) {
        try {
            this.logger.info(`Member left: ${member.user.tag} (${member.user.id})`);
            
            // Check if user has active listings or transactions
            const activeListings = await this.db.all(`
                SELECT COUNT(*) as count FROM listings 
                WHERE seller_id = ? AND status = 'active'
            `, [member.user.id]);

            const activeTransactions = await this.db.all(`
                SELECT COUNT(*) as count FROM transactions 
                WHERE (buyer_id = ? OR seller_id = ?) 
                AND status IN ('pending_payment', 'pending_delivery', 'disputed')
            `, [member.user.id, member.user.id]);

            if (activeListings[0].count > 0 || activeTransactions[0].count > 0) {
                this.logger.warn(`User ${member.user.id} left with active items/transactions`, {
                    listings: activeListings[0].count,
                    transactions: activeTransactions[0].count
                });

                // Notify admins if there are active transactions
                if (activeTransactions[0].count > 0) {
                    await this.notifyAdminsOfUserLeave(member, activeTransactions[0].count);
                }
            }

            // Log leave event
            await this.logUserEvent(member.user.id, 'member_leave');

        } catch (error) {
            this.logger.error('Error handling member leave:', error);
        }
    }

    async notifyAdminsOfUserLeave(member, activeTransactions) {
        try {
            const adminChannels = member.guild.channels.cache.filter(channel => 
                channel.name.includes('admin') || channel.name.includes('mod')
            );

            if (adminChannels.size === 0) return;

            const embed = new EmbedBuilder()
                .setTitle('⚠️ User Left with Active Transactions')
                .setDescription(`${member.user.tag} left the server`)
                .addFields(
                    { name: 'User ID', value: member.user.id, inline: true },
                    { name: 'Active Transactions', value: activeTransactions.toString(), inline: true },
                    { name: 'Action Required', value: 'Review active transactions for potential issues', inline: false }
                )
                .setColor(0xFFA500)
                .setTimestamp();

            const adminChannel = adminChannels.first();
            await adminChannel.send({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Error notifying admins of user leave:', error);
        }
    }

    async handleMessageDelete(message) {
        try {
            // Check if deleted message was a listing
            const listing = await this.db.get(`
                SELECT * FROM listings WHERE message_id = ?
            `, [message.id]);

            if (listing) {
                this.logger.warn(`Listing message deleted: ${listing.item_name} (${listing.id})`);
                
                // Mark listing as needing repost
                await this.db.updateListing(listing.id, {
                    status: 'needs_repost',
                    message_id: null
                });

                // Notify seller
                try {
                    const seller = await this.client.users.fetch(listing.seller_id);
                    await seller.send(`⚠️ Your listing "${listing.item_name}" message was deleted. It will be automatically reposted.`);
                } catch (error) {
                    this.logger.warn('Could not notify seller of message deletion');
                }
            }

        } catch (error) {
            this.logger.error('Error handling message delete:', error);
        }
    }

    async handleChannelDelete(channel) {
        try {
            // Check if deleted channel was configured for categories
            const guildConfig = await this.db.getAllGuildConfig(channel.guild.id);
            
            for (const [key, value] of Object.entries(guildConfig)) {
                if (key.startsWith('category_') && key.endsWith('_channel') && value === channel.id) {
                    // Remove channel configuration
                    await this.db.setGuildConfig(channel.guild.id, key, null);
                    
                    this.logger.warn(`Category channel deleted: ${key} (${channel.name})`);
                    
                    // Notify admins
                    await this.notifyAdminsOfChannelDeletion(channel, key);
                }
            }

        } catch (error) {
            this.logger.error('Error handling channel delete:', error);
        }
    }

    async notifyAdminsOfChannelDeletion(channel, configKey) {
        try {
            const adminChannels = channel.guild.channels.cache.filter(ch => 
                ch.name.includes('admin') || ch.name.includes('mod')
            );

            if (adminChannels.size === 0) return;

            const category = configKey.replace('category_', '').replace('_channel', '');

            const embed = new EmbedBuilder()
                .setTitle('⚠️ Category Channel Deleted')
                .setDescription(`The channel for **${category}** category was deleted`)
                .addFields(
                    { name: 'Channel Name', value: channel.name, inline: true },
                    { name: 'Category', value: category, inline: true },
                    { name: 'Action Required', value: `Set a new channel with \`!admin setchannel ${category} #new-channel\``, inline: false }
                )
                .setColor(0xFF6B6B)
                .setTimestamp();

            const adminChannel = adminChannels.first();
            await adminChannel.send({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Error notifying admins of channel deletion:', error);
        }
    }

    async logUserEvent(userId, eventType, metadata = {}) {
        try {
            await this.db.run(`
                INSERT INTO user_events (user_id, event_type, metadata, created_at)
                VALUES (?, ?, ?, ?)
            `, [userId, eventType, JSON.stringify(metadata), new Date().toISOString()]);

        } catch (error) {
            // Create table if it doesn't exist
            await this.createUserEventsTable();
            // Try again
            await this.logUserEvent(userId, eventType, metadata);
        }
    }

    async logGuildEvent(guildId, eventType, metadata = {}) {
        try {
            await this.db.run(`
                INSERT INTO guild_events (guild_id, event_type, metadata, created_at)
                VALUES (?, ?, ?, ?)
            `, [guildId, eventType, JSON.stringify(metadata), new Date().toISOString()]);

        } catch (error) {
            // Create table if it doesn't exist
            await this.createGuildEventsTable();
            // Try again
            await this.logGuildEvent(guildId, eventType, metadata);
        }
    }

    async createUserEventsTable() {
        try {
            await this.db.run(`
                CREATE TABLE IF NOT EXISTS user_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    metadata TEXT,
                    created_at TEXT NOT NULL
                )
            `);
        } catch (error) {
            this.logger.error('Error creating user_events table:', error);
        }
    }

    async createGuildEventsTable() {
        try {
            await this.db.run(`
                CREATE TABLE IF NOT EXISTS guild_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    metadata TEXT,
                    created_at TEXT NOT NULL
                )
            `);
        } catch (error) {
            this.logger.error('Error creating guild_events table:', error);
        }
    }

    async handleReactionAdd(reaction, user) {
        try {
            if (user.bot) return;

            // Check if reaction is on a listing message
            const listing = await this.db.get(`
                SELECT * FROM listings WHERE message_id = ?
            `, [reaction.message.id]);

            if (listing && reaction.emoji.name === '⭐') {
                // Add to wishlist
                await this.addToWishlist(user.id, listing);
            }

        } catch (error) {
            this.logger.error('Error handling reaction add:', error);
        }
    }

    async addToWishlist(userId, listing) {
        try {
            await this.db.run(`
                INSERT OR IGNORE INTO wishlists (user_id, item_name, max_price, keywords, added_at)
                VALUES (?, ?, ?, ?, ?)
            `, [userId, listing.item_name, listing.price * 1.2, listing.category, new Date().toISOString()]);

            this.logger.info(`Added ${listing.item_name} to ${userId}'s wishlist`);

        } catch (error) {
            this.logger.error('Error adding to wishlist:', error);
        }
    }

    async handleVoiceStateUpdate(oldState, newState) {
        // Could be used for voice-based trading features in the future
        // For now, just log if needed for analytics
        try {
            if (oldState.channelId !== newState.channelId) {
                await this.logUserEvent(newState.id, 'voice_state_change', {
                    oldChannelId: oldState.channelId,
                    newChannelId: newState.channelId
                });
            }
        } catch (error) {
            this.logger.error('Error handling voice state update:', error);
        }
    }

    async handleRoleUpdate(oldRole, newRole) {
        try {
            // Check if admin role was modified
            if (oldRole.permissions.has('Administrator') !== newRole.permissions.has('Administrator')) {
                this.logger.info(`Role permission change: ${newRole.name} in ${newRole.guild.name}`);
                
                await this.logGuildEvent(newRole.guild.id, 'role_permission_change', {
                    roleId: newRole.id,
                    roleName: newRole.name,
                    adminBefore: oldRole.permissions.has('Administrator'),
                    adminAfter: newRole.permissions.has('Administrator')
                });
            }
        } catch (error) {
            this.logger.error('Error handling role update:', error);
        }
    }

    async handleGuildMemberUpdate(oldMember, newMember) {
        try {
            // Check if user got/lost admin permissions
            const oldAdmin = oldMember.permissions.has('Administrator');
            const newAdmin = newMember.permissions.has('Administrator');

            if (oldAdmin !== newAdmin) {
                this.logger.info(`Admin permission change: ${newMember.user.tag} in ${newMember.guild.name}`);
                
                await this.logUserEvent(newMember.user.id, 'admin_permission_change', {
                    guildId: newMember.guild.id,
                    adminBefore: oldAdmin,
                    adminAfter: newAdmin
                });
            }
        } catch (error) {
            this.logger.error('Error handling guild member update:', error);
        }
    }

    async getEventStatistics(guildId = null, days = 30) {
        try {
            const dateLimit = new Date();
            dateLimit.setDate(dateLimit.getDate() - days);

            let userEventsQuery = `
                SELECT event_type, COUNT(*) as count 
                FROM user_events 
                WHERE created_at >= ?
            `;
            let guildEventsQuery = `
                SELECT event_type, COUNT(*) as count 
                FROM guild_events 
                WHERE created_at >= ?
            `;
            let params = [dateLimit.toISOString()];

            if (guildId) {
                guildEventsQuery += ` AND guild_id = ?`;
                params.push(guildId);
            }

            userEventsQuery += ` GROUP BY event_type ORDER BY count DESC`;
            guildEventsQuery += ` GROUP BY event_type ORDER BY count DESC`;

            const userEvents = await this.db.all(userEventsQuery, params.slice(0, 1));
            const guildEvents = await this.db.all(guildEventsQuery, params);

            return {
                period: `${days} days`,
                userEvents: userEvents.reduce((acc, event) => {
                    acc[event.event_type] = event.count;
                    return acc;
                }, {}),
                guildEvents: guildEvents.reduce((acc, event) => {
                    acc[event.event_type] = event.count;
                    return acc;
                }, {}),
                totalUserEvents: userEvents.reduce((sum, event) => sum + event.count, 0),
                totalGuildEvents: guildEvents.reduce((sum, event) => sum + event.count, 0),
                generatedAt: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('Error generating event statistics:', error);
            return null;
        }
    }

    async cleanupOldEvents() {
        try {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const userEventsDeleted = await this.db.run(`
                DELETE FROM user_events WHERE created_at < ?
            `, [thirtyDaysAgo.toISOString()]);

            const guildEventsDeleted = await this.db.run(`
                DELETE FROM guild_events WHERE created_at < ?
            `, [thirtyDaysAgo.toISOString()]);

            this.logger.info(`Cleaned up old events: ${userEventsDeleted.changes || 0} user events, ${guildEventsDeleted.changes || 0} guild events`);

        } catch (error) {
            this.logger.error('Error cleaning up old events:', error);
        }
    }

    async handleBotMention(message) {
        try {
            if (message.mentions.has(this.client.user)) {
                const embed = new EmbedBuilder()
                    .setTitle('👋 Hey there!')
                    .setDescription(`I'm the Enhanced Shop Bot! Here's how to get started:`)
                    .addFields(
                        { name: '🆘 Get Help', value: '`!help`', inline: true },
                        { name: '🛒 Start Selling', value: '`!sell`', inline: true },
                        { name: '🔍 Search Items', value: '`!search <query>`', inline: true }
                    )
                    .setColor(0x00AE86)
                    .setThumbnail(this.client.user.displayAvatarURL())
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            }
        } catch (error) {
            this.logger.error('Error handling bot mention:', error);
        }
    }

    async handleInviteCreate(invite) {
        try {
            this.logger.info(`Invite created: ${invite.code} in ${invite.guild?.name}`);
            
            if (invite.guild) {
                await this.logGuildEvent(invite.guild.id, 'invite_create', {
                    inviteCode: invite.code,
                    inviterId: invite.inviter?.id,
                    channelId: invite.channel?.id,
                    maxAge: invite.maxAge,
                    maxUses: invite.maxUses
                });
            }
        } catch (error) {
            this.logger.error('Error handling invite create:', error);
        }
    }

    async handleError(error) {
        try {
            this.logger.error('Discord client error:', error);
            
            // Log critical errors for analysis
            await this.logGuildEvent('global', 'bot_error', {
                errorMessage: error.message,
                errorStack: error.stack?.substring(0, 500),
                timestamp: new Date().toISOString()
            });

            // If error is related to permissions, log specific details
            if (error.code === 50013) { // Missing Permissions
                this.logger.error('Permission error - bot may need additional permissions');
            }

            if (error.code === 50001) { // Missing Access
                this.logger.error('Access error - bot may have been removed from channel/guild');
            }

        } catch (err) {
            this.logger.error('Error in error handler:', err);
        }
    }

    // Method to register all event listeners
    registerEventListeners() {
        // Member events
        this.client.on('guildMemberAdd', this.handleMemberJoin.bind(this));
        this.client.on('guildMemberRemove', this.handleMemberLeave.bind(this));
        this.client.on('guildMemberUpdate', this.handleGuildMemberUpdate.bind(this));

        // Guild events
        this.client.on('guildCreate', this.handleGuildJoin.bind(this));
        this.client.on('guildDelete', this.handleGuildLeave.bind(this));

        // Message events
        this.client.on('messageDelete', this.handleMessageDelete.bind(this));
        this.client.on('messageCreate', (message) => {
            if (message.mentions.has(this.client.user)) {
                this.handleBotMention(message);
            }
        });

        // Channel events
        this.client.on('channelDelete', this.handleChannelDelete.bind(this));

        // Reaction events
        this.client.on('messageReactionAdd', this.handleReactionAdd.bind(this));

        // Voice events (for future features)
        this.client.on('voiceStateUpdate', this.handleVoiceStateUpdate.bind(this));

        // Role events
        this.client.on('roleUpdate', this.handleRoleUpdate.bind(this));

        // Invite events
        this.client.on('inviteCreate', this.handleInviteCreate.bind(this));

        // Error handling
        this.client.on('error', this.handleError.bind(this));
        this.client.on('warn', (warning) => {
            this.logger.warn('Discord client warning:', warning);
        });

        this.logger.info('✅ All event listeners registered');
    }
}

module.exports = EventHandler;
