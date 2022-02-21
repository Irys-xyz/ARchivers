# ARchivers - repository for TwittAR and ARticle - Two tools which record tweets and articles - permanently storing them on Arweave via Bundlr
To run either TwittAR or ARticle, you need an Arweave wallet - more specifically an Arweave wallet file.
You need to copy the contents of this wallet file into the example (example.wallet.json) wallets' "arweave" section.

You also need to have docker and a set of build tools installed (for not LTS node versions).  

Run `yarn` to install dependencies.

Docker command to create headless chrome host:
`docker run --shm-size=4096m -e KEEP_ALIVE=true -e MAX_CONCURRENT_SESSIONS=60 -e MAX_QUEUE_LENGTH=400 -e CONNECTION_TIMEOUT=180000 -p 3000:3000 --restart always -d --name bc browserless/chrome`

Tweak the `MAX_CONCURRENT_SESSIONS` value as required - higher = more load but a higher chance of content being archived (download requests are dropped if the queue gets too full).

# TwittAR
To run TwittAR you need Twitter API keys, which you can get via a Twitter developer account.
You will also need elevated API access.
Follow this answer here, and fill in the relevant fields in example.wallet.json:  
https://stackoverflow.com/a/6875024/18012461
and then rename it to wallet.json.

Then in the developer portal, request elevated access - this should be approved almost immediately.

# ARticle
For ARticle, you need a NewsAPI API key - which you can get at https://newsapi.org.  
Add this to your `wallet.json` (or example.wallet.json - rename to wallet.json)  
(it can be run without as an external import - just don't invoke `updateNewsApi`).

Tweak config.json as required, adding in `keyterms` - tweak `instances` to about 50% of your `MAX_CONCURRENT_SESSIONS` value.  

If you are noticing too many re-uploads of unchanged data, or that the system is not responding to changes, change the `difference` value in the config - lower = more sensitive to changes.

### Running

Install PM2 globally (use elevated terminal):   

`yarn global add pm2`  

Build the project:  

`yarn build`  

Start the project (TwittAR and ARticle): 
 
`pm2 start ARchiver.ecosystem.config.js`  

