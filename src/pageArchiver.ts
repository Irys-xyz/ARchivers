import { getPage, navigatePageSimple } from './lib/puppeteer-setup';
import { archivePagePass0, ExternalPageResource } from './lib/pass0';
import puppeteer from 'puppeteer-core';
import jsdom, { JSDOM } from 'jsdom';
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


export async function pageArchiver(url): Promise<string> {
    return new Promise((resolve, reject) => {

        scrapeAll(url).then(async ({ pass0, retrievedResources, embeddedResources }) => {

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

                // if (!inlineExternal) {
                //     writeFileSync(`${outFolder}/${filename}`, resource.buffer);
                //     //console.log(`Wrote ${filename}, ${resource.buffer.length} bytes - ${resource.originalUrl}`);
                // }

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

            // await mkdir(outFolder, { recursive: true });
            // writeFileSync(`${outFolder}/index.html`, out);
            // writeFileSync(`${outFolder}/DATA.json`, JSON.stringify({ embeddedResources: pass0.embeddedResources, externalResources: pass0.externalResources, }, undefined, 2));
            resolve(out)
        }).catch(e => reject(e))
    })

}