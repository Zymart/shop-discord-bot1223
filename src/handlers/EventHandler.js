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
            await this.db.
