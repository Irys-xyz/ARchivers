
import puppeteer from 'puppeteer-core';
import { ExternalPageResource, Pass0Result } from './pass0';
import { JSDOM } from 'jsdom';

export interface RetrievedResourceOk {
  buffer: Buffer
  contentType: string
  error: 'no'
}

export interface RetreivedResourceError {
  error: 'yes'
  message: string
}

export type RetrievedResource = (RetrievedResourceOk | RetreivedResourceError) & ExternalPageResource

export async function retrieveResources(pass0: Pass0Result, page: puppeteer.Page): Promise<RetrievedResource[]> {

  const results: (ExternalPageResource & RetrievedResource)[] = []

  for (let i = 0; i < pass0.externalResources.length; i++) {
    let r = pass0.externalResources[i];
    try {
      const response = await page.goto(r.originalUrl, { timeout: 20000, waitUntil: 'load' });
      if (!response) {
        throw new Error(`Couldn't get ${r.originalUrl}`);
      }
      const buffer = await response.buffer();
      const contentType = response.headers()['content-type'];

      results.push(Object.assign({ buffer, contentType, error: 'no' as 'no' }, r));

    } catch (e) {
      console.error(e.message);
      results.push(Object.assign({ error: 'yes' as 'yes', message: e.message }, r));
    }
  }
  return results;
}

function makeDataUri(buffer: Buffer, contentType: string) {
  return `data:${contentType.replace(' ', '')};base64,${buffer.toString('base64')}`
}

export async function inlineResources(pass0: Pass0Result, retrieved: RetrievedResource[]) {

  const dom = new JSDOM(`${pass0.docType}\n${pass0.html}`);

  retrieved.forEach(resource => {

    if (resource.error === 'yes') {
      console.error(`Resource errored: ${resource.message}`);
      return;
    }


    const el = dom.window.document.querySelector(`[data-archiver-fab-id="${resource.resourceId}"]`)!;

    if (resource.type === 'external_css_sheet') {
      const inlinedStyle = dom.window.document.createElement("style")
      inlinedStyle.innerHTML = resource.buffer.toString();
      el.replaceWith(inlinedStyle);
    } else {
      el.setAttribute('src', makeDataUri(resource.buffer, resource.contentType));
    }

  });

  pass0.embeddedResources.forEach(resource => {
    console.log(`embedded resource: ${resource.type}`);
    if (resource.type === 'datauri_image') {
      const el = dom.window.document.querySelector(`[data-archiver-fab-id="${resource.resourceId}"]`)!;
      el.setAttribute('src', resource.originalUrl);
    } else {
      const el = dom.window.document.querySelector(`[data-archiver-fab-id="${resource.resourceId}"]`)!;
      const inlinedStyle = dom.window.document.createElement("style");
      inlinedStyle.innerHTML = resource.cssRules.join('\n');
      el.replaceWith(inlinedStyle);
    }
  })

  const out = dom.serialize();
  return { out, pass0, retrieved }
}