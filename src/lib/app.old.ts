import express from 'express';
import cors from 'cors';
import { simplePageArchiver } from './simple';

const app = express();

const PORT = process.env.PORT && parseInt(process.env.PORT) || 1888

app.use(cors());

app.get('/scrape/*', async (req, res) => {

  const url = req.url.substr(8);
  console.log(`Request url: ${req.url} - scraping: ${url}`);

  // Ignore requests that aren't a proper url, this happens a lot 
  // when you visit /scrape/https://somewhere.com in a browser and then 
  // the page goes ahead and starts making more requests. 

  if (!url.toLowerCase().startsWith('http')) {
    res.status(400).send('Bad Request');
  }

  try {
    const result = await simplePageArchiver(url)
    console.log(`Got result with content-type: ${result.contentType}`)
    res.contentType(result.contentType)
    res.send(result.out)
  }

  catch (e) {
    console.error(e.message);
    res.status(500).send('Unexpected error');
  }

})

app.get('/preview/*', async (req, res) => {

  const url = req.url.substr(9);
  console.log(`Request url: ${req.url} - scraping: ${url}`);

  // Ignore requests that aren't a proper url, this happens a lot 
  // when you visit /scrape/https://somewhere.com in a browser and then 
  // the page goes ahead and starts making more requests. 

  if (!url.toLowerCase().startsWith('http')) {
    res.status(400).send('Bad Request');
  }

  try {
    const result = await simplePageArchiver(url)
    console.log(`Got result with content-type: ${result.contentType}`)

    // TODO: This assumes the string is utf-8 encoded. We should 
    // proboably check the result.contentType to see if it is encoded 
    // with something else. no idea how common non utf-8 encoded responses 
    // are.

    const content: Buffer =
      typeof result.out === 'string' ?
        Buffer.from(result.out, 'utf-8')
        :
        result.out;

    res.contentType('text/html')
    res.send(renderPreview(url, content, result.contentType));
  }

  catch (e) {
    console.error(e.message);
    res.status(500).send('Unexpected error');
  }

})

app.listen(PORT, () => {
  console.log(`Listening on port: ${PORT}`);
})



const renderPreview = (url: string, content: Buffer, contentType: string) =>
  `
  <!DOCTYPE html>
  <html style="height:100%;">
  <head>
  <meta charset="UTF-8">
  <title>Preview of ${url}</title>
  </head>

  <body style="height: 100%">
    <script> 
      const dataUri = "data:${contentType.replace(' ', '')};base64,${content.toString('base64')}";
      fetch(dataUri)
        .then(res => res.blob())
        .then(blob => {
          const objUrl = URL.createObjectURL(blob);
          document.querySelector('iframe').setAttribute('src', objUrl);
        })
    </script>
    <div style="margin: 1.5em; height: 90%; display: flex; flex-direction: column; justify-content: stretch;">
    <p>
      Preview of ${url} </br>
      Archived Page Size: ${(content.byteLength / 1024 / 1024).toFixed(2)} MiB
    </p>
    <iframe style="flex-grow: 1; border: 2px solid; border-radius: 0.24em">
    </iframe>
    </div>
  </body>
  </html>
  `