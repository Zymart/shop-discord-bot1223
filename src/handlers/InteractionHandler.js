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
            try {
                const seller = await this.client.users.fetch(listing.seller_id);
                await seller.send(`✅ Your listing "${listing.item_name}" has been approved and is now live!`);
            } catch (error) {
                this.logger.warn('Could not notify seller of approval');
            }

            await interaction.update({ 
                content: '✅ Listing approved and posted!', 
                embeds: [], 
                components: [] 
            });
        } else {
            await this.db.updateListing(listingId, { status: 'rejected' });
            
            // Notify seller
            try {
                const seller = await this.client.users.fetch(listing.seller_id);
                await seller.send(`❌ Your listing "${listing.item_name}" has been rejected. Contact an admin for details.`);
            } catch (error) {
                this.logger.warn('Could not notify seller of rejection');
            }

            await interaction.update({ 
                content: '❌ Listing rejected and seller notified.', 
                embeds: [], 
                components: [] 
            });
        }
    }

    async postListingToChannel(listing, guild) {
        // Get channel for category
        const channelId = await this.db.getGuildConfig(guild.id, `category_${listing.category}_channel`);
        
        if (!channelId) {
            this.logger.warn(`No channel configured for category: ${listing.category}`);
            return;
        }

        const channel = guild.channels.cache.get(channelId);
        if (!channel) {
            this.logger.warn(`Channel not found: ${channelId}`);
            return;
        }

        // Get seller rating
        const sellerRating = await this.db.getUserRating(listing.seller_id);
        
        const embed = new EmbedBuilder()
            .setTitle(`${this.getCategoryEmoji(listing.category)} ${listing.item_name}`)
            .addFields(
                { name: '💰 Price', value: `${listing.price}`, inline: true },
                { name: '📊 Stock', value: listing.quantity.toString(), inline: true },
                { name: '⭐ Seller Rating', value: `${sellerRating.average}/5 (${sellerRating.total} reviews)`, inline: true },
                { name: '👤 Seller', value: `<@${listing.seller_id}>`, inline: true },
                { name: '🚚 Delivery Time', value: listing.delivery_time, inline: true },
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

        const message = await channel.send({ embeds: [embed], components: [buttons] });
        
        // Update listing with message info
        await this.db.updateListing(listing.id, {
            channel_id: channel.id,
            message_id: message.id
        });
    }

    async handlePurchase(interaction) {
        const listingId = interaction.customId.split('_')[1];
        const listing = await this.db.getListing(listingId);

        if (!listing || listing.status !== 'active') {
            return await interaction.reply({ 
                content: '❌ This item is no longer available!', 
                ephemeral: true 
            });
        }

        if (listing.seller_id === interaction.user.id) {
            return await interaction.reply({ 
                content: '❌ You cannot buy your own item!', 
                ephemeral: true 
            });
        }

        if (listing.quantity <= 0) {
            await this.db.updateListing(listingId, { status: 'sold_out' });
            return await interaction.reply({ 
                content: '❌ This item is out of stock!', 
                ephemeral: true 
            });
        }

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
            requiresProof: listing.price > 50 // High value items require proof
        };

        await this.db.createTransaction(transaction);

        // Update listing stock
        const newQuantity = listing.quantity - 1;
        const updates = { quantity: newQuantity };
        if (newQuantity === 0) {
            updates.status = 'sold_out';
        }
        
        await this.db.updateListing(listingId, updates);
        await this.db.updateListing(listingId, { views: listing.views + 1 });

        // Create secure transaction thread
        const thread = await this.escrowService.createTransactionThread(
            transaction, 
            interaction.channel
        );

        transaction.threadId = thread.id;
        await this.db.updateTransaction(transactionId, { thread_id: thread.id });

        await interaction.reply({ 
            content: '✅ Purchase initiated! Check the secure transaction thread that was created.', 
            ephemeral: true 
        });
    }

    async handleDeliveryConfirmation(interaction) {
        const transactionId = interaction.customId.split('_')[2];
        const transaction = await this.db.getTransaction(transactionId);

        if (!transaction) {
            return await interaction.reply({ content: '❌ Transaction not found!', ephemeral: true });
        }

        if (interaction.user.id !== transaction.buyer_id) {
            return await interaction.reply({ 
                content: '❌ Only the buyer can confirm delivery!', 
                ephemeral: true 
            });
        }

        // Check if proof is required
        if (transaction.requires_proof && !transaction.proof_submitted) {
            return await interaction.reply({ 
                content: '⚠️ This transaction requires proof from the seller before confirmation.', 
                ephemeral: true 
            });
        }

        // Complete transaction
        await this.escrowService.completeTransaction(transactionId, interaction);
    }

    async handleDispute(interaction) {
        const transactionId = interaction.customId.split('_')[1];
        const transaction = await this.db.getTransaction(transactionId);

        if (!transaction) {
            return await interaction.reply({ content: '❌ Transaction not found!', ephemeral: true });
        }

        if (interaction.user.id !== transaction.buyer_id && interaction.user.id !== transaction.seller_id) {
            return await interaction.reply({ 
                content: '❌ You are not part of this transaction!', 
                ephemeral: true 
            });
        }

        // Create dispute
        const disputeId = `dispute_${Date.now()}_${interaction.user.id}`;
        const dispute = {
            id: disputeId,
            transaction_id: transactionId,
            item_name: transaction.item_name,
            buyer_id: transaction.buyer_id,
            seller_id: transaction.seller_id,
            disputed_by: interaction.user.id,
            priority: transaction.price > 100 ? 'high' : 'normal',
            status: 'open',
            created_at: new Date().toISOString()
        };

        await this.db.run(`
            INSERT INTO disputes (id, transaction_id, item_name, buyer_id, seller_id, disputed_by, priority, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            dispute.id, dispute.transaction_id, dispute.item_name, dispute.buyer_id, 
            dispute.seller_id, dispute.disputed_by, dispute.priority, dispute.status, dispute.created_at
        ]);

        // Update transaction status
        await this.db.updateTransaction(transactionId, { 
            status: 'disputed',
            disputed_at: new Date().toISOString(),
            disputed_by: interaction.user.id
        });

        const embed = new EmbedBuilder()
            .setTitle('⚠️ Dispute Opened')
            .addFields(
                { name: '📦 Item', value: transaction.item_name, inline: true },
                { name: '💰 Amount', value: `${transaction.price}`, inline: true },
                { name: '🚨 Priority', value: dispute.priority.toUpperCase(), inline: true }
            )
            .setColor(0xFF0000)
            .setTimestamp();

        await interaction.update({ embeds: [embed], components: [] });

        // Notify admins
        await this.notifyAdminsOfDispute(dispute, interaction.guild);
    }

    async notifyAdminsOfDispute(dispute, guild) {
        const embed = new EmbedBuilder()
            .setTitle(`🚨 ${dispute.priority.toUpperCase()} PRIORITY DISPUTE`)
            .addFields(
                { name: '📦 Item', value: dispute.item_name, inline: true },
                { name: '👤 Buyer', value: `<@${dispute.buyer_id}>`, inline: true },
                { name: '👤 Seller', value: `<@${dispute.seller_id}>`, inline: true },
                { name: '🚨 Disputed By', value: `<@${dispute.disputed_by}>`, inline: true },
                { name: '⚡ Priority', value: dispute.priority, inline: true },
                { name: '📅 Created', value: new Date(dispute.created_at).toLocaleString(), inline: true }
            )
            .setColor(dispute.priority === 'high' ? 0xFF0000 : 0xFF6B00)
            .setTimestamp()
            .setFooter({ text: `Dispute ID: ${dispute.id}` });

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`resolve_buyer_${dispute.transaction_id}`)
                    .setLabel('Side with Buyer')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`resolve_seller_${dispute.transaction_id}`)
                    .setLabel('Side with Seller')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`investigate_${dispute.id}`)
                    .setLabel('Investigate')
                    .setStyle(ButtonStyle.Secondary)
            );

        const adminChannels = guild.channels.cache.filter(channel => 
            channel.name.includes('admin') || channel.name.includes('mod')
        );

        if (adminChannels.size > 0) {
            const adminChannel = adminChannels.first();
            const content = dispute.priority === 'high' ? '@here High Priority Dispute!' : '';
            await adminChannel.send({ content, embeds: [embed], components: [buttons] });
        }
    }

    async handleRating(interaction) {
        const [action, rating, transactionId] = interaction.customId.split('_');
        const transaction = await this.db.getTransaction(transactionId);

        if (!transaction) {
            return await interaction.reply({ content: '❌ Transaction not found!', ephemeral: true });
        }

        if (interaction.user.id !== transaction.buyer_id) {
            return await interaction.reply({ 
                content: '❌ Only the buyer can rate!', 
                ephemeral: true 
            });
        }

        // Add rating
        await this.db.addUserRating(transaction.seller_id, parseInt(rating), transactionId);

        // Update user metrics
        const metrics = await this.db.getUserMetrics(transaction.seller_id);
        await this.db.updateUserMetrics(transaction.seller_id, {
            total_sales: metrics.total_sales + 1,
            total_revenue: metrics.total_revenue + transaction.price
        });

        const embed = new EmbedBuilder()
            .setTitle('⭐ Rating Submitted')
            .setDescription(`Thank you for rating <@${transaction.seller_id}>!`)
            .addFields({ 
                name: 'Rating Given', 
                value: '⭐'.repeat(parseInt(rating)) + '☆'.repeat(5 - parseInt(rating))
            })
            .setColor(0x00FF00);

        await interaction.update({ embeds: [embed], components: [] });

        // Check for badges
        const newRating = await this.db.getUserRating(transaction.seller_id);
        this.checkAndAwardBadges(transaction.seller_id, metrics.total_sales + 1, parseFloat(newRating.average));
    }

    async showProofModal(interaction) {
        const transactionId = interaction.customId.split('_')[2];
        const transaction = await this.db.getTransaction(transactionId);

        if (!transaction || interaction.user.id !== transaction.seller_id) {
            return await interaction.reply({ 
                content: '❌ Only the seller can submit proof!', 
                ephemeral: true 
            });
        }

        const modal = new ModalBuilder()
            .setCustomId(`proof_modal_${transactionId}`)
            .setTitle('📸 Submit Delivery Proof');

        const proofDescription = new TextInputBuilder()
            .setCustomId('proof_description')
            .setLabel('Proof Description')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder('Describe the proof you are providing...');

        const proofLinks = new TextInputBuilder()
            .setCustomId('proof_links')
            .setLabel('Screenshot Links or Additional Info')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setPlaceholder('Imgur links, confirmation numbers, etc...');

        modal.addComponents(
            new ActionRowBuilder().addComponents(proofDescription),
            new ActionRowBuilder().addComponents(proofLinks)
        );

        await interaction.showModal(modal);
    }

    async handleProofSubmission(interaction) {
        const transactionId = interaction.customId.split('_')[2];
        const proofDescription = interaction.fields.getTextInputValue('proof_description');
        const proofLinks = interaction.fields.getTextInputValue('proof_links') || 'None provided';

        const proofData = {
            description: proofDescription,
            links: proofLinks,
            submittedAt: new Date().toISOString()
        };

        await this.db.updateTransaction(transactionId, {
            proof_submitted: true,
            proof_data: JSON.stringify(proofData),
            escrow_stage: 'proof_submitted'
        });

        const embed = new EmbedBuilder()
            .setTitle('📸 Delivery Proof Submitted')
            .addFields(
                { name: '📝 Description', value: proofDescription },
                { name: '🔗 Links', value: proofLinks },
                { name: '⏰ Submitted', value: new Date().toLocaleString() }
            )
            .setColor(0x00FF00);

        await interaction.reply({ embeds: [embed] });

        // Notify buyer
        const transaction = await this.db.getTransaction(transactionId);
        await interaction.followUp({ 
            content: `<@${transaction.buyer_id}> The seller has submitted delivery proof. Please review and confirm when ready.` 
        });
    }

    async showReportModal(interaction) {
        const listingId = interaction.customId.split('_')[2];

        const modal = new ModalBuilder()
            .setCustomId(`report_modal_${listingId}`)
            .setTitle('🚨 Report Listing');

        const reason = new TextInputBuilder()
            .setCustomId('report_reason')
            .setLabel('Report Reason')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Scam, inappropriate content, false listing, etc.');

        const details = new TextInputBuilder()
            .setCustomId('report_details')
            .setLabel('Additional Details')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setPlaceholder('Provide any additional information...');

        modal.addComponents(
            new ActionRowBuilder().addComponents(reason),
            new ActionRowBuilder().addComponents(details)
        );

        await interaction.showModal(modal);
    }

    async handleReportSubmission(interaction) {
        const listingId = interaction.customId.split('_')[2];
        const reason = interaction.fields.getTextInputValue('report_reason');
        const details = interaction.fields.getTextInputValue('report_details') || 'No additional details';

        const reportId = `report_${Date.now()}_${interaction.user.id}`;
        
        await this.db.run(`
            INSERT INTO reports (id, listing_id, reporter_id, reporter_tag, reason, details, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            reportId, listingId, interaction.user.id, interaction.user.tag, 
            reason, details, 'open', new Date().toISOString()
        ]);

        await interaction.reply({ 
            content: '✅ Report submitted successfully. Admins have been notified.', 
            ephemeral: true 
        });

        // Notify admins
        this.notifyAdminsOfReport(reportId, interaction.guild);
    }

    async handleAdminButton(interaction) {
        if (!this.isAdmin(interaction.member)) {
            return await interaction.reply({ content: '❌ Admin access required!', ephemeral: true });
        }

        const customId = interaction.customId;

        if (customId === 'admin_pending_listings') {
            const pendingListings = await this.db.all(
                'SELECT * FROM listings WHERE status = "pending_approval" ORDER BY created_at ASC LIMIT 10'
            );

            if (pendingListings.length === 0) {
                return await interaction.reply({ 
                    content: '✅ No pending listings!', 
                    ephemeral: true 
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('⏳ Pending Listings')
                .setColor(0xFFA500)
                .setDescription(`${pendingListings.length} listings awaiting approval`);

            pendingListings.forEach((listing, index) => {
                embed.addFields({
                    name: `${index + 1}. ${listing.item_name}`,
                    value: `**Seller:** <@${listing.seller_id}>\n**Price:** ${listing.price}\n**Created:** ${new Date(listing.created_at).toLocaleDateString()}`,
                    inline: false
                });
            });

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }

    // Utility methods
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

    async checkAndAwardBadges(userId, totalSales, avgRating) {
        const badges = [];
        
        if (totalSales >= 200 && avgRating >= 4.5) badges.push('veteran');
        else if (totalSales >= 100 && avgRating >= 4.8) badges.push('top_seller');
        else if (totalSales >= 50 && avgRating >= 4.5) badges.push('trusted');
        else if (totalSales >= 25 && avgRating >= 4.7) badges.push('rising_star');
        else if (totalSales >= 10 && avgRating >= 4.0) badges.push('verified');

        if (badges.length > 0) {
            await this.db.updateUserMetrics(userId, {
                badges: JSON.stringify(badges)
            });

            // Notify user of new badges
            try {
                const user = await this.client.users.fetch(userId);
                await user.send(`🎉 Congratulations! You've earned new badges: ${badges.join(', ')}`);
            } catch (error) {
                this.logger.warn('Could not notify user of new badges');
            }
        }
    }

    async notifyAdminsOfReport(reportId, guild) {
        const report = await this.db.get('SELECT * FROM reports WHERE id = ?', [reportId]);
        const listing = await this.db.getListing(report.listing_id);

        const embed = new EmbedBuilder()
            .setTitle('🚨 New Report Submitted')
            .addFields(
                { name: '📦 Item', value: listing ? listing.item_name : 'Unknown', inline: true },
                { name: '👤 Reporter', value: `<@${report.reporter_id}>`, inline: true },
                { name: '📝 Reason', value: report.reason, inline: true },
                { name: '📋 Details', value: report.details, inline: false }
            )
            .setColor(0xFF0000)
            .setTimestamp();

        const adminChannels = guild.channels.cache.filter(channel => 
            channel.name.includes('admin') || channel.name.includes('mod')
        );

        if (adminChannels.size > 0) {
            await adminChannels.first().send({ embeds: [embed] });
        }
    }
}

module.exports = InteractionHandler;
