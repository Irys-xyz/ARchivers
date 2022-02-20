import Twitter from "node-tweet-stream";
import Bundlr from "@bundlr-network/client"
import tmp from "tmp-promise"
import * as p from "path"
import { mkdir, unlink } from "fs/promises";
import { PathLike, promises, readFileSync } from "fs";
import { createWriteStream } from "fs";
import axios from "axios"

import { getPage, navigatePageSimple } from './lib/puppeteer-setup';
import { archivePagePass0, ExternalPageResource } from './lib/pass0';
import puppeteer from 'puppeteer-core';
import jsdom, { JSDOM } from 'jsdom';
import { writeFileSync } from 'fs';
import { extname } from 'path';
import mime from "mime-types"


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


let TPS = 0;
let pTPS = 0
setInterval(() => {
    console.log(`TPS: ${TPS} - pTPS: ${pTPS}`); TPS = 0; pTPS = 0
}, 1000)

const checkPath = async (path: PathLike): Promise<boolean> => { return promises.stat(path).then(_ => true).catch(_ => false) }

let twitter
let bundlr


async function main() {
    const keys = JSON.parse(readFileSync("wallet.json").toString());

    twitter = new Twitter({
        consumer_key: keys.tkeys.consumer_key,
        consumer_secret: keys.tkeys.consumer_secret,
        token: keys.tkeys.token,
        token_secret: keys.tkeys.token_secret,
        tweet_mode: "extended"
    })
    bundlr = new Bundlr("https://node1.bundlr.network", "arweave", keys.arweave)

    console.log(`Loaded with account address: ${bundlr.address}`)
    //await processTweet(tweet)
    twitter.on('tweet', processTweet)

    twitter.on('error', (e) => {
        console.error(`tStream error: ${e.stack}`)
    })
    const trackKeyWords = ['Ukraine', 'ukraine', 'Russia', 'russia', "#UkraineInvasion"] //ukraine1
    const trackUsers = ["718916004072570880", "2315512764"] // @konrad_muzyka, @bellingcat
    console.log(`Tracking key words: ${trackKeyWords}`);
    console.log(`Tracking users: ${trackUsers}`)
    twitter.track(trackKeyWords)
    twitter.follow(trackUsers)
}




async function processTweet(tweet) {
    let tmpdir;
    try {
        TPS++
        if (tweet.retweeted_status) { //retweet, ignore.
            return;
        }

        /**
         * Application: twittAR
         * Author-ID: author ID: int
         * Tweet-ID: tweet ID: int
         * Media-Manifest-ID: media manifest ID: int
         * Key-Word-List: keyword set : string
         */

        const tags = [
            { name: "Application", value: "TwittAR" },
            { name: "Tweet-ID", value: `${tweet.id}` },
            { name: "Author-ID", value: `${tweet.user.id}` },
            { name: "Content-Type", value: "application/json" },
            { name: "Key-Word-List", value: "ukraine1" }
        ];

        if (tweet.in_reply_to_status_id) {
            tags.push({ name: "In-Response-To-ID", value: `${tweet.in_reply_to_status_id}` })
        }

        if (tweet.entities.media?.length > 0) {
            try {
                if (!tmpdir) {
                    tmpdir = await tmp.dir({ unsafeCleanup: true })
                }
                const mediaDir = p.join(tmpdir.path, "media")
                if (!await checkPath(mediaDir)) {
                    await mkdir(mediaDir)
                }
                for (let i = 0; i < tweet.entities.media.length; i++) {
                    const url = tweet.entities.media[i].media_url as string
                    const ext = url?.split("/")?.at(-1)?.split(".")[1] ?? "unknown"
                    const wstream = createWriteStream(p.join(mediaDir, `${i}.${ext}`))
                    const res = await axios.get(url, {
                        responseType: "stream"
                    }).catch((e) => {
                        console.log(`getting ${url} - ${e.message}`)
                    })
                    if (!res) { continue; }
                    await res.data.pipe(wstream) // pipe to file
                    await new Promise((resolve, reject) => {
                        wstream.on('finish', resolve)
                        wstream.on('error', reject)
                    })
                }
            } catch (e) {
                console.error(`while archiving media: ${e.stack}`)
            }

        }

        if (tweet.entities.urls?.length > 0) {
            try {
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
                    const headres = await axios.head(url).catch((e) => {
                        console.log(`heading ${url} - ${e.message}`)
                    })
                    if (!headres) { continue }
                    const contentType = headres.headers["content-type"]?.split(";")[0]?.toLowerCase() ?? "text/html"
                    const linkPath = p.join(tmpdir.path, `/links/${i}`)
                    if (!await checkPath(linkPath)) {
                        await mkdir(linkPath, { recursive: true })
                    }
                    // if it links a web page:
                    if (contentType === "text/html") {
                        await pageArchiver(url, linkPath);
                    } else {
                        const ext = url?.split("/")?.at(-1)?.split(".")[1] ?? "unkown"
                        const wstream = createWriteStream(p.join(linkPath, `${i}.${ext}`))
                        const res = await axios.get(url, {
                            responseType: "stream"
                        }).catch((e) => {
                            console.log(`getting ${url} - ${e.message}`)
                        })
                        if (!res) { continue; }
                        await res.data.pipe(wstream) // pipe to file
                        await new Promise((resolve, reject) => {
                            wstream.on('finish', resolve)
                            wstream.on('error', reject)
                        })

                    }
                }
            } catch (e) {
                console.error(`While processing URLs: ${e.stack ?? e.message}`)
            }

        }
        // if the tweet had some attachments, upload the tmp folder containing said media/site snapshots.
        if (tmpdir) {
            // upload dir
            const mres = await bundlr.uploader.uploadFolder(tmpdir.path, null, 10, false, async (_) => { })
            if (mres != "none") {
                if (!mres) {
                    console.log(`null media manifest for tweet str_ID ${tweet.id_str}`)
                } else {
                    tags.push({ name: "Media-Manifest-ID", value: `${mres}` })
                    console.log(`https://node1.bundlr.network/tx/${mres}/data`)
                }
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

        const tx = await bundlr.createTransaction(JSON.stringify(tweet), { tags: tags })
        await tx.sign();
        await tx.upload()
        pTPS++

    } catch (e) {
        console.log(`general error: ${e.stack ?? e.message}`)
        if (tmpdir) {
            await tmpdir.cleanup()
        }
    }
}



// helper functions for page downloading functionality

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

        await navigatePageSimple(page, url, { waitFor: 10000 });
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

            const virtualConsole = new jsdom.VirtualConsole();
            const dom = new JSDOM(`${pass0.docType}\n${pass0.html}`, { virtualConsole });

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
                        try {
                            el.replaceWith(inlinedStyle);
                        } catch (e) {
                            console.error(`while inserting inline styling - ${e}`)
                        }
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