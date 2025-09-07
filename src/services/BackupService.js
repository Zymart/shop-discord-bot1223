const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

class BackupService {
    constructor(database, logger) {
        this.db = database;
        this.logger = logger;
        
        // Multiple backup destinations for redundancy
        this.backupConfig = {
            discord: {
                enabled: process.env.BACKUP_DISCORD_WEBHOOK || false,
                webhook: process.env.BACKUP_DISCORD_WEBHOOK,
                maxFileSize: 8 * 1024 * 1024 // 8MB Discord limit
            },
            github: {
                enabled: process.env.BACKUP_GITHUB_TOKEN || false,
                token: process.env.BACKUP_GITHUB_TOKEN,
                repo: process.env.BACKUP_GITHUB_REPO || 'yourusername/shopbot-backups',
                branch: 'main'
            },
            dropbox: {
                enabled: process.env.BACKUP_DROPBOX_TOKEN || false,
                token: process.env.BACKUP_DROPBOX_TOKEN
            },
            googleDrive: {
                enabled: process.env.BACKUP_GDRIVE_CREDENTIALS || false,
                credentials: process.env.BACKUP_GDRIVE_CREDENTIALS
            },
            webhook: {
                enabled: process.env.BACKUP_WEBHOOK_URL || false,
                url: process.env.BACKUP_WEBHOOK_URL,
                secret: process.env.BACKUP_WEBHOOK_SECRET
            }
        };

        this.compressionEnabled = true;
    }

    async createFullBackup() {
        try {
            this.logger.info('🔄 Creating full database backup...');

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupData = await this.exportFullDatabase();
            
            const backup = {
                timestamp,
                version: '2.0.0',
                type: 'full_backup',
                data: backupData,
                metadata: {
                    totalListings: backupData.listings?.length || 0,
                    totalTransactions: backupData.transactions?.length || 0,
                    totalUsers: backupData.userMetrics?.length || 0,
                    backupSize: JSON.stringify(backupData).length,
                    railwayInfo: {
                        projectId: process.env.RAILWAY_PROJECT_ID,
                        environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
                        deploymentId: process.env.RAILWAY_DEPLOYMENT_ID
                    }
                }
            };

            // Create multiple backup formats
            const jsonBackup = JSON.stringify(backup, null, 2);
            const compactBackup = JSON.stringify(backup);
            
            // SQL dump for easy restoration
            const sqlDump = await this.createSQLDump();

            const results = await Promise.allSettled([
                this.saveToDiscord(jsonBackup, `backup-${timestamp}.json`),
                this.saveToGitHub(jsonBackup, `backups/full-backup-${timestamp}.json`),
                this.saveToDropbox(compactBackup, `shopbot-backups/backup-${timestamp}.json`),
                this.saveToWebhook(backup),
                this.saveToGitHub(sqlDump, `sql-dumps/backup-${timestamp}.sql`)
            ]);

            const successfulBackups = results.filter(r => r.status === 'fulfilled').length;
            const failedBackups = results.filter(r => r.status === 'rejected');

            this.logger.info(`✅ Backup completed: ${successfulBackups}/${results.length} destinations successful`);

            if (failedBackups.length > 0) {
                this.logger.warn('⚠️ Some backups failed:', failedBackups.map(f => f.reason));
            }

            return {
                success: successfulBackups > 0,
                timestamp,
                destinations: successfulBackups,
                failures: failedBackups.length,
                metadata: backup.metadata
            };

        } catch (error) {
            this.logger.error('❌ Backup creation failed:', error);
            throw error;
        }
    }

    async exportFullDatabase() {
        try {
            const data = {};

            // Export all tables
            const tables = [
                'listings', 'transactions', 'user_ratings', 'user_metrics',
                'wishlists', 'followers', 'reports', 'disputes',
                'daily_stats', 'price_history', 'bot_config'
            ];

            for (const table of tables) {
                try {
                    data[table] = await this.db.all(`SELECT * FROM ${table}`);
                } catch (error) {
                    this.logger.warn(`⚠️ Could not export table ${table}:`, error);
                    data[table] = [];
                }
            }

            return data;

        } catch (error) {
            this.logger.error('Error exporting database:', error);
            throw error;
        }
    }

    async createSQLDump() {
        try {
            const tables = [
                'listings', 'transactions', 'user_ratings', 'user_metrics',
                'wishlists', 'followers', 'reports', 'disputes',
                'daily_stats', 'price_history', 'bot_config'
            ];

            let sqlDump = `-- Discord Shop Bot Database Backup\n`;
            sqlDump += `-- Created: ${new Date().toISOString()}\n`;
            sqlDump += `-- Version: 2.0.0\n\n`;

            for (const table of tables) {
                try {
                    const rows = await this.db.all(`SELECT * FROM ${table}`);
                    
                    if (rows.length === 0) continue;

                    sqlDump += `-- Table: ${table}\n`;
                    sqlDump += `DELETE FROM ${table};\n`;

                    for (const row of rows) {
                        const columns = Object.keys(row);
                        const values = Object.values(row).map(v => 
                            v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
                        );

                        sqlDump += `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});\n`;
                    }

                    sqlDump += `\n`;

                } catch (error) {
                    sqlDump += `-- Error exporting table ${table}: ${error.message}\n\n`;
                }
            }

            return sqlDump;

        } catch (error) {
            this.logger.error('Error creating SQL dump:', error);
            throw error;
        }
    }

    async saveToDiscord(data, filename) {
        if (!this.backupConfig.discord.enabled) {
            throw new Error('Discord backup not configured');
        }

        try {
            const webhook = this.backupConfig.discord.webhook;
            const fileBuffer = Buffer.from(data);

            if (fileBuffer.length > this.backupConfig.discord.maxFileSize) {
                // Split large files
                return await this.saveToDiscordSplit(data, filename);
            }

            const form = new FormData();
            form.append('file', fileBuffer, filename);
            form.append('content', `🗄️ **Database Backup** - ${filename}\n📊 Size: ${this.formatFileSize(fileBuffer.length)}\n⏰ Created: ${new Date().toLocaleString()}`);

            await axios.post(webhook, form, {
                headers: form.getHeaders()
            });

            this.logger.info(`✅ Discord backup saved: ${filename}`);
            return { platform: 'discord', filename, size: fileBuffer.length };

        } catch (error) {
            this.logger.error('Discord backup failed:', error);
            throw error;
        }
    }

    async saveToDiscordSplit(data, filename) {
        const chunkSize = 7 * 1024 * 1024; // 7MB chunks (under Discord limit)
        const chunks = [];
        
        for (let i = 0; i < data.length; i += chunkSize) {
            chunks.push(data.slice(i, i + chunkSize));
        }

        const webhook = this.backupConfig.discord.webhook;
        const results = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunkName = `${filename}.part${i + 1}of${chunks.length}`;
            const form = new FormData();
            form.append('file', Buffer.from(chunks[i]), chunkName);
            
            if (i === 0) {
                form.append('content', `🗄️ **Large Backup Split** (${chunks.length} parts)\n📁 ${filename}\n📊 Total Size: ${this.formatFileSize(data.length)}`);
            }

            await axios.post(webhook, form, {
                headers: form.getHeaders()
            });

            results.push({ part: i + 1, filename: chunkName });
            
            // Delay between chunks to avoid rate limits
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        this.logger.info(`✅ Discord split backup saved: ${chunks.length} parts`);
        return { platform: 'discord', filename, parts: results };
    }

    async saveToGitHub(data, filepath) {
        if (!this.backupConfig.github.enabled) {
            throw new Error('GitHub backup not configured');
        }

        try {
            const { token, repo, branch } = this.backupConfig.github;
            const content = Buffer.from(data).toString('base64');

            // Check if file exists
            let sha = null;
            try {
                const existingFile = await axios.get(`https://api.github.com/repos/${repo}/contents/${filepath}`, {
                    headers: { Authorization: `token ${token}` }
                });
                sha = existingFile.data.sha;
            } catch (error) {
                // File doesn't exist, that's fine
            }

            const payload = {
                message: `Backup: ${new Date().toISOString()}`,
                content,
                branch
            };

            if (sha) {
                payload.sha = sha;
            }

            await axios.put(`https://api.github.com/repos/${repo}/contents/${filepath}`, payload, {
                headers: { Authorization: `token ${token}` }
            });

            this.logger.info(`✅ GitHub backup saved: ${filepath}`);
            return { platform: 'github', filepath, repo };

        } catch (error) {
            this.logger.error('GitHub backup failed:', error);
            throw error;
        }
    }

    async saveToDropbox(data, filepath) {
        if (!this.backupConfig.dropbox.enabled) {
            throw new Error('Dropbox backup not configured');
        }

        try {
            const token = this.backupConfig.dropbox.token;

            await axios.post('https://content.dropboxapi.com/2/files/upload', data, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/octet-stream',
                    'Dropbox-API-Arg': JSON.stringify({
                        path: `/${filepath}`,
                        mode: 'overwrite',
                        autorename: true
                    })
                }
            });

            this.logger.info(`✅ Dropbox backup saved: ${filepath}`);
            return { platform: 'dropbox', filepath };

        } catch (error) {
            this.logger.error('Dropbox backup failed:', error);
            throw error;
        }
    }

    async saveToWebhook(backupData) {
        if (!this.backupConfig.webhook.enabled) {
            throw new Error('Webhook backup not configured');
        }

        try {
            const { url, secret } = this.backupConfig.webhook;
            
            const payload = {
                timestamp: new Date().toISOString(),
                type: 'database_backup',
                source: 'railway_shopbot',
                data: backupData,
                secret: secret
            };

            await axios.post(url, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });

            this.logger.info('✅ Webhook backup sent');
            return { platform: 'webhook', url };

        } catch (error) {
            this.logger.error('Webhook backup failed:', error);
            throw error;
        }
    }

    async restoreFromBackup(backupData) {
        try {
            this.logger.info('🔄 Restoring from backup...');

            if (typeof backupData === 'string') {
                backupData = JSON.parse(backupData);
            }

            const data = backupData.data || backupData;
            let restoredTables = 0;

            for (const [tableName, rows] of Object.entries(data)) {
                if (!Array.isArray(rows) || rows.length === 0) continue;

                try {
                    // Clear existing data (optional - comment out for merge)
                    // await this.db.run(`DELETE FROM ${tableName}`);

                    // Insert backup data
                    for (const row of rows) {
                        const columns = Object.keys(row);
                        const placeholders = columns.map(() => '?').join(', ');
                        const values = Object.values(row);

                        await this.db.run(
                            `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
                            values
                        );
                    }

                    restoredTables++;
                    this.logger.info(`✅ Restored table: ${tableName} (${rows.length} records)`);

                } catch (error) {
                    this.logger.error(`❌ Failed to restore table ${tableName}:`, error);
                }
            }

            this.logger.info(`✅ Backup restoration completed: ${restoredTables} tables restored`);
            return { success: true, tablesRestored: restoredTables };

        } catch (error) {
            this.logger.error('❌ Backup restoration failed:', error);
            throw error;
        }
    }

    async createIncrementalBackup() {
        try {
            this.logger.info('🔄 Creating incremental backup...');

            const lastBackup = await this.getLastBackupTimestamp();
            const changes = await this.getChangesSince(lastBackup);

            if (Object.keys(changes).length === 0) {
                this.logger.info('ℹ️ No changes since last backup');
                return { success: true, changes: 0 };
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const incrementalBackup = {
                timestamp,
                type: 'incremental_backup',
                since: lastBackup,
                changes,
                metadata: {
                    changedTables: Object.keys(changes).length,
                    totalChanges: Object.values(changes).reduce((sum, table) => sum + table.length, 0)
                }
            };

            await this.saveToGitHub(
                JSON.stringify(incrementalBackup, null, 2),
                `incremental/backup-${timestamp}.json`
            );

            this.logger.info(`✅ Incremental backup completed: ${incrementalBackup.metadata.totalChanges} changes`);
            return { success: true, ...incrementalBackup.metadata };

        } catch (error) {
            this.logger.error('❌ Incremental backup failed:', error);
            throw error;
        }
    }

    async getChangesSince(timestamp) {
        const changes = {};
        const tables = ['listings', 'transactions', 'user_ratings', 'user_metrics'];

        for (const table of tables) {
            try {
                let query = `SELECT * FROM ${table}`;
                let params = [];

                // Check if table has timestamp columns
                if (table === 'listings' || table === 'transactions') {
                    query += ` WHERE created_at > ? OR updated_at > ?`;
                    params = [timestamp, timestamp];
                } else if (timestamp) {
                    query += ` WHERE created_at > ?`;
                    params = [timestamp];
                }

                const rows = await this.db.all(query, params);
                if (rows.length > 0) {
                    changes[table] = rows;
                }

            } catch (error) {
                this.logger.warn(`Could not get changes for ${table}:`, error);
            }
        }

        return changes;
    }

    async getLastBackupTimestamp() {
        try {
            // Try to get from local storage first
            const lastBackup = await this.db.getGuildConfig('global', 'last_backup_timestamp');
            return lastBackup || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours ago default

        } catch (error) {
            return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        }
    }

    async scheduleBackups() {
        // Full backup every 6 hours
        setInterval(async () => {
            try {
                await this.createFullBackup();
                await this.db.setGuildConfig('global', 'last_backup_timestamp', new Date().toISOString());
            } catch (error) {
                this.logger.error('Scheduled backup failed:', error);
            }
        }, 6 * 60 * 60 * 1000);

        // Incremental backup every hour
        setInterval(async () => {
            try {
                await this.createIncrementalBackup();
            } catch (error) {
                this.logger.error('Incremental backup failed:', error);
            }
        }, 60 * 60 * 1000);

        this.logger.info('📅 Backup schedule started: Full (6h), Incremental (1h)');
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async getBackupStatus() {
        return {
            enabled: Object.values(this.backupConfig).some(config => config.enabled),
            destinations: Object.entries(this.backupConfig)
                .filter(([key, config]) => config.enabled)
                .map(([key]) => key),
            lastBackup: await this.getLastBackupTimestamp(),
            nextBackup: 'Every 6 hours (full) / Every hour (incremental)'
        };
    }
}

module.exports = BackupService;
