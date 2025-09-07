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
            
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: '❌ An error occurred while processing your request.', 
                    ephemeral: true 
                }).catch(() => {});
            }
        }
    }

    async handleButton(interaction) {
        const customId = interaction.customId;
        
        // Route button interactions
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
        }
    }

    async showSellModal(interaction) {
        const userId = interaction.customId.split('_')[2];
        if (interaction.user.id !== userId) {
            return await interaction.reply({ content: 'This form is not for you!', ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId('sell_modal')
            .setTitle('🚀 AI-Powered Listing Form');

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
            .setLabel('Description (AI will auto-categorize)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(500)
            .setPlaceholder('Detailed description... Include keywords for better categorization!');

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
        const itemName = interaction.fields.getTextInputValue('item_name');
        const price = parseFloat(interaction.fields.getTextInputValue('price'));
        const quantity = parseInt(interaction.fields.getTextInputValue('quantity'));
        const description = interaction.fields.getTextInputValue('description');
        const deliveryTime = interaction.fields.getTextInputValue('delivery_time') || 'Not specified';

        // Validation
        if (isNaN(price) || price <= 0) {
            return await interaction.reply({ 
                content: '❌ Invalid price! Please enter a valid number.', 
                ephemeral: true 
            });
        }

        if (isNaN(quantity) || quantity <= 0) {
            return await interaction.reply({ 
                content: '❌ Invalid quantity! Please enter a valid number.', 
                ephemeral: true 
            });
        }

        // Security checks
        const securityCheck = await this.securityService.validateListing(
            interaction.user.id, itemName, price, description
        );

        if (!securityCheck.passed) {
            return await interaction.reply({ 
                content: `⚠️ ${securityCheck.reason}\nContact an admin if this is legitimate.`, 
                ephemeral: true 
            });
        }

        // AI processing
        const aiAnalysis = await this.aiService.analyzeListing(itemName, description, price);

        // Create listing
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
            status: 'pending_approval',
            createdAt: new Date().toISOString(),
            views: 0,
            priceAnalysis: aiAnalysis.priceAnalysis,
            autoDetected: aiAnalysis
        };

        await this.db.createListing(listing);

        // Update price history
        await this.db.addPriceHistory(itemName, aiAnalysis.category, price);

        // Send for approval
        await this.sendForApproval(listing, interaction.guild);

        const embed = new EmbedBuilder()
            .setTitle('✅ AI-Powered Listing Created!')
            .addFields(
                { name: '🤖 AI Category', value: aiAnalysis.category, inline: true },
                { name: '🏷️ Auto Tags', value: aiAnalysis.tags.join(' '), inline: true },
                { name: '📊 Price Analysis', value: aiAnalysis.priceAnalysis, inline: false }
            )
            .setColor(0x00FF00)
            .setFooter({ text: 'Your listing is pending admin approval' });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    async sendForApproval(listing, guild) {
        const embed = new EmbedBuilder()
            .setTitle('📋 New Listing - AI Analysis')
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
            channel.name.includes('admin') || channel.name.includes('mod')
        );

        if (adminChannels.size > 0) {
            const adminChannel = adminChannels.first();
            await adminChannel.send({ embeds: [embed], components: [buttons] });
        }
    }

    async handleListingApproval(interaction, approved) {
        if (!this.isAdmin(interaction.member)) {
            return await interaction.reply({ content: '❌ Admin access required!', ephemeral: true });
        }

        const listingId = interaction.customId.split('_')[2];
        const listing = await this.db.getListing(listingId);

        if (!listing) {
            return await interaction.reply({ content: '❌ Listing not found!', ephemeral: true });
        }

        if (approved) {
            await this.db.updateListing(listingId, { status: 'active' });
            await this.postListingToChannel(listing, interaction.guild);
            
            // Notify seller
