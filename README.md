# **Stork Auto Verify Bot**
A **high-performance Node.js bot** for **automatically verifying signed price messages** on the **Stork Network**, using **multi-threading**, **proxy support**, and **real-time stats updates**.

# **Register**
https://chrome.google.com/webstore/detail/stork/knnliglhgkmlblppdejchidfihjnockl

Use my referral code: `TT21G58VOG`

## **Features**
**Multi-Account Support** – Supports multiple accounts simultaneously.  
**Proxy Support** – Uses **HTTPS** and **SOCKS5** proxies for API calls.  
**Multi-Threading** – Uses `worker_threads` for **faster processing**.  
**Real-Time Stats** – Logs **latest points after every successful validation**.  
**Auto Token Refresh** – Automatically **refreshes tokens** every 50 minutes.  
**Colorized Logs** – **Emails** in cyan, **points** in green, and **errors** in red.  
**Performance Optimized** – **Batch processing** for validations.  

## **Requirements**
1. **Node.js 16+**  
2. **npm (Node Package Manager)**  


## **Installation**
### **Clone the Repository**
```bash
git clone https://github.com/kelliark/Stork-AutoBot
cd Stork-AutoBot
```

### **Install Dependencies**
```bash
npm install
```

### **Configure the Bot**
Edit `config.json` to set up accounts, proxies, and bot behavior.


## **Configuration**
### **`config.json` (Account Setup)**
This file stores **accounts & settings** for the bot.  
Edit it before running the bot.

```json
{
  "accounts": [
    {
      "region": "ap-northeast-1",
      "clientId": "5msns4n49hmg3dftp2tp1t2iuh",
      "userPoolId": "ap-northeast-1_M22I44OpC",
      "username": "example@gmail.com",
      "password": "your-password",
      "maxProxies": 2
    },
    {
      "region": "ap-northeast-1",
      "clientId": "5msns4n49hmg3dftp2tp1t2iuh",
      "userPoolId": "ap-northeast-1_M22I44OpC",
      "username": "example2@gmail.com",
      "password": "your-password",
      "maxProxies": 1
    }
//  You can add more if you want just put coma(,) above the account until the last one don't put coma like that example2 account
  ],
  "stork": {
    "baseURL": "https://app-api.jp.stork-oracle.network/v1",
    "authURL": "https://api.jp.stork-oracle.network/auth",
    "intervalSeconds": 10
  },
  "threads": {
    "maxWorkers": 10
  }
}
```

**maxProxies** → Assigns proxies from `proxies.txt` (1 per account).  
**intervalSeconds** → How often stats update (**in seconds**).  
**maxWorkers** → Number of threads to use for processing (**performance tuning**).


### **`proxies.txt` (Proxy List)**
Each account will use a **proxy from this list**.  
Supports **HTTP & SOCKS5 proxies**.

Example format:
```
http://username:password@proxy1.com:8080
socks5://username:password@proxy2.com:1080
```
The bot **rotates proxies** based on **maxProxies** per account.


## **Running the Bot**
To start the bot, **run:**
```bash
node .
```
or
```bash
npm start
```


## **Troubleshooting**
### **Common Issues & Fixes**
| Problem | Solution |
|---------|----------|
| **Bot crashes on start** | Check `config.json` formatting. Ensure `username` and `password` are correct. |
| **Proxy not working** | Make sure proxies are valid. Try `curl --proxy` to test manually. |
| **Points & referrals not updating** | Increase `intervalSeconds` in `config.json`. Make sure API isn’t blocked. |
| **Duplicate logs** | Restart bot (`Ctrl + C`, then `node .`). Ensure config has unique accounts. |
| **Colors not showing** | Ensure you’re using a **compatible terminal** (CMD, Git Bash, or Linux/Mac Terminal). |


## **License**
This project is licensed under the **MIT License**.


## **Contributing**
Contributions are welcome! Feel free to submit **pull requests** or **open issues**.


## **Disclaimer**
This bot is for **educational purposes** only.  
**Use at your own risk, all risk are borne with user.**
