import { archivePagePass0, Pass0Result } from "./pass0";
import { getPage, navigatePageSimple } from "./puppeteer-setup";
import { retrieveResources, inlineResources, RetrievedResource } from "./pass1";

export interface PageArchiveResult {

  /**
   * The content-type heade returned for the url
   */
  contentType: string

  /**
   * If the content type is text/html, this will be a string, otherwise it will be a Buffer.
   */
  out: string | Buffer


  // If the result is text/html page, these will be included, though
  // they are not needed for anything other than debugging info
  pass0?: Pass0Result
  retrieved?: RetrievedResource[]
}


export async function simplePageArchiver(url: string): Promise<PageArchiveResult> {

  const page = await getPage();

  try {

    const response = await navigatePageSimple(page, url, { waitFor: 5000 });

    if (!response) {
      throw new Error(`No response for ${url}`);
    }

    //await new Promise(res => setTimeout(res, 1000));
    //await scrollPageToBottom(page);
    //await new Promise(res => setTimeout(res, 1000));  

    if (!response.headers()['content-type'].toLowerCase().startsWith('text/html')) {
      return {
        contentType: response.headers()['content-type'],
        out: await response.buffer()
      }
    }

    // inject the archivePagePass0 into the page to grab out the dom, stylesheets, 
    // and mark elements we want to do something with.
    const pass0 = await page.evaluate(archivePagePass0);

    // retrieve all the external resources we need to. 
    const retrieved = await retrieveResources(pass0, page);

    // inline and rewrite all into one.
    const final = await inlineResources(pass0, retrieved);

    page.browser().disconnect();

    return {
      contentType: response.headers()['content-type'],
      out: final.out,
      pass0: final.pass0,
      retrieved: final.retrieved
    }

  }
  catch (e) {
    page.browser().disconnect();
    throw (e);
  }
}




