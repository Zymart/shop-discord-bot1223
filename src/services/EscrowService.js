const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');

class EscrowService {
    constructor(client, database, logger) {
        this.client = client;
        this.db = database;
        this.logger = logger;
    }

    async createTransactionThread(transaction, parentChannel) {
        try {
            const thread = await parentChannel.threads.create({
                name: `🔒 ${transaction.itemName} - ${transaction.buyerTag}`,
                type: ChannelType.PrivateThread,
                invitable: false,
                reason: `Secure transaction for ${transaction.itemName}`
            });

            // Add participants
            await thread.members.add(transaction.buyerId);
            await thread.members.add(transaction.sellerId);

            // Create initial escrow message
            const embed = await this.createEscrowEmbed(transaction);
            const buttons = this.createEscrowButtons(transaction);

            await thread.send({ embeds: [embed], components: [buttons] });

            // Send transaction guide
            await this.sendTransactionGuide(thread, transaction);

            this.logger.info(`Created secure transaction thread: ${thread.id} for transaction: ${transaction.id}`);
            return thread;

        } catch (error) {
            this.logger.error('Error creating transaction thread:', error);
            throw error;
        }
    }

    async createEscrowEmbed(transaction) {
        const embed = new EmbedBuilder()
            .setTitle('🔒 Secure Escrow Transaction')
            .setDescription('**Your transaction is protected by our escrow system**')
            .addFields(
                { name: '📦 Item', value: transaction.itemName, inline: true },
                { name: '💰 Amount', value: `$${transaction.price}`, inline: true },
                { name: '🛡️ Protection', value: 'Full Escrow', inline: true },
                { name: '👤 Buyer', value: `<@${transaction.buyerId}>`, inline: true },
                { name: '👤 Seller', value: `<@${transaction.sellerId}>`, inline: true },
                { name: '📋 Status', value: this.getStatusDisplay(transaction.escrowStage), inline: true },
                { name: '⏱️ Created', value: new Date(transaction.createdAt).toLocaleString(), inline: false }
            )
            .setColor(0x00AE86)
            .setTimestamp()
            .setFooter({ text: `Secure Transaction ID: ${transaction.id}` });

        // Add escrow process
        const processSteps = this.getEscrowProcessSteps(transaction);
        embed.addFields({ name: '📋 Escrow Process', value: processSteps, inline: false });

        return embed;
    }

    createEscrowButtons(transaction) {
        const buttons = new ActionRowBuilder();

        if (transaction.requiresProof) {
            buttons.addComponents(
                new ButtonBuilder()
                    .setCustomId(`proof_submit_${transaction.id}`)
                    .setLabel('Submit Proof (Seller)')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📸'),
                new ButtonBuilder()
                    .setCustomId(`confirm_delivery_${transaction.id}`)
                    .setLabel('Confirm Delivery (Buyer)')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`dispute_${transaction.id}`)
                    .setLabel('Open Dispute')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⚠️')
            );
        } else {
            buttons.addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_delivery_${transaction.id}`)
                    .setLabel('Confirm Delivery')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`dispute_${transaction.id}`)
                    .setLabel('Open Dispute')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⚠️')
            );
        }

        return buttons;
    }

    getStatusDisplay(escrowStage) {
        const statusMap = {
            'awaiting_payment': '⏳ Awaiting Payment Confirmation',
            'payment_confirmed': '💰 Payment Confirmed',
            'awaiting_delivery': '📦 Awaiting Item Delivery',
            'proof_submitted': '📸 Proof Submitted - Buyer Review',
            'delivery_confirmed': '✅ Delivery Confirmed',
            'completed': '🎉 Transaction Complete',
            'disputed': '⚠️ Under Dispute Review'
        };

        return statusMap[escrowStage] || escrowStage;
    }

    getEscrowProcessSteps(transaction) {
        const steps = [];
        
        if (transaction.requiresProof) {
            steps.push(
                '1️⃣ **Payment** - Buyer confirms payment method',
                '2️⃣ **Delivery** - Seller delivers item',
                '3️⃣ **Proof** - Seller provides delivery proof',
                '4️⃣ **Confirmation** - Buyer confirms receipt',
                '5️⃣ **Release** - Payment released to seller'
            );
        } else {
            steps.push(
                '1️⃣ **Payment** - Buyer confirms payment',
                '2️⃣ **Delivery** - Seller delivers item',
                '3️⃣ **Confirmation** - Buyer confirms receipt',
                '4️⃣ **Release** - Payment released to seller'
            );
        }

        return steps.join('\n');
    }

    async sendTransactionGuide(thread, transaction) {
        const guideEmbed = new EmbedBuilder()
            .setTitle('📚 Transaction Guide')
            .setDescription('**How to complete your secure transaction:**')
            .addFields(
                {
                    name: '👤 For the Buyer',
                    value: `• Confirm you're ready to pay for **${transaction.itemName}**\n` +
                           `• Wait for seller to deliver the item\n` +
                           `• ${transaction.requiresProof ? 'Review delivery proof when provided\n' : ''}` +
                           `• Click "Confirm Delivery" when you receive the item\n` +
                           `• Rate your experience (helps build seller reputation)`,
                    inline: false
                },
                {
                    name: '🛒 For the Seller',
                    value: `• Wait for buyer payment confirmation\n` +
                           `• Deliver **${transaction.itemName}** as described\n` +
                           `• ${transaction.requiresProof ? 'Submit delivery proof (screenshots, confirmation numbers)\n' : ''}` +
                           `• Payment will be released once buyer confirms delivery\n` +
                           `• Maintain good communication throughout`,
                    inline: false
                },
                {
                    name: '🛡️ Escrow Protection',
                    value: `• Your payment is held securely until delivery is confirmed\n` +
                           `• Both parties are protected against fraud\n` +
                           `• Disputes are handled by experienced moderators\n` +
                           `• All transactions are logged for security`,
                    inline: false
                },
                {
                    name: '⚠️ Important Notes',
                    value: `• **DO NOT** send payment outside this system\n` +
                           `• Keep all communication in this thread\n` +
                           `• Report any suspicious behavior immediately\n` +
                           `• Contact admins if you need help`,
                    inline: false
                }
            )
            .setColor(0x3498DB)
            .setFooter({ text: 'Secure Trading • Enhanced Shop Bot' });

        await thread.send({ embeds: [guideEmbed] });
    }

    async completeTransaction(transactionId, interaction) {
        try {
            const transaction = await this.db.getTransaction(transactionId);
            
            if (!transaction) {
                throw new Error('Transaction not found');
            }

            // Update transaction status
            await this.db.updateTransaction(transactionId, {
                status: 'completed',
                escrow_stage: 'completed',
                completed_at: new Date().toISOString()
            });

            // Update user metrics
            await this.updateUserMetrics(transaction);

            // Create completion embed
            const completionEmbed = new EmbedBuilder()
                .setTitle('🎉 Transaction Completed Successfully!')
                .addFields(
                    { name: '📦 Item', value: transaction.item_name, inline: true },
                    { name: '💰 Amount', value: `$${transaction.price}`, inline: true },
                    { name: '✅ Status', value: 'Payment Released', inline: true },
                    { name: '⏰ Completed', value: new Date().toLocaleString(), inline: true },
                    { name: '🎯 Next Steps', value: 'Please rate your experience below', inline: false }
                )
                .setColor(0x00FF00)
                .setTimestamp()
                .setFooter({ text: 'Thank you for using our secure trading platform!' });

            // Create rating buttons
            const ratingButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`rate_1_${transactionId}`)
                        .setLabel('1⭐')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`rate_2_${transactionId}`)
                        .setLabel('2⭐')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`rate_3_${transactionId}`)
                        .setLabel('3⭐')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`rate_4_${transactionId}`)
                        .setLabel('4⭐')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`rate_5_${transactionId}`)
                        .setLabel('5⭐')
                        .setStyle(ButtonStyle.Success)
                );

            await interaction.update({ embeds: [completionEmbed], components: [ratingButtons] });

            // Notify participants
            await this.notifyTransactionComplete(transaction);

            // Schedule thread archival
            this.scheduleThreadArchival(interaction.channel, 300000); // 5 minutes

            this.logger.info(`Transaction completed: ${transactionId}`);

        } catch (error) {
            this.logger.error('Error completing transaction:', error);
            throw error;
        }
    }

    async updateUserMetrics(transaction) {
        try {
            // Update seller metrics
            const sellerMetrics = await this.db.getUserMetrics(transaction.seller_id);
            await this.db.updateUserMetrics(transaction.seller_id, {
                total_sales: (sellerMetrics.total_sales || 0) + 1,
                total_revenue: (sellerMetrics.total_revenue || 0) + transaction.price,
                last_activity: new Date().toISOString()
            });

            // Update buyer metrics
            const buyerMetrics = await this.db.getUserMetrics(transaction.buyer_id);
            await this.db.updateUserMetrics(transaction.buyer_id, {
                total_purchases: (buyerMetrics.total_purchases || 0) + 1,
                total_spent: (buyerMetrics.total_spent || 0) + transaction.price,
                last_activity: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('Error updating user metrics:', error);
        }
    }

    async notifyTransactionComplete(transaction) {
        try {
            // Notify seller
            const seller = await this.client.users.fetch(transaction.seller_id);
            const sellerEmbed = new EmbedBuilder()
                .setTitle('💰 Payment Released!')
                .setDescription(`Your transaction for **${transaction.item_name}** has been completed.`)
                .addFields(
                    { name: 'Amount Received', value: `$${transaction.price}`, inline: true },
                    { name: 'Buyer', value: transaction.buyer_tag, inline: true }
                )
                .setColor(0x00FF00)
                .setTimestamp();

            await seller.send({ embeds: [sellerEmbed] });

            // Notify buyer
            const buyer = await this.client.users.fetch(transaction.buyer_id);
            const buyerEmbed = new EmbedBuilder()
                .setTitle('✅ Transaction Complete!')
                .setDescription(`Thank you for your purchase of **${transaction.item_name}**.`)
                .addFields(
                    { name: 'Amount Paid', value: `$${transaction.price}`, inline: true },
                    { name: 'Seller', value: transaction.seller_tag, inline: true }
                )
                .setColor(0x00FF00)
                .setTimestamp();

            await buyer.send({ embeds: [buyerEmbed] });

        } catch (error) {
            this.logger.warn('Could not send transaction completion notifications');
        }
    }

    async handleDisputeEscalation(disputeId, transactionId, reason) {
        try {
            // Update transaction to disputed state
            await this.db.updateTransaction(transactionId, {
                status: 'disputed',
                escrow_stage: 'disputed',
                disputed_at: new Date().toISOString()
            });

            // Create dispute record with enhanced details
            const transaction = await this.db.getTransaction(transactionId);
            const dispute = {
                id: disputeId,
                transaction_id: transactionId,
                item_name: transaction.item_name,
                buyer_id: transaction.buyer_id,
                seller_id: transaction.seller_id,
                disputed_by: reason.disputedBy,
                reason: reason.reason || 'Dispute opened',
                priority: transaction.price > 100 ? 'high' : 'normal',
                status: 'open',
                created_at: new Date().toISOString(),
                escrow_amount: transaction.price,
                proof_submitted: transaction.proof_submitted
            };

            await this.db.run(`
                INSERT INTO disputes (id, transaction_id, item_name, buyer_id, seller_id, disputed_by, reason, priority, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                dispute.id, dispute.transaction_id, dispute.item_name, dispute.buyer_id,
                dispute.seller_id, dispute.disputed_by, dispute.reason, dispute.priority,
                dispute.status, dispute.created_at
            ]);

            this.logger.info(`Dispute escalated: ${disputeId} for transaction: ${transactionId}`);
            return dispute;

        } catch (error) {
            this.logger.error('Error handling dispute escalation:', error);
            throw error;
        }
    }

    async resolveDispute(disputeId, resolution, adminId) {
        try {
            const dispute = await this.db.get('SELECT * FROM disputes WHERE id = ?', [disputeId]);
            
            if (!dispute) {
                throw new Error('Dispute not found');
            }

            const transaction = await this.db.getTransaction(dispute.transaction_id);

            // Update dispute status
            await this.db.run(`
                UPDATE disputes 
                SET status = 'resolved', resolved_at = ?, resolved_by = ?, resolution = ?
                WHERE id = ?
            `, [new Date().toISOString(), adminId, resolution, disputeId]);

            // Handle resolution based on decision
            if (resolution === 'buyer_favor') {
                await this.handleBuyerFavorResolution(transaction);
            } else if (resolution === 'seller_favor') {
                await this.handleSellerFavorResolution(transaction);
            }

            // Update transaction status
            await this.db.updateTransaction(dispute.transaction_id, {
                status: 'resolved_admin',
                resolved_at: new Date().toISOString(),
                resolved_by: adminId
            });

            this.logger.info(`Dispute resolved: ${disputeId} in favor of ${resolution}`);

        } catch (error) {
            this.logger.error('Error resolving dispute:', error);
            throw error;
        }
    }

    async handleBuyerFavorResolution(transaction) {
        // In buyer favor - refund process
        try {
            const buyer = await this.client.users.fetch(transaction.buyer_id);
            const refundEmbed = new EmbedBuilder()
                .setTitle('💰 Dispute Resolved - Refund Processed')
                .setDescription(`Your dispute for **${transaction.item_name}** has been resolved in your favor.`)
                .addFields({ name: 'Refund Amount', value: `$${transaction.price}`, inline: true })
                .setColor(0x00FF00);

            await buyer.send({ embeds: [refundEmbed] });

        } catch (error) {
            this.logger.warn('Could not notify buyer of refund');
        }
    }

    async handleSellerFavorResolution(transaction) {
        // In seller favor - payment release
        try {
            const seller = await this.client.users.fetch(transaction.seller_id);
            const paymentEmbed = new EmbedBuilder()
                .setTitle('💰 Dispute Resolved - Payment Released')
                .setDescription(`Your dispute for **${transaction.item_name}** has been resolved in your favor.`)
                .addFields({ name: 'Payment Amount', value: `$${transaction.price}`, inline: true })
                .setColor(0x00FF00);

            await seller.send({ embeds: [paymentEmbed] });

        } catch (error) {
            this.logger.warn('Could not notify seller of payment release');
        }
    }

    scheduleThreadArchival(thread, delay = 300000) {
        setTimeout(async () => {
            try {
                if (!thread.archived) {
                    await thread.setArchived(true, 'Transaction completed - auto-archived');
                    this.logger.info(`Thread archived: ${thread.id}`);
                }
            } catch (error) {
                this.logger.warn('Could not archive thread:', error);
            }
        }, delay);
    }

    async getTransactionSummary(transactionId) {
        try {
            const transaction = await this.db.getTransaction(transactionId);
            
            if (!transaction) {
                return null;
            }

            const summary = {
                id: transaction.id,
                item: transaction.item_name,
                amount: transaction.price,
                buyer: transaction.buyer_tag,
                seller: transaction.seller_tag,
                status: transaction.status,
                created: new Date(transaction.created_at).toLocaleString(),
                completed: transaction.completed_at ? new Date(transaction.completed_at).toLocaleString() : null,
                escrowStage: this.getStatusDisplay(transaction.escrow_stage),
                proofRequired: transaction.requires_proof,
                proofSubmitted: transaction.proof_submitted
            };

            return summary;

        } catch (error) {
            this.logger.error('Error getting transaction summary:', error);
            return null;
        }
    }

    async validateTransactionSecurity(transactionId) {
        try {
            const transaction = await this.db.getTransaction(transactionId);
            
            if (!transaction) {
                return { valid: false, reason: 'Transaction not found' };
            }

            const validationChecks = [];

            // Check if transaction is too old
            const ageHours = (Date.now() - new Date(transaction.created_at).getTime()) / (1000 * 60 * 60);
            if (ageHours > 168) { // 7 days
                validationChecks.push({ 
                    check: 'age', 
                    passed: false, 
                    message: 'Transaction older than 7 days' 
                });
            } else {
                validationChecks.push({ 
                    check: 'age', 
                    passed: true, 
                    message: 'Transaction age is acceptable' 
                });
            }

            // Check if participants are still valid
            try {
                await this.client.users.fetch(transaction.buyer_id);
                await this.client.users.fetch(transaction.seller_id);
                validationChecks.push({ 
                    check: 'participants', 
                    passed: true, 
                    message: 'All participants accessible' 
                });
            } catch (error) {
                validationChecks.push({ 
                    check: 'participants', 
                    passed: false, 
                    message: 'One or more participants not accessible' 
                });
            }

            // Check escrow stage validity
            const validStages = ['awaiting_payment', 'payment_confirmed', 'awaiting_delivery', 'proof_submitted', 'completed', 'disputed'];
            const stageValid = validStages.includes(transaction.escrow_stage);
            validationChecks.push({ 
                check: 'escrow_stage', 
                passed: stageValid, 
                message: stageValid ? 'Escrow stage is valid' : 'Invalid escrow stage' 
            });

            const allPassed = validationChecks.every(check => check.passed);

            return {
                valid: allPassed,
                checks: validationChecks,
                transaction: transaction
            };

        } catch (error) {
            this.logger.error('Error validating transaction security:', error);
            return { valid: false, reason: 'Validation error occurred' };
        }
    }

    async generateEscrowReport(guildId, days = 30) {
        try {
            const dateLimit = new Date();
            dateLimit.setDate(dateLimit.getDate() - days);

            const stats = await this.db.get(`
                SELECT 
                    COUNT(*) as total_transactions,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_transactions,
                    COUNT(CASE WHEN status = 'disputed' THEN 1 END) as disputed_transactions,
                    SUM(CASE WHEN status = 'completed' THEN price ELSE 0 END) as total_volume,
                    AVG(CASE WHEN status = 'completed' THEN 
                        (julianday(completed_at) - julianday(created_at)) * 24 ELSE NULL END) as avg_completion_hours
                FROM transactions 
                WHERE created_at >= ?
            `, [dateLimit.toISOString()]);

            const disputeRate = stats.total_transactions > 0 ? 
                (stats.disputed_transactions / stats.total_transactions * 100).toFixed(2) : 0;

            const successRate = stats.total_transactions > 0 ? 
                (stats.completed_transactions / stats.total_transactions * 100).toFixed(2) : 0;

            return {
                period: `${days} days`,
                totalTransactions: stats.total_transactions,
                completedTransactions: stats.completed_transactions,
                disputedTransactions: stats.disputed_transactions,
                totalVolume: parseFloat(stats.total_volume || 0).toFixed(2),
                avgCompletionTime: parseFloat(stats.avg_completion_hours || 0).toFixed(1),
                disputeRate: parseFloat(disputeRate),
                successRate: parseFloat(successRate),
                generatedAt: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('Error generating escrow report:', error);
            return null;
        }
    }

    async getActiveTransactions(userId = null) {
        try {
            let query = `
                SELECT * FROM transactions 
                WHERE status IN ('pending_payment', 'pending_delivery', 'disputed')
                ORDER BY created_at DESC
            `;
            let params = [];

            if (userId) {
                query = `
                    SELECT * FROM transactions 
                    WHERE (buyer_id = ? OR seller_id = ?) 
                    AND status IN ('pending_payment', 'pending_delivery', 'disputed')
                    ORDER BY created_at DESC
                `;
                params = [userId, userId];
            }

            const transactions = await this.db.all(query, params);

            return transactions.map(tx => ({
                id: tx.id,
                item: tx.item_name,
                amount: tx.price,
                buyer: tx.buyer_tag,
                seller: tx.seller_tag,
                status: this.getStatusDisplay(tx.escrow_stage),
                created: new Date(tx.created_at).toLocaleDateString(),
                requiresProof: tx.requires_proof,
                proofSubmitted: tx.proof_submitted
            }));

        } catch (error) {
            this.logger.error('Error getting active transactions:', error);
            return [];
        }
    }

    async emergencyStopTransaction(transactionId, adminId, reason) {
        try {
            const transaction = await this.db.getTransaction(transactionId);
            
            if (!transaction) {
                throw new Error('Transaction not found');
            }

            // Update transaction to emergency stopped
            await this.db.updateTransaction(transactionId, {
                status: 'emergency_stopped',
                stopped_at: new Date().toISOString(),
                stopped_by: adminId,
                stop_reason: reason
            });

            // Log the emergency stop
            this.logger.warn(`EMERGENCY STOP: Transaction ${transactionId} stopped by ${adminId}. Reason: ${reason}`);

            // Notify participants
            await this.notifyEmergencyStop(transaction, reason);

            return true;

        } catch (error) {
            this.logger.error('Error in emergency stop:', error);
            throw error;
        }
    }

    async notifyEmergencyStop(transaction, reason) {
        const embed = new EmbedBuilder()
            .setTitle('🛑 Transaction Emergency Stop')
            .setDescription(`Your transaction for **${transaction.item_name}** has been emergency stopped by an administrator.`)
            .addFields(
                { name: 'Reason', value: reason, inline: false },
                { name: 'Next Steps', value: 'Please contact an administrator for assistance.', inline: false }
            )
            .setColor(0xFF0000)
            .setTimestamp();

        try {
            const buyer = await this.client.users.fetch(transaction.buyer_id);
            const seller = await this.client.users.fetch(transaction.seller_id);

            await buyer.send({ embeds: [embed] });
            await seller.send({ embeds: [embed] });

        } catch (error) {
            this.logger.warn('Could not notify participants of emergency stop');
        }
    }
}

module.exports = EscrowService;
