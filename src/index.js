require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Database = require('./database/Database');
const CommandHandler = require('./handlers/CommandHandler');
const InteractionHandler = require('./handlers/InteractionHandler');
const EventHandler = require('./handlers/EventHandler');
const ScheduledTasks = require('./services/ScheduledTasks');
const Logger = require('./utils/Logger');

class DiscordShopBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.MessageReactions
            ]
        });

        this.database = new Database();
        this.logger = new Logger();
        
        // Initialize handlers
        this.commandHandler = new CommandHandler(this.client, this.database, this.logger);
        this.interactionHandler = new InteractionHandler(this.client, this.database, this.logger);
        this.eventHandler = new EventHandler(this.client, this.database, this.logger);
        this.scheduledTasks = new ScheduledTasks(this.client, this.database, this.logger);

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Bot ready event
        this.client.once('ready', async () => {
            this.logger.info(`🚀 ${this.client.user.tag} is online!`);
            this.logger.info(`📊 Serving ${this.client.guilds.cache.size} servers`);
            this.logger.info(`👥 Watching ${this.client.users.cache.size} users`);
            
            // Initialize database
            await this.database.initialize();
            
            // Start scheduled tasks
            this.scheduledTasks.start();
            
            // Set bot status
            this.client.user.setActivity('🛒 Managing marketplace', { type: 'WATCHING' });
        });

        // Message events
        this.client.on('messageCreate', async (message) => {
            await this.commandHandler.handleMessage(message);
        });

        // Interaction events
        this.client.on('interactionCreate', async (interaction) => {
            await this.interactionHandler.handleInteraction(interaction);
        });

        // Other events
        this.client.on('guildMemberAdd', async (member) => {
            await this.eventHandler.handleMemberJoin(member);
        });

        this.client.on('guildCreate', async (guild) => {
            await this.eventHandler.handleGuildJoin(guild);
        });

        // Error handling
        this.client.on('error', (error) => {
            this.logger.error('Discord client error:', error);
        });

        this.client.on('warn', (warning) => {
            this.logger.warn('Discord client warning:', warning);
        });

        // Process error handling
        process.on('unhandledRejection', (reason, promise) => {
            this.logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        });

        process.on('uncaughtException', (error) => {
            this.logger.error('Uncaught Exception:', error);
            process.exit(1);
        });

        // Graceful shutdown
        process.on('SIGINT', () => {
            this.logger.info('Received SIGINT. Graceful shutdown...');
            this.shutdown();
        });

        process.on('SIGTERM', () => {
            this.logger.info('Received SIGTERM. Graceful shutdown...');
            this.shutdown();
        });
    }

    async shutdown() {
        this.logger.info('Shutting down bot...');
        
        try {
            // Stop scheduled tasks
            this.scheduledTasks.stop();
            
            // Close database connection
            await this.database.close();
            
            // Destroy Discord client
            await this.client.destroy();
            
            this.logger.info('Bot shutdown complete');
            process.exit(0);
        } catch (error) {
            this.logger.error('Error during shutdown:', error);
            process.exit(1);
        }
    }

    async start() {
        try {
            const token = process.env.DISCORD_TOKEN;
            
            if (!token) {
                throw new Error('DISCORD_TOKEN environment variable is required');
            }

            this.logger.info('Starting Discord Shop Bot...');
            await this.client.login(token);
            
        } catch (error) {
            this.logger.error('Failed to start bot:', error);
            process.exit(1);
        }
    }
}

// Start the bot
const bot = new DiscordShopBot();
bot.start();

module.exports = DiscordShopBot;
