const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, '../../logs');
        this.logFile = path.join(this.logDir, 'shopbot.log');
        this.errorFile = path.join(this.logDir, 'errors.log');
        this.backupFile = path.join(this.logDir, 'backups.log');
        
        // Ensure log directory exists
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }

        this.levels = {
            ERROR: 0,
            WARN: 1,
            INFO: 2,
            DEBUG: 3
        };

        this.currentLevel = process.env.NODE_ENV === 'development' ? this.levels.DEBUG : this.levels.INFO;
    }

    formatMessage(level, message, ...args) {
        const timestamp = new Date().toISOString();
        const formattedArgs = args.length > 0 ? ' ' + args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ') : '';
        
        return `[${timestamp}] [${level}] ${message}${formattedArgs}`;
    }

    writeToFile(filename, message) {
        try {
            fs.appendFileSync(filename, message + '\n');
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    error(message, ...args) {
        if (this.currentLevel >= this.levels.ERROR) {
            const formatted = this.formatMessage('ERROR', message, ...args);
            console.error(formatted);
            this.writeToFile(this.logFile, formatted);
            this.writeToFile(this.errorFile, formatted);
        }
    }

    warn(message, ...args) {
        if (this.currentLevel >= this.levels.WARN) {
            const formatted = this.formatMessage('WARN', message, ...args);
            console.warn(formatted);
            this.writeToFile(this.logFile, formatted);
        }
    }

    info(message, ...args) {
        if (this.currentLevel >= this.levels.INFO) {
            const formatted = this.formatMessage('INFO', message, ...args);
            console.log(formatted);
            this.writeToFile(this.logFile, formatted);
        }
    }

    debug(message, ...args) {
        if (this.currentLevel >= this.levels.DEBUG) {
            const formatted = this.formatMessage('DEBUG', message, ...args);
            console.log(formatted);
            this.writeToFile(this.logFile, formatted);
        }
    }

    backup(message, ...args) {
        const formatted = this.formatMessage('BACKUP', message, ...args);
        console.log(formatted);
        this.writeToFile(this.logFile, formatted);
        this.writeToFile(this.backupFile, formatted);
    }

    transaction(message, ...args) {
        const formatted = this.formatMessage('TRANSACTION', message, ...args);
        console.log(formatted);
        this.writeToFile(this.logFile, formatted);
    }

    security(message, ...args) {
        const formatted = this.formatMessage('SECURITY', message, ...args);
        console.warn(formatted);
        this.writeToFile(this.logFile, formatted);
        this.writeToFile(this.errorFile, formatted);
    }

    // Cleanup old log files (keep last 30 days)
    cleanupLogs() {
        try {
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            const files = fs.readdirSync(this.logDir);
            
            files.forEach(file => {
                const filePath = path.join(this.logDir, file);
                const stats = fs.statSync(filePath);
                
                if (stats.mtime.getTime() < thirtyDaysAgo) {
                    fs.unlinkSync(filePath);
                    this.info(`Cleaned up old log file: ${file}`);
                }
            });
        } catch (error) {
            this.error('Error cleaning up log files:', error);
        }
    }
}

module.exports = Logger;
