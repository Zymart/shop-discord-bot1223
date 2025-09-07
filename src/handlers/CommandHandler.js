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
                searchText = searchText.replace(/rating:>\d+(?:\.\d+)?/g, '').trim
