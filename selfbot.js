require('dotenv').config();
const axios = require('axios');
const readline = require('readline');

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bgRed: '\x1b[41m'
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function clearScreen() {
    console.clear();
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
}

function printHeader() {
    console.log(`${colors.cyan}${colors.bright}
       ██╗ █████╗ ██████╗ ██╗   ██╗███████╗███╗   ██╗
       ██║██╔══██╗██╔══██╗██║   ██║██╔════╝████╗  ██║
       ██║███████║██║  ██║██║   ██║█████╗  ██╔██╗ ██║
  ██   ██║██╔══██║██║  ██║╚██╗ ██╔╝██╔══╝  ██║╚██╗██║
  ╚█████╔╝██║  ██║██████╔╝ ╚████╔╝ ███████╗██║ ╚████║
   ╚════╝ ╚═╝  ╚═╝╚═════╝   ╚═══╝  ╚══════╝╚═╝ ╚═══╝
    ${colors.reset}`);
}

class SafePurger {
    constructor(token) {
        this.token = token;
        this.headers = {
            "Authorization": token,
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (Chrome/121.0.0.0 Safari/537.36)",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin"
        };
        this.baseUrl = "https://discord.com/api/v9";
    }

    async verifyToken() {
        try {
            const response = await axios.get(`${this.baseUrl}/users/@me`, { headers: this.headers });
            if (response.status === 200) {
                return {
                    userId: response.data.id,
                    username: response.data.username
                };
            }
        } catch (error) {
            return null;
        }
        return null;
    }

    async getFriendCount() {
        try {
            const response = await axios.get(`${this.baseUrl}/users/@me/relationships`, { headers: this.headers });
            if (response.status === 200 && Array.isArray(response.data)) {
                const friends = response.data.filter(rel => rel.type == 1);
                return friends.length;
            }
        } catch (error) {
            return 0;
        }
        return 0;
    }

    async run(channelId, limit = Infinity) {
        const verification = await this.verifyToken();
        if (!verification) {
            console.log(`${colors.red}[!] Token is invalid or expired.${colors.reset}`);
            return;
        }
        const { userId, username } = verification;
        
        clearScreen();
        printHeader();
        console.log(`${colors.green}Account:${colors.reset} ${colors.bright}${username}${colors.reset} (${userId})`);
        console.log(`${colors.green}Target Channel:${colors.reset} ${channelId}`);
        if (isFinite(limit)) {
            console.log(`${colors.green}Mode:${colors.reset} Delete exactly ${limit} messages`);
        } else {
            console.log(`${colors.green}Mode:${colors.reset} Delete all messages`);
        }
        console.log("--------------------------------------------------");

        let totalSuccess = 0;
        let totalFail = 0;
        
        const minWait = 1500;
        const maxWait = 3500;
        let currentWait = 0; 

        let lastMsgId = null;
        let shouldStop = false;
        const startTime = Date.now();

        const updateLiveStatus = () => {
            const progressText = isFinite(limit) ? ` | Progress: ${totalSuccess}/${limit} (${Math.round(totalSuccess/limit*100)}%)` : '';
            const line = `${colors.green}Success: ${totalSuccess}${colors.reset} | ${colors.red}Failed: ${totalFail}${colors.reset} | ${colors.yellow}Delay: ${(currentWait / 1000).toFixed(2)}s${colors.reset}${progressText}`;
            readline.cursorTo(process.stdout, 0, 16);
            readline.clearLine(process.stdout, 0);
            process.stdout.write(line);
            readline.cursorTo(process.stdout, 0, 17);
        };

        updateLiveStatus();

        while (!shouldStop && totalSuccess < limit) {
            let url = `${this.baseUrl}/channels/${channelId}/messages?limit=100`;
            if (lastMsgId) url += `&before=${lastMsgId}`;

            try {
                const response = await axios.get(url, { headers: this.headers });
                if (response.status === 403) {
                    console.log(`\n${colors.red}[!] No access to this channel.${colors.reset}`);
                    break;
                }
                if (response.status !== 200) {
                    console.log(`\n${colors.red}[!] API Error: ${response.status}${colors.reset}`);
                    break;
                }

                const messages = response.data;
                if (!messages.length) {
                    console.log(`\n${colors.yellow}[+] Reached beginning of channel history.${colors.reset}`);
                    break;
                }

                for (const msg of messages) {
                    if (totalSuccess >= limit) {
                        shouldStop = true;
                        break;
                    }

                    lastMsgId = msg.id;
                    if (msg.author.id === userId) {
                        let deleteSuccess = false;
                        while (!deleteSuccess) {
                            try {
                                const delResponse = await axios.delete(
                                    `${this.baseUrl}/channels/${channelId}/messages/${msg.id}`,
                                    { headers: this.headers }
                                );
                                if (delResponse.status === 204) {
                                    totalSuccess++;
                                    
                                    
                                    currentWait = Math.floor(Math.random() * (maxWait - minWait + 1)) + minWait;
                                    
                                    updateLiveStatus();
                                    await sleep(currentWait);
                                    deleteSuccess = true;
                                } else {
                                    totalFail++;
                                    updateLiveStatus();
                                    deleteSuccess = true;
                                }
                            } catch (error) {
                                if (error.response && error.response.status === 429) {
                                    const retryAfter = error.response.data.retry_after || 3;
                                    readline.cursorTo(process.stdout, 0, 18);
                                    console.log(`${colors.red}[!] Rate limit: cooling down ${retryAfter}s...${colors.reset}`);
                                    await sleep((retryAfter + 0.5) * 1000);
                                    readline.cursorTo(process.stdout, 0, 18);
                                    readline.clearLine(process.stdout, 0);
                                    updateLiveStatus();
                                } else {
                                    totalFail++;
                                    updateLiveStatus();
                                    deleteSuccess = true;
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.log(`\n${colors.red}[!] Fetch error: ${error.message}${colors.reset}`);
                break;
            }
        }

        const endTime = Date.now();
        const timeTaken = ((endTime - startTime) / 1000).toFixed(2);

        console.log(`\n\n${colors.bright}${colors.green}Task Completed!${colors.reset}`);
        console.log(`${colors.green}Successfully Deleted: ${totalSuccess}${colors.reset}`);
        console.log(`${colors.red}Failed: ${totalFail}${colors.reset}`);
        console.log(`${colors.cyan}Elapsed Time: ${timeTaken} seconds${colors.reset}`);
    }
}

function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

async function main() {
    clearScreen();
    printHeader();

    const token = process.env.TOKEN;
    
    if (!token) {
        console.log(`${colors.red}[!] ERROR: TOKEN not found in .env file.${colors.reset}`);
        console.log(`${colors.yellow}Please create a .env file in the root directory and add: TOKEN=your_token_here${colors.reset}`);
        return;
    }

    const purger = new SafePurger(token);
    const verification = await purger.verifyToken();

    if (!verification) {
        console.log(`${colors.red}[!] ERROR: The token in .env is invalid or expired.${colors.reset}`);
        return;
    }
    
    const friendCount = await purger.getFriendCount();

    console.log(`${colors.green}[+] Token verified! Logged in as: ${verification.username}${colors.reset}`);
    console.log(`${colors.green}[+] Friends Count: ${friendCount}${colors.reset}\n`);

    console.log(`${colors.cyan}Select Operation Mode:${colors.reset}`);
    console.log("  [1] Delete a specific number of messages");
    console.log("  [2] Delete all messages");

    const choice = (await askQuestion(`\n${colors.cyan}Choice (1 or 2):${colors.reset} `)).trim();
    if (choice !== '1' && choice !== '2') {
        console.log(`${colors.red}[!] Invalid choice.${colors.reset}`);
        return;
    }

    let limit = Infinity;
    if (choice === '1') {
        const limitInput = await askQuestion(`${colors.cyan}How many messages to delete?:${colors.reset} `);
        const parsed = parseInt(limitInput);
        if (isNaN(parsed) || parsed <= 0) {
            console.log(`${colors.red}[!] Please enter a positive number.${colors.reset}`);
            return;
        }
        limit = parsed;
    }

    const channel = (await askQuestion(`${colors.cyan}Channel ID:${colors.reset} `)).trim();
    if (!channel) {
        console.log(`${colors.red}[!] Channel ID cannot be empty.${colors.reset}`);
        return;
    }

    console.log(`\n${colors.green}Starting purge process...${colors.reset}\n`);
    await purger.run(channel, limit);
}

main().catch(err => {
    console.error(`${colors.red}Fatal Error:${colors.reset}`, err);
    process.exit(1);
});