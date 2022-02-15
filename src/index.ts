import Twitter from "node-tweet-stream";
// import cluster from "cluster";

import Bundlr from "@bundlr-network/client"
//import { readFileSync } from "fs"
import tmp from "tmp-promise"
// import { simplePageArchiver } from "../injectable-archiver/src/lib/simple"
import * as p from "path"
import { mkdir, unlink } from "fs/promises";
import { PathLike, promises, readFileSync } from "fs";
import { createWriteStream } from "fs";
import axios from "axios"

// import scrape from 'website-scraper';
// import PuppeteerPlugin from 'website-scraper-puppeteer';


import { getPage, navigatePageSimple } from './lib/puppeteer-setup';
import { archivePagePass0, ExternalPageResource } from './lib/pass0';
import puppeteer from 'puppeteer-core';
import { JSDOM } from 'jsdom';
import { writeFileSync } from 'fs';
import { extname } from 'path';
import mime from "mime-types"

// import scrape from "website-scraper";
// import PuppeteerPlugin from "website-scraper-puppeteer"
// const scrape = await import("website-scraper");
// let scrape;
// let PuppeteerPlugin;

// (async function () {
//     scrape = await import("../node_modules/website-scraper")
//     PuppeteerPlugin = await import("../node_modules/website-scraper-puppeteer")
// })()

function makeDataUri(buffer: Buffer, contentType: string) {
    return `data:${contentType.replace(' ', '')};base64,${buffer.toString('base64')}`
}

interface RetrievedResourceOk {
    buffer: Buffer
    contentType: string
    error: 'no'
}

interface RetreivedResourceError {
    error: 'yes'
    message: string
}

type RetrievedResource = RetrievedResourceOk | RetreivedResourceError


let TPM = 0;
setInterval(() => {
    console.log(`TPS: ${TPM}`); TPM = 0
}, 1000)

const checkPath = async (path: PathLike): Promise<boolean> => { return promises.stat(path).then(_ => true).catch(_ => false) }

async function main() {

    const t = new Twitter({
        consumer_key: "",
        consumer_secret: "",
        token: "",
        token_secret: "",
        tweet_mode: "extended"
    })

    const JWK = JSON.parse(readFileSync("wallet.json").toString());
    const bundlr = new Bundlr("https://devnet.bundlr.network", "arweave", JWK)
    console.log(bundlr.address)

    t.on('tweet', async (tweet) => {
        try {

            TPM++
            let tmpdir;
            if (tweet.retweeted_status) { //retweet, ignore.
                return;
            }
            const tags = [
                { name: "Application", value: "TwittAR" },
                { name: "tID", value: `${tweet.id}` },
                { name: "aID", value: `${tweet.user.id}` },
                { name: "Content-Type", value: "application/json" }
            ];
            if (tweet.in_reply_to_status_id) {
                tags.push({ name: "irtID", value: `${tweet.in_reply_to_status_id}` })
            }

            /**
             * Application: twittAR
             * aID: author ID: int
             * tID: tweet ID: int
             * mmID: media manifest ID: int
             */

            // create media manifest
            if (tweet.entities.media?.length > 0) {
                if (!tmpdir) {
                    tmpdir = await tmp.dir({ unsafeCleanup: true })
                }
                const mediaDir = p.join(tmpdir.path, "media")
                if (!await checkPath(mediaDir)) {
                    await mkdir(mediaDir)
                }
                tweet.entities.media.forEach(async (u, i) => {
                    const url = u.media_url_https as string
                    const ext = url.split("/").at(-1).split(".")[1]
                    const wstream = createWriteStream(p.join(mediaDir, `${i}.${ext}`))
                    const res = await axios.get(url, {
                        responseType: "stream"
                    })
                    await res.data.pipe(wstream) // pipe to file
                    return new Promise((resolve, reject) => {
                        wstream.on('finish', resolve)
                        wstream.on('error', reject)
                    })
                })

            }

            if (tweet.entities.urls?.length > 0) {
                for (let i = 0; i < tweet.entities.urls.length; i++) {
                    const u = tweet.entities.urls[i]
                    const url = u.expanded_url
                    // tweets sometimes reference themselves
                    if (url === `https://twitter.com/i/web/status/${tweet.id_str}`) {
                        continue;
                    }
                    if (!tmpdir) {
                        tmpdir = await tmp.dir({ unsafeCleanup: true })
                    }
                    const headres = await axios.head(url)
                    const contentType = headres.headers["content-type"].split(";")[0].toLowerCase()
                    if (contentType === "text/html") {
                        const sitePath = p.join(tmpdir.path, `/links/${i}`)
                        if (!await checkPath(sitePath)) {
                            await mkdir(sitePath, { recursive: true })
                        }
                        await pageArchiver(url, sitePath);
                    }
                }

            }
            if (tmpdir) {
                // upload dir

                const mres = await bundlr.uploader.uploadFolder(tmpdir.path, null, 10, false)
                if (mres != "none") {
                    tags.push({ name: "mmID", value: mres })
                }

                // clean up manifest and ID file.
                const mpath = p.join(p.join(tmpdir.path, `${p.sep}..`), `${p.basename(tmpdir.path)}-manifest.json`)
                if (await checkPath(mpath)) {
                    await unlink(mpath);
                }
                const idpath = p.join(p.join(tmpdir.path, `${p.sep}..`), `${p.basename(tmpdir.path)}-id.txt`)
                if (await checkPath(idpath)) {
                    await unlink(idpath);
                }

                await tmpdir.cleanup()
            }

            //console.log('tweet received', tweet)

            const tx = await bundlr.createTransaction(JSON.stringify(tweet), { tags: tags })
            await tx.sign();
            await tx.upload()

            //console.log(`${tweet.id}:${res.data.id}`)
            // upload linked entities first: 
            // if (tweet.entities.urls.length > 0) {
            //     console.log(tweet.entities.urls)
            // }
        } catch (e) {
            console.log(e)
        }
    })

    t.on('error', (_) => {
        console.log('Oh no')
    })



    t.track('Ukraine')
    t.track('ukraine')
    t.track('Russia')
    t.track('russia')
    t.track("#UkraineInvasion")
}


async function retreiveResources(page: puppeteer.Page, resources: ExternalPageResource[]) {

    const results: (ExternalPageResource & RetrievedResource)[] = []

    for (let i = 0; i < resources.length; i++) {

        let r = resources[i];

        try {
            const response = await page.goto(r.originalUrl, { timeout: 20000, waitUntil: 'load' });
            if (!response) {
                throw new Error(`Couldn't get ${r.originalUrl}`);
            }
            const buffer = await response.buffer();
            const contentType = response.headers()['content-type'];

            results.push(Object.assign({ buffer, contentType, error: 'no' as 'no' }, r));

        } catch (e) {
            console.log(e.message);
            results.push(Object.assign({ error: 'yes' as 'yes', message: e.message }, r));
        }

    }
    return results;
}


async function scrapeAll(url: string) {


    const page = await getPage();

    try {

        await navigatePageSimple(page, url, { waitFor: 0 });
        // await new Promise(res => setTimeout(res, 1000 * 90));

        const pass0 = await page.evaluate(archivePagePass0);

        //await new Promise(res => setTimeout(res, 1000 * 30));

        const retrievedResources = await retreiveResources(page, pass0.externalResources);

        page.browser().disconnect();

        return { pass0, retrievedResources, embeddedResources: pass0.embeddedResources }

    } catch (e) {
        page.browser().disconnect();
        throw (e);
    }

}


async function pageArchiver(url, outFolder) {
    return new Promise((resolve, reject) => {

        scrapeAll(url).then(({ pass0, retrievedResources, embeddedResources }) => {

            // writeFileSync(`${outFolder}/original.html`, `${pass0.docType}\n${pass0.html}`);

            const dom = new JSDOM(`${pass0.docType}\n${pass0.html}`);

            retrievedResources.forEach(resource => {

                if (resource.error === 'yes') {
                    console.log(`Resource errored: ${resource.message}`);
                    return;
                }

                const ext = extname(new URL(resource.originalUrl).pathname);

                if (!resource.contentType) {
                    const mimetype = mime.lookup(resource.originalUrl);
                    resource.contentType = mimetype ? mimetype : "application/octet-stream"
                }

                const filename = `${resource.resourceId}${ext}`;

                let inlineExternal = true;

                if (!inlineExternal) {
                    writeFileSync(`${outFolder}/${filename}`, resource.buffer);
                    //console.log(`Wrote ${filename}, ${resource.buffer.length} bytes - ${resource.originalUrl}`);
                }

                const el = dom.window.document.querySelector(`[data-archiver-fab-id="${resource.resourceId}"]`)!;

                if (inlineExternal) {

                    if (resource.type === 'external_css_sheet') {
                        const inlinedStyle = dom.window.document.createElement("style")
                        inlinedStyle.innerHTML = resource.buffer.toString();
                        el.replaceWith(inlinedStyle);
                        //el.setAttribute('href', makeDataUri(resource.buffer, resource.contentType)); 
                    } else {
                        el.setAttribute('src', makeDataUri(resource.buffer, resource.contentType));
                    }

                } else {

                    if (resource.type === 'external_css_sheet') {
                        el.setAttribute('href', filename);
                    } else {
                        el.setAttribute('src', filename);
                    }

                }

            });

            embeddedResources.forEach(resource => {
                // console.log(`embedded resource: ${resource.type}`);
                if (resource.type === 'datauri_image') {
                    const el = dom.window.document.querySelector(`[data-archiver-fab-id="${resource.resourceId}"]`)!;
                    el.setAttribute('src', resource.originalUrl);
                } else {
                    const el = dom.window.document.querySelector(`[data-archiver-fab-id="${resource.resourceId}"]`)!;
                    el.innerHTML = resource.cssRules.join('\n');
                }
            })

            const out = dom.serialize();

            mkdir(outFolder, { recursive: true });
            writeFileSync(`${outFolder}/index.html`, out);
            // writeFileSync(`${outFolder}/DATA.json`, JSON.stringify({ embeddedResources: pass0.embeddedResources, externalResources: pass0.externalResources, }, undefined, 2));
            resolve(0)
        }).catch(e => reject(e))
    })

}
main();