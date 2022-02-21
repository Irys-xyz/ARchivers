# ARchivers - repository for TwittAR and ARticle - Two tools which record tweets and articles - permanently storing them on Arweave via Bundlr
to run either TwittAR or ARticle, you need an arweave wallet - more specifically an arweave walletfile.
you need to copy the contents of this walletfile into a the example wallet (example.wallet.json) - into the "arweave" section

you need to have docker and a set of build tools installed (for not LTS node versions).  

run `yarn` to install dependencies.

tweak the MAX_CONCURRENT_SESSIONS value in start-headless-chrome.sh, as required - higher = more load.
then run start-headless-chrome.sh

# TwittAR
To run TwittAR you need twitter API keys, which you can get via a twitter developer account
you will also need elevated API access.
follow this answer here, and fill in the relevant fields in example.wallet.json:  
https://stackoverflow.com/a/6875024/18012461
and then rename it to wallet.json
then in the developer portal, request elevated access - this should be approved almost immediately 

# ARticle
for ARticle, you need a newsapi API key - which you can get at https://newsapi.org
add this to your wallet.json (or example.wallet.json - rename to wallet.json)

tweak config.json as required, adding in keyterms - tweak instances to about 50% of your MAX_CONCURRENT_SESSIONS value

### running

install PM2 globally:  
`sudo yarn global add pm2`  
build the project:  
`yarn build`  
start the project:  
`pm2 start ARchiver.ecosystem.config.js`  

