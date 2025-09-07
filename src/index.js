require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Database = require('./database/Database');
const CommandHandler = require('./handlers/CommandHandler');
const InteractionHandler = require('./handlers/InteractionHandler');
const EventHandler = require('./handlers/EventHandler');
const ScheduledTasks = require('./services/ScheduledTasks');
const BackupService = require('./services/BackupService');
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
        this.backupService = new BackupService(this.database, this.logger);
        
        // Initialize handlers
        this.commandHandler = new CommandHandler(this.client, this.database, this.logger);
        this.interactionHandler = new InteractionHandler(this.client, this.database, this.logger);
        this.eventHandler = new EventHandler(this.client, this.database, this.logger);
        this.scheduledTasks = new ScheduledTasks(this.client, this.database, this.logger);

        this.setupEventListeners();
        this.setupBackupIntegration();
    }

    setupEventListeners() {
        // Bot ready event
        this.client.once('ready', async () => {
            this.logger.info(`🚀 ${this.client.user.tag} is online!`);
            this.logger.info(`📊 Serving ${this.client.guilds.cache.size} servers`);
            this.logger.info(`👥 Watching ${this.client.users.cache.size} users`);
            
            // Initialize database
            await this.database.initialize();
            
            // Create initial backup
            try {
                const initialBackup = await this.backupService.createFullBackup();
                this.logger.info('✅ Initial backup created successfully');
            } catch (error) {
                this.logger.warn('⚠️ Initial backup failed:', error);
            }
            
            // Start scheduled tasks (includes backup scheduling)
            this.scheduledTasks.start();
            this.backupService.scheduleBackups();
            
            // Set bot status
            this.client.user.setActivity('🛒 Managing marketplace | Backup Protected', { type: 'WATCHING' });
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
            // Create backup when joining new guild
            setTimeout(() => this.backupService.createFullBackup().catch(() => {}), 5000);
        });

        // Error handling
        this.client.on('error', (error) => {
            this.logger.error('Discord client error:', error);
            // Emergency backup on critical errors
            this.emergencyBackup();
        });

        this.client.on('warn', (warning) => {
            this.logger.warn('Discord client warning:', warning);
        });

        // Process error handling
        process.on('unhandledRejection', (reason, promise) => {
            this.logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
            this.emergencyBackup();
        });

        process.on('uncaughtException', (error) => {
            this.logger.error('Uncaught Exception:', error);
            this.emergencyBackup();
            process.exit(1);
        });

        // Graceful shutdown with backup
        process.on('SIGINT', () => {
            this.logger.info('Received SIGINT. Creating final backup before shutdown...');
            this.shutdown();
        });

        process.on('SIGTERM', () => {
            this.logger.info('Received SIGTERM. Creating final backup before shutdown...');
            this.shutdown();
        });

        // Railway-specific events
        process.on('SIGUSR1', () => {
            this.logger.info('Received SIGUSR1 (Railway restart signal). Creating backup...');
            this.emergencyBackup().then(() => {
                process.exit(0);
            });
        });
    }

    setupBackupIntegration() {
        // Add backup commands to command handler
        const originalHandleMessage = this.commandHandler.handleMessage.bind(this.commandHandler);
        
        this.commandHandler.handleMessage = async (message) => {
            if (message.content.startsWith('!backup')) {
                await this.handleBackupCommands(message);
                return;
            }
            return await originalHandleMessage(message);
        };
    }

    async handleBackupCommands(message) {
        const args = message.content.split(' ');
        const command = args[1];

        // Check if user is admin
        if (!this.isAdmin(message.member)) {
            return await message.reply('❌ You need admin permissions to use backup commands!');
        }

        try {
            switch (command) {
                case 'create':
                    await message.reply('🔄 Creating full backup...');
                    const result = await this.backupService.createFullBackup();
                    await message.reply(`✅ Backup created successfully!\n📊 Destinations: ${result.destinations}\n📁 Size: ${this.formatFileSize(result.metadata.backupSize)}`);
                    break;

                case 'status':
                    const status = await this.backupService.getBackupStatus();
                    const embed = {
                        title: '💾 Backup Status',
                        fields: [
                            { name: 'Enabled', value: status.enabled ? '✅ Yes' : '❌ No', inline: true },
                            { name: 'Destinations', value: status.destinations.join(', ') || 'None', inline: true },
                            { name: 'Last Backup', value: new Date(status.lastBackup).toLocaleString(), inline: true },
                            { name: 'Schedule', value: status.nextBackup, inline: false }
                        ],
                        color: status.enabled ? 0x00FF00 : 0xFF0000,
                        timestamp: new Date().toISOString()
                    };
                    await message.reply({ embeds: [embed] });
                    break;

                case 'restore':
                    await message.reply('⚠️ Backup restoration should be done manually. Please contact support for assistance.');
                    break;

                case 'test':
                    await message.reply('🧪 Testing backup systems...');
                    const testData = { test: true, timestamp: new Date().toISOString() };
                    const testResults = await Promise.allSettled([
                        this.backupService.saveToDiscord(JSON.stringify(testData), 'test-backup.json'),
                        this.backupService.saveToGitHub(JSON.stringify(testData), 'test/test-backup.json')
                    ]);
                    
                    const successful = testResults.filter(r => r.status === 'fulfilled').length;
                    await message.reply(`🧪 Test completed: ${successful}/${testResults.length} backup destinations working`);
                    break;

                default:
                    await message.reply(`💾 **Backup Commands:**
\`!backup create\` - Create immediate full backup
\`!backup status\` - Show backup configuration
\`!backup test\` - Test backup systems
\`!backup restore\` - Get restoration help

**Automatic Backups:**
• Full backup every 6 hours
• Incremental backup every hour
• Emergency backup on errors/shutdown`);
            }

        } catch (error) {
            this.logger.error('Backup command error:', error);
            await message.reply(`❌ Backup command failed: ${error.message}`);
        }
    }

    async emergencyBackup() {
        try {
            this.logger.info('🚨 Creating emergency backup...');
            await this.backupService.createFullBackup();
            this.logger.info('✅ Emergency backup completed');
        } catch (error) {
            this.logger.error('❌ Emergency backup failed:', error);
        }
    }

    async shutdown() {
        this.logger.info('Shutting down bot with backup...');
        
        try {
            // Create final backup before shutdown
            await this.backupService.createFullBackup();
            this.logger.info('✅ Final backup completed');
            
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

    isAdmin(member) {
        if (!member) return false;
        return member.permissions.has('Administrator') || 
               member.roles.cache.some(role => role.name.toLowerCase().includes('admin'));
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async start() {
        try {
            const token = process.env.DISCORD_TOKEN;
            
            if (!token) {
                throw new Error('DISCORD_TOKEN environment variable is required');
            }

            // Validate backup configuration
            const backupStatus = await this.backupService.getBackupStatus();
            if (!backupStatus.enabled) {
                this.logger.warn('⚠️ No backup destinations configured! Your data may be lost if Railway account is deleted.');
                this.logger.info('Configure backup environment variables for data protection.');
            } else {
                this.logger.info(`💾 Backup protection enabled: ${backupStatus.destinations.join(', ')}`);
            }

            this.logger.info('Starting Discord Shop Bot with backup protection...');
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
