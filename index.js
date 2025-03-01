const fs = require('fs');
const path = require('path');
const axios = require('axios');
const chalk = require('chalk').default || require('chalk');
const AmazonCognitoIdentity = require('amazon-cognito-identity-js');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

global.navigator = { userAgent: 'node' }; 

// -------------- LOGGING WITH COLORS -------------- //
function log(message, type = 'INFO') {
  let color;
  switch (type) {
    case 'INFO': color = chalk.green; break;
    case 'WARN': color = chalk.yellow; break;
    case 'ERROR': color = chalk.red; break;
    default: color = chalk.white;
  }
  const timeStamp = chalk.blue(`[${new Date().toISOString().replace('T',' ').slice(0,19)}]`);
  console.log(`${timeStamp} ${color("[" + type + "]")} ${message}`);
}

// -------------- LOAD CONFIG -------------- //
function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  if (!fs.existsSync(configPath)) {
    log('No config.json found. Creating a default one...', 'WARN');
    const defaultConfig = {
      accounts: [
        {
          region: 'ap-northeast-1',
          clientId: '5msns4n49hmg3dftp2tp1t2iuh',
          userPoolId: 'ap-northeast-1_M22I44OpC',
          username: '',
          password: '',
          maxProxies: 1
        }
      ],
      stork: {
        baseURL: 'https://app-api.jp.stork-oracle.network/v1',
        authURL: 'https://api.jp.stork-oracle.network/auth',
        intervalSeconds: 10
      },
      threads: {
        maxWorkers: 10
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
  const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  log('Configuration loaded successfully from config.json');
  return userConfig;
}

const config = loadConfig();

// -------------- PROXY LOADING -------------- //
function loadGlobalProxies() {
  const proxyPath = path.join(__dirname, 'proxies.txt');
  if (!fs.existsSync(proxyPath)) {
    log(`No proxies.txt found at ${proxyPath}. Creating an empty one...`, 'WARN');
    fs.writeFileSync(proxyPath, '');
    return [];
  }
  const lines = fs.readFileSync(proxyPath, 'utf8').split('\n');
  return lines
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

// -------------- ASSIGN PROXIES -------------- //
function assignProxiesToAccounts(accounts, allProxies) {
  let assigned = [];
  let index = 0;
  accounts.forEach(account => {
    const maxP = account.maxProxies || 1;
    const subset = [];
    for (let i = 0; i < maxP; i++) {
      if (allProxies.length === 0) break; // No proxies available
      subset.push(allProxies[index % allProxies.length]);
      index++;
    }
    assigned.push({
      account,
      proxies: subset
    });
  });
  return assigned;
}

// -------------- COGNITO AUTH & TOKEN MANAGEMENT -------------- //
class CognitoAuth {
  constructor(accountConfig) {
    this.accountConfig = accountConfig;
    const poolData = {
      UserPoolId: accountConfig.userPoolId,
      ClientId: accountConfig.clientId
    };
    this.cognitoUserPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);
    this.authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({
      Username: accountConfig.username,
      Password: accountConfig.password
    });
    this.cognitoUser = new AmazonCognitoIdentity.CognitoUser({
      Username: accountConfig.username,
      Pool: this.cognitoUserPool
    });
  }

  authenticateUser() {
    return new Promise((resolve, reject) => {
      this.cognitoUser.authenticateUser(this.authenticationDetails, {
        onSuccess: (result) => {
          resolve({
            accessToken: result.getAccessToken().getJwtToken(),
            idToken: result.getIdToken().getJwtToken(),
            refreshToken: result.getRefreshToken().getToken(),
            expiresIn: result.getAccessToken().getExpiration() * 1000 - Date.now()
          });
        },
        onFailure: (err) => reject(err),
        newPasswordRequired: () => reject(new Error('New password required'))
      });
    });
  }

  refreshSession(refreshToken) {
    return new Promise((resolve, reject) => {
      const refreshTokenObj = new AmazonCognitoIdentity.CognitoRefreshToken({ RefreshToken: refreshToken });
      this.cognitoUser.refreshSession(refreshTokenObj, (err, result) => {
        if (err) return reject(err);
        resolve({
          accessToken: result.getAccessToken().getJwtToken(),
          idToken: result.getIdToken().getJwtToken(),
          refreshToken: refreshToken,
          expiresIn: result.getAccessToken().getExpiration() * 1000 - Date.now()
        });
      });
    });
  }
}

class TokenManager {
  constructor(accountConfig) {
    this.accountConfig = accountConfig;
    this.username = accountConfig.username;
    this.tokenFile = path.join(__dirname, `tokens_${this.username.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
    this.accessToken = null;
    this.refreshToken = null;
    this.idToken = null;
    this.expiresAt = 0;
    this.auth = new CognitoAuth(accountConfig);
  }

  isTokenExpired() {
    return Date.now() >= this.expiresAt;
  }

  async loadTokensFromFile() {
    if (!fs.existsSync(this.tokenFile)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(this.tokenFile, 'utf8'));
      if (!data.accessToken) return null;
      return data;
    } catch {
      return null;
    }
  }

  async saveTokensToFile(tokens) {
    fs.writeFileSync(this.tokenFile, JSON.stringify(tokens, null, 2), 'utf8');
  }

  async refreshOrAuthenticate() {
    if (this.refreshToken) {
      try {
        const newTokens = await this.auth.refreshSession(this.refreshToken);
        this.updateLocalTokens(newTokens);
        return;
      } catch (err) {
        log(`Refresh token failed for ${this.username}: ${err.message}`, 'ERROR');
        // Delete the token file if refresh fails.
        if (fs.existsSync(this.tokenFile)) {
          fs.unlinkSync(this.tokenFile);
          log(`Deleted token file for ${this.username} due to refresh failure`, 'INFO');
        }
      }
    }
    const result = await this.auth.authenticateUser();
    this.updateLocalTokens(result);
  }

  updateLocalTokens(result) {
    this.accessToken = result.accessToken;
    this.idToken = result.idToken;
    this.refreshToken = result.refreshToken;
    this.expiresAt = Date.now() + result.expiresIn;
    this.saveTokensToFile({
      accessToken: this.accessToken,
      idToken: this.idToken,
      refreshToken: this.refreshToken,
      isAuthenticated: true,
      isVerifying: false
    });
  }

  async getValidToken() {
    if (!this.accessToken || this.isTokenExpired()) {
      await this.refreshOrAuthenticate();
    }
    return this.accessToken;
  }

  async init() {
    const tokens = await this.loadTokensFromFile();
    if (tokens) {
      this.accessToken = tokens.accessToken;
      this.idToken = tokens.idToken;
      this.refreshToken = tokens.refreshToken;
    }
    await this.getValidToken();
  }
}

// -------------- STORK API CALLS -------------- //
function getProxyAgent(proxy) {
  if (!proxy) return null;
  if (proxy.startsWith('http')) {
    return new HttpsProxyAgent(proxy);
  } else if (proxy.startsWith('socks4') || proxy.startsWith('socks5')) {
    return new SocksProxyAgent(proxy);
  }
  throw new Error(`Unsupported proxy protocol: ${proxy}`);
}

async function getUserStats(tokens, accountConfig) {
  try {
    const response = await axios.get(`${config.stork.baseURL}/me`, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'User-Agent': 'Mozilla/5.0 (Node)',
        Origin: 'chrome-extension://knnliglhgkmlblppdejchidfihjnockl'
      }
    });
    return response.data.data;
  } catch (err) {
    log(`Error fetching user stats for ${accountConfig.username}: ${err.message}`, 'ERROR');
    return null;
  }
}

async function getSignedPrices(tokens, accountConfig) {
  try {
    const response = await axios.get(`${config.stork.baseURL}/stork_signed_prices`, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'User-Agent': 'Mozilla/5.0 (Node)',
        Origin: 'chrome-extension://knnliglhgkmlblppdejchidfihjnockl'
      }
    });
    const data = response.data.data;
    return Object.keys(data).map(assetKey => {
      const assetData = data[assetKey];
      return {
        asset: assetKey,
        msg_hash: assetData.timestamped_signature.msg_hash,
        price: assetData.price,
        timestamp: new Date(assetData.timestamped_signature.timestamp / 1000000).toISOString(),
        ...assetData
      };
    });
  } catch (err) {
    log(`Error fetching signed prices for ${accountConfig.username}: ${err.message}`, 'ERROR');
    return [];
  }
}

async function sendValidation(tokens, msgHash, isValid, proxy, accountConfig) {
  try {
    const agent = getProxyAgent(proxy);
    await axios.post(
      `${config.stork.baseURL}/stork_signed_prices/validations`,
      { msg_hash: msgHash, valid: isValid },
      {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'User-Agent': 'Mozilla/5.0 (Node)',
          Origin: 'chrome-extension://knnliglhgkmlblppdejchidfihjnockl'
        },
        httpsAgent: agent
      }
    );

    // Fetch updated points after validation success
    const stats = await getUserStats(tokens, accountConfig);
    const currentPoints = stats?.stats?.stork_signed_prices_valid_count || 0;

    // Log success message with colored email & points
    log(
      `${chalk.cyan(`[${accountConfig.username}]`)} Validation success for ${msgHash.slice(0, 10)}... via ${proxy || 'no-proxy'} | Points: ${chalk.green(currentPoints)}`
    );

  } catch (err) {
    log(`${chalk.cyan(`[${accountConfig.username}]`)} Validation failed for ${msgHash.slice(0, 10)}...: ${chalk.red(err.message)}`, 'ERROR');
  }
}

// -------------- PRICE VALIDATION LOGIC -------------- //
function validatePrice(priceData) {
  if (!priceData.msg_hash || !priceData.price || !priceData.timestamp) {
    return false;
  }
  const dataTime = new Date(priceData.timestamp).getTime();
  if ((Date.now() - dataTime) > 60 * 60 * 1000) {
    return false;
  }
  return true;
}

// -------------- WORKER THREAD -------------- //
if (!isMainThread) {
  (async () => {
    const { priceData, tokens, proxy, accountConfig } = workerData;
    try {
      const isValid = validatePrice(priceData);
      await sendValidation(tokens, priceData.msg_hash, isValid, proxy, accountConfig);
      parentPort.postMessage({ success: true, msgHash: priceData.msg_hash, isValid });
    } catch (error) {
      parentPort.postMessage({ success: false, msgHash: priceData.msg_hash, error: error.message });
    }
  })();
} else {
  // -------------- MAIN THREAD -------------- //
  async function runValidationProcess(tokenManager, assignedProxies) {
    try {
      const tokens = {
        accessToken: tokenManager.accessToken,
        idToken: tokenManager.idToken,
        refreshToken: tokenManager.refreshToken
      };

      const userStats = await getUserStats(tokens, tokenManager.accountConfig);
      const signedPrices = await getSignedPrices(tokens, tokenManager.accountConfig);
      if (!signedPrices.length) {
        log(`[${tokenManager.username}] No data to validate`);
        return;
      }

      const workers = [];
      const chunkSize = Math.ceil(signedPrices.length / config.threads.maxWorkers);
      const batches = [];
      for (let i = 0; i < signedPrices.length; i += chunkSize) {
        batches.push(signedPrices.slice(i, i + chunkSize));
      }

      let proxyIndex = 0;
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        batch.forEach(priceData => {
          const proxy = assignedProxies.length ? assignedProxies[proxyIndex % assignedProxies.length] : null;
          proxyIndex++;
          workers.push(new Promise((resolve) => {
            const worker = new Worker(__filename, {
              workerData: { priceData, tokens, proxy, accountConfig: tokenManager.accountConfig }
            });
            worker.on('message', resolve);
            worker.on('error', (err) => resolve({ success: false, error: err.message }));
            worker.on('exit', () => resolve({ success: false, error: 'Worker exited' }));
          }));
        });
      }

      const results = await Promise.all(workers);
      const successCount = results.filter(r => r.success).length;
      log(`[${tokenManager.username}] Finished validation. Success: ${successCount}/${results.length}`);
    } catch (err) {
      log(`[${tokenManager.username}] Validation process error: ${err.message}`, 'ERROR');
    }
  }

  async function startForAccount(accountObj, assignedProxies) {
    const tokenManager = new TokenManager(accountObj);
    await tokenManager.init();
    log(`[${tokenManager.username}] Initial token ready`);

    runValidationProcess(tokenManager, assignedProxies);

    setInterval(() => runValidationProcess(tokenManager, assignedProxies), config.stork.intervalSeconds * 1000);

    // Force a token refresh (delete token file and reauthenticate) every 1 hour
    setInterval(async () => {
      if (fs.existsSync(tokenManager.tokenFile)) {
        fs.unlinkSync(tokenManager.tokenFile);
        log(`[${tokenManager.username}] Token file deleted for forced refresh`, 'WARN');
      }
      await tokenManager.getValidToken();
      log(`[${tokenManager.username}] Token refreshed (forced reauth)`);
    }, 60 * 60 * 1000);
  }

  async function main() {
    const allProxies = loadGlobalProxies();
    const assigned = assignProxiesToAccounts(config.accounts, allProxies);
    for (const item of assigned) {
      const { account, proxies } = item;
      if (!account.username || !account.password) {
        log(`Missing username/password for an account`, 'ERROR');
        continue;
      }
      startForAccount(account, proxies);
    }
  }

  main();
}
