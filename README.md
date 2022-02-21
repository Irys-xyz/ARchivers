# ARchivers - repository for TwittAR and ARticle - Two tools which record tweets and articles - permanently storing them on Arweave via Bundlr
To run either TwittAR or ARticle, you need an Arweave wallet - more specifically an Arweave walletfile.
You need to copy the contents of this walletfile into a the example wallet (example.wallet.json) - into the "arweave" section.

You also need to have docker and a set of build tools installed (for not LTS node versions).  

run `yarn` to install dependencies.

tweak the MAX_CONCURRENT_SESSIONS value in start-headless-chrome.sh as required - higher = more load but a higher %age of content being archived.
then run start-headless-chrome.sh

# TwittAR
To run TwittAR you need Twitter API keys, which you can get via a Twitter developer account
You will also need elevated API access.
Follow this answer here, and fill in the relevant fields in example.wallet.json:  
https://stackoverflow.com/a/6875024/18012461
and then rename it to wallet.json

Then in the developer portal, request elevated access - this should be approved almost immediately.

# ARticle
For ARticle, you need a NewsAPI API key - which you can get at https://newsapi.org  
Add this to your wallet.json (or example.wallet.json - rename to wallet.json)  
(it can be run without as an external import - just don't invoke `updateNewsApi`)

Tweak config.json as required, adding in keyterms - tweak instances to about 50% of your MAX_CONCURRENT_SESSIONS value.  

if you are noticing too many re-uploads of unchanged data, or that the system is not responding to changes, change the `difference` value in the config - lower = more sensitive to changes.

### running

install PM2 globally:  
`sudo yarn global add pm2`  
build the project:  
`yarn build`  
start the project:  
`pm2 start ARchiver.ecosystem.config.js`  

