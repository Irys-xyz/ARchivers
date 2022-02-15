
export interface ExternalCssSheetResource {
  type: "external_css_sheet"
  resourceId: string
  originalUrl: string
  cssRules: string[]
}

export interface ExternalImageResourcee {
  type: "external_img" 
  resourceId: string
  originalUrl: string
  // Removed attributes.. prob should be done later.
  attributes: Record<string, string> 
}

export interface InlineCssSheetResource {
  type: "internal_css_sheet"
  resourceId: string
  cssRules: string[]
}

export interface InlineImageResource {
  type: "datauri_image"
  resourceId: string
  originalUrl: string
  attributes: Record<string, string> 
}

export type ExternalPageResource = ExternalCssSheetResource | ExternalImageResourcee 

export type EmbeddedPageResource = InlineCssSheetResource | InlineImageResource

export type PageResource = ExternalPageResource | EmbeddedPageResource; 

export interface Pass0Result {
  title: string
  html: string
  docType: string 
  externalResources: ExternalPageResource[]
  embeddedResources: EmbeddedPageResource[]
}

/**
 * Adapation of inliner.js from the arweave web extension. 
 * 
 * This does things a little differently, in that 
 * 
 * a) it's fully self contained, so it be injected into a headless chrome page with evaluate(), 
 *    the function uses nothing from outside its own scope. 
 * b) it uses `document.styleSheets` instead of reading styles from the parsed dom string, this 
 *    picks up dynamically alterted styleSheets.
 * c) it marks elements we are interested in with a "data-archiver-fab-id" 
 *    set to a resourceID 
 * d) it returns all this information in a `Pass0Result` structure for the next step to 
 *    do the actual inlining 
 * 
 * In theory it can be used in other environments, like the content script of an extension, 
 * or perhaps used with JsDom, by passing in a document object, but it's only tested with
 * headless chrome. 
 * 
 */

export async function archivePagePass0(insertRebase = true, doc?: Document): Promise<Pass0Result> {
 
  if (!doc) {
    doc = document;
  }

  // Helper function to remove an attribute from an element and record 
  // the removal into an attributes object.
  function removeAttrib(attributes: Record<string, string>, element: HTMLElement, name: string) {
    const val = element.getAttribute(name); 
    if (val !== null) {
      attributes[name] = val
      element.removeAttribute(name)
    }
  }

  function getDocTypeString(document: Document) {
    const node = document.doctype;
    
    if (!node) {
      return '';
    }

    const html = 
    "<!DOCTYPE "
      + node.name
      + (node.publicId ? ' PUBLIC "' + node.publicId + '"' : '')
      + (!node.publicId && node.systemId ? ' SYSTEM' : '') 
      + (node.systemId ? ' "' + node.systemId + '"' : '')
      + '>';
    return html;
  }


  let url = doc.location.href; 
  

  let styleSheets = Array.from(doc.styleSheets);

  let scripts = doc.querySelectorAll("script");
  let noScripts = doc.querySelectorAll("noscript");
  let images = doc.querySelectorAll("img");
  let iframes = doc.querySelectorAll("iframe");

  if (insertRebase) {
    let rebase = doc.createElement("base");
    rebase.setAttribute("href", url);
    doc.head.appendChild(rebase);
  }

  let touchedIdCounter = 0;

  //const resources: PageResource[] = []
  const externalResources: ExternalPageResource[] = [];
  const embeddedResources: EmbeddedPageResource[] = [];

  let styleSheetPromises = styleSheets.map(async styleSheet => {
    
    
    // Incremenet touchedId. 
    let touchedId = (++touchedIdCounter).toString();

    try {

      // TODO: we are not covereing all cases here like, see: 
      // https://developer.mozilla.org/en-US/docs/Web/API/StyleSheet
      // and related specs, wrt to @import and XML?? sheets.

      // External style style, ie, a <link> element.
      if (styleSheet.ownerNode && styleSheet.href) {

        let href = (styleSheet.ownerNode as any).getAttribute("href");
        let absoluteURL = href && new URL(href, url).toString();
        (styleSheet.ownerNode as any).setAttribute("data-archiver-fab-id", touchedId);
        
        // reading cssRules from an external style sheet can triggeer CORS errors.. 
        // so attempt it but otherwise return an empty array.
        let cssRules: string[] = [];
        
        try { 
          cssRules = Array.from((styleSheet as CSSStyleSheet).cssRules).map(x => x.cssText);
        } catch (e) {
          console.error(e);
        }

        externalResources.push({
          type: "external_css_sheet",
          resourceId: touchedId,
          originalUrl: absoluteURL,
          cssRules,
        })
        return;
      }
      
      // Inline Style Sheet. 
      if (styleSheet.ownerNode && !styleSheet.href) {
        embeddedResources.push({
          type: "internal_css_sheet", 
          resourceId: touchedId, 
          cssRules: Array.from((styleSheet as CSSStyleSheet).cssRules).map(x => x.cssText),
        });
        (styleSheet.ownerNode as any).setAttribute("data-archiver-fab-id", touchedId)
        return;
      }

    } catch (e) {
      console.error(e);
      console.error('Error extracting style sheet resource');
    }
  });


  let imagePromises = Array.from(images, async image => {
    
    let attributes: Record<string, string> = {}
    
    removeAttrib(attributes, image, 'size');
    removeAttrib(attributes, image, 'sizes');
    removeAttrib(attributes, image, 'src-set');
    removeAttrib(attributes, image, 'data-src');
    
    let src = image.getAttribute("src")!;
    let absoluteURL = new URL(src, url).toString();

    let touchedId = (++touchedIdCounter).toString();
    
    //image.setAttribute("src", `replaced://${touchedId}`);
    image.setAttribute("data-archiver-fab-id", touchedId);
    const type = absoluteURL.startsWith('datauri') ? "datauri_image" : "external_img"
    if (type === "external_img") {
      externalResources.push({
        type,
        resourceId: touchedId,
        originalUrl: absoluteURL,
        attributes
      });
    } 
    else {
      embeddedResources.push({
        type,
        resourceId: touchedId,
        originalUrl: absoluteURL,
        attributes
      });
    }

  });

  scripts.forEach(x => x.remove());
  noScripts.forEach(x => x.remove());
  iframes.forEach(x => x.remove());

  await Promise.all([...imagePromises, ...styleSheetPromises]);

  let html = doc.all[0].outerHTML;

  return {
    title: doc.title,
    html: html,
    docType: getDocTypeString(doc),
    externalResources,
    embeddedResources,
  };
}
