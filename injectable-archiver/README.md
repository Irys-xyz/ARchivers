# Injectable Archiver

Web resource archiver and web page inliner.

Meant to be somewhat environment agnostic, but only works with headless chrome and the browserless docker
image at the moment.

Start browserless docker image with preboot and keep-alive options

```bash
./start-headless-chrome.sh
```

When using preboot & keep alive options, you do `page().disconnect()` instead of `browser().close()` when using
pupeteer Api.


`npm start` will start a http server on port 1888

`http://localhost:1888/preview/<MYURLTOSCRAPE>` 

This will scrape a page or resource and display it in an iframe. Displaying it as a blob/datauri inside an iframe
stops the page from making further requests to the local server. 

`http://localhost:1888/scrape/<MYURLTOSCRAPE>` 

This will scrape a page and return the raw result, setting the content type and returning the body exactly as is.
This API is suitable to use via curl or from nodejs etc. If you visit this in the browser it will work, but
the page will start making a ton more requests to the server

The scraping will detect when the url you give it is not a text/html page, but some other resource, and just return
that exactly as is, it does this based on the server response, so you can give it any url, that might point or redirect to a PDF, Image, etc.

## Interesting parts of source  

```bash
src/lib/pass0.ts
src/lib/pass1.ts
```

These do most of the work.

```bash
src/lib/simple.ts
```

A simple api over the internals, give it a url and get back an inlined html page, or a raw resource.


`src/lib/archive.ts` - this is really rough cli script which you probably should just ignore :) you can give it a url and outfolder and it will scrape and put the output there with some json of the intermediate steps for debugging: `ts-node src/lib/archive.ts <URL> <OUTFOLDER>`

`src/http/app.ts` the express server.







