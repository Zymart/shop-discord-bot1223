const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType } = require('discord.js');
const AIService = require('../services/AIService');
const EscrowService = require('../services/EscrowService');
const SecurityService = require('../services/SecurityService');

class InteractionHandler {
    constructor(client, database, logger) {
        this.client = client;
        this.db = database;
        this.logger = logger;
        this.aiService = new AIService(database);
        this.escrowService = new EscrowService(client, database, logger);
        this.securityService = new SecurityService(database, logger);
    }

    async handleInteraction(interaction) {
        try {
            if (interaction.isModalSubmit()) {
                await this.handleModalSubmit(interaction);
            } else if (interaction.isButton()) {
                await this.handleButton(interaction);
            } else if (interaction.isStringSelectMenu()) {
                await this.handleSelectMenu(interaction);
            }
        } catch (error) {
            this.logger.error('Interaction handler error:', error);
            
            const errorMessage = { 
                content: '❌ An error occurred while processing your request.', 
                flags: 64
            };
            
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply(errorMessage);
                } else if (!interaction.replied) {
                    await interaction.editReply(errorMessage);
                }
            } catch (replyError) {
                this.logger.error('Error sending error message:', replyError);
            }
        }
    }

    async handleButton(interaction) {
        const customId = interaction.customId;
        
        try {
            if (customId.startsWith('sell_form_')) {
                await this.showSellModal(interaction);
            } else if (customId.startsWith('buy_')) {
                await this.handlePurchase(interaction);
            } else if (customId.startsWith('admin_approve_')) {
                await this.handleListingApproval(interaction, true);
            } else if (customId.startsWith('admin_reject_')) {
                await this.handleListingApproval(interaction, false);
            } else if (customId.startsWith('confirm_delivery_')) {
                await this.handleDeliveryConfirmation(interaction);
            } else if (customId.startsWith('dispute_')) {
                await this.handleDispute(interaction);
            } else if (customId.startsWith('rate_')) {
                await this.handleRating(interaction);
            } else if (customId.startsWith('proof_submit_')) {
                await this.showProofModal(interaction);
            } else if (customId.startsWith('follow_listing_')) {
                await this.handleFollowListing(interaction);
            } else if (customId.startsWith('report_listing_')) {
                await this.showReportModal(interaction);
            } else if (customId.startsWith('admin_')) {
                await this.handleAdminButton(interaction);
            } else {
                await interaction.reply({ 
                    content: '❌ Unknown button interaction.', 
                    flags: 64 
                });
            }
        } catch (error) {
            this.logger.error(`Button handler error for ${customId}:`, error);
            throw error;
        }
    }

    async showSellModal(interaction) {
        const userId = interaction.customId.split('_')[2];
        if (interaction.user.id !== userId) {
            return await interaction.reply({ 
                content: 'This form is not for you!', 
                flags: 64 
            });
        }

        const modal = new ModalBuilder()
            .setCustomId('sell_modal')
            .setTitle('🚀 Create New Listing');

        const itemName = new TextInputBuilder()
            .setCustomId('item_name')
            .setLabel('Item Name')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
            .setPlaceholder('e.g., Legendary Dragon Pet, Premium Robux Package');

        const price = new TextInputBuilder()
            .setCustomId('price')
            .setLabel('Price ($)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(10)
            .setPlaceholder('e.g., 15.99');

        const quantity = new TextInputBuilder()
            .setCustomId('quantity')
            .setLabel('Quantity/Stock')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(5)
            .setValue('1');

        const description = new TextInputBuilder()
            .setCustomId('description')
            .setLabel('Description')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(500)
            .setPlaceholder('Detailed description of your item...');

        const deliveryTime = new TextInputBuilder()
            .setCustomId('delivery_time')
            .setLabel('Estimated Delivery Time')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(50)
            .setPlaceholder('e.g., Instant, 1-24 hours, 2-3 days');

        modal.addComponents(
            new ActionRowBuilder().addComponents(itemName),
            new ActionRowBuilder().addComponents(price),
            new ActionRowBuilder().addComponents(quantity),
            new ActionRowBuilder().addComponents(description),
            new ActionRowBuilder().addComponents(deliveryTime)
        );

        await interaction.showModal(modal);
    }

    async handleModalSubmit(interaction) {
        if (interaction.customId === 'sell_modal') {
            await this.processSellSubmission(interaction);
        } else if (interaction.customId.startsWith('proof_modal_')) {
            await this.handleProofSubmission(interaction);
        } else if (interaction.customId.startsWith('report_modal_')) {
            await this.handleReportSubmission(interaction);
        }
    }

    async processSellSubmission(interaction) {
        await interaction.deferReply({ flags: 64 });

        try {
            const itemName = interaction.fields.getTextInputValue('item_name');
            const price = parseFloat(interaction.fields.getTextInputValue('price'));
            const quantity = parseInt(interaction.fields.getTextInputValue('quantity'));
            const description = interaction.fields.getTextInputValue('description');
            const deliveryTime = interaction.fields.getTextInputValue('delivery_time') || 'Not specified';

            // Validation
            if (isNaN(price) || price <= 0) {
                return await interaction.editReply({ 
                    content: '❌ Invalid price! Please enter a valid number.' 
                });
            }

            if (isNaN(quantity) || quantity <= 0) {
                return await interaction.editReply({ 
                    content: '❌ Invalid quantity! Please enter a valid number.' 
                });
            }

            // Security checks
            const securityCheck = await this.securityService.validateListing(
                interaction.user.id, itemName, price, description
            );

            if (!securityCheck.passed) {
                return await interaction.editReply({ 
                    content: `⚠️ ${securityCheck.reason}\nContact an admin if this is legitimate.`
                });
            }

            // AI processing
            const aiAnalysis = await this.aiService.analyzeListing(itemName, description, price);

            // Create listing - now goes to pending approval
            const listingId = `listing_${Date.now()}_${interaction.user.id}`;
            const listing = {
                id: listingId,
                sellerId: interaction.user.id,
                sellerTag: interaction.user.tag,
                itemName,
                category: aiAnalysis.category,
                tags: aiAnalysis.tags,
                price,
                quantity,
                originalQuantity: quantity,
                description,
                deliveryTime,
                status: 'pending_approval', // Require admin approval
                createdAt: new Date().toISOString(),
                views: 0,
                priceAnalysis: aiAnalysis.priceAnalysis,
                autoDetected: aiAnalysis
            };

            // Save to database
            await this.db.createListing(listing);
            this.logger.info(`Listing created for approval: ${listingId} by ${interaction.user.tag}`);

            // Update price history
            try {
                await this.db.addPriceHistory(itemName, aiAnalysis.category, price);
            } catch (error) {
                this.logger.warn('Failed to add price history:', error);
            }

            // Send for admin approval
            await this.sendForApproval(listing, interaction.guild);

            const embed = new EmbedBuilder()
                .setTitle('✅ Listing Submitted for Approval!')
                .addFields(
                    { name: '📦 Item', value: itemName, inline: true },
                    { name: '💰 Price', value: `$${price}`, inline: true },
                    { name: '📊 Stock', value: quantity.toString(), inline: true },
                    { name: '🏷️ AI Category', value: aiAnalysis.category, inline: true },
                    { name: '🔖 Auto Tags', value: aiAnalysis.tags.join(' '), inline: true },
                    { name: '📈 Price Analysis', value: aiAnalysis.priceAnalysis, inline: true }
                )
                .setColor(0xFFA500)
                .setFooter({ text: 'Your listing is pending admin approval and will be live once approved!' });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Error processing sell submission:', error);
            await interaction.editReply({ 
                content: '❌ Error creating listing. Please try again.' 
            });
        }
    }

    async sendForApproval(listing, guild) {
        try {
            const embed = new EmbedBuilder()
                .setTitle('📋 New Listing - Requires Approval')
                .addFields(
                    { name: '📦 Item', value: listing.itemName, inline: true },
                    { name: '🏷️ AI Category', value: listing.category, inline: true },
                    { name: '💰 Price', value: `$${listing.price}`, inline: true },
                    { name: '📊 Quantity', value: listing.quantity.toString(), inline: true },
                    { name: '👤 Seller', value: `<@${listing.sellerId}>`, inline: true },
                    { name: '🤖 AI Tags', value: listing.tags.join(' '), inline: true },
                    { name: '📝 Description', value: listing.description.substring(0, 200) + (listing.description.length > 200 ? '...' : ''), inline: false },
                    { name: '📊 Price Analysis', value: listing.priceAnalysis, inline: false }
                )
                .setColor(0xFFA500)
                .setTimestamp()
                .setFooter({ text: `Listing ID: ${listing.id}` });

            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`admin_approve_${listing.id}`)
                        .setLabel('Approve')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅'),
                    new ButtonBuilder()
                        .setCustomId(`admin_reject_${listing.id}`)
                        .setLabel('Reject')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('❌')
                );

            // Find admin channel
            const adminChannels = guild.channels.cache.filter(channel => 
                (channel.name.includes('admin') || channel.name.includes('mod') || channel.name.includes('approval')) &&
                channel.permissionsFor(this.client.user).has(['SendMessages', 'ViewChannel'])
            );

            if (adminChannels.size > 0) {
                const adminChannel = adminChannels.first();
                await adminChannel.send({ embeds: [embed], components: [buttons] });
                this.logger.info(`Approval request sent to ${adminChannel.name} for listing ${listing.id}`);
            } else {
                this.logger.warn(`No suitable admin channel found for approval in guild ${guild.name}`);
            }

        } catch (error) {
            this.logger.error('Error sending for approval:', error);
        }
    }

    async handleListingApproval(interaction, approved) {
        if (!this.isAdmin(interaction.member)) {
            return await interaction.reply({ 
                content: '❌ Admin access required!', 
                flags: 64 
            });
        }

        const listingId = interaction.customId.split('_')[2];
        
        try {
            const listing = await this.db.getListing(listingId);

            if (!listing) {
                return await interaction.reply({ 
                    content: '❌ Listing not found!', 
                    flags: 64 
                });
            }

            if (listing.status !== 'pending_approval') {
                return await interaction.reply({ 
                    content: '❌ This listing has already been processed!', 
                    flags: 64 
                });
            }

            if (approved) {
                // Approve listing
                await this.db.updateListing(listingId, { status: 'active' });
                
                // Post to appropriate channel
                await this.postListingToChannel(listing, interaction.guild);
                
                // Notify seller
                try {
                    const seller = await this.client.users.fetch(listing.seller_id);
                    const approvalEmbed = new EmbedBuilder()
                        .setTitle('✅ Listing Approved!')
                        .setDescription(`Your listing **${listing.item_name}** has been approved and is now live!`)
                        .addFields({ name: 'What\'s Next?', value: 'Your item is now visible to buyers. You\'ll be notified of any purchases.' })
                        .setColor(0x00FF00)
                        .setTimestamp();
                    
                    await seller.send({ embeds: [approvalEmbed] });
                } catch (error) {
                    this.logger.warn('Could not notify seller of approval');
                }

                await interaction.update({ 
                    content: `✅ **Approved by ${interaction.user.tag}**\nListing "${listing.item_name}" is now live!`, 
                    embeds: [], 
                    components: [] 
                });

            } else {
                // Reject listing
                await this.db.updateListing(listingId, { status: 'rejected' });
                
                // Notify seller
                try {
                    const seller = await this.client.users.fetch(listing.seller_id);
                    const rejectionEmbed = new EmbedBuilder()
                        .setTitle('❌ Listing Rejected')
                        .setDescription(`Your listing **${listing.item_name}** has been rejected by moderation.`)
                        .addFields({ 
                            name: 'Next Steps', 
                            value: 'You can contact an administrator for more details or create a new listing with different content.' 
                        })
                        .setColor(0xFF0000)
                        .setTimestamp();
                    
                    await seller.send({ embeds: [rejectionEmbed] });
                } catch (error) {
                    this.logger.warn('Could not notify seller of rejection');
                }

                await interaction.update({ 
                    content: `❌ **Rejected by ${interaction.user.tag}**\nListing "${listing.item_name}" has been rejected and seller notified.`, 
                    embeds: [], 
                    components: [] 
                });
            }

        } catch (error) {
            this.logger.error('Listing approval error:', error);
            await interaction.reply({ 
                content: '❌ Error processing approval. Please try again.', 
                flags: 64 
            });
        }
    }

    async postListingToChannel(listing, guild) {
        try {
            // Find configured channel for category
            let targetChannel = null;
            
            try {
                const channelId = await this.db.getGuildConfig(guild.id, `category_${listing.category}_channel`);
                if (channelId) {
                    targetChannel = guild.channels.cache.get(channelId);
                }
            } catch (error) {
                this.logger.warn('Error getting guild config:', error);
            }

            // If no configured channel, find suitable one
            if (!targetChannel) {
                targetChannel = guild.channels.cache.find(channel => 
                    (channel.name.includes('shop') || 
                     channel.name.includes('market') || 
                     channel.name.includes('trade') ||
                     channel.name.includes(listing.category)) &&
                    channel.permissionsFor(this.client.user).has(['SendMessages', 'ViewChannel'])
                ) || guild.channels.cache.find(channel => 
                    channel.type === 0 && 
                    channel.permissionsFor(this.client.user).has(['SendMessages', 'ViewChannel'])
                );
            }

            if (!targetChannel) {
                this.logger.warn('No suitable channel found for listing');
                return;
            }

            // Get seller rating
            const sellerRating = await this.getUserRating(listing.seller_id);
            
            const embed = new EmbedBuilder()
                .setTitle(`${this.getCategoryEmoji(listing.category)} ${listing.item_name}`)
                .addFields(
                    { name: '💰 Price', value: `$${listing.price}`, inline: true },
                    { name: '📊 Stock', value: listing.quantity.toString(), inline: true },
                    { name: '⭐ Seller Rating', value: `${sellerRating.average}/5 (${sellerRating.total} reviews)`, inline: true },
                    { name: '👤 Seller', value: `<@${listing.seller_id}>`, inline: true },
                    { name: '🚚 Delivery Time', value: listing.delivery_time || 'Not specified', inline: true },
                    { name: '🏷️ Tags', value: listing.tags.join(' '), inline: true },
                    { name: '📝 Description', value: listing.description, inline: false }
                )
                .setColor(0x00AE86)
                .setTimestamp()
                .setFooter({ text: `Listing ID: ${listing.id}` });

            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`buy_${listing.id}`)
                        .setLabel('Buy Now')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🛒'),
                    new ButtonBuilder()
                        .setCustomId(`follow_listing_${listing.id}`)
                        .setLabel('Follow')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📥'),
                    new ButtonBuilder()
                        .setCustomId(`report_listing_${listing.id}`)
                        .setLabel('Report')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🚨')
                );

            const message = await targetChannel.send({ embeds: [embed], components: [buttons] });
            
            // Update listing with message info
            await this.db.updateListing(listing.id, {
                channel_id: targetChannel.id,
                message_id: message.id
            });

            this.logger.info(`Listing posted to ${targetChannel.name}: ${listing.item_name}`);

        } catch (error) {
            this.logger.error('Error posting listing to channel:', error);
        }
    }

    async handlePurchase(interaction) {
        const listingId = interaction.customId.split('_')[1];
        
        try {
            const listing = await this.db.getListing(listingId);

            if (!listing) {
                return await interaction.reply({ 
                    content: '❌ Listing not found! It may have been removed or sold out.', 
                    flags: 64 
                });
            }

            if (listing.status !== 'active') {
                return await interaction.reply({ 
                    content: '❌ This item is no longer available!', 
                    flags: 64 
                });
            }

            if (listing.seller_id === interaction.user.id) {
                return await interaction.reply({ 
                    content: '❌ You cannot buy your own item!', 
                    flags: 64 
                });
            }

            if (listing.quantity <= 0) {
                await this.db.updateListing(listingId, { status: 'sold_out' });
                return await interaction.reply({ 
                    content: '❌ This item is out of stock!', 
                    flags: 64 
                });
            }

            await interaction.deferReply({ flags: 64 });

            // Create transaction
            const transactionId = `tx_${Date.now()}_${interaction.user.id}`;
            const transaction = {
                id: transactionId,
                listingId: listing.id,
                buyerId: interaction.user.id,
                buyerTag: interaction.user.tag,
                sellerId: listing.seller_id,
                sellerTag: listing.seller_tag,
                itemName: listing.item_name,
                price: listing.price,
                status: 'pending_payment',
                escrowStage: 'awaiting_payment',
                createdAt: new Date().toISOString(),
                requiresProof: listing.price > 50
            };

            await this.db.createTransaction(transaction);

            // Update listing stock
            const newQuantity = listing.quantity - 1;
            const updates = { quantity: newQuantity, views: (listing.views || 0) + 1 };
            if (newQuantity === 0) {
                updates.status = 'sold_out';
            }
            
            await this.db.updateListing(listingId, updates);

            // Create transaction thread
            const thread = await this.escrowService.createTransactionThread(
                transaction, 
                interaction.channel
            );

            if (thread) {
                await this.db.updateTransaction(transactionId, { thread_id: thread.id });
            }

            await interaction.editReply({ 
                content: '✅ Purchase initiated! ' + (thread ? `Check your secure transaction thread: <#${thread.id}>` : 'Transaction created successfully.')
            });

        } catch (error) {
            this.logger.error('Purchase error:', error);
            await interaction.editReply({ 
                content: '❌ Error processing purchase. Please try again.' 
            });
        }
    }

    async getUserRating(userId) {
        try {
            const result = await this.db.get(`
                SELECT AVG(rating) as average, COUNT(*) as total 
                FROM user_ratings 
                WHERE user_id = ?
            `, [userId]);
            
            return {
                average: result?.average ? parseFloat(result.average).toFixed(1) : '0.0',
                total: result?.total || 0
            };
        } catch (error) {
            this.logger.error('Error getting user rating:', error);
            return { average: '0.0', total: 0 };
        }
    }

    getCategoryEmoji(category) {
        const emojis = {
            'roblox': '🎮',
            'skins': '🎨',
            'currency': '💰',
            'rare': '💎',
            'other': '📦'
        };
        return emojis[category] || '📦';
    }

    isAdmin(member) {
        if (!member) return false;
        return member.permissions.has('Administrator') || 
               member.roles.cache.some(role => 
                   role.name.toLowerCase().includes('admin') || 
                   role.name.toLowerCase().includes('mod')
               );
    }

    // Placeholder methods for features to be implemented
    async handleSelectMenu(interaction) {
        await interaction.reply({ 
            content: '❌ Select menu interactions not implemented yet.', 
            flags: 64 
        });
    }

    async handleDeliveryConfirmation(interaction) {
        await interaction.reply({ 
            content: '✅ Delivery confirmation system coming soon!', 
            flags: 64 
        });
    }

    async handleDispute(interaction) {
        await interaction.reply({ 
            content: '⚠️ Dispute system coming soon! Contact an admin for now.', 
            flags: 64 
        });
    }

    async handleRating(interaction) {
        await interaction.reply({ 
            content: '⭐ Rating system coming soon!', 
            flags: 64 
        });
    }

    async showProofModal(interaction) {
        await interaction.reply({ 
            content: '📸 Proof submission system coming soon!', 
            flags: 64 
        });
    }

    async handleFollowListing(interaction) {
        await interaction.reply({ 
            content: '📥 Follow system coming soon!', 
            flags: 64 
        });
    }

    async showReportModal(interaction) {
        await interaction.reply({ 
            content: '🚨 Report system coming soon! Contact an admin for now.', 
            flags: 64 
        });
    }

    async handleProofSubmission(interaction) {
        await interaction.reply({ 
            content: '📸 Proof submission not fully implemented.', 
            flags: 64 
        });
    }

    async handleReportSubmission(interaction) {
        await interaction.reply({ 
            content: '🚨 Report submission not fully implemented.', 
            flags: 64 
        });
    }

    async handleAdminButton(interaction) {
        if (!this.isAdmin(interaction.member)) {
            return await interaction.reply({ 
                content: '❌ Admin access required!', 
                flags: 64 
            });
        }

        const customId = interaction.customId;

        if (customId === 'admin_pending_listings') {
            const pendingListings = await this.db.all(
                'SELECT * FROM listings WHERE status = "pending_approval" ORDER BY created_at ASC LIMIT 5'
            );

            if (pendingListings.length === 0) {
                return await interaction.reply({ 
                    content: '✅ No pending listings!', 
                    flags: 64 
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('⏳ Pending Listings')
                .setColor(0xFFA500)
                .setDescription(`${pendingListings.length} listings awaiting approval`);

            pendingListings.forEach((listing, index) => {
                embed.addFields({
                    name: `${index + 1}. ${listing.item_name}`,
                    value: `**Seller:** <@${listing.seller_id}>\n**Price:** ${listing.price}\n**Created:** ${new Date(listing.created_at).toLocaleDateString()}\n**ID:** \`${listing.id}\``,
                    inline: false
                });
            });

            await interaction.reply({ embeds: [embed], flags: 64 });
        } else {
            await interaction.reply({ 
                content: '❌ Admin button not fully implemented.', 
                flags: 64 
            });
        }
    }
}

module.exports = InteractionHandler;
